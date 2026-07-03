// Player capsule controller (Play mode) — parameterized by a CharacterData.
//
// Joshua's approach at the core: a Havok capsule with locked rotation and zero
// friction, moved by reading and rewriting linear velocity each frame (never
// forces); camera-relative WASD; coyote-time + jump-buffer jumping with
// variable height. On top: the character's stats derive the movement numbers
// (speed/jump/mass/capsule size) and its equipped special moves gate the
// verbs — double jump, dash, glide, ground pound, wall jump. The visible body
// is a SpriteAvatar billboard; the capsule stays invisible.

import { MeshBuilder, PhysicsAggregate, PhysicsShapeType, Ray } from "@babylonjs/core";
import type { AbstractMesh, Scene } from "@babylonjs/core";
import { Vector3 } from "@babylonjs/core";
import type { InputState } from "../core/input";
import { deriveMovement, type CharacterData, type MoveKey } from "../character/schema";
import type { LevelPhysics } from "../world/schema";

const COYOTE = 0.12;
const JUMP_BUFFER = 0.12;
const DASH_TIME = 0.16;
const DASH_COOLDOWN = 0.6;
const GLIDE_FALL = -2.4;
// Game-feel: arcs are asymmetric — normal gravity up, heavy gravity down, and
// releasing jump early cuts the rise. Snappy, Mario-style.
const FALL_GRAVITY_EXTRA = -20; // added while falling
const JUMPCUT_GRAVITY_EXTRA = -30; // added while rising with jump released
// Ground pound: a windup front-flip hang, THEN the slam.
const POUND_WINDUP = 0.24;
const POUND_SPEED = -34;
const FLIP_DURATION = 0.45; // double-jump somersault
const STRIDE = 2.1; // meters of travel per full run cycle (keeps feet planted)

