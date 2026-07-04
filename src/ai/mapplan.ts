// MapPlan — the vector language Claude speaks when it reads a drawn map.
//
// Rather than asking the model to emit a raw ContinentData (a 20k-sample
// height grid would be slow, expensive, and lumpy), image import goes:
//
//   drawing → Claude → MapPlan (coastlines, peaks, ridges, valleys, paths,
//   scatters, placements, markers in normalized drawing coords)
//   → compileMapPlan() → ContinentData (deterministic rasterization here)
//
// The compiler is a browser port of tools/maplib.mjs's math: land height =
// signed distance to the traced coast (beach → plateau), lakes are holes,
// peaks/ridges add, valleys carve, paths grade the terrain into walkable
// trails. Every number is clamped, every count capped — a wild plan can make
// an ugly level, never a broken one. Same trust boundary as ai/ops.ts.

import type { ContinentData, EnvSettings, PaletteStop, PrefabInstance, EntityInstance, Vec3 } from "../world/schema";
import { DEFAULT_PALETTE, SCHEMA_VERSION } from "../world/schema";
import { allPrefabs, getPrefab } from "../world/prefabs";
import { SKINS } from "../world/skins";

export type UV = [number, number];

export interface MapPlan {
  name: string;
  sizeX: number;
  sizeZ: number;
  theme: "day" | "sunset" | "night" | "alien" | "snow" | "desert";
  seaLevel: number | null;
  landmasses: Array<{ outline: UV[]; plateau: number; beach: number; lakes?: UV[][] }>;
  peaks: Array<{ at: UV; radius: number; height: number }>;
  ridges: Array<{ line: UV[]; height: number; width: number }>;
  valleys: Array<{ line: UV[]; depth: number; width: number }>;
  paths: Array<{ line: UV[]; width?: number }>;
  scatters: Array<{ prefab: string; region: UV[]; count: number; tint?: number[]; skin?: string }>;
  placements: Array<{ prefab: string; at: UV; yawDeg?: number; scale?: number[]; tint?: number[]; skin?: string }>;
  markers: Array<{ type: "playerSpawn" | "coin" | "checkpoint" | "enemy"; at: UV }>;
  coinTrails: Array<{ line: UV[]; count: number }>;
  notes: string;
}

// ---------- JSON Schema (structured outputs) ----------

const uv = { type: "array", items: { type: "number" }, minItems: 2, maxItems: 2, description: "[u,v] in 0..1 drawing coords" };
const uvLine = { type: "array", items: uv, minItems: 2, description: "polyline of [u,v] points" };
const uvPoly = { type: "array", items: uv, minItems: 3, description: "polygon of [u,v] points (not closed)" };
const rgb = { type: "array", items: { type: "number" }, minItems: 3, maxItems: 3, description: "RGB 0..1" };

