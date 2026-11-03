"""The register: takes orders, puts them in the line, and answers "is it ready?"."""

import logging
import os
import time
import uuid
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Literal

import redis.asyncio as redis
from fastapi import FastAPI, HTTPException, Request, status
from pydantic import BaseModel, Field

logging.basicConfig(
    level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s"
)
logger = logging.getLogger("register")

REDIS_URL = os.environ.get("REDIS_URL", "redis://localhost:6379/0")
LINE_STREAM = "line:orders"
ORDER_TTL_SECONDS = 3600  # Rushes are disposable, so finished tickets expire.


class OrderRequest(BaseModel):
    item: Literal["latte", "cappuccino", "drip"]
    customer: str = Field(min_length=1, max_length=40)


class OrderAccepted(BaseModel):
    order_id: str
    status: str


class OrderStatus(BaseModel):
    order_id: str
    item: str
    customer: str
    status: str
    created_at: float
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
    yield
    await app.state.redis.aclose()


app = FastAPI(title="Rush Hour register", lifespan=lifespan)


@app.post("/orders", status_code=status.HTTP_202_ACCEPTED)
async def create_order(order: OrderRequest, request: Request) -> OrderAccepted:
    """Accept an order. 202 means "you're in line", not "your drink is ready"."""
    order_id = uuid.uuid4().hex
    key = f"order:{order_id}"
    ticket = {
        "item": order.item,
        "customer": order.customer,
        "status": "queued",
        "created_at": time.time(),
    }

    # A transaction, so an order can't get a ticket without joining the line.
    pipe = request.app.state.redis.pipeline(transaction=True)
    pipe.hset(key, mapping=ticket)
    pipe.expire(key, ORDER_TTL_SECONDS)
    pipe.xadd(LINE_STREAM, {"order_id": order_id, "item": order.item})
    try:
        await pipe.execute()
    except redis.RedisError:
        logger.exception("Could not add order to the line")
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE, "The line is unavailable"
        ) from None

    logger.info("Order %s accepted: %s", order_id, order.item)
    return OrderAccepted(order_id=order_id, status="queued")


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