export type AvatarPose = "idle" | "run" | "jump" | "fall" | "dash" | "pound" | "glide";

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
  /** Front-flip progress 0..1 (double-jump somersault / pound windup). */
  flip = 0;
  /** True exactly on the frame the player touches down. */
  justLanded = false;
  /** |vy| at the moment of the last landing (for squash + dust). */
  landImpact = 0;
  /** Current vertical velocity (read by the avatar for stretch). */
  vy = 0;
  /** True while the dash burst is active (for trails/FOV). */
  get isDashing(): boolean {
    return this.dashTime > 0;
  }
  /** Fired when a ground pound lands (position = feet). */
  onPoundLand?: (pos: Vector3) => void;

  readonly mv: ReturnType<typeof deriveMovement>;
  private has: Set<MoveKey>;

  private coyote = 0;
  private buffer = 0;
  private doubleJumpReady = false;
  private dashTime = 0;
  private dashCooldown = 0;
  private airDashUsed = false;
  private dashDirX = 0;
  private dashDirZ = 1;
  pounding = false; // any pound phase active (windup or slam)
  private poundState: "none" | "windup" | "slam" = "none";
  private windupT = 0;
  private flipT = -1; // <0 = no somersault active
  private jumpRising = false; // current ascent came from a player jump (gates jump-cut/boost)
  private prevGrounded = true;
  private down = new Vector3(0, -1, 0);
  private ray = new Ray(Vector3.Zero(), this.down, 1);

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
    this.has = new Set(character.moves);
    this.capsule = MeshBuilder.CreateCapsule(
      "player",
      { radius: this.mv.capsuleRadius, height: this.mv.capsuleHeight },
      scene,
    );
    this.capsule.position.copyFrom(spawn);
    this.capsule.isVisible = false; // the SpriteAvatar is the visible body
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
    this.pounding = false;
    this.poundState = "none";
    this.dashTime = 0; // a spring beats a dash hover
    this.jumpRising = false; // spring rises decay at pure gravity (no jump-cut)
    this.doubleJumpReady = true;
    this.airDashUsed = false;
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
    this.pounding = false;
    this.poundState = "none";
    this.flipT = -1;
    this.dashTime = 0;
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
    const reach = this.mv.capsuleHeight / 2 + 0.35;
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
      this.ray.origin.set(p.x, p.y, p.z);
      this.ray.direction.set(dx, 0, dz);
      this.ray.length = reach;
      const hit = this.scene.pickWithRay(this.ray, (m: AbstractMesh) => m !== this.capsule && m.isPickable);
      if (hit?.hit) {
        const n = hit.getNormal(true);
        if (n && Math.hypot(n.x, n.z) > 0.4) return { nx: n.x, nz: n.z };
        return { nx: -dx, nz: -dz };
      }
    }
    return null;
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
    this.grounded = this.checkGround() && vyNow < 2 && this.poundState !== "windup";
    this.justLanded = this.grounded && !this.prevGrounded;
    if (this.justLanded) this.landImpact = Math.abs(this.vy);
    this.prevGrounded = this.grounded;
    if (this.grounded) {
      this.airDashUsed = false;
      this.doubleJumpReady = true;
      if (this.poundState !== "slam") this.flipT = -1; // cancel somersault on touch
    }

    // Face the movement direction.
    if (mag > 0.1) {
      const tf = Math.atan2(targetX, targetZ);
      this.facing = lerpAngle(this.facing, tf, Math.min(1, dt * 10));
    }

    this.dashCooldown = Math.max(0, this.dashCooldown - dt);
    // coyote/buffer tick every frame (freezing them inside one branch caused
    // phantom buffered jumps after dashes/pounds)
    this.coyote = this.grounded ? COYOTE : Math.max(0, this.coyote - dt);
    this.buffer = input.jumpPressed ? JUMP_BUFFER : Math.max(0, this.buffer - dt);

    // --- somersault progress (double jump) ---
    if (this.flipT >= 0) {
      this.flipT += dt;
      if (this.flipT >= FLIP_DURATION) this.flipT = -1;
    }

    // --- ground pound: windup flip, then slam ---
    if (
      input.poundPressed &&
      this.has.has("groundPound") &&
      !this.grounded &&
      this.poundState === "none"
    ) {
      this.poundState = "windup";
      this.windupT = 0;
      this.flipT = -1;
      this.dashTime = 0;
    }
    let poundPop = false;
    if (this.poundState === "slam" && this.grounded && this.vy < -1) {
      this.poundState = "none";
      this.onPoundLand?.(this.position.clone().addInPlaceFromFloats(0, -this.mv.capsuleHeight / 2, 0));
      poundPop = true; // applied to vy below — writing vel.y is a dead store
      this.buffer = 0; // a jump buffered before the pound must not fire on the landing
    }
    this.pounding = this.poundState !== "none";

    // --- dash ---
    if (
      input.dashPressed &&
      this.has.has("dash") &&
      this.dashCooldown <= 0 &&
      !this.pounding &&
      (this.grounded || !this.airDashUsed)
    ) {
      this.dashTime = DASH_TIME;
      this.dashCooldown = DASH_COOLDOWN;
      if (!this.grounded) this.airDashUsed = true;
      // dash along input if held, else along facing
      if (mag > 0.15) {
        const l = Math.hypot(targetX, targetZ) || 1;
        this.dashDirX = targetX / l;
        this.dashDirZ = targetZ / l;
      } else {
        this.dashDirX = Math.sin(this.facing);
        this.dashDirZ = Math.cos(this.facing);
      }
    }

    let vx: number;
    let vz: number;
    let vy = vyNow;

    if (this.dashTime > 0) {
      // Dash overrides steering; hover (vy=0) so gaps read fair.
      this.dashTime -= dt;
      vx = this.dashDirX * this.mv.dashSpeed;
      vz = this.dashDirZ * this.mv.dashSpeed;
      vy = 0;
    } else if (this.poundState === "windup") {
      // hang + front flip, then drop
      this.windupT += dt;
      vx = vel.x * 0.2;
      vz = vel.z * 0.2;
      vy = 1.4;
      if (this.windupT >= POUND_WINDUP) this.poundState = "slam";
    } else if (this.poundState === "slam") {
      vx = vel.x * 0.3;
      vz = vel.z * 0.3;
      vy = POUND_SPEED;
    } else {
      // Snappy steering: full accel toward the stick; harder decel when idle
      // or reversing (kills the ice-skater feel).
      const base = this.grounded ? this.mv.groundAccel : this.mv.airAccel;
      const reversing = vel.x * targetX + vel.z * targetZ < -0.1;
      const factor = mag < 0.1 ? 1.7 : reversing ? 1.5 : 1;
      const accel = base * factor * dt;
      vx = vel.x + clamp(targetX - vel.x, -accel, accel);
      vz = vel.z + clamp(targetZ - vel.z, -accel, accel);

      if (this.buffer > 0 && this.coyote > 0) {
        vy = this.mv.jumpVelocity;
        this.buffer = 0;
        this.coyote = 0;
        this.jumpRising = true;
      } else if (input.jumpPressed && !this.grounded) {
        const wall = this.has.has("wallJump") ? this.checkWall() : null;
        if (wall) {
          vy = this.mv.jumpVelocity * 0.95;
          vx = wall.nx * this.mv.runSpeed * 0.85;
          vz = wall.nz * this.mv.runSpeed * 0.85;
          this.facing = Math.atan2(wall.nx, wall.nz);
          this.doubleJumpReady = true; // wall contact refreshes the air kit
          this.airDashUsed = false;
          this.buffer = 0;
          this.jumpRising = true;
        } else if (this.has.has("doubleJump") && this.doubleJumpReady) {
          vy = this.mv.doubleJumpVelocity;
          this.doubleJumpReady = false;
          this.flipT = 0; // somersault!
          this.buffer = 0;
          this.jumpRising = true;
        }
      } else if (input.jumpHeld && vy > 0.5 && this.jumpRising) {
        vy += 5.5 * dt; // variable height while rising (jumps only, not springs)
      }

      const gliding = this.has.has("glide") && !this.grounded && input.jumpHeld && vy < GLIDE_FALL;
      if (gliding) {
        vy = GLIDE_FALL; // glide caps the fall
      } else if (!this.grounded) {
        // asymmetric arc: heavy on the way down; releasing jump cuts the rise —
        // but only for rises the player jumped into (springs keep full height)
        if (vy < 0) {
          vy += FALL_GRAVITY_EXTRA * dt;
          this.jumpRising = false;
        } else if (!input.jumpHeld && this.jumpRising) {
          vy += JUMPCUT_GRAVITY_EXTRA * dt;
        }
      }
      if (this.grounded) this.jumpRising = false;
    }

    if (poundPop) vy = 4.6; // the pop-back, applied where it actually counts
    this.aggregate.body.setLinearVelocity(new Vector3(vx, vy, vz));
    this.vy = vy;

    // --- flip progress for the rig ---
    this.flip =
      this.poundState === "windup"
        ? Math.min(1, this.windupT / POUND_WINDUP)
        : this.flipT >= 0
          ? Math.min(1, this.flipT / FLIP_DURATION)
          : 0;

    // --- pose resolution for the avatar ---
    this.hSpeed = Math.hypot(vx, vz);
    // stride-synced gait: feet stay planted instead of sliding
    this.runPhase = (this.runPhase + (this.hSpeed * dt) / STRIDE) % 1;
    if (this.poundState === "slam") this.pose = "pound";
    else if (this.poundState === "windup") this.pose = "jump"; // tucked, mid-flip
    else if (this.dashTime > 0) this.pose = "dash";
    else if (!this.grounded && this.has.has("glide") && input.jumpHeld && vy <= GLIDE_FALL + 0.01) this.pose = "glide";
    else if (!this.grounded) this.pose = vy > 1 ? "jump" : "fall";
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
