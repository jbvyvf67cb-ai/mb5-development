// Player capsule controller (Play mode) — parameterized by a CharacterData.
//
// Joshua's approach at the core: a Havok capsule with locked rotation and zero
// friction, moved by reading and rewriting linear velocity each frame (never
// forces); camera-relative WASD; coyote-time + jump-buffer jumping with
// variable height.
//
// Special moves are DATA (src/character/moves.ts): the character's equipped
// loadout resolves to one MoveSpec per trigger slot, and ONE interpreter here
// executes every move's physics phases — forward bursts, vertical holds,
// until-ground slams, blinks, homing, strike windows, spins. The rig plays the
// same specs' ChannelPose keyframes, so any of the 50+ moves works on any
// character with zero per-move code.

import { MeshBuilder, PhysicsAggregate, PhysicsShapeType, Ray } from "@babylonjs/core";
import type { AbstractMesh, Scene } from "@babylonjs/core";
import { Vector3 } from "@babylonjs/core";
import type { InputState } from "../core/input";
import { deriveMovement, type CharacterData } from "../character/schema";
import { getMove, resolveLoadout, type ChannelPose, type MoveSpec, type SlotKey } from "../character/moves";
import type { LevelPhysics } from "../world/schema";

const COYOTE = 0.12;
const JUMP_BUFFER = 0.12;
// Action inputs (dash/attack/kick/power) buffer briefly too — a press just
// before landing or just before a move ends still fires. Input leniency is
// half of what "fluid" means.
const MOVE_BUFFER = 0.16;
// Game-feel: arcs are asymmetric — normal gravity up, heavy gravity down, and
// releasing jump early cuts the rise. Snappy, Mario-style.
const FALL_GRAVITY_EXTRA = -20; // added while falling
const JUMPCUT_GRAVITY_EXTRA = -30; // added while rising with jump released
const TERMINAL_VY = -32; // no tunneling at low frame rates
const STRIDE = 2.1; // meters of travel per full run cycle (keeps feet planted)
const TAU = Math.PI * 2;
const ROLL_IMPACT = 9; // landing speed that triggers the rollLanding passive
const PASSIVE_COOLDOWN = 0.8;

export type AvatarPose = "idle" | "run" | "jump" | "fall" | "dash" | "pound" | "glide";

export interface StrikeOpts {
  power: number;
  radius: number;
  /** Min dot(strike dir, target dir); -1 = 360°. */
  arc: number;
}

/** A move mid-execution. */
interface ActiveMove {
  spec: MoveSpec;
  phase: number;
  t: number; // seconds into the current phase
  dirX: number;
  dirZ: number;
  struck: boolean; // strike fired this phase
  started: boolean; // phase-start one-shots applied
  spinXBase: number; // accumulated turns (radians) from completed phases
  spinYBase: number;
  chainQueued: boolean;
}

const ease = (t: number) => t * t * (3 - 2 * t);

export class PlayerController {
  capsule: ReturnType<typeof MeshBuilder.CreateCapsule>;
  aggregate: PhysicsAggregate;
  grounded = false;
  /** Yaw the player is moving toward (for the chase camera + dash direction). */
  facing = 0;
  /** Resolved pose for the avatar rig. */
  pose: AvatarPose = "idle";
  /** Accumulates with ground travel — drives the run-cycle frame. */
  runPhase = 0;
  /** Current horizontal speed (m/s). */
  hSpeed = 0;
  /** True exactly on the frame the player touches down. */
  justLanded = false;
  /** |vy| at the moment of the last landing (for squash + dust). */
  landImpact = 0;
  /** Current vertical velocity (read by the avatar for stretch). */
  vy = 0;
  /** True while a move wants a speed trail (for effects/FOV). */
  get isDashing(): boolean {
    return this.trailActive;
  }
  pounding = false; // an until-ground power move is active
  /** True while a hold-Space fall move (glide family) is engaged. */
  gliding = false;
  /** Helicopter-ears flag for the rig (from the active/hold move). */
  earSpin = false;
  /** The active move's ChannelPose for the rig (null = base pose only). */
  movePose: ChannelPose | null = null;
  /** Blend amount for movePose. */
  moveA = 0;
  /** Stretch requested by the move phase (undefined = avatar's own envelope). */
  moveStretch: number | undefined;
  /** Absolute spin angles for the rig (radians; undefined = settle home). */
  spinX: number | undefined;
  spinY: number | undefined;