export const MAP_PLAN_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "name", "sizeX", "sizeZ", "theme", "seaLevel", "landmasses", "peaks", "ridges",
    "valleys", "paths", "scatters", "placements", "markers", "coinTrails", "notes",
  ],
  properties: {
    name: { type: "string" },
    sizeX: { type: "number", description: "world width in meters (1800-3200 typical — crossing the whole world on foot should take ~5 minutes)" },
    sizeZ: { type: "number", description: "world depth in meters (1800-3200 typical)" },
    theme: { type: "string", enum: ["day", "sunset", "night", "alien", "snow", "desert"] },
    seaLevel: {
      type: ["number", "null"],
      description: "water plane height in meters (~0.3 when coastlines/ocean are drawn); null = no ocean",
    },
    landmasses: {
      type: "array",
      description: "Every landmass/island as a traced coastline polygon. Trace generously: 10-24 points for big shapes.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["outline", "plateau", "beach"],
        properties: {
          outline: uvPoly,
          plateau: { type: "number", description: "interior height in meters (6-14 typical)" },
          beach: { type: "number", description: "meters of coastal ramp from waterline to plateau (20-60 at world scale)" },
          lakes: { type: "array", items: uvPoly, description: "interior water holes" },
        },
      },
    },
    peaks: {
      type: "array",
      description: "Mountains (concentric rings / triangle symbols / shading in the drawing).",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["at", "radius", "height"],
        properties: {
          at: uv,
          radius: { type: "number", description: "in u units, 0.03-0.25" },
          height: { type: "number", description: "meters above the plateau, 40-120 (real mountains at world scale)" },
        },
      },
    },
    ridges: {
      type: "array",
      description: "Elongated raised spines (mountain chains, crescents).",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["line", "height", "width"],
        properties: {
          line: uvLine,
          height: { type: "number", description: "meters, 10-60" },
          width: { type: "number", description: "meters, 25-140" },
        },
      },
    },
    valleys: {
      type: "array",
      description: "Carved channels — rivers, canyons, gorges. Carving below sea level makes real water rivers.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["line", "depth", "width"],
        properties: {
          line: uvLine,
          depth: { type: "number", description: "meters, 6-30" },
          width: { type: "number", description: "meters, 20-120" },
        },
      },
    },
    paths: {
      type: "array",
      description: "Walking trails (dashed/drawn paths) — the terrain is graded smooth and walkable along them.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["line"],
        properties: { line: uvLine, width: { type: "number", description: "meters, 8-24 (default 14)" } },
      },
    },
    scatters: {
      type: "array",
      description: "Natural fills over a region: forests (tree/pine), rock fields, bushes, crystal groves.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["prefab", "region", "count"],
        properties: {
          prefab: { type: "string", enum: allPrefabs().map((p) => p.key) },
          region: uvPoly,
          count: { type: "integer", description: "1-220 (a real forest is 80-200 trees)" },
          tint: rgb,
          skin: { type: "string", enum: [...SKINS] },
        },
      },
    },
    placements: {
      type: "array",
      description: "Individually placed structures/props/gameplay pieces (buildings from blocks, bridges, springs, boosts, goals...).",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["prefab", "at"],
        properties: {
          prefab: { type: "string", enum: allPrefabs().map((p) => p.key) },
          at: uv,
          yawDeg: { type: "number" },
          scale: { type: "array", items: { type: "number" }, minItems: 3, maxItems: 3 },
          tint: rgb,
          skin: { type: "string", enum: [...SKINS] },
        },
      },
    },
    markers: {
      type: "array",
      description: "Gameplay markers. EXACTLY ONE playerSpawn. Add checkpoints along the route and enemies where fights read well.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["type", "at"],
        properties: {
          type: { type: "string", enum: ["playerSpawn", "coin", "checkpoint", "enemy"] },
          at: uv,
        },
      },
    },
    coinTrails: {
      type: "array",
      description: "Evenly spaced coin lines along routes (breadcrumbs the player follows).",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["line", "count"],
        properties: { line: uvLine, count: { type: "integer", description: "3-80 (long routes deserve 30-60)" } },
      },
    },
    notes: { type: "string", description: "One or two sentences: how you read the drawing (mention labels you honored)." },
  },
} as const;

// ---------- theme presets ----------

const THEMES: Record<MapPlan["theme"], { env: EnvSettings; palette?: PaletteStop[] }> = {
  day: { env: {} },
  sunset: {
    env: { sky: [0.72, 0.38, 0.24], horizon: [0.5, 0.28, 0.22], fogColor: [0.85, 0.55, 0.38], fogDensity: 0.0022, sunColor: [1, 0.68, 0.42], sunIntensity: 1.15, sunAzimuth: 265, sunElevation: 12, ambient: 0.42, waterColor: [0.22, 0.28, 0.48], waterOpacity: 0.7 },
  },
  night: {
    env: { sky: [0.02, 0.03, 0.08], horizon: [0.05, 0.06, 0.12], fogColor: [0.04, 0.07, 0.16], fogDensity: 0.0035, sunColor: [0.6, 0.7, 1], sunIntensity: 0.35, sunAzimuth: 40, sunElevation: 35, ambient: 0.25, waterColor: [0.03, 0.1, 0.22], waterOpacity: 0.75 },
  },
  alien: {
    env: { sky: [0.14, 0.05, 0.2], horizon: [0.2, 0.08, 0.25], fogColor: [0.45, 0.18, 0.55], fogDensity: 0.004, sunColor: [0.9, 0.55, 1], sunIntensity: 1.1, sunAzimuth: 120, sunElevation: 40, ambient: 0.5, waterColor: [0.45, 0.12, 0.42], waterOpacity: 0.6 },
    palette: [
      { h: 0.4, color: [0.35, 0.2, 0.4] },
      { h: 3, color: [0.3, 0.4, 0.55] },
      { h: 12, color: [0.5, 0.25, 0.6] },
      { h: 22, color: [0.3, 0.2, 0.35] },
      { h: 30, color: [0.85, 0.75, 0.95] },
    ],
  },
  snow: {
    env: { sky: [0.62, 0.7, 0.8], horizon: [0.5, 0.55, 0.62], fogColor: [0.78, 0.82, 0.9], fogDensity: 0.003, sunColor: [1, 0.98, 0.95], sunIntensity: 1.1, sunAzimuth: 220, sunElevation: 30, ambient: 0.65, waterColor: [0.16, 0.3, 0.42], waterOpacity: 0.7 },
    palette: [
      { h: 0.4, color: [0.75, 0.78, 0.8] },
      { h: 2, color: [0.85, 0.88, 0.9] },
      { h: 8, color: [0.93, 0.94, 0.97] },
      { h: 18, color: [0.8, 0.83, 0.9] },
      { h: 26, color: [1, 1, 1] },
    ],
  },
  desert: {
    env: { sky: [0.62, 0.5, 0.32], horizon: [0.55, 0.42, 0.28], fogColor: [0.8, 0.66, 0.45], fogDensity: 0.0016, sunColor: [1, 0.9, 0.7], sunIntensity: 1.5, sunAzimuth: 250, sunElevation: 48, ambient: 0.5, waterColor: [0.14, 0.4, 0.45], waterOpacity: 0.6 },
    palette: [
      { h: 0.4, color: [0.85, 0.74, 0.5] },
      { h: 3, color: [0.8, 0.64, 0.42] },
      { h: 10, color: [0.7, 0.5, 0.34] },
      { h: 18, color: [0.55, 0.38, 0.28] },
      { h: 26, color: [0.9, 0.82, 0.7] },
    ],
  },
};

