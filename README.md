# Rush Hour (working name)

A free browser game that teaches system design through a coffee shop. You play
the rush in a simulator, then send one to a real Kubernetes system and watch it
queue, scale, cache, and recover.

**Status:** early development. The backend runs locally. The game and lessons
aren't built yet. See [the design](docs/design.md).

## Run it locally

You need Docker Desktop (running), [k3d](https://k3d.io), and `kubectl`.

```powershell
.\scripts\up.ps1                # Create or update the whole system
.\scripts\rush.ps1              # Send a 50-order rush and check every order gets made
.\scripts\rush.ps1 -KillBarista # Same, but kill a barista partway through
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
| `k8s/rush/` | The k6 load generator, capped by a namespace quota |
| `scripts/` | Commands to bring the system up and send a rush |
| `lessons/` | Lesson content and the site generator |
| `docs/` | The design and postmortems of what broke, including on purpose |
