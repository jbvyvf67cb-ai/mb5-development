// Buf — a CPU-side geometry accumulator that emits one Babylon mesh.
//
// Lifted (clean-room, from notes) from Joshua's `quarter.ts`: five parallel
// arrays accumulate a triangle soup, then `toMesh` produces a single VertexData /
// Mesh. The intended scale pattern is one Buf per (chunk, material) so a whole
// region merges into one draw call per material — that batching lands in the
// chunk module (milestone 2). Here it is also handy for building one-off prefab
// geometry (ramps, stairs).

import { Mesh, VertexData } from "@babylonjs/core";
import type { Scene } from "@babylonjs/core";
import { Vector3 } from "@babylonjs/core";

export class Buf {
  pos: number[] = []; // positions, 3 floats / vertex
  idx: number[] = []; // triangle indices
  nrm: number[] = []; // normals, 3 / vertex
  uv: number[] = []; //  uvs, 2 / vertex
  col: number[] = []; // vertex colors RGBA, 4 / vertex

  get empty(): boolean {
    return this.pos.length === 0;
  }

  private push(p: Vector3, n: Vector3, u: number, v: number, tint: number[]) {
    this.pos.push(p.x, p.y, p.z);
    this.nrm.push(n.x, n.y, n.z);
    this.uv.push(u, v);
    this.col.push(tint[0], tint[1], tint[2], tint[3] ?? 1);
  }

  /** Append a quad a→b→c→d (CCW) sharing one normal + tint. uvs = [u0,v0,u1,v1]. */
  quad(
    a: Vector3,
    b: Vector3,
    c: Vector3,
    d: Vector3,
    n: Vector3,
    uvs: [number, number, number, number] = [0, 0, 1, 1],
    tint: number[] = [1, 1, 1, 1],
  ) {
    const base = this.pos.length / 3;
    this.push(a, n, uvs[0], uvs[1], tint);
    this.push(b, n, uvs[2], uvs[1], tint);
    this.push(c, n, uvs[2], uvs[3], tint);
    this.push(d, n, uvs[0], uvs[3], tint);
    this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  /** Append one flat-shaded triangle. */
  tri(
    a: Vector3,
    b: Vector3,
    c: Vector3,
    n: Vector3,
    tint: number[] = [1, 1, 1, 1],
  ) {
    const base = this.pos.length / 3;
    this.push(a, n, 0, 0, tint);
    this.push(b, n, 1, 0, tint);
    this.push(c, n, 0.5, 1, tint);
    this.idx.push(base, base + 1, base + 2);
  }

  /** Append an axis-aligned (optionally Y-rotated) box centered at `center`. */
  box(
    center: Vector3,
    size: Vector3,
    rotY = 0,
    tint: number[] = [1, 1, 1, 1],
  ) {
    const hx = size.x / 2;
    const hy = size.y / 2;
    const hz = size.z / 2;
    const cs = Math.cos(rotY);
    const sn = Math.sin(rotY);
    // local corner → world (rotate around Y, translate)
    const v = (x: number, y: number, z: number) =>
      new Vector3(center.x + x * cs + z * sn, center.y + y, center.z - x * sn + z * cs);
    const nrm = (x: number, y: number, z: number) =>
      new Vector3(x * cs + z * sn, y, -x * sn + z * cs);

    const p = {
      a: v(-hx, -hy, -hz),
      b: v(hx, -hy, -hz),
      c: v(hx, -hy, hz),
      d: v(-hx, -hy, hz),
      e: v(-hx, hy, -hz),
      f: v(hx, hy, -hz),
      g: v(hx, hy, hz),
      h: v(-hx, hy, hz),
    };
    this.quad(p.a, p.d, p.c, p.b, nrm(0, -1, 0), [0, 0, 1, 1], tint); // bottom
    this.quad(p.e, p.f, p.g, p.h, nrm(0, 1, 0), [0, 0, 1, 1], tint); //  top
    this.quad(p.a, p.b, p.f, p.e, nrm(0, 0, -1), [0, 0, 1, 1], tint); // -Z
    this.quad(p.c, p.d, p.h, p.g, nrm(0, 0, 1), [0, 0, 1, 1], tint); //  +Z
    this.quad(p.b, p.c, p.g, p.f, nrm(1, 0, 0), [0, 0, 1, 1], tint); //  +X
    this.quad(p.d, p.a, p.e, p.h, nrm(-1, 0, 0), [0, 0, 1, 1], tint); // -X
  }

  /** Merge another Buf's geometry into this one. */
  merge(other: Buf) {
    const base = this.pos.length / 3;
    this.pos.push(...other.pos);
    this.nrm.push(...other.nrm);
    this.uv.push(...other.uv);
    this.col.push(...other.col);
    for (const i of other.idx) this.idx.push(base + i);
  }

  /** Realize into a Mesh, or null if empty. */
  toMesh(name: string, scene: Scene, withColors = true): Mesh | null {
    if (this.empty) return null;
    const mesh = new Mesh(name, scene);
    const vd = new VertexData();
    vd.positions = this.pos;
    vd.indices = this.idx;
    vd.normals = this.nrm;
    vd.uvs = this.uv;
    if (withColors) vd.colors = this.col;
    vd.applyToMesh(mesh);
    mesh.receiveShadows = true;
    return mesh;
  }
}
