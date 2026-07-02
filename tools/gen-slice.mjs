// gen-slice.mjs — the "Joshua slice": the hand-drawn world's southern
// continent as a focused movement playground.
//
// Same geography as the full map (maplib), cropped + re-centered at higher
// detail, with a curated course that exercises every special move:
//   beach spawn → coin trail up the mountain (checkpoints) → glide descent,
//   a dash bay of gap platforms, a wall-jump chimney, ground-pound crates,
//   and deterministic nature dressing.
// Run: `node tools/gen-slice.mjs` → assets/continents/joshua-slice.json

import { writeFileSync, mkdirSync } from "node:fs";
import { peakC, peak, rasterize, rng, worldHeight } from "./maplib.mjs";

// Crop window in world coords (the southern continent + shore).
const X0 = -105, X1 = 105, Z0 = 0, Z1 = 190;
const SIZE_X = X1 - X0; // 210
const SIZE_Z = Z1 - Z0; // 190
const CZ = (Z0 + Z1) / 2; // world z that becomes slice z=0
const COLS = 141, ROWS = 127; // ~1.5 m cells

// slice coords <-> world coords
const h = (x, z) => worldHeight(x, z + CZ);
const PEAK = [peakC[0], peakC[1] - CZ]; // ≈ [-15, 11.4]

const { heights, maxH } = rasterize({ x0: X0, z0: Z0, sizeX: SIZE_X, sizeZ: SIZE_Z, cols: COLS, rows: ROWS });

// ---------- course construction ----------
const prefabs = [];
const entities = [];
let pn = 0, en = 0;
const P = (prefab, pos, scale, rot = [0, 0, 0], tint) =>
  prefabs.push({ id: `p${pn++}`, prefab, pos: pos.map(round1), rot, scale, ...(tint ? { tint } : {}) });
const E = (type, pos, id) =>
  entities.push({ id: id ?? `e${en++}`, type, pos: pos.map(round1) });
const round1 = (n) => Math.round(n * 10) / 10;

// Beach spawn: walk south from open sea at x=0 until land rises.
let spawnZ = -90;
for (let z = -92; z < 0; z += 0.5) {
  if (h(0, z) > 1.2) {
    spawnZ = z + 5;
    break;
  }
}
const spawn = [0, h(0, spawnZ) + 2.5, spawnZ];
E("playerSpawn", spawn, "spawn");
E("checkpoint", [2.5, h(2.5, spawnZ + 2) + 1, spawnZ + 2], "cp_beach");
P("gate", [0, h(0, spawnZ + 5) + 3, spawnZ + 5], [7, 6, 1.6], [0, 0, 0], [0.95, 0.85, 0.6]);
P("fence", [-5.5, h(-5.5, spawnZ + 5) + 0.8, spawnZ + 5], [4.5, 1.6, 0.3]);
P("fence", [5.5, h(5.5, spawnZ + 5) + 0.8, spawnZ + 5], [4.5, 1.6, 0.3]);

// Coin trail: beach gate → mountain peak (gentle sine weave).
const trail = (t) => {
  const x = spawn[0] + (PEAK[0] - spawn[0]) * t + Math.sin(t * Math.PI * 2.2) * 7;
  const z = (spawnZ + 7) + (PEAK[1] - (spawnZ + 7)) * t;
  return [x, z];
};
for (let i = 1; i <= 12; i++) {
  const [x, z] = trail(i / 12);
  E("coin", [x, h(x, z) + 1.3, z]);
}
{
  const [x, z] = trail(0.55);
  E("checkpoint", [x, h(x, z) + 1.2, z], "cp_mid");
}
E("checkpoint", [PEAK[0], h(PEAK[0], PEAK[1]) + 1.5, PEAK[1]], "cp_peak");

// Glide descent: an arc of coins from the peak down the south-west slope.
for (let i = 1; i <= 8; i++) {
  const t = i / 8;
  const x = PEAK[0] + (-52 - PEAK[0]) * t;
  const z = PEAK[1] + (62 - PEAK[1]) * t;
  const y = h(x, z) + 2.2 + (1 - t) * 10; // start high off the slope, land low
  E("coin", [x, y, z]);
}

// Dash bay: gap platforms over the water, running north along the east coast
// (kept inside the map window; gaps sized for dash, not plain double jump).
let coastX = 60;
for (let x = 20; x < 100; x += 0.5) {
  if (h(x, -15) < 0.6) {
    coastX = x;
    break;
  }
}
const chain = [
  [coastX + 6, -15],
  [coastX + 8, -26],
  [coastX + 6, -38],
  [coastX + 8, -51],
];
for (let i = 0; i < chain.length; i++) {
  const [x, z] = chain[i];
  P("platform", [x, 2.4, z], [3.4, 0.5, 3.4], [0, 0, 0], [0.55, 0.9, 0.85]);
  if (i > 0) E("coin", [x, 4, z]);
}
const last = chain[chain.length - 1];
P("ring", [last[0], 5.4, last[1]], [4.5, 4.5, 4.5], [Math.PI / 2, 0, 0]);
E("coin", [last[0], 5.4, last[1]]);

