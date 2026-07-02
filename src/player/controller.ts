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
const POUND_SPEED = -26;
const GLIDE_FALL = -2.4;

export type AvatarPose = "idle" | "run" | "jump" | "fall" | "dash" | "pound" | "glide";

export class PlayerController {
  capsule: ReturnType<typeof MeshBuilder.CreateCapsule>;
  aggregate: PhysicsAggregate;
  grounded = false;
  /** Yaw the player is moving toward (for the chase camera + dash direction). */
  facing = 0;
  /** Resolved pose for the sprite avatar. */
  pose: AvatarPose = "idle";
  /** Accumulates with ground travel — drives the run-cycle frame. */
  runPhase = 0;
  /** Current horizontal speed (m/s). */
  hSpeed = 0;
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
  pounding = false; // read by PlaySession (pound-sensitive objects)
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
    this.dashTime = 0;
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
    this.grounded = this.checkGround() && vyNow < 2;
    if (this.grounded) {
      this.airDashUsed = false;
      this.doubleJumpReady = true;
    }

    // Face the movement direction.
    if (mag > 0.1) {
      const tf = Math.atan2(targetX, targetZ);
      this.facing = lerpAngle(this.facing, tf, Math.min(1, dt * 10));
    }

    this.dashCooldown = Math.max(0, this.dashCooldown - dt);

    // --- ground pound ---
    if (
      input.poundPressed &&
      this.has.has("groundPound") &&
      !this.grounded &&
      !this.pounding
    ) {
      this.pounding = true;
      this.dashTime = 0;
    }
    if (this.pounding && this.grounded) {
      this.pounding = false;
      this.onPoundLand?.(this.position.clone().addInPlaceFromFloats(0, -this.mv.capsuleHeight / 2, 0));
      vel.y = 4.2; // pop-back
    }

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
    } else if (this.pounding) {
      vx = vel.x * 0.35;
      vz = vel.z * 0.35;
      vy = POUND_SPEED;
    } else {
      const accel = (this.grounded ? this.mv.groundAccel : this.mv.airAccel) * dt;
      vx = vel.x + clamp(targetX - vel.x, -accel, accel);
      vz = vel.z + clamp(targetZ - vel.z, -accel, accel);

      // Jump: coyote + buffer for the ground jump; double jump / wall jump in air.
      this.coyote = this.grounded ? COYOTE : Math.max(0, this.coyote - dt);
      this.buffer = input.jumpPressed ? JUMP_BUFFER : Math.max(0, this.buffer - dt);
      if (this.buffer > 0 && this.coyote > 0) {
        vy = this.mv.jumpVelocity;
        this.buffer = 0;
        this.coyote = 0;
      } else if (input.jumpPressed && !this.grounded) {
        const wall = this.has.has("wallJump") ? this.checkWall() : null;
        if (wall) {
          vy = this.mv.jumpVelocity * 0.95;
          vx = wall.nx * this.mv.runSpeed * 0.85;
          vz = wall.nz * this.mv.runSpeed * 0.85;
          this.facing = Math.atan2(wall.nx, wall.nz);
          this.doubleJumpReady = true; // wall contact refreshes the air kit
          this.airDashUsed = false;
        } else if (this.has.has("doubleJump") && this.doubleJumpReady) {
          vy = this.mv.doubleJumpVelocity;
          this.doubleJumpReady = false;
        }
      } else if (input.jumpHeld && vy > 0.5) {
        vy += 5.5 * dt; // variable height while rising
      }

      // Glide: hold jump while falling.
      if (this.has.has("glide") && !this.grounded && input.jumpHeld && vy < GLIDE_FALL) {
        vy = GLIDE_FALL;
      }
    }

    this.aggregate.body.setLinearVelocity(new Vector3(vx, vy, vz));

    // --- pose resolution for the avatar ---
    this.hSpeed = Math.hypot(vx, vz);
    this.runPhase = (this.runPhase + this.hSpeed * dt * 0.16) % 1;
    if (this.pounding) this.pose = "pound";
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
