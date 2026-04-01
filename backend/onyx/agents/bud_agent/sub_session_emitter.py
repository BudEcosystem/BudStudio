"""Streaming emitter and auto-approve requester for sub-session execution.

Sub-sessions run headless (no Socket.IO client), so instead of emitting
directly to a websocket, the emitter publishes streaming deltas to a
Redis pub/sub channel.  The Socket.IO bridge picks them up and relays
to the frontend in real time.

Tool calls are approved immediately without user interaction.
"""

from __future__ import annotations

import json
from typing import Any

from onyx.utils.logger import setup_logger

logger = setup_logger()


class SubSessionEmitter:
    """TurnEmitter implementation that publishes streaming deltas to Redis.

    Events are published to channel ``sub_session_stream:{parent_session_id}``
    so the Socket.IO bridge can relay them to the correct room.

    All Redis operations are fire-and-forget: failures are logged but
    never crash the sub-session.

    Accepts an existing Redis client to avoid creating extra pool connections.
    """

    def __init__(
        self,
        session_id: str,
        parent_session_id: str,
        redis_client: Any = None,
        tenant_id: str | None = None,
    ) -> None:
        self._session_id = session_id
        self._parent_session_id = parent_session_id
        self._channel = f"sub_session_stream:{parent_session_id}"

        if redis_client is not None:
            self._redis = redis_client
        elif tenant_id is not None:
            # Fallback: create from pool (only if no client passed)
            from onyx.redis.redis_pool import get_redis_client

            try:
                self._redis = get_redis_client(tenant_id=tenant_id)
            except Exception:
                logger.warning(
                    "SubSessionEmitter: failed to get Redis client, "
                    "streaming will be disabled for session %s",
                    session_id,
                    exc_info=True,
                )
                self._redis = None
        else:
            self._redis = None

    def _publish(self, payload: dict[str, Any]) -> None:
        """Fire-and-forget publish to the Redis channel."""
        if self._redis is None:
            return
        try:
            self._redis.publish(self._channel, json.dumps(payload))
        except Exception:
            logger.debug(
                "SubSessionEmitter: failed to publish %s for session %s",
                payload.get("type", "unknown"),
                self._session_id,
                exc_info=True,
            )

    async def reasoning_start(self, step: int) -> None:
        # No content to stream — no-op
        return

    async def reasoning_delta(self, delta: str, step: int) -> None:
        self._publish({
            "type": "reasoning_delta",
            "sub_session_id": self._session_id,
            "delta": delta,
            "step": step,
        })

    async def text_start(self, step: int) -> None:
        # No content to stream — no-op
        return

    async def text_delta(self, delta: str, step: int) -> None:
        self._publish({
            "type": "text_delta",
            "sub_session_id": self._session_id,
            "delta": delta,
            "step": step,
        })

    async def section_end(self, step: int) -> None:
        self._publish({
            "type": "section_end",
            "sub_session_id": self._session_id,
            "step": step,
        })

    async def tool_start(self, tool_name: str, step: int) -> None:
        self._publish({
            "type": "tool_start",
            "sub_session_id": self._session_id,
            "tool_name": tool_name,
            "step": step,
        })

    async def tool_result_event(
        self,
        tool_name: str,
        tool_call_id: str,
        result: Any,
        step: int,
    ) -> None:
        self._publish({
            "type": "tool_result",
            "sub_session_id": self._session_id,
            "tool_name": tool_name,
            "tool_call_id": tool_call_id,
            "result": str(result)[:500],
            "step": step,
        })


class AutoApproveRequester:
    """ToolRequester implementation that auto-approves every tool call.

    Sub-sessions execute autonomously without user confirmation gates.
    """

    async def request(self, tool: dict[str, Any]) -> None:
        return
