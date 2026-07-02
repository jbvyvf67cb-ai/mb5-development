// Skins — procedural material styles for prefabs (per-instance "how it looks").
//
// Each skin paints a small DynamicTexture derived from the instance's base
// color (base color × tint still controls the hue), so one prefab can read as
// brick, planks, stone, metal… Materials are cached per (skin, color, glow).

import { Color3, DynamicTexture, StandardMaterial, Texture } from "@babylonjs/core";
import type { Scene } from "@babylonjs/core";
import type { Vec3 } from "./schema";

export const SKINS = ["default", "brick", "planks", "stone", "checker", "metal", "grass", "candy"] as const;
export type SkinKey = (typeof SKINS)[number];

const SIZE = 128;

function rng(seed: number) {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const css = (c: Vec3, f = 1): string =>
  `rgb(${Math.round(Math.min(1, c[0] * f) * 255)},${Math.round(Math.min(1, c[1] * f) * 255)},${Math.round(Math.min(1, c[2] * f) * 255)})`;

function paint(skin: SkinKey, ctx: CanvasRenderingContext2D, base: Vec3) {
  const rand = rng(1234);
  ctx.fillStyle = css(base);
  ctx.fillRect(0, 0, SIZE, SIZE);

  switch (skin) {
    case "brick": {
      ctx.fillStyle = css(base, 0.42);
      ctx.fillRect(0, 0, SIZE, SIZE);
      const bh = 16;
      const bw = 32;
      for (let r = 0; r < SIZE / bh; r++) {
        const off = r % 2 ? bw / 2 : 0;
        for (let c = -1; c < SIZE / bw + 1; c++) {
          ctx.fillStyle = css(base, 0.85 + rand() * 0.3);
          ctx.fillRect(c * bw + off + 1.5, r * bh + 1.5, bw - 3, bh - 3);
        }
      }
      break;
    }
    case "planks": {
      const pw = 21;
      for (let c = 0; c < SIZE / pw + 1; c++) {
        ctx.fillStyle = css(base, 0.8 + rand() * 0.4);
        ctx.fillRect(c * pw, 0, pw - 2, SIZE);
        ctx.fillStyle = css(base, 0.5);
        for (let i = 0; i < 3; i++) {
          const y = rand() * SIZE;
          ctx.fillRect(c * pw + 2, y, pw - 6, 1.5);
        }
      }
      break;
    }
    case "stone": {
      ctx.fillStyle = css(base, 0.75);
      ctx.fillRect(0, 0, SIZE, SIZE);
      for (let i = 0; i < 46; i++) {
        ctx.fillStyle = css(base, 0.7 + rand() * 0.5);
        ctx.beginPath();
        ctx.ellipse(rand() * SIZE, rand() * SIZE, 6 + rand() * 14, 5 + rand() * 10, rand() * 3, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    case "checker": {
      const s = SIZE / 8;
      for (let r = 0; r < 8; r++)
        for (let c = 0; c < 8; c++) {
          ctx.fillStyle = css(base, (r + c) % 2 ? 1.05 : 0.55);
          ctx.fillRect(c * s, r * s, s, s);
        }
      break;
    }
    case "metal": {
      const g = ctx.createLinearGradient(0, 0, SIZE, SIZE);
      g.addColorStop(0, css(base, 1.15));
      g.addColorStop(0.5, css(base, 0.8));
      g.addColorStop(1, css(base, 1.05));
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, SIZE, SIZE);
      ctx.fillStyle = css(base, 0.4);
      for (const [x, y] of [[12, 12], [SIZE - 12, 12], [12, SIZE - 12], [SIZE - 12, SIZE - 12]]) {
        ctx.beginPath();
        ctx.arc(x, y, 4, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    case "grass": {
      ctx.fillStyle = css(base, 0.85);
      ctx.fillRect(0, 0, SIZE, SIZE);
      for (let i = 0; i < 900; i++) {
        ctx.fillStyle = css(base, 0.65 + rand() * 0.75);
        ctx.fillRect(rand() * SIZE, rand() * SIZE, 2, 3 + rand() * 3);
      }
      break;
    }
    case "candy": {
      const s = 18;
      for (let i = -SIZE; i < SIZE * 2; i += s * 2) {
        ctx.fillStyle = css(base, 1.25);
        ctx.save();
        ctx.translate(i, 0);
        ctx.rotate(Math.PI / 4);
        ctx.fillRect(0, -SIZE, s, SIZE * 3);
        ctx.restore();
      }
      break;
    }
    default:
      break;
  }
}

const cache = new Map<string, StandardMaterial>();

export function skinMaterial(scene: Scene, skin: SkinKey, base: Vec3, glow = 0): StandardMaterial {
  const key = `${skin}_${base.map((n) => n.toFixed(3)).join("_")}_g${glow.toFixed(2)}`;
  const cached = cache.get(key);
  // Materials are scene-bound: reuse only if still attached to this scene.
  if (cached && cached.getScene() === scene) return cached;
  const m = new StandardMaterial(`skin:${key}`, scene);
  const tex = new DynamicTexture(`skintex:${key}`, { width: SIZE, height: SIZE }, scene, true, Texture.NEAREST_SAMPLINGMODE);
  const ctx = tex.getContext() as unknown as CanvasRenderingContext2D;
  paint(skin, ctx, base);
  tex.update(false);
  m.diffuseTexture = tex;
  m.specularColor = skin === "metal" ? new Color3(0.55, 0.55, 0.6) : new Color3(0.04, 0.04, 0.04);
  if (glow > 0) m.emissiveColor = new Color3(base[0] * glow, base[1] * glow, base[2] * glow);
  cache.set(key, m);
  return m;
}
