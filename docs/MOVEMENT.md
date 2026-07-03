# Movement & game-feel design (Sonic Dream Team as the bar)

Grounded in written/frame analysis of Sonic Dream Team (Sega Hardlight, 2023):
reviewers consistently credit its feel to **simple, snappy controls where you
always land where you intend**, levels built for a **flow state**
(rollercoaster/half-pipe layouts), a **boost** with a gauge that doubles as an
attack, **air dash** for commitment correction, per-character traversal
identities (fly vs glide+climb), and **equipable "Powers"** (stomp, super
glide, wall boost) layered onto a shared base kit.

## Goals (each paired with how we meet it)

1. **Land where you aim.** Heavy fall gravity + jump-cut (asymmetric arcs),
   terminal velocity, a blob shadow under the player at all times, and a
   camera that never clips into terrain. *Never trade readability for style.*
2. **Flow is preserved, not reset.** Moves that end should return you to run
   speed, not zero: rolls keep momentum, landings can auto-roll (passive),
   skids are stylish but brief. Springs/boosts refresh air moves.
3. **Commitment with an out.** Dashes and dives commit (steering damped), but
   an air option (air dash / double jump / blink) is always one press away —
   the Dream Team air-dash lesson.
4. **A shared base kit + equipable identity.** Everyone runs, jumps, punches,
   kicks. Traversal identity comes from the **loadout**: one move per trigger
   slot (like Dream Team's fly/glide split and Powers), so any generated
   character slots into any move seamlessly.
5. **Animation is physical, generic, and secondary-motion-rich.** Every move
   animates the same semantic rig channels (shoulders, elbows, hips, knees,
   torso pitch/yaw, body spin, squash), so a move authored once passes the eye
   test on every body. Accessories are *live*: scarves trail and flutter with
   speed, wings flap when airborne, ears flop with vertical velocity (and can
   helicopter), halos lag. Nothing on the body is decorative-only.
6. **Impact reads.** Strikes have windup → contact → recover envelopes,
   contact frames spawn bursts, big hits shockwave, victims fly. Squash on
   land, stretch on rise.
7. **Scale is felt.** Character size now maps aggressively to the collider,
   camera distance, and mass — a giant should tower, lumber, and hit like a
   landslide; a runt should be quick and close-framed.

## The move system (how 50+ moves stay fluid on any character)

A move is **data**, not code: `MoveSpec = trigger slot + physics phases +
animation keyframes over the generic channel set (+ strike windows, FX)`.
The controller runs one interpreter for all of them; the rig plays the same
channel targets on every body (blocky or rounded, any proportions — joints
are placed proportionally, so poses read the same). Adding a character never
requires move work; adding a move never requires character work.

**Trigger slots** (one equipped move each): Space-in-air, hold-Space-falling,
Shift-ground, Shift-air, Space-at-wall, C-air, C-ground, J-ground, J-air,
K-ground, K-air, plus always-on passives. The designer picks per-slot; the
HUD shows exactly the equipped kit.

Sources: [Digital Trends review](https://www.digitaltrends.com/gaming/sonic-dream-team-review/),
[Sonic Wiki — Dream Team](https://sonic.fandom.com/wiki/Sonic_Dream_Team),
[Pocket Tactics — Powers update](https://www.pockettactics.com/sonic-dream-team/powers),
[Sonic Stadium review](https://www.sonicstadium.org/articles/features/sonic-dream-team/).