// ---------- geometry (ported from tools/maplib.mjs) ----------

const smooth = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

function inPoly(x: number, z: number, poly: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i];
    const [xj, zj] = poly[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

function distSeg(x: number, z: number, ax: number, az: number, bx: number, bz: number): { d: number; t: number } {
  const dx = bx - ax, dz = bz - az;
  const l2 = dx * dx + dz * dz || 1;
  let t = ((x - ax) * dx + (z - az) * dz) / l2;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return { d: Math.hypot(x - (ax + t * dx), z - (az + t * dz)), t };
}

function distToRing(x: number, z: number, poly: number[][]): number {
  let m = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const { d } = distSeg(x, z, poly[j][0], poly[j][1], poly[i][0], poly[i][1]);
    if (d < m) m = d;
  }
  return m;
}

/** Deterministic RNG (mulberry32) so the same plan compiles to the same map. */
function rng(seed: number) {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp = (v: unknown, lo: number, hi: number, d: number): number => {
  const n = typeof v === "number" && isFinite(v) ? v : d;
  return Math.min(hi, Math.max(lo, n));
};

// ---------- the compiler ----------

// Perf guardrails for one continent. Worlds are journey-scale (~5 minutes to
// cross on foot ≈ 2-3 km), so the caps are generous; distance culling keeps
// the per-frame cost bounded in play.
const MAX_PREFABS = 1300;
const MAX_ENTITIES = 500;

export interface CompiledMap {
  data: ContinentData;
  log: string[];
}

export function compileMapPlan(raw: MapPlan): CompiledMap {
  const log: string[] = [];
  const W = clamp(raw.sizeX, 240, 3600, 2400);
  const D = clamp(raw.sizeZ, 240, 3600, 2400);
  const sea = raw.seaLevel === null || raw.seaLevel === undefined ? undefined : clamp(raw.seaLevel, -6, 6, 0.3);
  const theme = THEMES[raw.theme] ? raw.theme : "day";

  const toXZ = ([u, v]: UV): [number, number] => [
    (clamp(u, -0.2, 1.2, 0.5) - 0.5) * W,
    (clamp(v, -0.2, 1.2, 0.5) - 0.5) * D,
  ];
  const mapPoly = (pts: UV[]) => (Array.isArray(pts) ? pts.filter((p) => Array.isArray(p) && p.length >= 2).map(toXZ) : []);

  // --- features in world space, clamped ---
  const lands = (raw.landmasses ?? [])
    .map((l) => ({
      poly: mapPoly(l.outline),
      holes: (l.lakes ?? []).map(mapPoly).filter((h) => h.length >= 3),
      plateau: clamp(l.plateau, 1.5, 30, 9),
      beach: clamp(l.beach, 2, 120, 35),
    }))
    .filter((l) => l.poly.length >= 3);
  if (!lands.length) {
    // a plan with no coastlines = one big ground slab covering the canvas
    lands.push({
      poly: [[-W / 2, -D / 2], [W / 2, -D / 2], [W / 2, D / 2], [-W / 2, D / 2]],
      holes: [],
      plateau: 4,
      beach: 10,
    });
    log.push("no landmasses in the plan — filled the canvas with ground");
  }
  const peaks = (raw.peaks ?? []).slice(0, 16).map((p) => ({
    c: toXZ(p.at ?? [0.5, 0.5]),
    r: clamp(p.radius, 0.02, 0.3, 0.1) * W,
    H: clamp(p.height, 3, 140, 60),
  }));
  const ridges = (raw.ridges ?? []).slice(0, 18).map((r) => ({
    line: mapPoly(r.line),
    amp: clamp(r.height, 2, 70, 24),
    width: clamp(r.width, 3, 160, 50),
  })).filter((r) => r.line.length >= 2);
  const valleys = (raw.valleys ?? []).slice(0, 18).map((v) => ({
    line: mapPoly(v.line),
    depth: clamp(v.depth, 1, 40, 10),
    width: clamp(v.width, 3, 200, 45),
  })).filter((v) => v.line.length >= 2);
  const paths = (raw.paths ?? []).slice(0, 16).map((p) => ({
    line: mapPoly(p.line),
    width: clamp(p.width, 3, 40, 14),
  })).filter((p) => p.line.length >= 2);

  // --- height field ---
  const seaFloor = (nearestCoast: number) => Math.max(-5, -0.4 - nearestCoast * 0.06);
  const landHeight = (x: number, z: number): number => {
    let best: { plateau: number; beach: number; inDist: number } | null = null;
    let nearestCoast = Infinity;
    for (const f of lands) {
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
    return sea !== undefined ? seaFloor(nearestCoast) : Math.max(-1.2, -0.15 - nearestCoast * 0.02);
  };
  const distToLine = (x: number, z: number, line: number[][]): { d: number; seg: number; t: number } => {
    let m = { d: Infinity, seg: 0, t: 0 };
    for (let i = 1; i < line.length; i++) {
      const { d, t } = distSeg(x, z, line[i - 1][0], line[i - 1][1], line[i][0], line[i][1]);
      if (d < m.d) m = { d, seg: i, t };
    }
    return m;
  };
  const heightAt = (x: number, z: number): number => {
    let h = landHeight(x, z);
    if (h > 0.35) {
      for (const p of peaks) {
        const d = Math.hypot(x - p.c[0], z - p.c[1]);
        if (d < p.r) h += p.H * smooth(1 - d / p.r);
      }
      for (const r of ridges) {
        const { d } = distToLine(x, z, r.line);
        if (d < r.width) h += r.amp * smooth(1 - d / r.width);
      }
    }
    for (const v of valleys) {
      const { d } = distToLine(x, z, v.line);
      if (d < v.width) h -= v.depth * smooth(1 - d / v.width);
    }
    return h;
  };

  // Adaptive terrain detail: fine 2.2 m cells for small stages, up to 257
  // samples per axis for journey-scale worlds (a 3 km continent gets ~12 m
  // cells — macro relief from terrain, platforming detail from prefabs).
  // 257² caps the heightmap at ~66k samples: fast to rasterize, light to
  // serialize, fine for the Havok mesh collider.
  const cols = Math.round(clamp(W / 2.2, 41, 257, 121));
  const rows = Math.round(clamp(D / 2.2, 41, 257, 121));
  const heights = new Array<number>(cols * rows);
  let maxH = -Infinity;
  let minH = Infinity;
  for (let r = 0; r < rows; r++) {
    const z = -D / 2 + (r / (rows - 1)) * D;
    for (let c = 0; c < cols; c++) {
      const x = -W / 2 + (c / (cols - 1)) * W;
      const h = heightAt(x, z);
      heights[r * cols + c] = h;
    }
  }

  // paths: grade the terrain along each trail so it's smooth and walkable —
  // each cell near a path blends toward the height interpolated between the
  // path's vertex heights (sampled from the pre-path grid).
  const sample = (x: number, z: number): number => {
    const u = Math.min(Math.max(((x + W / 2) / W) * (cols - 1), 0), cols - 1);
    const v = Math.min(Math.max(((z + D / 2) / D) * (rows - 1), 0), rows - 1);
    const c0 = Math.floor(u), r0 = Math.floor(v);
    const c1 = Math.min(cols - 1, c0 + 1), r1 = Math.min(rows - 1, r0 + 1);
    const fu = u - c0, fv = v - r0;
    return (
      heights[r0 * cols + c0] * (1 - fu) * (1 - fv) +
      heights[r0 * cols + c1] * fu * (1 - fv) +
      heights[r1 * cols + c0] * (1 - fu) * fv +
      heights[r1 * cols + c1] * fu * fv
    );
  };
  for (const p of paths) {
    const vh = p.line.map(([x, z]) => sample(x, z));
    for (let r = 0; r < rows; r++) {
      const z = -D / 2 + (r / (rows - 1)) * D;
      for (let c = 0; c < cols; c++) {
        const x = -W / 2 + (c / (cols - 1)) * W;
        const { d, seg, t } = distToLine(x, z, p.line);
        if (d > p.width) continue;
        const target = vh[seg - 1] + (vh[seg] - vh[seg - 1]) * t;
        const f = smooth(1 - d / p.width) * 0.7;
        const i = r * cols + c;
        heights[i] += (target - heights[i]) * f;
      }
    }
  }
  for (let i = 0; i < heights.length; i++) {
    heights[i] = Math.round(heights[i] * 100) / 100;
    if (heights[i] > maxH) maxH = heights[i];
    if (heights[i] < minH) minH = heights[i];
  }

  // --- prefabs & entities ---
  const prefabs: PrefabInstance[] = [];
  const entities: EntityInstance[] = [];
  let nid = 0;
  const id = (p: string) => `${p}${(nid++).toString(36)}`;
  const groundAt = sample;
  const skinOf = (s: unknown): string | undefined =>
    typeof s === "string" && (SKINS as readonly string[]).includes(s) && s !== "default" ? s : undefined;
  const tintOf = (t: unknown): Vec3 | undefined =>
    Array.isArray(t) && t.length >= 3 ? [clamp(t[0], 0, 1, 1), clamp(t[1], 0, 1, 1), clamp(t[2], 0, 1, 1)] : undefined;

  const addPrefab = (
    key: string, x: number, z: number, yaw: number, scale: Vec3, tint?: Vec3, skin?: string,
  ): boolean => {
    const def = getPrefab(key);
    if (!def || prefabs.length >= MAX_PREFABS) return false;
    const y = groundAt(x, z) + scale[1] / 2; // same anchor convention as ai/ops.ts
    prefabs.push({
      id: id("mp"),
      prefab: def.key,
      pos: [Math.round(x * 100) / 100, Math.round(y * 100) / 100, Math.round(z * 100) / 100],
      rot: [0, yaw, 0],
      scale,
      ...(tint ? { tint } : {}),
      ...(skin ? { skin } : {}),
    });
    return true;
  };

  // individual placements first (they matter most if the cap bites)
  for (const pl of (raw.placements ?? []).slice(0, 400)) {
    const def = getPrefab(pl.prefab ?? "");
    if (!def) continue;
    const [x, z] = toXZ(pl.at ?? [0.5, 0.5]);
    const ds = def.defaultScale as Vec3;
    const scale: Vec3 = Array.isArray(pl.scale)
      ? [clamp(pl.scale[0], 0.1, 60, ds[0]), clamp(pl.scale[1], 0.1, 60, ds[1]), clamp(pl.scale[2], 0.1, 60, ds[2])]
      : [...ds];
    addPrefab(def.key, x, z, ((clamp(pl.yawDeg, -360, 360, 0) * Math.PI) / 180), scale, tintOf(pl.tint), skinOf(pl.skin));
  }

  // scatters: seeded rejection sampling inside each region, land-only
  const rand = rng(0x5eedf00d);
  for (const sc of (raw.scatters ?? []).slice(0, 40)) {
    const def = getPrefab(sc.prefab ?? "");
    const region = mapPoly(sc.region);
    if (!def || region.length < 3) continue;
    const xs = region.map((p) => p[0]);
    const zs = region.map((p) => p[1]);
    const bx0 = Math.min(...xs), bx1 = Math.max(...xs);
    const bz0 = Math.min(...zs), bz1 = Math.max(...zs);
    const want = Math.round(clamp(sc.count, 1, 220, 40));
    const tint = tintOf(sc.tint);
    const skin = skinOf(sc.skin);
    let placed = 0;
    for (let tries = 0; tries < want * 12 && placed < want; tries++) {
      const x = bx0 + rand() * (bx1 - bx0);
      const z = bz0 + rand() * (bz1 - bz0);
      if (!inPoly(x, z, region)) continue;
      const h = groundAt(x, z);
      if (sea !== undefined && h < sea + 0.25) continue; // not in the water
      const ds = def.defaultScale as Vec3;
      const j = 0.75 + rand() * 0.6; // natural size jitter
      if (!addPrefab(def.key, x, z, rand() * Math.PI * 2, [ds[0] * j, ds[1] * j, ds[2] * j], tint, skin)) break;
      placed++;
    }
    if (placed < want) log.push(`${def.key} scatter trimmed to ${placed}/${want} (space/cap)`);
  }

  // markers
  let spawned = false;
  for (const m of (raw.markers ?? []).slice(0, 400)) {
    if (entities.length >= MAX_ENTITIES) break;
    const type = ["playerSpawn", "coin", "checkpoint", "enemy"].includes(m.type) ? m.type : "coin";
    if (type === "playerSpawn") {
      if (spawned) continue;
      spawned = true;
    }
    const [x, z] = toXZ(m.at ?? [0.5, 0.5]);
    entities.push({ id: id("me"), type, pos: [x, groundAt(x, z) + 1, z] });
  }
  for (const tr of (raw.coinTrails ?? []).slice(0, 30)) {
    const line = mapPoly(tr.line);
    if (line.length < 2) continue;
    const n = Math.round(clamp(tr.count, 3, 80, 20));
    // total length → even spacing along the polyline
    const segLen: number[] = [];
    let total = 0;
    for (let i = 1; i < line.length; i++) {
      const l = Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1]);
      segLen.push(l);
      total += l;
    }
    for (let k = 0; k < n && entities.length < MAX_ENTITIES; k++) {
      let dist = (k / Math.max(1, n - 1)) * total;
      let i = 0;
      while (i < segLen.length - 1 && dist > segLen[i]) dist -= segLen[i++];
      const t = segLen[i] > 0 ? dist / segLen[i] : 0;
      const x = line[i][0] + (line[i + 1][0] - line[i][0]) * t;
      const z = line[i][1] + (line[i + 1][1] - line[i][1]) * t;
      entities.push({ id: id("me"), type: "coin", pos: [x, groundAt(x, z) + 1.2, z] });
    }
  }
  if (!spawned) {
    // land the player on the biggest landmass's first vertex-ish center
    const main = lands[0];
    const cx = main.poly.reduce((s, p) => s + p[0], 0) / main.poly.length;
    const cz = main.poly.reduce((s, p) => s + p[1], 0) / main.poly.length;
    entities.unshift({ id: id("me"), type: "playerSpawn", pos: [cx, groundAt(cx, cz) + 2, cz] });
    log.push("plan had no playerSpawn — placed one at the main landmass center");
  }

  // --- assemble ---
  const slug = (raw.name || "imported map").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 32) || "imported";
  const data: ContinentData = {
    meta: {
      id: `${slug}-${Date.now().toString(36)}`,
      name: raw.name || "Imported map",
      version: SCHEMA_VERSION,
      bounds: {
        min: [-W / 2 - 20, Math.min(-50, minH - 20), -D / 2 - 20],
        max: [W / 2 + 20, maxH + 90, D / 2 + 20],
      },
      gravity: [0, -16, 0],
      killPlaneY: Math.min(-40, minH - 15),
      ...(sea !== undefined ? { seaLevel: sea } : {}),
      env: THEMES[theme].env,
    },
    terrain: {
      size: [W, D],
      resolution: [cols, rows],
      heights,
      // The stock palettes put the snow line at ~30 m (small-stage scale).
      // Journey-scale mountains reach 100+ m — stretch the elevation ramp to
      // the world's actual height range so summits are snowcapped instead of
      // whole ranges going white.
      palette: (() => {
        const k = Math.max(1, Math.min(4, maxH / 34));
        return (THEMES[theme].palette ?? DEFAULT_PALETTE).map((s) => ({
          h: Math.round(s.h * k * 10) / 10,
          color: [...s.color] as Vec3,
        }));
      })(),
    },
    prefabs,
    entities,
  };
  log.unshift(
    `${W}×${D} m · ${cols}×${rows} terrain · ${lands.length} landmass(es), ${peaks.length} peak(s), ` +
    `${ridges.length} ridge(s), ${valleys.length} valley(s), ${paths.length} path(s) · ` +
    `${prefabs.length} prefabs · ${entities.length} markers · theme ${theme}${sea !== undefined ? ` · sea ${sea}` : ""}`,
  );
  return { data, log };
}
