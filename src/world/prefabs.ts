// Prefab library — the true-3D building blocks the map maker places.
//
// Each prefab is a unit-sized procedural mesh factory plus metadata (default
// collider, base color, default placement scale). The loader builds one mesh per
// instance and applies the instance's transform/tint/collider. v1 ships
// procedural primitives; glTF-backed prefabs slot in later behind the same
// PrefabDef contract.

import { Mesh, MeshBuilder } from "@babylonjs/core";
import type { Scene } from "@babylonjs/core";
import { Vector3 } from "@babylonjs/core";
import { Buf } from "./buf";
import type { ColliderKind, Vec3 } from "./schema";

export interface PrefabDef {
  key: string;
  label: string;
  category: "structure" | "terrainpiece" | "prop";
  /** Default physics collider for instances of this prefab. */
  collider: Exclude<ColliderKind, "auto">;
  /** Base color (RGB 0..1); instance tint multiplies this. */
  baseColor: Vec3;
  /** Sensible default scale when first placed in the editor. */
  defaultScale: Vec3;
  /** Build a fresh unit-sized mesh (no material/transform applied yet). */
  build: (scene: Scene, name: string) => Mesh;
}

/** Right-triangular prism ("ramp"): rises from y=0 at z=-0.5 to y=1 at z=+0.5. */
function buildRamp(scene: Scene, name: string): Mesh {
  const b = new Buf();
  const v = (x: number, y: number, z: number) => new Vector3(x, y, z);
  // 6 corners of the wedge
  const a0 = v(-0.5, 0, -0.5),
    b0 = v(0.5, 0, -0.5),
    c0 = v(0.5, 0, 0.5),
    d0 = v(-0.5, 0, 0.5),
    cT = v(0.5, 1, 0.5),
    dT = v(-0.5, 1, 0.5);
  b.quad(a0, d0, c0, b0, new Vector3(0, -1, 0)); // bottom
  b.quad(d0, dT, cT, c0, new Vector3(0, 0, 1)); // back wall (+Z)
  // slope (faces up and toward -Z): normal of the inclined plane
  const sn = new Vector3(0, 0.5, -0.5).normalize();
  b.quad(a0, b0, cT, dT, sn);
  // two triangular sides
  b.tri(a0, dT, d0, new Vector3(-1, 0, 0)); // -X side
  b.tri(b0, c0, cT, new Vector3(1, 0, 0)); //  +X side
  const m = b.toMesh(name, scene);
  return m ?? new Mesh(name, scene);
}

/** Staircase rising along +Z from y=0 to y=1 over a unit footprint. */
function buildStairs(scene: Scene, name: string): Mesh {
  const b = new Buf();
  const steps = 6;
  for (let i = 0; i < steps; i++) {
    const top = (i + 1) / steps;
    const depth = 1 / steps;
    const z = -0.5 + (i + 0.5) * depth;
    b.box(new Vector3(0, top / 2, z), new Vector3(1, top, depth));
  }
  return b.toMesh(name, scene) ?? new Mesh(name, scene);
}

const DEFS: Record<string, PrefabDef> = {
  block: {
    key: "block",
    label: "Block",
    category: "structure",
    collider: "box",
    baseColor: [0.62, 0.64, 0.7],
    defaultScale: [2, 2, 2],
    build: (s, n) => MeshBuilder.CreateBox(n, { size: 1 }, s),
  },
  platform: {
    key: "platform",
    label: "Platform",
    category: "structure",
    collider: "box",
    baseColor: [0.5, 0.55, 0.62],
    defaultScale: [6, 0.6, 6],
    build: (s, n) => MeshBuilder.CreateBox(n, { size: 1 }, s),
  },
  wall: {
    key: "wall",
    label: "Wall",
    category: "structure",
    collider: "box",
    baseColor: [0.58, 0.56, 0.54],
    defaultScale: [6, 4, 0.5],
    build: (s, n) => MeshBuilder.CreateBox(n, { size: 1 }, s),
  },
  ramp: {
    key: "ramp",
    label: "Ramp",
    category: "structure",
    collider: "mesh",
    baseColor: [0.66, 0.6, 0.5],
    defaultScale: [4, 2, 4],
    build: buildRamp,
  },
  pillar: {
    key: "pillar",
    label: "Pillar",
    category: "structure",
    collider: "cylinder",
    baseColor: [0.7, 0.68, 0.62],
    defaultScale: [1.5, 4, 1.5],
    build: (s, n) => MeshBuilder.CreateCylinder(n, { diameter: 1, height: 1, tessellation: 20 }, s),
  },
  stairs: {
    key: "stairs",
    label: "Stairs",
    category: "structure",
    collider: "mesh",
    baseColor: [0.6, 0.58, 0.56],
    defaultScale: [4, 3, 5],
    build: buildStairs,
  },
  cone: {
    key: "cone",
    label: "Cone",
    category: "structure",
    collider: "mesh",
    baseColor: [0.72, 0.66, 0.5],
    defaultScale: [2.5, 4, 2.5],
    build: (s, n) =>
      MeshBuilder.CreateCylinder(n, { diameterTop: 0, diameterBottom: 1, height: 1, tessellation: 18 }, s),
  },
  ball: {
    key: "ball",
    label: "Ball",
    category: "prop",
    collider: "sphere",
    baseColor: [0.85, 0.5, 0.3],
    defaultScale: [2, 2, 2],
    build: (s, n) => MeshBuilder.CreateSphere(n, { diameter: 1, segments: 20 }, s),
  },
};

export function getPrefab(key: string): PrefabDef | undefined {
  return DEFS[key];
}

export function allPrefabs(): PrefabDef[] {
  return Object.values(DEFS);
}
