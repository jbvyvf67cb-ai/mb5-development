// PlaySession — the gameplay logic active only in Play mode.
//
// Turns the editor's entity markers into live gameplay: coins are collectible,
// checkpoints update the respawn point, and falling past the kill plane respawns
// the player. Created on entering Play, disposed on exit (which restores any
// collected coin markers, since the same World is reused for editing).

import type { Scene } from "@babylonjs/core";
import { Vector3 } from "@babylonjs/core";
import type { GameState } from "./state";
import type { World } from "../world/world";
import type { PlayerController } from "../player/controller";
import { spawnPoint } from "../world/world";

const COIN_RADIUS = 1.6;
const CHECKPOINT_RADIUS = 2.2;

export class PlaySession {
  respawn: Vector3;
  private collected = new Set<string>();
  private coins: Array<{ id: string; pos: Vector3 }> = [];
  private checkpoints: Array<{ id: string; pos: Vector3 }> = [];

  constructor(
    private scene: Scene,
    private world: World,
    private state: GameState,
    private player: PlayerController,
  ) {
    this.respawn = spawnPoint(world.data);
    for (const ent of world.data.entities) {
      const pos = new Vector3(ent.pos[0], ent.pos[1], ent.pos[2]);
      if (ent.type === "coin") this.coins.push({ id: ent.id, pos });
      else if (ent.type === "checkpoint") this.checkpoints.push({ id: ent.id, pos });
    }
    state.resetRun();
  }

  update(_dt: number) {
    const p = this.player.position;

    for (const coin of this.coins) {
      if (this.collected.has(coin.id)) continue;
      if (Vector3.DistanceSquared(p, coin.pos) < COIN_RADIUS * COIN_RADIUS) {
        this.collected.add(coin.id);
        this.world.entityMeshes.get(coin.id)?.setEnabled(false);
        this.state.addCoins(1);
      }
    }

    for (const cp of this.checkpoints) {
      if (Vector3.DistanceSquared(p, cp.pos) < CHECKPOINT_RADIUS * CHECKPOINT_RADIUS) {
        this.respawn = cp.pos.clone().addInPlaceFromFloats(0, 1.5, 0);
      }
    }

    const killY = this.world.data.meta.killPlaneY ?? -40;
    if (p.y < killY) this.player.teleport(this.respawn);
  }

  dispose() {
    // restore collected coin markers for editing
    for (const id of this.collected) this.world.entityMeshes.get(id)?.setEnabled(true);
    this.collected.clear();
    void this.scene;
  }
}
