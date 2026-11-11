"""A barista: takes tickets from the walk-in and app rails, makes drinks, and marks them ready."""

import json
import logging
import os
import signal
import socket
import threading
import time
from types import FrameType

import redis
from prometheus_client import Counter, Histogram, start_http_server

logging.basicConfig(
    level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s"
)
logger = logging.getLogger("barista")

REDIS_URL = os.environ.get("REDIS_URL", "redis://localhost:6379/0")
SHOP_CONFIG = os.environ.get("SHOP_CONFIG", "/config/config.json")
BARISTA = socket.gethostname()  # The Pod name, so every barista is unique.

# How a free barista picks the next ticket. Same rules, same names as the game.
RULES = ("fifo", "walkin", "mobile", "weighted")
TICKET_RULE = os.environ.get("TICKET_RULE", "fifo")
MOBILE_EVERY = int(os.environ.get("MOBILE_EVERY", "3"))  # For "weighted": every Nth drink from the app.

WALKIN_STREAM = "line:walkin"  # Tickets from the register.
MOBILE_STREAM = "line:mobile"  # Tickets from the app printer.
STREAMS = (WALKIN_STREAM, MOBILE_STREAM)
CHANNEL_OF = {WALKIN_STREAM: "walkin", MOBILE_STREAM: "mobile"}
REMAKE_STREAM = "line:remake"
GROUP = "baristas"
ORDER_TTL_SECONDS = 3600

# Idle baristas check both rails this often (50 ms is 3 shop seconds). Blocking on
# one stream would let Redis choose the rail; polling keeps the choice ours.
IDLE_POLL_SECONDS = 0.05
RECLAIM_EVERY_SECONDS = 5
# Must be longer than any drink, or we'd take orders from baristas still working.
RECLAIM_IDLE_MS = 30_000
MAX_DELIVERIES = 3
METRICS_PORT = 9100

Order = tuple[str, str, dict[str, str]]  # (stream, message id, fields)


def load_prep_seconds(path: str) -> dict[str, float]:
    """Real seconds per drink: the menu's shop time, sped up by timeScale.

    Reads shop/config.json, the same file the game uses, so a 3-minute latte in
    the game is a 3-second latte here.
    """
    with open(path, encoding="utf-8") as f:
        config = json.load(f)
    return {m["id"]: m["prepSeconds"] / config["timeScale"] for m in config["menu"]}


PREP_SECONDS = load_prep_seconds(SHOP_CONFIG)
SLOWEST_DRINK = max(PREP_SECONDS.values())

# Buckets run from "almost no wait" to the rush's 240-second give-up point.
WAIT_BUCKETS = (1, 2, 5, 10, 15, 20, 30, 40, 50, 60, 70, 80, 90, 120, 180, 240)
ORDERS_COMPLETED = Counter("rush_orders_completed", "Drinks finished", ["item", "channel"])
ORDERS_RECLAIMED = Counter(
    "rush_orders_reclaimed", "Orders taken over from a barista who stopped responding"
)
ORDERS_REMADE = Counter("rush_orders_remade", "Orders moved to the remake shelf")
LINE_WAIT = Histogram(
    "rush_order_line_wait_seconds",
    "Time from placing an order until a barista first started it",
    ["channel"],
    buckets=WAIT_BUCKETS,
)
TOTAL_WAIT = Histogram(
    "rush_order_total_wait_seconds",
    "Time from placing an order until it was ready",
    ["channel"],
    buckets=WAIT_BUCKETS,
)
# Start every series at 0. Otherwise it first appears at 1, and Prometheus misses that increase.
for channel_name in CHANNEL_OF.values():
    LINE_WAIT.labels(channel=channel_name)
    TOTAL_WAIT.labels(channel=channel_name)
    for menu_item in PREP_SECONDS:
        ORDERS_COMPLETED.labels(item=menu_item, channel=channel_name)

stop_requested = threading.Event()


class Shift:
    """What this barista remembers between drinks."""

    def __init__(self) -> None:
        self.since_mobile = 0  # Walk-in drinks made since the last app drink, for "weighted".


def request_stop(signum: int, frame: FrameType | None) -> None:
    """Kubernetes sends SIGTERM at shutdown. Finish this drink, then leave."""
    logger.info("Asked to clock out; will leave after the current drink")
    stop_requested.set()


