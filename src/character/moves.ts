// The move system — every special move is DATA, not code.
//
// A MoveSpec = a trigger slot + physics phases + animation keyframes over the
// rig's generic channel set (+ strike windows and FX). One interpreter in the
// controller runs all of them; one channel player in the rig animates all of
// them. Because channels are semantic (shoulders/elbows/hips/knees/torso/spin)
// and joints are placed proportionally on every body, a move authored once
// reads correctly on any character — hand-made or AI-generated, blocky or
// rounded, giant or runt. That is what lets the catalog scale to 50+ moves.

export type SlotKey =
  | "jumpAir" // Space in air
  | "fallHold" // hold Space while falling
  | "dashGround" // Shift on ground
  | "dashAir" // Shift in air
  | "wall" // Space at a wall
  | "powerAir" // C in air
  | "powerGround" // C on ground
  | "attackGround" // J on ground
  | "attackAir" // J in air
  | "kickGround" // K on ground
  | "kickAir" // K in air
  | "passive"; // automatic (landing rolls, skids) — any number equipped

export const SLOT_LABELS: Record<SlotKey, string> = {
  jumpAir: "Space (in air)",
  fallHold: "hold Space (falling)",
  dashGround: "Shift",
  dashAir: "Shift (in air)",
  wall: "Space (at a wall)",
  powerAir: "C (in air)",
  powerGround: "C",
  attackGround: "J",
  attackAir: "J (in air)",
  kickGround: "K",
  kickAir: "K (in air)",
  passive: "automatic",
};

/** Rig channel targets. Angles in radians; sh/hip are [x, z]. */
export interface ChannelPose {
  shL?: [number, number];
  shR?: [number, number];
  elL?: number;
  elR?: number;
  hipL?: [number, number];
  hipR?: [number, number];
  kneeL?: number;
  kneeR?: number;
  pitch?: number;
  yaw?: number;
}

export interface MovePhase {
  /** Seconds (with until:"ground" this is the max). */
  dur: number;
  until?: "ground";
  /** Forward speed: fwd (m/s absolute) or fwdMul (× character run speed). */
  fwd?: number;
  fwdMul?: number;
  /** Keep current horizontal velocity (rolls preserve momentum). */
  keepMomentum?: boolean;
  /** Vertical: impulse once at phase start / held every frame / caps. */
  vyImpulse?: number;
  vyImpulseMul?: number; // × character jump velocity
  vyHold?: number;
  vyMin?: number;
  hover?: boolean;
  /** Steering multiplier during the phase (default 0 when fwd set, else 1). */
  steer?: number;
  /** Teleport forward this many meters at phase start. */
  blink?: number;
  /** Body rotation over the phase (turns; X = flips, Y = spins). */
  spinX?: number;
  spinY?: number;
  pose?: ChannelPose;
  stretch?: number;
  /** FX */
  trail?: boolean;
  burst?: number;
  /** Strike window (fraction of the phase). */
  strikeAt?: number;
  strikeRadius?: number;
  strikeArc?: number; // min dot; -1 = 360°
  strikeMult?: number;
  /** Homing: steer hard toward the nearest target during this phase. */
  homing?: boolean;
  /** When an until:"ground" phase touches down. */
  onGround?: { vySet?: number; shock?: boolean; burst?: number; strikeRadius?: number; strikeMult?: number };
}

export interface MoveSpec {
  key: string;
  label: string;
  desc: string;
  slot: SlotKey;
  phases: MovePhase[];
  /** jumpAir: uses per airtime (double = 1, triple = 2). */
  airUses?: number;
  oncePerAir?: boolean;
  cooldown?: number;
  /** Press the same button during the last 40% to chain into this move. */
  chain?: string;
  /** fallHold: applies continuously while held (single phase). */
  holdable?: boolean;
  /** wall: hang on the wall until jump is pressed again. */
  cling?: boolean;
  /** Rig flourish flags (accessory participation). */
  earSpin?: boolean;
}

// ---- pose shorthands (radians; +x = limb back, -x = limb forward) ----
const T_POSE: ChannelPose = { shL: [0, 1.57], shR: [0, -1.57], elL: -0.1, elR: -0.1 };
const TUCK: ChannelPose = { hipL: [-0.9, 0], hipR: [-0.7, 0], kneeL: 1.6, kneeR: 1.4, elL: -1.2, elR: -1.2, shL: [-0.6, 0.2], shR: [-0.6, -0.2], pitch: 0.3 };
const STAR: ChannelPose = { shL: [0, 1.5], shR: [0, -1.5], hipL: [-0.5, 0.4], hipR: [-0.5, -0.4], kneeL: 1.4, kneeR: 1.4, pitch: -0.1 };
const DIVE: ChannelPose = { shL: [1.1, 0.2], shR: [1.1, -0.2], elL: -0.4, elR: -0.4, hipL: [0.5, 0], hipR: [0.3, 0], kneeL: 0.6, kneeR: 0.4, pitch: 0.6 };

