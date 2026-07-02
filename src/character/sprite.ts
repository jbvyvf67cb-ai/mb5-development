// Procedural character sprite (pixel-art bear, front-facing).
//
// Draws a character from its CharacterData onto a small logical canvas
// (48×60); consumers upscale with image-smoothing OFF for the chunky pixel
// look (designer preview and the in-world billboard both do this). Poses are
// parametric — body morph sliders reshape every frame consistently, so there
// is no hand-drawn sprite sheet to invalidate.

import type { Vec3 } from "../world/schema";
import type { CharacterData } from "./schema";

export const SPRITE_W = 48;
export const SPRITE_H = 60;

export type PoseKind = "idle" | "run" | "jump" | "fall" | "dash" | "pound" | "glide";

const css = (c: Vec3): string =>
  `rgb(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)})`;
const shade = (c: Vec3, f: number): Vec3 => [c[0] * f, c[1] * f, c[2] * f];

type Ctx = CanvasRenderingContext2D;

function blob(ctx: Ctx, cx: number, cy: number, rx: number, ry: number, fill: string, outline?: string) {
  if (outline) {
    ctx.fillStyle = outline;
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx + 0.9, ry + 0.9, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();
}

/** A limb: capsule from (x,y) at `angle` (rad, 0 = straight down) of given length. */
function limb(ctx: Ctx, x: number, y: number, angle: number, len: number, thick: number, fill: string, outline: string) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.fillStyle = outline;
  ctx.beginPath();
  ctx.ellipse(0, len / 2, thick / 2 + 0.8, len / 2 + 0.8, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.ellipse(0, len / 2, thick / 2, len / 2, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/**
 * Draw one pose frame in logical 48×60 space. The ctx should be a 48×60
 * canvas (or pre-transformed). t = animation phase 0..1.
 */
export function drawCharacter(ctx: Ctx, ch: CharacterData, pose: PoseKind, t: number) {
  ctx.clearRect(0, 0, SPRITE_W, SPRITE_H);
  const { body, colors } = ch;
  const H = body.height;
  const W = body.width;
  const wt = body.weight;

  const fur = css(colors.fur);
  const furDark = css(shade(colors.fur, 0.55));
  const muzzle = css(colors.muzzle);
  const belly = css(colors.belly);
  const accent = css(colors.accent);
  const ink = "rgb(24,18,16)";

  const cx = 24;
  const G = 57;

  // pose parameters
  const cyc = t * Math.PI * 2;
  let bob = 0;
  let lean = 0; // x offset of body+head
  let legSpread = 2.6 * W;
  let legLift: [number, number] = [0, 0]; // per-leg y lift
  let legSwing: [number, number] = [0, 0]; // per-leg x offset
  let armAngle: [number, number] = [0.35, -0.35]; // rad from straight-down (L, R)
  let armLen = 8 * H;
  let legH = 7 * H;
  let lines: "dash" | "pound" | null = null;

  switch (pose) {
    case "idle":
      bob = Math.sin(cyc) * 0.7;
      armAngle = [0.3 + Math.sin(cyc) * 0.05, -0.3 - Math.sin(cyc) * 0.05];
      break;
    case "run": {
      bob = Math.abs(Math.sin(cyc)) * 1.4;
      const s = Math.sin(cyc);
      legSwing = [s * 2.6, -s * 2.6];
      legLift = [Math.max(0, s) * 2.2, Math.max(0, -s) * 2.2];
      armAngle = [0.5 - s * 0.7, -0.5 - s * 0.7];
      lean = 1.4;
      break;
    }
    case "jump":
      bob = -1;
      legH *= 0.62;
      legSpread *= 0.7;
      armAngle = [2.6, -2.6]; // arms up
      break;
    case "fall":
      bob = 0.5;
      legSpread *= 1.5;
      legSwing = [Math.sin(cyc) * 0.6, -Math.sin(cyc) * 0.6];
      armAngle = [2.2, -2.2];
      break;
    case "dash":
      lean = 4;
      bob = 0.5;
      legH *= 0.7;
      legSwing = [-2.5, -1.2];
      armAngle = [-0.9, -1.2]; // trailing behind
      lines = "dash";
      break;
    case "pound":
      bob = 1;
      legSpread *= 1.7;
      legH *= 0.7;
      armAngle = [1.57, -1.57]; // straight out
      lines = "pound";
      break;
    case "glide":
      bob = Math.sin(cyc) * 0.8;
      legSpread *= 0.55;
      legH *= 0.85;
      armAngle = [1.62, -1.62];
      armLen *= 1.25;
      break;
  }

  // derived layout
  const legW = 3.1 * (1 + 0.55 * wt) * W;
  const bodyRx = 7.6 * W * (1 + 0.34 * wt);
  const bodyRy = 8.3 * H;
  const headR = 7.4 * body.head;
  const earR = Math.min(3 * body.ears, headR * 0.95);

  const feetY = G - bob;
  const legTop = feetY - legH;
  const bodyCy = legTop - bodyRy + 2.5;
  const headCy = bodyCy - bodyRy - headR + 3.5;
  const bx = cx + lean; // body/head x

  // --- legs + feet ---
  for (const side of [-1, 1] as const) {
    const i = side < 0 ? 0 : 1;
    const lx = cx + side * legSpread + legSwing[i];
    const ly = feetY - legLift[i];
    ctx.fillStyle = furDark;
    ctx.fillRect(lx - legW / 2 - 0.8, legTop - 1, legW + 1.6, ly - legTop + 0.8);
    ctx.fillStyle = fur;
    ctx.fillRect(lx - legW / 2, legTop, legW, ly - legTop);
    blob(ctx, lx, ly - 1, legW * 0.72, 2.1, muzzle, furDark); // foot pad
  }

  // --- arms (behind body for up poses, over body for down poses) ---
  const armY = bodyCy - bodyRy * 0.45;
  const armT = 3 * (1 + 0.5 * wt) * W;
  const armsBehind = pose === "jump" || pose === "fall" || pose === "glide" || pose === "pound";
  const drawArms = () => {
    limb(ctx, bx - bodyRx * 0.82, armY, armAngle[0], armLen, armT, fur, furDark);
    limb(ctx, bx + bodyRx * 0.82, armY, armAngle[1], armLen, armT, fur, furDark);
  };
  if (armsBehind) drawArms();

  // --- body + belly ---
  blob(ctx, bx, bodyCy, bodyRx, bodyRy, fur, furDark);
  blob(ctx, bx, bodyCy + bodyRy * 0.22, bodyRx * 0.62 * (1 + 0.25 * wt), bodyRy * 0.6, belly);
  if (!armsBehind) drawArms();

  // --- head ---
  // ears first (behind head)
  const earOff = headR * 0.66;
  blob(ctx, bx - earOff, headCy - headR * 0.78, earR, earR, fur, furDark);
  blob(ctx, bx + earOff, headCy - headR * 0.78, earR, earR, fur, furDark);
  blob(ctx, bx - earOff, headCy - headR * 0.78, earR * 0.5, earR * 0.5, muzzle);
  blob(ctx, bx + earOff, headCy - headR * 0.78, earR * 0.5, earR * 0.5, muzzle);
  blob(ctx, bx, headCy, headR, headR * 0.92, fur, furDark);

  // muzzle + nose + mouth
  blob(ctx, bx, headCy + headR * 0.34, headR * 0.52, headR * 0.38, muzzle);
  blob(ctx, bx, headCy + headR * 0.16, 1.7, 1.3, ink);
  if (pose === "jump" || pose === "fall" || pose === "pound") {
    blob(ctx, bx, headCy + headR * 0.52, 1.4, 1.7, ink); // open mouth
  } else {
    ctx.fillStyle = ink;
    ctx.fillRect(bx - 1.2, headCy + headR * 0.48, 2.4, 0.9);
  }

  // eyes (blink on idle occasionally)
  const blink = pose === "idle" && t > 0.46 && t < 0.54;
  ctx.fillStyle = ink;
  const eyeY = headCy - headR * 0.14;
  const eyeX = headR * 0.42;
  if (blink || pose === "dash") {
    ctx.fillRect(bx - eyeX - 1.3, eyeY, 2.6, 1);
    ctx.fillRect(bx + eyeX - 1.3, eyeY, 2.6, 1);
  } else {
    blob(ctx, bx - eyeX, eyeY, 1.25, 1.6, ink);
    blob(ctx, bx + eyeX, eyeY, 1.25, 1.6, ink);
    ctx.fillStyle = "rgba(255,255,255,.9)";
    ctx.fillRect(bx - eyeX + 0.3, eyeY - 1, 0.9, 0.9);
    ctx.fillRect(bx + eyeX + 0.3, eyeY - 1, 0.9, 0.9);
  }

  // --- accessory ---
  const neckY = bodyCy - bodyRy * 0.78;
  if (ch.accessory === "bowtie") {
    ctx.fillStyle = accent;
    ctx.beginPath();
    ctx.moveTo(bx - 0.8, neckY);
    ctx.lineTo(bx - 4.6, neckY - 2.6);
    ctx.lineTo(bx - 4.6, neckY + 2.6);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(bx + 0.8, neckY);
    ctx.lineTo(bx + 4.6, neckY - 2.6);
    ctx.lineTo(bx + 4.6, neckY + 2.6);
    ctx.closePath();
    ctx.fill();
    blob(ctx, bx, neckY, 1.5, 1.5, css(shade(colors.accent, 0.75)));
  } else if (ch.accessory === "cap") {
    ctx.fillStyle = accent;
    ctx.beginPath();
    ctx.ellipse(bx, headCy - headR * 0.72, headR * 0.78, headR * 0.5, 0, Math.PI, 0);
    ctx.fill();
    ctx.fillRect(bx - headR * 0.78, headCy - headR * 0.74, headR * 1.56, 1.6);
    ctx.fillRect(bx - headR * 1.05, headCy - headR * 0.74, headR * 0.5, 1.6); // brim
  } else if (ch.accessory === "scarf") {
    ctx.fillStyle = accent;
    ctx.fillRect(bx - bodyRx * 0.55, neckY - 1.2, bodyRx * 1.1, 3);
    // flapping tail
    ctx.save();
    ctx.translate(bx - bodyRx * 0.5, neckY + 1);
    ctx.rotate(0.5 + Math.sin(cyc) * 0.18 + (pose === "dash" ? 0.6 : 0));
    ctx.fillRect(-1.4, 0, 3, 7.5);
    ctx.restore();
  }

  // --- motion lines ---
  if (lines === "dash") {
    ctx.fillStyle = "rgba(255,255,255,.65)";
    for (const [ly, lw] of [[bodyCy - 4, 7], [bodyCy, 9], [bodyCy + 4, 6]] as const) {
      ctx.fillRect(bx - bodyRx - 4 - lw - (t * 4) % 3, ly, lw, 1.1);
    }
  } else if (lines === "pound") {
    ctx.fillStyle = "rgba(255,255,255,.65)";
    for (const dx of [-6, 0, 6]) {
      ctx.fillRect(bx + dx - 0.5, headCy - headR - 7 - (t * 5) % 3, 1.1, 4.5);
    }
  }
}

/** Render one pose to a fresh 48×60 canvas (transparent background). */
export function renderPoseCanvas(ch: CharacterData, pose: PoseKind, t: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = SPRITE_W;
  c.height = SPRITE_H;
  const ctx = c.getContext("2d")!;
  drawCharacter(ctx, ch, pose, t);
  return c;
}

/** The frame set the in-world avatar pre-renders (pose + phases). */
export const AVATAR_FRAMES: Array<{ key: string; pose: PoseKind; t: number }> = [
  { key: "idle0", pose: "idle", t: 0.1 },
  { key: "idle1", pose: "idle", t: 0.6 },
  { key: "run0", pose: "run", t: 0 },
  { key: "run1", pose: "run", t: 0.25 },
  { key: "run2", pose: "run", t: 0.5 },
  { key: "run3", pose: "run", t: 0.75 },
  { key: "jump", pose: "jump", t: 0 },
  { key: "fall", pose: "fall", t: 0.3 },
  { key: "dash", pose: "dash", t: 0.2 },
  { key: "pound", pose: "pound", t: 0.2 },
  { key: "glide", pose: "glide", t: 0.3 },
];
