# ContinentData — the map format (and how to convert a hand-drawn map)

This is the JSON the map maker reads and writes, and the **target format for
converting a hand-drawn map** into a starting point you can then refine in the
editor. It is intentionally simple and flat so it is easy to generate.

> Authoritative type definitions live in `src/world/schema.ts`. If this doc and
> the code ever disagree, the code wins — update this doc.

---

## Coordinate frame
- Right-handed, **Y up**, units = meters.
- The ground plane is **X (east/west) × Z (north/south)**; height is Y.
- Flat continents use normal down-gravity (default `[0,-16,0]`). The globe is
  deferred, so author each continent as a flat region for now.
- A good working canvas: a continent roughly **120 × 120 m** centered on the
  origin, i.e. X and Z in `[-60, 60]`.

---

## Top-level shape

```jsonc
{
  "meta": {
    "id": "isle-of-dawn",            // slug, used as the save filename
    "name": "Isle of Dawn",
    "version": 1,
    "bounds": { "min": [-65,-25,-65], "max": [65,45,65] }, // encloses everything
    "gravity": [0,-16,0],            // optional, this is the default
    "killPlaneY": -40,               // optional; fall below = respawn
    "seaLevel": 0,                   // optional; renders a translucent water plane at this Y
    "physics": {                     // optional per-level movement feel (multiplies character stats)
      "runMultiplier": 1,            // 0.25..3
      "jumpMultiplier": 1,           // 0.25..2.5
      "airControl": 1                // 0..1
    },
    "env": {                         // optional aesthetics — all fields optional (see Style tab)
      "sky": [0.4,0.66,0.9],         // background color
      "horizon": [0.5,0.45,0.38],    // ground-bounce tint of the sky light
      "fogColor": [0.75,0.85,0.95], "fogDensity": 0.0012,   // 0 disables fog
      "sunColor": [1,0.98,0.92], "sunIntensity": 1.4,
      "sunAzimuth": 240, "sunElevation": 55,                // degrees
      "ambient": 0.55,
      "waterColor": [0.1,0.42,0.58], "waterOpacity": 0.62
    }
  },
  "terrain": { /* optional heightmap, see below */ },
  "prefabs":  [ /* placed 3D building blocks */ ],
  "entities": [ /* gameplay markers */ ]
}
```

### terrain (optional heightmap)
A row-major grid of height samples over an XZ rectangle.

```jsonc
{
  "size": [120, 120],         // world extent on X and Z (meters)
  "resolution": [41, 41],     // [cols(X), rows(Z)]; heights.length === cols*rows
  "heights": [ /* cols*rows floats, row-major: index = r*cols + c */ ],
  "origin": [-60, -60],       // optional; world XZ of the grid's min corner
                              // (defaults to centering the grid on the origin)
  "palette": [                // optional elevation color ramp (editable in Style tab)
    { "h": 0.4, "color": [0.78,0.72,0.5] },
    { "h": 3,   "color": [0.42,0.6,0.32] },
    { "h": 30,  "color": [0.93,0.93,0.96] }
  ]
}
```
- Height of cell (c, r) is `heights[r*cols + c]` meters.
- 41×41 over 120 m ≈ a 3 m grid — plenty for gentle terrain; bump resolution for
  finer hills (the Level tab can resample an existing terrain to any size/grid).
- Terrain is auto-colored by elevation (default: sand → grass → rock → snow;
  override with `palette`). Set `meta.seaLevel` to flood everything below it
  with a translucent ocean — so a heightmap of raised landmasses over a sea
  reads as a world map. Offline-bake scripts: `tools/gen-map.mjs` (the full
  hand-drawn world), `tools/gen-slice.mjs` (the southern-continent movement
  playground), both built on the shared traced geography in `tools/maplib.mjs`.

### prefabs (true-3D building blocks)
Each entry is one placed instance. Unit prefab meshes are scaled/rotated/moved by
the instance.

