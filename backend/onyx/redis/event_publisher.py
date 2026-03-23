"""Publish real-time events to per-user Redis Pub/Sub channels.

Events are consumed by the SSE endpoint in ``onyx.server.agent.events_api``
and forwarded to the frontend.  The channel naming convention is::

    {tenant_id}:events:user:{user_id}

The raw Redis client is used (no tenant prefixing) because ``TenantRedis``
does not wrap ``publish()`` / ``pubsub()``.
"""

import json
from datetime import datetime
from datetime import timezone
from typing import Any
from typing import Literal
from uuid import UUID

from onyx.redis.redis_pool import get_raw_redis_client
from onyx.utils.logger import setup_logger

logger = setup_logger()


def _channel_name(tenant_id: str, user_id: str | UUID) -> str:
    return f"{tenant_id}:events:user:{user_id}"


def publish_event(
    tenant_id: str,
    user_id: str | UUID,
    event_type: Literal[
        "session_message",
        "inbox_message",
        "inbox_status_change",
        "cron_status_change",
    ],
    data: dict[str, Any] | None = None,
) -> None:
    """Publish a JSON event to the user's event channel.

    Parameters
    ----------
    tenant_id:
        The tenant scope for channel isolation.
    user_id:
        Target user who should receive the event.
    event_type:
        One of ``session_message``, ``inbox_message``,
        ``inbox_status_change``, ``cron_status_change``.
    data:
        Arbitrary JSON-serialisable payload.
    """
    channel = _channel_name(tenant_id, user_id)
    payload = json.dumps(
        {
            "event": event_type,
            "data": data or {},
            "ts": datetime.now(timezone.utc).isoformat(),
        }
    )
    try:
        client = get_raw_redis_client()
        client.publish(channel, payload)
    except Exception:
        logger.warning(
            "Failed to publish event %s to channel %s",
            event_type,
            channel,
            exc_info=True,
        )
