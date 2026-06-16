// gen-map.mjs — convert the hand-drawn world sketch into a baseline
// ContinentData heightmap. Deterministic; run: `node tools/gen-map.mjs`.
//
// Land is encoded as raised regions of the height grid (sea = flat ~0). Shapes
// are analytic "bumps" (flat-topped islands with sloped coasts) approximating
// the photo: an archipelago + large landmass (NW), a lone island (NE), and a
// big round continent (S) with a central mountain and a crescent ridge.
// It's a baseline — load it and refine with the editor's sculpt brush.

import { writeFileSync, mkdirSync } from "node:fs";

const SIZE = 220; // world extent (m) on X and Z
const RES = 110; // grid samples per axis
const HALF = SIZE / 2;
const cell = SIZE / (RES - 1);

// deterministic RNG (mulberry32)
let _s = 0x9e3779b9;
const rnd = () => {
  _s |= 0;
  _s = (_s + 0x6d2b79f5) | 0;
  let t = Math.imul(_s ^ (_s >>> 15), 1 | _s);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const smooth = (t) => t * t * (3 - 2 * t);

// flat-topped bump with a sloped rim of width `edge`
function bump(d, r, edge, amp) {
  if (d >= r) return 0;
  if (d <= r - edge) return amp;
  return amp * smooth((r - d) / edge);
}

// --- land seeds (world coords; +X east, +Z south) ---
// big round continent (south) with lobes
const land = [
  { x: 0, z: 55, r: 58, edge: 18, amp: 7 },
  { x: -30, z: 50, r: 25, edge: 12, amp: 6 },
  { x: 35, z: 52, r: 28, edge: 12, amp: 6 },
  { x: 0, z: 82, r: 24, edge: 14, amp: 6 },
  { x: 0, z: 30, r: 22, edge: 12, amp: 6 },
  // archipelago / large landmass (northwest)
  { x: -55, z: -48, r: 30, edge: 14, amp: 7 },
  { x: -38, z: -56, r: 18, edge: 10, amp: 6 },
  { x: -70, z: -34, r: 16, edge: 10, amp: 6 },
  { x: -48, z: -28, r: 14, edge: 8, amp: 5 },
  // lone island (northeast)
  { x: 78, z: -42, r: 9, edge: 4, amp: 5 },
];

// scattered small islands around the archipelago
for (let i = 0; i < 18; i++) {
  land.push({
    x: -92 + rnd() * 66,
    z: -86 + rnd() * 72,
    r: 3 + rnd() * 4,
    edge: 2 + rnd() * 2,
    amp: 3.5 + rnd() * 1.5,
  });
}

// crescent ridge on the right of the big continent
const ridge = [
  { x: 28, z: 40, r: 9, edge: 4, amp: 9 },
  { x: 31, z: 48, r: 9, edge: 4, amp: 10 },
  { x: 31, z: 57, r: 9, edge: 4, amp: 10 },
  { x: 27, z: 65, r: 8, edge: 4, amp: 9 },
];

// central mountain (the concentric contour rings) — a tall gaussian peak
const peak = { x: -8, z: 48, amp: 24, sigma: 11 };

function heightAt(x, z) {
  let landField = 0;
  for (const s of land) landField = Math.max(landField, bump(Math.hypot(x - s.x, z - s.z), s.r, s.edge, s.amp));
  let extra = 0;
  for (const s of ridge) extra += bump(Math.hypot(x - s.x, z - s.z), s.r, s.edge, s.amp);
  // mountain only contributes where there is continent under it
  if (landField > 0.5) {
    const d = Math.hypot(x - peak.x, z - peak.z);
    extra += peak.amp * Math.exp(-(d * d) / (2 * peak.sigma * peak.sigma));
  }
  const h = landField + extra - 0.6; // sea floor ~ -0.6
  return Math.round(Math.max(-2, h) * 100) / 100;
}

const heights = [];
for (let r = 0; r < RES; r++) {
  const z = -HALF + r * cell;
  for (let c = 0; c < RES; c++) {
    const x = -HALF + c * cell;
    heights.push(heightAt(x, z));
  }
}

let maxH = -Infinity;
for (const h of heights) if (h > maxH) maxH = h;

const data = {
  meta: {
    id: "world",
    name: "Hand-drawn World",
    version: 1,
    bounds: { min: [-HALF - 5, -10, -HALF - 5], max: [HALF + 5, Math.ceil(maxH) + 10, HALF + 5] },
    gravity: [0, -16, 0],
    killPlaneY: -30,
  },
  terrain: { size: [SIZE, SIZE], resolution: [RES, RES], heights },
  prefabs: [],
  entities: [
    { id: "spawn", type: "playerSpawn", pos: [10, 22, 55] },
    { id: "cp_peak", type: "checkpoint", pos: [peak.x, 30, peak.z] },
    { id: "c_arch", type: "coin", pos: [-55, 14, -48] },
    { id: "c_isle", type: "coin", pos: [78, 12, -42] },
    { id: "c_south", type: "coin", pos: [0, 14, 82] },
    { id: "c_ridge", type: "coin", pos: [30, 18, 52] },
  ],
};

mkdirSync("assets/continents", { recursive: true });
writeFileSync("assets/continents/world.json", JSON.stringify(data));
console.log(`wrote assets/continents/world.json — ${RES}x${RES} grid, maxHeight=${maxH.toFixed(1)}m`);
