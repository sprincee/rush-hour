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

### Open decisions
- Autoscaling: CPU-based HPA vs queue-length scaling with KEDA (queue length is the better lesson: "more people in line, more baristas").
- How lessons show live data: embedded public Grafana panels vs periodic snapshots.
- Deployment: plain manifests/Helm first; GitOps (Argo CD) later.
- Lesson site generator: reuse the Worth Learning approach (Python + Jinja2, no JavaScript) unless a lesson truly needs it.

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
- Session 2 (2026-11-10): designed the game format with the owner (design-then-run levels, X-ray toggle, debrief; see `docs/design.md`). The lesson 2 mockup is `lessons/mockups/order-line.html`. Step 3, slice 1 is done: the engine and lesson 2 levels are modules in `web/src/`, with 16 tests in `web/test/` (run `npm test` in `web/`). Slice 2 is done: `shop/config.json` is shared by the game, register, baristas (per-drink prep times), and k6 (same arrival schedule via `web/src/arrivals.mjs`). The calibration test matches a recorded real rush almost exactly (see `docs/design.md`). Fixed a bug where drawing customers changed the game's results (postmortem 2026-11-10). Next: show the game's SLO-style goals on Grafana, slice 3 (the lesson page in the site generator), then lesson 3.
- Known items: `CPUThrottlingHigh` goes pending on low-limit containers (never fired, and rushes weren't slowed; revisit the limits). `-KillBarista` may not trigger a rescue, since the barista can sometimes finish its drink before it's killed. Before AWS: add a NetworkPolicy for Redis, build images for ARM as well, measure memory on a single node, and trim the metrics kept from the kubelet and API server.
- `Notes.md` holds the owner's personal learning notes. It's gitignored.

## Conventions
- Python 3, small modules, type hints, logging (not print).
- Pin dependencies by hand.
- Infrastructure as code for anything in the cloud (Terraform), Kubernetes config in the repo.
- Never commit secrets, `.env`, `.terraform/`, or `*.tfstate*`.
- Write postmortems in `docs/postmortems/` when something breaks, including on purpose.
