// A programmatic demo continent — exercises terrain + every prefab + an entity,
// so the world runtime is verifiable before the editor (and authored JSON) exist.

import { emptyContinent, type ContinentData, type PrefabInstance, type TerrainData } from "./schema";

/** A flat heightmap of the given grid resolution over a square extent. */
export function flatTerrain(size = 120, resolution = 41): TerrainData {
  return { size: [size, size], resolution: [resolution, resolution], heights: new Array(resolution * resolution).fill(0) };
}

/** A fresh, mostly-empty level (flat terrain + a spawn) for "New Level". */
export function newContinent(id = "untitled"): ContinentData {
  const c = emptyContinent(id);
  c.meta.bounds = { min: [-65, -25, -65], max: [65, 45, 65] };
  c.terrain = flatTerrain();
  c.entities = [{ id: "spawn", type: "playerSpawn", pos: [0, 4, 0] }];
  return c;
}

export function makeDemoContinent(): ContinentData {
  const c = emptyContinent("demo", "Demo Continent");
  c.meta.bounds = { min: [-65, -25, -65], max: [65, 45, 65] };

  // Gentle rolling heightmap.
  const cols = 41;
  const rows = 41;
  const heights: number[] = [];
  for (let r = 0; r < rows; r++) {
    for (let col = 0; col < cols; col++) {
      const x = (col / (cols - 1) - 0.5) * Math.PI * 3;
      const z = (r / (rows - 1) - 0.5) * Math.PI * 3;
      heights.push(Math.sin(x) * Math.cos(z) * 2.2 + 0.5);
    }
  }
  c.terrain = { size: [120, 120], resolution: [cols, rows], heights };

  let n = 0;
  const id = () => `p${n++}`;
  const place = (
    prefab: string,
    pos: [number, number, number],
    scale: [number, number, number],
    rot: [number, number, number] = [0, 0, 0],
    tint?: [number, number, number],
  ): PrefabInstance => ({ id: id(), prefab, pos, rot, scale, ...(tint ? { tint } : {}) });

  c.prefabs = [
    // ascending platforming course
    place("platform", [0, 4, 0], [8, 0.6, 8]),
    place("ramp", [0, 0.5, -10], [6, 3.5, 8]),
    place("platform", [12, 7, 0], [6, 0.6, 6], [0, 0, 0], [0.6, 0.8, 1]),
    place("platform", [22, 10, 4], [5, 0.6, 5], [0, 0, 0], [1, 0.8, 0.6]),
    place("platform", [30, 13, 10], [5, 0.6, 5], [0, 0, 0], [0.7, 1, 0.7]),
    place("stairs", [30, 0, -2], [5, 6, 8], [0, Math.PI, 0]),
    // a colonnade
    place("pillar", [-10, 0, 8], [1.5, 8, 1.5]),
    place("pillar", [-14, 0, 12], [1.5, 6, 1.5]),
    place("pillar", [-18, 0, 16], [1.5, 7, 1.5]),
    place("cone", [-14, 6, 12], [3, 3, 3], [0, 0, 0], [0.9, 0.4, 0.4]),
    // scenery
    place("wall", [-6, 0, -16], [12, 5, 0.8], [0, 0.3, 0]),
    place("block", [8, 1, 14], [2, 2, 2], [0, 0.6, 0]),
    place("ramp", [40, 0.5, 10], [8, 5, 10], [0, -Math.PI / 2, 0], [0.6, 0.6, 0.8]),
    place("ball", [0, 18, 0], [2, 2, 2]), // drops onto the first platform = physics smoke test
  ];

  // a coin trail up the course + a few scattered
  c.entities = [
    { id: "spawn", type: "playerSpawn", pos: [0, 6, 6] },
    { id: "cp1", type: "checkpoint", pos: [12, 8, 0] },
    { id: "cp2", type: "checkpoint", pos: [30, 14, 10] },
    { id: "c1", type: "coin", pos: [0, 5.5, 0] },
    { id: "c2", type: "coin", pos: [12, 8.5, 0] },
    { id: "c3", type: "coin", pos: [22, 11.5, 4] },
    { id: "c4", type: "coin", pos: [30, 14.5, 10] },
    { id: "c5", type: "coin", pos: [-10, 2, 8] },
    { id: "c6", type: "coin", pos: [-14, 8, 12] },
    { id: "c7", type: "coin", pos: [4, 2, 14] },
    { id: "c8", type: "coin", pos: [40, 6, 10] },
  ];
  return c;
}
