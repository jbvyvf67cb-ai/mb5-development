// CharacterRig — the character as a real 3D body with a real (procedural)
// skeleton: two-segment arms (shoulder + ELBOW) and legs (hip + KNEE), a spin
// node for flips, and squash & stretch. Built from CharacterData in either
// style (blocky boxes / rounded spheres+capsules); every animation is code-
// driven and parametric, so sliders, presets, and AI-generated characters all
// move identically.
//
// Node graph:
//   root (yaw, at the feet)
//    └ spin (flip rotation + squash/stretch, at the center of mass)
//       ├ torso (pitch) → body/head/face/accessory + shoulders→elbows
//       └ hipL/hipR → thigh → knee → shin + foot

import { Color3, Mesh, MeshBuilder, StandardMaterial, TransformNode, Vector3 } from "@babylonjs/core";
import type { Scene } from "@babylonjs/core";
import type { CharacterData } from "./schema";
import type { ChannelPose } from "./moves";
import type { Vec3 } from "../world/schema";

export type RigPose = "idle" | "run" | "jump" | "fall" | "dash" | "pound" | "glide";

export interface RigFx {
  /** Vertical squash/stretch factor (1 = neutral). */
  stretch?: number;
  /** Generic move overlay: semantic channel targets + blend amount 0..1. */
  movePose?: { pose: ChannelPose; a: number };
  /** Absolute body rotations from the active move (radians). When they stop
   * arriving, the rig eases home to the nearest full turn — interrupted flips
   * finish instead of snapping. */
  spinX?: number;
  spinY?: number;
  /** Secondary-motion drivers: accessories are LIVE (scarves trail with
   * speed, wings flap airborne, ears flop with vy, halos lag). */
  vy?: number;
  speed?: number;
  airborne?: boolean;
  gliding?: boolean;
  earSpin?: boolean;
}

const shade = (c: Vec3, f: number): Color3 => new Color3(c[0] * f, c[1] * f, c[2] * f);

interface Joint {
  node: TransformNode;
  tx: number; // target rotation.x
  tz: number; // target rotation.z
}

export class CharacterRig {
  root: TransformNode;
  /** Feet → top of head (after any targetHeight scaling). */
  height: number;

  private scene: Scene;
  private mats: StandardMaterial[] = [];
  private spin: TransformNode;
  private torso: TransformNode;
  private shoulderL!: Joint;
  private shoulderR!: Joint;
  private elbowL!: Joint;
  private elbowR!: Joint;
  private hipL!: Joint;
  private hipR!: Joint;
  private kneeL!: Joint;
  private kneeR!: Joint;
  private baseTorsoY: number;
  private spinY: number;
  private spinCur = 0;
  private spinYCur = 0;
  private clock = 0;
  // live accessory + anatomy refs for secondary motion
  private scarfA: TransformNode | null = null;
  private scarfB: TransformNode | null = null;
  private wings: Array<{ mesh: Mesh; side: -1 | 1 }> = [];
  private ears: Array<{ pivot: TransformNode; side: -1 | 1 }> = [];
  private earRoot: TransformNode | null = null;
  private earSpinCur = 0;
  private halo: Mesh | null = null;
  private haloBaseY = 0;

