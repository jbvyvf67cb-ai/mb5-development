// Level patch ops — the constrained edit language Claude emits and the editor
// applies. Everything goes through the same World mutation paths (and undo
// history) as hand edits, so an AI change is just a batch of normal edits.

import type { Editor } from "../editor/editor";
import { addEntityCmd, addPrefabCmd, removeEntityCmd, removePrefabCmd, sculptCmd } from "../editor/commands";
import { getPrefab } from "../world/prefabs";
import { terrainOrigin } from "../world/terrain";
import type { EnvSettings, PaletteStop, Vec3 } from "../world/schema";
import type { World } from "../world/world";

export interface LevelOp {
  op: "addPrefab" | "addEntity" | "remove" | "setEnv" | "setPalette" | "setMeta" | "sculpt";
  prefab?: string;
  entityType?: string;
  pos?: Array<number | null>;
  rot?: number[];
  scale?: number[];
  tint?: number[];
  skin?: string;
  props?: Record<string, unknown>;
  id?: string;
  env?: Partial<EnvSettings>;
  palette?: PaletteStop[];
  meta?: { name?: string; gravityY?: number; killPlaneY?: number; seaLevel?: number | null };
  sculpt?: { x: number; z: number; radius: number; mode: "raise" | "lower" | "flatten"; amount?: number };
}

export interface OpsContext {
  world: World;
  editor: Editor;
  setMeta(patch: { name?: string; gravityY?: number; killPlaneY?: number }): void;
  setSeaLevel(v: number | undefined): void;
  setEnv(patch: Partial<EnvSettings>): void;
  setPalette(stops: PaletteStop[] | undefined): void;
}

/** Bilinear terrain height at world (x,z); 0 without terrain. */
export function groundHeight(world: World, x: number, z: number): number {
  const t = world.data.terrain;
  if (!t) return 0;
  const [cols, rows] = t.resolution;
  const [ox, oz] = terrainOrigin(t);
  const cellX = cols > 1 ? t.size[0] / (cols - 1) : t.size[0];
  const cellZ = rows > 1 ? t.size[1] / (rows - 1) : t.size[1];
  const u = Math.min(Math.max((x - ox) / cellX, 0), cols - 1);
  const v = Math.min(Math.max((z - oz) / cellZ, 0), rows - 1);
  const c0 = Math.floor(u);
  const r0 = Math.floor(v);
  const c1 = Math.min(cols - 1, c0 + 1);
  const r1 = Math.min(rows - 1, r0 + 1);
  const fu = u - c0;
  const fv = v - r0;
  const h = t.heights;
  return (
    (h[r0 * cols + c0] ?? 0) * (1 - fu) * (1 - fv) +
    (h[r0 * cols + c1] ?? 0) * fu * (1 - fv) +
    (h[r1 * cols + c0] ?? 0) * (1 - fu) * fv +
    (h[r1 * cols + c1] ?? 0) * fu * fv
  );
}

const num = (v: unknown, d: number) => (typeof v === "number" && isFinite(v) ? v : d);
const vec3 = (v: unknown, d: Vec3): Vec3 =>
  Array.isArray(v) ? [num(v[0], d[0]), num(v[1], d[1]), num(v[2], d[2])] : [...d];

