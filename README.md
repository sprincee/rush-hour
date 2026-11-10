# Rush Hour (working name)

A free browser game that teaches system design through a coffee shop. You play
the rush in a simulator, then send one to a real Kubernetes system and watch it
queue, scale, cache, and recover.

**Status:** early development. The backend runs locally. The game and lessons
aren't built yet. See [the design](docs/design.md).

## Run it locally

You need Docker Desktop (running), [k3d](https://k3d.io), `kubectl`, and
[Helm](https://helm.sh).

```powershell
.\scripts\up.ps1                # Create or update the whole system
.\scripts\rush.ps1              # Send a 50-order rush and check every order gets made
.\scripts\rush.ps1 -KillBarista # Same, but kill a barista partway through
.\scripts\rush.ps1 -Record      # Send a rush and save it for the game's calibration test
.\scripts\grafana.ps1           # Open Grafana's "Rush Hour" dashboard tunnel and copy the password
k3d cluster delete rush-hour    # Remove everything
```

## How an order flows

```
Customer -> Register -> Line (Redis Streams) -> Barista -> "Order ready"
```

If a barista crashes mid-drink, another one takes over the order after about 30
seconds.

## Layout

| Folder | What goes there |
|---|---|
| `services/` | Python services: the register (order API) and the baristas (workers) |
| `k8s/app/` | Kubernetes config for the shop |
| `shop/config.json` | Shop settings shared by the game and the cluster: menu, prep times, the rush |
| `k8s/rush/` | The k6 load generator, capped by a namespace quota |
| `k8s/monitoring/` | Settings for Prometheus, Grafana, and Alertmanager, plus the dashboard |
| `scripts/` | Commands to bring the system up and send a rush |
| `web/` | The browser game: the shop engine, lesson levels, and their tests (`npm test`) |
| `lessons/` | Lesson content and the site generator. `lessons/mockups/` holds design mockups |
| `docs/` | The design and postmortems of what broke, including on purpose |
