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
    "killPlaneY": -40                // optional; fall below = respawn
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
  "origin": [-60, -60]        // optional; world XZ of the grid's min corner
                              // (defaults to centering the grid on the origin)
}
```
- Height of cell (c, r) is `heights[r*cols + c]` meters.
- 41×41 over 120 m ≈ a 3 m grid — plenty for gentle terrain; bump resolution for
  finer hills. Keep it ≤ ~129×129 for now.

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
  "collider": "auto",         // optional; "auto" uses the prefab default
  "props": {}                 // optional, reserved for per-instance params
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
| `ball`     | sphere (prop)                 | sphere           | `[2, 2, 2]`    |

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

## Converting a hand-drawn map (the intended future flow)

A top-down hand-drawn sketch maps to `ContinentData` like this:

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

### Loading a converted map
- **In the editor:** click **Load** and pick the `.json`.
- **At boot:** `?level=<url>` — drop the file in `assets/continents/` and open
  `?level=./continents/your-map.json`.
- **From console/automation:** `window.__app.loadContinent(<parsedJSON>)`.

Round-trip is lossless: edit, then **Save** to get cleaned-up JSON back.

> **Autosave:** the editor autosaves the current level to `localStorage`
> (key `mb5.level`) on every change and restores it on reload, so a refresh
> keeps your work. **New Level** starts fresh; **Load Demo** restores the demo.