/** Apply a batch of ops; returns human-readable log lines for the panel. */
export function applyLevelOps(ops: LevelOp[], ctx: OpsContext): string[] {
  const log: string[] = [];
  const { world, editor } = ctx;

  for (const op of ops) {
    try {
      switch (op.op) {
        case "addPrefab": {
          const def = getPrefab(op.prefab ?? "");
          if (!def) {
            log.push(`✗ unknown prefab "${op.prefab}"`);
            break;
          }
          const scale = vec3(op.scale, def.defaultScale as Vec3);
          const x = num(op.pos?.[0], 0);
          const z = num(op.pos?.[2], 0);
          const y =
            op.pos?.[1] === null || op.pos?.[1] === undefined
              ? groundHeight(world, x, z) + scale[1] / 2
              : num(op.pos[1], 0);
          const inst = world.addPrefab(def.key, [x, y, z], {
            rot: vec3(op.rot, [0, 0, 0]),
            scale,
            ...(op.tint ? { tint: vec3(op.tint, [1, 1, 1]) } : {}),
            ...(typeof op.skin === "string" ? { skin: op.skin } : {}),
          });
          if (op.props && typeof op.props === "object") world.setPrefabProps(inst.id, op.props);
          editor.history.push(addPrefabCmd(world, inst));
          log.push(`+ ${def.key} at [${Math.round(x)}, ${Math.round(y)}, ${Math.round(z)}]`);
          break;
        }
        case "addEntity": {
          const type = op.entityType ?? "coin";
          const x = num(op.pos?.[0], 0);
          const z = num(op.pos?.[2], 0);
          const y =
            op.pos?.[1] === null || op.pos?.[1] === undefined
              ? groundHeight(world, x, z) + 1
              : num(op.pos[1], 0);
          const ent = world.addEntity(type, [x, y, z]);
          editor.history.push(addEntityCmd(world, ent));
          log.push(`+ ${type} at [${Math.round(x)}, ${Math.round(y)}, ${Math.round(z)}]`);
          break;
        }
        case "remove": {
          if (!op.id) break;
          const inst = world.getPrefabInstance(op.id);
          if (inst) {
            world.removePrefab(inst.id);
            editor.history.push(removePrefabCmd(world, inst));
            log.push(`− prefab ${op.id}`);
            break;
          }
          const ent = world.getEntityInstance(op.id);
          if (ent) {
            world.removeEntity(ent.id);
            editor.history.push(removeEntityCmd(world, ent));
            log.push(`− entity ${op.id}`);
          } else log.push(`✗ no such id "${op.id}"`);
          break;
        }
        case "setEnv": {
          if (op.env) {
            ctx.setEnv(op.env);
            log.push(`~ environment (${Object.keys(op.env).join(", ")})`);
          }
          break;
        }
        case "setPalette": {
          if (Array.isArray(op.palette) && op.palette.length >= 2) {
            const stops = op.palette
              .map((s) => ({ h: num(s.h, 0), color: vec3(s.color, [1, 1, 1]) }))
              .sort((a, b) => a.h - b.h);
            ctx.setPalette(stops);
            log.push(`~ terrain palette (${stops.length} stops)`);
          }
          break;
        }
        case "setMeta": {
          const m = op.meta ?? {};
          const { seaLevel, ...rest } = m;
          if (Object.keys(rest).length) ctx.setMeta(rest);
          if (seaLevel !== undefined) ctx.setSeaLevel(seaLevel === null ? undefined : seaLevel);
          log.push(`~ level settings (${Object.keys(m).join(", ")})`);
          break;
        }
        case "sculpt": {
          const s = op.sculpt;
          const td = world.data.terrain;
          if (!s || !td) break;
          const before = td.heights.slice();
          const [cols, rows] = td.resolution;
          const [ox, oz] = terrainOrigin(td);
          const cellX = cols > 1 ? td.size[0] / (cols - 1) : td.size[0];
          const cellZ = rows > 1 ? td.size[1] / (rows - 1) : td.size[1];
          const R = Math.max(1, s.radius);
          const target = s.mode === "flatten" ? (s.amount ?? groundHeight(world, s.x, s.z)) : 0;
          const delta = s.amount ?? 3;
          for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
              const wx = ox + c * cellX;
              const wz = oz + r * cellZ;
              const d = Math.hypot(wx - s.x, wz - s.z);
              if (d > R) continue;
              let f = 1 - d / R;
              f = f * f * (3 - 2 * f);
              const i = r * cols + c;
              if (s.mode === "raise") td.heights[i] += delta * f;
              else if (s.mode === "lower") td.heights[i] -= delta * f;
              else td.heights[i] += (target - td.heights[i]) * f;
            }
          }
          world.refreshTerrainGeometry();
          world.rebuildTerrainPhysics();
          editor.history.push(sculptCmd(world, before, td.heights.slice()));
          log.push(`~ terrain ${s.mode} at [${Math.round(s.x)}, ${Math.round(s.z)}] r=${Math.round(R)}`);
          break;
        }
      }
    } catch (err) {
      log.push(`✗ ${op.op} failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return log;
}
