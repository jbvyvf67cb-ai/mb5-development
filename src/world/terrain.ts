// Heightmap terrain → mesh.
//
// Builds a Babylon mesh from a row-major height grid (TerrainData). The same
// height array the editor's sculpt brushes mutate is what bakes here, so editor
// preview and game runtime see identical ground. Physics (a static MESH
// aggregate) is attached by the loader.

import { Mesh, VertexData } from "@babylonjs/core";
import type { Scene } from "@babylonjs/core";
import { DEFAULT_PALETTE, type PaletteStop, type TerrainData } from "./schema";

export interface TerrainMesh {
  mesh: Mesh;
  /** World XZ of the grid's min corner. */
  origin: [number, number];
  cols: number;
  rows: number;
  cellX: number;
  cellZ: number;
}

export function terrainOrigin(data: TerrainData): [number, number] {
  return data.origin ?? [-data.size[0] / 2, -data.size[1] / 2];
}

/** Sample the terrain height at grid cell (c, r). */
export function heightAt(data: TerrainData, c: number, r: number): number {
  const [cols] = data.resolution;
  return data.heights[r * cols + c] ?? 0;
}

export interface TerrainGeometry {
  positions: number[];
  indices: number[];
  normals: number[];
  uvs: number[];
  colors: number[];
}

/** Elevation → RGB via a stop ramp (smoothly blended between stops). */
export function elevationColor(h: number, stops: PaletteStop[] = DEFAULT_PALETTE): [number, number, number] {
  if (!stops.length) return [1, 1, 1];
  if (h <= stops[0].h) return [...stops[0].color];
  for (let i = 1; i < stops.length; i++) {
    if (h <= stops[i].h) {
      const { h: h0, color: c0 } = stops[i - 1];
      const { h: h1, color: c1 } = stops[i];
      const t = h1 > h0 ? (h - h0) / (h1 - h0) : 1;
      return [c0[0] + (c1[0] - c0[0]) * t, c0[1] + (c1[1] - c0[1]) * t, c0[2] + (c1[2] - c0[2]) * t];
    }
  }
  return [...stops[stops.length - 1].color];
}

/** Compute terrain vertex data from the height grid (shared by build + sculpt refresh). */
export function terrainGeometry(data: TerrainData): TerrainGeometry {
  const [cols, rows] = data.resolution;
  const [sizeX, sizeZ] = data.size;
  const origin = terrainOrigin(data);
  const cellX = cols > 1 ? sizeX / (cols - 1) : sizeX;
  const cellZ = rows > 1 ? sizeZ / (rows - 1) : sizeZ;

  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const colors: number[] = [];

  const palette = data.palette ?? DEFAULT_PALETTE;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const h = heightAt(data, c, r);
      positions.push(origin[0] + c * cellX, h, origin[1] + r * cellZ);
      uvs.push(c / Math.max(1, cols - 1), r / Math.max(1, rows - 1));
      const col = elevationColor(h, palette);
      colors.push(col[0], col[1], col[2], 1);
    }
  }
  for (let r = 0; r < rows - 1; r++) {
    for (let c = 0; c < cols - 1; c++) {
      const i0 = r * cols + c;
      const i1 = i0 + 1;
      const i2 = i0 + cols;
      const i3 = i2 + 1;
      // Winding chosen so ComputeNormals yields +Y (upward) normals.
      indices.push(i0, i1, i2, i1, i3, i2);
    }
  }

  const normals: number[] = [];
  VertexData.ComputeNormals(positions, indices, normals);
  return { positions, indices, normals, uvs, colors };
}

export function buildTerrain(scene: Scene, data: TerrainData, name = "terrain"): TerrainMesh {
  const [cols, rows] = data.resolution;
  const [sizeX, sizeZ] = data.size;
  const origin = terrainOrigin(data);
  const cellX = cols > 1 ? sizeX / (cols - 1) : sizeX;
  const cellZ = rows > 1 ? sizeZ / (rows - 1) : sizeZ;

  const g = terrainGeometry(data);
  const mesh = new Mesh(name, scene);
  const vd = new VertexData();
  vd.positions = g.positions;
  vd.indices = g.indices;
  vd.normals = g.normals;
  vd.uvs = g.uvs;
  vd.colors = g.colors;
  vd.applyToMesh(mesh, true); // updatable: sculpt brushes rewrite positions
  mesh.useVertexColors = true;
  mesh.receiveShadows = true;

  return { mesh, origin, cols, rows, cellX, cellZ };
}
