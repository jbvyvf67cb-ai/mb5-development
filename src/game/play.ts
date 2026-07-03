// PlaySession — the gameplay logic active only in Play mode.
//
// Turns the editor's entity markers into live gameplay: coins are collectible,
// checkpoints update the respawn point, and falling past the kill plane respawns
// the player. Created on entering Play, disposed on exit (which restores any
// collected coin markers, since the same World is reused for editing).

import type { Mesh, Scene } from "@babylonjs/core";
import { Color3, MeshBuilder, Quaternion, StandardMaterial, Vector3 } from "@babylonjs/core";
import { toast } from "../editor/widgets";
import type { GameState } from "./state";
import type { PrefabInstance } from "../world/schema";
import type { World } from "../world/world";
import type { PlayerController } from "../player/controller";
import { spawnPoint } from "../world/world";

const COIN_RADIUS = 1.6;
const CHECKPOINT_RADIUS = 2.2;

interface Pad {
  inst: PrefabInstance;
  mesh: Mesh;
  cooldown: number;
}

interface Mover {
  inst: PrefabInstance;
  mesh: Mesh;
  base: Vector3;
  axis: Vector3;
  dist: number;
  speed: number;
  t: number;
  last: Vector3;
}

export class PlaySession {
  respawn: Vector3;
  private collected = new Set<string>();
  private coins: Array<{ id: string; pos: Vector3 }> = [];
  private checkpoints: Array<{ id: string; pos: Vector3 }> = [];
  private effects: Array<{ mesh: Mesh; t: number }> = [];
  private springs: Pad[] = [];
  private boosts: Pad[] = [];
  private spikes: Pad[] = [];
  private goals: Pad[] = [];
  private movers: Mover[] = [];
  private won = false;
  private spinT = 0;
  private hiddenMarkers: string[] = [];

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
      else if (ent.type === "playerSpawn") {
        // editor aid, not a game object — hide during the run
        this.hiddenMarkers.push(ent.id);
        world.entityMeshes.get(ent.id)?.setEnabled(false);
      }
    }

    // gameplay prefabs become live objects for this run
    for (const inst of world.data.prefabs) {
      const mesh = world.prefabMeshes.get(inst.id);
      if (!mesh) continue;
      const pad: Pad = { inst, mesh, cooldown: 0 };
      if (inst.prefab === "spring") this.springs.push(pad);
      else if (inst.prefab === "boost") this.boosts.push(pad);
      else if (inst.prefab === "spikes") this.spikes.push(pad);
      else if (inst.prefab === "goal") this.goals.push(pad);
      else if (inst.prefab === "movingPlatform") {
        const p = inst.props ?? {};
        const axisName = typeof p.axis === "string" ? p.axis : "x";
        const axis = axisName === "y" ? new Vector3(0, 1, 0) : axisName === "z" ? new Vector3(0, 0, 1) : new Vector3(1, 0, 0);
        this.movers.push({
          inst,
          mesh,
          base: mesh.position.clone(),
          axis,
          dist: typeof p.dist === "number" ? p.dist : 6,
          speed: typeof p.speed === "number" ? p.speed : 2,
          t: 0,
          last: mesh.position.clone(),
        });
        world.setKinematic(inst.id, true); // body follows the animated mesh
      }
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

    // spin the coins (and bob them a touch)
    this.spinT += dt;
    for (const coin of this.coins) {
      if (this.collected.has(coin.id)) continue;
      const mesh = this.world.entityMeshes.get(coin.id);
      if (!mesh) continue;
      mesh.rotationQuaternion = Quaternion.RotationYawPitchRoll(this.spinT * 2.6, 0, Math.PI / 2);
      mesh.position.y = coin.pos.y + Math.sin(this.spinT * 2 + coin.pos.x) * 0.12;
    }

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

    // --- gameplay prefabs ---
    const onPad = (pad: Pad, xzSlack = 0.7, yBelow = 0.6, yAbove = 1.6): boolean => {
      const m = pad.mesh;
      const hw = (m.scaling.x / 2) * 1 + xzSlack;
      const hd = (m.scaling.z / 2) * 1 + xzSlack;
      const top = m.position.y + m.scaling.y / 2;
      const feet = p.y - this.player.mv.capsuleHeight / 2;
      return (
        Math.abs(p.x - m.position.x) < hw &&
        Math.abs(p.z - m.position.z) < hd &&
        feet > top - yBelow &&
        feet < top + yAbove
      );
    };

    for (const s of this.springs) {
      s.cooldown = Math.max(0, s.cooldown - dt);
      if (s.cooldown <= 0 && onPad(s)) {
        const power = num(s.inst.props?.power, 15 + 4 * s.mesh.scaling.y);
        this.player.bounce(power);
        s.cooldown = 0.4;
        this.shockwave(s.mesh.position.clone().addInPlaceFromFloats(0, s.mesh.scaling.y / 2, 0));
      }
    }
    for (const b of this.boosts) {
      b.cooldown = Math.max(0, b.cooldown - dt);
      if (b.cooldown <= 0 && onPad(b)) {
        const power = num(b.inst.props?.power, 24);
        const yaw = b.inst.rot[1];
        this.player.impulse(Math.sin(yaw) * power, Math.cos(yaw) * power);
        b.cooldown = 0.5;
      }
    }
    for (const s of this.spikes) {
      if (onPad(s, 0.2, 0.4, 0.9)) {
        this.player.teleport(this.respawn);
        break;
      }
    }
    for (const g of this.goals) {
      if (!this.won && Vector3.DistanceSquared(p, g.mesh.position) < 9) {
        this.won = true;
        toast(`🏁 ${this.world.data.meta.name}: complete! (${this.state.coins} coins)`, "ok", 5000);
      }
    }

    // moving platforms: animate, drag physics body, carry the player
    for (const mv of this.movers) {
      mv.t += dt;
      const omega = mv.speed / Math.max(0.5, mv.dist / 2);
      const off = (mv.dist / 2) * Math.sin(mv.t * omega);
      const next = mv.base.add(mv.axis.scale(off));
      const delta = next.subtract(mv.mesh.position);
      mv.mesh.position.copyFrom(next);
      // carry: standing on it (grounded, feet near its top, inside footprint)
      const top = next.y + mv.mesh.scaling.y / 2;
      const feet = p.y - this.player.mv.capsuleHeight / 2;
      if (
        this.player.grounded &&
        Math.abs(p.x - next.x) < mv.mesh.scaling.x / 2 + 0.5 &&
        Math.abs(p.z - next.z) < mv.mesh.scaling.z / 2 + 0.5 &&
        feet > top - 0.8 &&
        feet < top + 0.8
      ) {
        this.player.nudge(delta);
      }
      mv.last.copyFrom(next);
    }

    const killY = this.world.data.meta.killPlaneY ?? -40;
    if (p.y < killY) this.player.teleport(this.respawn);
  }

  dispose() {
    // restore moving platforms to their authored spot for editing
    for (const mv of this.movers) {
      mv.mesh.position.copyFrom(mv.base);
      this.world.setKinematic(mv.inst.id, false);
      this.world.syncPrefabFromMesh(mv.inst.id);
    }
    // restore coin markers (pose + any collected) for editing
    for (const coin of this.coins) {
      const mesh = this.world.entityMeshes.get(coin.id);
      if (!mesh) continue;
      mesh.rotationQuaternion = null;
      mesh.rotation.set(0, 0, Math.PI / 2);
      mesh.position.copyFrom(coin.pos);
    }
    for (const id of this.collected) this.world.entityMeshes.get(id)?.setEnabled(true);
    for (const id of this.hiddenMarkers) this.world.entityMeshes.get(id)?.setEnabled(true);
    this.collected.clear();
    for (const fx of this.effects) {
      fx.mesh.material?.dispose();
      fx.mesh.dispose();
    }
    this.effects.length = 0;
  }
}

function num(v: unknown, d: number): number {
  return typeof v === "number" && isFinite(v) ? v : d;
}
