"""The register: takes orders, puts them in the line, and answers "is it ready?".

In async mode (the default) it answers 202 Accepted with a ticket straight away.
In sync mode (lesson 1) the cashier waits at the bar: one order at a time, and the
request stays open until the drink is ready, then answers 200 with the drink.
"""

import asyncio
import json
import logging
import os
import time
import uuid
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Literal

import redis.asyncio as redis
from fastapi import FastAPI, HTTPException, Request, Response, status
from fastapi.responses import JSONResponse
from prometheus_client import CONTENT_TYPE_LATEST, Counter, generate_latest
from pydantic import BaseModel, Field

logging.basicConfig(
    level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s"
)
logger = logging.getLogger("register")

REDIS_URL = os.environ.get("REDIS_URL", "redis://localhost:6379/0")
# Walk-in tickets print at the register; app orders print on their own printer.
STREAMS = {"walkin": "line:walkin", "mobile": "line:mobile"}
ORDER_TTL_SECONDS = 3600  # Rushes are disposable, so finished tickets expire.
SHOP_CONFIG = os.environ.get("SHOP_CONFIG", "/config/config.json")
REGISTER_MODE = os.environ.get("REGISTER_MODE", "async")  # "async" or "sync"
SYNC_POLL_SECONDS = 0.05  # How often a waiting cashier checks the drink (3 shop seconds).
SYNC_GIVE_UP_SECONDS = 300


def load_menu(path: str) -> list[str]:
    """The drinks on the menu, from shop/config.json (shared with the game)."""
    with open(path, encoding="utf-8") as f:
        return [m["id"] for m in json.load(f)["menu"]]


MENU = load_menu(SHOP_CONFIG)

ORDERS_ACCEPTED = Counter("rush_orders_accepted", "Orders added to the line", ["item", "channel"])
# Start at 0. Otherwise a counter first appears at 1, and Prometheus misses that increase.
for menu_item in MENU:
    for channel_name in STREAMS:
        ORDERS_ACCEPTED.labels(item=menu_item, channel=channel_name)
ORDERS_REJECTED = Counter("rush_orders_rejected", "Valid orders the line couldn't take")


class OrderRequest(BaseModel):
    item: str = Field(min_length=1, max_length=32)
    customer: str = Field(min_length=1, max_length=40)
    channel: Literal["walkin", "mobile"] = "walkin"


class OrderAccepted(BaseModel):
    order_id: str
    status: str


class OrderStatus(BaseModel):
    order_id: str
    item: str
    customer: str
    status: str
    created_at: float
    channel: str = "walkin"
    barista: str | None = None
    ready_at: float | None = None


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    # Short timeouts: when Redis is down, fail fast instead of holding the customer.
    app.state.redis = redis.from_url(
        REDIS_URL,
        decode_responses=True,
        socket_connect_timeout=2,
        socket_timeout=2,
    )
    # Sync mode has one cashier: only one order can be in progress at a time.
    app.state.cashier = asyncio.Lock()
    if REGISTER_MODE not in ("async", "sync"):
        raise RuntimeError(f"REGISTER_MODE must be async or sync, not {REGISTER_MODE!r}")
    logger.info("Register open in %s mode", REGISTER_MODE)
    yield
    await app.state.redis.aclose()


app = FastAPI(title="Rush Hour register", lifespan=lifespan)


@app.post("/orders", status_code=status.HTTP_202_ACCEPTED, response_model=None)
async def create_order(order: OrderRequest, request: Request) -> OrderAccepted | JSONResponse:
    """Accept an order. 202 means "you're in line", not "your drink is ready"."""
    if order.item not in MENU:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY, f"Not on the menu. Try one of: {', '.join(MENU)}"
        )
    arrived_at = time.time()
    if REGISTER_MODE == "sync":
        # The cashier takes one order, then waits at the bar until it's made.
        async with request.app.state.cashier:
            order_id = await place_order(order, request, arrived_at)
            await wait_until_ready(request, order_id)
        return JSONResponse({"order_id": order_id, "status": "ready"}, status_code=status.HTTP_200_OK)
    order_id = await place_order(order, request, arrived_at)
    return OrderAccepted(order_id=order_id, status="queued")


async def wait_until_ready(request: Request, order_id: str) -> None:
    """Sync mode: hold the request open until the barista marks the drink ready."""
    deadline = time.monotonic() + SYNC_GIVE_UP_SECONDS
    while time.monotonic() < deadline:
        try:
            status_now = await request.app.state.redis.hget(f"order:{order_id}", "status")
        except redis.RedisError:
            raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "The line is unavailable") from None
        if status_now == "ready":
            return
        await asyncio.sleep(SYNC_POLL_SECONDS)
    raise HTTPException(status.HTTP_504_GATEWAY_TIMEOUT, "The drink took too long")


async def place_order(order: OrderRequest, request: Request, arrived_at: float) -> str:
    """Print the ticket and add it to the line. Returns the order ID."""
    order_id = uuid.uuid4().hex
    key = f"order:{order_id}"
    ticket = {
        "item": order.item,
        "customer": order.customer,
        "channel": order.channel,
        "status": "queued",
        "arrived_at": arrived_at,  # When the request reached the register.
        "created_at": time.time(),  # When the cashier took the order.
    }

    # A transaction, so an order can't get a ticket without joining the line.
    pipe = request.app.state.redis.pipeline(transaction=True)
    pipe.hset(key, mapping=ticket)
    pipe.expire(key, ORDER_TTL_SECONDS)
    pipe.xadd(STREAMS[order.channel], {"order_id": order_id, "item": order.item})
    try:
        await pipe.execute()
    except redis.RedisError:
        logger.exception("Could not add order to the line")
        ORDERS_REJECTED.inc()
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE, "The line is unavailable"
        ) from None

    ORDERS_ACCEPTED.labels(item=order.item, channel=order.channel).inc()
    logger.info("Order %s accepted: %s (%s)", order_id, order.item, order.channel)
    return order_id


@app.get("/orders/{order_id}")
async def get_order(order_id: str, request: Request) -> OrderStatus:
    try:
        ticket = await request.app.state.redis.hgetall(f"order:{order_id}")
    except redis.RedisError:
        logger.exception("Could not look up order %s", order_id)
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE, "The line is unavailable"
        ) from None

    if not ticket:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No such order")
    return OrderStatus(order_id=order_id, **ticket)


@app.get("/metrics")
async def metrics() -> Response:
    """What Prometheus reads every few seconds."""
    return Response(generate_latest(), media_type=CONTENT_TYPE_LATEST)


@app.get("/healthz")
async def healthz() -> dict[str, str]:
    """Liveness: the process is running. Doesn't check Redis on purpose, because
    restarting the register wouldn't fix a Redis outage."""
    return {"status": "ok"}


@app.get("/readyz")
async def readyz(request: Request) -> dict[str, str]:
    """Readiness: only send customers here if this register can reach the line."""
    try:
        await request.app.state.redis.ping()
    except redis.RedisError:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE, "Cannot reach the line"
        ) from None
    return {"status": "ready"}