  /** Fired when an until-ground move lands with a shockwave. */
  onShock?: (pos: Vector3) => void;
  /** Fired for particle bursts (count scales with the move). */
  onBurst?: (pos: Vector3, count: number) => void;
  /** Fired at a strike window (dir = move/facing at the strike). */
  onStrike?: (pos: Vector3, dirX: number, dirZ: number, opts: StrikeOpts) => void;
  /** Homing moves ask for the nearest target (enemy/prop) within maxDist. */
  onQueryTarget?: (pos: Vector3, maxDist: number) => Vector3 | null;

  readonly mv: ReturnType<typeof deriveMovement>;
  private loadout: ReturnType<typeof resolveLoadout>;

  private coyote = 0;
  private buffer = 0;
  private dashBuf = 0;
  private atkBuf = 0;
  private kickBuf = 0;
  private powBuf = 0;
  private sinceGrounded = 0; // seconds since last solid ground contact
  private active: ActiveMove | null = null;
  private cooldowns: Record<string, number> = {};
  private airUses: Record<string, number> = {}; // per-airtime move counters
  private homingTarget: Vector3 | null = null;
  private clingT = -1; // >=0 while clinging to a wall
  private clingNx = 0;
  private clingNz = 0;
  private trailActive = false;
  private jumpRising = false; // current ascent came from a player jump (gates jump-cut/boost)
  private prevGrounded = true;
  private down = new Vector3(0, -1, 0);
  // Ray captures the direction Vector3 BY REFERENCE — the wall probe and the
  // ground probe must never share one (Scout's wall-jump check once rotated
  // `down` sideways permanently, freezing him in the fall pose after any
  // mid-air jump press). Separate rays, each with its own direction instance.
  private ray = new Ray(Vector3.Zero(), new Vector3(0, -1, 0), 1);
  private wallRay = new Ray(Vector3.Zero(), new Vector3(1, 0, 0), 1);

  constructor(
    private scene: Scene,
    spawn: Vector3,
    readonly character: CharacterData,
    physics: LevelPhysics = {},
  ) {
    // Level physics multiply the character's derived numbers, so per-level
    // feel (moon level, speed level) composes with per-character stats.
    const base = deriveMovement(character);
    const run = physics.runMultiplier ?? 1;
    const jump = physics.jumpMultiplier ?? 1;
    const air = physics.airControl ?? 1;
    this.mv = {
      ...base,
      runSpeed: base.runSpeed * run,
      dashSpeed: base.dashSpeed * run,
      jumpVelocity: base.jumpVelocity * jump,
      doubleJumpVelocity: base.doubleJumpVelocity * jump,
      airAccel: base.airAccel * air,
    };
    this.loadout = resolveLoadout(character.moves);
    this.capsule = MeshBuilder.CreateCapsule(
      "player",
      { radius: this.mv.capsuleRadius, height: this.mv.capsuleHeight },
      scene,
    );
    this.capsule.position.copyFrom(spawn);
    this.capsule.isVisible = false; // the CharacterRig is the visible body
    this.aggregate = new PhysicsAggregate(
      this.capsule,
      PhysicsShapeType.CAPSULE,
      { mass: this.mv.mass, friction: 0, restitution: 0 },
      scene,
    );
    // Lock rotation so the capsule never tips.
    this.aggregate.body.setMassProperties({ inertia: new Vector3(0, 0, 0) });
    this.aggregate.body.setAngularDamping(1);
  }

  get position(): Vector3 {
    return this.capsule.position;
  }

  /** Launch vertically (springs). Refreshes air moves like a fresh jump. */
  bounce(vy: number) {
    const v = this.aggregate.body.getLinearVelocity();
    this.aggregate.body.setLinearVelocity(new Vector3(v.x, vy, v.z));
    this.active = null; // a spring beats any move in progress
    this.clingT = -1;
    this.jumpRising = false; // spring rises decay at pure gravity (no jump-cut)
    this.airUses = {};
  }

  /** Set horizontal velocity (boost pads). */
  impulse(vx: number, vz: number) {
    const v = this.aggregate.body.getLinearVelocity();
    this.aggregate.body.setLinearVelocity(new Vector3(vx, v.y, vz));
    if (Math.hypot(vx, vz) > 0.5) this.facing = Math.atan2(vx, vz);
  }

  /** Shift position without touching velocity (moving-platform carry). */
  nudge(delta: Vector3) {
    this.capsule.position.addInPlace(delta);
    this.aggregate.body.disablePreStep = false;
    this.scene.onAfterRenderObservable.addOnce(() => {
      this.aggregate.body.disablePreStep = true;
    });
  }

