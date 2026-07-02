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
  category: "structure" | "nature" | "prop" | "gameplay";
  /** Default physics collider for instances of this prefab. */
  collider: Exclude<ColliderKind, "auto">;
  /** Base color (RGB 0..1); instance tint multiplies this. */
  baseColor: Vec3;
  /** Sensible default scale when first placed in the editor. */
  defaultScale: Vec3;
  /** Emissive strength 0..1 (glowing props like crystals/rings). */
  glow?: number;
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

/** Archway/gate: two legs + lintel, unit cube envelope (centered). */
function buildGate(scene: Scene, name: string): Mesh {
  const b = new Buf();
  b.box(new Vector3(-0.4, -0.1, 0), new Vector3(0.2, 0.8, 1));
  b.box(new Vector3(0.4, -0.1, 0), new Vector3(0.2, 0.8, 1));
  b.box(new Vector3(0, 0.4, 0), new Vector3(1, 0.2, 1));
  return b.toMesh(name, scene) ?? new Mesh(name, scene);
}

/** Bridge segment: deck + low side rails, centered. */
function buildBridge(scene: Scene, name: string): Mesh {
  const b = new Buf();
  b.box(new Vector3(0, -0.42, 0), new Vector3(1, 0.16, 1));
  b.box(new Vector3(-0.46, -0.2, 0), new Vector3(0.08, 0.3, 1));
  b.box(new Vector3(0.46, -0.2, 0), new Vector3(0.08, 0.3, 1));
  return b.toMesh(name, scene) ?? new Mesh(name, scene);
}

/** Fence: posts + two rails across X, thin on Z, centered. */
function buildFence(scene: Scene, name: string): Mesh {
  const b = new Buf();
  for (const x of [-0.48, 0, 0.48]) b.box(new Vector3(x, 0, 0), new Vector3(0.08, 1, 0.08));
  b.box(new Vector3(0, 0.28, 0), new Vector3(1, 0.1, 0.05));
  b.box(new Vector3(0, -0.12, 0), new Vector3(1, 0.1, 0.05));
  return b.toMesh(name, scene) ?? new Mesh(name, scene);
}

/** Blocky voxel tree with baked two-tone vertex colors (trunk + canopy). */
function buildTree(scene: Scene, name: string): Mesh {
  const b = new Buf();
  const trunk = [0.45, 0.3, 0.18, 1];
  const leaf = [0.22, 0.5, 0.2, 1];
  const leafHi = [0.3, 0.62, 0.26, 1];
  b.box(new Vector3(0, -0.3, 0), new Vector3(0.16, 0.4, 0.16), 0, trunk);
  b.box(new Vector3(0, 0.05, 0), new Vector3(0.7, 0.36, 0.7), 0, leaf);
  b.box(new Vector3(0, 0.35, 0), new Vector3(0.44, 0.26, 0.44), 0, leafHi);
  return b.toMesh(name, scene) ?? new Mesh(name, scene);
}

/** Stepped pine: trunk + three shrinking tiers, baked colors. */
function buildPine(scene: Scene, name: string): Mesh {
  const b = new Buf();
  const trunk = [0.42, 0.28, 0.16, 1];
  const dark = [0.14, 0.36, 0.2, 1];
  const mid = [0.18, 0.44, 0.24, 1];
  b.box(new Vector3(0, -0.42, 0), new Vector3(0.14, 0.16, 0.14), 0, trunk);
  b.box(new Vector3(0, -0.2, 0), new Vector3(0.72, 0.28, 0.72), 0, dark);
  b.box(new Vector3(0, 0.08, 0), new Vector3(0.5, 0.28, 0.5), 0, mid);
  b.box(new Vector3(0, 0.34, 0), new Vector3(0.28, 0.24, 0.28), 0, dark);
  return b.toMesh(name, scene) ?? new Mesh(name, scene);
}

/** Spring: base slab + coil rings + top pad, unit envelope (centered). */
function buildSpring(scene: Scene, name: string): Mesh {
  const b = new Buf();
  const dark = [0.35, 0.32, 0.28, 1];
  const coil = [0.85, 0.72, 0.25, 1];
  b.box(new Vector3(0, -0.42, 0), new Vector3(0.9, 0.16, 0.9), 0, dark);
  for (let i = 0; i < 3; i++) {
    b.box(new Vector3(0, -0.24 + i * 0.2, 0), new Vector3(0.55 - i * 0.06, 0.09, 0.55 - i * 0.06), i * 0.5, coil);
  }
  b.box(new Vector3(0, 0.38, 0), new Vector3(0.8, 0.14, 0.8), 0, [0.95, 0.35, 0.25, 1]);
  return b.toMesh(name, scene) ?? new Mesh(name, scene);
}

