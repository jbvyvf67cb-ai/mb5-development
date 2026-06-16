// Continent loader — instantiate ContinentData into a Babylon scene.
//
// Shared by the editor (live preview, meshes tagged for picking) and the game
// (the playable world). v1 builds one mesh + one static collider per prefab
// instance so the editor can select/transform each; chunk-merging for scale is
// milestone 2. Meshes carry metadata (instanceId / entityId) so raycast picking
// maps a hit back to its data record.

import {
  Color3,
  Mesh,
  MeshBuilder,
  PhysicsAggregate,
  PhysicsShapeType,
  StandardMaterial,
  TransformNode,
} from "@babylonjs/core";
import type { Scene } from "@babylonjs/core";
import { Vector3 } from "@babylonjs/core";
import type { ColliderKind, ContinentData, EntityInstance, PrefabInstance } from "./schema";
import { DEFAULT_GRAVITY } from "./schema";
import { getPrefab } from "./prefabs";
import { buildTerrain, type TerrainMesh } from "./terrain";

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

export function buildContinent(scene: Scene, data: ContinentData): ContinentResult {
  const root = new TransformNode(`continent:${data.meta.id}`, scene);
  const prefabMeshes = new Map<string, Mesh>();
  const entityMeshes = new Map<string, Mesh>();
  const matCache = new Map<string, StandardMaterial>();

  // Apply gravity from the level (physics is already enabled in setup.ts).
  const g = data.meta.gravity ?? DEFAULT_GRAVITY;
  scene.getPhysicsEngine()?.setGravity(new Vector3(g[0], g[1], g[2]));

  const material = (rgb: [number, number, number]): StandardMaterial => {
    const key = rgb.map((n) => n.toFixed(3)).join("_");
    let m = matCache.get(key);
    if (!m) {
      m = new StandardMaterial(`mat:${key}`, scene);
      m.diffuseColor = new Color3(rgb[0], rgb[1], rgb[2]);
      m.specularColor = new Color3(0.04, 0.04, 0.04);
      matCache.set(key, m);
    }
    return m;
  };

  // --- terrain ---
  let terrain: TerrainMesh | undefined;
  if (data.terrain) {
    terrain = buildTerrain(scene, data.terrain);
    terrain.mesh.parent = root;
    const tmat = new StandardMaterial("mat:terrain", scene);
    tmat.diffuseColor = new Color3(0.22, 0.42, 0.24);
    tmat.specularColor = new Color3(0.02, 0.03, 0.02);
    tmat.backFaceCulling = false; // visible from above regardless of winding
    terrain.mesh.material = tmat;
    new PhysicsAggregate(terrain.mesh, PhysicsShapeType.MESH, { mass: 0, friction: 0.9 }, scene);
  }

  // --- prefab instances ---
  for (const inst of data.prefabs) addPrefab(inst);

  // --- entity markers ---
  for (const ent of data.entities) addEntity(ent);

  function addPrefab(inst: PrefabInstance) {
    const def = getPrefab(inst.prefab);
    if (!def) {
      console.warn(`[continent] unknown prefab "${inst.prefab}" (instance ${inst.id})`);
      return;
    }
    const mesh = def.build(scene, `prefab:${inst.id}`);
    mesh.parent = root;
    mesh.position.set(inst.pos[0], inst.pos[1], inst.pos[2]);
    mesh.rotation.set(inst.rot[0], inst.rot[1], inst.rot[2]);
    mesh.scaling.set(inst.scale[0], inst.scale[1], inst.scale[2]);

    const tint = inst.tint ?? [1, 1, 1];
    mesh.material = material([
      def.baseColor[0] * tint[0],
      def.baseColor[1] * tint[1],
      def.baseColor[2] * tint[2],
    ]);
    mesh.metadata = { instanceId: inst.id, prefab: inst.prefab };

    const kind = !inst.collider || inst.collider === "auto" ? def.collider : inst.collider;
    const shape = SHAPE[kind];
    if (shape !== null) {
      new PhysicsAggregate(mesh, shape, { mass: 0, friction: 0.8 }, scene);
    }
    prefabMeshes.set(inst.id, mesh);
  }

  function addEntity(ent: EntityInstance) {
    const marker = MeshBuilder.CreateSphere(`entity:${ent.id}`, { diameter: 0.8, segments: 8 }, scene);
    marker.parent = root;
    marker.position.set(ent.pos[0], ent.pos[1], ent.pos[2]);
    const mat = new StandardMaterial(`entmat:${ent.id}`, scene);
    const c = ENTITY_COLORS[ent.type] ?? new Color3(0.9, 0.9, 0.9);
    mat.emissiveColor = c;
    mat.diffuseColor = c;
    marker.material = mat;
    marker.metadata = { entityId: ent.id, type: ent.type };
    entityMeshes.set(ent.id, marker);
  }

  return {
    root,
    data,
    prefabMeshes,
    entityMeshes,
    terrain,
    dispose() {
      root.dispose();
      matCache.forEach((m) => m.dispose());
    },
  };
}

/** Find the first player-spawn entity position, or a default. */
export function spawnPoint(data: ContinentData): Vector3 {
  const s = data.entities.find((e) => e.type === "playerSpawn");
  return s ? new Vector3(s.pos[0], s.pos[1], s.pos[2]) : new Vector3(0, 5, 0);
}