  teleport(p: Vector3) {
    this.capsule.position.copyFrom(p);
    this.aggregate.body.setLinearVelocity(Vector3.Zero());
    this.aggregate.body.setAngularVelocity(Vector3.Zero());
    this.active = null;
    this.clingT = -1;
    this.gliding = false;
    this.jumpRising = false;
    this.prevGrounded = true; // don't fire a phantom landing at the respawn point
    this.vy = 0;
    this.landImpact = 0;
    // Force the physics body to read the mesh transform for one step (otherwise
    // the dynamic body's cached pose snaps the capsule straight back).
    this.aggregate.body.disablePreStep = false;
    this.scene.onAfterRenderObservable.addOnce(() => {
      this.aggregate.body.disablePreStep = true;
    });
  }

  private checkGround(): boolean {
    const p = this.capsule.position;
    // Margin must cover steep slopes: resting on an incline, the capsule's
    // contact is on the side of its bottom sphere, so the surface directly
    // below the center is up to r/cos(θ) away (~+0.5 m at 60°). A 0.35 margin
    // left players "standing in mid-air" on steep beaches — frozen in the
    // fall pose with no jumps.
    const reach = this.mv.capsuleHeight / 2 + 0.35 + this.mv.capsuleRadius * 0.55;
    const offs = this.mv.capsuleRadius * 0.7;
    const pts: Array<[number, number]> = [
      [0, 0],
      [offs, 0],
      [-offs, 0],
      [0, offs],
      [0, -offs],
    ];
    for (const [dx, dz] of pts) {
      this.ray.origin.set(p.x + dx, p.y, p.z + dz);
      this.ray.direction.copyFrom(this.down);
      this.ray.length = reach;
      const hit = this.scene.pickWithRay(this.ray, (m: AbstractMesh) => m !== this.capsule && m.isPickable);
      if (hit?.hit) return true;
    }
    return false;
  }

