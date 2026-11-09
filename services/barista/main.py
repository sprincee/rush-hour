"""A barista: takes orders from the line, makes them, and marks them ready."""

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
PREP_SECONDS = float(os.environ.get("PREP_SECONDS", "3"))
BARISTA = socket.gethostname()  # The Pod name, so every barista is unique.

LINE_STREAM = "line:orders"
REMAKE_STREAM = "line:remake"
GROUP = "baristas"
ORDER_TTL_SECONDS = 3600

BLOCK_MS = 2000  # How long to wait for a new order before checking in again.
RECLAIM_EVERY_SECONDS = 5
# Must be longer than any drink, or we'd take orders from baristas still working.
RECLAIM_IDLE_MS = 30_000
MAX_DELIVERIES = 3
METRICS_PORT = 9100

Order = tuple[str, dict[str, str]]

# Buckets run from "almost no wait" to the rush's 240-second give-up point.
WAIT_BUCKETS = (1, 2, 5, 10, 15, 20, 30, 40, 50, 60, 70, 80, 90, 120, 180, 240)
ORDERS_COMPLETED = Counter("rush_orders_completed", "Drinks finished", ["item"])
# Start at 0. Otherwise a counter first appears at 1, and Prometheus misses that increase.
for menu_item in ("latte", "cappuccino", "drip"):
    ORDERS_COMPLETED.labels(item=menu_item)
ORDERS_RECLAIMED = Counter(
    "rush_orders_reclaimed", "Orders taken over from a barista who stopped responding"
)
ORDERS_REMADE = Counter("rush_orders_remade", "Orders moved to the remake shelf")
LINE_WAIT = Histogram(
    "rush_order_line_wait_seconds",
    "Time from placing an order until a barista first started it",
    buckets=WAIT_BUCKETS,
)
TOTAL_WAIT = Histogram(
    "rush_order_total_wait_seconds",
    "Time from placing an order until it was ready",
    buckets=WAIT_BUCKETS,
)

stop_requested = threading.Event()


def request_stop(signum: int, frame: FrameType | None) -> None:
    """Kubernetes sends SIGTERM at shutdown. Finish this drink, then leave."""
    logger.info("Asked to clock out; will leave after the current drink")
    stop_requested.set()


def ensure_group(r: redis.Redis) -> None:
    """Create the consumer group, starting from "0" to include orders already waiting."""
    try:
        r.xgroup_create(LINE_STREAM, GROUP, id="0", mkstream=True)
        logger.info("Created consumer group %s", GROUP)
    except redis.ResponseError as err:
        if "BUSYGROUP" not in str(err):  # Another barista got there first, which is fine.
            raise


def reclaim_abandoned(r: redis.Redis) -> Order | None:
    """Take over one order that another barista started but never finished."""
    claimed = r.xautoclaim(
        LINE_STREAM,
        GROUP,
        BARISTA,
        min_idle_time=RECLAIM_IDLE_MS,
        start_id="0-0",
        count=1,
    )[1]
    return claimed[0] if claimed else None


def take_new_order(r: redis.Redis) -> Order | None:
    """Wait briefly for the next order that nobody has taken yet."""
    response = r.xreadgroup(GROUP, BARISTA, {LINE_STREAM: ">"}, count=1, block=BLOCK_MS)
    return response[0][1][0] if response else None


def times_delivered(r: redis.Redis, message_id: str) -> int:
    pending = r.xpending_range(LINE_STREAM, GROUP, min=message_id, max=message_id, count=1)
    return pending[0]["times_delivered"] if pending else 1


def remove_from_line(r: redis.Redis, message_id: str) -> None:
    """Confirm an order is dealt with, and delete it so the stream can't grow forever."""
    pipe = r.pipeline(transaction=True)
    pipe.xack(LINE_STREAM, GROUP, message_id)
    pipe.xdel(LINE_STREAM, message_id)
    pipe.execute()


