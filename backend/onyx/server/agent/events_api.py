"""SSE endpoint for real-time user events (inbox, cron, session messages)."""

import asyncio
import json
from collections.abc import AsyncGenerator

from fastapi import APIRouter
from fastapi import Depends
from fastapi import HTTPException
from fastapi.responses import StreamingResponse

from onyx.auth.users import current_user
from onyx.db.models import User
from onyx.redis.redis_pool import get_async_redis_connection
from onyx.utils.logger import setup_logger
from shared_configs.contextvars import get_current_tenant_id

logger = setup_logger()

router = APIRouter(prefix="/agent/events", tags=["Agent Events"])

KEEPALIVE_INTERVAL_S = 15


async def _event_generator(
    tenant_id: str,
    user_id: str,
) -> AsyncGenerator[str, None]:
    """Subscribe to the user's event channel and yield SSE lines."""
    channel_name = f"{tenant_id}:events:user:{user_id}"

    redis = await get_async_redis_connection()
    pubsub = redis.pubsub()

    try:
        await pubsub.subscribe(channel_name)
        logger.info("SSE: subscribed to %s", channel_name)

        while True:
            try:
                msg = await asyncio.wait_for(
                    pubsub.get_message(  # type: ignore[arg-type]
                        ignore_subscribe_messages=True,
                        timeout=KEEPALIVE_INTERVAL_S,
                    ),
                    timeout=KEEPALIVE_INTERVAL_S + 1,
                )
            except asyncio.TimeoutError:
                # No message within timeout — send SSE comment keepalive
                yield ": keepalive\n\n"
                continue

            if msg is not None and msg["type"] == "message":
                raw_data = msg["data"]
                if isinstance(raw_data, bytes):
                    raw_data = raw_data.decode("utf-8")
                # Validate JSON before forwarding
                try:
                    json.loads(raw_data)
                except (json.JSONDecodeError, TypeError):
                    continue
                yield f"data: {raw_data}\n\n"
            else:
                # get_message returned None (timeout inside redis-py)
                yield ": keepalive\n\n"

    except asyncio.CancelledError:
        logger.info("SSE: client disconnected from %s", channel_name)
    except GeneratorExit:
        logger.info("SSE: generator closed for %s", channel_name)
    except Exception:
        logger.warning("SSE: error on channel %s", channel_name, exc_info=True)
    finally:
        try:
            await pubsub.unsubscribe(channel_name)
            await pubsub.close()
        except Exception:
            logger.warning(
                "SSE: failed to unsubscribe/close pubsub for %s",
                channel_name,
                exc_info=True,
            )


@router.get("/stream")
async def stream_events(
    user: User | None = Depends(current_user),
) -> StreamingResponse:
    """Server-Sent Events stream for the authenticated user.

    Delivers real-time notifications for inbox messages, cron status
    changes, and proactive session messages injected by background tasks.
    """
    if user is None:
        raise HTTPException(status_code=401, detail="Authentication required")

    tenant_id = get_current_tenant_id()

    return StreamingResponse(
        _event_generator(tenant_id, str(user.id)),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )
