# MB5 (working title)

A 3D globe open-world platformer aiming at Super Mario Odyssey–tier complexity:
a planet whose continents are open-world levels, single-player + co-op, real
physics. Built on **Babylon.js 8 + Havok**, TypeScript, Vite.

The first deliverable is a **3D map maker** — an in-engine editor that authors
levels (`ContinentData`) the game runtime renders. See `DESIGN.md` for the full
plan and `docs/` for details.

## Run it

```bash
npm install
npm run dev        # open the printed URL — boots into the map maker
```

Other scripts: `npm run build` (type-check + bundle), `npm run preview`
(serve the build), `npm run shot -- <url> <out.png>` (headless screenshot +
telemetry for QA).

## The three modes

**Build** (the map maker) · **Characters** (the sprite designer) · **Play**
(Tab or ▶). Switch Build/Characters in the top bar.

### Build — the map maker

Studio layout: top bar (file ops, Publish, undo/redo, Play), left tool rail +
contextual panel, right **Inspector | Level | Style** tabs, status bar
(`?` shows all shortcuts).

**Tools** (keys `1`–`4`): **Select** · **Place** · **Sculpt** · **Entity**
- **Select** — click an object; gizmos (`Q`/`W`/`E`); inspector edits
  transform/tint/collider; `F` focus, `Ctrl+D` duplicate, `Del` delete;
  snap with per-step settings.
- **Place** — searchable, categorized prefab palette (structure / nature /
  props: platforms, walls, ramps, stairs, gate, dome, bridge, trees, pines,
  rocks, crystals, fences, rings…), click a surface to drop.
- **Sculpt** — raise / lower / smooth / flatten with a brush-radius ring
  preview.
- **Entity** — gameplay markers (spawn, coin, checkpoint, enemy).

**Level tab**: name, gravity, kill-plane, **sea level (ocean plane)**, terrain
**resize/resample**, Ref Image underlay (trace a hand-drawn map).
**Style tab** — full aesthetic control: presets (Day/Sunset/Night/Alien), sky &
horizon colors, sun color/intensity/direction, ambient, fog, water color +
opacity, and an editable **terrain elevation palette** (add/remove color
stops). Everything applies live and saves into the level.

Work **autosaves**; **Save/Open** round-trips JSON; **Publish** writes to the
repo (see below).

### Characters — the designer

Sprite-based characters, fully customizable (see `docs/CHARACTERS.md`):
body sliders (height/width/weight/head/ears) that reshape the procedural
pixel sprite *and* the physics capsule, colors + accessory, stat sliders
(speed/jump/attack/defense) with live-derived movement numbers, and a
special-move loadout (double jump, dash, glide, ground pound, wall jump).
Presets: **Joshua** the bear, Scout, Boulder. **Use in Play** sets who you
spawn as; characters autosave and import/export as JSON.

### Play

WASD move, Space jump (+ the moves your character owns: `Shift` dash,
hold-Space glide, `C` ground pound, wall jump), chase camera, coins,
checkpoints, kill-plane respawn. Tab returns to editing. Pick who you play as
with the top-bar character picker, or hit **▶ Use in Play** in the designer to
jump straight from designing into playing.

### ✨ Assist — describe it, then tune it

Both editors have a Claude-powered prompt box (bottom-right in Build, under
the preview in Characters). Describe what you want —
*"a ring of pillars around the peak"*, *"make it a snowy night"*,
*"a tall lanky purple rabbit, fast but fragile, can glide"* — and it lands as
normal edits you then tune by hand (placed objects are undoable with Ctrl+Z;
generated characters join the roster).

Setup: paste an Anthropic API key into the panel's **key** field (kept
browser-local, like the GitHub publish token). Level requests come back as
constrained patch ops (add/remove prefabs & markers with ground snapping,
environment/palette changes, terrain sculpts) validated against the same
schema guards as hand-authored data; character requests come back as
`CharacterData` and are clamped by the normal normalizer.

**Try the movement playground:** `?level=./continents/joshua-slice.json` —
the hand-drawn world's southern continent as a course that exercises every
move (coin trail up the mountain, dash bay over water, wall-jump chimney,
pound crates, glide descent).

## Project layout

```
src/
  core/      engine boot, input, debug surface (window.__*)
  world/     ContinentData schema, prefab library, terrain, env, the World runtime
  editor/    Editor (tools/gizmos/sculpt), command history, widgets + studio UI
  character/ CharacterData schema, procedural sprite, roster store, designer
  player/    capsule controller (stats + special moves), sprite avatar
  game/      event-bus state, PlaySession (coins/checkpoints/shockwaves)
  ui/        HUD
  app.ts     ties world + editor + designer + play together
tools/       maplib.mjs (traced world geography), gen-map.mjs, gen-slice.mjs
docs/        JOSHUA-* notes, MAP-FORMAT.md, CHARACTERS.md
qa/          shot.mjs headless harness
```

## Hosting on GitHub Pages

The build is fully static (`base: "./"`), so it serves from a Pages project site.

**One-time setup:** repo **Settings → Pages → Build and deployment → Source:
"GitHub Actions"**. After that, `.github/workflows/pages.yml` builds and deploys
on every push (or a manual *Run workflow*). The site lands at
`https://jbvyvf67cb-ai.github.io/mb5-development/`.

## Publishing maps back to GitHub

A Pages-served page is static — the browser can't write to the repo on its own.
**Export** a level with the editor's **Save** button (downloads `<id>.json`),
then get it into the repo one of two ways:

- **Commit it (no secrets, recommended).** Drop the JSON into
  `assets/continents/` and commit — by `git`, GitHub's web "Add file → Upload",
  or by handing the file to Claude in a session (Claude commits it via the
  GitHub integration). On the next Pages deploy it's live at
  `?level=./continents/<name>.json`.
- **In-editor "Publish to GitHub" (self-service, needs a token).** The editor's
  **Publish (GitHub)** panel commits the current level straight to the repo via
  the GitHub Contents API. One-time: create a **fine-grained PAT** (Repository
  access → this repo; Permissions → **Contents: Read and write**), paste it,
  **Save Token** (kept in `localStorage`). Set owner/repo/branch/dir (prefilled),
  then **Publish to GitHub** → it writes `assets/continents/<id>.json` on the
  branch and Pages redeploys. Convenient, but it holds a write token in the
  browser, so use only on a trusted personal machine (**Clear Token** wipes it).

## Levels & hand-drawn import

The level format and the **hand-drawn map → JSON** conversion flow are
documented in `docs/MAP-FORMAT.md`. Load a converted map via the editor's
**Load** button, `?level=<url>`, or `window.__app.loadContinent(json)`.

## Background

`docs/JOSHUA-NOTES.md` distills the reusable engineering from the prior "Joshua"
game (event bus, world batching, player feel + iOS fixes, the `window.__*` debug
surface, QA discipline). If any OSM-derived data is ever used, keep the ODbL
attribution: "Map data © OpenStreetMap contributors".
