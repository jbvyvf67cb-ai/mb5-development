# Characters — format & designer

Characters are sprite-based and fully data-driven: a `CharacterData` JSON
describes body morphs, colors, stats, and equipped special moves. The pixel
sprite is drawn **procedurally** from those numbers (no sprite sheets), so any
slider change reshapes every animation frame consistently, and the same data
drives the physics capsule and movement feel in Play mode.

Open the designer from the top bar: **Characters**.

## The format

```jsonc
{
  "id": "joshua",
  "name": "Joshua",
  "body": {
    "height": 1.0,   // 0.75..1.35 — also scales the physics capsule
    "width": 1.0,    // 0.75..1.35
    "weight": 0.55,  // 0..1 — belly/limbs; raises mass, softens acceleration
    "head": 1.0,     // 0.8..1.3
    "ears": 1.0      // 0.4..1.8
  },
  "colors": {          // RGB 0..1
    "fur":    [0.45, 0.30, 0.18],
    "muzzle": [0.78, 0.62, 0.45],
    "belly":  [0.62, 0.46, 0.30],
    "accent": [0.85, 0.20, 0.25]   // accessory color
  },
  "accessory": "bowtie",           // none | bowtie | cap | scarf
  "stats": {           // all 1..10
    "speed": 6,        // → run speed 6.25..13 m/s
    "jump": 6,         // → jump velocity 7.4..11.9 m/s
    "attack": 6,       // stored for combat (coming later)
    "defense": 6
  },
  "moves": ["doubleJump", "dash", "groundPound"]
}
```

`deriveMovement()` in `src/character/schema.ts` is the single source of truth
for how stats+body become movement numbers (run/jump/dash speed, acceleration,
mass, capsule size). The designer shows the derived numbers live.

## Special moves

| Move | Control | Effect |
| --- | --- | --- |
| Double Jump | Space (in air) | one extra jump |
| Dash | Shift | 0.16 s burst at 2.2× run speed, hovers; once per airtime |
| Glide | hold Space while falling | fall capped at −2.4 m/s |
| Ground Pound | C (in air) | slam at −26 m/s, shockwave ring + pop-back |
| Wall Jump | Space against a wall | kick away; refreshes double jump + air dash |

Equip any subset — the Play HUD only shows the controls the character owns.

## Presets & persistence

Built-ins: **Joshua** (the bear — balanced, bowtie), **Scout** (small/fast,
glide + wall jump), **Boulder** (heavy tank, pound + dash). Presets fork
automatically when edited; user characters autosave to the browser
(`localStorage`), and can be exported/imported as JSON. **Use in Play** sets
the active character that Play mode spawns.

## The sprite

Drawn front-facing at 48×60 logical pixels (`src/character/sprite.ts`), poses:
idle ×2, run ×4, jump, fall, dash, pound, glide. In-world it renders as a
Y-billboarded plane with nearest-neighbor upscaling (Paper-Mario style),
mirrored when running screen-left.
