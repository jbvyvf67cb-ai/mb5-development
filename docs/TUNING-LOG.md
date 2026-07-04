# Movement fluidity tuning loop

An iterative pass over character movement: running, jumping, special moves,
and how actions flow one into another. **Protocol:** each iteration is
probe → tweak → headless verify → one commit (`fluidity(n): …`) pushed
immediately — every iteration is a durable checkpoint. **To resume in a new
session:** read this file, take the top item from Backlog, keep the loop
going, and keep this file updated in the same commit as the change.

## Done

1. **Action buffering + cancel windows + intent queueing.** Dash/attack/
   kick/power presses buffer 0.16 s (jump keeps 0.12 s); a press made DURING
   a move becomes a queued intent (0.6 s) that survives to the cancel window.
   Once a move's hit is out (struck) or it's past 60%, a buffered jump or
   dash ends the recovery — kick→dash and kick→jump verified flowing;
   slam phases stay committed. Buffered jumps also fire air moves on release
   (double jump out of a spin attack).
2. **Momentum carry above run speed.** While the stick roughly agrees with
   the velocity, speed above run speed steers (heading lerp dt*3) and bleeds
   gently (5 m/s² air, 12 m/s² ground) instead of braking at full accel.
   Verified: dash-jump launches at 31 m/s and lands at 22 across a full arc.
   Releasing the stick or reversing still brakes hard.
3. **Apex float + reversal bite + early glide catch.** Fall-gravity extra
   ramps in (35% at the apex → full by vy −3) so the top of the arc hangs an
   aiming beat; reversal decel factor 1.5 → 2.2 (180s bite); fallHold moves
   engage at vy < −1.2 instead of the full fall cap, so hold-Space after a
   double jump / spin attack catches the glide almost immediately.
4. **Combo reliability + carry facing.** Chain window widened (last 75% of
   the finishing phase); a buffered same-slot press now counts as chain
   intent at phase end, so presses landing frame-exact on a transition
   can't restart the combo — J-J-J = punchCombo→punch2→punch3 verified.
   While carrying overspeed, the body faces the velocity heading (stick
   leads, body follows) — no more high-speed moonwalk.
5. **Juggle refresh.** onStrike returns hit count; a connected AIR hit
   refreshes the whole air kit and pops the player up (vy ≥ 4.5) — homing
   strike → hit → double jump → dive kick → hit → … strings flow.
6. **Pound→jump flow + gait cadence cap.** Slams clear stale jump intent at
   move START (commit point) instead of at landing, so a jump pressed during
   the slam fires straight out of the touchdown (verified: slam −34 →
   land → jump). Leg cadence caps at 1.3× run speed so overspeed carry
   reads as a powerful stride, not a leg blur.

## Backlog (ordered by fluidity impact)

6. **Landing→run polish.** Verify no speed dip on run-through landings;
   stride phase continuity on touchdown.
7. **Cancel matrix extension.** Largely covered by intent queueing (attack
   buffered during a dash fires the frame the dash ends; J during a glide
   fires the air attack immediately).

## Verification harness notes

- qa/shot.mjs + `window.__player` probes; headless physics steps 1/60 s per
  rendered frame at ~10 fps, so wall-clock displacement reads ~6× slow —
  assert on velocities/state flags, not displacement-over-real-time.
- Flat ground for deterministic probes: demo level, `__tpPlayer(0, 4.2, -30)`
  after a long settle (giants tunnel and take ~1.5 s to depenetrate).
- `window.__player["active"]` exposes the running MoveSpec (key/phase).
