"""Print one rush's exact order timings as JSON, for the game's calibration test.

Runs inside the register Pod, which already has Python and the Redis client:
    Get-Content scripts/record_orders.py -Raw | kubectl exec -i deploy/register -n rush-hour -- python - <rush-id> <rush> <baristas> <rule> <every> <config-hash>
scripts/record-rush.ps1 does this for you.
"""

import json
import os
import sys
from datetime import datetime, timezone

import redis


def main() -> None:
    rush_id, rush, baristas, rule, every, config_hash = sys.argv[1:7]
    prefix = f"rush-{rush_id}-"
    r = redis.from_url(os.environ["REDIS_URL"], decode_responses=True)

    orders = []
    for key in r.scan_iter("order:*", count=500):
        ticket = r.hgetall(key)
        customer = ticket.get("customer", "")
        if not customer.startswith(prefix):
            continue
        orders.append({
            "id": int(customer[len(prefix):]),
            "item": ticket.get("item"),
            "channel": ticket.get("channel", "walkin"),
            "status": ticket.get("status"),
            "createdAt": float(ticket["created_at"]),
            "startedAt": float(ticket["started_at"]) if "started_at" in ticket else None,
            "readyAt": float(ticket["ready_at"]) if "ready_at" in ticket else None,
        })
    orders.sort(key=lambda o: o["id"])

    recording = {
        "description": "One real rush on the local cluster, recorded by scripts/record-rush.ps1. Times are real Unix seconds.",
        "recordedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "rushId": rush_id,
        "rush": rush,
        "configHash": config_hash,
        "design": {
            "baristas": int(baristas),
            "rail": True,
            "capacity": None,
            "policy": rule,
            "mobileEvery": int(every),
        },
        "orders": orders,
    }
    sys.stdout.write(json.dumps(recording, indent=2) + "\n")


if __name__ == "__main__":
    main()
