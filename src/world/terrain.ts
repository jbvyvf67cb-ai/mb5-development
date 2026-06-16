// Heightmap terrain → mesh.
//
// Builds a Babylon mesh from a row-major height grid (TerrainData). The same
// height array the editor's sculpt brushes mutate is what bakes here, so editor
// preview and game runtime see identical ground. Physics (a static MESH
// aggregate) is attached by the loader.

import { Mesh, VertexData } from "@babylonjs/core";
import type { Scene } from "@babylonjs/core";
import type { TerrainData } from "./schema";

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

/** Elevation → RGB ramp: sand → grass → rock → snow (smoothly blended). */
export function elevationColor(h: number): [number, number, number] {
  const stops: Array<[number, [number, number, number]]> = [
    [0.4, [0.78, 0.72, 0.5]], // sand
    [3, [0.42, 0.6, 0.32]], // coastal grass
    [12, [0.24, 0.46, 0.24]], // green
    [22, [0.45, 0.4, 0.34]], // rock
    [30, [0.93, 0.93, 0.96]], // snow
  ];
  if (h <= stops[0][0]) return stops[0][1];
  for (let i = 1; i < stops.length; i++) {
    if (h <= stops[i][0]) {
      const [h0, c0] = stops[i - 1];
      const [h1, c1] = stops[i];
      const t = (h - h0) / (h1 - h0);
      return [c0[0] + (c1[0] - c0[0]) * t, c0[1] + (c1[1] - c0[1]) * t, c0[2] + (c1[2] - c0[2]) * t];
    }
  }
  return stops[stops.length - 1][1];
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

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const h = heightAt(data, c, r);
      positions.push(origin[0] + c * cellX, h, origin[1] + r * cellZ);
      uvs.push(c / Math.max(1, cols - 1), r / Math.max(1, rows - 1));
      const col = elevationColor(h);
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