def send_to_remake_shelf(r: redis.Redis, message_id: str, order_id: str, deliveries: int) -> None:
    """Stop retrying an order that keeps failing, and keep it for inspection."""
    pipe = r.pipeline(transaction=True)
    pipe.hset(f"order:{order_id}", "status", "failed")
    pipe.xadd(
        REMAKE_STREAM,
        {"order_id": order_id, "deliveries": deliveries},
        maxlen=1000,
        approximate=True,
    )
    pipe.xack(LINE_STREAM, GROUP, message_id)
    pipe.xdel(LINE_STREAM, message_id)
    pipe.execute()
    ORDERS_REMADE.inc()
    logger.error("Order %s moved to the remake shelf after %d deliveries", order_id, deliveries)


def make_drink(r: redis.Redis, message_id: str, fields: dict[str, str], reclaimed: bool) -> None:
    order_id = fields.get("order_id")
    key = f"order:{order_id}"

    status, created_at = r.hmget(key, "status", "created_at")
    if status is None or status == "ready":
        logger.warning("Order %s is expired or already made; removing it", order_id)
        remove_from_line(r, message_id)
        return

    deliveries = times_delivered(r, message_id) if reclaimed else 1
    if deliveries > MAX_DELIVERIES:
        send_to_remake_shelf(r, message_id, order_id, deliveries)
        return

    started_at = time.time()
    r.hset(key, mapping={"status": "making", "barista": BARISTA, "started_at": started_at})
    if reclaimed:
        ORDERS_RECLAIMED.inc()
    else:
        LINE_WAIT.observe(started_at - float(created_at))
    logger.info("Making order %s: %s (delivery %d)", order_id, fields.get("item"), deliveries)
    time.sleep(PREP_SECONDS)

    # If Redis restarted mid-drink, the ticket is gone. Don't recreate half a ticket.
    if not r.exists(key):
        logger.warning("Order %s disappeared while being made", order_id)
        remove_from_line(r, message_id)
        return

    # A transaction, so an order can't be marked ready yet still look unfinished.
    pipe = r.pipeline(transaction=True)
    pipe.hset(key, mapping={"status": "ready", "ready_at": time.time()})
    pipe.expire(key, ORDER_TTL_SECONDS)
    pipe.xack(LINE_STREAM, GROUP, message_id)
    pipe.xdel(LINE_STREAM, message_id)
    pipe.execute()
    ORDERS_COMPLETED.labels(item=fields.get("item", "unknown")).inc()
    TOTAL_WAIT.observe(time.time() - float(created_at))
    logger.info("Order %s is ready", order_id)


def clock_out(r: redis.Redis) -> None:
    """Leave the group, but only if we hold no unfinished orders, or they'd be orphaned."""
    try:
        if not r.xpending_range(
            LINE_STREAM, GROUP, min="-", max="+", count=1, consumername=BARISTA
        ):
            r.xgroup_delconsumer(LINE_STREAM, GROUP, BARISTA)
    except redis.RedisError:
        logger.warning("Could not leave the consumer group cleanly")


def run_shift(r: redis.Redis) -> None:
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
                order = take_new_order(r)
            if order is not None:
                make_drink(r, order[0], order[1], reclaimed)
        except redis.ResponseError as err:
            if "NOGROUP" in str(err):  # First start, or Redis restarted and lost the group.
                logger.info("Consumer group is missing; creating it")
                ensure_group(r)
            else:
                logger.exception("Redis rejected a command")
                stop_requested.wait(1)
        except redis.RedisError as err:
            logger.warning("Cannot reach the line, retrying: %s", err)
            stop_requested.wait(1)


def main() -> None:
    signal.signal(signal.SIGTERM, request_stop)
    signal.signal(signal.SIGINT, request_stop)

    # The socket timeout must be longer than BLOCK_MS, or every quiet wait would fail.
    # Protocol 2 keeps stream replies in one known shape across client upgrades.
    r = redis.from_url(
        REDIS_URL,
        decode_responses=True,
        protocol=2,
        socket_connect_timeout=2,
        socket_timeout=5,
    )

    start_http_server(METRICS_PORT)  # What Prometheus reads every few seconds.
    logger.info("%s clocked in; drinks take %.1fs", BARISTA, PREP_SECONDS)
    run_shift(r)
    clock_out(r)
    r.close()
    logger.info("%s clocked out", BARISTA)


if __name__ == "__main__":
    main()
