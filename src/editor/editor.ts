// Editor — the map-maker interaction layer.
//
// Tools: select (pick + transform gizmos), place (drop prefabs on a surface),
// entity (gameplay markers), sculpt (heightmap brushes). All mutations go
// through a command History for undo/redo. Drives a World; ContinentData stays
// the source of truth so save is trivial.

import { Color3, GizmoManager, MeshBuilder, PointerEventTypes, StandardMaterial } from "@babylonjs/core";
import type { ArcRotateCamera, Mesh, Nullable, Observer, PointerInfo, Scene } from "@babylonjs/core";
import type { ColliderKind, Vec3 } from "../world/schema";
import type { World } from "../world/world";
import { getPrefab } from "../world/prefabs";
import {
  History,
  addEntityCmd,
  addPrefabCmd,
  colliderPrefabCmd,
  moveEntityCmd,
  removeEntityCmd,
  removePrefabCmd,
  sculptCmd,
  tintPrefabCmd,
  transformPrefabCmd,
  type Transform,
} from "./commands";

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
  tint?: [number, number, number];
  collider?: ColliderKind;
}

export class Editor {
  tool: Tool = "select";
  gizmoMode: GizmoMode = "move";
  placePrefab = "platform";
  entityType = "coin";
  brush = { radius: 10, strength: 0.5, mode: "raise" as BrushMode };
  snap = { enabled: false, pos: 1, rotDeg: 15, scale: 0.25 };
  history = new History();

  onSelectionChange?: (sel: Selection | null) => void;
  onHistoryChange?: () => void;

  private gizmos: GizmoManager;
  private selected: { kind: "prefab" | "entity"; id: string } | null = null;
  private ptrObs: Nullable<Observer<PointerInfo>> = null;
  private pointerDown = false;
  private downX = 0;
  private downY = 0;
  private hooked = new Set<object>();
  private enabled = false;
  private dragBefore: Transform | null = null;
  private sculptBefore: number[] | null = null;
  private brushRing: Mesh | null = null;

  constructor(
    private scene: Scene,
    private world: World,
    private camera: ArcRotateCamera,
  ) {
    this.gizmos = new GizmoManager(scene);
    this.gizmos.usePointerToAttachGizmos = false;
    this.gizmos.positionGizmoEnabled = true;
    this.history.onChange = () => {
      this.refreshSelection();
      this.onHistoryChange?.();
    };
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
    // Dispose (not just hide): disable() is also the discard path when a new
    // Editor replaces this one on level load; the ring recreates lazily.
    this.brushRing?.material?.dispose();
    this.brushRing?.dispose();
    this.brushRing = null;
  }

  // --- sculpt brush ring (hover preview of radius) ---

  private ensureBrushRing(): Mesh {
    if (!this.brushRing) {
      const ring = MeshBuilder.CreateTorus(
        "brushRing",
        { diameter: 1, thickness: 0.035, tessellation: 48 },
        this.scene,
      );
      const mat = new StandardMaterial("brushRingMat", this.scene);
      mat.emissiveColor = new Color3(0.45, 0.9, 0.55);
      mat.disableLighting = true;
      mat.alpha = 0.85;
      ring.material = mat;
      ring.isPickable = false;
      this.brushRing = ring;
    }
    return this.brushRing;
  }

  private updateBrushRing() {
    if (this.tool !== "sculpt" || !this.world.terrain) {
      this.hideBrushRing();
      return;
    }
    const t = this.world.terrain;
    const pick = this.scene.pick(this.scene.pointerX, this.scene.pointerY, (m) => m === t.mesh);
    if (!pick?.hit || !pick.pickedPoint) {
      this.hideBrushRing();
      return;
    }
    const ring = this.ensureBrushRing();
    ring.setEnabled(true);
    ring.position.copyFrom(pick.pickedPoint);
    ring.position.y += 0.25;
    const d = this.brush.radius * 2;
    ring.scaling.set(d, 1.5, d);
  }

  private hideBrushRing() {
    this.brushRing?.setEnabled(false);
  }

  // --- tools ---

  setTool(t: Tool) {
    this.tool = t;
    if (t === "sculpt") {
      this.camera.detachControl();
      this.deselect();
    } else {
      this.camera.attachControl();
      this.hideBrushRing();
    }
  }

  setGizmoMode(m: GizmoMode) {
    this.gizmoMode = m;
    if (this.selected) {
      this.applyGizmoMode();
      this.attachToSelected();
    }
  }

  setSnap(enabled: boolean) {
    this.snap.enabled = enabled;
    this.applySnap();
  }

  undo() {
    this.history.undo();
  }
  redo() {
    this.history.redo();
  }

