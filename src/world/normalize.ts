// normalizeContinent — turn loose/partial JSON into a valid ContinentData.
//
// The hand-drawn-map → JSON flow (and hand-authored files) will produce data
// that's slightly off: missing ids, absent rot/scale, no bounds, unknown prefab
// keys, no spawn. This fills defaults and repairs the obvious problems so any
// reasonable input loads instead of throwing. Authoritative shape: schema.ts.

import {
  DEFAULT_GRAVITY,
  SCHEMA_VERSION,
  type ContinentData,
  type EntityInstance,
  type EnvSettings,
  type PaletteStop,
  type PrefabInstance,
  type TerrainData,
  type Vec3,
} from "./schema";
import { getPrefab } from "./prefabs";

type Loose = Record<string, unknown>;

function num(v: unknown, d = 0): number {
  return typeof v === "number" && isFinite(v) ? v : d;
}
function vec3(v: unknown, d: Vec3): Vec3 {
  return Array.isArray(v) && v.length >= 3 ? [num(v[0], d[0]), num(v[1], d[1]), num(v[2], d[2])] : [...d];
}
function str(v: unknown, d: string): string {
  return typeof v === "string" && v.length ? v : d;
}

let n = 0;
function genId(prefix: string): string {
  return `${prefix}${(n++).toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
}

function normTerrain(raw: unknown): TerrainData | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const t = raw as Loose;
  const size = vec3(t.size ? [...(t.size as number[]), 0] : undefined, [120, 120, 0]);
  const resArr = Array.isArray(t.resolution) ? (t.resolution as number[]) : [41, 41];
  const cols = Math.max(2, Math.round(num(resArr[0], 41)));
  const rows = Math.max(2, Math.round(num(resArr[1], 41)));
  const want = cols * rows;
  let heights = Array.isArray(t.heights) ? (t.heights as number[]).map((h) => num(h, 0)) : [];
  if (heights.length < want) heights = heights.concat(new Array(want - heights.length).fill(0));
  else if (heights.length > want) heights = heights.slice(0, want);
  const out: TerrainData = { size: [size[0], size[1]], resolution: [cols, rows], heights };
  if (Array.isArray(t.origin)) out.origin = [num((t.origin as number[])[0], 0), num((t.origin as number[])[1], 0)];
  if (typeof t.material === "string") out.material = t.material;
  const palette = normPalette(t.palette);
  if (palette) out.palette = palette;
  return out;
}

function normPalette(raw: unknown): PaletteStop[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const stops = raw
    .filter((s): s is Loose => !!s && typeof s === "object")
    .map((s) => ({ h: num(s.h, 0), color: vec3(s.color, [1, 1, 1]) }))
    .sort((a, b) => a.h - b.h);
  return stops.length >= 2 ? stops : undefined;
}

/** Keep only recognized env fields, with type-checked values. */
function normEnv(raw: unknown): EnvSettings | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const e = raw as Loose;
  const out: EnvSettings = {};
  const color = (k: keyof EnvSettings & string) => {
    if (Array.isArray(e[k])) (out[k] as Vec3) = vec3(e[k], [1, 1, 1]);
  };
  const scalar = (k: keyof EnvSettings & string) => {
    if (typeof e[k] === "number" && isFinite(e[k] as number)) (out[k] as number) = e[k] as number;
  };
  color("sky"); color("horizon"); color("fogColor"); color("sunColor"); color("waterColor");
  scalar("fogDensity"); scalar("sunIntensity"); scalar("sunAzimuth"); scalar("sunElevation");
  scalar("ambient"); scalar("waterOpacity");
  return Object.keys(out).length ? out : undefined;
}

function normPrefab(raw: unknown): PrefabInstance | null {
  if (!raw || typeof raw !== "object") return null;
  const p = raw as Loose;
  let key = str(p.prefab, "block");
  if (!getPrefab(key)) {
    console.warn(`[normalize] unknown prefab "${key}" → block`);
    key = "block";
  }
  const def = getPrefab(key);
  const inst: PrefabInstance = {
    id: str(p.id, genId("p")),
    prefab: key,
    pos: vec3(p.pos, [0, 0, 0]),
    rot: vec3(p.rot, [0, 0, 0]),
    scale: vec3(p.scale, (def?.defaultScale ?? [1, 1, 1]) as Vec3),
  };
  if (Array.isArray(p.tint)) inst.tint = vec3(p.tint, [1, 1, 1]);
  if (typeof p.collider === "string") inst.collider = p.collider as PrefabInstance["collider"];
  if (p.props && typeof p.props === "object") inst.props = p.props as Record<string, unknown>;
  return inst;
}

function normEntity(raw: unknown): EntityInstance | null {
  if (!raw || typeof raw !== "object") return null;
  const e = raw as Loose;
  const ent: EntityInstance = {
    id: str(e.id, genId("e")),
    type: str(e.type, "coin"),
    pos: vec3(e.pos, [0, 0, 0]),
  };
  if (Array.isArray(e.rot)) ent.rot = vec3(e.rot, [0, 0, 0]);
  if (e.props && typeof e.props === "object") ent.props = e.props as Record<string, unknown>;
  return ent;
}

/** Compute an AABB enclosing all content (+ margin) when bounds are absent/bad. */
function computeBounds(prefabs: PrefabInstance[], terrain?: TerrainData): { min: Vec3; max: Vec3 } {
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  const grow = (x: number, y: number, z: number) => {
    minX = Math.min(minX, x); minY = Math.min(minY, y); minZ = Math.min(minZ, z);
    maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); maxZ = Math.max(maxZ, z);
  };
  for (const p of prefabs) {
    const r = Math.max(Math.abs(p.scale[0]), Math.abs(p.scale[1]), Math.abs(p.scale[2]));
    grow(p.pos[0] - r, p.pos[1] - r, p.pos[2] - r);
    grow(p.pos[0] + r, p.pos[1] + r, p.pos[2] + r);
  }
  if (terrain) {
    const ox = terrain.origin?.[0] ?? -terrain.size[0] / 2;
    const oz = terrain.origin?.[1] ?? -terrain.size[1] / 2;
    grow(ox, 0, oz);
    grow(ox + terrain.size[0], 0, oz + terrain.size[1]);
  }
  if (!isFinite(minX)) return { min: [-65, -25, -65], max: [65, 45, 65] };
  const m = 10;
  return { min: [minX - m, minY - m, minZ - m], max: [maxX + m, maxY + m, maxZ + m] };
}

export function normalizeContinent(raw: unknown): ContinentData {
  const r = (raw && typeof raw === "object" ? raw : {}) as Loose;
  const metaRaw = (r.meta && typeof r.meta === "object" ? r.meta : {}) as Loose;

  const terrain = normTerrain(r.terrain);
  const prefabs = (Array.isArray(r.prefabs) ? r.prefabs : [])
    .map(normPrefab)
    .filter((p): p is PrefabInstance => !!p);
  const entities = (Array.isArray(r.entities) ? r.entities : [])
    .map(normEntity)
    .filter((e): e is EntityInstance => !!e);

  // Guarantee a player spawn.
  if (!entities.some((e) => e.type === "playerSpawn")) {
    entities.unshift({ id: genId("e"), type: "playerSpawn", pos: [0, 4, 0] });
  }

  const bounds =
    metaRaw.bounds && typeof metaRaw.bounds === "object"
      ? {
          min: vec3((metaRaw.bounds as Loose).min, [-65, -25, -65]),
          max: vec3((metaRaw.bounds as Loose).max, [65, 45, 65]),
        }
      : computeBounds(prefabs, terrain);

  const data: ContinentData = {
    meta: {
      id: str(metaRaw.id, "imported"),
      name: str(metaRaw.name, str(metaRaw.id, "Imported")),
      version: SCHEMA_VERSION,
      bounds,
      gravity: Array.isArray(metaRaw.gravity) ? vec3(metaRaw.gravity, DEFAULT_GRAVITY) : [...DEFAULT_GRAVITY],
      killPlaneY: num(metaRaw.killPlaneY, -40),
      ...(typeof metaRaw.seaLevel === "number" ? { seaLevel: metaRaw.seaLevel } : {}),
      ...(() => {
        const env = normEnv(metaRaw.env);
        return env ? { env } : {};
      })(),
    },
    prefabs,
    entities,
  };
  if (terrain) data.terrain = terrain;
  return data;
}