// Wall-jump chimney near the mid checkpoint.
{
  const [mx, mz] = trail(0.55);
  const wx = mx - 11, wz = mz + 6;
  const base = h(wx, wz);
  P("wall", [wx, base + 4.5, wz - 1.6], [5, 9, 0.6], [0, 0, 0], [0.8, 0.75, 0.7]);
  P("wall", [wx, base + 5.5, wz + 1.6], [5, 11, 0.6], [0, 0, 0], [0.8, 0.75, 0.7]);
  E("coin", [wx, base + 10.6, wz]);
  E("coin", [wx, base + 7.5, wz]);
}

// Ground-pound crates beside the trail.
{
  const [cx, cz] = trail(0.3);
  const px = cx + 9, pz = cz;
  const base = h(px, pz);
  P("platform", [px, base + 0.6, pz], [6, 0.8, 6], [0, 0, 0], [0.9, 0.7, 0.5]);
  P("crate", [px - 1.2, base + 2, pz - 1.2], [2, 2, 2]);
  P("crate", [px + 1.2, base + 2, pz + 1], [2, 2, 2]);
  P("crate", [px, base + 4, pz], [2, 2, 2]);
  E("coin", [px, base + 6.2, pz]);
}

// Crescent-ridge crystals (glowing landmarks).
P("crystal", [32, h(32, 0) + 1.2, 0], [1.6, 3.4, 1.6]);
P("crystal", [28, h(28, 34) + 1.2, 34], [1.4, 3, 1.4]);

// Nature dressing (deterministic scatter on the slopes).
const rand = rng(7);
let placed = 0;
while (placed < 26) {
  const x = -95 + rand() * 190;
  const z = -88 + rand() * 170;
  const hh = h(x, z);
  if (hh < 3.5 || hh > 17) continue;
  // keep clear of the trail corridor
  const [tx, tz] = trail(Math.min(1, Math.max(0, (z - spawnZ) / (PEAK[1] - spawnZ))));
  if (Math.hypot(x - tx, z - tz) < 9) continue;
  const kind = rand() < 0.45 ? "pine" : rand() < 0.75 ? "tree" : rand() < 0.9 ? "rock" : "bush";
  const s = 0.8 + rand() * 0.5;
  const scales = {
    pine: [3.5 * s, 8 * s, 3.5 * s],
    tree: [4 * s, 7 * s, 4 * s],
    rock: [2.5 * s, 2 * s, 2.5 * s],
    bush: [2 * s, 1.4 * s, 2 * s],
  };
  P(kind, [x, hh + (scales[kind][1] / 2) * (kind === "rock" ? 0.35 : 0.8), z], scales[kind], [0, rand() * Math.PI * 2, 0]);
  placed++;
}

// ---------- write ----------
const data = {
  meta: {
    id: "joshua-slice",
    name: "Joshua Slice — Movement Playground",
    version: 1,
    bounds: {
      min: [-SIZE_X / 2 - 5, -8, -SIZE_Z / 2 - 5],
      max: [SIZE_X / 2 + 5, Math.ceil(maxH) + 12, SIZE_Z / 2 + 5],
    },
    gravity: [0, -16, 0],
    killPlaneY: -12,
    seaLevel: 0,
    env: {
      sky: [0.4, 0.66, 0.9],
      horizon: [0.52, 0.46, 0.38],
      fogColor: [0.75, 0.85, 0.95],
      fogDensity: 0.0012,
      sunIntensity: 1.45,
      sunAzimuth: 225,
      sunElevation: 48,
      ambient: 0.6,
      waterColor: [0.1, 0.42, 0.58],
      waterOpacity: 0.62,
    },
  },
  terrain: { size: [SIZE_X, SIZE_Z], resolution: [COLS, ROWS], heights },
  prefabs,
  entities,
};

mkdirSync("assets/continents", { recursive: true });
writeFileSync("assets/continents/joshua-slice.json", JSON.stringify(data));
console.log(
  `wrote assets/continents/joshua-slice.json — ${COLS}x${ROWS}, maxHeight=${maxH.toFixed(1)}m, ` +
    `${prefabs.length} prefabs, ${entities.length} entities, spawn z=${spawnZ.toFixed(1)}, coast x=${coastX.toFixed(1)}`,
);
