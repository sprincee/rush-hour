# kubectl could not reach the new local cluster

**Date:** 2026-11-03
**Impact:** Local setup only. About 5 minutes lost, and no data or users affected.

## What happened
`k3d cluster create` reported success, but every `kubectl` command timed out.

## Cause
By default, k3d set up two things that caused the problem:

- It wrote `https://host.docker.internal:<random port>` into the kubeconfig. Docker Desktop's hosts entry points that name at the laptop's Wi-Fi address (192.168.86.69).
- It published the cluster's API port on `0.0.0.0`, meaning every network interface.

The same port answered on `127.0.0.1` but not on the Wi-Fi address. The laptop was on eduroam with a Public network profile, so Windows Firewall is the most likely blocker. The firewall rules themselves were not inspected.

## Fix
Set `kubeAPI` in `k8s/k3d-cluster.yaml` so the API listens on `127.0.0.1:6445` and the kubeconfig uses that address, then recreated the empty cluster.

We did not open a firewall port. That would have got `kubectl` working, but it could also have exposed the Kubernetes API to everyone on a shared network.

## Takeaways
- A successful create only means the containers started. Check that the cluster is reachable as well.
- Bind local development services to `127.0.0.1` unless they need to be on the network. Apply the same rule to any ports we publish later, like Grafana's.
- Set a timeout on `kubectl` calls in scripts (`--request-timeout`), so a bad connection fails quickly.
