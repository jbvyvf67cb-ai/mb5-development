// Claude assist — the prompt-box brain for the map maker and character
// designer ("describe it, then tune it in the editor").
//
// Guardian-style architecture: the browser talks to the Claude API directly
// with a user-supplied API key (kept browser-local, like the GitHub PAT), and
// every response is forced through a JSON schema (structured outputs), then
// normalized/clamped by the same code that guards hand-authored data — the
// model can only ever produce things the engine already knows how to apply.

import Anthropic from "@anthropic-ai/sdk";
import { MOVES, normalizeCharacter, type CharacterData } from "../character/schema";
import { allPrefabs } from "../world/prefabs";
import type { ContinentData } from "../world/schema";
import type { LevelOp } from "./ops";

const KEY_STORAGE = "mb5.anthropicKey";
const MODEL = "claude-opus-4-8";

export function loadApiKey(): string {
  try {
    return localStorage.getItem(KEY_STORAGE) ?? "";
  } catch {
    return "";
  }
}

export function saveApiKey(key: string) {
  try {
    localStorage.setItem(KEY_STORAGE, key);
  } catch {
    /* ignore */
  }
}

function client(): Anthropic {
  const apiKey = loadApiKey();
  if (!apiKey) throw new Error("No API key — paste an Anthropic API key in the Assist panel first.");
  // Browser use is deliberate here: local tool, user's own key, kept in
  // localStorage exactly like the GitHub publish token.
  return new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
}

// ------------------------------------------------------------------
// Character generation
// ------------------------------------------------------------------

const VEC3 = { type: "array", items: { type: "number" }, description: "RGB, each 0..1" };

const CHARACTER_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["name", "body", "colors", "accessory", "stats", "moves"],
  properties: {
    name: { type: "string" },
    body: {
      type: "object",
      additionalProperties: false,
      required: ["height", "width", "weight", "head", "ears"],
      properties: {
        height: { type: "number", description: "0.75..1.35 (1 = average)" },
        width: { type: "number", description: "0.75..1.35" },
        weight: { type: "number", description: "0..1 chunkiness; also mass in play" },
        head: { type: "number", description: "0.8..1.3 head size" },
        ears: { type: "number", description: "0.4..1.8 ear size" },
      },
    },
    colors: {
      type: "object",
      additionalProperties: false,
      required: ["fur", "muzzle", "belly", "accent"],
      properties: { fur: VEC3, muzzle: VEC3, belly: VEC3, accent: VEC3 },
    },
    accessory: { type: "string", enum: ["none", "bowtie", "cap", "scarf"] },
    stats: {
      type: "object",
      additionalProperties: false,
      required: ["speed", "jump", "attack", "defense"],
      properties: {
        speed: { type: "integer", description: "1..10" },
        jump: { type: "integer", description: "1..10" },
        attack: { type: "integer", description: "1..10" },
        defense: { type: "integer", description: "1..10" },
      },
    },
    moves: {
      type: "array",
      items: { type: "string", enum: MOVES.map((m) => m.key) },
      description: "Equipped special moves (2-3 is typical)",
    },
  },
} as const;

export interface PromptImage {
  data: string; // base64, no data: prefix
  mediaType: "image/png" | "image/jpeg" | "image/webp" | "image/gif";
}

/**
 * Describe a character (or a change to the current one) → CharacterData.
 * With an image (a drawing, a photo, a reference character), Claude maps it
 * onto the parametric rig — proportions, palette, accessory, implied stats —
 * so the result animates exactly like every hand-made character.
 */
