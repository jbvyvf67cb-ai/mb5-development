# Movement fluidity tuning loop

An iterative pass over character movement: running, jumping, special moves,
and how actions flow one into another. **Protocol:** each iteration is
probe → tweak → headless verify → one commit (`fluidity(n): …`) pushed
immediately — every iteration is a durable checkpoint. **To resume in a new
session:** read this file, take the top item from Backlog, keep the loop
going, and keep this file updated in the same commit as the change.

## Done

*(nothing yet — loop starting)*

## Backlog (ordered by fluidity impact)

1. **Action buffering + cancel windows.** Buffer dash/attack/kick/power
   presses ~0.16 s (like the jump buffer) so inputs just before a state
   change still fire (press J right before landing → ground attack on
   touchdown). Let a buffered jump or dash end a move's recovery once its
   hit is out (struck) or it's past ~60% — actions chain instead of waiting
   out full durations. Slam phases (until:"ground") stay committed.
2. **Momentum carry above run speed.** Dash-jumps, boost pads, and boost
   moves currently bleed excess speed at full accel rates (a boost pad's
   24 m/s dies in ~0.15 s of held W). When moving faster than run speed with
   input roughly aligned: steer the heading, bleed the excess slowly
   (~6 m/s² air, ~12 m/s² ground) — Sonic-style flow.
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
