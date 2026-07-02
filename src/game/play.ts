// PlaySession — the gameplay logic active only in Play mode.
//
// Turns the editor's entity markers into live gameplay: coins are collectible,
// checkpoints update the respawn point, and falling past the kill plane respawns
// the player. Created on entering Play, disposed on exit (which restores any
// collected coin markers, since the same World is reused for editing).

import type { Mesh, Scene } from "@babylonjs/core";
import { Color3, MeshBuilder, StandardMaterial, Vector3 } from "@babylonjs/core";
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
  private effects: Array<{ mesh: Mesh; t: number }> = [];

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

  /** Ground-pound impact: an expanding, fading ring. */
  shockwave(pos: Vector3) {
    const ring = MeshBuilder.CreateTorus(
      "shockwave",
      { diameter: 1, thickness: 0.16, tessellation: 28 },
      this.scene,
    );
    ring.position.copyFrom(pos).addInPlaceFromFloats(0, 0.25, 0);
    ring.isPickable = false;
    const mat = new StandardMaterial("shockwaveMat", this.scene);
    mat.emissiveColor = new Color3(1, 0.9, 0.5);
    mat.disableLighting = true;
    mat.alpha = 0.9;
    ring.material = mat;
    this.effects.push({ mesh: ring, t: 0 });
  }

  update(dt: number) {
    const p = this.player.position;

    // advance transient effects
    for (let i = this.effects.length - 1; i >= 0; i--) {
      const fx = this.effects[i];
      fx.t += dt;
      const k = fx.t / 0.45;
      if (k >= 1) {
        fx.mesh.material?.dispose();
        fx.mesh.dispose();
        this.effects.splice(i, 1);
        continue;
      }
      const d = 1 + k * 9;
      fx.mesh.scaling.set(d, 1, d);
      const m = fx.mesh.material as StandardMaterial | null;
      if (m) m.alpha = 0.9 * (1 - k);
    }

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
    for (const fx of this.effects) {
      fx.mesh.material?.dispose();
      fx.mesh.dispose();
    }
    this.effects.length = 0;
  }
}
