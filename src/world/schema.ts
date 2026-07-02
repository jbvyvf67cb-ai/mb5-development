// ContinentData — the serializable level format.
//
// One format authored by the map maker and consumed by the game runtime
// (Joshua's "author → data → render with no surprises" discipline, adapted to
// true-3D). JSON-friendly: plain arrays/objects only, no class instances.
//
// Coordinate frame: right-handed, Y up, meters. Flat continents use normal
// down-gravity for now (globe traversal is deferred — see DESIGN.md).

export type Vec3 = [number, number, number];

/** How a prefab instance is collided in physics. "auto" uses the prefab default. */
export type ColliderKind =
  | "auto"
  | "box"
  | "sphere"
  | "capsule"
  | "cylinder"
  | "mesh"
  | "none";

export interface ContinentMeta {
  id: string;
  name: string;
  /** Schema version, bumped on breaking format changes. */
  version: number;
  /** World-space AABB enclosing the whole level (drives bounds/culling/kill-plane). */
  bounds: { min: Vec3; max: Vec3 };
  /** Gravity vector; default [0, -16, 0] (matches Joshua's heavier platformer feel). */
  gravity?: Vec3;
  /** Y below which the player is considered to have fallen out of the world. */
  killPlaneY?: number;
  /** If set, a translucent water plane renders at this Y across the bounds (sea level). */
  seaLevel?: number;
  /** Aesthetic environment settings (sky/fog/sun/water); absent fields use defaults. */
  env?: EnvSettings;
  /** Kept if any OSM-derived assets are ever used: "Map data © OpenStreetMap contributors". */
  attribution?: string;
}

/**
 * Environment look — every field optional so old levels load unchanged.
 * Colors are RGB 0..1. Applied live by World.applyEnv() and editable from the
 * map maker's Style tab.
 */
export interface EnvSettings {
  /** Sky/background color (scene clear color). */
  sky?: Vec3;
  /** Hemispheric bounce color from below (ground tint of the sky light). */
  horizon?: Vec3;
  /** Exponential fog color + density (0 disables fog). */
  fogColor?: Vec3;
  fogDensity?: number;
  /** Sun (directional light) tint, intensity, and direction as azimuth/elevation degrees. */
  sunColor?: Vec3;
  sunIntensity?: number;
  sunAzimuth?: number;
  sunElevation?: number;
  /** Ambient (hemispheric) intensity. */
  ambient?: number;
  /** Water plane tint + opacity (used when meta.seaLevel is set). */
  waterColor?: Vec3;
  waterOpacity?: number;
}

/** One stop of the terrain elevation color ramp. */
export interface PaletteStop {
  /** Height (m) at which this color is fully reached. */
  h: number;
  color: Vec3;
}

/** Sculptable heightmap terrain — row-major height samples over an XZ grid. */
export interface TerrainData {
  /** World extent of the grid on X and Z, in meters. */
  size: [number, number];
  /** Grid sample counts: [cols (X), rows (Z)]. heights.length must equal cols*rows. */
  resolution: [number, number];
  /** Row-major height samples (meters), length cols*rows. Row r, col c at index r*cols + c. */
  heights: number[];
  /** World XZ of the grid's minimum corner. Defaults to centering the grid on origin. */
  origin?: [number, number];
  /** Material id from the runtime material table; defaults to a grass material. */
  material?: string;
  /** Elevation color ramp (ascending h). Absent = DEFAULT_PALETTE (sand→grass→rock→snow). */
  palette?: PaletteStop[];
}

/** A placed true-3D building block (procedural prefab or, later, a glTF asset). */
export interface PrefabInstance {
  /** Unique instance id (stable across edits; used for picking/selection). */
  id: string;
  /** Prefab type key into the PrefabLibrary (e.g. "platform", "ramp", "pillar"). */
  prefab: string;
  pos: Vec3;
  /** Euler rotation in radians (XYZ). Euler chosen for editor/serialization friendliness. */
  rot: Vec3;
  scale: Vec3;
  /** Optional RGB tint (0..1) multiplied into the prefab's base color. */
  tint?: Vec3;
  /** Collider override; omitted/"auto" uses the prefab's default collider. */
  collider?: ColliderKind;
  /** Per-instance parameters (e.g. moving-platform speed, prefab-specific dims). */
  props?: Record<string, unknown>;
}

/** A gameplay marker: spawn, collectible, checkpoint, hazard, trigger, etc. */
export interface EntityInstance {
  id: string;
  /** Entity type key (e.g. "playerSpawn", "coin", "checkpoint", "enemy"). */
  type: string;
  pos: Vec3;
  rot?: Vec3;
  props?: Record<string, unknown>;
}

export interface ContinentData {
  meta: ContinentMeta;
  terrain?: TerrainData;
  prefabs: PrefabInstance[];
  entities: EntityInstance[];
}

export const SCHEMA_VERSION = 1;
export const DEFAULT_GRAVITY: Vec3 = [0, -16, 0];

/** The default elevation ramp: sand → coastal grass → green → rock → snow. */
export const DEFAULT_PALETTE: PaletteStop[] = [
  { h: 0.4, color: [0.78, 0.72, 0.5] },
  { h: 3, color: [0.42, 0.6, 0.32] },
  { h: 12, color: [0.24, 0.46, 0.24] },
  { h: 22, color: [0.45, 0.4, 0.34] },
  { h: 30, color: [0.93, 0.93, 0.96] },
];

/** Engine defaults for every EnvSettings field (what an absent field means). */
export const DEFAULT_ENV: Required<EnvSettings> = {
  sky: [0.05, 0.07, 0.11],
  horizon: [0.18, 0.16, 0.14],
  fogColor: [0.55, 0.65, 0.8],
  fogDensity: 0,
  sunColor: [1, 0.98, 0.92],
  sunIntensity: 1.4,
  sunAzimuth: 240,
  sunElevation: 55,
  ambient: 0.55,
  waterColor: [0.1, 0.32, 0.55],
  waterOpacity: 0.66,
};

/** Create an empty continent with sane defaults. */
export function emptyContinent(id: string, name = id): ContinentData {
  return {
    meta: {
      id,
      name,
      version: SCHEMA_VERSION,
      bounds: { min: [-200, -50, -200], max: [200, 150, 200] },
      gravity: [...DEFAULT_GRAVITY] as Vec3,
      killPlaneY: -40,
    },
    prefabs: [],
    entities: [],
  };
}
