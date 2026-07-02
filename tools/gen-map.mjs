// gen-map.mjs — the full hand-drawn world as ContinentData.
// Geography lives in maplib.mjs; run: `node tools/gen-map.mjs`.

import { writeFileSync, mkdirSync } from "node:fs";
import { WX, WZ, map, peakC, peak, rasterize } from "./maplib.mjs";

const RES = 150;
const { heights, maxH } = rasterize({
  x0: -WX / 2,
  z0: -WZ / 2,
  sizeX: WX,
  sizeZ: WZ,
  cols: RES,
  rows: RES,
});

const HX = WX / 2, HZ = WZ / 2;
const at = (u, v) => {
  const [x, z] = map(u, v);
  return [Math.round(x), 16, Math.round(z)];
};

const data = {
  meta: {
    id: "world",
    name: "Hand-drawn World",
    version: 1,
    bounds: { min: [-HX - 5, -8, -HZ - 5], max: [HX + 5, Math.ceil(maxH) + 10, HZ + 5] },
    gravity: [0, -16, 0],
    killPlaneY: -25,
    seaLevel: 0,
    env: {
      sky: [0.36, 0.6, 0.83],
      horizon: [0.5, 0.45, 0.38],
      fogColor: [0.7, 0.8, 0.9],
      fogDensity: 0.0009,
      waterColor: [0.1, 0.36, 0.55],
      waterOpacity: 0.66,
    },
  },
  terrain: { size: [WX, WZ], resolution: [RES, RES], heights },
  prefabs: [],
  entities: [
    { id: "spawn", type: "playerSpawn", pos: at(0.5, 0.7) },
    { id: "cp_peak", type: "checkpoint", pos: [peakC[0], peak.H + 2, peakC[1]] },
    { id: "c_nw", type: "coin", pos: at(0.16, 0.31) },
    { id: "c_mid", type: "coin", pos: at(0.42, 0.3) },
    { id: "c_ne", type: "coin", pos: at(0.88, 0.305) },
    { id: "c_south", type: "coin", pos: at(0.6, 0.85) },
  ],
};

mkdirSync("assets/continents", { recursive: true });
writeFileSync("assets/continents/world.json", JSON.stringify(data));
console.log(`wrote assets/continents/world.json — ${RES}x${RES}, maxHeight=${maxH.toFixed(1)}m`);