export async function generateCharacter(
  prompt: string,
  current: CharacterData,
  image?: PromptImage,
): Promise<CharacterData> {
  const content: Anthropic.ContentBlockParam[] = [];
  if (image) {
    content.push({
      type: "image",
      source: { type: "base64", media_type: image.mediaType, data: image.data },
    });
  }
  content.push({
    type: "text",
    text:
      `CURRENT CHARACTER:\n${JSON.stringify(current)}\n\n` +
      (image
        ? `REQUEST (based on the attached image): ${prompt || "turn this image into a character"}`
        : `REQUEST: ${prompt}`),
  });

  const response = await client().messages.create({
    model: MODEL,
    max_tokens: 4096,
    thinking: { type: "adaptive" },
    system:
      "You design characters for a cute 3D platformer. Characters are blocky 3D mascots built " +
      "from parameters: body morphs (height/width/weight/head/ears), four colors, an accessory, " +
      "stats 1-10, and equipped special moves " +
      `(${MOVES.map((m) => `${m.key}: ${m.desc}`).join(" · ")}). ` +
      "The user describes a new character or an adjustment to the CURRENT one; if it reads as an " +
      "adjustment, keep everything they didn't mention. When an image is attached, translate it " +
      "onto these parameters as faithfully as possible: dominant color → fur, secondary → muzzle/" +
      "belly, brightest accent → accessory color; tall/thin/round/big-headed/big-eared proportions " +
      "→ the matching morphs; pick the closest accessory. Stats should reflect the fantasy " +
      "(fast+fragile, heavy+strong...). Colors are RGB 0..1 and should be cohesive.",
    messages: [{ role: "user", content }],
    output_config: { format: { type: "json_schema", schema: CHARACTER_SCHEMA } },
  });

  const out = normalizeCharacter({ ...readJson(response), id: undefined });
  out.id = `c${Date.now().toString(36)}`; // always a fresh character entry
  return out;
}

// ------------------------------------------------------------------
// Level editing (patch ops)
// ------------------------------------------------------------------

const OPS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "ops"],
  properties: {
    summary: { type: "string", description: "One short sentence describing what you did." },
    ops: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["op"],
        properties: {
          op: {
            type: "string",
            enum: ["addPrefab", "addEntity", "remove", "setEnv", "setPalette", "setMeta", "sculpt"],
          },
          prefab: { type: "string", description: "addPrefab: prefab key" },
          entityType: {
            type: "string",
            enum: ["playerSpawn", "coin", "checkpoint", "enemy"],
            description: "addEntity: marker type",
          },
          pos: {
            type: "array",
            items: { type: ["number", "null"] },
            description: "[x, y, z]; y=null snaps to the ground surface",
          },
          rot: { type: "array", items: { type: "number" }, description: "Euler radians XYZ" },
          scale: { type: "array", items: { type: "number" }, description: "[sx, sy, sz] meters" },
          tint: VEC3,
          skin: {
            type: "string",
            enum: ["default", "brick", "planks", "stone", "checker", "metal", "grass", "candy"],
            description: "addPrefab: material style",
          },
          props: {
            type: "object",
            additionalProperties: false,
            properties: {
              axis: { type: "string", enum: ["x", "y", "z"], description: "movingPlatform travel axis" },
              dist: { type: "number", description: "movingPlatform travel distance (m)" },
              speed: { type: "number", description: "movingPlatform speed (m/s)" },
              power: { type: "number", description: "spring launch / boost speed" },
            },
            description: "addPrefab: gameplay tuning (movingPlatform/spring/boost)",
          },
          id: { type: "string", description: "remove: prefab/entity instance id" },
          env: {
            type: "object",
            additionalProperties: false,
            properties: {
              sky: VEC3, horizon: VEC3, fogColor: VEC3, waterColor: VEC3, sunColor: VEC3,
              fogDensity: { type: "number", description: "0..0.02" },
              sunIntensity: { type: "number", description: "0..3" },
              sunAzimuth: { type: "number", description: "degrees 0..360" },
              sunElevation: { type: "number", description: "degrees 5..90" },
              ambient: { type: "number", description: "0..1.5" },
              waterOpacity: { type: "number", description: "0.05..1" },
            },
            description: "setEnv: only the fields to change",
          },
          palette: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["h", "color"],
              properties: { h: { type: "number" }, color: VEC3 },
            },
            description: "setPalette: full elevation ramp, ascending h (2-8 stops)",
          },
          meta: {
            type: "object",
            additionalProperties: false,
            properties: {
              name: { type: "string" },
              gravityY: { type: "number" },
              killPlaneY: { type: "number" },
              seaLevel: { type: ["number", "null"], description: "null removes the ocean" },
            },
            description: "setMeta: only the fields to change",
          },
          sculpt: {
            type: "object",
            additionalProperties: false,
            required: ["x", "z", "radius", "mode"],
            properties: {
              x: { type: "number" },
              z: { type: "number" },
              radius: { type: "number", description: "meters" },
              mode: { type: "string", enum: ["raise", "lower", "flatten"] },
              amount: { type: "number", description: "raise/lower: height delta in meters; flatten: target height" },
            },
            description: "sculpt: smooth circular terrain edit",
          },
        },
      },
    },
  },
} as const;