```jsonc
{
  "id": "p1",                 // unique within the file
  "prefab": "platform",       // one of the keys below
  "pos":   [0, 4, 0],         // center position (meters)
  "rot":   [0, 0, 0],         // Euler radians, XYZ
  "scale": [6, 0.6, 6],       // size multipliers (meters, since base mesh is unit)
  "tint":  [0.6, 0.8, 1.0],   // optional RGB 0..1, multiplies the base color
  "skin": "brick",            // optional material style: brick|planks|stone|checker|metal|grass|candy
  "collider": "auto",         // optional; "auto" uses the prefab default
  "props": { "axis": "x", "dist": 6, "speed": 2 }  // per-instance gameplay tuning (see below)
}
```

**Prefab keys** (from `src/world/prefabs.ts`) — base mesh is a unit (~1 m) shape;
`scale` gives real size. `defaultScale` is what the editor uses when you click to
place; reuse it as a sensible starting size when converting:

| key        | shape                         | default collider | defaultScale   |
|------------|-------------------------------|------------------|----------------|
| `platform` | flat box (floors/ledges)      | box              | `[6, 0.6, 6]`  |
| `block`    | cube                          | box              | `[2, 2, 2]`    |
| `wall`     | tall thin box                 | box              | `[6, 4, 0.5]`  |
| `ramp`     | wedge (rises along +Z)        | mesh             | `[4, 2, 4]`    |
| `stairs`   | staircase (rises along +Z)    | mesh             | `[4, 3, 5]`    |
| `pillar`   | cylinder                      | cylinder         | `[1.5, 4, 1.5]`|
| `cone`     | cone                          | mesh             | `[2.5, 4, 2.5]`|
| `gate`     | archway (legs + lintel)       | mesh             | `[6, 6, 1.2]`  |
| `dome`     | hemisphere                    | mesh             | `[6, 3, 6]`    |
| `bridge`   | deck + side rails             | mesh             | `[3, 2, 8]`    |
| `tree`     | blocky leaf tree (two-tone)   | box              | `[4, 7, 4]`    |
| `pine`     | stepped pine (two-tone)       | box              | `[3.5, 8, 3.5]`|
| `rock`     | jittered low-poly boulder     | mesh             | `[2.5, 2, 2.5]`|
| `bush`     | squashed sphere               | sphere           | `[2, 1.4, 2]`  |
| `crystal`  | glowing octahedron            | box              | `[1.4, 3, 1.4]`|
| `ball`     | sphere (prop)                 | sphere           | `[2, 2, 2]`    |
| `crate`    | cube (prop)                   | box              | `[2, 2, 2]`    |
| `fence`    | posts + rails                 | box              | `[4, 1.6, 0.3]`|
| `ring`     | glowing torus                 | mesh             | `[4, 4, 4]`    |
| `spring`   | 🎮 launches the player up      | box              | `[1.6, 1.1, 1.6]` |
| `boost`    | 🎮 speed pad (aim via rot[1])  | box              | `[3, 0.5, 3]`  |
| `spikes`   | 🎮 hazard — respawn on touch   | box              | `[2.5, 1, 2.5]`|
| `movingPlatform` | 🎮 back-and-forth platform | box            | `[4, 0.6, 4]`  |
| `goal`     | 🎮 level-complete flag         | box              | `[1.5, 4, 1.5]`|

**Gameplay props** (per instance, edited in the Inspector):
`spring.power` (launch velocity, default ≈19), `boost.power` (speed, default 24),
`movingPlatform.axis` (`"x"|"y"|"z"`) + `dist` (m) + `speed` (m/s). Moving
platforms carry the player; springs refresh air moves like a fresh jump.

- A `ramp` rises from its low edge (−Z) to its high edge (+Z); rotate via
  `rot[1]` (Y) to point it. `scale = [width, rise, run]`.
- `collider` values: `auto | box | sphere | capsule | cylinder | mesh | none`.

### entities (gameplay markers)
```jsonc
{ "id": "spawn", "type": "playerSpawn", "pos": [0, 6, 6] }
```
**Types** (rendered as colored markers; gameplay hookup comes later):
`playerSpawn` (green — where Play mode drops you), `checkpoint` (blue),
`coin` (gold), `enemy` (red). Always include at least one `playerSpawn`.

---

## Minimal valid example