def ensure_groups(r: redis.Redis) -> None:
    """Create the consumer group on both rails, from "0" to include tickets already waiting."""
    for stream in STREAMS:
        try:
            r.xgroup_create(stream, GROUP, id="0", mkstream=True)
            logger.info("Created consumer group %s on %s", GROUP, stream)
        except redis.ResponseError as err:
            if "BUSYGROUP" not in str(err):  # Another barista got there first, which is fine.
                raise


def reclaim_abandoned(r: redis.Redis) -> Order | None:
    """Take over one order that another barista started but never finished."""
    for stream in STREAMS:
        claimed = r.xautoclaim(
            stream, GROUP, BARISTA, min_idle_time=RECLAIM_IDLE_MS, start_id="0-0", count=1
        )[1]
        if claimed:
            message_id, fields = claimed[0]
            return stream, message_id, fields
    return None


def oldest_waiting_id(r: redis.Redis, stream: str) -> str | None:
    """The ID of the oldest ticket nobody has taken yet, without taking it."""
    try:
        groups = r.xinfo_groups(stream)
    except redis.ResponseError:
        return None
    last = next((g["last-delivered-id"] for g in groups if g["name"] == GROUP), None)
    if last is None:
        return None
    entries = r.xrange(stream, min=f"({last}", max="+", count=1)
    return entries[0][0] if entries else None


def id_order(message_id: str) -> tuple[int, int]:
    """Stream IDs are "<milliseconds>-<sequence>", so they sort by the time they were added."""
    ms, seq = message_id.split("-")
    return int(ms), int(seq)


def preferred_streams(r: redis.Redis, shift: Shift) -> tuple[str, str]:
    """Which rail to try first, then second, under this barista's ticket rule."""
    if TICKET_RULE == "walkin":
        return WALKIN_STREAM, MOBILE_STREAM
    if TICKET_RULE == "mobile":
        return MOBILE_STREAM, WALKIN_STREAM
    if TICKET_RULE == "weighted":
        if shift.since_mobile >= MOBILE_EVERY - 1:
            return MOBILE_STREAM, WALKIN_STREAM
        return WALKIN_STREAM, MOBILE_STREAM
    # fifo: whichever rail's oldest waiting ticket printed first.
    walkin, mobile = oldest_waiting_id(r, WALKIN_STREAM), oldest_waiting_id(r, MOBILE_STREAM)
    if mobile and (not walkin or id_order(mobile) < id_order(walkin)):
        return MOBILE_STREAM, WALKIN_STREAM
    return WALKIN_STREAM, MOBILE_STREAM


def take_new_order(r: redis.Redis, shift: Shift) -> Order | None:
    """Take the next ticket nobody has started, following the ticket rule. Doesn't wait."""
    for stream in preferred_streams(r, shift):
        response = r.xreadgroup(GROUP, BARISTA, {stream: ">"}, count=1)
        if response:
            message_id, fields = response[0][1][0]
            if stream == MOBILE_STREAM:
                shift.since_mobile = 0
            else:
                shift.since_mobile += 1
            return stream, message_id, fields
    return None


def times_delivered(r: redis.Redis, stream: str, message_id: str) -> int:
    pending = r.xpending_range(stream, GROUP, min=message_id, max=message_id, count=1)
    return pending[0]["times_delivered"] if pending else 1


def remove_from_line(r: redis.Redis, stream: str, message_id: str) -> None:
    """Confirm an order is dealt with, and delete it so the stream can't grow forever."""
    pipe = r.pipeline(transaction=True)
    pipe.xack(stream, GROUP, message_id)
    pipe.xdel(stream, message_id)
    pipe.execute()


def send_to_remake_shelf(
    r: redis.Redis, stream: str, message_id: str, order_id: str, deliveries: int
) -> None:
    """Stop retrying an order that keeps failing, and keep it for inspection."""
    pipe = r.pipeline(transaction=True)
    pipe.hset(f"order:{order_id}", "status", "failed")
    pipe.xadd(
        REMAKE_STREAM,
        {"order_id": order_id, "deliveries": deliveries, "stream": stream},
        maxlen=1000,
        approximate=True,
    )
    pipe.xack(stream, GROUP, message_id)
    pipe.xdel(stream, message_id)
    pipe.execute()
    ORDERS_REMADE.inc()
    logger.error("Order %s moved to the remake shelf after %d deliveries", order_id, deliveries)


