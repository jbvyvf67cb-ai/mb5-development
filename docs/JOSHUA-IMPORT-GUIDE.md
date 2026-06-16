# Importing JOSHUA's world-building & mechanics — guide for a Claude Code session

**You are a Claude Code session working in a NEW, different repository.** This
document points you at a separate, already-built game — **JOSHUA: A French
Quarter Bear Tale** — whose world-building pipeline and gameplay mechanics we
want to reuse here. You cannot see Joshua's files locally; **fetch them over
the web from GitHub** using the links below, read them, and adapt the patterns
into this repo.

- **Source repo:** `jbvyvf67cb-ai/wutang-arcade`
- **Pinned ref for all links below:** commit `40a5394` (immutable; the
  descriptions in this doc match this commit).
- **Default branch (latest code):** `claude/joshua-bear-platformer-7jr08s`
- **Live build (to see what the code produces):**
  https://jbvyvf67cb-ai.github.io/wutang-arcade/

---

## ⚠️ STEP 0 — get read access (do this first)

**The source repo is PRIVATE.** Plain `WebFetch` on a raw URL will fail for a
private repo (WebFetch can't authenticate). Pick whichever of these works in
your environment, in order:

1. **GitHub MCP / `gh`** — if you have GitHub tools whose scope includes
   `jbvyvf67cb-ai/wutang-arcade`, read files with the contents API. With the
   MCP `get_file_contents` tool, pass `owner: jbvyvf67cb-ai`,
   `repo: wutang-arcade`, `ref: 40a5394`, and the `path` from the tables below.
   With `gh`: `gh api repos/jbvyvf67cb-ai/wutang-arcade/contents/<path>?ref=40a5394 --jq .content | base64 -d`.
   If your scope doesn't include this repo, ask the user to add it (Claude Code
   on the web: "add repo"; or `gh repo` access).
2. **WebFetch the raw URL** — works only if the user has made the repo public.
   Each entry below has a `raw:` link for this path.
3. **Ask the user** to either make the repo public for a moment, grant your
   session access to it, or paste specific files. Tell them exactly which files
   (use the priority list in §"Fetch order").

Confirm you can read one file (try `package.json`, link below) before going
further. URL shape, if you need to build more by hand:
- raw: `https://raw.githubusercontent.com/jbvyvf67cb-ai/wutang-arcade/40a5394/<path>`
- view: `https://github.com/jbvyvf67cb-ai/wutang-arcade/blob/40a5394/<path>`

---

## Fetch order (read these first)

You don't need all 35 files. To understand and port the systems, fetch in this
order and stop when you have what this repo needs:

