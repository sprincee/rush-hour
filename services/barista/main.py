"""A barista: takes tickets from the walk-in and app rails, makes drinks, and marks them ready.

With batching on, a barista with a latte ticket also takes the oldest other latte
waiting on either rail, even one further back, and steams milk for both at once.
"""

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
BATCH = os.environ.get("BATCH", "off") == "on"  # Steam milk for two lattes at once.
BATCH_WAIT_SECONDS = float(os.environ.get("BATCH_WAIT", "0"))  # Hold a lone latte this long for a partner.

WALKIN_STREAM = "line:walkin"  # Tickets from the register.
MOBILE_STREAM = "line:mobile"  # Tickets from the app printer.
HOLD_STREAM = "line:batch-hold"  # Lattes taken from further back, held by the barista batching them.
STREAMS = (WALKIN_STREAM, MOBILE_STREAM)
ALL_STREAMS = (WALKIN_STREAM, MOBILE_STREAM, HOLD_STREAM)
CHANNEL_OF = {WALKIN_STREAM: "walkin", MOBILE_STREAM: "mobile"}
HOLDERS = "batch:holders"  # Baristas holding a lone latte, and since when.
REMAKE_STREAM = "line:remake"
GROUP = "baristas"
ORDER_TTL_SECONDS = 3600
LOOKAHEAD = 200  # How far back along a rail to look for a second latte.

# Idle baristas check the rails this often (50 ms is 3 shop seconds). Blocking on
# one stream would let Redis choose the rail; polling keeps the choice ours.
IDLE_POLL_SECONDS = 0.05
RECLAIM_EVERY_SECONDS = 5
# Must be longer than any drink, or we'd take orders from baristas still working.
RECLAIM_IDLE_MS = 30_000
MAX_DELIVERIES = 3
METRICS_PORT = 9100

Order = tuple[str, str, dict[str, str]]  # (stream, message id, fields)


def load_shop(path: str) -> tuple[dict[str, float], set[str], float]:
    """Prep seconds per drink, which drinks can share a pitcher, and how much longer a batch takes.

    Reads shop/config.json, the same file the game uses. Times are divided by
    timeScale, so a 3-minute latte in the game is a 3-second latte here.
    """
    with open(path, encoding="utf-8") as f:
        config = json.load(f)
    prep = {m["id"]: m["prepSeconds"] / config["timeScale"] for m in config["menu"]}
    batchable = {m["id"] for m in config["menu"] if m.get("batchable")}
    factor = config.get("batch", {}).get("prepFactor", 1.0)
    return prep, batchable, factor


PREP_SECONDS, BATCHABLE, BATCH_FACTOR = load_shop(SHOP_CONFIG)
SLOWEST_DRINK = max(PREP_SECONDS.values())

# Runs inside Redis as one step, so two baristas can never take the same latte.
# Finds the oldest latte nobody has taken on either rail (skipping past other
# drinks), moves it to the hold stream, and hands it to one barista. That barista
# then holds it in its pending list, so a crash can't lose it.
# With require_holder, it only does this for a barista still waiting for a partner,
# and takes that barista off the waiting list, so a holder only ever gets one latte.
CLAIM_LATTE = """
local group, consumer, lookahead, require_holder = ARGV[1], ARGV[2], tonumber(ARGV[3]), ARGV[4]
if require_holder == '1' and redis.call('HEXISTS', KEYS[4], consumer) == 0 then return false end
local batchable = {}
for i = 5, #ARGV do batchable[ARGV[i]] = true end
local function last_delivered(key)
  if redis.call('EXISTS', key) == 0 then return nil end
  for _, g in ipairs(redis.call('XINFO', 'GROUPS', key)) do
    local name, last
    for j = 1, #g, 2 do
      if g[j] == 'name' then name = g[j + 1] elseif g[j] == 'last-delivered-id' then last = g[j + 1] end
    end
    if name == group then return last end
  end
  return nil
end
local function older(a, b)
  local am, as = string.match(a, '(%d+)-(%d+)')
  local bm, bs = string.match(b, '(%d+)-(%d+)')
  am, as, bm, bs = tonumber(am), tonumber(as), tonumber(bm), tonumber(bs)
  return am < bm or (am == bm and as < bs)
end
local best_key, best_id, best_fields
for i = 1, 2 do
  local last = last_delivered(KEYS[i])
  if last then
    for _, e in ipairs(redis.call('XRANGE', KEYS[i], '(' .. last, '+', 'COUNT', lookahead)) do
      local item
      for j = 1, #e[2], 2 do if e[2][j] == 'item' then item = e[2][j + 1] end end
      if batchable[item] then
        if not best_id or older(e[1], best_id) then best_key, best_id, best_fields = KEYS[i], e[1], e[2] end
        break
      end
    end
  end
end
if not best_id then return false end
redis.call('XDEL', best_key, best_id)
local fields = {}
for j = 1, #best_fields do fields[j] = best_fields[j] end
fields[#fields + 1] = 'from'
fields[#fields + 1] = best_key
redis.call('XADD', KEYS[3], '*', unpack(fields))
local got = redis.call('XREADGROUP', 'GROUP', group, consumer, 'COUNT', 1, 'STREAMS', KEYS[3], '>')
redis.call('HDEL', KEYS[4], consumer)
local entry = got[1][2][1]
return {entry[1], entry[2]}
"""

