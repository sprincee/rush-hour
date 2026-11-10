# The game and its tests disagreed about level 2.2

**Date:** 2026-11-10
**Impact:** Level 2.2 of the lesson 2 mockup was impossible to pass. The owner got stuck there, and a later level would have failed for designs the tests said passed.

## What happened
With 3 baristas and the ticket rail, the owner's longest wait was about 35 minutes against a 35-minute goal, and the level failed. My engine-only check gave 34.4 minutes, which passes. I concluded the level was tuned too tightly but had no bug, and raised the goal to 40 minutes.

That conclusion was wrong. The animated game really did get different results from the engine.

## Cause
The engine uses one seeded random sequence to decide who arrives when and what they order. The game also used that same sequence to pick each customer's shirt, skin, hair, and walking rhythm: 4 extra numbers per customer. That shifted every later arrival.

| Design | Engine only | In the game |
|---|---|---|
| 2.2: 3 baristas + rail | 34.4 min | 35.3 min |
| 2.3: 3 baristas, rail of 20 | 19.7 min (pass) | 20.6 min (fail) |

My checks never included the drawing code, so they couldn't see it. I had even tested whether the animation's time steps changed the result. They didn't, which made me more confident in the wrong conclusion.

## Fix
- Customers' looks now get their own random sequence, so drawing them can never change the rush. The game and the engine match exactly.
- A regression test (`drawing customers' looks never changes the rush` in `web/test/engine.test.mjs`) runs the engine with and without a look function and requires identical results.
- The 40-minute goal stays, so a correct design passes comfortably.

## Takeaways
- When a user reports something the tests say can't happen, test the same path the user took, not a simplified one.
- Anything decorative must not share state with the simulation it decorates.
- Showing one decimal instead of rounding would have made the 34.4 versus 35.3 gap visible sooner.
