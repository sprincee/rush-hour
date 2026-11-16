# Rush Hour (working name)

A website we're building: an interactive system design course for students, taught through a coffee shop, where every lesson runs on a real Kubernetes cluster. Readers press a button ("Send a rush"), and watch the live system queue, scale, cache, and recover in real-time Grafana panels.

## Mission
Help students and career-switchers understand system design by seeing it, not just reading about it. Every concept maps to something anyone who has stood in a coffee line already understands. Design decisions should serve "does the reader get it?"

It is also a portfolio project meant to show SRE and platform skills: Kubernetes, autoscaling, queues, observability, SLOs, and failure handling. I'm an MSIS student (UMD, graduating May 2027) with a background in cloud infrastructure and identity, AWS Cloud Practitioner + AI Practitioner certified, studying for AWS SAA and Terraform Associate. My previous project is Worth Learning (worthlearning.dev): serverless on AWS, Terraform, dbt, GitHub Actions with OIDC.

## How to work with me (important)
- I'm using this project to learn Kubernetes and observability. Explain what you change and why, briefly and plainly.
- For core logic (autoscaling rules, queue design, failure handling, Terraform design), propose an approach and let me decide before writing large amounts of code.
- Boilerplate, config, and scaffolding: go ahead.
- Talk before building: explain the next step and wait for my OK before multi-step work or anything with effects outside the repo (cloud resources, installs, scheduled tasks). "Ready to work" is not a go-ahead to execute the whole plan.
- I make my own commits. Give me a commit message instead of committing.
- Don't add dependencies or new services without telling me why.
- Keep costs near $0, with a hard maximum of $30/month. Flag anything that would cost money on AWS before creating it.

## The coffee shop map
Several lessons come straight from how my real coffee shop runs (the box-of-coffee rule, batching milk). Use those real-world details in the lesson copy; they're what make this course different.

| # | Coffee shop | System design concept | Group |
|---|---|---|---|
| 1 | Order at the register, then your name gets called | Async vs sync | A: The flow |
| 2 | The order line | Queue | A: The flow |
| 3 | Mobile orders vs walk-ins | Priority queues | A: The flow |
| 4 | Steaming milk for several drinks at once | Batching | A: The flow |
| 5 | Calling in more baristas | Horizontal scaling / autoscaling | B: The rush |
| 6 | No ordering a box of coffee during the rush | Rate limiting | B: The rush |
| 7 | Line out the door, pause mobile orders | Backpressure | B: The rush |
| 8 | The pastry case | Cache | B: The rush |
| 9 | Customer taps "order" twice, still one latte | Idempotency | C: When things go wrong |
| 10 | "Is my drink ready?" every two seconds | Retries and backoff | C: When things go wrong |
| 11 | New barista clocks in but isn't trained yet | Health checks (readiness/liveness) | C: When things go wrong |
| 12 | Espresso machine breaks, serve drip | Graceful degradation / circuit breaker | C: When things go wrong |

Later (after v1): SLOs and error budgets (menu board prep times), load balancing (multiple registers), rolling deploys (changing the menu mid-shift), partitioning (hot vs cold stations), eventual consistency (app says croissants are in stock, case is empty), disaster recovery (another location takes your orders), capacity planning (scheduling Saturday staff).

v1 is all 12 lessons, built in groups A, B, C. Each lesson must work on its own, and each group ships and gets announced when it's done.

## Proposed architecture (not final, decide each piece together)
```
Lesson site (static, S3 + CloudFront)
   -> "Send a rush" button -> Rush API (rate-limited, bounded)
                                  -> in-cluster load generator (k6 Job, capped)
Kubernetes cluster (k3s)
   register   order API (Python)             accepts orders
   line       Redis Streams                  the queue
   baristas   worker Deployment (Python)     simulated prep times; scales with the line
   pastry     Redis cache                    grab-and-go items skip the line
   Prometheus + Grafana                      metrics; public read-only panels for the lessons
```

### Decided
- The line uses Redis Streams: built-in crash recovery, batched reads, and direct KEDA support.
- The course is an interactive browser game built as one coffee shop with 12 levers, not 12 separate mini-games.
- Learners play in a browser simulator, freely and with no waiting line. The cluster handles real runs and checks the simulator. Full design: `docs/design.md`.
- Observability uses kube-prometheus-stack, trimmed for k3s (`k8s/monitoring/values.yaml`). Measured peak on 2026-11-03: about 1 GiB across all Pods during a rush, not counting k3s itself. Single-node memory is still unmeasured, and a t4g.small (2 GB) looks too tight.
- Hosting: local only until launch; then one server running k3s that wakes on demand, planned as a t4g.medium (roughly $3-5/month). It shuts down when idle, with a cooldown and a daily limit on hours. Lessons show a recorded real run while it wakes, and the simulator never depends on it. Confirm prices, memory, and start-up time at step 4.
- Lesson site: Python + Jinja2 (`lessons/build.py`) builds static pages into `dist/`. JavaScript only runs the game, as plain ES modules with no framework or build step.
- Visual design: read `DESIGN_RH.md` before touching templates or CSS. The game canvas is frozen; everything around it follows that file, and the file gets updated as the design evolves.

