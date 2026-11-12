# Level 4.3 passed by luck

**Date:** 2026-11-12
**Impact:** Level 4.3 told players that "walk-ins first + batching" passes. On the real cluster that design passed one day and failed the next. No real users; caught by calibration before launch.

## What happened
While re-recording every rush for lesson 1, the 4.3 recording (3 baristas, walk-ins first, batching) failed calibration. The longest app wait was 21.2 minutes on the cluster against 7.7 in the game. The day before, the same design had matched (7.8 against 7.7).

## Cause
The real cluster runs about 0.1 to 0.2 shop minutes (a few real milliseconds) behind the game, from network and polling delays. At minute 15.7:

- **In the game,** a barista came free just *before* walk-in #26 was ordered, saw an empty walk-in rail, and took app order #21.
- **On the cluster,** the barista came free just *after* #26, so "walk-ins first" sent them to #26. A steady stream of walk-ins followed, and #21 waited 16 more minutes.

Strict priority makes a low-priority order's wait depend on split-second timing. That's the starvation lesson 3 teaches, but the level had been tuned on one exact timeline, so the game's "pass" was luck. Checking 60 slightly different timelines found walk-ins first + batching passed only 78% of the time with ±6 shop seconds of noise, and 27% with ±15.

## Fix
- **A robustness test** (`web/test/robustness.test.mjs`) nudges every arrival by up to 12 shop seconds over 16 runs. Each design a level treats as a clear pass or fail must keep that verdict in at least 95% of them. Every other level already did.
- **Level 4.3 was retuned** (52 customers instead of 48) so that walk-ins first + batching clearly fails (app orders wait 24.4 minutes), and batching with a fair rule clearly passes (oldest first, or every 2nd to 4th drink from the app). The lesson is now that you need both lesson 3 and lesson 4: batching and fair scheduling.
- **Recordings are fingerprinted per rush,** so retuning one rush no longer invalidates the others.

## Takeaways
- A deterministic simulation can hide fragility. One timeline is a sample, not a proof. Test the verdict across small variations, the way real systems face jitter.
- Calibration against the real system caught what the game's own tests couldn't.
- Strict priority isn't only unfair, it's unpredictable. That's now part of the 4.3 concept card.
