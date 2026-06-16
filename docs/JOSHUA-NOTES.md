# Joshua — distilled engineering notes (source-accurate)

> Studied from the real `wutang-arcade` source at commit `40a5394` (the repo was
> briefly made public; files were read locally, not committed here — only this
> distilled knowledge is). This is the reference for porting decisions. Joshua is
> licensed/owned separately; do not copy its bespoke New Orleans content. The OSM
> world data carries **ODbL** ("Map data © OpenStreetMap contributors").

Joshua = `joshua-bourbon-street` v0.1.0 — a Babylon.js 8 + Havok (Physics v2)
brawler-platformer set in the French Quarter. Player is a bear; verbs are melee,
a rhythm-charged "Groove" special, and traversal.

---

## A. Engine core & architecture

**Boot (`src/main.ts`, one async `boot()`):** canvas → optional `?viewer=` fork →
`createGameContext` (engine/scene/Havok) → light rig (DirectionalLight "sun"
2.6, HemisphericLight "sky", tier-sized ShadowGenerator, EXP2 fog) →
`buildQuarter(scene)` → construct subsystems **in order**: Input → PlayerController
→ ChaseCamera → GameState → Hud/Minimap → TimeOfDay → Bear(glTF) → AudioBus →
Collectibles → Combat → EnemyManager → quest/interior/streetcar/assembly wiring →
KO handler → opening cutscene → **one** `onBeforeRenderObservable` update tick
(+ a separate kill-plane observable) → `runRenderLoop(() => { if(!paused) scene.render() })`.
Cross-system coordination is **only** through `GameState`'s event bus. `main.ts`
is the single best map of the codebase.

**Engine boot (`src/core/setup.ts`):** `detectTier()` (high/medium/low) drives
shadow size + DPR cap. `new Engine(canvas,true,{powerPreference:"high-performance",
stencil:true, adaptToDeviceRatio:false})`, manual `setHardwareScalingLevel`.
Havok: `const havok = await HavokPhysics(); scene.enablePhysics(new Vector3(0,-16,0),
new HavokPlugin(true,havok))` — **gravity -16** (heavier than Earth, platformer
feel). Side-effect imports `physicsEngineComponent` + `engine.query` live here.
`resize` listener lives here too. `isTouch` detection here.

**Event bus (`src/game/state.ts`):** tiny string-keyed emitter.
```ts
export type GameEvent =
  | "health" | "coins" | "groove" | "piece" | "fishbowl" | "ko"
  | "message" | "quest" | "win";
// GameState: maxHealth=6, health=6, coins, groove(0..1)+grooveReady,
// pieces:Set<number>, fishbowls/fishbowlTimer(→ invulnerable), kos,
// secretsFound:Set<string>, phase: "wake"|"explore"|"lastcall"|"assembly"|"win".
// on(ev,fn)/emit(ev,v); plus mutators damage()/heal()/addCoins()/spillCoins()/
// addGroove()/drainGroove()/spendGroove()/collectPiece() that emit internally.
```
Phase machine: wake→explore (intro timer) → lastcall (8/8 pieces) → assembly
(reach spot) → win (minigame done).

**Debug surface (`src/ui/debug.ts` + main tail):** `__telemetry` ({fps, drawCalls,
samples[] rolling history via SceneInstrumentation}), `__gameReady`, `__player`,
`__state`, `__enemies`, `__combat`, `__camera`, `__bear`, `__time`, `__audio`,
`__input`, `__landmarks`, `__interiors`, `__metrics`, `__hudMessage(m)`,
`__tp(x,y,z)`, `__freecam(px,py,pz,tx,ty,tz)`, `__chasecam()`, `__unlock()`.
`?debug` adds a fixed green-on-black overlay. **This is the headless-QA backbone.**

**Config quirks:** Vite `base:"./"`, `publicDir:"assets"`, `build.target es2022`,
`chunkSizeWarningLimit 6000`, `assetsInlineLimit:0` (never inline the Havok .wasm),
`optimizeDeps.exclude:["@babylonjs/havok"]`, `server.host:true`. TS: `moduleResolution
"bundler"`, `strict` but `noUnusedLocals:false`, `useDefineForClassFields:true`.
Babylon imported via **deep side-effecting paths** (tree-shaking). Build strips
`dist/map/osm_raw` post-build.

---

## B. World pipeline (⭐ most relevant to the map maker)

Two stages: **offline baker** (`tools/map/`) OSM → committed `assets/map/quarter.json`,
and **runtime renderer** (`src/level/quarter.ts`) JSON → Babylon scene. **No runtime
triangulation** — whatever is baked is exactly what renders.