### Open decisions
- Autoscaling: CPU-based HPA vs queue-length scaling with KEDA (queue length is the better lesson: "more people in line, more baristas").
- How lessons show live data: embedded public Grafana panels vs periodic snapshots.
- Deployment: plain manifests/Helm first; GitOps (Argo CD) later.

## Safety and cost guardrails (non-negotiable)
- The public never sends traffic directly to the cluster. The button triggers a server-side rush with a fixed size and duration.
- Global cooldown between rushes, plus a per-IP rate limit on the button.
- Hard resource limits on every Pod; namespace quotas on the load generator.
- AWS Budgets alerts at $1, $5, $20, and the $30 maximum before anything is created.
- No managed Kubernetes (EKS control plane is ~$73/month). No NAT gateway. No load balancer service if a free option works.
- Never leave the cloud cluster running without a reason; document how to tear it down and bring it back.

## Local development
- Local cluster on the laptop with k3d (runs k3s in Docker, matching the planned AWS host). Windows, PowerShell, VS Code.
- Services run in the cluster from day one; `.venv` is for editing and tests.
- Python 3.13 venv in `.venv`.
- The whole system runs locally with `.\scripts\up.ps1`. Send a rush with `.\scripts\rush.ps1`.

## Roadmap
1. Local cluster with register, line, and baristas; one rush works end to end.
2. Prometheus + Grafana: queue length, orders/sec, wait time, barista count, batch size.
3. Browser simulator, proven first with lesson 2; then Group A (lessons 1-4: async, queue, priority, batching) written and wired to live panels.
4. Terraform for the AWS host; deploy; guardrails verified. Launch Group A + LinkedIn post.
5. Group B (lessons 5-8: autoscaling, rate limiting, backpressure, cache). Post.
6. Group C (lessons 9-12: idempotency, retries, health checks, graceful degradation). Post.
7. After v1: the "later" lessons, GitOps (Argo CD).