# Buckets run from "almost no wait" to the rush's 240-second give-up point.
WAIT_BUCKETS = (1, 2, 5, 10, 15, 20, 30, 40, 50, 60, 70, 80, 90, 120, 180, 240)
ORDERS_COMPLETED = Counter("rush_orders_completed", "Drinks finished", ["item", "channel"])
ORDERS_RECLAIMED = Counter(
    "rush_orders_reclaimed", "Orders taken over from a barista who stopped responding"
)
ORDERS_REMADE = Counter("rush_orders_remade", "Orders moved to the remake shelf")
PITCHERS = Counter("rush_pitchers_steamed", "Pitchers of milk steamed, by how many lattes shared one", ["size"])
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
for size in ("1", "2"):
    PITCHERS.labels(size=size)

stop_requested = threading.Event()


class Shift:
    """What this barista remembers between drinks."""

    def __init__(self) -> None:
        self.since_mobile = 0  # Walk-in drinks made since the last app drink, for "weighted".


def request_stop(signum: int, frame: FrameType | None) -> None:
    """Kubernetes sends SIGTERM at shutdown. Finish this drink, then leave."""
    logger.info("Asked to clock out; will leave after the current drink")
    stop_requested.set()


def channel_of(stream: str, fields: dict[str, str]) -> str:
    """Which rail a ticket came from. Held lattes remember their rail in "from"."""
    return CHANNEL_OF.get(stream) or CHANNEL_OF.get(fields.get("from", ""), "walkin")


def ensure_groups(r: redis.Redis) -> None:
    """Create the consumer group on every stream, from "0" to include tickets already waiting."""
    for stream in ALL_STREAMS:
        try:
            r.xgroup_create(stream, GROUP, id="0", mkstream=True)
            logger.info("Created consumer group %s on %s", GROUP, stream)
        except redis.ResponseError as err:
            if "BUSYGROUP" not in str(err):  # Another barista got there first, which is fine.
                raise


def reclaim_abandoned(r: redis.Redis) -> Order | None:
    """Take over one order that another barista started but never finished."""
    for stream in ALL_STREAMS:
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


def claim_latte(r: redis.Redis, claim: "redis.commands.core.Script", for_barista: str, require_holder: bool) -> Order | None:
    """Move the oldest waiting latte into a barista's hands (see CLAIM_LATTE)."""
    result = claim(
        keys=[WALKIN_STREAM, MOBILE_STREAM, HOLD_STREAM, HOLDERS],
        args=[GROUP, for_barista, LOOKAHEAD, "1" if require_holder else "0", *sorted(BATCHABLE)],
    )
    if not result:
        return None
    message_id, flat = result
    return HOLD_STREAM, message_id, dict(zip(flat[::2], flat[1::2]))


def offer_to_holders(r: redis.Redis, claim: "redis.commands.core.Script") -> None:
    """Before taking a ticket, give waiting lattes to baristas holding one, longest first."""
    if not (BATCH and BATCH_WAIT_SECONDS > 0):
        return
    now = time.time()
    for name, since in sorted(r.hgetall(HOLDERS).items(), key=lambda kv: float(kv[1])):
        if now - float(since) > BATCH_WAIT_SECONDS + 5:  # Left over from a barista that's gone.
            r.hdel(HOLDERS, name)
            continue
        if name != BARISTA:
            claim_latte(r, claim, name, require_holder=True)


def gifted_latte(r: redis.Redis, first_id: str) -> Order | None:
    """The latte another barista handed us while we held ours: it's in our pending list."""
    response = r.xreadgroup(GROUP, BARISTA, {HOLD_STREAM: "0"}, count=10)
    for message_id, fields in (response[0][1] if response else []):
        if message_id != first_id and fields:
            return HOLD_STREAM, message_id, fields
    return None


def wait_for_partner(r: redis.Redis, claim: "redis.commands.core.Script", first_id: str) -> Order | None:
    """The batch window: hold a lone latte, hoping a second latte arrives to share the pitcher."""
    r.hset(HOLDERS, BARISTA, time.time())
    deadline = time.monotonic() + BATCH_WAIT_SECONDS
    while time.monotonic() < deadline and not stop_requested.is_set():
        partner = claim_latte(r, claim, BARISTA, require_holder=True)
        if partner:
            return partner
        if not r.hexists(HOLDERS, BARISTA):  # Another barista handed us a latte.
            return gifted_latte(r, first_id)
        stop_requested.wait(IDLE_POLL_SECONDS)
    if r.hdel(HOLDERS, BARISTA) == 0:  # A latte was handed to us just as time ran out.
        return gifted_latte(r, first_id)
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


