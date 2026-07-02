// maplib — the hand-drawn world's traced geography as a reusable height field.
//
// Shared by gen-map.mjs (the full world) and gen-slice.mjs (the southern-
// continent movement playground) so both always agree. Coastlines are traced
// polygons in normalized drawing space u,v (0..1, u=left→right, v=top→bottom)
// mapped to world X,Z; land height = signed distance to the coast (beach →
// plateau), lakes are holes, plus the central peak and crescent ridge.

// ---- world framing ----
export const WX = 300; // world width  (X), meters
export const WZ = 380; // world depth  (Z), meters
export const map = (u, v) => [(u - 0.5) * WX, (v - 0.5) * WZ];
const mapPoly = (pts) => pts.map(([u, v]) => map(u, v));

export const smooth = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
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
export const peak = { uv: [0.45, 0.78], r: 0.13, H: 28 };
// Crescent ridge to the right of the peak (polyline) + amp.
const crescent = { line: [[0.60, 0.74], [0.635, 0.785], [0.628, 0.835], [0.59, 0.87]], amp: 11, width: 7 };

// ============================================================
// Land features (polygon + holes + plateau height + beach width)
// ============================================================
export const features = [
  { poly: mapPoly(continent), holes: [], plateau: 8, beach: 9 },
  { poly: mapPoly(nwLand), holes: nwLakes.map(mapPoly), plateau: 7, beach: 7 },
  { poly: mapPoly(midLand), holes: midLakes.map(mapPoly), plateau: 6.5, beach: 6 },
  { poly: mapPoly(centerLand), holes: [], plateau: 6, beach: 6 },
  { poly: mapPoly(neIsland), holes: [], plateau: 5, beach: 5 },
  { poly: mapPoly(neCap), holes: [], plateau: 4, beach: 3 },
  ...dots.map(([u, v, r]) => ({ poly: mapPoly(circle(u, v, r, 10)), holes: [], plateau: 4, beach: 4 })),
];

export const peakC = map(peak.uv[0], peak.uv[1]);
export const peakR = peak.r * WX;
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

/** Land height without the mountain/ridge (or gentle sea-floor slope). */
function landHeight(x, z) {
  let best = null;
  let nearestCoast = Infinity;
  for (const f of features) {
    let dEdge = distToRing(x, z, f.poly);
    for (const h of f.holes) dEdge = Math.min(dEdge, distToRing(x, z, h));
    nearestCoast = Math.min(nearestCoast, dEdge);
    let inside = inPoly(x, z, f.poly);
    if (inside) for (const h of f.holes) if (inPoly(x, z, h)) inside = false;
    if (inside) {
      const cand = { plateau: f.plateau, beach: f.beach, inDist: dEdge };
      if (!best || cand.inDist > best.inDist) best = cand;
    }
  }
  if (best) return best.plateau * smooth(best.inDist / best.beach);
  return Math.max(-4, -0.4 - nearestCoast * 0.06);
}

/** Full world height at (x,z): land + mountain + crescent ridge. */
export function worldHeight(x, z) {
  let h = landHeight(x, z);
  if (h > 1) {
    const dm = Math.hypot(x - peakC[0], z - peakC[1]);
    h += peak.H * smooth(1 - dm / peakR);
    const dc = distToPolyline(x, z, crescentLine);
    if (dc < crescent.width) h += crescent.amp * smooth(1 - dc / crescent.width);
  }
  return Math.round(h * 100) / 100;
}

/** Rasterize worldHeight over a window (centered coords via offset). */
export function rasterize({ x0, z0, sizeX, sizeZ, cols, rows }) {
  const heights = [];
  let maxH = -Infinity;
  for (let r = 0; r < rows; r++) {
    const z = z0 + (r / (rows - 1)) * sizeZ;
    for (let c = 0; c < cols; c++) {
      const x = x0 + (c / (cols - 1)) * sizeX;
      const h = worldHeight(x, z);
      if (h > maxH) maxH = h;
      heights.push(h);
    }
  }
  return { heights, maxH };
}

/** Deterministic RNG (mulberry32) for scatter placement. */
export function rng(seed = 0x9e3779b9) {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
