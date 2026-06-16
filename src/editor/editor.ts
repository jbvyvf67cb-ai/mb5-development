// Editor — the map-maker interaction layer.
//
// Tools: select (pick + transform gizmos), place (drop prefabs on a surface),
// entity (drop gameplay markers), sculpt (heightmap brushes). Drives a World's
// mutation ops; the World keeps ContinentData in sync so save is trivial.

import { GizmoManager, PointerEventTypes } from "@babylonjs/core";
import type { ArcRotateCamera, Nullable, Observer, PointerInfo, Scene } from "@babylonjs/core";
import type { World } from "../world/world";
import { getPrefab } from "../world/prefabs";

export type Tool = "select" | "place" | "sculpt" | "entity";
export type GizmoMode = "move" | "rotate" | "scale";
export type BrushMode = "raise" | "lower" | "smooth" | "flatten";

export interface Selection {
  kind: "prefab" | "entity";
  id: string;
  label: string;
  pos: [number, number, number];
  rot: [number, number, number];
  scale: [number, number, number];
}

export class Editor {
  tool: Tool = "select";
  gizmoMode: GizmoMode = "move";
  placePrefab = "platform";
  entityType = "coin";
  brush = { radius: 10, strength: 0.5, mode: "raise" as BrushMode };

  onSelectionChange?: (sel: Selection | null) => void;

  private gizmos: GizmoManager;
  private selected: { kind: "prefab" | "entity"; id: string } | null = null;
  private ptrObs: Nullable<Observer<PointerInfo>> = null;
  private pointerDown = false;
  private downX = 0;
  private downY = 0;
  private hooked = new Set<object>();
  private enabled = false;

  constructor(
    private scene: Scene,
    private world: World,
    private camera: ArcRotateCamera,
  ) {
    this.gizmos = new GizmoManager(scene);
    this.gizmos.usePointerToAttachGizmos = false;
    this.gizmos.positionGizmoEnabled = true; // default move
  }

  // --- lifecycle ---

  enable() {
    if (this.enabled) return;
    this.enabled = true;
    this.ptrObs = this.scene.onPointerObservable.add((pi) => this.onPointer(pi));
    if (this.tool !== "sculpt") this.camera.attachControl();
  }

  disable() {
    if (!this.enabled) return;
    this.enabled = false;
    if (this.ptrObs) this.scene.onPointerObservable.remove(this.ptrObs);
    this.ptrObs = null;
    this.gizmos.attachToMesh(null);
  }

  // --- tools ---

  setTool(t: Tool) {
    this.tool = t;
    if (t === "sculpt") {
      this.camera.detachControl();
      this.deselect();
    } else {
      this.camera.attachControl();
    }
  }

  setGizmoMode(m: GizmoMode) {
    this.gizmoMode = m;
    if (this.selected) {
      this.applyGizmoMode();
      this.attachToSelected();
    }
  }

  deleteSelected() {
    if (!this.selected) return;
    if (this.selected.kind === "prefab") this.world.removePrefab(this.selected.id);
    else this.world.removeEntity(this.selected.id);
    this.deselect();
  }

  // --- pointer ---

  private onPointer(pi: PointerInfo) {
    const e = pi.event as PointerEvent;
    switch (pi.type) {
      case PointerEventTypes.POINTERDOWN:
        if (e.button !== 0) return;
        this.pointerDown = true;
        this.downX = this.scene.pointerX;
        this.downY = this.scene.pointerY;
        if (this.tool === "sculpt") this.sculptAtPointer();
        break;
      case PointerEventTypes.POINTERMOVE:
        if (this.pointerDown && this.tool === "sculpt") this.sculptAtPointer();
        break;
      case PointerEventTypes.POINTERUP: {
        if (!this.pointerDown) return;
        this.pointerDown = false;
        if (this.tool === "sculpt") {
          this.world.rebuildTerrainPhysics();
          return;
        }
        const moved = Math.hypot(this.scene.pointerX - this.downX, this.scene.pointerY - this.downY);
        if (moved < 6) this.handleTap();
        break;
      }
    }
  }

  private handleTap() {
    const pick = this.scene.pick(this.scene.pointerX, this.scene.pointerY);
    if (this.tool === "select") {
      const md = pick?.pickedMesh?.metadata as
        | { instanceId?: string; entityId?: string }
        | undefined;
      if (md?.instanceId) this.select({ kind: "prefab", id: md.instanceId });
      else if (md?.entityId) this.select({ kind: "entity", id: md.entityId });
      else this.deselect();
      return;
    }
    if (!pick?.hit || !pick.pickedPoint) return;
    const p = pick.pickedPoint;
    if (this.tool === "place") {
      const def = getPrefab(this.placePrefab);
      const y = p.y + (def?.defaultScale[1] ?? 1) / 2;
      const inst = this.world.addPrefab(this.placePrefab, [p.x, y, p.z]);
      this.select({ kind: "prefab", id: inst.id });
    } else if (this.tool === "entity") {
      const ent = this.world.addEntity(this.entityType, [p.x, p.y + 0.5, p.z]);
      this.select({ kind: "entity", id: ent.id });
    }
  }