  constructor(scene: Scene, ch: CharacterData, name = "rig", opts: { targetHeight?: number } = {}) {
    this.scene = scene;
    this.root = new TransformNode(`${name}:root`, scene);

    const b = ch.body;
    const H = b.height;
    const W = b.width;
    const wt = b.weight;
    const c = ch.colors;
    const style = ch.style ?? "blocky";

    const fur = this.mat(shade(c.fur, 1));
    const furDark = this.mat(shade(c.fur, 0.75));
    const muzzle = this.mat(shade(c.muzzle, 1));
    const belly = this.mat(shade(c.belly, 1));
    const accent = this.mat(shade(c.accent, 1));
    const ink = this.mat(new Color3(0.09, 0.07, 0.06));

    // proportions (meters) — legs long enough to READ when they swing
    const thighLen = 0.22 * H;
    const shinLen = 0.2 * H;
    const legH = thighLen + shinLen;
    const legT = 0.14 * W * (1 + 0.45 * wt);
    const bodyH = 0.5 * H;
    const bodyW = 0.5 * W * (1 + 0.42 * wt);
    const bodyD = 0.32 * W * (1 + 0.32 * wt);
    const headS = 0.46 * b.head;
    const upperArm = 0.22 * H;
    const foreArm = 0.18 * H;
    const armT = 0.11 * W * (1 + 0.4 * wt);
    const earS = 0.15 * b.ears;

    const natural = legH + bodyH + headS;
    this.height = natural;

    // spin pivot at the center of mass
    this.spinY = legH + bodyH * 0.42;
    this.spin = new TransformNode(`${name}:spin`, scene);
    this.spin.parent = this.root;
    this.spin.position.y = this.spinY;

    this.torso = new TransformNode(`${name}:torsoN`, scene);
    this.torso.parent = this.spin;
    this.baseTorsoY = legH - this.spinY;
    this.torso.position.y = this.baseTorsoY;

    const box = (nm: string, w: number, h: number, d: number, m: StandardMaterial, parent: TransformNode) => {
      const mesh = MeshBuilder.CreateBox(`${name}:${nm}`, { width: w, height: h, depth: d }, scene);
      mesh.material = m;
      mesh.parent = parent;
      mesh.isPickable = false;
      return mesh;
    };
    const ball = (nm: string, w: number, h: number, d: number, m: StandardMaterial, parent: TransformNode) => {
      const mesh = MeshBuilder.CreateSphere(`${name}:${nm}`, { diameter: 1, segments: 12 }, scene);
      mesh.scaling.set(w, h, d);
      mesh.material = m;
      mesh.parent = parent;
      mesh.isPickable = false;
      return mesh;
    };
    const part = style === "rounded" ? ball : box;
    const segment = (nm: string, len: number, t: number, m: StandardMaterial, parent: TransformNode): Mesh => {
      let mesh: Mesh;
      if (style === "rounded") {
        mesh = MeshBuilder.CreateCapsule(`${name}:${nm}`, { radius: t / 2, height: len + t * 0.6 }, scene);
        mesh.material = m;
        mesh.parent = parent;
        mesh.isPickable = false;
      } else {
        mesh = box(nm, t, len, t, m, parent);
      }
      mesh.position.y = -len / 2;
      return mesh;
    };
    const jointAt = (nm: string, parent: TransformNode, x: number, y: number, z: number): Joint => {
      const node = new TransformNode(`${name}:${nm}`, scene);
      node.parent = parent;
      node.position.set(x, y, z);
      return { node, tx: 0, tz: 0 };
    };

    // --- body + belly ---
    const body = part("body", bodyW * (style === "rounded" ? 1.12 : 1), bodyH * (style === "rounded" ? 1.08 : 1), bodyD * (style === "rounded" ? 1.18 : 1), fur, this.torso);
    body.position.y = bodyH / 2;
    const bellyPlate = part("belly", bodyW * 0.62, bodyH * 0.6, style === "rounded" ? 0.12 : 0.02, belly, this.torso);
    bellyPlate.position.set(0, bodyH * 0.42, bodyD / 2 + (style === "rounded" ? 0.045 : 0.005));

    // --- head + face (+Z forward) ---
    const head = part("head", headS * 1.15, headS * (style === "rounded" ? 1.08 : 1), headS * (style === "rounded" ? 1.05 : 0.95), fur, this.torso);
    head.position.y = bodyH + headS / 2 - 0.02;
    const headTopY = bodyH + headS;
    const faceZ = (headS * (style === "rounded" ? 1.05 : 0.95)) / 2;
    const muzzleP = part("muzzle", headS * 0.5, headS * 0.34, style === "rounded" ? 0.16 : 0.08, muzzle, this.torso);
    muzzleP.position.set(0, bodyH + headS * 0.3, faceZ + 0.02);
    const nose = part("nose", 0.05, 0.04, 0.04, ink, this.torso);
    nose.position.set(0, bodyH + headS * 0.4, faceZ + (style === "rounded" ? 0.1 : 0.085));
    // ears hang off pivots (so they can flop with motion — or helicopter)
    this.earRoot = new TransformNode(`${name}:earRoot`, scene);
    this.earRoot.parent = this.torso;
    this.earRoot.position.y = headTopY;
    for (const side of [-1, 1] as const) {
      const eye = part(`eye${side}`, 0.055, 0.07, 0.03, ink, this.torso);
      eye.position.set(side * headS * 0.28, bodyH + headS * 0.62, faceZ + 0.005);
      const pivot = new TransformNode(`${name}:earPivot${side}`, scene);
      pivot.parent = this.earRoot;
      pivot.position.set(side * headS * 0.42, 0, 0);
      const ear = part(`ear${side}`, earS, earS, earS * 0.5, furDark, pivot);
      ear.position.y = earS * 0.32;
      const earIn = part(`earIn${side}`, earS * 0.55, earS * 0.55, earS * 0.52, muzzle, pivot);
      earIn.position.set(0, earS * 0.32, style === "rounded" ? 0.02 : 0.005);
      this.ears.push({ pivot, side });
    }

    // --- arms: shoulder → upper arm → ELBOW → forearm + paw ---
    const mkArm = (side: -1 | 1): [Joint, Joint] => {
      const shoulder = jointAt(`shoulder${side}`, this.torso, side * (bodyW / 2 + armT / 2 + 0.01), bodyH * 0.86, 0);
      segment(`upperArm${side}`, upperArm, armT, fur, shoulder.node);
      const elbow = jointAt(`elbow${side}`, shoulder.node, 0, -upperArm, 0);
      segment(`foreArm${side}`, foreArm, armT * 0.92, fur, elbow.node);
      const paw = part(`paw${side}`, armT * 1.15, armT * 0.9, armT * 1.15, muzzle, elbow.node);
      paw.position.y = -foreArm;
      return [shoulder, elbow];
    };
    [this.shoulderL, this.elbowL] = mkArm(-1);
    [this.shoulderR, this.elbowR] = mkArm(1);

    // --- legs: hip → thigh → KNEE → shin + foot ---
    const mkLeg = (side: -1 | 1): [Joint, Joint] => {
      const hip = jointAt(`hip${side}`, this.spin, side * bodyW * 0.26, legH - this.spinY, 0);
      segment(`thigh${side}`, thighLen, legT, furDark, hip.node);
      const knee = jointAt(`knee${side}`, hip.node, 0, -thighLen, 0);
      segment(`shin${side}`, shinLen, legT * 0.9, furDark, knee.node);
      const foot = part(`foot${side}`, legT * 1.15, legT * 0.5, legT * 1.7, muzzle, knee.node);
      foot.position.set(0, -shinLen + legT * 0.2, legT * 0.3);
      return [hip, knee];
    };
    [this.hipL, this.kneeL] = mkLeg(-1);
    [this.hipR, this.kneeR] = mkLeg(1);

    // --- accessory wardrobe ---
    const acc = ch.accessory;
    if (acc === "bowtie") {
      const knot = box("bowKnot", 0.06, 0.06, 0.04, this.mat(shade(c.accent, 0.8)), this.torso);
      knot.position.set(0, bodyH * 0.92, bodyD / 2 + 0.04);
      for (const side of [-1, 1] as const) {
        const wing = box(`bow${side}`, 0.11, 0.08, 0.035, accent, this.torso);
        wing.position.set(side * 0.09, bodyH * 0.92, bodyD / 2 + 0.038);
        wing.rotation.z = side * 0.18;
      }
    } else if (acc === "cap") {
      const dome = MeshBuilder.CreateSphere(`${name}:capDome`, { diameter: headS * 1.24, segments: 12, slice: 0.55 }, scene);
      dome.material = accent;
      dome.parent = this.torso;
      dome.isPickable = false;
      dome.position.y = headTopY - headS * 0.12;
      const brim = box("capBrim", headS * 0.85, 0.035, headS * 0.55, accent, this.torso);
      brim.position.set(0, headTopY - headS * 0.02, faceZ + headS * 0.22);
    } else if (acc === "scarf") {
      const band = part("scarf", bodyW * 1.08, 0.1, bodyD * 1.12, accent, this.torso);
      band.position.y = bodyH * 0.97;
      // the tail is a two-segment chain hung from the neck — it trails,
      // floats, and flutters with motion (animated in update)
      this.scarfA = new TransformNode(`${name}:scarfA`, scene);
      this.scarfA.parent = this.torso;
      this.scarfA.position.set(-bodyW * 0.22, bodyH * 0.94, -bodyD / 2 - 0.03);
      this.scarfA.rotation.x = 0.25;
      const seg1 = box("scarfSeg1", 0.11, 0.27, 0.03, accent, this.scarfA);
      seg1.position.y = -0.135;
      this.scarfB = new TransformNode(`${name}:scarfB`, scene);
      this.scarfB.parent = this.scarfA;
      this.scarfB.position.y = -0.27;
      const seg2 = box("scarfSeg2", 0.095, 0.25, 0.028, this.mat(shade(c.accent, 0.85)), this.scarfB);
      seg2.position.y = -0.125;
    } else if (acc === "crown") {
      const ring = MeshBuilder.CreateCylinder(`${name}:crown`, { diameter: headS * 0.85, height: 0.1, tessellation: 12 }, scene);
      ring.material = accent;
      ring.parent = this.torso;
      ring.isPickable = false;
      ring.position.y = headTopY + 0.05;
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
        const spike = box(`crownS${i}`, 0.05, 0.1, 0.05, accent, this.torso);
        spike.position.set(Math.cos(a) * headS * 0.36, headTopY + 0.14, Math.sin(a) * headS * 0.36);
      }
    } else if (acc === "glasses") {
      const dark = this.mat(shade(c.accent, 0.9));
      for (const side of [-1, 1] as const) {
        const lens = MeshBuilder.CreateTorus(`${name}:lens${side}`, { diameter: headS * 0.36, thickness: 0.022, tessellation: 14 }, scene);
        lens.material = dark;
        lens.parent = this.torso;
        lens.isPickable = false;
        lens.rotation.x = Math.PI / 2;
        lens.position.set(side * headS * 0.28, bodyH + headS * 0.62, faceZ + 0.03);
      }
      const bridge = box("glBridge", headS * 0.2, 0.02, 0.02, dark, this.torso);
      bridge.position.set(0, bodyH + headS * 0.62, faceZ + 0.03);
    } else if (acc === "halo") {
      const glowMat = this.mat(shade(c.accent, 1));
      glowMat.emissiveColor = new Color3(c.accent[0] * 0.8, c.accent[1] * 0.8, c.accent[2] * 0.8);
      const halo = MeshBuilder.CreateTorus(`${name}:halo`, { diameter: headS * 0.95, thickness: 0.045, tessellation: 20 }, scene);
      halo.material = glowMat;
      halo.parent = this.torso;
      halo.isPickable = false;
      halo.position.y = headTopY + earS + 0.14;
      this.halo = halo;
      this.haloBaseY = halo.position.y;
    } else if (acc === "horns") {
      for (const side of [-1, 1] as const) {
        const horn = MeshBuilder.CreateCylinder(`${name}:horn${side}`, { diameterTop: 0, diameterBottom: 0.09, height: 0.22, tessellation: 8 }, scene);
        horn.material = accent;
        horn.parent = this.torso;
        horn.isPickable = false;
        horn.position.set(side * headS * 0.3, headTopY + 0.08, 0.04);
        horn.rotation.z = -side * 0.35;
      }
    } else if (acc === "backpack") {
      const pack = part("pack", bodyW * 0.72, bodyH * 0.62, 0.24, accent, this.torso);
      pack.position.set(0, bodyH * 0.55, -bodyD / 2 - 0.12);
      const pocket = part("pocket", bodyW * 0.4, bodyH * 0.3, 0.1, this.mat(shade(c.accent, 0.7)), this.torso);
      pocket.position.set(0, bodyH * 0.45, -bodyD / 2 - 0.26);
      for (const side of [-1, 1] as const) {
        const strap = box(`strap${side}`, 0.06, bodyH * 0.5, 0.03, this.mat(shade(c.accent, 0.65)), this.torso);
        strap.position.set(side * bodyW * 0.25, bodyH * 0.68, bodyD / 2 - 0.06);
      }
    } else if (acc === "wings") {
      for (const side of [-1, 1] as const) {
        const wing = ball(`wing${side}`, 0.4, 0.6, 0.09, accent, this.torso);
        wing.position.set(side * bodyW * 0.52, bodyH * 0.72, -bodyD / 2 - 0.05);
        wing.rotation.z = side * 0.55;
        wing.rotation.y = -side * 0.3;
        this.wings.push({ mesh: wing, side });
      }
    }

