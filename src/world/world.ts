// World — a live, mutable continent in a Babylon scene.
//
// Wraps a ContinentData (the source of truth) plus the meshes/colliders that
// realize it, and exposes mutation ops the editor drives (add/remove/transform
// prefabs and entities, re-sculpt terrain). The game uses the same class to load
// a finished level. `data` always reflects the current scene, so `serialize()`
// is just `data`.

import {
  Color3,
  Color4,
  Mesh,
  MeshBuilder,
  PhysicsAggregate,
  PhysicsShapeType,
  Scene as BScene,
  StandardMaterial,
  TransformNode,
  VertexBuffer,
} from "@babylonjs/core";
import type { DirectionalLight, HemisphericLight, PhysicsShapeParameters, Scene } from "@babylonjs/core";
import { Vector3 } from "@babylonjs/core";
import type {
  ColliderKind,
  ContinentData,
  EntityInstance,
  EnvSettings,
  PaletteStop,
  PrefabInstance,
  Vec3,
} from "./schema";
import { DEFAULT_ENV, DEFAULT_GRAVITY } from "./schema";
import { getPrefab } from "./prefabs";
import { buildTerrain, terrainGeometry, type TerrainMesh } from "./terrain";

export interface ContinentResult {
  root: TransformNode;
  data: ContinentData;
  prefabMeshes: Map<string, Mesh>;
  entityMeshes: Map<string, Mesh>;
  terrain?: TerrainMesh;
  dispose(): void;
}

const SHAPE: Record<Exclude<ColliderKind, "auto">, PhysicsShapeType | null> = {
  box: PhysicsShapeType.BOX,
  sphere: PhysicsShapeType.SPHERE,
  capsule: PhysicsShapeType.CAPSULE,
  cylinder: PhysicsShapeType.CYLINDER,
  mesh: PhysicsShapeType.MESH,
  none: null,
};

const ENTITY_COLORS: Record<string, Color3> = {
  playerSpawn: new Color3(0.2, 1, 0.4),
  checkpoint: new Color3(0.3, 0.7, 1),
  coin: new Color3(1, 0.85, 0.2),
  enemy: new Color3(1, 0.3, 0.3),
};

let idCounter = 0;
function uid(prefix: string): string {
  idCounter++;
  return `${prefix}${Date.now().toString(36)}${idCounter.toString(36)}`;
}

export class World implements ContinentResult {
  root: TransformNode;
  prefabMeshes = new Map<string, Mesh>();
  entityMeshes = new Map<string, Mesh>();
  terrain?: TerrainMesh;
  water?: Mesh;

  private aggregates = new Map<string, PhysicsAggregate>();
  private matCache = new Map<string, StandardMaterial>();
  private terrainMat?: StandardMaterial;
  private waterMat?: StandardMaterial;

  constructor(
    readonly scene: Scene,
    readonly data: ContinentData,
  ) {
    this.root = new TransformNode(`continent:${data.meta.id}`, scene);

    const g = data.meta.gravity ?? DEFAULT_GRAVITY;
    scene.getPhysicsEngine()?.setGravity(new Vector3(g[0], g[1], g[2]));

    if (data.terrain) this.buildTerrainMesh();
    if (data.meta.seaLevel !== undefined) this.buildWater(data.meta.seaLevel);
    for (const inst of data.prefabs) this.realizePrefab(inst);
    for (const ent of data.entities) this.realizeEntity(ent);
    this.applyEnv();
  }

  // --- environment aesthetics ---

  /** Resolved env (level settings over engine defaults). */
  env(): Required<EnvSettings> {
    return { ...DEFAULT_ENV, ...(this.data.meta.env ?? {}) };
  }

  /** Merge a patch into meta.env and re-apply to the scene. */
  setEnv(patch: Partial<EnvSettings>) {
    this.data.meta.env = { ...(this.data.meta.env ?? {}), ...patch };
    this.applyEnv();
  }