  deleteSelected() {
    if (!this.selected) return;
    if (this.selected.kind === "prefab") {
      const inst = this.world.getPrefabInstance(this.selected.id);
      if (!inst) return;
      this.world.removePrefab(inst.id);
      this.history.push(removePrefabCmd(this.world, inst));
    } else {
      const ent = this.world.getEntityInstance(this.selected.id);
      if (!ent) return;
      this.world.removeEntity(ent.id);
      this.history.push(removeEntityCmd(this.world, ent));
    }
    this.deselect();
  }

  duplicateSelected() {
    if (this.selected?.kind !== "prefab") return;
    const s = this.world.getPrefabInstance(this.selected.id);
    if (!s) return;
    const inst = this.world.addPrefab(s.prefab, [s.pos[0] + 2, s.pos[1], s.pos[2] + 2], {
      rot: [...s.rot] as Vec3,
      scale: [...s.scale] as Vec3,
      ...(s.tint ? { tint: [...s.tint] as Vec3 } : {}),
      ...(s.collider ? { collider: s.collider } : {}),
    });
    this.history.push(addPrefabCmd(this.world, inst));
    this.select({ kind: "prefab", id: inst.id });
  }

  focusSelected() {
    const mesh = this.selectedMesh();
    if (!mesh) return;
    this.camera.target.copyFrom(mesh.absolutePosition);
    this.camera.radius = Math.min(this.camera.radius, 18);
  }

  // --- transform/material edits from the inspector ---

  setSelectedTransform(t: Transform) {
    if (this.selected?.kind === "prefab") {
      const inst = this.world.getPrefabInstance(this.selected.id);
      if (!inst) return;
      const before: Transform = { pos: [...inst.pos], rot: [...inst.rot], scale: [...inst.scale] };
      this.world.setPrefabTransform(inst.id, t);
      this.history.push(transformPrefabCmd(this.world, inst.id, before, t));
    } else if (this.selected?.kind === "entity") {
      const ent = this.world.getEntityInstance(this.selected.id);
      if (!ent) return;
      const before: Vec3 = [...ent.pos];
      this.world.setEntityPos(ent.id, t.pos);
      this.history.push(moveEntityCmd(this.world, ent.id, before, t.pos));
    }
    this.attachToSelected();
    this.emitSelection();
  }

  setSelectedTint(tint: Vec3) {
    if (this.selected?.kind !== "prefab") return;
    const inst = this.world.getPrefabInstance(this.selected.id);
    if (!inst) return;
    const before: Vec3 = (inst.tint ?? [1, 1, 1]) as Vec3;
    this.world.setPrefabTint(inst.id, tint);
    this.history.push(tintPrefabCmd(this.world, inst.id, before, tint));
    this.emitSelection();
  }