export interface OpsResult {
  summary: string;
  ops: LevelOp[];
}

/** Summarize the level compactly so prompts stay small even for big maps. */
function levelSummary(data: ContinentData): string {
  const t = data.terrain;
  const prefabList = data.prefabs
    .slice(0, 80)
    .map((p) => `${p.id}:${p.prefab}@[${p.pos.map((n) => Math.round(n)).join(",")}]`)
    .join(" ");
  const entityList = data.entities
    .slice(0, 60)
    .map((e) => `${e.id}:${e.type}@[${e.pos.map((n) => Math.round(n)).join(",")}]`)
    .join(" ");
  return [
    `name="${data.meta.name}" bounds=${JSON.stringify(data.meta.bounds)}`,
    `seaLevel=${data.meta.seaLevel ?? "none"} killPlaneY=${data.meta.killPlaneY}`,
    `env=${JSON.stringify(data.meta.env ?? {})}`,
    t ? `terrain ${t.resolution[0]}x${t.resolution[1]} over ${t.size[0]}x${t.size[1]}m, palette=${JSON.stringify(t.palette ?? "default")}` : "no terrain",
    `prefabs (${data.prefabs.length}): ${prefabList}${data.prefabs.length > 80 ? " …" : ""}`,
    `entities (${data.entities.length}): ${entityList}${data.entities.length > 60 ? " …" : ""}`,
  ].join("\n");
}

/** Describe a level change → a list of patch ops the editor applies. */
export async function generateLevelOps(prompt: string, data: ContinentData): Promise<OpsResult> {
  const prefabDocs = allPrefabs()
    .map((p) => `${p.key} (${p.category}, defaultScale ${p.defaultScale.join("x")})`)
    .join(", ");
  const response = await client().messages.create({
    model: MODEL,
    max_tokens: 8192,
    thinking: { type: "adaptive" },
    system:
      "You edit levels for a 3D platformer (Mario Odyssey / Sonic energy) by emitting patch " +
      "operations. Coordinate frame: Y up, meters; the terrain is a heightmap over XZ. " +
      `Available prefabs: ${prefabDocs}. Entities: playerSpawn, coin, checkpoint, enemy. ` +
      "Gameplay prefabs: spring (launches up; props.power), boost (speeds along its facing — " +
      "aim with rot[1]; props.power), spikes (hazard, respawns), movingPlatform (props: axis " +
      "x|y|z, dist m, speed m/s), goal (level finish). Skins restyle a prefab's material " +
      "(brick/planks/stone/checker/metal/grass/candy). " +
      "Rules: for anything that should sit ON the ground, use pos y=null (the editor snaps it " +
      "to the surface). Scale is in meters (a tree is ~4x7x4). Place content INSIDE the level " +
      "bounds. Prefer several concrete ops over vague ones; compose structures from multiple " +
      "prefabs (a village = blocks with planks/brick skins + gates + fences; a platforming " +
      "course = platforms + springs + moving platforms + coins + a goal). For style/mood use " +
      "setEnv/setPalette; use sculpt for terrain shapes (hills, pits, flat build sites). " +
      "When the request is ambiguous, do the most useful literal interpretation.",
    messages: [
      {
        role: "user",
        content: `CURRENT LEVEL:\n${levelSummary(data)}\n\nREQUEST: ${prompt}`,
      },
    ],
    output_config: { format: { type: "json_schema", schema: OPS_SCHEMA } },
  });
  const parsed = readJson(response) as unknown as OpsResult;
  return { summary: parsed.summary ?? "done", ops: Array.isArray(parsed.ops) ? parsed.ops : [] };
}

// ------------------------------------------------------------------

function readJson(response: Anthropic.Message): Record<string, unknown> {
  if (response.stop_reason === "refusal") {
    throw new Error("Claude declined that request.");
  }
  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
  if (!text) throw new Error(`Empty response (stop_reason: ${response.stop_reason}).`);
  return JSON.parse(text) as Record<string, unknown>;
}