    // scale to match the gameplay collider so the visual body IS the hitbox
    if (opts.targetHeight && natural > 0.01) {
      const k = opts.targetHeight / natural;
      this.root.scaling.setAll(k);
      this.height = opts.targetHeight;
    }
  }

  private mat(color: Color3): StandardMaterial {
    const m = new StandardMaterial("rigMat", this.scene);
    m.diffuseColor = color;
    m.specularColor = new Color3(0.05, 0.05, 0.05);
    this.mats.push(m);
    return m;
  }

  /** Drive the pose each frame. runPhase cycles 0..1 with actual travel. */
  update(pose: RigPose, runPhase: number, dt: number, fx: RigFx = {}) {
    this.clock += dt;
    const phi = runPhase * Math.PI * 2;
    const sL = Math.sin(phi);
    const sR = Math.sin(phi + Math.PI);
    let torsoPitch = 0;
    let torsoBob = 0;

    const set = (j: Joint, tx: number, tz: number) => {
      j.tx = tx;
      j.tz = tz;
    };

    switch (pose) {
      case "run": {
        // stride: hips swing, knees flex on the recovery swing, arms pump
        const kneeL = 0.28 + Math.max(0, Math.sin(phi - 2.1)) * 1.15;
        const kneeR = 0.28 + Math.max(0, Math.sin(phi + Math.PI - 2.1)) * 1.15;
        set(this.hipL, sL * 0.85, 0);
        set(this.hipR, sR * 0.85, 0);
        set(this.kneeL, kneeL, 0);
        set(this.kneeR, kneeR, 0);
        set(this.shoulderL, sR * 0.7, 0.1);
        set(this.shoulderR, sL * 0.7, -0.1);
        set(this.elbowL, -0.75, 0);
        set(this.elbowR, -0.75, 0);
        torsoPitch = 0.16;
        torsoBob = Math.abs(Math.sin(phi)) * 0.03;
        break;
      }
      case "idle": {
        const breathe = Math.sin(this.clock * 2.2) * 0.02;
        set(this.hipL, 0, 0);
        set(this.hipR, 0, 0);
        set(this.kneeL, 0.06, 0);
        set(this.kneeR, 0.06, 0);
        set(this.shoulderL, 0, 0.1 + breathe);
        set(this.shoulderR, 0, -0.1 - breathe);
        set(this.elbowL, -0.3, 0);
        set(this.elbowR, -0.3, 0);
        break;
      }
      case "jump":
        set(this.hipL, -0.7, 0); // thighs up
        set(this.hipR, -0.45, 0);
        set(this.kneeL, 1.5, 0); // full tuck
        set(this.kneeR, 1.3, 0);
        set(this.shoulderL, -2.5, 0.35);
        set(this.shoulderR, -2.5, -0.35);
        set(this.elbowL, -0.5, 0);
        set(this.elbowR, -0.5, 0);
        break;
      case "fall":
        set(this.hipL, -0.3, 0.12);
        set(this.hipR, 0.05, -0.12);
        set(this.kneeL, 0.7, 0);
        set(this.kneeR, 0.4, 0);
        set(this.shoulderL, -2.1, 0.8);
        set(this.shoulderR, -2.1, -0.8);
        set(this.elbowL, -0.25, 0);
        set(this.elbowR, -0.25, 0);
        break;
      case "dash":
        set(this.hipL, -0.9, 0); // stride frozen mid-leap
        set(this.hipR, 0.9, 0);
        set(this.kneeL, 0.9, 0);
        set(this.kneeR, 0.35, 0);
        set(this.shoulderL, 1.15, 0.2); // trailing behind
        set(this.shoulderR, 1.15, -0.2);
        set(this.elbowL, -0.5, 0);
        set(this.elbowR, -0.5, 0);
        torsoPitch = 0.55;
        break;
      case "pound":
        set(this.hipL, -0.5, 0.4); // star
        set(this.hipR, -0.5, -0.4);
        set(this.kneeL, 1.4, 0);
        set(this.kneeR, 1.4, 0);
        set(this.shoulderL, 0, 1.5);
        set(this.shoulderR, 0, -1.5);
        set(this.elbowL, -0.2, 0);
        set(this.elbowR, -0.2, 0);
        torsoPitch = -0.1;
        break;
      case "glide":
        set(this.hipL, 0.15, 0.06); // legs trail slightly back
        set(this.hipR, 0.15, -0.06);
        set(this.kneeL, 0.25, 0);
        set(this.kneeR, 0.25, 0);
        set(this.shoulderL, 0, 1.57); // wings out
        set(this.shoulderR, 0, -1.57);
        set(this.elbowL, -0.12, 0);
        set(this.elbowR, -0.12, 0);
        torsoPitch = 0.32 + Math.sin(this.clock * 3) * 0.05;
        break;
    }

    // --- generic move overlay: any move's ChannelPose blends over the base
    // pose. One player animates the entire 50+ move catalog on every body.
    let torsoYaw = 0;
    const mp = fx.movePose;
    if (mp && mp.a > 0) {
      const a = Math.min(1, mp.a);
      const P = mp.pose;
      const mix2 = (j: Joint, v?: [number, number]) => {
        if (!v) return;
        j.tx += (v[0] - j.tx) * a;
        j.tz += (v[1] - j.tz) * a;
      };
      const mix1 = (j: Joint, v?: number) => {
        if (v !== undefined) j.tx += (v - j.tx) * a;
      };
      mix2(this.shoulderL, P.shL);
      mix2(this.shoulderR, P.shR);
      mix1(this.elbowL, P.elL);
      mix1(this.elbowR, P.elR);
      mix2(this.hipL, P.hipL);
      mix2(this.hipR, P.hipR);
      mix1(this.kneeL, P.kneeL);
      mix1(this.kneeR, P.kneeR);
      if (P.pitch !== undefined) torsoPitch += (P.pitch - torsoPitch) * a;
      if (P.yaw !== undefined) torsoYaw = P.yaw * a;
    }

    const k = Math.min(1, dt * 16);
    for (const j of [this.shoulderL, this.shoulderR, this.elbowL, this.elbowR, this.hipL, this.hipR, this.kneeL, this.kneeR]) {
      j.node.rotation.x += (j.tx - j.node.rotation.x) * k;
      j.node.rotation.z += (j.tz - j.node.rotation.z) * k;
    }
    this.torso.rotation.x += (torsoPitch - this.torso.rotation.x) * k;
    this.torso.rotation.y += (torsoYaw - this.torso.rotation.y) * Math.min(1, dt * 20);
    this.torso.position.y = this.baseTorsoY + torsoBob;

    // body spins around the center of mass. FRONT flip = positive X (top of
    // the head travels forward). Moves feed absolute angles; when they stop,
    // ease home to the nearest full turn — interrupted spins finish, never snap.
    this.spinCur = this.settleSpin(this.spinCur, fx.spinX, dt);
    this.spin.rotation.x = this.spinCur;
    this.spinYCur = this.settleSpin(this.spinYCur, fx.spinY, dt);
    this.spin.rotation.y = this.spinYCur;

    // squash & stretch (volume-ish preserving); shift the pivot down so the
    // FEET stay planted while the body compresses
    const s = fx.stretch ?? 1;
    const xz = 1 / Math.sqrt(Math.max(0.5, s));
    this.spin.scaling.set(xz, s, xz);
    this.spin.position.y = this.spinY * s;

    // --- secondary motion: nothing on the body is decorative-only ---
    const vy = fx.vy ?? 0;
    const speed = fx.speed ?? 0;
    const sway = Math.min(1, speed / 8);
    if (this.scarfA && this.scarfB) {
      // the scarf trails and FLOATS: lift with speed, glide, and fall
      const lift = Math.min(1.35, speed * 0.09 + (fx.gliding ? 0.55 : 0) + Math.max(0, -vy) * 0.06);
      const freq = 5 + speed * 0.9;
      const flutter = Math.sin(this.clock * freq) * (0.06 + sway * 0.16 + (fx.gliding ? 0.1 : 0));
      this.scarfA.rotation.x += (0.25 + lift + flutter - this.scarfA.rotation.x) * Math.min(1, dt * 7);
      this.scarfB.rotation.x +=
        (lift * 0.5 + Math.sin(this.clock * freq - 1.1) * (0.1 + sway * 0.22) - this.scarfB.rotation.x) *
        Math.min(1, dt * 5.5);
      this.scarfA.rotation.z = Math.sin(this.clock * 2.3) * 0.06 * (0.4 + sway);
    }
    for (const w of this.wings) {
      // flap airborne, spread wide while gliding, breathe on the ground
      const base = fx.gliding ? 1.15 : 0.55;
      const flap = fx.airborne ? Math.sin(this.clock * 11) * (fx.gliding ? 0.12 : 0.5) : Math.sin(this.clock * 2) * 0.06;
      w.mesh.rotation.z += (w.side * (base + flap) - w.mesh.rotation.z) * Math.min(1, dt * 12);
    }
    if (this.earRoot) {
      if (fx.earSpin) {
        // helicopter mode: ears flatten into rotor blades and whirl
        this.earSpinCur += dt * 26;
        this.earRoot.rotation.y = this.earSpinCur;
        for (const e of this.ears) {
          e.pivot.rotation.z += (-e.side * 1.25 - e.pivot.rotation.z) * Math.min(1, dt * 10);
        }
      } else {
        this.earSpinCur = this.settleSpin(this.earSpinCur, undefined, dt);
        this.earRoot.rotation.y = this.earSpinCur;
        for (const e of this.ears) {
          // ears flop against vertical motion + a jog bounce at speed
          const flop = Math.max(-0.55, Math.min(0.3, -vy * 0.045)) + Math.sin(this.clock * 9 + e.side) * 0.05 * sway;
          e.pivot.rotation.x += (flop - e.pivot.rotation.x) * Math.min(1, dt * 9);
          e.pivot.rotation.z += (0 - e.pivot.rotation.z) * Math.min(1, dt * 8);
        }
      }
    }
    if (this.halo) {
      // the halo lags: bobs on its own time, tips against vertical motion
      this.halo.position.y = this.haloBaseY + Math.sin(this.clock * 2.4) * 0.025;
      this.halo.rotation.x += (Math.max(-0.3, Math.min(0.3, -vy * 0.02)) - this.halo.rotation.x) * Math.min(1, dt * 6);
      this.halo.rotation.y += dt * 0.8;
    }
  }

  /** Ease a spin angle home to the nearest full turn once its move ends. */
  private settleSpin(cur: number, target: number | undefined, dt: number): number {
    if (target !== undefined) return target;
    if (cur === 0) return 0;
    const TAU = Math.PI * 2;
    const home = Math.round(cur / TAU) * TAU;
    let next = cur + (home - cur) * Math.min(1, dt * 14);
    if (Math.abs(next - home) < 0.02) next = 0; // a full turn looks identical to 0
    return next;
  }

  setYaw(yaw: number) {
    this.root.rotation.y = yaw;
  }

  get position(): Vector3 {
    return this.root.position;
  }

  dispose() {
    this.root.dispose(false, true);
    for (const m of this.mats) m.dispose();
  }
}

/** All rig meshes (for shadow casters etc.). */
export function rigMeshes(rig: CharacterRig): Mesh[] {
  return rig.root.getChildMeshes(false) as Mesh[];
}