def make_drink(
    r: redis.Redis, stream: str, message_id: str, fields: dict[str, str], reclaimed: bool
) -> None:
    order_id = fields.get("order_id")
    channel = CHANNEL_OF[stream]
    key = f"order:{order_id}"

    status, created_at = r.hmget(key, "status", "created_at")
    if status is None or status == "ready":
        logger.warning("Order %s is expired or already made; removing it", order_id)
        remove_from_line(r, stream, message_id)
        return

    deliveries = times_delivered(r, stream, message_id) if reclaimed else 1
    if deliveries > MAX_DELIVERIES:
        send_to_remake_shelf(r, stream, message_id, order_id, deliveries)
        return

    started_at = time.time()
    r.hset(key, mapping={"status": "making", "barista": BARISTA, "started_at": started_at})
    if reclaimed:
        ORDERS_RECLAIMED.inc()
    else:
        LINE_WAIT.labels(channel=channel).observe(started_at - float(created_at))
    logger.info(
        "Making %s order %s: %s (delivery %d)", channel, order_id, fields.get("item"), deliveries
    )
    time.sleep(PREP_SECONDS.get(fields.get("item", ""), SLOWEST_DRINK))

    # If Redis restarted mid-drink, the ticket is gone. Don't recreate half a ticket.
    if not r.exists(key):
        logger.warning("Order %s disappeared while being made", order_id)
        remove_from_line(r, stream, message_id)
        return

    # A transaction, so an order can't be marked ready yet still look unfinished.
    pipe = r.pipeline(transaction=True)
    pipe.hset(key, mapping={"status": "ready", "ready_at": time.time()})
    pipe.expire(key, ORDER_TTL_SECONDS)
    pipe.xack(stream, GROUP, message_id)
    pipe.xdel(stream, message_id)
    pipe.execute()
    ORDERS_COMPLETED.labels(item=fields.get("item", "unknown"), channel=channel).inc()
    TOTAL_WAIT.labels(channel=channel).observe(time.time() - float(created_at))
    logger.info("Order %s is ready", order_id)


def clock_out(r: redis.Redis) -> None:
    """Leave the group, but only on rails where we hold no unfinished orders."""
    for stream in STREAMS:
        try:
            if not r.xpending_range(stream, GROUP, min="-", max="+", count=1, consumername=BARISTA):
                r.xgroup_delconsumer(stream, GROUP, BARISTA)
        except redis.RedisError:
            logger.warning("Could not leave the consumer group on %s cleanly", stream)


def run_shift(r: redis.Redis) -> None:
    shift = Shift()
    last_reclaim = 0.0
    while not stop_requested.is_set():
        try:
            order = None
            reclaimed = False
            if time.monotonic() - last_reclaim >= RECLAIM_EVERY_SECONDS:
                last_reclaim = time.monotonic()
                order = reclaim_abandoned(r)
                reclaimed = order is not None
            if order is None:
                order = take_new_order(r, shift)
            if order is None:
                stop_requested.wait(IDLE_POLL_SECONDS)
                continue
            make_drink(r, *order, reclaimed)
        except redis.ResponseError as err:
            if "NOGROUP" in str(err):  # First start, or Redis restarted and lost the groups.
                logger.info("Consumer group is missing; creating it")
                ensure_groups(r)
            else:
                logger.exception("Redis rejected a command")
                stop_requested.wait(1)
        except redis.RedisError as err:
            logger.warning("Cannot reach the line, retrying: %s", err)
            stop_requested.wait(1)


def main() -> None:
    if TICKET_RULE not in RULES:
        raise SystemExit(f"TICKET_RULE must be one of {', '.join(RULES)}, not {TICKET_RULE!r}")
    if MOBILE_EVERY < 1:
        raise SystemExit("MOBILE_EVERY must be at least 1")

    signal.signal(signal.SIGTERM, request_stop)
    signal.signal(signal.SIGINT, request_stop)

    # Protocol 2 keeps stream replies in one known shape across client upgrades.
    r = redis.from_url(
        REDIS_URL,
        decode_responses=True,
        protocol=2,
        socket_connect_timeout=2,
        socket_timeout=5,
    )

    start_http_server(METRICS_PORT)  # What Prometheus reads every few seconds.
    logger.info(
        "%s clocked in; rule %s (every %d), prep seconds by drink: %s",
        BARISTA, TICKET_RULE, MOBILE_EVERY, PREP_SECONDS,
    )
    run_shift(r)
    clock_out(r)
    r.close()
    logger.info("%s clocked out", BARISTA)


if __name__ == "__main__":
    main()
