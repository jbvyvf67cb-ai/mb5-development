// Player capsule controller (Play mode).
//
// Compact port of Joshua's approach: a Havok capsule with locked rotation and
// zero friction, moved by reading and rewriting linear velocity each frame
// (never forces). Camera-relative WASD, coyote-time + jump-buffer jumping with
// variable height, and a multi-ray ground check. No character model yet — the
// capsule itself is the avatar.

import { MeshBuilder, PhysicsAggregate, PhysicsShapeType, Ray } from "@babylonjs/core";
import type { AbstractMesh, Scene } from "@babylonjs/core";
import { Vector3 } from "@babylonjs/core";
import type { InputState } from "../core/input";

const RADIUS = 0.45;
const HEIGHT = 1.8;
const RUN_SPEED = 9;
const GROUND_ACCEL = 60;
const AIR_ACCEL = 22;
const JUMP_VELOCITY = 9.5;
const DOUBLE_JUMP_VELOCITY = 8.4;
const COYOTE = 0.12;
const JUMP_BUFFER = 0.12;

export class PlayerController {
  capsule: ReturnType<typeof MeshBuilder.CreateCapsule>;
  aggregate: PhysicsAggregate;
  grounded = false;
  /** Yaw the player is moving toward (for the chase camera). */
  facing = 0;

  private coyote = 0;
  private buffer = 0;
  private doubleJumpReady = false;
  private down = new Vector3(0, -1, 0);
  private ray = new Ray(Vector3.Zero(), this.down, 1);

  constructor(
    private scene: Scene,
    spawn: Vector3,
  ) {
    this.capsule = MeshBuilder.CreateCapsule("player", { radius: RADIUS, height: HEIGHT }, scene);
    this.capsule.position.copyFrom(spawn);
    this.aggregate = new PhysicsAggregate(
      this.capsule,
      PhysicsShapeType.CAPSULE,
      { mass: 70, friction: 0, restitution: 0 },
      scene,
    );
    // Lock rotation so the capsule never tips.
    this.aggregate.body.setMassProperties({ inertia: new Vector3(0, 0, 0) });
    this.aggregate.body.setAngularDamping(1);
  }

  get position(): Vector3 {
    return this.capsule.position;
  }

  teleport(p: Vector3) {
    this.capsule.position.copyFrom(p);
    this.aggregate.body.setLinearVelocity(Vector3.Zero());
    this.aggregate.body.setAngularVelocity(Vector3.Zero());
    // Force the physics body to read the mesh transform for one step (otherwise
    // the dynamic body's cached pose snaps the capsule straight back).
    this.aggregate.body.disablePreStep = false;
    this.scene.onAfterRenderObservable.addOnce(() => {
      this.aggregate.body.disablePreStep = true;
    });
  }

  private checkGround(): boolean {
    const p = this.capsule.position;
    const reach = HEIGHT / 2 + 0.35;
    const offs = RADIUS * 0.7;
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

  update(dt: number, input: InputState, camYaw: number) {
    const vel = this.aggregate.body.getLinearVelocity();

    // Camera-relative wish direction.
    const fwdX = Math.sin(camYaw);
    const fwdZ = Math.cos(camYaw);
    const rightX = Math.cos(camYaw);
    const rightZ = -Math.sin(camYaw);
    const mag = Math.min(1, Math.hypot(input.moveX, input.moveZ));
    const speed = RUN_SPEED * mag;
    const targetX = (fwdX * input.moveZ + rightX * input.moveX) * speed;
    const targetZ = (fwdZ * input.moveZ + rightZ * input.moveX) * speed;

    const vyNow = vel.y;
    this.grounded = this.checkGround() && vyNow < 2;

    const accel = (this.grounded ? GROUND_ACCEL : AIR_ACCEL) * dt;
    const vx = vel.x + clamp(targetX - vel.x, -accel, accel);
    const vz = vel.z + clamp(targetZ - vel.z, -accel, accel);
    let vy = vyNow;

    // Face the movement direction (camera-relative wish dir in world space).
    if (mag > 0.1) {
      const tf = Math.atan2(targetX, targetZ);
      this.facing = lerpAngle(this.facing, tf, Math.min(1, dt * 10));
    }

    // Jump: coyote + buffer for the ground jump, then a single air double-jump.
    this.coyote = this.grounded ? COYOTE : Math.max(0, this.coyote - dt);
    this.buffer = input.jumpPressed ? JUMP_BUFFER : Math.max(0, this.buffer - dt);
    if (this.grounded) this.doubleJumpReady = true;
    if (this.buffer > 0 && this.coyote > 0) {
      vy = JUMP_VELOCITY;
      this.buffer = 0;
      this.coyote = 0;
    } else if (input.jumpPressed && !this.grounded && this.doubleJumpReady) {
      vy = DOUBLE_JUMP_VELOCITY;
      this.doubleJumpReady = false;
    } else if (input.jumpHeld && vy > 0.5) {
      vy += 5.5 * dt; // variable height while rising
    }

    this.aggregate.body.setLinearVelocity(new Vector3(vx, vy, vz));
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
