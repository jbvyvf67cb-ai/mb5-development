// Avatar3D — the player's visible body: the character's procedural 3D rig,
// scaled to the physics capsule, yawed toward travel, with squash & stretch
// and flips driven by the controller's state.

import type { ArcRotateCamera, Scene } from "@babylonjs/core";
import type { CharacterData } from "../character/schema";
import { CharacterRig } from "../character/rig";
import type { PlayerController } from "./controller";

export class SpriteAvatar {
  private rig: CharacterRig;
  private yaw = 0;
  private squashT = -1; // landing squash envelope timer (<0 = inactive)

  constructor(
    scene: Scene,
    private player: PlayerController,
    character: CharacterData,
  ) {
    this.rig = new CharacterRig(scene, character, "player", {
      targetHeight: player.mv.capsuleHeight, // visual body = the hitbox
    });
    this.yaw = player.facing;
  }

  update(dt: number, _camera: ArcRotateCamera) {
    const p = this.player.position;
    this.rig.root.position.set(p.x, p.y - this.player.mv.capsuleHeight / 2, p.z);

    // shortest-arc ease toward the controller's facing
    let d = this.player.facing - this.yaw;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    this.yaw += d * Math.min(1, dt * 12);
    this.rig.setYaw(this.yaw);

    // squash & stretch: stretch with upward speed, squash pulse on landing —
    // unless the active move dictates its own stretch (slides, balloons).
    if (this.player.justLanded && this.player.landImpact > 5) this.squashT = 0;
    let stretch = 1;
    if (this.player.moveStretch !== undefined) {
      stretch = this.player.moveStretch;
      this.squashT = -1;
    } else if (this.squashT >= 0) {
      this.squashT += dt;
      const T = 0.16;
      if (this.squashT >= T) this.squashT = -1;
      else {
        const t = this.squashT / T; // 0.78 → 1 with a slight overshoot
        stretch = 0.78 + 0.22 * t + Math.sin(t * Math.PI) * 0.06;
      }
    } else if (!this.player.grounded) {
      stretch = 1 + Math.min(0.12, Math.max(0, this.player.vy) / 90) + Math.min(0.06, Math.max(0, -this.player.vy) / 160);
    }

    this.rig.update(this.player.pose, this.player.runPhase, dt, {
      stretch,
      ...(this.player.movePose ? { movePose: { pose: this.player.movePose, a: this.player.moveA } } : {}),
      ...(this.player.spinX !== undefined ? { spinX: this.player.spinX } : {}),
      ...(this.player.spinY !== undefined ? { spinY: this.player.spinY } : {}),
      vy: this.player.vy,
      speed: this.player.hSpeed,
      airborne: !this.player.grounded,
      gliding: this.player.gliding,
      earSpin: this.player.earSpin,
    });
  }

  dispose() {
    this.rig.dispose();
  }
}