const M = (spec: MoveSpec) => spec;

/**
 * THE CATALOG — 56 moves. Base kit (always available if the slot is empty):
 * punchCombo (J), kick (K), diveKick (K air).
 */
export const MOVE_CATALOG: MoveSpec[] = [
  // ============ jumpAir — Space in air ============
  M({ key: "doubleJump", label: "Double Jump", desc: "One extra jump with a tidy somersault.", slot: "jumpAir", airUses: 1,
    phases: [{ dur: 0.45, vyImpulseMul: 0.92, spinX: 1, pose: TUCK, stretch: 1.08 }] }),
  M({ key: "tripleJump", label: "Triple Jump", desc: "Two extra jumps, each a little weaker.", slot: "jumpAir", airUses: 2,
    phases: [{ dur: 0.4, vyImpulseMul: 0.82, spinX: 1, pose: TUCK }] }),
  M({ key: "rocketHop", label: "Rocket Hop", desc: "One huge vertical boost — straight up like a bottle rocket.", slot: "jumpAir", airUses: 1,
    phases: [{ dur: 0.5, vyImpulseMul: 1.35, pose: { shL: [-3, 0.1], shR: [-3, -0.1], hipL: [0.2, 0], hipR: [0.2, 0], kneeL: 0.7, kneeR: 0.7, pitch: -0.05 }, stretch: 1.18, trail: true }] }),
  M({ key: "blinkStep", label: "Blink Step", desc: "Vanish and reappear a few meters ahead.", slot: "jumpAir", airUses: 1, cooldown: 0.5,
    phases: [{ dur: 0.22, blink: 4.5, hover: true, pose: { shL: [0.6, 0.5], shR: [0.6, -0.5], pitch: 0.2 }, burst: 14, trail: true }] }),
  M({ key: "batFlap", label: "Wing Flaps", desc: "Three small re-flaps per airtime — stairs made of air.", slot: "jumpAir", airUses: 3,
    phases: [{ dur: 0.3, vyImpulseMul: 0.6, pose: { shL: [0, 1.3], shR: [0, -1.3], elL: -0.5, elR: -0.5 } }] }),
  M({ key: "moonFlip", label: "Moon Flip", desc: "A soaring, slow backflip — huge height, less control.", slot: "jumpAir", airUses: 1,
    phases: [{ dur: 0.7, vyImpulseMul: 1.15, spinX: -1, steer: 0.3, pose: { shL: [-1.8, 0.7], shR: [-1.8, -0.7], hipL: [-0.4, 0.1], hipR: [-0.4, -0.1], kneeL: 1, kneeR: 1 } }] }),

  // ============ fallHold — hold Space while falling ============
  M({ key: "glide", label: "Glide", desc: "Spread wide and ride the air forward.", slot: "fallHold", holdable: true,
    phases: [{ dur: 9, vyMin: -2.4, pose: { ...T_POSE, pitch: 0.35, hipL: [0.15, 0.06], hipR: [0.15, -0.06], kneeL: 0.25, kneeR: 0.25 } }] }),
  M({ key: "parachute", label: "Parachute", desc: "Drop almost straight down, feather-soft.", slot: "fallHold", holdable: true,
    phases: [{ dur: 9, vyMin: -1.4, fwd: 0, pose: { shL: [-2.6, 0.5], shR: [-2.6, -0.5], hipL: [0.1, 0.15], hipR: [0.1, -0.15], kneeL: 0.4, kneeR: 0.4 } }] }),
  M({ key: "diveGlider", label: "Dive Glider", desc: "A fast, shallow glide — trade height for real speed.", slot: "fallHold", holdable: true,
    phases: [{ dur: 9, vyMin: -5, fwdMul: 1.25, pose: { ...DIVE, pitch: 0.85 }, trail: true }] }),
  M({ key: "helicopterEars", label: "Helicopter Ears", desc: "Spin those ears like rotors and drift down slowly.", slot: "fallHold", holdable: true, earSpin: true,
    phases: [{ dur: 9, vyMin: -1.8, pose: { shL: [0.3, 0.3], shR: [0.3, -0.3], hipL: [0.15, 0.08], hipR: [0.15, -0.08], kneeL: 0.5, kneeR: 0.5 } }] }),
  M({ key: "capeFloat", label: "Cape Float", desc: "Your scarf/cape catches the wind — graceful slow fall with drift.", slot: "fallHold", holdable: true,
    phases: [{ dur: 9, vyMin: -2, fwdMul: 0.6, steer: 0.8, pose: { shL: [-0.9, 0.9], shR: [-0.9, -0.9], pitch: 0.2 } }] }),
  M({ key: "balloonBelly", label: "Balloon Belly", desc: "Puff up and bob down like a balloon.", slot: "fallHold", holdable: true,
    phases: [{ dur: 9, vyMin: -1.2, stretch: 0.88, pose: { shL: [0.2, 0.9], shR: [0.2, -0.9], hipL: [0.1, 0.35], hipR: [0.1, -0.35], kneeL: 0.6, kneeR: 0.6 } }] }),

  // ============ dashGround — Shift ============
  M({ key: "dash", label: "Dash", desc: "A quick burst forward.", slot: "dashGround", cooldown: 0.6,
    phases: [{ dur: 0.16, fwdMul: 2.2, hover: true, pose: DIVE, trail: true }] }),
  M({ key: "spinRoll", label: "Spin Roll", desc: "Curl into a ball and roll — keeps momentum, classic style.", slot: "dashGround", cooldown: 0.5,
    phases: [{ dur: 0.55, fwdMul: 1.9, spinX: 2.5, pose: TUCK, stretch: 0.85, trail: true }] }),
  M({ key: "powerSlide", label: "Power Slide", desc: "Drop low and slide under trouble.", slot: "dashGround", cooldown: 0.7,
    phases: [{ dur: 0.5, fwdMul: 1.7, stretch: 0.62, pose: { hipL: [-1.2, 0.1], hipR: [0.6, -0.1], kneeL: 0.6, kneeR: 1.2, shL: [0.9, 0.3], shR: [-0.6, -0.2], pitch: -0.4 }, trail: true }] }),
  M({ key: "backstep", label: "Backstep", desc: "A snappy hop backwards — bait and punish.", slot: "dashGround", cooldown: 0.45,
    phases: [{ dur: 0.25, fwdMul: -1.4, vyImpulse: 3.5, pose: { shL: [-0.8, 0.5], shR: [-0.8, -0.5], pitch: -0.25, kneeL: 0.9, kneeR: 0.9 } }] }),
  M({ key: "chargeRam", label: "Charge Ram", desc: "A long, heavy shoulder charge that batters through.", slot: "dashGround", cooldown: 1.4,
    phases: [
      { dur: 0.18, fwdMul: 0.2, pose: { shL: [0.9, 0.3], shR: [-0.7, -0.1], pitch: -0.15, yaw: 0.4 } },
      { dur: 0.55, fwdMul: 1.8, pose: { shR: [-1.1, -0.35], shL: [0.9, 0.3], pitch: 0.45, yaw: -0.35 }, trail: true, strikeAt: 0.3, strikeRadius: 2.4, strikeArc: 0.3, strikeMult: 1.5 },
    ] }),
  M({ key: "boostBurst", label: "Boost", desc: "A long full-throttle boost — pure Sonic energy.", slot: "dashGround", cooldown: 2.2,
    phases: [{ dur: 0.9, fwdMul: 2.4, steer: 0.35, pose: { shL: [1.2, 0.15], shR: [1.2, -0.15], elL: -0.5, elR: -0.5, pitch: 0.5 }, trail: true, strikeAt: 0.2, strikeRadius: 1.8, strikeArc: 0.2, strikeMult: 1.2 }] }),

  // ============ dashAir — Shift in air ============
  M({ key: "airDash", label: "Air Dash", desc: "The commitment eraser: a flat burst mid-air.", slot: "dashAir", oncePerAir: true, cooldown: 0.5,
    phases: [{ dur: 0.18, fwdMul: 2.2, hover: true, pose: DIVE, trail: true }] }),
  M({ key: "diveBomb", label: "Dive Bomb", desc: "A 45° power dive — reach the ground on YOUR terms.", slot: "dashAir", oncePerAir: true,
    phases: [{ dur: 0.6, until: "ground", fwdMul: 1.5, vyHold: -14, pose: { ...DIVE, pitch: 0.9 }, trail: true, onGround: { burst: 20 } }] }),
  M({ key: "corkscrew", label: "Corkscrew", desc: "An air dash with a full barrel roll for style points.", slot: "dashAir", oncePerAir: true, cooldown: 0.5,
    phases: [{ dur: 0.34, fwdMul: 2, hover: true, spinY: 1, pose: { shL: [0.2, 1.2], shR: [0.2, -1.2], pitch: 0.3 }, trail: true }] }),
  M({ key: "airBrake", label: "Air Brake", desc: "Kill ALL momentum instantly and drop straight down.", slot: "dashAir", cooldown: 0.4,
    phases: [{ dur: 0.25, fwd: 0, vyHold: -1.5, pose: { shL: [-0.8, 0.9], shR: [-0.8, -0.9], hipL: [-0.3, 0.15], hipR: [-0.3, -0.15], kneeL: 1, kneeR: 1, pitch: -0.2 }, stretch: 0.9 }] }),

  // ============ wall — Space at a wall ============
  M({ key: "wallJump", label: "Wall Jump", desc: "Kick away from walls; refreshes your air moves.", slot: "wall",
    phases: [{ dur: 0.3, pose: { hipL: [-0.8, 0.15], hipR: [-0.5, -0.15], kneeL: 1.2, kneeR: 0.9, shL: [-1.6, 0.4], shR: [-1.6, -0.4] } }] }),
  M({ key: "wallCling", label: "Wall Cling", desc: "Grab the wall and hold — jump again whenever you like.", slot: "wall", cling: true,
    phases: [{ dur: 1.6, hover: true, pose: { shL: [-1.9, 0.3], shR: [-1.9, -0.3], elL: -0.7, elR: -0.7, hipL: [-0.6, 0.1], hipR: [-0.6, -0.1], kneeL: 1.1, kneeR: 1.1, pitch: 0.15 } }] }),
  M({ key: "wallRunUp", label: "Wall Run", desc: "Sprint straight up the wall for a beat, then leap.", slot: "wall",
    phases: [{ dur: 0.45, vyHold: 8.5, pose: { pitch: -0.5, hipL: [-1, 0], hipR: [0.6, 0], kneeL: 1.2, kneeR: 0.4, shL: [0.7, 0.2], shR: [-0.9, -0.2] }, trail: true }] }),

  // ============ powerAir — C in air ============
  M({ key: "groundPound", label: "Ground Pound", desc: "Front-flip windup, then slam with a shockwave.", slot: "powerAir",
    phases: [
      { dur: 0.24, vyHold: 1.4, spinX: 1, pose: TUCK },
      { dur: 3, until: "ground", vyHold: -34, pose: STAR, onGround: { vySet: 4.6, shock: true, burst: 46, strikeRadius: 4, strikeMult: 1.4 } },
    ] }),
  M({ key: "meteorSlam", label: "Meteor Slam", desc: "A slower, heavier pound with a huge blast radius.", slot: "powerAir",
    phases: [
      { dur: 0.38, vyHold: 1.2, spinX: 1.5, pose: TUCK, stretch: 1.1 },
      { dur: 3, until: "ground", vyHold: -40, pose: STAR, trail: true, onGround: { vySet: 3, shock: true, burst: 80, strikeRadius: 6.5, strikeMult: 2.2 } },
    ] }),
  M({ key: "bounceStomp", label: "Bounce Stomp", desc: "A stomp that rebounds you HIGHER each hit — bounce bracelet energy.", slot: "powerAir",
    phases: [{ dur: 3, until: "ground", vyHold: -26, pose: { hipL: [-0.3, 0.1], hipR: [-0.3, -0.1], kneeL: 0.4, kneeR: 0.4, shL: [-1.4, 0.4], shR: [-1.4, -0.4], pitch: 0.15 }, onGround: { vySet: 15, shock: true, burst: 26, strikeRadius: 3, strikeMult: 1 } }] }),
  M({ key: "drillDive", label: "Drill Dive", desc: "Corkscrew straight down like a drill.", slot: "powerAir",
    phases: [{ dur: 3, until: "ground", vyHold: -30, spinY: 4, pose: { shL: [1.3, 0.1], shR: [1.3, -0.1], hipL: [0.2, 0], hipR: [0.2, 0], kneeL: 0.15, kneeR: 0.15, pitch: 0.1 }, stretch: 1.15, trail: true, onGround: { vySet: 4, shock: true, burst: 40, strikeRadius: 4.5, strikeMult: 1.6 } }] }),
  M({ key: "bellyFlop", label: "Belly Flop", desc: "Flop flat and skim across the ground on landing.", slot: "powerAir",
    phases: [
      { dur: 3, until: "ground", vyHold: -18, fwdMul: 0.9, pose: { pitch: 1.35, shL: [-1.2, 0.7], shR: [-1.2, -0.7], hipL: [0.3, 0.2], hipR: [0.3, -0.2] }, onGround: { burst: 24 } },
      { dur: 0.5, fwdMul: 1.6, stretch: 0.55, pose: { pitch: 1.5, shL: [-1.4, 0.5], shR: [-1.4, -0.5] }, trail: true, strikeAt: 0.2, strikeRadius: 2, strikeArc: 0.2, strikeMult: 1.1 },
    ] }),
  M({ key: "cannonball", label: "Cannonball", desc: "Tuck tight, drop heavy, bounce big off the ground.", slot: "powerAir",
    phases: [{ dur: 3, until: "ground", vyHold: -30, spinX: 3, pose: TUCK, stretch: 0.85, onGround: { vySet: 10, burst: 30, strikeRadius: 3.5, strikeMult: 1.3, shock: true } }] }),

  // ============ powerGround — C on ground ============
  M({ key: "shockStomp", label: "Shock Stomp", desc: "Stamp the ground — a ring of force knocks everything back.", slot: "powerGround", cooldown: 1.2,
    phases: [
      { dur: 0.2, pose: { hipL: [-1.1, 0.1], kneeL: 1.3, shL: [-1, 0.4], shR: [0.5, -0.3], pitch: -0.15 } },
      { dur: 0.3, pose: { hipL: [0, 0], kneeL: 0.1, pitch: 0.2, shL: [0.4, 0.3], shR: [0.4, -0.3] }, burst: 30, strikeAt: 0.15, strikeRadius: 4.5, strikeArc: -1, strikeMult: 1.3 },
    ] }),
  M({ key: "warRoar", label: "War Roar", desc: "Rear back and ROAR — everything nearby is blasted away.", slot: "powerGround", cooldown: 1.6,
    phases: [
      { dur: 0.3, pose: { pitch: -0.45, shL: [-2.2, 0.6], shR: [-2.2, -0.6], elL: -0.8, elR: -0.8 }, stretch: 1.12 },
      { dur: 0.45, pose: { pitch: 0.25, shL: [-1.2, 0.9], shR: [-1.2, -0.9], elL: -0.3, elR: -0.3 }, burst: 40, strikeAt: 0.1, strikeRadius: 5.5, strikeArc: -1, strikeMult: 1.6 },
    ] }),
  M({ key: "dance", label: "Dance", desc: "Groove break — pure style, zero apologies.", slot: "powerGround", cooldown: 0.4,
    phases: [
      { dur: 0.4, pose: { shL: [-1.4, 0.6], shR: [0.7, -0.4], hipL: [-0.3, 0.15], kneeL: 0.7, yaw: 0.4, pitch: 0.1 } },
      { dur: 0.4, pose: { shR: [-1.4, -0.6], shL: [0.7, 0.4], hipR: [-0.3, -0.15], kneeR: 0.7, yaw: -0.4, pitch: 0.1 } },
      { dur: 0.35, pose: { shL: [-2.4, 0.5], shR: [-2.4, -0.5], yaw: 0, pitch: -0.15 }, spinY: 1, stretch: 1.08 },
    ] }),
  M({ key: "flexTaunt", label: "Flex", desc: "Hit the double-bicep. The mountains approve.", slot: "powerGround", cooldown: 0.4,
    phases: [{ dur: 0.9, pose: { shL: [0, 1.35], shR: [0, -1.35], elL: -1.9, elR: -1.9, pitch: -0.12 }, stretch: 1.06, burst: 8 }] }),
  M({ key: "backflipTaunt", label: "Victory Flip", desc: "A standing backflip, stuck landing, no notes.", slot: "powerGround", cooldown: 0.7,
    phases: [{ dur: 0.55, vyImpulse: 7.5, spinX: -1, pose: TUCK }] }),

  // ============ attackGround — J ============
  M({ key: "punchCombo", label: "Punch Combo", desc: "Jab → cross → double-fist finisher.", slot: "attackGround", chain: "punch2",
    phases: [{ dur: 0.26, keepMomentum: true, pose: { shR: [-1.62, -0.06], elR: -0.08, shL: [0.45, 0.25], yaw: -0.38 }, strikeAt: 0.45, strikeRadius: 2.3, strikeArc: 0.35, strikeMult: 1 }] }),
  M({ key: "punch2", label: "Cross", desc: "(combo)", slot: "attackGround", chain: "punch3",
    phases: [{ dur: 0.26, keepMomentum: true, pose: { shL: [-1.62, 0.06], elL: -0.08, shR: [0.45, -0.25], yaw: 0.38 }, strikeAt: 0.45, strikeRadius: 2.3, strikeArc: 0.35, strikeMult: 1.1 }] }),
  M({ key: "punch3", label: "Finisher", desc: "(combo)", slot: "attackGround",
    phases: [{ dur: 0.4, fwdMul: 0.5, pose: { shL: [-1.75, 0.15], shR: [-1.75, -0.15], elL: -0.12, elR: -0.12, pitch: 0.35 }, strikeAt: 0.5, strikeRadius: 2.6, strikeArc: 0.2, strikeMult: 1.6, burst: 10 }] }),
  M({ key: "hammerFists", label: "Hammer Fists", desc: "Slow double overhead smash — timber.", slot: "attackGround", cooldown: 0.9,
    phases: [
      { dur: 0.32, pose: { shL: [-2.7, 0.3], shR: [-2.7, -0.3], elL: -0.9, elR: -0.9, pitch: -0.3 }, stretch: 1.08 },
      { dur: 0.3, pose: { shL: [-0.5, 0.2], shR: [-0.5, -0.2], elL: -0.1, elR: -0.1, pitch: 0.55 }, strikeAt: 0.25, strikeRadius: 2.8, strikeArc: 0.25, strikeMult: 2, burst: 16 },
    ] }),
  M({ key: "rapidJabs", label: "Rapid Jabs", desc: "A flurry of lightning jabs.", slot: "attackGround", cooldown: 0.8,
    phases: [
      { dur: 0.16, keepMomentum: true, pose: { shR: [-1.6, -0.05], elR: -0.1, yaw: -0.3 }, strikeAt: 0.5, strikeRadius: 2.2, strikeArc: 0.4, strikeMult: 0.6 },
      { dur: 0.16, keepMomentum: true, pose: { shL: [-1.6, 0.05], elL: -0.1, yaw: 0.3 }, strikeAt: 0.5, strikeRadius: 2.2, strikeArc: 0.4, strikeMult: 0.6 },
      { dur: 0.16, keepMomentum: true, pose: { shR: [-1.65, -0.05], elR: -0.05, yaw: -0.32 }, strikeAt: 0.5, strikeRadius: 2.2, strikeArc: 0.4, strikeMult: 0.7 },
      { dur: 0.2, keepMomentum: true, pose: { shL: [-1.7, 0.05], elL: -0.05, yaw: 0.34 }, strikeAt: 0.5, strikeRadius: 2.3, strikeArc: 0.4, strikeMult: 0.9, burst: 8 },
    ] }),
  M({ key: "spinningBackfist", label: "Spinning Backfist", desc: "A full 360° turn into a heavy backfist.", slot: "attackGround", cooldown: 0.7,
    phases: [{ dur: 0.42, spinY: 1, pose: { shR: [0.3, -1.5], elR: -0.15, shL: [0.6, 0.4], pitch: 0.1 }, strikeAt: 0.6, strikeRadius: 2.7, strikeArc: 0, strikeMult: 1.7, burst: 12 }] }),
  M({ key: "shoulderBash", label: "Shoulder Bash", desc: "A short lunging shoulder check.", slot: "attackGround", cooldown: 0.6,
    phases: [{ dur: 0.3, fwdMul: 1.4, pose: { yaw: -0.5, shR: [-0.9, -0.5], shL: [0.9, 0.3], pitch: 0.35 }, strikeAt: 0.4, strikeRadius: 2.2, strikeArc: 0.35, strikeMult: 1.4, trail: true }] }),

  // ============ attackAir — J in air ============
  M({ key: "spinAttack", label: "Spin Attack", desc: "A 720° arms-out cyclone — hits everything around.", slot: "attackAir",
    phases: [{ dur: 0.55, spinY: 2, hover: true, pose: T_POSE, strikeAt: 0.45, strikeRadius: 3.1, strikeArc: -1, strikeMult: 1.2, trail: true }] }),
  M({ key: "skyUppercut", label: "Sky Uppercut", desc: "A rising uppercut that carries you higher — attack AND traversal.", slot: "attackAir", oncePerAir: true,
    phases: [{ dur: 0.4, vyImpulse: 9, pose: { shR: [-2.9, -0.1], elR: -0.3, shL: [0.8, 0.3], pitch: -0.2, kneeL: 1, kneeR: 0.7, hipL: [-0.5, 0], hipR: [-0.2, 0] }, strikeAt: 0.3, strikeRadius: 2.4, strikeArc: 0.2, strikeMult: 1.5, trail: true }] }),
  M({ key: "diveElbow", label: "Dive Elbow", desc: "Drop an elbow from the heavens.", slot: "attackAir",
    phases: [{ dur: 2.5, until: "ground", vyHold: -22, pose: { shR: [-0.6, -1.2], elR: -2.2, shL: [-1.2, 0.5], pitch: 0.4, kneeL: 0.8, kneeR: 0.5 }, onGround: { shock: true, burst: 30, strikeRadius: 3.5, strikeMult: 1.7 } }] }),
  M({ key: "homingStrike", label: "Homing Strike", desc: "Lock on and rocket into the nearest target — the classic.", slot: "attackAir", oncePerAir: true, cooldown: 0.4,
    phases: [{ dur: 0.55, homing: true, fwdMul: 2.6, spinX: 2, pose: TUCK, trail: true, strikeAt: 0.99, strikeRadius: 2.2, strikeArc: -1, strikeMult: 1.5 }] }),

  // ============ kickGround — K ============
  M({ key: "kick", label: "Roundhouse", desc: "A clean high roundhouse.", slot: "kickGround",
    phases: [{ dur: 0.38, keepMomentum: true, pose: { hipR: [-1.8, -0.12], kneeR: 0.12, hipL: [0.25, 0], shL: [0.2, 0.9], shR: [0.2, -0.9], pitch: -0.3, yaw: 0.3 }, strikeAt: 0.5, strikeRadius: 2.7, strikeArc: 0.3, strikeMult: 1.35 }] }),
  M({ key: "sweepKick", label: "Sweep Kick", desc: "Drop and sweep the legs, full circle.", slot: "kickGround", cooldown: 0.7,
    phases: [{ dur: 0.5, spinY: 1, stretch: 0.7, pose: { hipR: [-1.5, -0.3], kneeR: 0.1, hipL: [-0.9, 0.2], kneeL: 1.5, shL: [0.5, 0.6], shR: [0.5, -0.6], pitch: 0.2 }, strikeAt: 0.5, strikeRadius: 2.9, strikeArc: -1, strikeMult: 1.1 }] }),
  M({ key: "flipKick", label: "Flip Kick", desc: "Backflip with a rising heel — launches you slightly.", slot: "kickGround", cooldown: 0.6,
    phases: [{ dur: 0.5, vyImpulse: 6.5, spinX: -1, pose: { hipR: [-2, 0], kneeR: 0.2, hipL: [-0.6, 0], kneeL: 1.2, shL: [-1, 0.4], shR: [-1, -0.4] }, strikeAt: 0.3, strikeRadius: 2.4, strikeArc: 0.2, strikeMult: 1.4 }] }),
  M({ key: "axeKick", label: "Axe Kick", desc: "Heel up high, then straight down like a guillotine.", slot: "kickGround", cooldown: 0.8,
    phases: [
      { dur: 0.28, pose: { hipR: [-2.6, -0.05], kneeR: 0.1, pitch: -0.2, shL: [0.4, 0.5], shR: [0.4, -0.5] } },
      { dur: 0.25, pose: { hipR: [-0.2, -0.05], kneeR: 0.05, pitch: 0.4 }, strikeAt: 0.3, strikeRadius: 2.3, strikeArc: 0.3, strikeMult: 1.8, burst: 12 },
    ] }),
  M({ key: "breakdanceKick", label: "Breakdance", desc: "Low spinning kicks — style and reach.", slot: "kickGround", cooldown: 0.9,
    phases: [{ dur: 0.7, spinY: 2, stretch: 0.65, pose: { hipL: [-1.2, 0.5], hipR: [-1.2, -0.5], kneeL: 0.3, kneeR: 0.3, shL: [-0.5, 0.8], shR: [-0.5, -0.8], pitch: 0.3 }, strikeAt: 0.4, strikeRadius: 2.8, strikeArc: -1, strikeMult: 1.2, trail: true }] }),

  // ============ kickAir — K in air ============
  M({ key: "diveKick", label: "Dive Kick", desc: "A flying kick that surges forward.", slot: "kickAir",
    phases: [{ dur: 0.45, fwdMul: 1.35, vyHold: -2, pose: { hipL: [-1.3, 0.08], hipR: [-1, -0.08], kneeL: 0.18, kneeR: 0.35, shL: [0.9, 0.5], shR: [0.9, -0.5], pitch: 0.5 }, strikeAt: 0.35, strikeRadius: 2.5, strikeArc: 0.25, strikeMult: 1.45 }] }),
  M({ key: "hurricaneKick", label: "Hurricane Kick", desc: "Spinning kicks that hover — a whirlwind of heels.", slot: "kickAir", cooldown: 0.6,
    phases: [{ dur: 0.6, hover: true, spinY: 2.5, pose: { hipR: [-1.4, -0.4], kneeR: 0.15, hipL: [-0.5, 0.2], kneeL: 0.9, shL: [0.2, 1.1], shR: [0.2, -1.1] }, strikeAt: 0.4, strikeRadius: 2.9, strikeArc: -1, strikeMult: 1.15, trail: true }] }),
  M({ key: "flyingKnee", label: "Flying Knee", desc: "Drive a knee forward with a hop of lift.", slot: "kickAir", oncePerAir: true,
    phases: [{ dur: 0.35, fwdMul: 1.2, vyImpulse: 4, pose: { hipR: [-1.9, -0.05], kneeR: 1.9, hipL: [0.5, 0], shL: [-0.8, 0.3], shR: [0.6, -0.3], pitch: 0.25 }, strikeAt: 0.4, strikeRadius: 2.1, strikeArc: 0.35, strikeMult: 1.5 }] }),
  M({ key: "stompKick", label: "Stomp Kick", desc: "Both heels straight down — a mini pound with feet.", slot: "kickAir",
    phases: [{ dur: 2.5, until: "ground", vyHold: -20, pose: { hipL: [-0.4, 0.1], hipR: [-0.4, -0.1], kneeL: 0.2, kneeR: 0.2, shL: [-1.2, 0.5], shR: [-1.2, -0.5], pitch: -0.1 }, onGround: { vySet: 6, burst: 18, strikeRadius: 2.6, strikeMult: 1.2 } }] }),

  // ============ passive — automatic ============
  M({ key: "rollLanding", label: "Roll Landing", desc: "Hard landings become forward rolls — keep your speed.", slot: "passive",
    phases: [{ dur: 0.38, keepMomentum: true, spinX: 1, pose: TUCK, stretch: 0.85 }] }),
  M({ key: "skidFlash", label: "Stylish Skid", desc: "Reversals at speed become a proper drift-skid with dust.", slot: "passive",
    phases: [{ dur: 0.22, keepMomentum: true, pose: { pitch: -0.35, shL: [-0.9, 0.5], shR: [-0.9, -0.5], kneeL: 0.8, kneeR: 0.8 }, burst: 10 }] }),
];

