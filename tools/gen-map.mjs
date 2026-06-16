// gen-map.mjs — convert the hand-drawn world sketch into a baseline
// ContinentData heightmap, polygon/coastline-based for fidelity.
// Run: `node tools/gen-map.mjs`  →  assets/continents/world.json
//
// Coastlines are traced (by eye, from the photo) as polygons in normalized
// drawing space u,v (0..1, u=left→right, v=top→bottom) then mapped to world
// X,Z. Land height comes from the signed distance to the coastline (gentle
// beaches up to a plateau); lakes are polygon holes; the mountain is a peak
// matching the concentric rings; the crescent is a raised ridge. Sea is water
// at y=0. It's a baseline to refine in-editor / by correcting these coords.

import { writeFileSync, mkdirSync } from "node:fs";

// ---- world framing ----
const WX = 300; // world width  (X), meters
const WZ = 380; // world depth  (Z), meters  (drawing is taller than wide)
const RES = 150; // grid samples per axis
const cellX = WX / (RES - 1);
const cellZ = WZ / (RES - 1);
const map = (u, v) => [(u - 0.5) * WX, (v - 0.5) * WZ];
const mapPoly = (pts) => pts.map(([u, v]) => map(u, v));

const smooth = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
function circle(cu, cv, r, n = 14) {
  const p = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    p.push([cu + Math.cos(a) * r, cv + Math.sin(a) * r * 1.25]); // v scaled (drawing aspect)
  }
  return p;
}

// ============================================================
// TRACED FEATURES (normalized u,v) — adjust these to correct the map.
// ============================================================

// Big southern continent (outer coast), wavy top + notch, oval body.
const continent = [
  [0.30, 0.585], [0.385, 0.55], [0.45, 0.565], [0.5, 0.6], [0.55, 0.56],
  [0.62, 0.55], [0.665, 0.585], [0.74, 0.63], [0.785, 0.70], [0.79, 0.78],
  [0.76, 0.865], [0.70, 0.92], [0.60, 0.95], [0.48, 0.955], [0.37, 0.94],
  [0.28, 0.89], [0.22, 0.82], [0.205, 0.74], [0.215, 0.655], [0.255, 0.605],
];

// NW large landmass (irregular) + a couple of internal lakes.
const nwLand = [
  [0.10, 0.225], [0.165, 0.19], [0.225, 0.21], [0.265, 0.25], [0.275, 0.31],
  [0.245, 0.355], [0.265, 0.40], [0.22, 0.445], [0.16, 0.45], [0.105, 0.42],
  [0.075, 0.37], [0.06, 0.31], [0.075, 0.25],
];
const nwLakes = [circle(0.15, 0.30, 0.022), circle(0.205, 0.345, 0.018)];

// Upper-middle landmass with a lake.
const midLand = [
  [0.33, 0.245], [0.40, 0.21], [0.46, 0.23], [0.495, 0.28], [0.50, 0.34],
  [0.47, 0.39], [0.42, 0.42], [0.36, 0.41], [0.32, 0.37], [0.31, 0.30],
];
const midLakes = [circle(0.40, 0.31, 0.028)];

// Central-top landmass + an up-right reaching arm.
const centerLand = [
  [0.50, 0.275], [0.535, 0.225], [0.575, 0.225], [0.62, 0.20], [0.665, 0.225],
  [0.645, 0.27], [0.59, 0.275], [0.56, 0.32], [0.515, 0.31],
];

// Lone NE island (+ a tiny cap, like the drawing).
const neIsland = circle(0.88, 0.305, 0.03);
const neCap = circle(0.88, 0.255, 0.01);

// Scattered small islands (archipelago): [u, v, radius]
const dots = [
  [0.05, 0.33, 0.012], [0.045, 0.37, 0.014], [0.062, 0.405, 0.011], [0.05, 0.435, 0.013],
  [0.085, 0.45, 0.012], [0.105, 0.415, 0.010], [0.095, 0.375, 0.011], [0.115, 0.34, 0.012],
  [0.135, 0.315, 0.010], [0.31, 0.46, 0.016], [0.285, 0.50, 0.013], [0.35, 0.515, 0.018],
  [0.40, 0.545, 0.020], [0.335, 0.475, 0.012], [0.44, 0.50, 0.014], [0.39, 0.465, 0.010],
  [0.46, 0.44, 0.010], [0.50, 0.46, 0.011], [0.43, 0.43, 0.009],
];

// Mountain (the concentric rings) — center + outer radius (in u) + height.
const peak = { uv: [0.45, 0.78], r: 0.13, H: 28 };
// Crescent ridge to the right of the peak (polyline) + amp.
const crescent = { line: [[0.60, 0.74], [0.635, 0.785], [0.628, 0.835], [0.59, 0.87]], amp: 11, width: 7 };