## Where we left off (update at the end of each session)
- Session 1 (2026-11-03): chose k3d, scaffolded the repo, created the empty local cluster (`k8s/k3d-cluster.yaml`), and agreed the design (`docs/design.md`). Roadmap step 1 is done: one command brings up the system, and a 50-order rush completes even with a barista killed partway through. Roadmap step 2 is built: kube-prometheus-stack, shop metrics, `redis_exporter`, and the "Rush Hour" dashboard. Its queries were checked against live data, but the owner still needs to look at the dashboard itself in a browser. Batch size waits for lesson 4.
- Session 2 (2026-11-10): designed the game format with the owner (design-then-run levels, X-ray toggle, debrief; see `docs/design.md`). The lesson 2 mockup is `lessons/mockups/order-line.html`. Step 3, slice 1 is done: the engine and lesson 2 levels are modules in `web/src/`, with 16 tests in `web/test/` (run `npm test` in `web/`). Slice 2 is done: `shop/config.json` is shared by the game, register, baristas (per-drink prep times), and k6 (same arrival schedule via `web/src/arrivals.mjs`). The calibration test matches a recorded real rush almost exactly (see `docs/design.md`). Fixed a bug where drawing customers changed the game's results (postmortem 2026-11-10). The Grafana dashboard has a "Goals (SLOs)" row matching the game's goals exactly. Slice 3 is done: `lessons/build.py` builds the home page and lesson 2 from `web/src` (`.\scripts\site.ps1` to preview). Lesson 3 (2026-11-11): designed with the owner; step 1 of 3 is done. The engine supports two channels (walk-in and app), named rushes in `shop/config.json`, and four ticket rules (oldest first, walk-ins first, app first, every Nth from the app). `web/src/lessons/lesson3.mjs` has levels 3.1 and 3.2, and 34 tests pass. Step 2 is done: the game shows a split rail and app printer, app customers arriving to collect, an X-ray with two queues, a ticket-rule picker, and per-channel stats; `lessons/content/lesson-03.toml` builds the page. `web/test/game-smoke.test.mjs` plays every level of the real game module in Node with a fake page and canvas (36 tests). Step 3 is done: the register writes to `line:walkin` or `line:mobile`, baristas follow `TICKET_RULE`/`MOBILE_EVERY`, k6 sends each rush's channels, `rush.ps1 -Rush -Baristas -Rule -Every` replays any level, and the dashboard has per-channel goal panels. Four recordings (lesson 2, 3.1, and 3.2 with two rules) match the game; 39 tests pass. Fixed a rollout race in `rush.ps1` (postmortem 2026-11-11). Lesson 3 is complete.
- Lesson 4 (batching): designed with the owner; step 1 of 3 is done. The engine batches two lattes (1.25x one latte, skipping ahead past other drinks, across both rails) and supports a batch window (`batchWait`). `web/src/lessons/lesson4.mjs` has 4.1 Steam for two, 4.2 Should you wait for a second latte?, and 4.3 The app rush (builds on lesson 3). 48 tests pass; the 4 calibration recordings skip until re-recorded, because `shop/config.json` changed. Step 2 is done: pitchers on the counter (bigger with a ×2 tag for a batch), two tickets in hand, a blue "2nd latte?" countdown during a batch window, X-ray workers showing batches, and design controls per level (`controls` in the lesson file); `lessons/content/lesson-04.toml` builds the page. 53 tests (the smoke test plays every level of lessons 2-4). Step 3 is done: baristas batch for real (`BATCH`, `BATCH_WAIT`, a Lua claim script, `line:batch-hold`, holders in `batch:holders`), `rush.ps1 -Batch -BatchWait` replays lesson 4 levels, and the dashboard has pitcher and batch-size panels. Seven recordings (lessons 2, 3.1, 3.2 x2, 4.1, 4.2, 4.3) match the game; 56 tests pass. Group A (lessons 1-4) now has lessons 2-4 playable; lesson 1 (async vs sync) isn't built yet. 
- Lesson 1 (async vs sync, 2026-11-12): done. The engine has `sync` mode and measures time to an answer; the game has a "Call names" switch, a waiting cashier, and an X-ray holding the request open; the register has `REGISTER_MODE=sync` (one order at a time, request held open until the drink is ready), and `rush.ps1 -Sync` replays it. **Group A (lessons 1-4) is complete in the game and on the cluster.** Level 4.3 was retuned after it proved fragile (postmortem 2026-11-12); `web/test/robustness.test.mjs` now checks every level's verdicts under timing noise, and recordings are fingerprinted per rush. Ten recordings match the game; 93 tests pass. UI overhaul (2026-11-12), first pass built: new homepage (live looping demo, lesson tickets on a rail, calibration receipt), lesson pages with a menu-board strip and "up next", restyled controls and debrief, self-hosted fonts, tokens in `web/src/styles/`. 95 tests pass. UI v2 (2026-11-12), from the owner's review: the homepage is only the hero; "Start lesson 1" opens a swipeable intro and "Have you played before?" (No shows how to play, `web/src/site/start-flow.mjs`); Menu and About are their own pages in the nav; on lesson pages the level ticket sits beside the shop and folds away, and the queue chart is a closed drawer. CSS is mobile first. 96 tests pass. Waiting on the owner's review. Next session (planned 2026-11-13): make lessons 1-4 great to play before roadmap step 4, then reuse the patterns in later lessons. Plan in `docs/gameplay-plan.md`; the owner has their own UI ideas to bring first. Then roadmap step 4 (Terraform, AWS, launch Group A). The owner has a separate vision for it; the logic modules stay, and the UI (`shop-game.mjs`, templates, CSS) gets replaced. Known: Redis keeps consumer records for barista Pods that are gone (harmless; possible cleanup in lesson 11). The owner sees issues with the home page; a UI overhaul comes after the backend and lessons work.
- Gameplay polish (2026-11-16), from `docs/gameplay-plan.md`:
  - **Debrief payoff.** The receipt prints, the numbers count up, and a stamp lands.
  - **Sound.** Web Audio placeholders, including ambient shop loops.
  - **Live goal meters** during the rush.
  - **Freeze frames** for lesson 2 only.
  - **"Your call".** A prediction before each rush.
  - **Three stars per level.** Kept for the visit only; saving them waits for accounts.
  - **Tap-to-define** glossary.
  - **Shorter brief.** The locked parts are now one line.
  - **Effects layer** over the shop.
  - **Input reactions.**

  The engine now reports `maxBusy`. 127 tests pass. `scripts/serve.py` serves `dist/` with no caching. Next:
  - #5: a queue chart in the debrief, with a ghost of the last run.
  - Freeze frames for lessons 1, 3 and 4.
  - Then roadmap step 4.
- Known items: `CPUThrottlingHigh` goes pending on low-limit containers (never fired, and rushes weren't slowed; revisit the limits). `-KillBarista` may not trigger a rescue, since the barista can sometimes finish its drink before it's killed. Before AWS: add a NetworkPolicy for Redis, build images for ARM as well, measure memory on a single node, and trim the metrics kept from the kubelet and API server.
- `Notes.md` holds the owner's personal learning notes. It's gitignored.

## Conventions
- Python 3, small modules, type hints, logging (not print).
- Pin dependencies by hand.
- Infrastructure as code for anything in the cloud (Terraform), Kubernetes config in the repo.
- Never commit secrets, `.env`, `.terraform/`, or `*.tfstate*`.
- Write postmortems in `docs/postmortems/` when something breaks, including on purpose.
