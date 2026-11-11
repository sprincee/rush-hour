# An app order waited 30 extra seconds during a barista rollout

**Date:** 2026-11-11
**Impact:** Local only. One app order in a recorded lesson 3.1 rush waited 36.3 shop minutes instead of about 20, so the calibration test failed. The order was still made.

## What happened
`scripts/rush.ps1 -Rush lesson-3-1 -Baristas 3 -Rule walkin -Record` changed the barista rule and then the barista count, and the rush started a few seconds later. In the recording, order #9 (an app order) was placed 3.3 seconds into the rush and only started at 37.1 seconds. The game said its longest app wait should be 19.8 shop minutes. The real one was 36.3.

The three other recordings matched the game to within 0.3 minutes, so the problem was specific to this run.

## Cause (most likely)
- The order sat for 33.75 real seconds before a barista started it. That's the 30-second abandoned-order timeout plus up to 5 seconds until a barista's next check. So the order was handed to a barista that never made it, and another barista rescued it.
- The script ran `kubectl set env` (which starts a rollout, replacing every barista Pod) and then `kubectl scale` straight after. Scaling in the middle of a rollout makes Kubernetes spread the replicas across the old and new versions, so a short-lived old-version barista was created and then removed.
- Afterwards, Redis still listed a consumer named `barista-cdcdd46c4-x4sc7`, from the old version, that never showed up as a running Pod. A consumer only exists if it read from the stream, so this Pod took at least one ticket.

We couldn't confirm exactly why that barista didn't finish the drink, because its Pod and logs were gone by the time we looked. Repeating the same change once more didn't reproduce the problem, which fits a race in Pod timing.

## Fix
`rush.ps1` now makes one change at a time: scale first, wait, then change the rule, wait. Each wait also lasts until old Pods have actually exited, because `kubectl rollout status` can finish while old Pods are still shutting down. After the fix, the same sequence (2 baristas oldest-first, then 3 walk-ins-first) recorded a 3.1 rush that matches the game: longest app wait 19.9 real against 19.8 in the game.

## Takeaways
- Calibration paid off. Without it, a rush that looked fine (every order made, `PASSED`) would have hidden a 16-minute delay for one customer.
- Rollouts move traffic between old and new versions. Changing two settings at once during a rollout makes the in-between state harder to predict.
- Redis keeps consumer records for workers that are gone. That's harmless for delivery, but they're a useful clue. Cleaning them up is a possible improvement for lesson 11 (health checks).
- An order taken by a worker that disappears waits the full abandoned-order timeout. That's the same trade-off as the barista-kill postmortem, seen from a new angle.