**Data contract `QuarterData`** (verbatim shape):
```ts
export interface QuarterData {
  meta: { bounds: [number,number,number,number]; attribution: string };
  buildings: Array<{ id:number; pts:number[]; tri:number[]; lv:number;
    name:string|null; c:[number,number]; f?:[number,string,number]; }>;
  streets: Array<{ name:string; cls:string; w:number; pts:number[] }>;
  intersections: Array<{ p:[number,number]; names:string[] }>;
  pois: Array<{ n:string; p:[number,number]; c:string }>;
  parks: Array<{ name:string|null; pts:number[]; tri:number[] }>;
  river: { pts:number[]; tri:number[] };
  land: { pts:number[]; tri:number[] };
  trams: number[][];
  shoreline: number[];
  landmarks: Array<{ key:string; p:[number,number]; bld:number|null; cat:string; src:string }>;
}
```
Conventions: world plane `(x,z)`, `y` up, ground `y=0`. `pts` = flat interleaved
`[x0,z0,x1,z1,...]`; `tri` = flat index triples into that point list (vertex `k`
is `pts[2k],pts[2k+1]`). Buildings: `id` seeds tile/tint, `pts` CCW ring, `tri`
ear-clipped cap, `lv` floors (height `lv*3.4+0.6`), `c` centroid (→ chunk
assignment), `f=[edgeIndex,streetName,dist]` the storefront edge. Baker also writes
extra `meta` (scale, origin, rotationRad, flipX) the runtime ignores.

**`Buf` (geometry accumulator)** — engine-generic. Five parallel arrays
`pos/idx/nrm/uv/col`; methods `quad/tri/box`, `toMesh(name,scene,mat,withColors)`
→ one `VertexData`/`Mesh`. **One `Buf` per (chunk, material-kind)** ⇒ one draw call
per material per chunk. Per-building `tint` lives in vertex colors, so hundreds of
tinted buildings share one facade material.

**Chunking + culling:** `CHUNK=150`m, `chunkOf(x,z)` with +2000 offset; kinds:
`facade/wall/iron/road/park/sign/blade/phys`. Realized last: `phys`→invisible mesh
+ one static `PhysicsAggregate(MESH,mass:0,friction:0.8)` per chunk; visual kinds →
mesh + material + `freezeWorldMatrix()`. `updateCulling(p)` toggles `setEnabled` by
distance (`CULL_R=290`, `SIGN_CULL_R=210`, +112.5m slop). Physics never culled.

**`buildQuarter(scene): Promise<QuarterResult>`** returns `{root, data,
dynamicProps[], waterMesh, interiors[], interactables[], landmarkMarkers[],
streetCoins[], tramLine[], updateCulling(p), setNight(n)}`.

**Baker `build_map.py`** (deterministic): project lon/lat→m (local equirectangular,
cosine-corrected) → rotate a chosen axis street to +Z → `GAME_SCALE=0.65` (x/z only;
heights 1:1) + x-flip so river is +X → clip to rectangle from boundary streets →
`simplify()` (dedupe+collinear) → `ear_clip()` (buildings/parks/river/land) →
level/front detection → **landmark fuzzy-match** (normalized substring vs curated
alias table, nearest-to-fallback within 220m, else curated fallback latlon). Round
to 1 decimal, compact JSON. `fetch_osm.py` = Overpass client (3 mirrors, backoff),
commits raw responses for reproducibility.

**For OUR map maker:** emit `QuarterData`-shaped JSON directly. Per drawn building:
flat CCW `pts`, `ear_clip(pts)`→`tri`, unique `id`, `lv`, centroid `c`, optional
`f`. Streets = `{name,cls,w,pts}` (cls outside footway/steps/path/cycleway/pedestrian
renders as road). `parks/river/land` = `{pts,tri}`. `shoreline` z-monotonic.
`meta.bounds` encloses all. Author in world units with `scale=1`. **Lift `Buf` +
chunk + cull + `ear_clip`/`simplify`/`poly_area` as a generic module.** The renderer
will consume the editor's JSON unchanged.

---

## C. Player feel (`src/player/`, `src/core/camera.ts|input.ts`, `src/ui/touch.ts`)

**Capsule controller** (radius 0.45, height 1.7, `PhysicsAggregate` CAPSULE,
mass 70, **friction 0**, locked rotation via zero inertia + angular damping 1).
Movement = **read velocity, write velocity** each frame (never forces); horizontal
eased toward target at clamped accel (`GROUND_ACCEL 58`/`AIR_ACCEL 20`); `vy` left
to gravity except jump/swim. Two schemes: keyboard = camera-relative WASD (`facing`
follows travel); touch = tank (`TURN_RATE 2.9`, forward along facing). Analog ramp
walk→jog→run (`WALK 5.4`, `RUN 9.5`, `MIN_WALK 2.0`). Ground = 5 downward rays
(center + 4 edge offsets) requiring `vy<2`. Jump: coyote 0.12 + buffer 0.12,
`JUMP_VEL 9.2`, `DOUBLE 8.2`, variable height (`vy+=5.5*dt` while held), ledge
assist. Swim: buoyancy settles chest at `WATER.surfaceY-0.45`, `SWIM_SPEED 4.2`.
`onLand(impact)`, `groundTravel`→Groove, `movementLocked` for cutscenes.