1. `PLAN.md` — the design contract (level map, economy, the §9 quality rubric).
   [raw](https://raw.githubusercontent.com/jbvyvf67cb-ai/wutang-arcade/40a5394/PLAN.md)
2. `JOSHUA-REUSE-GUIDE.md` — the human-oriented sibling of this doc; richer
   prose on each system.
   [raw](https://raw.githubusercontent.com/jbvyvf67cb-ai/wutang-arcade/40a5394/JOSHUA-REUSE-GUIDE.md)
3. `src/main.ts` — the wiring; the best single map of the codebase.
   [raw](https://raw.githubusercontent.com/jbvyvf67cb-ai/wutang-arcade/40a5394/src/main.ts)
4. Then the subsystem(s) you actually need, from the tables below.

The two systems most worth importing: the **OSM → playable world pipeline**
(§3) and the **scripted-Blender character pipeline** (§4).

---

## 1. Tech stack & build config

Fetch these to match toolchain and bundling decisions:

| What | path | links |
|---|---|---|
| Deps & scripts | `package.json` | [raw](https://raw.githubusercontent.com/jbvyvf67cb-ai/wutang-arcade/40a5394/package.json) · [view](https://github.com/jbvyvf67cb-ai/wutang-arcade/blob/40a5394/package.json) |
| Vite config | `vite.config.ts` | [raw](https://raw.githubusercontent.com/jbvyvf67cb-ai/wutang-arcade/40a5394/vite.config.ts) · [view](https://github.com/jbvyvf67cb-ai/wutang-arcade/blob/40a5394/vite.config.ts) |
| TS config | `tsconfig.json` | [raw](https://raw.githubusercontent.com/jbvyvf67cb-ai/wutang-arcade/40a5394/tsconfig.json) · [view](https://github.com/jbvyvf67cb-ai/wutang-arcade/blob/40a5394/tsconfig.json) |
| Engine boot | `src/core/setup.ts` | [raw](https://raw.githubusercontent.com/jbvyvf67cb-ai/wutang-arcade/40a5394/src/core/setup.ts) · [view](https://github.com/jbvyvf67cb-ai/wutang-arcade/blob/40a5394/src/core/setup.ts) |

Key facts (verify against the files): Babylon.js 8 + Havok WASM physics,
TypeScript strict, Vite 6. Babylon uses **deep side-effecting imports** (e.g.
`import "@babylonjs/core/Physics/physicsEngineComponent"`) — preserve that
style or tree-shaking breaks and the bundle balloons. Havok needs **top-level
await** at init (`vite-plugin-top-level-await` + `optimizeDeps.exclude:
["@babylonjs/havok"]`). `vite.config.ts` uses `base:"./"` and
`publicDir:"assets"`, so asset URLs are relative (`./models/...`).

---

## 2. Architecture & the decoupling pattern

`src/main.ts` (~496 lines) wires everything imperatively; read it top-to-bottom
first. Systems **don't call each other** — they go through a typed event bus.

| What | path | links |
|---|---|---|
| Wiring / boot loop | `src/main.ts` | [raw](https://raw.githubusercontent.com/jbvyvf67cb-ai/wutang-arcade/40a5394/src/main.ts) · [view](https://github.com/jbvyvf67cb-ai/wutang-arcade/blob/40a5394/src/main.ts) |
| Event bus + game state | `src/game/state.ts` | [raw](https://raw.githubusercontent.com/jbvyvf67cb-ai/wutang-arcade/40a5394/src/game/state.ts) · [view](https://github.com/jbvyvf67cb-ai/wutang-arcade/blob/40a5394/src/game/state.ts) |

`GameState` (in `state.ts`) is `on(ev, fn)` / `emit(ev, v)` over a `GameEvent`
string union, plus the canonical numbers (health, coins, the "Groove" meter,
pieces, phase machine). UI subscribes; gameplay emits. Adopt this pattern even
if you keep nothing else.

---

## 3. ⭐ OSM → playable world pipeline (highest-value import)

Turns real OpenStreetMap geography into a merged, culled, physics-backed 3D
world. **Fetch (network, once) → bake (offline Python) → render (runtime TS)**,
with the first two committed for reproducibility.

| Stage | path | links |
|---|---|---|
| Fetch from Overpass | `tools/map/fetch_osm.py` | [raw](https://raw.githubusercontent.com/jbvyvf67cb-ai/wutang-arcade/40a5394/tools/map/fetch_osm.py) · [view](https://github.com/jbvyvf67cb-ai/wutang-arcade/blob/40a5394/tools/map/fetch_osm.py) |
| Bake → quarter.json | `tools/map/build_map.py` | [raw](https://raw.githubusercontent.com/jbvyvf67cb-ai/wutang-arcade/40a5394/tools/map/build_map.py) · [view](https://github.com/jbvyvf67cb-ai/wutang-arcade/blob/40a5394/tools/map/build_map.py) |
| Landmark style research | `tools/map/LANDMARKS.md` | [raw](https://raw.githubusercontent.com/jbvyvf67cb-ai/wutang-arcade/40a5394/tools/map/LANDMARKS.md) · [view](https://github.com/jbvyvf67cb-ai/wutang-arcade/blob/40a5394/tools/map/LANDMARKS.md) |
| Render (the big one, ~1314 ln) | `src/level/quarter.ts` | [raw](https://raw.githubusercontent.com/jbvyvf67cb-ai/wutang-arcade/40a5394/src/level/quarter.ts) · [view](https://github.com/jbvyvf67cb-ai/wutang-arcade/blob/40a5394/src/level/quarter.ts) |
| Gameplay coords/layout | `src/level/layout.ts` | [raw](https://raw.githubusercontent.com/jbvyvf67cb-ai/wutang-arcade/40a5394/src/level/layout.ts) · [view](https://github.com/jbvyvf67cb-ai/wutang-arcade/blob/40a5394/src/level/layout.ts) |

**The baked data contract** is `assets/map/quarter.json` (~0.5 MB, committed).
Don't fetch the whole thing to learn its shape — read the `QuarterData`
interface at the top of `src/level/quarter.ts` instead. Top-level keys: `meta`
(`scale`, `origin`, `rotationRad`, `flipX`, `bounds`), `buildings`
(each `{id, pts[], tri[], lv, name, c, f}`), `streets`, `intersections`,
`pois`, `parks`, `river`, `land`, `trams`, `shoreline`, `landmarks`.

What to lift:
- **`build_map.py`**: project lon/lat→meters, rotate a chosen street to +Z,
  scale (`GAME_SCALE=0.65`), clip to a neighborhood, **ear-clip triangulate**
  footprints offline (`ear_clip()`), and **fuzzy-match a curated landmark dict
  to OSM names** with fallback coords — this is how anonymous polygons become
  named hero buildings. Deterministic.
- **`quarter.ts`**: the `Buf` class (accumulates positions/indices/normals/uv/
  vertex-colors → one `VertexData` per material), **150 m chunk merge +
  distance culling** (`updateCulling(p)`), façade-atlas UVs, **runtime
  `DynamicTexture` signage** (real names, no texture files), one physics mesh
  per chunk. `buildQuarter(scene)` returns a `QuarterResult` (root, data,
  dynamicProps, waterMesh, interiors, interactables, landmarkMarkers,
  streetCoins, tramLine, `updateCulling`, `setNight`).

**Adapt for THIS repo:** keep the pipeline; change the bbox + `QUERIES` in
`fetch_osm.py`, and the landmark dict + style table in `build_map.py`. The
`Buf` + chunk-merge + cull trio is engine-generic and worth extracting into its
own module for any large world. **No runtime triangulation** — if world shape
changes, re-run `build_map.py` and commit the new JSON.

> Reuse obligation: the baked world / fetch+bake pipeline carry **OSM ODbL** —
> "Map data © OpenStreetMap contributors". Keep the attribution.

---

## 4. ⭐ "No Ovals" character pipeline (scripted Blender → glTF)

No character geometry authored in code; everything is a committed `bpy` script
exporting glTF. `pip install bpy`.

| What | path | links |
|---|---|---|
| **Reusable mesh kit** (tubes, parallel-transport frames) | `tools/character/bearlib.py` | [raw](https://raw.githubusercontent.com/jbvyvf67cb-ai/wutang-arcade/40a5394/tools/character/bearlib.py) · [view](https://github.com/jbvyvf67cb-ai/wutang-arcade/blob/40a5394/tools/character/bearlib.py) |
| Bear model + rig | `tools/character/joshua.py` | [raw](https://raw.githubusercontent.com/jbvyvf67cb-ai/wutang-arcade/40a5394/tools/character/joshua.py) · [view](https://github.com/jbvyvf67cb-ai/wutang-arcade/blob/40a5394/tools/character/joshua.py) |
| 16 clips + **bone sign conventions** | `tools/character/joshua_anims.py` | [raw](https://raw.githubusercontent.com/jbvyvf67cb-ai/wutang-arcade/40a5394/tools/character/joshua_anims.py) · [view](https://github.com/jbvyvf67cb-ai/wutang-arcade/blob/40a5394/tools/character/joshua_anims.py) |
| Enemy variants (one rig, costumes) | `tools/character/humanoid.py` | [raw](https://raw.githubusercontent.com/jbvyvf67cb-ai/wutang-arcade/40a5394/tools/character/humanoid.py) · [view](https://github.com/jbvyvf67cb-ai/wutang-arcade/blob/40a5394/tools/character/humanoid.py) |
| Entry point | `tools/character/build_joshua.py` | [raw](https://raw.githubusercontent.com/jbvyvf67cb-ai/wutang-arcade/40a5394/tools/character/build_joshua.py) · [view](https://github.com/jbvyvf67cb-ai/wutang-arcade/blob/40a5394/tools/character/build_joshua.py) |
| Toolchain smoke test (run first) | `tools/pipeline/smoke_test.py` | [raw](https://raw.githubusercontent.com/jbvyvf67cb-ai/wutang-arcade/40a5394/tools/pipeline/smoke_test.py) · [view](https://github.com/jbvyvf67cb-ai/wutang-arcade/blob/40a5394/tools/pipeline/smoke_test.py) |

`bearlib.py` is the genuinely reusable file: a primitives-free organic-mesh
generator (elliptical cross-section "stations" bridged with quads, parallel-
transport frames so tubes don't pinch). `joshua_anims.py`'s header documents
which bone rotation does what — copy that cheat sheet. Run `smoke_test.py` in a
new environment first to confirm headless `bpy` works before building assets.

---

## 5. Player feel, camera, input (take as a set for Banjo-style movement)

| What | path | links |
|---|---|---|
| Capsule controller, swim, tank/cam-relative | `src/player/controller.ts` | [raw](https://raw.githubusercontent.com/jbvyvf67cb-ai/wutang-arcade/40a5394/src/player/controller.ts) · [view](https://github.com/jbvyvf67cb-ai/wutang-arcade/blob/40a5394/src/player/controller.ts) |
| glTF load + animation state machine | `src/player/bear.ts` | [raw](https://raw.githubusercontent.com/jbvyvf67cb-ai/wutang-arcade/40a5394/src/player/bear.ts) · [view](https://github.com/jbvyvf67cb-ai/wutang-arcade/blob/40a5394/src/player/bear.ts) |
| Chase camera (follow-behind + recenter) | `src/core/camera.ts` | [raw](https://raw.githubusercontent.com/jbvyvf67cb-ai/wutang-arcade/40a5394/src/core/camera.ts) · [view](https://github.com/jbvyvf67cb-ai/wutang-arcade/blob/40a5394/src/core/camera.ts) |
| Unified input (kbd/mouse/touch → one state) | `src/core/input.ts` | [raw](https://raw.githubusercontent.com/jbvyvf67cb-ai/wutang-arcade/40a5394/src/core/input.ts) · [view](https://github.com/jbvyvf67cb-ai/wutang-arcade/blob/40a5394/src/core/input.ts) |
| Virtual stick + buttons (iOS-safe) | `src/ui/touch.ts` | [raw](https://raw.githubusercontent.com/jbvyvf67cb-ai/wutang-arcade/40a5394/src/ui/touch.ts) · [view](https://github.com/jbvyvf67cb-ai/wutang-arcade/blob/40a5394/src/ui/touch.ts) |

**Read the comments before refactoring** — these files encode hard-won
iOS-Safari fixes: no animation blending, quantize `speedRatio` writes (analog
speed churning it wedges WebKit into a stuck pose — the "limp glide" bug),
fall-pose hysteresis, `touch-action:none`, never trust pointer capture, clamp
the stick vector to its radius. Camera gotcha: ArcRotate heading is
`-alpha - π/2` (a reflected sign parks the camera beside the player).

---

## 6. Gameplay modules (small, liftable)

| What | path | links |
|---|---|---|
| Melee combo, Groove special, shockwave, fishbowl | `src/combat/combat.ts` | [raw](https://raw.githubusercontent.com/jbvyvf67cb-ai/wutang-arcade/40a5394/src/combat/combat.ts) · [view](https://github.com/jbvyvf67cb-ai/wutang-arcade/blob/40a5394/src/combat/combat.ts) |
| Behavior-tree enemies + manager | `src/ai/enemies.ts` | [raw](https://raw.githubusercontent.com/jbvyvf67cb-ai/wutang-arcade/40a5394/src/ai/enemies.ts) · [view](https://github.com/jbvyvf67cb-ai/wutang-arcade/blob/40a5394/src/ai/enemies.ts) |
| Coins (thin instances), pieces, KO spill | `src/game/collectibles.ts` | [raw](https://raw.githubusercontent.com/jbvyvf67cb-ai/wutang-arcade/40a5394/src/game/collectibles.ts) · [view](https://github.com/jbvyvf67cb-ai/wutang-arcade/blob/40a5394/src/game/collectibles.ts) |
| Day/night rig (sun/fog/sky → night amount) | `src/level/timeofday.ts` | [raw](https://raw.githubusercontent.com/jbvyvf67cb-ai/wutang-arcade/40a5394/src/level/timeofday.ts) · [view](https://github.com/jbvyvf67cb-ai/wutang-arcade/blob/40a5394/src/level/timeofday.ts) |
| Rideable moving platform on a polyline | `src/level/streetcar.ts` | [raw](https://raw.githubusercontent.com/jbvyvf67cb-ai/wutang-arcade/40a5394/src/level/streetcar.ts) · [view](https://github.com/jbvyvf67cb-ai/wutang-arcade/blob/40a5394/src/level/streetcar.ts) |

`combat.ts` and `enemies.ts` are decoupled through the **`Hittable` interface**
(`{position, alive, hit()}`) — combat never knows enemy types. `collectibles.ts`
uses **thin instances** (one mesh, thousands of matrices) for scatter pickups.
`timeofday.ts` exposes a 0..1 `night` value that `quarter.ts`'s `setNight`
consumes to drive lamp/neon emissive.

---

## 7. Audio (Web Audio + offline-rendered PD music)

| What | path | links |
|---|---|---|
| Audio bus (iOS unlock/keep-alive, zones, SFX) | `src/audio/audio.ts` | [raw](https://raw.githubusercontent.com/jbvyvf67cb-ai/wutang-arcade/40a5394/src/audio/audio.ts) · [view](https://github.com/jbvyvf67cb-ai/wutang-arcade/blob/40a5394/src/audio/audio.ts) |
| Render PD compositions → loop MP3s | `tools/audio/make_music.py` | [raw](https://raw.githubusercontent.com/jbvyvf67cb-ai/wutang-arcade/40a5394/tools/audio/make_music.py) · [view](https://github.com/jbvyvf67cb-ai/wutang-arcade/blob/40a5394/tools/audio/make_music.py) |
| Voice line (espeak → DSP) | `tools/audio/make_shriek.py` | [raw](https://raw.githubusercontent.com/jbvyvf67cb-ai/wutang-arcade/40a5394/tools/audio/make_shriek.py) · [view](https://github.com/jbvyvf67cb-ai/wutang-arcade/blob/40a5394/tools/audio/make_shriek.py) |

`audio.ts` has the **iOS "no sound" fix**: resume the AudioContext on every
interaction and on `visibilitychange`. `make_music.py` arranges public-domain
compositions and renders them with fluidsynth + FluidR3_GM to seamless loops —
zero recording-copyright risk; copy the provenance discipline if you ship music
(`apt-get install fluidsynth fluid-soundfont-gm espeak-ng`).

---

## 8. Procedural textures + UI (optional)

| What | path | links |
|---|---|---|
| Façade atlas / signs / road (PIL) | `tools/textures/make_textures.py` | [raw](https://raw.githubusercontent.com/jbvyvf67cb-ai/wutang-arcade/40a5394/tools/textures/make_textures.py) · [view](https://github.com/jbvyvf67cb-ai/wutang-arcade/blob/40a5394/tools/textures/make_textures.py) |
| DOM HUD | `src/ui/hud.ts` | [raw](https://raw.githubusercontent.com/jbvyvf67cb-ai/wutang-arcade/40a5394/src/ui/hud.ts) · [view](https://github.com/jbvyvf67cb-ai/wutang-arcade/blob/40a5394/src/ui/hud.ts) |
| Rotating minimap + compass | `src/ui/minimap.ts` | [raw](https://raw.githubusercontent.com/jbvyvf67cb-ai/wutang-arcade/40a5394/src/ui/minimap.ts) · [view](https://github.com/jbvyvf67cb-ai/wutang-arcade/blob/40a5394/src/ui/minimap.ts) |
| Assembly minigame | `src/ui/assembly.ts` | [raw](https://raw.githubusercontent.com/jbvyvf67cb-ai/wutang-arcade/40a5394/src/ui/assembly.ts) · [view](https://github.com/jbvyvf67cb-ai/wutang-arcade/blob/40a5394/src/ui/assembly.ts) |

---

## 9. The executable rubric + debug surface (adopt the idea early)

| What | path | links |
|---|---|---|
| 16-gate Playwright rubric | `qa/playwright/rubric.spec.ts` | [raw](https://raw.githubusercontent.com/jbvyvf67cb-ai/wutang-arcade/40a5394/qa/playwright/rubric.spec.ts) · [view](https://github.com/jbvyvf67cb-ai/wutang-arcade/blob/40a5394/qa/playwright/rubric.spec.ts) |
| Screenshot harness | `qa/shot.mjs` | [raw](https://raw.githubusercontent.com/jbvyvf67cb-ai/wutang-arcade/40a5394/qa/shot.mjs) · [view](https://github.com/jbvyvf67cb-ai/wutang-arcade/blob/40a5394/qa/shot.mjs) |
| Debug overlay + `window.__telemetry` | `src/ui/debug.ts` | [raw](https://raw.githubusercontent.com/jbvyvf67cb-ai/wutang-arcade/40a5394/src/ui/debug.ts) · [view](https://github.com/jbvyvf67cb-ai/wutang-arcade/blob/40a5394/src/ui/debug.ts) |

The game exposes a debug API on `window` (`__player`, `__state`, `__enemies`,
`__combat`, `__camera`, `__bear`, `__time`, `__audio`, `__input`,
`__tp(x,y,z)`, `__freecam(...)`, `__unlock()`, `__telemetry`, `__landmarks`,
`__interiors`). **Build the same `window.__*` surface into THIS game from day
one** — it's what makes headless verification of a 3D game possible. Note:
software-GL in CI runs ~4 fps, so the rubric checks *behavior and budgets*, not
absolute fps.

---

## 10. Recommended import order for THIS repo

1. Match the stack (§1): Babylon 8 + Havok, the Vite/TS config quirks.
2. Adopt the **`GameState` event bus** (§2) — cheap, high payoff.
3. Port the **OSM world pipeline** (§3): `tools/map/*` + `quarter.ts`; retarget
   the bbox and landmark dict. Extract `Buf`+chunk+cull as a generic module.
4. Bring in the **character kit** (§4): `bearlib.py` + `smoke_test.py`; use the
   bear/humanoid scripts as worked examples.
5. If you want the movement feel, take **controller + bear + input + touch**
   (§5) as a set, comments included.
6. Layer in **combat/enemies via `Hittable`**, then `timeofday`/`streetcar`/
   `audio` as independent drop-ins (§6–7).
7. Stand up the **`window.__*` debug surface + a rubric** (§9) early.

## 11. Gotchas to carry over
- Don't tidy Babylon's deep imports to barrels — breaks tree-shaking.
- Havok needs top-level await + `optimizeDeps.exclude`.
- iOS Safari: no anim blending, no per-frame `speedRatio`, no pointer-capture
  trust, keep AudioContext resumed. All solved in the linked files — read the
  comments first.
- `base:"./"` + relative asset URLs, or subpath deploys (GitHub Pages) break.
- Re-run `build_map.py` and commit `quarter.json` whenever world shape changes;
  there is no runtime triangulation.
- Keep the **OSM ODbL attribution** if you reuse the world/pipeline.

*If a link 404s, the ref `40a5394` may have been GC'd or the path moved — fall
back to the default branch `claude/joshua-bear-platformer-7jr08s` (swap the SHA
in any URL for the branch name), or list the tree via the contents API.*