def still_wanted(r: redis.Redis, ticket: Order) -> str | None:
    """The order's created_at if it still needs making; otherwise clear it off the rail."""
    stream, message_id, fields = ticket
    status, created_at = r.hmget(f"order:{fields.get('order_id')}", "status", "created_at")
    if status is None or status == "ready":
        logger.warning("Order %s is expired or already made; removing it", fields.get("order_id"))
        remove_from_line(r, stream, message_id)
        return None
    return created_at


def make_drinks(r: redis.Redis, tickets: list[Order], reclaimed: bool) -> None:
    """Make one drink, or two lattes from one pitcher, and mark them ready together."""
    first_stream, first_id, first_fields = tickets[0]
    if reclaimed:
        deliveries = times_delivered(r, first_stream, first_id)
        if deliveries > MAX_DELIVERIES:
            send_to_remake_shelf(r, first_stream, first_id, first_fields.get("order_id"), deliveries)
            tickets = tickets[1:]
    working = []
    for ticket in tickets:
        created_at = still_wanted(r, ticket)
        if created_at is not None:
            working.append((ticket, float(created_at)))
    if not working:
        return

    started_at = time.time()
    for (stream, message_id, fields), created_at in working:
        r.hset(f"order:{fields['order_id']}", mapping={"status": "making", "barista": BARISTA, "started_at": started_at})
        if not (reclaimed and message_id == first_id):
            LINE_WAIT.labels(channel=channel_of(stream, fields)).observe(started_at - created_at)
    if reclaimed:
        ORDERS_RECLAIMED.inc()

    item = working[0][0][2].get("item", "")
    prep = PREP_SECONDS.get(item, SLOWEST_DRINK) * (BATCH_FACTOR if len(working) == 2 else 1)
    logger.info(
        "Making %s (%s)%s", " + ".join(t[2].get("order_id", "?") for t, _ in working), item,
        " as a batch of 2" if len(working) == 2 else "",
    )
    time.sleep(prep)

    # A transaction, so an order can't be marked ready yet still look unfinished.
    pipe = r.pipeline(transaction=True)
    done = []
    for (stream, message_id, fields), created_at in working:
        key = f"order:{fields['order_id']}"
        if not r.exists(key):  # Redis restarted mid-drink. Don't recreate half a ticket.
            logger.warning("Order %s disappeared while being made", fields["order_id"])
            remove_from_line(r, stream, message_id)
            continue
        pipe.hset(key, mapping={"status": "ready", "ready_at": time.time()})
        pipe.expire(key, ORDER_TTL_SECONDS)
        pipe.xack(stream, GROUP, message_id)
        pipe.xdel(stream, message_id)
        done.append((stream, fields, created_at))
    pipe.execute()
    finished = time.time()
    for stream, fields, created_at in done:
        channel = channel_of(stream, fields)
        ORDERS_COMPLETED.labels(item=fields.get("item", "unknown"), channel=channel).inc()
        TOTAL_WAIT.labels(channel=channel).observe(finished - created_at)
    if item in BATCHABLE:
        PITCHERS.labels(size=str(len(working))).inc()


def serve(r: redis.Redis, claim: "redis.commands.core.Script", first: Order, reclaimed: bool) -> None:
    tickets = [first]
    if BATCH and first[2].get("item") in BATCHABLE:
        partner = claim_latte(r, claim, BARISTA, require_holder=False)
        if partner is None and BATCH_WAIT_SECONDS > 0:
            partner = wait_for_partner(r, claim, first[1])
        if partner:
            tickets.append(partner)
    make_drinks(r, tickets, reclaimed)


def clock_out(r: redis.Redis) -> None:
    """Leave the group, but only on streams where we hold no unfinished orders."""
    try:
        r.hdel(HOLDERS, BARISTA)
    except redis.RedisError:
        pass
    for stream in ALL_STREAMS:
        try:
            if not r.xpending_range(stream, GROUP, min="-", max="+", count=1, consumername=BARISTA):
                r.xgroup_delconsumer(stream, GROUP, BARISTA)
        except redis.RedisError:
            logger.warning("Could not leave the consumer group on %s cleanly", stream)


def run_shift(r: redis.Redis) -> None:
    shift = Shift()
    claim = r.register_script(CLAIM_LATTE)
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
                offer_to_holders(r, claim)
                order = take_new_order(r, shift)
            if order is None:
                stop_requested.wait(IDLE_POLL_SECONDS)
                continue
            serve(r, claim, order, reclaimed)
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
        "%s clocked in; rule %s (every %d), batching %s (wait %.1fs), prep seconds by drink: %s",
        BARISTA, TICKET_RULE, MOBILE_EVERY, "on" if BATCH else "off", BATCH_WAIT_SECONDS, PREP_SECONDS,
    )
    run_shift(r)
    clock_out(r)
    r.close()
    logger.info("%s clocked out", BARISTA)


if __name__ == "__main__":
    main()