  setSelectedCollider(kind: ColliderKind) {
    if (this.selected?.kind !== "prefab") return;
    const inst = this.world.getPrefabInstance(this.selected.id);
    if (!inst) return;
    const before: ColliderKind = inst.collider ?? "auto";
    this.world.setPrefabCollider(inst.id, kind);
    this.history.push(colliderPrefabCmd(this.world, inst.id, before, kind));
    this.emitSelection();
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
        if (this.tool === "sculpt") {
          this.sculptBefore = this.world.data.terrain?.heights.slice() ?? null;
          this.sculptAtPointer();
        }
        break;
      case PointerEventTypes.POINTERMOVE:
        if (this.tool === "sculpt") this.updateBrushRing();
        if (this.pointerDown && this.tool === "sculpt") this.sculptAtPointer();
        break;
      case PointerEventTypes.POINTERUP: {
        if (!this.pointerDown) return;
        this.pointerDown = false;
        if (this.tool === "sculpt") {
          this.world.rebuildTerrainPhysics();
          if (this.sculptBefore && this.world.data.terrain) {
            this.history.push(
              sculptCmd(this.world, this.sculptBefore, this.world.data.terrain.heights.slice()),
            );
          }
          this.sculptBefore = null;
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
      let x = p.x;
      let z = p.z;
      if (this.snap.enabled) {
        x = Math.round(x / this.snap.pos) * this.snap.pos;
        z = Math.round(z / this.snap.pos) * this.snap.pos;
      }
      const y = p.y + (def?.defaultScale[1] ?? 1) / 2;
      const inst = this.world.addPrefab(this.placePrefab, [x, y, z]);
      this.history.push(addPrefabCmd(this.world, inst));
      this.select({ kind: "prefab", id: inst.id });
    } else if (this.tool === "entity") {
      const ent = this.world.addEntity(this.entityType, [p.x, p.y + 0.5, p.z]);
      this.history.push(addEntityCmd(this.world, ent));
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
        f = f * f * (3 - 2 * f);
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
              (h[(r > 0 ? r - 1 : r) * cols + c] +
                h[(r < rows - 1 ? r + 1 : r) * cols + c] +
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
    if (sel.kind === "entity") this.gizmoMode = "move";
    this.applyGizmoMode();
    this.attachToSelected();
    this.emitSelection();
  }

  private deselect() {
    this.selected = null;
    this.gizmos.attachToMesh(null);
    this.emitSelection();
  }

  /** After undo/redo, drop or refresh the selection depending on what survived. */
  private refreshSelection() {
    if (!this.selected) return;
    if (!this.selectedMesh()) this.deselect();
    else {
      this.attachToSelected();
      this.emitSelection();
    }
  }

  private selectedMesh() {
    if (!this.selected) return undefined;
    return this.selected.kind === "prefab"
      ? this.world.prefabMeshes.get(this.selected.id)
      : this.world.entityMeshes.get(this.selected.id);
  }

  private attachToSelected() {
    const mesh = this.selectedMesh();
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
    this.applySnap();
  }

  private hookGizmos() {
    const gz = this.gizmos.gizmos;
    for (const giz of [gz.positionGizmo, gz.rotationGizmo, gz.scaleGizmo]) {
      if (giz && !this.hooked.has(giz)) {
        this.hooked.add(giz);
        giz.onDragStartObservable.add(() => this.onGizmoDragStart());
        giz.onDragEndObservable.add(() => this.onGizmoDragEnd());
      }
    }
  }

  private applySnap() {
    const gz = this.gizmos.gizmos;
    if (gz.positionGizmo) gz.positionGizmo.snapDistance = this.snap.enabled ? this.snap.pos : 0;
    if (gz.scaleGizmo) gz.scaleGizmo.snapDistance = this.snap.enabled ? this.snap.scale : 0;
    if (gz.rotationGizmo)
      gz.rotationGizmo.snapDistance = this.snap.enabled ? (this.snap.rotDeg * Math.PI) / 180 : 0;
  }

  private onGizmoDragStart() {
    if (this.selected?.kind === "prefab") {
      const inst = this.world.getPrefabInstance(this.selected.id);
      if (inst) this.dragBefore = { pos: [...inst.pos], rot: [...inst.rot], scale: [...inst.scale] };
    } else if (this.selected?.kind === "entity") {
      const ent = this.world.getEntityInstance(this.selected.id);
      if (ent) this.dragBefore = { pos: [...ent.pos], rot: [0, 0, 0], scale: [1, 1, 1] };
    }
  }

  private onGizmoDragEnd() {
    if (!this.selected || !this.dragBefore) return;
    if (this.selected.kind === "prefab") {
      this.world.syncPrefabFromMesh(this.selected.id);
      const inst = this.world.getPrefabInstance(this.selected.id);
      if (inst) {
        const after: Transform = { pos: [...inst.pos], rot: [...inst.rot], scale: [...inst.scale] };
        this.history.push(transformPrefabCmd(this.world, inst.id, this.dragBefore, after));
      }
    } else {
      this.world.syncEntityFromMesh(this.selected.id);
      const ent = this.world.getEntityInstance(this.selected.id);
      if (ent) {
        this.history.push(
          moveEntityCmd(this.world, ent.id, this.dragBefore.pos, [...ent.pos] as Vec3),
        );
      }
    }
    this.dragBefore = null;
    this.emitSelection();
  }

  private emitSelection() {
    if (!this.onSelectionChange) return;
    const mesh = this.selectedMesh();
    if (!this.selected || !mesh) {
      this.onSelectionChange(null);
      return;
    }
    const isPrefab = this.selected.kind === "prefab";
    const inst = isPrefab ? this.world.getPrefabInstance(this.selected.id) : undefined;
    const label = isPrefab ? (mesh.metadata?.prefab ?? "prefab") : (mesh.metadata?.type ?? "entity");
    this.onSelectionChange({
      kind: this.selected.kind,
      id: this.selected.id,
      label,
      pos: [round(mesh.position.x), round(mesh.position.y), round(mesh.position.z)],
      rot: [round(mesh.rotation.x), round(mesh.rotation.y), round(mesh.rotation.z)],
      scale: [round(mesh.scaling.x), round(mesh.scaling.y), round(mesh.scaling.z)],
      ...(inst ? { tint: (inst.tint ?? [1, 1, 1]) as [number, number, number] } : {}),
      ...(inst ? { collider: inst.collider ?? "auto" } : {}),
    });
  }
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
