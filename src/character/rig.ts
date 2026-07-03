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
import type { Vec3 } from "../world/schema";

export type RigPose = "idle" | "run" | "jump" | "fall" | "dash" | "pound" | "glide";

export interface RigFx {
  /** Front-flip progress 0..1 (somersault / pound windup). */
  flip?: number;
  /** Vertical squash/stretch factor (1 = neutral). */
  stretch?: number;
  /** Active attack animation (overlays the base pose). */
  attack?: { kind: string; t: number };
}

const shade = (c: Vec3, f: number): Color3 => new Color3(c[0] * f, c[1] * f, c[2] * f);
const ease = (t: number) => t * t * (3 - 2 * t);

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
  private clock = 0;

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
    for (const side of [-1, 1] as const) {
      const eye = part(`eye${side}`, 0.055, 0.07, 0.03, ink, this.torso);
      eye.position.set(side * headS * 0.28, bodyH + headS * 0.62, faceZ + 0.005);
      const ear = part(`ear${side}`, earS, earS, earS * 0.5, furDark, this.torso);
      ear.position.set(side * headS * 0.42, headTopY + earS * 0.32, 0);
      const earIn = part(`earIn${side}`, earS * 0.55, earS * 0.55, earS * 0.52, muzzle, this.torso);
      earIn.position.copyFrom(ear.position);
      earIn.position.z += style === "rounded" ? 0.02 : 0.005;
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
      const tail = box("scarfTail", 0.1, 0.3, 0.03, accent, this.torso);
      tail.position.set(-bodyW * 0.3, bodyH * 0.78, -bodyD / 2 - 0.03);
      tail.rotation.x = 0.25;
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

    // --- attack overlays: arms punch, legs kick, torso twists ---
    let torsoYaw = 0;
    let spinAtkYaw: number | null = null;
    const atk = fx.attack;
    if (atk) {
      // impact envelope: fast windup → hold → recover
      const wind = ease(Math.min(1, atk.t / 0.4));
      const rec = ease(Math.max(0, (atk.t - 0.62) / 0.38));
      const a = wind * (1 - rec);
      const mix = (j: Joint, tx: number, tz?: number) => {
        j.tx = j.tx + (tx - j.tx) * a;
        if (tz !== undefined) j.tz = j.tz + (tz - j.tz) * a;
      };
      switch (atk.kind) {
        case "punch1": // right jab
          mix(this.shoulderR, -1.62, -0.06);
          mix(this.elbowR, -0.08);
          mix(this.shoulderL, 0.45, 0.25);
          torsoYaw = -0.38 * a;
          break;
        case "punch2": // left cross
          mix(this.shoulderL, -1.62, 0.06);
          mix(this.elbowL, -0.08);
          mix(this.shoulderR, 0.45, -0.25);
          torsoYaw = 0.38 * a;
          break;
        case "punch3": // both-arm slam
          mix(this.shoulderL, -1.75, 0.15);
          mix(this.shoulderR, -1.75, -0.15);
          mix(this.elbowL, -0.12);
          mix(this.elbowR, -0.12);
          torsoPitch += 0.35 * a;
          break;
        case "kick": // right roundhouse
          mix(this.hipR, -1.8, -0.12);
          mix(this.kneeR, 0.12);
          mix(this.hipL, 0.25);
          mix(this.shoulderL, 0.2, 0.9);
          mix(this.shoulderR, 0.2, -0.9);
          torsoPitch -= 0.3 * a;
          torsoYaw = 0.3 * a;
          break;
        case "airkick": // flying double kick
          mix(this.hipL, -1.3, 0.08);
          mix(this.hipR, -1.0, -0.08);
          mix(this.kneeL, 0.18);
          mix(this.kneeR, 0.35);
          mix(this.shoulderL, 0.9, 0.5);
          mix(this.shoulderR, 0.9, -0.5);
          torsoPitch += 0.5 * a;
          break;
        case "spin": // 720° arms-out cyclone
          mix(this.shoulderL, 0, 1.57);
          mix(this.shoulderR, 0, -1.57);
          mix(this.elbowL, -0.05);
          mix(this.elbowR, -0.05);
          spinAtkYaw = ease(atk.t) * Math.PI * 4; // two full turns, ends aligned
          break;
      }
    }

    const k = Math.min(1, dt * 16);
    for (const j of [this.shoulderL, this.shoulderR, this.elbowL, this.elbowR, this.hipL, this.hipR, this.kneeL, this.kneeR]) {
      j.node.rotation.x += (j.tx - j.node.rotation.x) * k;
      j.node.rotation.z += (j.tz - j.node.rotation.z) * k;
    }
    this.torso.rotation.x += (torsoPitch - this.torso.rotation.x) * k;
    this.torso.rotation.y += (torsoYaw - this.torso.rotation.y) * Math.min(1, dt * 20);
    this.torso.position.y = this.baseTorsoY + torsoBob;
    this.spin.rotation.y = spinAtkYaw ?? 0;

    // flip (somersault / pound windup) around the center of mass.
    // FRONT flip = positive X (top of the head travels forward). When a flip
    // is interrupted, finish the turn smoothly instead of snapping upright.
    const flip = fx.flip ?? 0;
    if (flip > 0) {
      this.spinCur = ease(flip) * Math.PI * 2;
    } else {
      const target = this.spinCur > Math.PI ? Math.PI * 2 : 0;
      this.spinCur += (target - this.spinCur) * Math.min(1, dt * 14);
      if (Math.abs(target - this.spinCur) < 0.02) this.spinCur = 0;
    }
    this.spin.rotation.x = this.spinCur;

    // squash & stretch (volume-ish preserving); shift the pivot down so the
    // FEET stay planted while the body compresses
    const s = fx.stretch ?? 1;
    const xz = 1 / Math.sqrt(Math.max(0.5, s));
    this.spin.scaling.set(xz, s, xz);
    this.spin.position.y = this.spinY * s;
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