**Animation SM (`bear.ts`)** — clips idle/walk/run/jump/fall/land/doublejump/
attack/hit/ko/dance/drop/victory/wake/swim. **No blending** (instant stop/start).
Priority ladder swim→fall→run→walk→idle. One-shots resume via
`onAnimationGroupEndObservable.addOnce` (never wall-clock). Watchdog restarts
silently-dropped loops.

**Chase camera (`camera.ts`)** — `ArcRotateCamera`, **`yaw = -alpha - π/2`** (the
documented reflected-sign gotcha). Auto-follow eases alpha toward `-playerFacing-π/2`
with shortest-angle wrap; recenter `snap`; physics-aware zoom (ray shortens radius
at walls); `beta∈[0.6,1.45]`.

**Input (`input.ts`)** — one `InputState` {moveX,moveZ,tank,jumpHeld,jumpPressed,
attack/special/interact/fishbowl/recenter Pressed, camDX,camDY}. `poll()` before
reads, `consume()` after clears edges. (`interactPressed` currently dead.)

**iOS-Safari fixes (CRITICAL — port verbatim with comments):** (1) no anim
blending; (2) **quantize speedRatio** to 0.2 steps, write only on change — the
"limp glide" stuck-pose bug; (3) **fall-pose hysteresis** `airTime>0.18`; (4)
`touch-action:none` + `-webkit-user-select:none` on all controls; (5) **never trust
pointer capture** — track pointer on `window` by id, reset on cancel/blur; (6)
**clamp stick vector to radius** (past rim = full deflection, never a release).

---

## D. Gameplay modules

**`Hittable` (the decoupling seam, in `combat.ts`):**
```ts
export interface Hittable {
  position: Vector3;
  alive: boolean;
  hit(damage: number, impulse: Vector3, ragdoll: boolean): void;
}
```
Combat only knows `Hittable[]` (set `combat.hittables = enemyMgr.hittables`); enemies
implement it. Combat defines the verb, the target defines the reaction.

**Combat:** 3-stage combo (`%3`, stage-0 finisher = 2 dmg + ragdoll), forward-cone
hit test (`CLAW_RANGE 2.4`, `CLAW_ARC 1.2` half-angle), impulse scales with speed +
Fishbowl boost. **Groove special:** meter charged by ground travel
(`GROOVE_RATE 0.008`/m), `startDance()` (2s windup, hyper-armor) → `executeDrop()`
radial shockwave (`RADIUS 8`, ragdoll all, torus VFX, camera shake). Fishbowl =
15s invuln + 1.8× dmg, costs 1 HP. Presentation via `onShake/onShockwave/onClawHit`.

**Enemies (`enemies.ts`):** archetypes frat/pirate/huntress via `STATS`. 7-state FSM
idle/patrol/aggro/telegraph/attack/recover/dead. Global `MAX_ACTIVE 6` aggro cap.
Boid separation steering. Ragdoll on death (free inertia + off-center impulse).
One `AssetContainer` per kind, `instantiateModelsToScene` per enemy (GLB loaded
once, cloned). Manager callbacks `onPlayerHit`/`onEnemyDeath`.

**Collectibles (`collectibles.ts`):** **thin instances** — single `coinBase`
cylinder, all static coins as matrices in one buffer (`thinInstanceSetBuffer`),
N coins = 1 draw call; rebuild on pickup. **KO spill (`spawnBurst`)** = real
physics coin clones (cleared instance buffer + `PhysicsAggregate`), proximity
collect, auto-dispose. Pieces = UV-crops of one collage texture, bob+spin.

**TimeOfDay (`timeofday.ts`):** `hour` eases toward `8 + playMin*0.55 + pieces*0.55`
(clamp ≤21.5). 6 keyframes lerp sun/sky/fog/clearColor + a **`night` 0..1** scalar;
on change >0.01 calls injected `onNight` → `quarter.setNight` (lamps/neon emissive).
Sun direction physically sweeps east→west.

**Streetcar (`streetcar.ts`):** arc-length polyline (`cum[]`, `at(s)`), kinematic
box, ping-pong with end pauses + bell. Publishes `velocity`; the **main loop adds it
to a player standing on the deck** (no parenting). Cleanest drop-in.

---

