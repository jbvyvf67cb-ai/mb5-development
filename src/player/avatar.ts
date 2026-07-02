// SpriteAvatar — the character's visible body: a Y-billboarded plane showing
// the procedural pixel sprite (Paper-Mario style in the 3D world).
//
// All pose frames are pre-rendered once (48×60 canvases) and blitted into one
// DynamicTexture with smoothing off (chunky pixels), nearest sampling. The
// frame is chosen from the controller's resolved pose; the sprite mirrors when
// the player moves screen-left relative to the camera.

import { DynamicTexture, Mesh, MeshBuilder, StandardMaterial, Texture, Vector3 } from "@babylonjs/core";
import type { ArcRotateCamera, Scene } from "@babylonjs/core";
import { Color3 } from "@babylonjs/core";
import type { CharacterData } from "../character/schema";
import { AVATAR_FRAMES, renderPoseCanvas, SPRITE_H, SPRITE_W } from "../character/sprite";
import type { AvatarPose, PlayerController } from "./controller";

const TEX_SCALE = 3; // 48×60 → 144×180 texture

export class SpriteAvatar {
  plane: Mesh;
  private tex: DynamicTexture;
  private frames = new Map<string, HTMLCanvasElement>();
  private currentKey = "";
  private mirrored = false;
  private idleClock = 0;
  private worldH: number;

  constructor(
    scene: Scene,
    private player: PlayerController,
    character: CharacterData,
  ) {
    for (const f of AVATAR_FRAMES) this.frames.set(f.key, renderPoseCanvas(character, f.pose, f.t));

    this.tex = new DynamicTexture(
      "avatarTex",
      { width: SPRITE_W * TEX_SCALE, height: SPRITE_H * TEX_SCALE },
      scene,
      false,
      Texture.NEAREST_SAMPLINGMODE,
    );
    this.tex.hasAlpha = true;

    // Sprite world size: capsule height plus headroom for ears/hats.
    this.worldH = player.mv.capsuleHeight * 1.45;
    const worldW = this.worldH * (SPRITE_W / SPRITE_H);
    this.plane = MeshBuilder.CreatePlane("avatar", { width: worldW, height: this.worldH }, scene);
    this.plane.billboardMode = Mesh.BILLBOARDMODE_Y;
    this.plane.isPickable = false;

    // Unlit sprite: texture as emissive (colors exactly as authored), texture
    // alpha via the diffuse channel. A flat emissiveColor would override the
    // texture and render an empty white plane.
    const mat = new StandardMaterial("avatarMat", scene);
    mat.emissiveTexture = this.tex;
    mat.diffuseTexture = this.tex;
    mat.diffuseColor = new Color3(0, 0, 0);
    mat.specularColor = new Color3(0, 0, 0);
    mat.disableLighting = true;
    mat.useAlphaFromDiffuseTexture = true;
    mat.backFaceCulling = false;
    this.plane.material = mat;

    this.showFrame("idle0");
  }

  private showFrame(key: string) {
    if (key === this.currentKey) return;
    const src = this.frames.get(key);
    if (!src) return;
    this.currentKey = key;
    const ctx = this.tex.getContext() as unknown as CanvasRenderingContext2D;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, SPRITE_W * TEX_SCALE, SPRITE_H * TEX_SCALE);
    ctx.drawImage(src, 0, 0, SPRITE_W * TEX_SCALE, SPRITE_H * TEX_SCALE);
    this.tex.update(false);
  }

  private frameFor(pose: AvatarPose, dt: number): string {
    switch (pose) {
      case "run":
        return `run${Math.floor(this.player.runPhase * 4) % 4}`;
      case "idle":
        this.idleClock += dt;
        return `idle${Math.floor(this.idleClock * 1.6) % 2}`;
      default:
        return pose; // jump/fall/dash/pound/glide are single frames
    }
  }

  update(dt: number, camera: ArcRotateCamera) {
    const p = this.player.position;
    // Bottom-anchor the sprite at the capsule's feet.
    this.plane.position.set(p.x, p.y - this.player.mv.capsuleHeight / 2 + this.worldH / 2, p.z);
    this.showFrame(this.frameFor(this.player.pose, dt));

    // Mirror when traveling screen-left (hysteresis avoids flip jitter).
    if (this.player.hSpeed > 1) {
      const camRight = camera.getDirection(Vector3.Right());
      const vel = this.player.aggregate.body.getLinearVelocity();
      const dot = vel.x * camRight.x + vel.z * camRight.z;
      if (dot < -1.2) this.mirrored = true;
      else if (dot > 1.2) this.mirrored = false;
      const t = this.tex;
      t.uScale = this.mirrored ? -1 : 1;
      t.uOffset = this.mirrored ? 1 : 0;
    }
  }

  dispose() {
    this.plane.material?.dispose();
    this.plane.dispose();
    this.tex.dispose();
  }
}