  /** Push meta.env (+defaults) into scene clear color, fog, lights, and water. */
  applyEnv() {
    const e = this.env();
    const s = this.scene;
    s.clearColor = new Color4(e.sky[0], e.sky[1], e.sky[2], 1);
    if (e.fogDensity > 0) {
      s.fogMode = BScene.FOGMODE_EXP2;
      s.fogDensity = e.fogDensity;
      s.fogColor = new Color3(e.fogColor[0], e.fogColor[1], e.fogColor[2]);
    } else {
      s.fogMode = BScene.FOGMODE_NONE;
    }
    const sun = s.getLightByName("sun") as DirectionalLight | null;
    if (sun) {
      sun.intensity = e.sunIntensity;
      sun.diffuse = new Color3(e.sunColor[0], e.sunColor[1], e.sunColor[2]);
      const az = (e.sunAzimuth * Math.PI) / 180;
      const el = (e.sunElevation * Math.PI) / 180;
      sun.direction = new Vector3(
        -Math.cos(el) * Math.sin(az),
        -Math.sin(el),
        -Math.cos(el) * Math.cos(az),
      );
    }
    const hemi = s.getLightByName("hemi") as HemisphericLight | null;
    if (hemi) {
      hemi.intensity = e.ambient;
      hemi.groundColor = new Color3(e.horizon[0], e.horizon[1], e.horizon[2]);
    }
    if (this.waterMat) {
      this.waterMat.diffuseColor = new Color3(e.waterColor[0], e.waterColor[1], e.waterColor[2]);
      this.waterMat.emissiveColor = new Color3(e.waterColor[0] * 0.35, e.waterColor[1] * 0.35, e.waterColor[2] * 0.35);
      this.waterMat.alpha = e.waterOpacity;
    }
  }

  /** Set/clear the sea level (rebuilds the water plane) and store it in meta. */
  setSeaLevel(level: number | undefined) {
    this.water?.dispose();
    this.water = undefined;
    if (level === undefined) delete this.data.meta.seaLevel;
    else {
      this.data.meta.seaLevel = level;
      this.buildWater(level);
      this.applyEnv();
    }
  }

  /** Replace the terrain elevation ramp and refresh vertex colors live. */
  setTerrainPalette(stops: PaletteStop[] | undefined) {
    if (!this.data.terrain) return;
    if (stops) this.data.terrain.palette = stops;
    else delete this.data.terrain.palette;
    this.refreshTerrainGeometry();
  }

  private buildWater(level: number) {
    const b = this.data.meta.bounds;
    const w = Math.max(2, b.max[0] - b.min[0]);
    const d = Math.max(2, b.max[2] - b.min[2]);
    const mesh = MeshBuilder.CreateGround("water", { width: w, height: d }, this.scene);
    mesh.parent = this.root;
    mesh.position.set((b.min[0] + b.max[0]) / 2, level, (b.min[2] + b.max[2]) / 2);
    mesh.isPickable = false;
    if (!this.waterMat) {
      const mat = new StandardMaterial("mat:water", this.scene);
      mat.specularColor = new Color3(0.4, 0.5, 0.6);
      mat.backFaceCulling = false;
      this.waterMat = mat;
    }
    mesh.material = this.waterMat;
    this.water = mesh;
  }

  // --- materials ---

  private material(rgb: Vec3, glow = 0): StandardMaterial {
    const key = rgb.map((n) => n.toFixed(3)).join("_") + `_g${glow.toFixed(2)}`;
    let m = this.matCache.get(key);
    if (!m) {
      m = new StandardMaterial(`mat:${key}`, this.scene);
      m.diffuseColor = new Color3(rgb[0], rgb[1], rgb[2]);
      m.specularColor = new Color3(0.04, 0.04, 0.04);
      if (glow > 0) m.emissiveColor = new Color3(rgb[0] * glow, rgb[1] * glow, rgb[2] * glow);
      this.matCache.set(key, m);
    }
    return m;
  }

  // --- terrain ---

  private buildTerrainMesh() {
    if (!this.data.terrain) return;
    this.terrain = buildTerrain(this.scene, this.data.terrain);
    this.terrain.mesh.parent = this.root;
    if (!this.terrainMat) {
      this.terrainMat = new StandardMaterial("mat:terrain", this.scene);
      this.terrainMat.diffuseColor = new Color3(1, 1, 1); // elevation vertex colors carry the look
      this.terrainMat.specularColor = new Color3(0.03, 0.03, 0.03);
      this.terrainMat.backFaceCulling = false;
    }
    this.terrain.mesh.material = this.terrainMat;
    const agg = new PhysicsAggregate(
      this.terrain.mesh,
      PhysicsShapeType.MESH,
      { mass: 0, friction: 0.9 },
      this.scene,
    );
    this.aggregates.set("__terrain", agg);
  }

  /** Rebuild the terrain mesh + collider after its heights array was mutated. */
  rebuildTerrain() {
    this.aggregates.get("__terrain")?.dispose();
    this.aggregates.delete("__terrain");
    this.terrain?.mesh.dispose();
    this.terrain = undefined;
    this.buildTerrainMesh();
  }

  /** Cheap live update of terrain geometry from heights (no physics) — for sculpt drag. */
  refreshTerrainGeometry() {
    if (!this.data.terrain || !this.terrain) return;
    const g = terrainGeometry(this.data.terrain);
    this.terrain.mesh.updateVerticesData(VertexBuffer.PositionKind, g.positions);
    this.terrain.mesh.updateVerticesData(VertexBuffer.NormalKind, g.normals);
    this.terrain.mesh.updateVerticesData(VertexBuffer.ColorKind, g.colors);
  }

