# Rush Hour design

Rush Hour is a free browser game that teaches system design through a coffee shop. Learners play in a simulator with no waiting line. A real Kubernetes system backs it up with live and recorded runs, which also makes it a hands-on project in Kubernetes, autoscaling, queues, and observability.

Status: design agreed on 2026-11-03. Timings and retry limits are starting values and can change.

## Decisions

| Decision | Choice | Why |
|---|---|---|
| Play | Browser simulator | Every player gets an instant, private shop, so launch traffic never creates a line |
| Cluster's role | Real runs, panels, and the check on the simulator | Keeps the Kubernetes work real without tying gameplay to one shared system |
| Game structure | One shop with 12 levers | One simulator to build and test, not 12 mini-games |
| The line | Redis Streams | Built-in crash recovery, batched reads, and direct KEDA support |

## Two modes

- **Play:** runs entirely in the browser, written in plain JavaScript with no framework or build step. A static site can serve it to any number of players.
- **Run it for real:** sends a rush with a fixed size and duration through the rate-limited Rush API. Players choose only from presets and never send traffic directly to the cluster. If a rush is already running, visitors watch it. If the cluster is unavailable, they see a recorded run.

Both modes read one shared settings file. A calibration test runs the same rush in both and fails if their results drift too far apart.

## Lesson format

Each lesson is 2-3 short levels. The player runs the morning shift: they design the system first, then run the rush, the way real systems should be designed before traffic arrives. Each lesson works on its own. The working mockup of lesson 2 is `lessons/mockups/order-line.html`.

Every level follows the same four phases:

1. **Brief:** the situation, the goals, and a budget. Goals are SLOs in disguise, like "nobody waits more than 20 minutes".
2. **Design:** pick the parts. Each part shows its coffee name and its system name, like "Ticket rail · Queue". Parts from later lessons appear as locked cards.
3. **Run:** the design is locked while the rush plays. The player can pause and change speed, but not redesign.
4. **Debrief:** which goals were met, the numbers in both languages (served = 200 OK, turned away = 503, longest wait = latency, workers busy = utilization), what happened and why, and a system design concept card.

The **X-ray** toggle fades the shop into the same moment drawn as a system: the register becomes the API server, the rail becomes the queue, the baristas become workers, and pickup becomes the response. Every customer becomes a colored dot (a request), with "202", "503" and "200" pop-ups as events happen. The X-ray is on during design, so the player watches their architecture change.

Levels are tuned with the engine so each one forces a real trade-off, with comfortable margins so a correct design clearly passes.

### Lesson 2 levels

| Level | Goal | Concept |
|---|---|---|
| 2.1 Nobody walks out | Serve all 50 within $40 | Queue: without one, even 4 baristas serve only 16 |
| 2.2 Too long a wait | Serve everyone, nobody waits over 40 min, $60 | Throughput: a queue holds work, only workers do it (3 baristas: 34.4 min) |
| 2.3 Know when to say no | Nobody waits over 20 min, turn away 25 or fewer, $60 | Bounded queue: with 3 baristas, rail sizes 13-20 pass |

### Lesson 3 levels

App orders print on their own printer, so there are two rails (two queues). Walk-ins are standing at the counter, so they get the tighter goal: 15 minutes, against 30 for app orders, which customers place ahead. This follows the real shop: first come, first served normally, but in-store customers first during a big rush. The goals stay the same across the lesson while the traffic changes. Budget: $60, so 3 baristas (4 cost $74).

| Level | Rush | Concept | Tuning (3 baristas, walk-in / app longest wait) |
|---|---|---|---|
| 3.1 Two printers | 36 customers over 15 min, 40% app | Priority queue: walk-ins first | Oldest first 18.0 / 17.7 fails; walk-ins first 7.1 / 19.8 passes; app first 19.0 / 5.1 fails |
| 3.2 The app takes off | 54 customers over 30 min, 35% app | Starvation and fair share: every Nth drink from the app | Walk-ins first 6.5 / 32.2 (app orders starve); every 5th or 6th from the app passes clearly; every 2nd or 3rd fails walk-ins |

A third level with a dedicated app barista (a separate worker pool, or bulkhead) was tried and dropped. With 3 baristas, one dedicated barista gives the app rail about the same share as "every 3rd drink", so it can't clearly beat fair share. Dedicated pools matter for isolating failures, which fits lesson 12.

On the real cluster, each channel gets its own Redis stream (`line:walkin`, `line:mobile`), and baristas follow the same rule as the game. Each barista keeps its own count for fair share, exactly as the engine does.

### Lesson 4 levels

From the real shop: one latte takes 2 minutes and two batched take 2.5, so a batch takes 1.25x one latte (`config.batch.prepFactor`). The game keeps lattes at 3 minutes so lessons 2 and 3 stay tuned, which makes a batch 3.75 minutes. Cappuccinos never share a pitcher, and drip needs no milk. A barista with a latte ticket grabs the oldest other latte waiting anywhere, on either rail and even past a cappuccino, and makes both. Without that skip-ahead, levels 4.1 and 4.3 stop being winnable.

