# MB5 (working title) — Design & Engineering Notes

> A 3D globe open-world platformer aiming at Super Mario Odyssey–tier complexity.
> This document is the living design contract. It records the vision, the
> architecture, what we are porting from the **Joshua** game, and the gotchas to
> respect. Update it as decisions are made.

---

## 1. Vision & pillars

- **Full 3D globe.** The world is a sphere (or a set of explorable bodies), not
  a flat plane. Players traverse a planet.
- **Continents as levels.** Each continent is a self-contained open-world level
  / "kingdom" with its own theme, challenges, and collectibles — discrete,
  hand-authored playgrounds stitched onto the globe.
- **Single-player + co-op multiplayer.** Designed for drop-in co-op from the
  start; the architecture must not assume a single local player.
- **Real physics.** Havok-backed. Movement, platforms, hazards, and puzzles are
  physics-driven, not faked.
- **Complex, varied challenges.** Platforming, traversal puzzles, combat,
  vehicles/rideables, environmental mechanics — Odyssey-level breadth.

### First task: a **3D map maker** (level/world editor)
An in-engine authoring tool to build the continents/levels: place geometry,
props, collectibles, spawns, hazards, and physics objects; save/load to a data
format; and round-trip with the runtime world loader.

**Locked scope (2026-06-16):**
- **Geometry model: true-3D** — prefab placement (platforms, ramps, stairs,
  pillars, props; each mesh + collider) **plus a sculptable heightmap terrain**
  for organic ground. (Joshua's 2.5D extruded footprints are insufficient.)
- **Globe model: deferred** — author flat continents with normal down-gravity
  first; revisit globe traversal (kingdoms-on-a-globe vs walkable planet) after
  the editor and some real levels exist.

**Architecture — editor and game share one world layer:**
- `ContinentData` (level format, JSON): `meta` (id, name, bounds, gravity),
  optional heightmap `terrain`, `prefabs: PrefabInstance[]`,
  `entities: EntityInstance[]`. Hand-editable; round-trips through the editor.
- **World runtime** (shared by editor preview + game): a loader that
  instantiates `ContinentData` with Havok colliders, plus the generic
  `Buf`+chunk-merge+distance-cull module (lifted from Joshua) for scale.
- **Editor layer**: free-fly cam, raycast pick + transform gizmos, prefab
  palette, heightmap sculpt brushes, entity placement, undo/redo, save/load.

**Milestones:**
1. ✅ World runtime foundation — schema + prefab library + heightmap terrain +
   physics loader + demo continent.
2. ⏳ Generic `Buf`/chunk/cull batching for continent scale. *(Buf done; chunk
   registry + distance culling still to wire — currently one mesh+collider per
   prefab, fine until levels get large.)*
3. ✅ Editor shell — orbit cam, raycast pick/select, transform gizmos
   (move/rotate/scale), prefab palette, place/delete.
4. ✅ Heightmap sculpt brushes (raise/lower/smooth/flatten, radius/strength).
5. ✅ Entity placement + save/load JSON (download/upload) + `?level=` URL load
   + `App.loadContinent()`.

**Also shipped (editor):** undo/redo (command history), grid snap, editable
transform/tint/collider inspector, duplicate, focus, keyboard shortcuts
(1-4 tools, Q/W/E gizmo, Ctrl+Z/Y, Ctrl+D, F, Del), grouped prefab palette
(platform/block/wall/ramp/stairs/pillar/cone/ball), Level properties (name,
gravity, kill-plane, New Flat Terrain), New Level / Load Demo, **autosave to
localStorage** + restore on reload, and per-frame distance culling
(`World.updateCulling`).

**Also shipped (play):** Tab to play — capsule controller (velocity-write
movement, coyote/buffer jump, **double-jump**, ray ground check), **chase
camera**, **collectible coins**, **checkpoints** (set respawn), kill-plane
respawn, and a **DOM HUD**. Body-aware teleport.

`docs/MAP-FORMAT.md` documents the format + hand-drawn → JSON conversion flow;
`README.md` has run instructions + controls.

**Next candidates:** chunk-merge batching for very large continents (current
culling is per-instance); free-fly editor camera; multi-select; moving/rotating
platform prefabs + glTF prefab support; wiring enemies/hazards to gameplay; the
Claude-assisted hand-drawn-map → `ContinentData` importer; tree-shaking the
Babylon barrel import.

---

## 2. Architecture

Borrowed wholesale from Joshua because it is proven and cheap:

- **Event bus (`GameState`)** — `src/game/state.ts`. Systems never call each
  other; they `emit`/`on` over a typed `GameEventMap`. UI subscribes, gameplay
  emits. Canonical numbers (health, coins, phase machine) live here.
- **Imperative wiring in `main.ts`** — the single best map of the codebase, read
  top to bottom.
- **`window.__*` debug surface** — `src/core/debug.ts`. Scriptable handles
  (`__scene`, `__state`, `__engine`, `__telemetry()`, `__tp()`) so the 3D game
  can be driven and inspected headlessly. **Grow this from day one** — it is what
  makes automated/screenshot verification of a 3D game possible. (Software-GL in
  CI runs at a few fps, so future rubrics check *behavior and budgets*, not fps.)

### Decoupling patterns to adopt as systems land
- **`Hittable` interface** (`{position, alive, hit()}`) so combat never knows
  enemy types.
- **Generic mesh-batching module** — extract Joshua's `Buf` + 150 m chunk-merge
  + distance-cull trio into an engine-generic module; any large world (a
  continent) needs it.
- **Thin instances** for scatter collectibles (one mesh, thousands of matrices).

---

## 3. Tech stack

| Layer | Choice | Notes |
|---|---|---|
| Engine | **Babylon.js 8** | Matches Joshua. |
| Physics | **Havok (WASM)** | Async init → top-level await at boot. |
| Language | **TypeScript (strict)** | `verbatimModuleSyntax`, `noUnused*` on. |
| Bundler | **Vite 6** | `base:"./"`, `publicDir:"assets"`. |
| Asset pipelines | **Python** (offline, committed outputs) | Blender `bpy`, PIL, etc. |

Current state: a **verified-building skeleton** — Babylon scene + Havok physics
(lit ground, a ball that falls and settles), the event bus, and the debug
surface. No gameplay yet.

---

## 4. Joshua reuse roadmap (source: `jbvyvf67cb-ai/wutang-arcade`)

Source studied directly at commit `40a5394` (all 39 priority files read);
distilled, source-accurate notes are in **`docs/JOSHUA-NOTES.md`**. The original
import guide is at `docs/JOSHUA-IMPORT-GUIDE.md`. Ranked by value:

| # | System | Joshua path(s) | Status here |
|---|---|---|---|
| 1 | **Event bus** | `src/game/state.ts` | ✅ adopted |
| 2 | **`window.__*` debug surface** | `src/ui/debug.ts` | ✅ seeded |
| 3 | Stack + Vite/TS config quirks | `package.json`, `vite.config.ts` | ✅ matched |
| 4 | World mesh batching (`Buf` + chunk + cull) | `src/level/quarter.ts` | ⏳ to extract as generic module |
| 5 | OSM → world pipeline | `tools/map/*`, `quarter.ts` | ⏳ relevant if we want real geography; our map maker is the hand-authored alternative |
| 6 | Character pipeline (scripted Blender → glTF) | `tools/character/bearlib.py` + scripts | ⏳ `bearlib.py` is the reusable kit |
| 7 | Player feel set | `controller.ts`, `bear.ts`, `camera.ts`, `input.ts`, `touch.ts` | ⏳ take as a set, comments included |
| 8 | Gameplay modules | `combat.ts`, `enemies.ts`, `collectibles.ts`, `timeofday.ts`, `streetcar.ts` | ⏳ drop-ins via `Hittable` |
| 9 | Audio | `audio.ts`, `tools/audio/*` | ⏳ later |
| 10 | QA rubric + screenshot harness | `qa/playwright/*`, `qa/shot.mjs` | ⏳ stand up early |

> **Source access (resolved 2026-06-16):** `wutang-arcade` was briefly made
> public; all 39 priority files were read at commit `40a5394` and distilled into
> `docs/JOSHUA-NOTES.md`. Direct ports of #4–#10 can now proceed from accurate
> source knowledge.

---

## 5. Gotchas to respect (carried from Joshua)

- **Don't barrel-ify Babylon imports** for production — deep side-effecting
  imports keep tree-shaking working. *(Debt: the skeleton currently uses the
  barrel for speed; migrate before the bundle grows — `src/core/setup.ts`.)*
- **Havok** needs top-level await + `optimizeDeps.exclude: ["@babylonjs/havok"]`.
- **iOS Safari** hard-won fixes (apply when porting player/input/audio):
  no animation blending; don't write `speedRatio` every frame (quantize it —
  the "limp glide" stuck-pose bug); fall-pose hysteresis; `touch-action:none`;
  never trust pointer capture; clamp the virtual stick to its radius; resume the
  `AudioContext` on every interaction and on `visibilitychange`.
- **`base:"./"`** + relative asset URLs, or subpath deploys (GitHub Pages) break.
- **No runtime triangulation** in the OSM pipeline — re-bake offline and commit
  the JSON when world shape changes.
- **OSM ODbL attribution** — if we reuse Joshua's world/pipeline or any OSM data,
  keep "Map data © OpenStreetMap contributors".

---

## 6. Open questions
- Map maker scope/format for v1 (data schema, in-engine vs. separate tool, what
  primitives, save target).
- Globe model: true sphere with curved-gravity traversal, or continents as
  flat-ish chunks placed on a globe shown only at the world-select level?
- Co-op networking model (authoritative host vs. lockstep; later milestone).
- Real geography (OSM) vs. fully hand-authored continents — or a hybrid.