/** Boost pad: flat slab with chevrons pointing +Z (its facing). */
function buildBoost(scene: Scene, name: string): Mesh {
  const b = new Buf();
  b.box(new Vector3(0, -0.35, 0), new Vector3(1, 0.3, 1), 0, [0.16, 0.3, 0.38, 1]);
  const arrow = [0.5, 0.95, 0.9, 1];
  for (const z of [-0.25, 0.15]) {
    b.box(new Vector3(-0.14, -0.16, z - 0.09), new Vector3(0.36, 0.1, 0.1), Math.PI / 4.5, arrow);
    b.box(new Vector3(0.14, -0.16, z - 0.09), new Vector3(0.36, 0.1, 0.1), -Math.PI / 4.5, arrow);
  }
  return b.toMesh(name, scene) ?? new Mesh(name, scene);
}

/** Spikes: base slab + pyramid spikes (hazard). */
function buildSpikes(scene: Scene, name: string): Mesh {
  const b = new Buf();
  b.box(new Vector3(0, -0.42, 0), new Vector3(1, 0.16, 1), 0, [0.3, 0.28, 0.3, 1]);
  const spike = [0.82, 0.82, 0.88, 1];
  const v = (x: number, y: number, z: number) => new Vector3(x, y, z);
  for (const [cx, cz] of [[-0.3, -0.3], [0.3, -0.3], [-0.3, 0.3], [0.3, 0.3], [0, 0]]) {
    const s = 0.16;
    const base = -0.34;
    const tip = v(cx, 0.45, cz);
    const a = v(cx - s, base, cz - s), b2 = v(cx + s, base, cz - s), c = v(cx + s, base, cz + s), d = v(cx - s, base, cz + s);
    b.tri(a, b2, tip, v(0, 0.4, -1).normalize(), spike);
    b.tri(b2, c, tip, v(1, 0.4, 0).normalize(), spike);
    b.tri(c, d, tip, v(0, 0.4, 1).normalize(), spike);
    b.tri(d, a, tip, v(-1, 0.4, 0).normalize(), spike);
  }
  return b.toMesh(name, scene) ?? new Mesh(name, scene);
}

/** Goal flag: pole + banner. */
function buildGoal(scene: Scene, name: string): Mesh {
  const b = new Buf();
  b.box(new Vector3(0, -0.45, 0), new Vector3(0.5, 0.1, 0.5), 0, [0.4, 0.38, 0.35, 1]);
  b.box(new Vector3(0, 0, 0), new Vector3(0.07, 1, 0.07), 0, [0.55, 0.55, 0.6, 1]);
  b.box(new Vector3(0.22, 0.33, 0), new Vector3(0.38, 0.24, 0.03), 0, [1, 0.8, 0.2, 1]);
  return b.toMesh(name, scene) ?? new Mesh(name, scene);
}