// ============================================================
// Build land features (polygon + holes + plateau height + beach width)
// ============================================================
const features = [
  { poly: mapPoly(continent), holes: [], plateau: 8, beach: 9 },
  { poly: mapPoly(nwLand), holes: nwLakes.map(mapPoly), plateau: 7, beach: 7 },
  { poly: mapPoly(midLand), holes: midLakes.map(mapPoly), plateau: 6.5, beach: 6 },
  { poly: mapPoly(centerLand), holes: [], plateau: 6, beach: 6 },
  { poly: mapPoly(neIsland), holes: [], plateau: 5, beach: 5 },
  { poly: mapPoly(neCap), holes: [], plateau: 4, beach: 3 },
  ...dots.map(([u, v, r]) => ({ poly: mapPoly(circle(u, v, r, 10)), holes: [], plateau: 4, beach: 4 })),
];

const peakC = map(peak.uv[0], peak.uv[1]);
const peakR = peak.r * WX;
const crescentLine = mapPoly(crescent.line);

// ---- geometry helpers ----
function inPoly(x, z, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i];
    const [xj, zj] = poly[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}
function distSeg(x, z, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az;
  const l2 = dx * dx + dz * dz || 1;
  let t = ((x - ax) * dx + (z - az) * dz) / l2;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const px = ax + t * dx, pz = az + t * dz;
  return Math.hypot(x - px, z - pz);
}
function distToRing(x, z, poly) {
  let m = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const d = distSeg(x, z, poly[j][0], poly[j][1], poly[i][0], poly[i][1]);
    if (d < m) m = d;
  }
  return m;
}
function distToPolyline(x, z, line) {
  let m = Infinity;
  for (let i = 1; i < line.length; i++) {
    const d = distSeg(x, z, line[i - 1][0], line[i - 1][1], line[i][0], line[i][1]);
    if (d < m) m = d;
  }
  return m;
}

// For a point, find the land feature it's inside (respecting holes) and the
// signed distance to that feature's coastline; or the nearest coast if at sea.
function landHeight(x, z) {
  let best = null; // { plateau, beach, inDist }
  let nearestCoast = Infinity;
  for (const f of features) {
    let dEdge = distToRing(x, z, f.poly);
    for (const h of f.holes) dEdge = Math.min(dEdge, distToRing(x, z, h));
    nearestCoast = Math.min(nearestCoast, dEdge);
    let inside = inPoly(x, z, f.poly);
    if (inside) for (const h of f.holes) if (inPoly(x, z, h)) inside = false;
    if (inside) {
      const cand = { plateau: f.plateau, beach: f.beach, inDist: dEdge };
      if (!best || cand.inDist > best.inDist) best = cand; // pick deepest-inland
    }
  }
  if (best) {
    return best.plateau * smooth(best.inDist / best.beach);
  }
  // sea: gentle slope down away from any coast, floored
  return Math.max(-4, -0.4 - nearestCoast * 0.06);
}

// ---- rasterize ----
const heights = [];
let maxH = -Infinity;
for (let r = 0; r < RES; r++) {
  const z = -WZ / 2 + r * cellZ;
  for (let c = 0; c < RES; c++) {
    const x = -WX / 2 + c * cellX;
    let h = landHeight(x, z);
    // mountain (only meaningful where there is land under it)
    if (h > 1) {
      const dm = Math.hypot(x - peakC[0], z - peakC[1]);
      h += peak.H * smooth(1 - dm / peakR);
      // crescent ridge
      const dc = distToPolyline(x, z, crescentLine);
      if (dc < crescent.width) h += crescent.amp * smooth(1 - dc / crescent.width);
    }
    h = Math.round(h * 100) / 100;
    if (h > maxH) maxH = h;
    heights.push(h);
  }
}

const HX = WX / 2, HZ = WZ / 2;
const data = {
  meta: {
    id: "world",
    name: "Hand-drawn World",
    version: 1,
    bounds: { min: [-HX - 5, -8, -HZ - 5], max: [HX + 5, Math.ceil(maxH) + 10, HZ + 5] },
    gravity: [0, -16, 0],
    killPlaneY: -25,
    seaLevel: 0,
  },
  terrain: { size: [WX, WZ], resolution: [RES, RES], heights },
  prefabs: [],
  entities: [
    { id: "spawn", type: "playerSpawn", pos: [...spawnXY(0.5, 0.7)] },
    { id: "cp_peak", type: "checkpoint", pos: [peakC[0], peak.H + 2, peakC[1]] },
    { id: "c_nw", type: "coin", pos: [...spawnXY(0.16, 0.31)] },
    { id: "c_mid", type: "coin", pos: [...spawnXY(0.42, 0.3)] },
    { id: "c_ne", type: "coin", pos: [...spawnXY(0.88, 0.305)] },
    { id: "c_south", type: "coin", pos: [...spawnXY(0.6, 0.85)] },
  ],
};

function spawnXY(u, v) {
  const [x, z] = map(u, v);
  return [Math.round(x), 16, Math.round(z)];
}

mkdirSync("assets/continents", { recursive: true });
writeFileSync("assets/continents/world.json", JSON.stringify(data));
console.log(`wrote assets/continents/world.json — ${RES}x${RES}, maxHeight=${maxH.toFixed(1)}m, ${features.length} land features`);