  /** Replace (or remove) the terrain entirely. */
  setTerrain(t: import("./schema").TerrainData | undefined) {
    this.aggregates.get("__terrain")?.dispose();
    this.aggregates.delete("__terrain");
    this.terrain?.mesh.dispose();
    this.terrain = undefined;
    this.data.terrain = t;
    if (t) this.buildTerrainMesh();
  }

  /** Distance-cull prefab meshes around a point (frustum culling still applies). */
  updateCulling(cam: Vector3, radius = 240) {
    const r2 = radius * radius;
    for (const mesh of this.prefabMeshes.values()) {
      mesh.setEnabled(Vector3.DistanceSquared(cam, mesh.position) < r2);
    }
  }

  /** Recreate the terrain collider from current geometry — call after a sculpt stroke. */
  rebuildTerrainPhysics() {
    if (!this.terrain) return;
    this.aggregates.get("__terrain")?.dispose();
    const agg = new PhysicsAggregate(
      this.terrain.mesh,
      PhysicsShapeType.MESH,
      { mass: 0, friction: 0.9 },
      this.scene,
    );
    this.aggregates.set("__terrain", agg);
  }

  // --- prefabs ---

  private realizePrefab(inst: PrefabInstance): Mesh | null {
    const def = getPrefab(inst.prefab);
    if (!def) {
      console.warn(`[world] unknown prefab "${inst.prefab}" (instance ${inst.id})`);
      return null;
    }
    const mesh = def.build(this.scene, `prefab:${inst.id}`);
    mesh.parent = this.root;
    mesh.position.set(inst.pos[0], inst.pos[1], inst.pos[2]);
    mesh.rotation.set(inst.rot[0], inst.rot[1], inst.rot[2]);
    mesh.scaling.set(inst.scale[0], inst.scale[1], inst.scale[2]);

    const tint = inst.tint ?? [1, 1, 1];
    mesh.material = this.material(
      [def.baseColor[0] * tint[0], def.baseColor[1] * tint[1], def.baseColor[2] * tint[2]],
      def.glow ?? 0,
    );
    mesh.metadata = { instanceId: inst.id, prefab: inst.prefab };
    this.prefabMeshes.set(inst.id, mesh);
    this.rebuildCollider(inst.id);
    return mesh;
  }

  private rebuildCollider(id: string) {
    const mesh = this.prefabMeshes.get(id);
    const inst = this.data.prefabs.find((p) => p.id === id);
    if (!mesh || !inst) return;
    this.aggregates.get(id)?.dispose();
    this.aggregates.delete(id);
    const def = getPrefab(inst.prefab);
    const kind = !inst.collider || inst.collider === "auto" ? def?.collider ?? "box" : inst.collider;
    const shape = SHAPE[kind];
    if (shape !== null) {
      mesh.computeWorldMatrix(true);
      const params: PhysicsShapeParameters = {};
      const agg = new PhysicsAggregate(mesh, shape, { mass: 0, friction: 0.8, ...params }, this.scene);
      this.aggregates.set(id, agg);
    }
  }

  /** Add a new prefab instance; returns the created record. */
  addPrefab(
    prefab: string,
    pos: Vec3,
    opts: { rot?: Vec3; scale?: Vec3; tint?: Vec3; collider?: ColliderKind } = {},
  ): PrefabInstance {
    const def = getPrefab(prefab);
    const inst: PrefabInstance = {
      id: uid("p"),
      prefab,
      pos,
      rot: opts.rot ?? [0, 0, 0],
      scale: opts.scale ?? (def?.defaultScale ?? [1, 1, 1]),
      ...(opts.tint ? { tint: opts.tint } : {}),
      ...(opts.collider ? { collider: opts.collider } : {}),
    };
    return this.addPrefabInstance(inst);
  }

  /** Add a fully-specified instance (used by undo/redo + duplicate so ids are stable). */
  addPrefabInstance(inst: PrefabInstance): PrefabInstance {
    if (!this.data.prefabs.includes(inst)) this.data.prefabs.push(inst);
    this.realizePrefab(inst);
    return inst;
  }

  getPrefabInstance(id: string): PrefabInstance | undefined {
    return this.data.prefabs.find((p) => p.id === id);
  }

  /** Set a prefab's transform from data values; updates mesh, data, collider. */
  setPrefabTransform(id: string, t: { pos: Vec3; rot: Vec3; scale: Vec3 }) {
    const mesh = this.prefabMeshes.get(id);
    const inst = this.getPrefabInstance(id);
    if (!mesh || !inst) return;
    mesh.position.set(t.pos[0], t.pos[1], t.pos[2]);
    mesh.rotation.set(t.rot[0], t.rot[1], t.rot[2]);
    mesh.scaling.set(t.scale[0], t.scale[1], t.scale[2]);
    inst.pos = [...t.pos];
    inst.rot = [...t.rot];
    inst.scale = [...t.scale];
    this.rebuildCollider(id);
  }