  // --- sculpt ---

  private sculptAtPointer() {
    const t = this.world.terrain;
    const td = this.world.data.terrain;
    if (!t || !td) return;
    const pick = this.scene.pick(this.scene.pointerX, this.scene.pointerY, (m) => m === t.mesh);
    if (!pick?.hit || !pick.pickedPoint) return;
    const hit = pick.pickedPoint;

    const { origin, cols, rows, cellX, cellZ } = t;
    const R = this.brush.radius;
    const s = this.brush.strength;
    const h = td.heights;

    const cMin = Math.max(0, Math.floor((hit.x - R - origin[0]) / cellX));
    const cMax = Math.min(cols - 1, Math.ceil((hit.x + R - origin[0]) / cellX));
    const rMin = Math.max(0, Math.floor((hit.z - R - origin[1]) / cellZ));
    const rMax = Math.min(rows - 1, Math.ceil((hit.z + R - origin[1]) / cellZ));

    for (let r = rMin; r <= rMax; r++) {
      for (let c = cMin; c <= cMax; c++) {
        const wx = origin[0] + c * cellX;
        const wz = origin[1] + r * cellZ;
        const d = Math.hypot(wx - hit.x, wz - hit.z);
        if (d > R) continue;
        let f = 1 - d / R;
        f = f * f * (3 - 2 * f); // smoothstep falloff
        const idx = r * cols + c;
        switch (this.brush.mode) {
          case "raise":
            h[idx] += s * f;
            break;
          case "lower":
            h[idx] -= s * f;
            break;
          case "flatten":
            h[idx] += (hit.y - h[idx]) * f * 0.5;
            break;
          case "smooth": {
            const n =
              (h[((r > 0 ? r - 1 : r) * cols) + c] +
                h[((r < rows - 1 ? r + 1 : r) * cols) + c] +
                h[r * cols + (c > 0 ? c - 1 : c)] +
                h[r * cols + (c < cols - 1 ? c + 1 : c)]) /
              4;
            h[idx] += (n - h[idx]) * f * 0.5;
            break;
          }
        }
      }
    }
    this.world.refreshTerrainGeometry();
  }

  // --- selection / gizmos ---

  private select(sel: { kind: "prefab" | "entity"; id: string }) {
    this.selected = sel;
    if (sel.kind === "entity") this.gizmoMode = "move"; // markers only move
    this.applyGizmoMode();
    this.attachToSelected();
    this.emitSelection();
  }

  private deselect() {
    this.selected = null;
    this.gizmos.attachToMesh(null);
    this.emitSelection();
  }

  private attachToSelected() {
    if (!this.selected) return;
    const mesh =
      this.selected.kind === "prefab"
        ? this.world.prefabMeshes.get(this.selected.id)
        : this.world.entityMeshes.get(this.selected.id);
    if (!mesh) {
      this.deselect();
      return;
    }
    this.gizmos.attachToMesh(mesh);
  }

  private applyGizmoMode() {
    const isEntity = this.selected?.kind === "entity";
    const g = this.gizmos;
    g.positionGizmoEnabled = this.gizmoMode === "move" || isEntity;
    g.rotationGizmoEnabled = !isEntity && this.gizmoMode === "rotate";
    g.scaleGizmoEnabled = !isEntity && this.gizmoMode === "scale";
    this.hookGizmos();
  }

  private hookGizmos() {
    const gz = this.gizmos.gizmos;
    for (const giz of [gz.positionGizmo, gz.rotationGizmo, gz.scaleGizmo]) {
      if (giz && !this.hooked.has(giz)) {
        this.hooked.add(giz);
        giz.onDragEndObservable.add(() => this.onGizmoDragEnd());
      }
    }
  }

  private onGizmoDragEnd() {
    if (!this.selected) return;
    if (this.selected.kind === "prefab") this.world.syncPrefabFromMesh(this.selected.id);
    else this.world.syncEntityFromMesh(this.selected.id);
    this.emitSelection();
  }

  private emitSelection() {
    if (!this.onSelectionChange) return;
    if (!this.selected) {
      this.onSelectionChange(null);
      return;
    }
    const mesh =
      this.selected.kind === "prefab"
        ? this.world.prefabMeshes.get(this.selected.id)
        : this.world.entityMeshes.get(this.selected.id);
    if (!mesh) {
      this.onSelectionChange(null);
      return;
    }
    const label =
      this.selected.kind === "prefab"
        ? (mesh.metadata?.prefab ?? "prefab")
        : (mesh.metadata?.type ?? "entity");
    this.onSelectionChange({
      kind: this.selected.kind,
      id: this.selected.id,
      label,
      pos: [round(mesh.position.x), round(mesh.position.y), round(mesh.position.z)],
      rot: [round(mesh.rotation.x), round(mesh.rotation.y), round(mesh.rotation.z)],
      scale: [round(mesh.scaling.x), round(mesh.scaling.y), round(mesh.scaling.z)],
    });
  }
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
