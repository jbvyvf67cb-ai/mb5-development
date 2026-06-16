// A programmatic demo continent — exercises terrain + every prefab + an entity,
// so the world runtime is verifiable before the editor (and authored JSON) exist.

import { emptyContinent, type ContinentData, type PrefabInstance } from "./schema";

export function makeDemoContinent(): ContinentData {
  const c = emptyContinent("demo", "Demo Continent");

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
    // a small platforming course
    place("platform", [0, 4, 0], [8, 0.6, 8]),
    place("ramp", [0, 0.5, -10], [6, 3.5, 8]),
    place("platform", [12, 7, 0], [6, 0.6, 6], [0, 0, 0], [0.6, 0.8, 1]),
    place("platform", [22, 10, 4], [5, 0.6, 5], [0, 0, 0], [1, 0.8, 0.6]),
    place("pillar", [-10, 0, 8], [1.5, 8, 1.5]),
    place("pillar", [-14, 0, 12], [1.5, 6, 1.5]),
    place("wall", [-6, 0, -16], [12, 5, 0.8], [0, 0.3, 0]),
    place("block", [8, 1, 14], [2, 2, 2], [0, 0.6, 0]),
    place("ball", [0, 18, 0], [2, 2, 2]), // drops onto the first platform = physics smoke test
  ];

  c.entities = [{ id: "spawn", type: "playerSpawn", pos: [0, 6, 6] }];
  return c;
}