  /** Recolor a prefab (tint multiplies its base color). */
  setPrefabTint(id: string, tint: Vec3) {
    const mesh = this.prefabMeshes.get(id);
    const inst = this.getPrefabInstance(id);
    if (!mesh || !inst) return;
    inst.tint = [...tint];
    const def = getPrefab(inst.prefab);
    const base = def?.baseColor ?? [1, 1, 1];
    mesh.material = this.material(
      [base[0] * tint[0], base[1] * tint[1], base[2] * tint[2]],
      def?.glow ?? 0,
    );
  }

  /** Change a prefab's collider kind. */
  setPrefabCollider(id: string, kind: ColliderKind) {
    const inst = this.getPrefabInstance(id);
    if (!inst) return;
    inst.collider = kind;
    this.rebuildCollider(id);
  }

  removePrefab(id: string) {
    this.aggregates.get(id)?.dispose();
    this.aggregates.delete(id);
    this.prefabMeshes.get(id)?.dispose();
    this.prefabMeshes.delete(id);
    const i = this.data.prefabs.findIndex((p) => p.id === id);
    if (i >= 0) this.data.prefabs.splice(i, 1);
  }

  /** After a gizmo drag, copy the mesh transform back into data + rebuild collider. */
  syncPrefabFromMesh(id: string) {
    const mesh = this.prefabMeshes.get(id);
    const inst = this.data.prefabs.find((p) => p.id === id);
    if (!mesh || !inst) return;
    inst.pos = [mesh.position.x, mesh.position.y, mesh.position.z];
    inst.rot = [mesh.rotation.x, mesh.rotation.y, mesh.rotation.z];
    inst.scale = [mesh.scaling.x, mesh.scaling.y, mesh.scaling.z];
    this.rebuildCollider(id);
  }

  // --- entities ---

  private realizeEntity(ent: EntityInstance): Mesh {
    const marker = MeshBuilder.CreateSphere(
      `entity:${ent.id}`,
      { diameter: 0.9, segments: 8 },
      this.scene,
    );
    marker.parent = this.root;
    marker.position.set(ent.pos[0], ent.pos[1], ent.pos[2]);
    const mat = new StandardMaterial(`entmat:${ent.id}`, this.scene);
    const c = ENTITY_COLORS[ent.type] ?? new Color3(0.9, 0.9, 0.9);
    mat.emissiveColor = c;
    mat.diffuseColor = c;
    marker.material = mat;
    marker.metadata = { entityId: ent.id, type: ent.type };
    this.entityMeshes.set(ent.id, marker);
    return marker;
  }

  addEntity(type: string, pos: Vec3): EntityInstance {
    return this.addEntityInstance({ id: uid("e"), type, pos });
  }

  addEntityInstance(ent: EntityInstance): EntityInstance {
    if (!this.data.entities.includes(ent)) this.data.entities.push(ent);
    this.realizeEntity(ent);
    return ent;
  }

  getEntityInstance(id: string): EntityInstance | undefined {
    return this.data.entities.find((e) => e.id === id);
  }

  setEntityPos(id: string, pos: Vec3) {
    const mesh = this.entityMeshes.get(id);
    const ent = this.getEntityInstance(id);
    if (!mesh || !ent) return;
    mesh.position.set(pos[0], pos[1], pos[2]);
    ent.pos = [...pos];
  }

  removeEntity(id: string) {
    this.entityMeshes.get(id)?.dispose();
    this.entityMeshes.delete(id);
    const i = this.data.entities.findIndex((e) => e.id === id);
    if (i >= 0) this.data.entities.splice(i, 1);
  }

  syncEntityFromMesh(id: string) {
    const mesh = this.entityMeshes.get(id);
    const ent = this.data.entities.find((e) => e.id === id);
    if (!mesh || !ent) return;
    ent.pos = [mesh.position.x, mesh.position.y, mesh.position.z];
  }

  serialize(): ContinentData {
    return this.data;
  }

  dispose() {
    this.aggregates.forEach((a) => a.dispose());
    this.aggregates.clear();
    this.root.dispose();
    this.matCache.forEach((m) => m.dispose());
    this.terrainMat?.dispose();
    this.waterMat?.dispose();
  }
}

export function buildContinent(scene: Scene, data: ContinentData): World {
  return new World(scene, data);
}

/** Find the first player-spawn entity position, or a default. */
export function spawnPoint(data: ContinentData): Vector3 {
  const s = data.entities.find((e) => e.type === "playerSpawn");
  return s ? new Vector3(s.pos[0], s.pos[1], s.pos[2]) : new Vector3(0, 5, 0);
}
