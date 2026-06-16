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

export function buildTerrain(scene: Scene, data: TerrainData, name = "terrain"): TerrainMesh {
  const [cols, rows] = data.resolution;
  const [sizeX, sizeZ] = data.size;
  const origin = terrainOrigin(data);
  const cellX = cols > 1 ? sizeX / (cols - 1) : sizeX;
  const cellZ = rows > 1 ? sizeZ / (rows - 1) : sizeZ;

  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      positions.push(origin[0] + c * cellX, heightAt(data, c, r), origin[1] + r * cellZ);
      uvs.push(c / Math.max(1, cols - 1), r / Math.max(1, rows - 1));
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

  const mesh = new Mesh(name, scene);
  const vd = new VertexData();
  vd.positions = positions;
  vd.indices = indices;
  vd.normals = normals;
  vd.uvs = uvs;
  vd.applyToMesh(mesh, true); // updatable: sculpt brushes will rewrite positions
  mesh.receiveShadows = true;

  return { mesh, origin, cols, rows, cellX, cellZ };
}
