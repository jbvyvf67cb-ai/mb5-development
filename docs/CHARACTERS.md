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
    "height": 1.0,   // 0.75..1.6 — also scales the physics capsule (1.6 = giant)
    "width": 1.0,    // 0.75..1.6
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
  "moves": ["doubleJump", "glide", "airDash", "homingStrike", "rollLanding"]
}
```

`deriveMovement()` in `src/character/schema.ts` is the single source of truth
for how stats+body become movement numbers (run/jump/dash speed, acceleration,
mass, capsule size). The designer shows the derived numbers live. Size is
FELT: `height` maps aggressively to the capsule (0.85 → 1.55 m, 1.6 → 3.2 m),
and the chase camera frames giants wide and runts close.

## The move system — 50+ moves, one interpreter

A move is **data, not code** (`src/character/moves.ts`): a `MoveSpec` = a
trigger **slot** + physics **phases** (forward bursts, vertical holds,
until-ground slams, blinks, homing, hover, spins, strike windows, FX) +
animation keyframes over the rig's **generic channel set** (shoulders, elbows,
hips, knees, torso pitch/yaw, body spin, squash). One interpreter in the
controller executes every move; one channel player in the rig animates every
move. Joints are placed proportionally on every body, so a move authored once
passes the eye test on every character — hand-made or AI-generated, blocky or
rounded, giant or runt.

**Slots** (equip one move each; the designer shows a dropdown per slot):

| Slot | Trigger | Catalog |
| --- | --- | --- |
| jumpAir | Space (in air) | Double Jump, Triple Jump, Rocket Hop, Blink Step, Wing Flaps, Moon Flip |
| fallHold | hold Space (falling) | Glide, Parachute, Dive Glider, Helicopter Ears, Cape Float, Balloon Belly |
| dashGround | Shift | Dash, Spin Roll, Power Slide, Backstep, Charge Ram, Boost |
| dashAir | Shift (in air) | Air Dash, Dive Bomb, Corkscrew, Air Brake |
| wall | Space (at a wall) | Wall Jump, Wall Cling, Wall Run |
| powerAir | C (in air) | Ground Pound, Meteor Slam, Bounce Stomp, Drill Dive, Belly Flop, Cannonball |
| powerGround | C | Shock Stomp, War Roar, Dance, Flex, Victory Flip |
| attackGround | J | Punch Combo (3-hit chain), Hammer Fists, Rapid Jabs, Spinning Backfist, Shoulder Bash |
| attackAir | J (in air) | Spin Attack, Sky Uppercut, Dive Elbow, Homing Strike |
| kickGround | K | Roundhouse, Sweep Kick, Flip Kick, Axe Kick, Breakdance |
| kickAir | K (in air) | Dive Kick, Hurricane Kick, Flying Knee, Stomp Kick |
| passive | automatic | Roll Landing (hard landings keep momentum), Stylish Skid |

Empty attack/kick slots fall back to the base kit (Punch Combo / Roundhouse /
Dive Kick) — everyone can fight. Wall contact and springs refresh air moves.
Knockback scales with the **attack** stat (`strikePower = 6 + attack × 1.5`);
strikes shove dynamic props (crates and balls are physical during a run) and
poof enemy markers for +2 coins. The Play HUD lists the exact resolved kit.

## Presets & persistence

Built-ins: **Joshua** (the 3.2 m bear — huge, slow, devastating: ground pound,
war roar, hammer fists, sweep kick), **Prez TT** (small/fast rounded runner:
double jump, glide, wall jump, air dash, boost, homing strike, roll + skid
passives), **Boulder** (heavy tank: meteor slam, charge ram, shock stomp,
shoulder bash, axe kick). Presets fork
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
spread, dashes lean, glides T-pose. Move animations arrive as generic channel
targets (see the move system above) and blend over the base gait; body spins
(flips, corkscrews, cyclones) ease home to the nearest full turn when
interrupted — never a snap. Landing squashes the body; rising stretches it.
The rig is scaled to the physics capsule so the visual body is the hitbox,
and the same rig serves the designer preview, Test Drive, and in-level play.

**Accessories are alive** (secondary motion, not decoration): the **scarf**
is a two-segment tail that trails, floats, and flutters with speed — it
streams while gliding and dashing; **wings** flap when airborne and spread
wide in a glide; **ears** flop against vertical motion, bounce at a jog, and
become spinning rotor blades for Helicopter Ears; the **halo** bobs on its
own time and tips against motion. Wardrobe: bow tie, cap, scarf, crown,
glasses, halo (glows), horns, backpack, wings — all colored by the accessory
color, working in both styles.
