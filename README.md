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

## The map maker

Boots into **Edit mode**. Press **Tab** to **Play** (walk the level you built).

**Tools** (keys `1`–`4`): **Select** · **Place** · **Sculpt** · **Entity**
- **Select** — click an object; move/rotate/scale gizmos (`Q`/`W`/`E`); the
  inspector edits position/rotation/scale, tint, and collider; `F` focuses it.
- **Place** — pick a prefab (platform, block, wall, ramp, stairs, pillar, cone,
  ball) and click a surface to drop it.
- **Sculpt** — heightmap brushes (raise / lower / smooth / flatten) with
  radius + strength.
- **Entity** — drop gameplay markers (player spawn, coin, checkpoint, enemy).

**Editing**: **Undo/Redo** (`Ctrl+Z` / `Ctrl+Shift+Z` / `Ctrl+Y`),
**Duplicate** (`Ctrl+D`), **Delete** (`Del`), **Snap to grid**.

**Level**: name, gravity, kill-plane, New Flat Terrain, **New Level**,
**Load Demo**, and a **Ref Image** underlay (drop a scanned hand-drawn map in
as a flat, opacity-adjustable tracing aid). **Save** downloads JSON; **Load**
opens it. Work **autosaves** to the browser and restores on reload.

**Play mode**: WASD move, Space to jump (double-jump in air), chase camera,
collect coins, checkpoints set respawn, falling respawns you. Tab returns to
editing.

## Project layout

```
src/
  core/      engine boot, input, debug surface (window.__*)
  world/     ContinentData schema, prefab library, terrain, the World runtime
  editor/    Editor (tools/gizmos/sculpt), command history, DOM UI
  player/    capsule controller (Play mode)
  game/      event-bus state, PlaySession (coins/checkpoints)
  ui/        HUD
  app.ts     ties world + editor + play together
docs/        JOSHUA-* notes, MAP-FORMAT.md (the level format + import flow)
qa/          shot.mjs headless harness
```

## Levels & hand-drawn import

The level format and the **hand-drawn map → JSON** conversion flow are
documented in `docs/MAP-FORMAT.md`. Load a converted map via the editor's
**Load** button, `?level=<url>`, or `window.__app.loadContinent(json)`.

## Background

`docs/JOSHUA-NOTES.md` distills the reusable engineering from the prior "Joshua"
game (event bus, world batching, player feel + iOS fixes, the `window.__*` debug
surface, QA discipline). If any OSM-derived data is ever used, keep the ODbL
attribution: "Map data © OpenStreetMap contributors".