/** Low-poly rock: icosphere with deterministic vertex jitter. */
function buildRock(scene: Scene, name: string): Mesh {
  const m = MeshBuilder.CreateIcoSphere(name, { radius: 0.5, subdivisions: 2 }, scene);
  const pos = m.getVerticesData("position");
  if (pos) {
    for (let i = 0; i < pos.length; i += 3) {
      // deterministic pseudo-noise from vertex position
      const h = Math.sin(pos[i] * 12.9898 + pos[i + 1] * 78.233 + pos[i + 2] * 37.719) * 43758.5453;
      const f = 1 + ((h - Math.floor(h)) - 0.5) * 0.45;
      pos[i] *= f;
      pos[i + 1] *= f * 0.85; // slightly squashed
      pos[i + 2] *= f;
    }
    m.updateVerticesData("position", pos);
    m.createNormals(false);
  }
  return m;
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
  gate: {
    key: "gate",
    label: "Gate",
    category: "structure",
    collider: "mesh",
    baseColor: [0.68, 0.62, 0.52],
    defaultScale: [6, 6, 1.2],
    build: buildGate,
  },
  dome: {
    key: "dome",
    label: "Dome",
    category: "structure",
    collider: "mesh",
    baseColor: [0.75, 0.72, 0.66],
    defaultScale: [6, 3, 6],
    build: (s, n) => MeshBuilder.CreateSphere(n, { diameter: 1, segments: 16, slice: 0.5 }, s),
  },
  bridge: {
    key: "bridge",
    label: "Bridge",
    category: "structure",
    collider: "mesh",
    baseColor: [0.55, 0.42, 0.3],
    defaultScale: [3, 2, 8],
    build: buildBridge,
  },
  tree: {
    key: "tree",
    label: "Tree",
    category: "nature",
    collider: "box",
    baseColor: [1, 1, 1], // colors baked in vertices; tint still multiplies
    defaultScale: [4, 7, 4],
    build: buildTree,
  },
  pine: {
    key: "pine",
    label: "Pine",
    category: "nature",
    collider: "box",
    baseColor: [1, 1, 1],
    defaultScale: [3.5, 8, 3.5],
    build: buildPine,
  },
  rock: {
    key: "rock",
    label: "Rock",
    category: "nature",
    collider: "mesh",
    baseColor: [0.52, 0.5, 0.48],
    defaultScale: [2.5, 2, 2.5],
    build: buildRock,
  },
  bush: {
    key: "bush",
    label: "Bush",
    category: "nature",
    collider: "sphere",
    baseColor: [0.3, 0.55, 0.28],
    defaultScale: [2, 1.4, 2],
    build: (s, n) => MeshBuilder.CreateSphere(n, { diameter: 1, segments: 10 }, s),
  },
  crystal: {
    key: "crystal",
    label: "Crystal",
    category: "nature",
    collider: "box",
    baseColor: [0.45, 0.85, 0.95],
    defaultScale: [1.4, 3, 1.4],
    glow: 0.55,
    build: (s, n) => MeshBuilder.CreatePolyhedron(n, { type: 1, size: 0.5 }, s),
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
  crate: {
    key: "crate",
    label: "Crate",
    category: "prop",
    collider: "box",
    baseColor: [0.72, 0.55, 0.34],
    defaultScale: [2, 2, 2],
    build: (s, n) => MeshBuilder.CreateBox(n, { size: 1 }, s),
  },
  fence: {
    key: "fence",
    label: "Fence",
    category: "prop",
    collider: "box",
    baseColor: [0.6, 0.48, 0.34],
    defaultScale: [4, 1.6, 0.3],
    build: buildFence,
  },
  ring: {
    key: "ring",
    label: "Ring",
    category: "prop",
    collider: "mesh",
    baseColor: [1, 0.8, 0.25],
    defaultScale: [4, 4, 4],
    glow: 0.4,
    build: (s, n) => MeshBuilder.CreateTorus(n, { diameter: 1, thickness: 0.12, tessellation: 20 }, s),
  },
  spring: {
    key: "spring",
    label: "Spring",
    category: "gameplay",
    collider: "box",
    baseColor: [1, 1, 1], // colors baked; tint multiplies
    defaultScale: [1.6, 1.1, 1.6],
    build: buildSpring,
  },
  boost: {
    key: "boost",
    label: "Boost pad",
    category: "gameplay",
    collider: "box",
    baseColor: [1, 1, 1],
    defaultScale: [3, 0.5, 3],
    glow: 0.25,
    build: buildBoost,
  },
  spikes: {
    key: "spikes",
    label: "Spikes",
    category: "gameplay",
    collider: "box",
    baseColor: [1, 1, 1],
    defaultScale: [2.5, 1, 2.5],
    build: buildSpikes,
  },
  movingPlatform: {
    key: "movingPlatform",
    label: "Moving platform",
    category: "gameplay",
    collider: "box",
    baseColor: [0.7, 0.55, 0.95],
    defaultScale: [4, 0.6, 4],
    build: (s, n) => MeshBuilder.CreateBox(n, { size: 1 }, s),
  },
  goal: {
    key: "goal",
    label: "Goal flag",
    category: "gameplay",
    collider: "box",
    baseColor: [1, 1, 1],
    glow: 0.2,
    defaultScale: [1.5, 4, 1.5],
    build: buildGoal,
  },
};

export function getPrefab(key: string): PrefabDef | undefined {
  return DEFS[key];
}

export function allPrefabs(): PrefabDef[] {
  return Object.values(DEFS);
}
