# Rush Hour (working name)

An interactive system design course taught through a coffee shop. Every lesson
runs on a real Kubernetes cluster: press "Send a rush" and watch the live system
queue, scale, cache, and recover.

**Status:** early development. Nothing runs yet.

## Layout

| Folder | What goes there |
|---|---|
| `services/` | Python services: the register (order API) and the baristas (workers) |
| `k8s/` | Kubernetes config |
| `lessons/` | Lesson content and the site generator |
| `docs/postmortems/` | Write-ups of what broke, including on purpose |