## E. Liftability ranking (for this game)
1. `Buf`+chunk+cull+`ear_clip` → extract as generic world module (needed for any continent).
2. Event bus + `window.__*` debug surface → already adopted; expand.
3. `Hittable` + combat targeting core → generic.
4. `streetcar.ts`, `timeofday.ts`, thin-instance collectibles → near drop-in.
5. Player feel set (controller+bear+camera+input+touch) → take whole, comments included.
6. Enemy FSM skeleton → reuse pattern, replace STATS/content.

---

## F. Asset pipelines, QA, UI, design contract

**"No Ovals" character pipeline (`tools/character/`):** no character geometry in
JS/TS — everything is Blender via headless `bpy` (`pip install bpy`), exported to
glTF. `bearlib.py` is the reusable kit: `Station(center,rx,rz,bottom)` elliptical
cross-sections bridged into tubes by `add_tube()` using **parallel-transport
frames** (minimally rotate the previous ring's frame onto the new direction so
tubes never flip/pinch on curves) — that's the whole trick. Also `add_cone/add_box/
add_disc_ear/add_sphere`. Author parts as tagged station chains, overlap deeply,
apply **Subsurf** → organic surface, never a primitive. `joshua.py`/`humanoid.py`
are worked examples (humanoid = one rig, costume variants by proportion params).
**Bone sign-convention cheat sheet (verbatim, port this):**
```
- vertical bones (hips/spine/neck/head): rotX+ pitches forward, rotY yaws, rotZ tilts
- thigh/upper_arm: rotX+ swings the limb forward
- shin: rotX- bends the knee back; forearm: rotX+ bends the elbow
- eye blink = bone scale (1,1,0.1)
```
`joshua_anims.py` keyframes 16 clips @24fps → NLA strips for glTF. `build_joshua.py`
exports; **`smoke_test.py` runs first** in a new env (verifies headless bpy can do
the 7 pipeline ops → prints `SMOKE OK`). `fix_island_weights()` hard-binds floating
islands (eyes/bowtie/ears) to their bone by position test.

**Audio (`audio.ts`):** iOS fix = lazy `AudioContext` + `resume()` re-bound to FIVE
interaction events (NOT once) + `visibilitychange` (iOS suspends on backgrounding).
SFX synthesized inline (zero files); 2s crossfade between zone tracks.
`make_music.py` renders **public-domain** compositions (fluidsynth + FluidR3_GM →
MP3), seamless-loop trick = fold release tail onto loop start; writes a provenance
`manifest.json`. `make_shriek.py` = espeak-ng + NumPy DSP.

**Textures (`make_textures.py`, PIL, seeded):** ship a script not an artist —
procedural façade atlas (4×3 tiles), neon/blade signs, road+sidewalk. Committed PNGs.

**QA — executable rubric (`qa/playwright/rubric.spec.ts`, 16 gates):** boots with 0
console errors; all anim clips exported; no fall-throughs at sampled points;
landmark placement; enterable interiors on solid floors; time advances; swimmable
water; shockwave ragdolls; fishbowl rules; KO coin spill; full-loop playthrough;
**skeleton visibly animates (no limp glide)**; camera auto-follows; kill-plane
recovery; Groove fills in time; **draw calls ≤120** + fps>0. Calibrated for
software-GL CI (~4fps): checks **behavior & budgets, not absolute fps**.
`qa/shot.mjs` = headless Chromium (swiftshader) → wait `__gameReady` → replay JSON
action script (key/wait/teleport/eval) → dump `__telemetry` → screenshot → nonzero
on errors. **The `window.__*` surface is what makes all of this possible.**

**UI (DOM overlays, not in-engine GUI):** `hud.ts` reactive to GameState events
(health as a drooping bow-tie, coins/ticket, Groove bar, pieces, message line);
`minimap.ts` prerenders base map once, blits rotated around player each frame +
rim compass; `assembly.ts` collage minigame + `showEndCard()` (stats, style rating,
**ODbL attribution in footer**).

**`PLAN.md` design contract — the discipline to adopt:** a single living doc that
IS the definition of done. Pillars, tech, the No-Ovals doctrine, moveset, level
beats + economy, and a **§9 quality rubric** where every claim is paired with a
verification method (10 gate groups A–J incl. a literal "comedy floor"), encoded as
executable Playwright gates, with milestones committing screenshot+telemetry
evidence and an **honest scorecard** (marks partial passes, not all-green). Economy
rule worth stealing: the win condition (busking to $500) is **always reachable** —
collectible count never hard-blocks completion; it only sets a Bronze/Silver/Gold
rating.

**Adopt for MB5 from day one:** the `window.__*` surface + a behavior/budget rubric,
the `bearlib` parallel-transport kit + `smoke_test.py`, the PLAN-as-contract
discipline with paired verification methods, and the provenance discipline for any
shipped audio/textures.