```json
{
  "meta": { "id": "demo2", "name": "Demo 2", "version": 1,
            "bounds": { "min": [-65,-25,-65], "max": [65,45,65] } },
  "terrain": { "size": [120,120], "resolution": [3,3], "heights": [0,0,0,0,1,0,0,0,0] },
  "prefabs": [
    { "id": "p1", "prefab": "platform", "pos": [0,4,0], "rot": [0,0,0], "scale": [6,0.6,6] },
    { "id": "p2", "prefab": "ramp", "pos": [0,0.5,-8], "rot": [0,0,0], "scale": [6,3.5,8] }
  ],
  "entities": [ { "id": "spawn", "type": "playerSpawn", "pos": [0,6,6] } ]
}
```

---

## Converting a hand-drawn map

**The built-in way: top bar → 🗺 Import.** Attach a photo/scan of the drawing
and Claude converts it in one shot. It emits a **MapPlan**
(`src/ai/mapplan.ts`) — traced coastline polygons, lakes, peaks, ridges,
river valleys, walking paths, forest scatters, composed structures, and
gameplay markers, all in normalized drawing coordinates via structured
outputs — and `compileMapPlan()` rasterizes that deterministically into the
`ContinentData` below (signed-distance coastlines → beach ramps → plateaus,
same math as `tools/maplib.mjs`; every value clamped, counts capped). The
result is a normal level: edit it by hand, adjust it with the ✨ Assist box,
publish it to `assets/continents/`.

The same mapping, if you ever do it by hand (or want to understand what the
importer decides):

1. **Pick a scale.** Decide what the page spans in meters (e.g. the drawing =
   120 × 120 m, centered on origin → X,Z ∈ [−60, 60]). Map pixel/grid positions
   on the page to world XZ with that scale; **page-up = −Z or +Z, be consistent.**
2. **Terrain.** Read shaded elevation / contour hints into the `heights` grid
   (higher ground = larger Y). If the sketch is flat, use a low-resolution flat
   grid (or omit `terrain`). Keep heights modest (say −5..15 m) to start.
3. **Structures → prefabs.** Each drawn shape becomes a prefab instance:
   rectangles/platforms → `platform` or `block`; long thin shapes → `wall`;
   round towers → `pillar`; slopes/stairs → `ramp` (set `rot[1]` to aim it).
   Use each prefab's `defaultScale` as a starting size, then set `pos` from the
   sketch (with `pos[1]` = terrain height there + half the prefab's Y scale so it
   sits on the ground).
4. **Markers → entities.** A start mark → `playerSpawn`; flags → `checkpoint`;
   coins/pickups → `coin`; enemy marks → `enemy`.
5. **Bounds.** Set `meta.bounds` to enclose all geometry with a little margin.
6. **Emit JSON** in the shape above. It does not need to be perfect — it is a
   *baseline*; load it in the editor and refine with gizmos and the sculpt brush.

> **Imports are forgiving.** Every load runs through `normalizeContinent`
> (`src/world/normalize.ts`): missing `id`s are generated, absent `rot`/`scale`
> default (scale from the prefab's `defaultScale`), unknown prefab keys fall back
> to `block`, terrain `heights` are padded/truncated to `cols*rows`, a
> `playerSpawn` is added if none exists, and `meta.bounds` is computed from the
> content when absent. So a partial/approximate baseline still loads — you only
> need to get the shapes and positions roughly right.

> **Tracing aid:** the editor's **Ref Image** button drops the original sketch
> in as a flat, opacity-adjustable underlay sized to the level bounds — place and
> sculpt directly over the drawing. (It's an editor aid only, not saved in the level.)

### Loading a converted map
- **In the editor:** click **Load** and pick the `.json`.
- **At boot:** `?level=<url>` — drop the file in `assets/continents/` and open
  `?level=./continents/your-map.json`.
- **From console/automation:** `window.__app.loadContinent(<parsedJSON>)`.

Round-trip is lossless: edit, then **Save** to get cleaned-up JSON back.

> **Autosave:** the editor autosaves the current level to `localStorage`
> (key `mb5.level`) on every change and restores it on reload, so a refresh
> keeps your work. **New Level** starts fresh; **Load Demo** restores the demo.
