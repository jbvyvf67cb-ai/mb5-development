# Characters — format & designer

Characters are fully data-driven: a `CharacterData` JSON describes body
morphs, colors, stats, and equipped special moves. The character's **3D body
is built procedurally** from those numbers (`src/character/rig.ts` — a blocky
jointed rig with code-driven animations, no skeletal assets), so any slider
change reshapes the model and every animation consistently, and the same data
drives the physics capsule and movement feel in Play mode. AI-generated
characters (text or image) land on the same parameters, which is what keeps
their movement smooth and identical to hand-made ones.

Open the designer from the top bar: **Characters** (a real tab — switch back
and forth with **Build**). The character stands on a live 3D stage; pose chips
preview each animation, and **🧪 Test Drive** drops the real player controller
onto the same stage so you can feel the speed, jumps, and moves before using
the character in a level.

## The format

```jsonc
{
  "id": "joshua",
  "name": "Joshua",
  "style": "blocky",   // blocky (voxel) | rounded (organic spheres/capsules)
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
  "accessory": "bowtie",           // none | bowtie | cap | scarf | crown | glasses | halo | horns | backpack | wings
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

## AI generation (text and image)

The designer's ✨ Assist box takes a description ("a tall lanky purple rabbit,
fast but fragile, can glide") and/or an attached **image** (📷 — a drawing, a
photo, a reference character). Claude maps it onto the parametric rig —
proportions → morphs, palette → the four colors, closest accessory, implied
stats and moves — then you tune the result with the sliders. Needs the
browser-local Anthropic API key (same panel).

## The 3D rig

`src/character/rig.ts` builds a real (procedural) skeleton: **two-segment
arms with elbows and legs with knees**, a spin node for flips, and squash &
stretch — in one of two **styles**: `blocky` (voxel boxes) or `rounded`
(spheres + capsules, organic Fall-Guys energy). Animation is code-driven and
physical: the run gait is **stride-synced to actual velocity** (feet don't
slide), knees flex on the recovery swing, elbows pump; jumps tuck, falls
spread, dashes lean, glides T-pose. The **double jump somersaults**, and the
**ground pound is a real move** — a hang-time front flip windup, then the
slam, with a shockwave + dust burst on impact. Landing squashes the body;
rising stretches it. The rig is scaled to the physics capsule so the visual
body is the hitbox, and the same rig serves the designer preview, Test Drive,
and in-level play.

**Accessories**: bow tie, cap, scarf, crown, glasses, halo (glows), horns,
backpack, wings — all colored by the accessory color, working in both styles.
