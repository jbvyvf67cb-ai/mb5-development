// CharacterData — the serializable character format (sprite-based).
//
// A character is: body morphs (drive the procedural sprite AND the physics
// capsule), colors + accessory (sprite only), stats (drive movement/combat
// numbers), and a set of equipped special moves. JSON-friendly, like
// ContinentData. Joshua the bear is the first built-in.

import type { Vec3 } from "../world/schema";

export interface CharacterBody {
  /** Overall vertical scale (0.75..1.35). */
  height: number;
  /** Overall horizontal scale (0.75..1.35). */
  width: number;
  /** Chunkiness 0..1 — belly + limb thickness; also raises mass in play. */
  weight: number;
  /** Head size scale (0.8..1.3). */
  head: number;
  /** Ear size scale (0.4..1.8). */
  ears: number;
}

export interface CharacterColors {
  fur: Vec3;
  /** Muzzle + inner-ear + belly patch color. */
  muzzle: Vec3;
  belly: Vec3;
  /** Accessory color. */
  accent: Vec3;
}

export type Accessory =
  | "none"
  | "bowtie"
  | "cap"
  | "scarf"
  | "crown"
  | "glasses"
  | "halo"
  | "horns"
  | "backpack"
  | "wings";

export const ACCESSORIES: Array<{ key: Accessory; label: string }> = [
  { key: "none", label: "None" },
  { key: "bowtie", label: "Bow tie" },
  { key: "cap", label: "Cap" },
  { key: "scarf", label: "Scarf" },
  { key: "crown", label: "Crown" },
  { key: "glasses", label: "Glasses" },
  { key: "halo", label: "Halo" },
  { key: "horns", label: "Horns" },
  { key: "backpack", label: "Backpack" },
  { key: "wings", label: "Wings" },
];

/** Body construction style: chunky voxel boxes vs organic spheres/capsules. */
export type BodyStyle = "blocky" | "rounded";

/** All stats 1..10. Speed/jump drive movement now; attack/defense are stored for combat. */
export interface CharacterStats {
  speed: number;
  jump: number;
  attack: number;
  defense: number;
}

export type MoveKey = "doubleJump" | "dash" | "glide" | "groundPound" | "wallJump" | "spinAttack";

export interface MoveDef {
  key: MoveKey;
  label: string;
  control: string;
  desc: string;
}

export const MOVES: MoveDef[] = [
  { key: "doubleJump", label: "Double Jump", control: "Space (in air)", desc: "One extra jump while airborne." },
  { key: "dash", label: "Dash", control: "Shift", desc: "A quick burst forward — crosses gaps. Once per airtime." },
  { key: "glide", label: "Glide", control: "hold Space (falling)", desc: "Spread out and fall slowly." },
  { key: "groundPound", label: "Ground Pound", control: "C (in air)", desc: "Slam straight down with a shockwave." },
  { key: "wallJump", label: "Wall Jump", control: "Space (on a wall)", desc: "Kick off walls while airborne." },
  { key: "spinAttack", label: "Spin Attack", control: "J (in air)", desc: "A 360° spinning strike that hits everything around you." },
];

/**
 * Base combat verbs — every character has these (no equip needed):
 * J = 3-hit punch combo (jab → cross → double swing), K = kick,
 * K in air = dive kick. Damage/knockback scale with the attack stat.
 */
export const BASE_ATTACKS = "J punch combo · K kick · K (air) dive kick";

export interface CharacterData {
  id: string;
  name: string;
  /** Rig construction style; default "blocky". */
  style?: BodyStyle;
  body: CharacterBody;
  colors: CharacterColors;
  accessory: Accessory;
  stats: CharacterStats;
  moves: MoveKey[];
}

// --- built-in presets ---

export const JOSHUA: CharacterData = {
  id: "joshua",
  name: "Joshua",
  body: { height: 1.6, width: 1.5, weight: 0.95, head: 0.85, ears: 0.8 },
  colors: {
    fur: [0.45, 0.3, 0.18],
    muzzle: [0.78, 0.62, 0.45],
    belly: [0.62, 0.46, 0.3],
    accent: [0.85, 0.2, 0.25],
  },
  accessory: "bowtie",
  // The mountain that walks: huge, slow, hits like a landslide.
  stats: { speed: 2, jump: 4, attack: 10, defense: 10 },
  moves: ["groundPound", "spinAttack", "dash"],
};

