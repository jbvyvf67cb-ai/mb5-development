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

## Backlog (ordered by fluidity impact)

3. **Apex float.** Soften the extra fall gravity in the |vy| < ~2 window so
   jumps hang a beat at the top (better target adjustment, better feel).
4. **Snappier reversals.** Raise the reversing decel factor so 180° turns
   bite harder at speed.
5. **Earlier glide catch + move→glide integration.** Engage fallHold moves
   at vy < ~-1.2 instead of below the full vyMin, so holding Space after a
   spin attack / double jump catches into the glide almost immediately.
6. **Wider chain windows.** Combo chain press window from last 40% → last
   55% of the phase; verify punch1→2→3 lands reliably at 60 fps timing.
7. **Landing→run polish.** Verify no speed dip on run-through landings;
   stride phase continuity on touchdown.
8. **Cancel matrix extension.** Kick/attack cancels out of dashes
   (dash → attack flows), spin-attack out of glide without releasing Space.

## Verification harness notes

- qa/shot.mjs + `window.__player` probes; headless physics steps 1/60 s per
  rendered frame at ~10 fps, so wall-clock displacement reads ~6× slow —
  assert on velocities/state flags, not displacement-over-real-time.
- Flat ground for deterministic probes: demo level, `__tpPlayer(0, 4.2, -30)`
  after a long settle (giants tunnel and take ~1.5 s to depenetrate).
- `window.__player["active"]` exposes the running MoveSpec (key/phase).
