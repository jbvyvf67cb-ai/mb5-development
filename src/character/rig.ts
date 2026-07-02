// CharacterRig — the character as a real 3D body (blocky, Crossy-Road-style).
//
// Built procedurally from CharacterData: the same body morphs, colors, and
// accessory that the designer sliders edit produce actual meshes with jointed
// limbs, and every animation is code-driven (no skeletal assets). That keeps
// the whole pipeline parametric: sliders, presets, and AI-generated characters
// (including image→character) all land on the same rig and move identically —
// which is what keeps gameplay smooth.

import { Color3, Mesh, MeshBuilder, StandardMaterial, TransformNode, Vector3 } from "@babylonjs/core";
import type { Scene } from "@babylonjs/core";
import type { CharacterData } from "./schema";
import type { Vec3 } from "../world/schema";

export type RigPose = "idle" | "run" | "jump" | "fall" | "dash" | "pound" | "glide";

const shade = (c: Vec3, f: number): Color3 => new Color3(c[0] * f, c[1] * f, c[2] * f);

interface Joint {
  node: TransformNode;
  targetX: number; // desired local rotation.x
  targetZ: number;
}

export class CharacterRig {
  /** Yaw this node to face travel direction; position = feet. */
  root: TransformNode;
  /** Total height (feet → top of head), for camera/scaling decisions. */
  height: number;

  private scene: Scene;
  private mats: StandardMaterial[] = [];
  private armL!: Joint;
  private armR!: Joint;
  private legL!: Joint;
  private legR!: Joint;
  private torso!: TransformNode; // pitch/bob node (body + head + arms)
  private baseTorsoY: number;
  private clock = 0;

  constructor(scene: Scene, ch: CharacterData, name = "rig") {
    this.scene = scene;
    this.root = new TransformNode(`${name}:root`, scene);

    const b = ch.body;
    const H = b.height;
    const W = b.width;
    const wt = b.weight;
    const c = ch.colors;

    const fur = this.mat(shade(c.fur, 1));
    const furDark = this.mat(shade(c.fur, 0.75));
    const muzzle = this.mat(shade(c.muzzle, 1));
    const belly = this.mat(shade(c.belly, 1));
    const accent = this.mat(shade(c.accent, 1));
    const ink = this.mat(new Color3(0.09, 0.07, 0.06));

    // proportions (meters) — chunky mascot ratios
    const legH = 0.3 * H;
    const legT = 0.15 * W * (1 + 0.5 * wt);
    const bodyH = 0.56 * H;
    const bodyW = 0.52 * W * (1 + 0.45 * wt);
    const bodyD = 0.34 * W * (1 + 0.35 * wt);
    const headS = 0.48 * b.head;
    const armL_ = 0.4 * H;
    const armT = 0.12 * W * (1 + 0.45 * wt);
    const earS = 0.15 * b.ears;

    this.height = legH + bodyH + headS * 1.05;

    const style = ch.style ?? "blocky";
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
    // style-aware body part: chunky box or organic ellipsoid
    const part = style === "rounded" ? ball : box;
    const joint = (nm: string, x: number, y: number, z: number): Joint => {
      const node = new TransformNode(`${name}:${nm}`, scene);
      node.parent = this.torso;
      node.position.set(x, y, z);
      return { node, targetX: 0, targetZ: 0 };
    };

    // torso group (bobs/pitches as one)
    this.torso = new TransformNode(`${name}:torso`, scene);
    this.torso.parent = this.root;
    this.baseTorsoY = legH;
    this.torso.position.y = legH;

    // body + belly patch
    const body = part("body", bodyW * (style === "rounded" ? 1.12 : 1), bodyH * (style === "rounded" ? 1.06 : 1), bodyD * (style === "rounded" ? 1.15 : 1), fur, this.torso);
    body.position.y = bodyH / 2;
    const bellyPlate = part("belly", bodyW * 0.62, bodyH * 0.6, style === "rounded" ? 0.12 : 0.02, belly, this.torso);
    bellyPlate.position.set(0, bodyH * 0.42, bodyD / 2 + (style === "rounded" ? 0.04 : 0.005));

    // head (+Z = forward/face)
    const head = part("head", headS * 1.15, headS * (style === "rounded" ? 1.08 : 1), headS * (style === "rounded" ? 1.05 : 0.95), fur, this.torso);
    head.position.y = bodyH + headS / 2 - 0.02;
    const headTopY = bodyH + headS;
    const faceZ = (headS * (style === "rounded" ? 1.05 : 0.95)) / 2;
    const muzzleBox = part("muzzle", headS * 0.5, headS * 0.34, style === "rounded" ? 0.16 : 0.08, muzzle, this.torso);
    muzzleBox.position.set(0, bodyH + headS * 0.3, faceZ + 0.02);
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

    // limbs (joint nodes at shoulder/hip; mesh hangs below)
    const limbMesh = (j: Joint, len: number, t: number, m: StandardMaterial, nm: string) => {
      let mesh: Mesh;
      if (style === "rounded") {
        mesh = MeshBuilder.CreateCapsule(`${name}:${nm}`, { radius: t / 2, height: len + t }, scene);
        mesh.material = m;
        mesh.parent = j.node;
        mesh.isPickable = false;
      } else {
        mesh = box(nm, t, len, t, m, j.node);
      }
      mesh.position.y = -len / 2;
      return mesh;
    };
    this.armL = joint("armL", -(bodyW / 2 + armT / 2 + 0.01), bodyH * 0.88, 0);
    this.armR = joint("armR", bodyW / 2 + armT / 2 + 0.01, bodyH * 0.88, 0);
    limbMesh(this.armL, armL_, armT, fur, "armLm");
    limbMesh(this.armR, armL_, armT, fur, "armRm");

    // legs parent to root (they carry the body)
    const hipY = legH;
    const mkLeg = (nm: string, sx: number): Joint => {
      const node = new TransformNode(`${name}:${nm}`, scene);
      node.parent = this.root;
      node.position.set(sx, hipY, 0);
      const j: Joint = { node, targetX: 0, targetZ: 0 };
      limbMesh(j, legH, legT, furDark, `${nm}m`);
      const foot = part(`${nm}f`, legT * 1.15, legT * 0.5, legT * 1.6, muzzle, node);
      foot.position.set(0, -legH + legT * 0.25, legT * 0.25);
      return j;
    };
    this.legL = mkLeg("legL", -bodyW * 0.28);
    this.legR = mkLeg("legR", bodyW * 0.28);

    // --- accessory wardrobe (shared across styles) ---
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
  }