export const PRESETS: CharacterData[] = [
  JOSHUA,
  {
    id: "scout",
    name: "Prez TT",
    style: "rounded",
    body: { height: 0.85, width: 0.85, weight: 0.15, head: 1.1, ears: 1.4 },
    colors: {
      fur: [0.35, 0.55, 0.6],
      muzzle: [0.8, 0.85, 0.85],
      belly: [0.55, 0.72, 0.75],
      accent: [0.95, 0.75, 0.2],
    },
    accessory: "scarf",
    stats: { speed: 9, jump: 8, attack: 3, defense: 3 },
    moves: ["doubleJump", "glide", "wallJump"],
  },
  {
    id: "boulder",
    name: "Boulder",
    body: { height: 1.15, width: 1.3, weight: 0.95, head: 0.9, ears: 0.6 },
    colors: {
      fur: [0.4, 0.4, 0.44],
      muzzle: [0.65, 0.63, 0.6],
      belly: [0.55, 0.53, 0.5],
      accent: [0.25, 0.55, 0.9],
    },
    accessory: "cap",
    stats: { speed: 3, jump: 4, attack: 9, defense: 9 },
    moves: ["groundPound", "dash"],
  },
];

// --- normalize / clamp ---

const clamp = (v: unknown, lo: number, hi: number, d: number): number => {
  const n = typeof v === "number" && isFinite(v) ? v : d;
  return Math.min(hi, Math.max(lo, n));
};
const vec3 = (v: unknown, d: Vec3): Vec3 =>
  Array.isArray(v) && v.length >= 3
    ? [clamp(v[0], 0, 1, d[0]), clamp(v[1], 0, 1, d[1]), clamp(v[2], 0, 1, d[2])]
    : [...d];

/** Repair a loose/imported character into a valid one (defaults from Joshua). */
export function normalizeCharacter(raw: unknown): CharacterData {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const body = (r.body ?? {}) as Record<string, unknown>;
  const colors = (r.colors ?? {}) as Record<string, unknown>;
  const stats = (r.stats ?? {}) as Record<string, unknown>;
  const moveKeys = new Set(MOVES.map((m) => m.key));
  const moves = (Array.isArray(r.moves) ? r.moves : JOSHUA.moves).filter((m): m is MoveKey =>
    moveKeys.has(m as MoveKey),
  );
  const acc: Accessory = ACCESSORIES.some((a) => a.key === r.accessory)
    ? (r.accessory as Accessory)
    : "none";
  return {
    id: typeof r.id === "string" && r.id ? r.id : `c${Date.now().toString(36)}`,
    name: typeof r.name === "string" && r.name ? r.name : "Unnamed",
    style: r.style === "rounded" ? "rounded" : "blocky",
    body: {
      height: clamp(body.height, 0.75, 1.6, 1),
      width: clamp(body.width, 0.75, 1.6, 1),
      weight: clamp(body.weight, 0, 1, 0.5),
      head: clamp(body.head, 0.8, 1.3, 1),
      ears: clamp(body.ears, 0.4, 1.8, 1),
    },
    colors: {
      fur: vec3(colors.fur, JOSHUA.colors.fur),
      muzzle: vec3(colors.muzzle, JOSHUA.colors.muzzle),
      belly: vec3(colors.belly, JOSHUA.colors.belly),
      accent: vec3(colors.accent, JOSHUA.colors.accent),
    },
    accessory: acc,
    stats: {
      speed: clamp(stats.speed, 1, 10, 5),
      jump: clamp(stats.jump, 1, 10, 5),
      attack: clamp(stats.attack, 1, 10, 5),
      defense: clamp(stats.defense, 1, 10, 5),
    },
    moves: [...new Set(moves)],
  };
}

/** Deep copy (characters are plain JSON data). */
export function cloneCharacter(c: CharacterData): CharacterData {
  return JSON.parse(JSON.stringify(c)) as CharacterData;
}

// --- stats → movement numbers (single source of truth for play + designer UI) ---

export interface DerivedMovement {
  strikePower: number;
  runSpeed: number;
  jumpVelocity: number;
  doubleJumpVelocity: number;
  groundAccel: number;
  airAccel: number;
  mass: number;
  dashSpeed: number;
  capsuleHeight: number;
  capsuleRadius: number;
}

export function deriveMovement(c: CharacterData): DerivedMovement {
  const s = c.stats;
  const heavy = c.body.weight; // 0..1
  const runSpeed = 5.8 + s.speed * 0.8; // 6.6 .. 13.8
  const jumpVelocity = 7.8 + s.jump * 0.55; // 8.35 .. 13.3 (fall gravity makes arcs snappy)
  return {
    strikePower: 6 + s.attack * 1.5, // punch/kick knockback (6+10 → 21 for a 10-attack bruiser)
    runSpeed,
    jumpVelocity,
    doubleJumpVelocity: jumpVelocity * 0.92,
    groundAccel: 85 * (1 - heavy * 0.25),
    airAccel: 30 * (1 - heavy * 0.2),
    mass: 45 + heavy * 55,
    dashSpeed: runSpeed * 2.2,
    capsuleHeight: 1.35 + 0.55 * c.body.height, // 1.76 .. 2.09-ish
    capsuleRadius: 0.34 + 0.14 * c.body.width * (1 + heavy * 0.25),
  };
}
