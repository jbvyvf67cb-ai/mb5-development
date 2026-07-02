// Avatar3D — the player's visible body: the character's procedural 3D rig,
// bottom-anchored to the (invisible) physics capsule and yawed toward travel.

import type { ArcRotateCamera, Scene } from "@babylonjs/core";
import type { CharacterData } from "../character/schema";
import { CharacterRig } from "../character/rig";
import type { PlayerController } from "./controller";

export class SpriteAvatar {
  private rig: CharacterRig;
  private yaw = 0;

  constructor(
    scene: Scene,
    private player: PlayerController,
    character: CharacterData,
  ) {
    this.rig = new CharacterRig(scene, character, "player");
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
    this.rig.update(this.player.pose, this.player.runPhase, dt);
  }

  dispose() {
    this.rig.dispose();
  }
}