  /** Horizontal wall probe (4 cardinal rays at chest height) → away-from-wall normal. */
  private checkWall(): { nx: number; nz: number } | null {
    const p = this.capsule.position;
    const reach = this.mv.capsuleRadius + 0.22;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      this.wallRay.origin.set(p.x, p.y, p.z);
      this.wallRay.direction.set(dx, 0, dz);
      this.wallRay.length = reach;
      const hit = this.scene.pickWithRay(this.wallRay, (m: AbstractMesh) => m !== this.capsule && m.isPickable);
      if (hit?.hit) {
        const n = hit.getNormal(true);
        if (n && Math.hypot(n.x, n.z) > 0.4) return { nx: n.x, nz: n.z };
        return { nx: -dx, nz: -dz };
      }
    }
    return null;
  }

  /** How far forward the player can blink without ending up inside a wall. */
  private blinkDistance(dirX: number, dirZ: number, want: number): number {
    const p = this.capsule.position;
    this.wallRay.origin.set(p.x, p.y, p.z);
    this.wallRay.direction.set(dirX, 0, dirZ);
    this.wallRay.length = want + this.mv.capsuleRadius;
    const hit = this.scene.pickWithRay(this.wallRay, (m: AbstractMesh) => m !== this.capsule && m.isPickable);
    if (hit?.hit && hit.distance < want + this.mv.capsuleRadius) {
      return Math.max(0, hit.distance - this.mv.capsuleRadius - 0.1);
    }
    return want;
  }

  // ---------- the move interpreter ----------

  private slotSpec(slot: SlotKey): MoveSpec | undefined {
    return this.loadout.slots[slot];
  }

  /** Cooldown/air-use gate, then activate. */
  private tryStart(spec: MoveSpec | undefined, dirX: number, dirZ: number): boolean {
    if (!spec) return false;
    if ((this.cooldowns[spec.key] ?? 0) > 0) return false;
    const limit = spec.oncePerAir ? 1 : spec.airUses;
    if (limit !== undefined && !this.grounded) {
      const used = this.airUses[spec.key] ?? 0;
      if (used >= limit) return false;
      this.airUses[spec.key] = used + 1;
    }
    this.active = {
      spec,
      phase: 0,
      t: 0,
      dirX,
      dirZ,
      struck: false,
      started: false,
      spinXBase: 0,
      spinYBase: 0,
      chainQueued: false,
    };
    this.gliding = false;
    if (spec.phases[0]?.homing) {
      this.homingTarget = this.onQueryTarget?.(this.position, 16) ?? null;
    }
    return true;
  }

  private endActive() {
    const spec = this.active?.spec;
    if (spec) {
      this.cooldowns[spec.key] = Math.max(spec.cooldown ?? 0, spec.slot === "passive" ? PASSIVE_COOLDOWN : 0);
    }
    this.active = null;
    this.homingTarget = null;
  }

  /** The direction a starting move should burst toward. */
  private moveDir(targetX: number, targetZ: number, mag: number): [number, number] {
    if (mag > 0.15) {
      const l = Math.hypot(targetX, targetZ) || 1;
      return [targetX / l, targetZ / l];
    }
    return [Math.sin(this.facing), Math.cos(this.facing)];
  }

  update(dt: number, input: InputState, camYaw: number) {
    const vel = this.aggregate.body.getLinearVelocity();

    // Camera-relative wish direction.
    const fwdX = Math.sin(camYaw);
    const fwdZ = Math.cos(camYaw);
    const rightX = Math.cos(camYaw);
    const rightZ = -Math.sin(camYaw);
    const mag = Math.min(1, Math.hypot(input.moveX, input.moveZ));
    const speed = this.mv.runSpeed * mag;
    const targetX = (fwdX * input.moveZ + rightX * input.moveX) * speed;
    const targetZ = (fwdZ * input.moveZ + rightZ * input.moveX) * speed;

    const vyNow = vel.y;
    // An upward vertical hold (pound windup hang, wall run) must not read as
    // "grounded" even if a surface is near the feet.
    const act0 = this.active;
    const curPhase = act0 ? act0.spec.phases[act0.phase] : undefined;
    const holdingUp = !!curPhase && curPhase.vyHold !== undefined && curPhase.vyHold > -1 && !curPhase.until;
    const nearGround = this.checkGround();
    this.grounded = nearGround && vyNow < 2 && !holdingUp && this.clingT < 0;
    this.justLanded = this.grounded && !this.prevGrounded;
    if (this.justLanded) this.landImpact = Math.abs(this.vy);
    this.prevGrounded = this.grounded;
    if (this.grounded) this.airUses = {};

    // Face the movement direction.
    if (mag > 0.1 && this.clingT < 0) {
      const tf = Math.atan2(targetX, targetZ);
      this.facing = lerpAngle(this.facing, tf, Math.min(1, dt * 10));
    }

    for (const k of Object.keys(this.cooldowns)) {
      this.cooldowns[k] = Math.max(0, this.cooldowns[k] - dt);
    }
    // coyote/buffer tick every frame (freezing them inside one branch caused
    // phantom buffered jumps after dashes/pounds)
    this.coyote = this.grounded ? COYOTE : Math.max(0, this.coyote - dt);
    // A press DURING a move is a queued intent — it must survive until the
    // move's cancel window opens, not evaporate on the normal buffer clock.
    const qb = this.active ? 0.6 : MOVE_BUFFER;
    this.buffer = input.jumpPressed ? (this.active ? 0.6 : JUMP_BUFFER) : Math.max(0, this.buffer - dt);
    this.dashBuf = input.dashPressed ? qb : Math.max(0, this.dashBuf - dt);
    this.atkBuf = input.attackPressed ? qb : Math.max(0, this.atkBuf - dt);
    this.kickBuf = input.kickPressed ? qb : Math.max(0, this.kickBuf - dt);
    this.powBuf = input.poundPressed ? qb : Math.max(0, this.powBuf - dt);
    this.sinceGrounded = this.grounded ? 0 : this.sinceGrounded + dt;

    // ---------- move triggers ----------
    const A = this.active;
    const [mdX, mdZ] = this.moveDir(targetX, targetZ, mag);

    // Chain combos: pressing the slot's button again in the last 40% of the
    // current move chains into the follow-up (punch1 → punch2 → punch3).
    if (A && A.spec.chain && !A.chainQueued) {
      const slot = A.spec.slot;
      const pressedAgain =
        ((slot === "attackGround" || slot === "attackAir") && input.attackPressed) ||
        ((slot === "kickGround" || slot === "kickAir") && input.kickPressed) ||
        ((slot === "dashGround" || slot === "dashAir") && input.dashPressed) ||
        ((slot === "powerGround" || slot === "powerAir") && input.poundPressed);
      const ph = A.spec.phases[A.phase];
      if (pressedAgain && A.phase === A.spec.phases.length - 1 && A.t / ph.dur > 0.4) {
        A.chainQueued = true;
      }
    }

    // Cancel windows: once a move's hit is out (struck) or it's ~60% done, a
    // buffered jump or dash ends the recovery early — actions flow one into
    // the next instead of waiting out full durations. Slam phases
    // (until:"ground") stay committed until touchdown.
    if (this.active) {
      const c = this.active;
      const cp = c.spec.phases[c.phase];
      const done = c.struck || c.t / cp.dur > 0.6;
      if (cp.until !== "ground" && done && (this.buffer > 0 || this.dashBuf > 0)) {
        this.endActive();
      }
    }

    if (!this.active && this.clingT < 0) {
      // Slot context is NOT raw grounded — heavy characters' capsules jitter
      // (depenetration vy spikes read as airborne for a frame), and a J
      // pressed while "standing" must fire the ground move. Ground context =
      // grounded, OR a floor under the feet without a real jump/launch, OR
      // grounded a blink ago.
      const onGround =
        this.grounded ||
        (nearGround && !this.jumpRising && vyNow < 5) ||
        (this.sinceGrounded < 0.25 && !this.jumpRising && this.vy < 3);
      if (this.dashBuf > 0 && this.tryStart(this.slotSpec(onGround ? "dashGround" : "dashAir"), mdX, mdZ)) {
        this.dashBuf = 0;
      }
      if (!this.active && this.powBuf > 0 && this.tryStart(this.slotSpec(onGround ? "powerGround" : "powerAir"), mdX, mdZ)) {
        this.powBuf = 0;
      }
      if (!this.active && this.atkBuf > 0 && this.tryStart(this.slotSpec(onGround ? "attackGround" : "attackAir"), mdX, mdZ)) {
        this.atkBuf = 0;
      }
      if (!this.active && this.kickBuf > 0 && this.tryStart(this.slotSpec(onGround ? "kickGround" : "kickAir"), mdX, mdZ)) {
        this.kickBuf = 0;
      }
      // passives fire here, BEFORE steering decel eats the landing frame —
      // a roll that "keeps momentum" must grab the touchdown velocity.
      if (!this.active) {
        const revNow = vel.x * targetX + vel.z * targetZ < -0.1;
        for (const p of this.loadout.passives) {
          if ((this.cooldowns[p.key] ?? 0) > 0) continue;
          if (
            p.key === "rollLanding" &&
            this.justLanded &&
            this.landImpact > ROLL_IMPACT &&
            this.hSpeed > this.mv.runSpeed * 0.45
          ) {
            this.tryStart(p, Math.sin(this.facing), Math.cos(this.facing));
            break;
          }
          if (p.key === "skidFlash" && this.grounded && revNow && this.hSpeed > this.mv.runSpeed * 0.7) {
            this.tryStart(p, Math.sin(this.facing), Math.cos(this.facing));
            break;
          }
        }
      }
    }

    let vx: number;
    let vz: number;
    let vy = vyNow;
    this.trailActive = false;
    this.earSpin = false;
    this.gliding = false;
    this.movePose = null;
    this.moveA = 0;
    this.moveStretch = undefined;
    this.spinX = undefined;
    this.spinY = undefined;
    let burstFx = 0;

    // ---------- wall cling ----------
    if (this.clingT >= 0) {
      this.clingT += dt;
      const spec = this.slotSpec("wall");
      const ph = spec?.phases[0];
      vx = -this.clingNx * 0.5; // press into the wall
      vz = -this.clingNz * 0.5;
      vy = -0.4; // slow slide
      this.facing = Math.atan2(this.clingNx, this.clingNz);
      if (ph?.pose) {
        this.movePose = ph.pose;
        this.moveA = 1;
      }
      if (input.jumpPressed) {
        // leap away
        vy = this.mv.jumpVelocity * 0.95;
        vx = this.clingNx * this.mv.runSpeed * 0.85;
        vz = this.clingNz * this.mv.runSpeed * 0.85;
        this.jumpRising = true;
        this.buffer = 0;
        this.airUses = {};
        this.clingT = -1;
      } else if (this.clingT > (ph?.dur ?? 1.6) || this.grounded || !this.checkWall()) {
        this.clingT = -1; // grip gives out
      }
      this.aggregate.body.setLinearVelocity(new Vector3(vx, vy, vz));
      this.vy = vy;
      this.finishFrame(vx, vz, dt);
      return;
    }

    // ---------- active move execution ----------
    if (this.active) {
      const act = this.active;
      const spec = act.spec;
      let ph = spec.phases[act.phase];

      // phase-start one-shots
      if (!act.started) {
        act.started = true;
        act.struck = false;
        if (ph.vyImpulse !== undefined || ph.vyImpulseMul !== undefined) {
          vy = ph.vyImpulse ?? this.mv.jumpVelocity * (ph.vyImpulseMul ?? 0);
          if (vy > 0) this.jumpRising = true;
        }
        if (ph.blink) {
          const d = this.blinkDistance(act.dirX, act.dirZ, ph.blink);
          this.capsule.position.addInPlaceFromFloats(act.dirX * d, 0, act.dirZ * d);
          this.aggregate.body.disablePreStep = false;
          this.scene.onAfterRenderObservable.addOnce(() => {
            this.aggregate.body.disablePreStep = true;
          });
        }
        if (ph.burst) burstFx = ph.burst;
      }

      act.t += dt;
      const frac = Math.min(1, act.t / ph.dur);

      // homing: re-aim the whole velocity at the target
      if (ph.homing && this.homingTarget) {
        const to = this.homingTarget.subtract(this.position);
        const dist = to.length();
        if (dist > 0.3) {
          to.scaleInPlace(1 / dist);
          act.dirX = to.x;
          act.dirZ = to.z;
        }
      }

      // horizontal
      const sp =
        ph.fwd !== undefined ? ph.fwd : ph.fwdMul !== undefined ? this.mv.runSpeed * ph.fwdMul : undefined;
      if (sp !== undefined) {
        // steering during committed movement (0 = locked, 1 = free)
        if (ph.steer && mag > 0.15) {
          const want = Math.atan2(targetX, targetZ);
          const cur = Math.atan2(act.dirX, act.dirZ);
          const turned = lerpAngle(cur, want, Math.min(1, dt * 6 * ph.steer));
          act.dirX = Math.sin(turned);
          act.dirZ = Math.cos(turned);
        }
        vx = act.dirX * sp;
        vz = act.dirZ * sp;
        if (sp > 0.5) this.facing = Math.atan2(act.dirX, act.dirZ);
      } else if (ph.keepMomentum) {
        vx = vel.x;
        vz = vel.z;
      } else {
        // feet planted: damped steering, like the old grounded attacks
        const accel = (this.grounded ? this.mv.groundAccel : this.mv.airAccel) * 0.35 * dt;
        vx = vel.x + clamp(targetX - vel.x, -accel, accel);
        vz = vel.z + clamp(targetZ - vel.z, -accel, accel);
      }

      // vertical (homing overrides to fly straight at the target)
      if (ph.homing && this.homingTarget && sp !== undefined) {
        const dy = this.homingTarget.y - this.position.y;
        vy = clamp(dy * 3, -10, 9);
      } else if (ph.hover) {
        vy = 0;
      } else if (ph.vyHold !== undefined) {
        vy = ph.vyHold;
      } else if (!this.grounded) {
        if (vy < 0) {
          // apex float: ease into the heavy fall gravity so the top of the
        // arc hangs a beat (an aiming window) instead of snapping downward
        const gk = Math.min(1, 0.35 + (-vy / 3) * 0.65);
        vy = Math.max(TERMINAL_VY, vy + FALL_GRAVITY_EXTRA * gk * dt);
          this.jumpRising = false;
        } else if (!input.jumpHeld && this.jumpRising) {
          vy += JUMPCUT_GRAVITY_EXTRA * dt;
        }
      }
      if (ph.vyMin !== undefined) vy = Math.max(vy, ph.vyMin);

      // strike window
      if (!act.struck && ph.strikeAt !== undefined && frac >= ph.strikeAt) {
        act.struck = true;
        this.onStrike?.(this.position.clone(), act.dirX, act.dirZ, {
          power: this.mv.strikePower * (ph.strikeMult ?? 1),
          radius: ph.strikeRadius ?? 2.3,
          arc: ph.strikeArc ?? 0.3,
        });
      }

      this.trailActive = !!ph.trail;
      this.earSpin = !!spec.earSpin;
      if (ph.pose) {
        this.movePose = ph.pose;
        this.moveA = ease(Math.min(1, act.t / 0.07)); // snap in, joints lerp the rest
      }
      this.moveStretch = ph.stretch;
      // spins: eased progress through this phase's turns, on top of finished phases
      if (ph.spinX !== undefined || act.spinXBase !== 0) {
        this.spinX = act.spinXBase + ease(frac) * (ph.spinX ?? 0) * TAU;
      }
      if (ph.spinY !== undefined || act.spinYBase !== 0) {
        this.spinY = act.spinYBase + ease(frac) * (ph.spinY ?? 0) * TAU;
      }

      // until-ground landing?
      const landedNow = ph.until === "ground" && this.grounded && this.vy < -1;
      if (landedNow) {
        const g = ph.onGround;
        const feet = this.position.clone().addInPlaceFromFloats(0, -this.mv.capsuleHeight / 2, 0);
        if (g?.vySet !== undefined) {
          vy = g.vySet;
          this.jumpRising = false;
        }
        if (g?.shock) this.onShock?.(feet);
        if (g?.burst) burstFx = Math.max(burstFx, g.burst);
        if (g?.strikeRadius) {
          this.onStrike?.(this.position.clone(), Math.sin(this.facing), Math.cos(this.facing), {
            power: this.mv.strikePower * (g.strikeMult ?? 1),
            radius: g.strikeRadius,
            arc: -1,
          });
        }
        this.buffer = 0; // a jump buffered before the slam must not fire on landing
      }

      // phase end / chain
      if (landedNow || act.t >= ph.dur) {
        act.spinXBase += (ph.spinX ?? 0) * TAU;
        act.spinYBase += (ph.spinY ?? 0) * TAU;
        if (act.phase < spec.phases.length - 1 && !landedNow) {
          act.phase++;
          act.t = 0;
          act.started = false;
          act.struck = false;
          ph = spec.phases[act.phase];
        } else if (act.phase < spec.phases.length - 1 && landedNow) {
          // slam phases that land continue into their follow-through phase
          act.phase++;
          act.t = 0;
          act.started = false;
          act.struck = false;
        } else if (act.chainQueued && spec.chain) {
          const next = getMove(spec.chain);
          this.endActive();
          if (next) this.tryStart(next, mdX, mdZ);
        } else {
          this.endActive();
        }
      }
      if (burstFx > 0) this.onBurst?.(this.position.clone(), burstFx);
      this.aggregate.body.setLinearVelocity(new Vector3(vx, vy, vz));
      this.vy = vy;
      this.finishFrame(vx, vz, dt);
      return;
    }

    // ---------- normal locomotion (no active move) ----------
    // Snappy steering: full accel toward the stick; harder decel when idle
    // or reversing (kills the ice-skater feel).
    const baseAccel = this.grounded ? this.mv.groundAccel : this.mv.airAccel;
    const reversing = vel.x * targetX + vel.z * targetZ < -0.1;
    const prevSp = Math.hypot(vel.x, vel.z);
    if (prevSp > this.mv.runSpeed * 1.05 && mag > 0.1 && vel.x * targetX + vel.z * targetZ > 0) {
      // Speed above run speed (dash-jumps, boosts, boost pads) is a REWARD:
      // while the stick roughly agrees, steer the heading and bleed the
      // excess gently instead of braking to run speed at full accel.
      // Releasing the stick or reversing still brakes hard — control wins.
      const bleed = this.grounded ? 12 : 5;
      const sp = Math.max(this.mv.runSpeed, prevSp - bleed * dt);
      const heading = lerpAngle(
        Math.atan2(vel.x, vel.z),
        Math.atan2(targetX, targetZ),
        Math.min(1, dt * 3),
      );
      vx = Math.sin(heading) * sp;
      vz = Math.cos(heading) * sp;
    } else {
      const factor = mag < 0.1 ? 1.7 : reversing ? 2.2 : 1; // reversals bite hard
      const accel = baseAccel * factor * dt;
      vx = vel.x + clamp(targetX - vel.x, -accel, accel);
      vz = vel.z + clamp(targetZ - vel.z, -accel, accel);
    }

    // jumps: ground (buffer+coyote) → wall slot → jumpAir slot
    if (this.buffer > 0 && this.coyote > 0) {
      vy = this.mv.jumpVelocity;
      this.buffer = 0;
      this.coyote = 0;
      this.jumpRising = true;
    } else if ((input.jumpPressed || this.buffer > 0) && !this.grounded) {
      // buffered too: a jump pressed during a move fires the moment the
      // cancel window releases it (double jump out of a spin attack, etc.)
      const wallSpec = this.slotSpec("wall");
      const wall = wallSpec ? this.checkWall() : null;
      if (wallSpec && wall) {
        this.buffer = 0;
        this.airUses = {}; // wall contact refreshes the air kit
        if (wallSpec.cling) {
          this.clingT = 0;
          this.clingNx = wall.nx;
          this.clingNz = wall.nz;
        } else if (wallSpec.phases[0]?.vyHold !== undefined) {
          // wall run: ride the wall upward (the phase does the work)
          this.tryStart(wallSpec, -wall.nx, -wall.nz);
          this.facing = Math.atan2(wall.nx, wall.nz);
        } else {
          // classic wall jump: kick away
          vy = this.mv.jumpVelocity * 0.95;
          vx = wall.nx * this.mv.runSpeed * 0.85;
          vz = wall.nz * this.mv.runSpeed * 0.85;
          this.facing = Math.atan2(wall.nx, wall.nz);
          this.jumpRising = true;
          this.tryStart(wallSpec, wall.nx, wall.nz); // for the pose/anim only
        }
      } else {
        const spec = this.slotSpec("jumpAir");
        if (this.tryStart(spec, mdX, mdZ)) this.buffer = 0;
      }
    } else if (input.jumpHeld && vy > 0.5 && this.jumpRising) {
      vy += 5.5 * dt; // variable height while rising (jumps only, not springs)
    }
    // Standing depenetration spikes (heavy capsules at low frame rates get
    // launched upward by contact resolution) must not read as real airtime —
    // they break grounded detection and misroute ground/air move slots.
    if (this.grounded && !this.jumpRising && vy > 1.5) vy = 1.5;

    // hold-Space fall move (glide family): engage while falling + held —
    // never on a frame where a move just started (the jump block above may
    // have activated a jumpAir move; vy still reads pre-impulse here).
    const fallSpec = this.slotSpec("fallHold");
    const fallPh = fallSpec?.phases[0];
    // catch the glide EARLY (vy < -1.2, not the full fall cap) so holding
    // Space after a double jump / spin attack flows straight into it
    if (!this.active && fallSpec?.holdable && fallPh && !this.grounded && input.jumpHeld && vy < -1.2) {
      this.gliding = true;
      this.earSpin = !!fallSpec.earSpin;
      vy = Math.max(vy, fallPh.vyMin ?? -2.4);
      if (fallPh.fwd !== undefined && fallPh.fwd === 0) {
        // parachute: bleed horizontal speed
        vx = vel.x * Math.max(0, 1 - 3 * dt);
        vz = vel.z * Math.max(0, 1 - 3 * dt);
      } else if (fallPh.fwdMul !== undefined) {
        // powered glide: ride forward along facing at a set clip
        const gs = this.mv.runSpeed * fallPh.fwdMul;
        const gx = Math.sin(this.facing) * gs;
        const gz = Math.cos(this.facing) * gs;
        const blend = Math.min(1, dt * 4);
        vx = vx + (gx - vx) * blend;
        vz = vz + (gz - vz) * blend;
      }
      if (fallPh.pose) {
        this.movePose = fallPh.pose;
        this.moveA = 1;
      }
      this.moveStretch = fallPh.stretch;
      this.trailActive = !!fallPh.trail;
    } else if (!this.grounded) {
      // asymmetric arc: heavy on the way down; releasing jump cuts the rise —
      // but only for rises the player jumped into (springs keep full height)
      if (vy < 0) {
        // apex float: ease into the heavy fall gravity so the top of the
        // arc hangs a beat (an aiming window) instead of snapping downward
        const gk = Math.min(1, 0.35 + (-vy / 3) * 0.65);
        vy = Math.max(TERMINAL_VY, vy + FALL_GRAVITY_EXTRA * gk * dt);
        this.jumpRising = false;
      } else if (!input.jumpHeld && this.jumpRising) {
        vy += JUMPCUT_GRAVITY_EXTRA * dt;
      }
    }
    if (this.grounded) this.jumpRising = false;

    this.aggregate.body.setLinearVelocity(new Vector3(vx, vy, vz));
    this.vy = vy;
    this.finishFrame(vx, vz, dt);
  }

  /** Shared per-frame tail: gait phase + pose resolution. */
  private finishFrame(vx: number, vz: number, dt: number) {
    this.pounding = this.active?.spec.slot === "powerAir";
    this.hSpeed = Math.hypot(vx, vz);
    // stride-synced gait: feet stay planted instead of sliding
    this.runPhase = (this.runPhase + (this.hSpeed * dt) / STRIDE) % 1;
    if (this.gliding) this.pose = "glide";
    else if (this.trailActive && this.grounded) this.pose = "dash";
    else if (!this.grounded) this.pose = this.vy > 1 ? "jump" : "fall";
    else this.pose = this.hSpeed > 0.6 ? "run" : "idle";
  }

  dispose() {
    this.aggregate.dispose();
    this.capsule.dispose();
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Interpolate between angles along the shortest arc. */
function lerpAngle(a: number, b: number, t: number): number {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}