  private mat(color: Color3): StandardMaterial {
    const m = new StandardMaterial("rigMat", this.scene);
    m.diffuseColor = color;
    m.specularColor = new Color3(0.05, 0.05, 0.05);
    this.mats.push(m);
    return m;
  }

  /** Drive the pose each frame. runPhase cycles 0..1 with travel. */
  update(pose: RigPose, runPhase: number, dt: number) {
    this.clock += dt;
    const swing = Math.sin(runPhase * Math.PI * 2) * 1.0;
    let torsoPitch = 0;
    let torsoBob = 0;

    switch (pose) {
      case "run":
        this.legL.targetX = swing;
        this.legR.targetX = -swing;
        this.armL.targetX = -swing * 0.85;
        this.armR.targetX = swing * 0.85;
        this.armL.targetZ = 0.08;
        this.armR.targetZ = -0.08;
        torsoPitch = 0.14;
        torsoBob = Math.abs(Math.sin(runPhase * Math.PI * 2)) * 0.035;
        break;
      case "idle": {
        const breathe = Math.sin(this.clock * 2.2) * 0.03;
        this.legL.targetX = this.legR.targetX = 0;
        this.armL.targetX = this.armR.targetX = 0;
        this.armL.targetZ = 0.12 + breathe;
        this.armR.targetZ = -0.12 - breathe;
        break;
      }
      case "jump":
        this.legL.targetX = 0.85;
        this.legR.targetX = 0.6;
        this.armL.targetX = this.armR.targetX = -2.6; // arms up
        this.armL.targetZ = 0.35;
        this.armR.targetZ = -0.35;
        break;
      case "fall":
        this.legL.targetX = 0.35;
        this.legR.targetX = -0.2;
        this.armL.targetX = this.armR.targetX = -2.2;
        this.armL.targetZ = 0.8;
        this.armR.targetZ = -0.8;
        break;
      case "dash":
        this.legL.targetX = 0.9;
        this.legR.targetX = -0.9;
        this.armL.targetX = this.armR.targetX = 1.1; // trailing
        this.armL.targetZ = 0.25;
        this.armR.targetZ = -0.25;
        torsoPitch = 0.5;
        break;
      case "pound":
        this.legL.targetX = 0.9;
        this.legR.targetX = 0.9;
        this.armL.targetX = this.armR.targetX = 0;
        this.armL.targetZ = 1.5; // straight out
        this.armR.targetZ = -1.5;
        torsoPitch = -0.12;
        break;
      case "glide":
        this.legL.targetX = this.legR.targetX = 0.15;
        this.armL.targetX = this.armR.targetX = 0;
        this.armL.targetZ = 1.57;
        this.armR.targetZ = -1.57;
        torsoPitch = 0.35 + Math.sin(this.clock * 3) * 0.05;
        break;
    }

    const k = Math.min(1, dt * 14);
    for (const j of [this.armL, this.armR, this.legL, this.legR]) {
      j.node.rotation.x += (j.targetX - j.node.rotation.x) * k;
      j.node.rotation.z += (j.targetZ - j.node.rotation.z) * k;
    }
    this.torso.rotation.x += (torsoPitch - this.torso.rotation.x) * k;
    this.torso.position.y = this.baseTorsoY + torsoBob;
  }

  setYaw(yaw: number) {
    this.root.rotation.y = yaw;
  }

  get position(): Vector3 {
    return this.root.position;
  }

  dispose() {
    this.root.dispose(false, true); // dispose children meshes too
    for (const m of this.mats) m.dispose();
  }
}

/** All rig meshes (for shadow casters etc.). */
export function rigMeshes(rig: CharacterRig): Mesh[] {
  return rig.root.getChildMeshes(false) as Mesh[];
}
