// PlayerEffects — the juice layer: run dust, landing bursts, dash trail,
// pound impact, and a blob shadow that makes landings readable. All particle
// textures are generated (no external assets).

import { Color4, DynamicTexture, Mesh, MeshBuilder, ParticleSystem, Ray, StandardMaterial, Texture, Vector3 } from "@babylonjs/core";
import { Color3 } from "@babylonjs/core";
import type { AbstractMesh, Scene } from "@babylonjs/core";
import type { PlayerController } from "./controller";

function blobTexture(scene: Scene, name: string, soft = true): Texture {
  const size = 64;
  const tex = new DynamicTexture(name, { width: size, height: size }, scene, false);
  const ctx = tex.getContext() as unknown as CanvasRenderingContext2D;
  const g = ctx.createRadialGradient(size / 2, size / 2, 2, size / 2, size / 2, size / 2);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(soft ? 0.55 : 0.8, "rgba(255,255,255,0.7)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.clearRect(0, 0, size, size);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  tex.update(false);
  tex.hasAlpha = true;
  return tex;
}

export class PlayerEffects {
  private dust: ParticleSystem;
  private burst: ParticleSystem;
  private trail: ParticleSystem;
  private shadow: Mesh;
  private shadowMat: StandardMaterial;
  private puffTex: Texture;
  private shadowTex: Texture;
  private emitter = new Vector3();
  private ray = new Ray(Vector3.Zero(), new Vector3(0, -1, 0), 60);

  constructor(
    private scene: Scene,
    private player: PlayerController,
  ) {
    const tex = blobTexture(scene, "fx:puff");
    this.puffTex = tex;

    // continuous run dust at the feet
    this.dust = new ParticleSystem("fx:dust", 80, scene);
    this.dust.particleTexture = tex;
    this.dust.emitter = this.emitter;
    this.dust.minSize = 0.12;
    this.dust.maxSize = 0.34;
    this.dust.minLifeTime = 0.25;
    this.dust.maxLifeTime = 0.5;
    this.dust.emitRate = 0;
    this.dust.color1 = new Color4(0.92, 0.9, 0.85, 0.55);
    this.dust.color2 = new Color4(0.85, 0.82, 0.75, 0.35);
    this.dust.colorDead = new Color4(0.85, 0.82, 0.75, 0);
    this.dust.direction1 = new Vector3(-0.6, 0.5, -0.6);
    this.dust.direction2 = new Vector3(0.6, 1.4, 0.6);
    this.dust.minEmitPower = 0.4;
    this.dust.maxEmitPower = 1.1;
    this.dust.gravity = new Vector3(0, -2, 0);
    this.dust.start();

    // one-shot bursts (landings, pound impact) via manual emit
    this.burst = new ParticleSystem("fx:burst", 160, scene);
    this.burst.particleTexture = tex;
    this.burst.emitter = this.emitter.clone();
    this.burst.minSize = 0.2;
    this.burst.maxSize = 0.55;
    this.burst.minLifeTime = 0.3;
    this.burst.maxLifeTime = 0.6;
    this.burst.emitRate = 0;
    this.burst.manualEmitCount = 0;
    this.burst.color1 = new Color4(0.95, 0.93, 0.86, 0.75);
    this.burst.color2 = new Color4(0.9, 0.85, 0.7, 0.5);
    this.burst.colorDead = new Color4(0.9, 0.85, 0.7, 0);
    this.burst.direction1 = new Vector3(-1.6, 0.25, -1.6);
    this.burst.direction2 = new Vector3(1.6, 1.1, 1.6);
    this.burst.minEmitPower = 1.6;
    this.burst.maxEmitPower = 4;
    this.burst.gravity = new Vector3(0, -4, 0);
    this.burst.start();

    // dash speed trail
    this.trail = new ParticleSystem("fx:trail", 120, scene);
    this.trail.particleTexture = tex;
    this.trail.emitter = this.emitter;
    this.trail.minSize = 0.25;
    this.trail.maxSize = 0.6;
    this.trail.minLifeTime = 0.18;
    this.trail.maxLifeTime = 0.32;
    this.trail.emitRate = 0;
    this.trail.color1 = new Color4(0.7, 0.9, 1, 0.7);
    this.trail.color2 = new Color4(0.5, 0.75, 1, 0.4);
    this.trail.colorDead = new Color4(0.5, 0.75, 1, 0);
    this.trail.direction1 = new Vector3(-0.2, -0.1, -0.2);
    this.trail.direction2 = new Vector3(0.2, 0.35, 0.2);
    this.trail.minEmitPower = 0.1;
    this.trail.maxEmitPower = 0.5;
    this.trail.start();

    // blob shadow — the landing-readability workhorse
    this.shadow = MeshBuilder.CreateDisc("fx:shadow", { radius: 0.55, tessellation: 24 }, scene);
    this.shadow.rotation.x = Math.PI / 2;
    this.shadow.isPickable = false;
    this.shadowMat = new StandardMaterial("fx:shadowMat", scene);
    this.shadowTex = blobTexture(scene, "fx:shadowTex", false);
    this.shadowMat.diffuseTexture = this.shadowTex;
    this.shadowMat.diffuseColor = new Color3(0, 0, 0);
    this.shadowMat.emissiveColor = new Color3(0, 0, 0);
    this.shadowMat.opacityTexture = this.shadowMat.diffuseTexture as Texture;
    this.shadowMat.alpha = 0.4;
    this.shadowMat.disableLighting = true;
    this.shadow.material = this.shadowMat;
  }

  update(_dt: number) {
    const p = this.player.position;
    const feetY = p.y - this.player.mv.capsuleHeight / 2;
    this.emitter.set(p.x, feetY + 0.1, p.z);

    // run dust scales with ground speed
    this.dust.emitRate = this.player.grounded && this.player.hSpeed > 3 ? Math.min(60, this.player.hSpeed * 4) : 0;

    // dash trail
    this.trail.emitRate = this.player.isDashing ? 220 : 0;

    // landing burst (bigger for harder landings; pound gets its own call)
    if (this.player.justLanded && this.player.landImpact > 6) {
      this.burstAt(this.emitter, Math.min(40, Math.round(this.player.landImpact * 1.6)));
    }

    // blob shadow: project to whatever is below
    this.ray.origin.set(p.x, p.y, p.z);
    const capsule = this.player.capsule;
    const hit = this.scene.pickWithRay(
      this.ray,
      (m: AbstractMesh) => m.isPickable && m !== capsule && !m.name.startsWith("entity:"),
    );
    if (hit?.hit && hit.pickedPoint) {
      this.shadow.setEnabled(true);
      this.shadow.position.set(p.x, hit.pickedPoint.y + 0.04, p.z);
      const drop = Math.max(0, p.y - hit.pickedPoint.y);
      const k = Math.max(0.45, 1 - drop / 22);
      this.shadow.scaling.set(k, k, k);
      this.shadowMat.alpha = 0.4 * k;
    } else {
      this.shadow.setEnabled(false);
    }
  }

  /** One-shot burst (landings, pound impact). Same-frame calls accumulate. */
  burstAt(pos: Vector3, count: number) {
    (this.burst.emitter as Vector3).copyFrom(pos);
    this.burst.manualEmitCount = Math.max(0, this.burst.manualEmitCount) + count;
  }

  dispose() {
    this.dust.dispose(false); // shared texture disposed once below
    this.burst.dispose(false);
    this.trail.dispose(false);
    this.puffTex.dispose();
    this.shadowMat.dispose(false, true); // force-dispose the shadow texture too
    this.shadow.dispose();
  }
}
