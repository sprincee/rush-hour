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

The player is the shift lead. Each lesson opens with the earlier levers already set, so it works on its own.

1. **Scene:** a moment anyone who has stood in a coffee line recognizes.
2. **Struggle:** play the rush the naive way and watch it go wrong.
3. **Lever:** make the fix and replay it against a goal.
4. **Real:** run it on the cluster and watch the panels.
5. **Translate:** connect the coffee words to the technical terms and the real code.

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
