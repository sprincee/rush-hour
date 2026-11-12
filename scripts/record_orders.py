"""Print one rush's exact order timings as JSON, for the game's calibration test.

Runs inside the register Pod, which already has Python and the Redis client:
    Get-Content scripts/record_orders.py -Raw | kubectl exec -i deploy/register -n rush-hour -- python - <rush-id> <rush> <baristas> <rule> <every> <batch> <batch-wait> <register-mode>
scripts/record-rush.ps1 does this for you.
"""

import hashlib
import json
import os
import sys
from datetime import datetime, timezone
from typing import Any

import redis


def without_descriptions(value: Any) -> Any:
    if isinstance(value, dict):
        return {k: without_descriptions(v) for k, v in value.items() if k != "description"}
    if isinstance(value, list):
        return [without_descriptions(v) for v in value]
    return value


def rush_hash(config: dict, rush: str) -> str:
    """A fingerprint of the settings that shape one rush. Matches rushHash() in web/test/helpers.mjs."""
    relevant = {
        "timeScale": config["timeScale"], "register": config["register"], "batch": config.get("batch"),
        "menu": config["menu"], "rush": config["rushes"][rush],
    }
    text = json.dumps(without_descriptions(relevant), sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(text.encode("utf-8")).hexdigest()[:16]


def main() -> None:
    rush_id, rush, baristas, rule, every, batch, batch_wait, register_mode = sys.argv[1:9]
    prefix = f"rush-{rush_id}-"
    # The settings the cluster actually ran with, not whatever is in the repo now.
    with open(os.environ.get("SHOP_CONFIG", "/config/config.json"), encoding="utf-8") as f:
        config = json.load(f)
    time_scale = config["timeScale"]
    config_hash = rush_hash(config, rush)
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
            "arrivedAt": float(ticket["arrived_at"]) if "arrived_at" in ticket else None,
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
            "batch": batch == "on",
            "batchWait": float(batch_wait) * time_scale,  # Real seconds to shop seconds.
            "sync": register_mode == "sync",
        },
        "orders": orders,
    }
    sys.stdout.write(json.dumps(recording, indent=2) + "\n")


if __name__ == "__main__":
    main()