| Level | Rush | Concept | Tuning |
|---|---|---|---|
| 4.1 Steam for two | 28 over 15 min, 70% lattes, 2 baristas ($40) | Batching | No batching 25.6 min longest wait (goal 20); batching 15.8 |
| 4.2 Should you wait for a second latte? | 16 over 30 min, 70% lattes, crew fixed at 2 | Batch window (Kafka's `linger.ms`) | Goals: 8 min and 9 pitchers. Windows of 2-4 min pass; 0-1 use 11-13 pitchers; 5-6 make waits 9-10 min |
| 4.3 The app rush | 48 over 30 min, 35% app, 70% lattes, 3 baristas ($60) | Do less work, not just reorder it (builds on lesson 3) | Goals: walk-ins 15, app orders 10 (ready on arrival). Every lesson 3 rule fails without batching; with batching every rule passes |

Two things found while tuning: one barista batches naturally because tickets pile up (which is why 4.2 fixes the crew at 2), and in a busy shop a batch window only adds waiting (4.1: 15.8 to 18.8 minutes).

### Ideas for later lessons

- **Lesson 4, batching:** steam milk for 2-3 drinks from one pitcher, so each drink costs less time and money. The first drink waits for the batch.
- **Load balancing:** a second cashier opens when the line reaches the door.

## Lessons

### A: The flow

| # | Concept | At the bar | The player | On the cluster | Skills built |
|---|---|---|---|---|---|
| 1 | Async vs sync | Cashier makes each drink while the line waits, vs. calling names | Switches to calling names | Slow response vs. instant `202 Accepted` | Deployments, Services, API design |
| 2 | Queue | Tickets pile up, and baristas pull at their own pace | Survives a rush with and without a line | Queue length rises and falls | Redis, in-cluster networking |
| 3 | Priority queues | Mobile vs. walk-ins | Chooses who goes first, and risks walk-ins giving up | Wait time per order type | PromQL, percentiles |
| 4 | Batching | Steaming milk for several lattes | Sets the batch size | Orders/sec vs. wait time | Throughput vs. latency |

### B: The rush

| # | Concept | At the bar | The player | On the cluster | Skills built |
|---|---|---|---|---|---|
| 5 | Autoscaling | Calling in more baristas | Decides when to call, knowing they take time to arrive | Pods added as the line grows | KEDA, resource requests |
| 6 | Rate limiting | No boxes of coffee during a rush | Turns the rule on and sees the bar free up | `429` responses for big orders | Token buckets, Traefik vs. app limits |
| 7 | Backpressure | Line out the door, pause mobile | Sets the line length that pauses mobile | `503` responses until the line recovers | Feedback loops, alerts |
| 8 | Cache | The pastry case | Stocks the case, then watches it run out | Cache hit rate, expiry | Cache-aside, TTLs |

### C: When things go wrong

| # | Concept | At the bar | The player | On the cluster | Skills built |
|---|---|---|---|---|---|
| 9 | Idempotency | Tapped twice, still one latte | Turns on the duplicate check | Same key sent twice, one order made | Idempotency keys, at-least-once delivery |
| 10 | Retries and backoff | "Is my drink ready?" every two seconds | Calms the crowd with spaced-out checks | Retry storm vs. backoff with jitter | k6 scenarios, retry design |
| 11 | Health checks | New barista isn't trained yet | Trains them before they take orders | Traffic is held until the pod is ready | Readiness and liveness probes |
| 12 | Graceful degradation | Espresso machine breaks, serve drip | Switches the menu mid-rush | Circuit breaker opens, and the menu shrinks | Fault injection, postmortems |

Readiness probes only control traffic sent through a Service, and baristas pull their work from the queue. Lesson 11 therefore demos on the register, with the untrained barista working the till.

## Order flow

```
Customer -> Register -> Line (Redis Streams) -> Barista -> "Order ready"
             returns 202, order ID
```

1. The register checks the order, adds it to the line, and returns an order ID.
2. The line holds the order until a barista is free.
3. A barista takes the order, waits a simulated prep time, marks it ready, then confirms it's done.
4. The customer checks the order status using the ID.

## Failure handling

- **Barista crashes mid-drink:** the order stays marked unfinished, and another barista claims it after about 30 seconds.
- **Repeated failures:** after 3 failed attempts, the order moves to a "remake shelf" for inspection.
- **Normal shutdown:** the barista finishes the current drink before exiting.
- **Duplicate drinks:** crash recovery can occasionally make a drink twice. Lesson 9 covers this.
- **Redis restart:** nothing is saved to disk, so a restart loses the line. This is acceptable because every rush is disposable.

## Details from the real shop

- Lattes take 2-3 minutes, depending on how complex they are.
- Two baristas usually work the bar.
- Orders reach the bar as printed tickets.
- When the line reaches the door, a second cashier opens. This is a good story for load balancing: two registers splitting the line.

The game shows a shop clock running 60× faster than real time, so a 3-second drink on the cluster reads as a 3-minute latte.

## Starting values

- Drinks take about 3 seconds.
- Step 1 has one order type and a fixed 2 baristas.

## Dependencies

- **FastAPI and uvicorn:** the register's API.
- **redis-py:** talks to Redis from Python.
- **prometheus-client:** exposes metrics.
- **redis_exporter:** a small container next to Redis that reports line length and other Redis metrics.
- **kube-prometheus-stack:** Prometheus, Grafana, Alertmanager, and ready-made Kubernetes dashboards.
- **k6:** generates the fixed rush inside the cluster.

## Hosting

One server wakes on demand and shuts down when idle, within a hard maximum of $30/month. The simulator never depends on it. Lessons show a recorded real run while the server wakes.

## Shared settings and calibration

`shop/config.json` holds the menu, prep times, rush size, arrival seed, and `timeScale` (60: one real second is one shop minute). Everything reads it:

| Reader | What it uses |
|---|---|
| Game engine (`web/src/engine.mjs`) | Everything, in shop seconds |
| Register | The menu, to reject anything not on it (`422`) |
| Baristas | Prep time per drink, divided by `timeScale` (a 180-second latte takes 3 real seconds) |
| k6 rush (`k8s/rush/rush.js`) | The arrival schedule |

`web/src/arrivals.mjs` builds the arrival schedule from the seed. It has no imports, so the game and k6 load the same file and send exactly the same customers at the same moments. `scripts/up.ps1` stamps a hash of the settings on the register and barista Deployments, so they restart only when the settings change.

**Replaying a level on the cluster:** `.\scripts\rush.ps1 -Rush lesson-3-2 -Baristas 3 -Rule weighted -Every 5` sets the barista count and ticket rule, then sends that rush. Baristas read their rule from `TICKET_RULE` and `MOBILE_EVERY`. They poll both streams every 50 ms when idle, so the rule, not Redis, picks the rail. For oldest-first, they peek at each stream's oldest untaken ticket, using time-ordered stream IDs, before taking one.

**Calibration:** `.\scripts\rush.ps1 -Rush <name> -Record` saves a real rush's exact order timings from Redis to `web/test/fixtures/real-rush-<rush>-<rule>.json`. `web/test/calibration.test.mjs` runs the game with the same rush and design for every recording, and fails if any drifts:

| Recording (2026-11-11) | Longest wait, real / game | Average per-order difference |
|---|---|---|
| Lesson 2, 2 baristas, oldest first | 55.0 / 54.8 min | 0.13 min |
| Lesson 3.1, 3 baristas, walk-ins first | walk-in 7.1 / 6.9, app 19.9 / 19.8 min | 0.09 min |
| Lesson 3.2, 3 baristas, walk-ins first (starvation) | walk-in 6.5 / 6.4, app 32.2 / 32.2 min | 0.08 min |
| Lesson 3.2, 3 baristas, every 5th from the app | walk-in 11.5 / 11.4, app 26.3 / 26.2 min | 0.08 min |
| Lesson 4.1, 2 baristas, batching | 15.7 / 15.7 min | 0.05 min |
| Lesson 4.2, 2 baristas, batching with a 3-minute window | 6.1 / 6.0 min | 0.03 min |
| Lesson 4.3, 3 baristas, walk-ins first, batching | walk-in 6.5 / 6.4, app 7.8 / 7.7 min | 0.10 min |

(Lessons 2 and 3 were re-recorded on 2026-11-11 after the settings gained batching; the table shows the first lesson 3 recordings, and the new ones match to within 0.4 min.)

**Batching on the cluster:** a Lua script (`CLAIM_LATTE` in `services/barista/main.py`) runs inside Redis as one step. It finds the oldest latte nobody has taken on either rail, skipping past other drinks, moves it to `line:batch-hold`, and hands it to one barista, so two baristas can't take the same latte and a crash can't lose it. Baristas holding a lone latte register in `batch:holders`. Before taking a ticket, a free barista hands waiting lattes to holders, longest-waiting first, and the script lets each holder receive only one. The engine follows the same rule, so holders get first pick in both. Batching deletes waiting entries from the middle of a stream, which makes Redis's consumer-group lag unreliable, so the dashboard counts waiting tickets as stream length minus tickets being made.

The first lesson 2 recording, from 2026-11-10, is below:

| Check | Tolerance | First recording (2026-11-10, 2 baristas) |
|---|---|---|
| Longest wait | within 10% | real 54.8 min, game 54.8 min |
| Last drink out | within 10% | real 64.8 min, game 64.7 min |
| Average per-order wait difference | under 2 shop min | 0.04 min |
| Peak queue | within 3 tickets | 41 and 41 |

The tolerances were set before the first recording, to allow for network delay and the baristas' 2-second polling. Real results came in much closer. If the settings change, the test skips until a new recording is made, because comparing against an old recording would mean nothing.
