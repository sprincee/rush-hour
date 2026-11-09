# Barista killed mid-drink (on purpose)

**Date:** 2026-11-03
**Impact:** Local test only. One order took 38.9 seconds instead of about 3. No orders were lost.

## What happened
We force-deleted a barista Pod while it was making a latte, to test crash recovery.

## Timeline
| Time after kill | What happened |
|---|---|
| 0s | The Pod was force-deleted just after the drink started, leaving too little time to finish it |
| 8s | The order still showed `making` under the dead barista, and Redis listed it as pending |
| About 35s | Another barista reclaimed the order (delivery 2) |
| 38.9s | The order was marked `ready` by the new barista |

## Why recovery took about 39 seconds
- Up to about 30 seconds waiting for the order to count as abandoned. Redis can't tell a dead barista from a slow one, so this timeout has to be longer than any drink.
- Up to 5 seconds until a barista's next check for abandoned orders.
- 3 seconds to make the drink.

## What worked
- The order wasn't lost, because Redis keeps it as pending until a barista confirms it's done.
- By comparison, a normal shutdown finished the drink, and the Pod was gone in 3.5 seconds.

## Known gaps
- A crashed barista's name stays in the Redis consumer group. It's harmless and small, and a Redis restart clears it. Normal shutdowns remove the name.
- The customer sees `making` for the whole recovery period, under a barista who no longer exists. Lesson 12 is a natural place to revisit this.
- Baristas have no liveness probe yet, so one that hangs without crashing wouldn't be restarted. Its order would still be reclaimed. Lesson 11 should cover this.

## Correction
A force delete isn't an instant kill. In a later rush using `-KillBarista`, no order needed rescuing, most likely because that barista finished its drink before it stopped. To test a rescue reliably, delete the Pod right after an order shows `making`.

## Takeaways
- Choosing the abandoned-order timeout is a trade-off. Too short and working baristas lose their orders, which duplicates drinks. Too long and customers wait longer after a crash.
- Reclaiming means a drink can occasionally be made twice, which sets up lesson 9.