const BY_KEY = new Map(MOVE_CATALOG.map((m) => [m.key, m]));

export function getMove(key: string): MoveSpec | undefined {
  return BY_KEY.get(key);
}

export function allMoveKeys(): string[] {
  return MOVE_CATALOG.map((m) => m.key);
}

/** Hidden combo links aren't equipable on their own. */
export function equipableMoves(): MoveSpec[] {
  return MOVE_CATALOG.filter((m) => m.key !== "punch2" && m.key !== "punch3");
}

/** Base kit used when a slot has nothing equipped. */
export const DEFAULT_SLOTS: Partial<Record<SlotKey, string>> = {
  attackGround: "punchCombo",
  kickGround: "kick",
  kickAir: "diveKick",
};

/** Resolve a character's flat move list into one spec per slot (+passives). */
export function resolveLoadout(moveKeys: string[]): {
  slots: Partial<Record<SlotKey, MoveSpec>>;
  passives: MoveSpec[];
} {
  const slots: Partial<Record<SlotKey, MoveSpec>> = {};
  const passives: MoveSpec[] = [];
  for (const key of moveKeys) {
    const spec = BY_KEY.get(key);
    if (!spec) continue;
    if (spec.slot === "passive") passives.push(spec);
    else if (!slots[spec.slot]) slots[spec.slot] = spec; // first equipped wins
  }
  for (const [slot, key] of Object.entries(DEFAULT_SLOTS) as Array<[SlotKey, string]>) {
    if (!slots[slot]) slots[slot] = BY_KEY.get(key);
  }
  return { slots, passives };
}

/** Legacy saved keys → current keys (old saves keep working). */
export function migrateMoveKeys(keys: string[]): string[] {
  const out: string[] = [];
  for (const k of keys) {
    if (k === "dash") out.push("dash", "airDash");
    else if (BY_KEY.has(k)) out.push(k);
  }
  return [...new Set(out)];
}
