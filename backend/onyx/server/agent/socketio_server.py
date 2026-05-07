"""Socket.IO server for real-time agent communication.

Creates an AsyncServer instance with connect/disconnect handlers and
all agent event handlers (``agent:execute``, ``tool:result``,
``tool:approval``, ``agent:stop``, ``tool:delta``, ``file:sync``,
``agent:rejoin``).

Authentication reuses the existing cookie-based and JWT-based auth
flows from ``onyx.auth``.  Each event instantiates a fresh
``AgentHandler`` -- no state is held between events.

Emit routing uses Socket.IO **rooms** keyed by ``session:{session_id}``
so that when a client disconnects and reconnects (e.g. OAuth token
refresh), the in-flight LLM coroutine's emits reach the new sid
automatically once the client re-joins the room via ``agent:rejoin``.

Sub-session events originate from Celery workers (which do not hold
Socket.IO connections) and are bridged into Socket.IO via Redis
Pub/Sub.  Celery tasks publish to channel ``sub_session_events:{parent_id}``
and the ``_sub_session_event_bridge`` background coroutine subscribes
to the pattern ``sub_session_events:*`` and re-emits to the correct
room.
"""

from __future__ import annotations

import asyncio
import json
from http.cookies import SimpleCookie
from typing import Any

import socketio  # type: ignore[import-untyped]

from onyx.auth.jwt import verify_jwt_token
from onyx.auth.schemas import AuthBackend
from onyx.auth.users import UserManager
from onyx.configs.app_configs import AUTH_BACKEND
from onyx.configs.app_configs import DISABLE_AUTH
from onyx.configs.app_configs import SESSION_EXPIRE_TIME_SECONDS
from onyx.configs.constants import FASTAPI_USERS_AUTH_COOKIE_NAME
from onyx.db.engine.async_sql_engine import get_async_session_context_manager
from onyx.db.models import AccessToken
from onyx.db.models import OAuthAccount
from onyx.db.models import User
from onyx.utils.logger import setup_logger
from shared_configs.configs import CORS_ALLOWED_ORIGIN

logger = setup_logger()

# ---------------------------------------------------------------------------
# Socket.IO server instance
# ---------------------------------------------------------------------------

# Translate the CORS list used by FastAPI into Socket.IO's expected format.
# ``CORS_ALLOWED_ORIGIN`` is ``["*"]`` when unconfigured, otherwise a list of
# explicit origins.
_cors_origins: str | list[str]
if CORS_ALLOWED_ORIGIN == ["*"]:
    _cors_origins = "*"
else:
    _cors_origins = CORS_ALLOWED_ORIGIN

sio = socketio.AsyncServer(
    async_mode="asgi",
    cors_allowed_origins=_cors_origins,
    # Generous timeouts to accommodate long-running tool executions
    # (web_search retries, open_url scraping, etc.) that can block
    # the async event loop for 30-60+ seconds.
    ping_interval=120,
    ping_timeout=60,
    logger=False,
    engineio_logger=False,
)


# ---------------------------------------------------------------------------
# Sub-session event mapping & helpers
# ---------------------------------------------------------------------------

# Maps Redis ``type`` field values published by Celery tasks to the
# Socket.IO event name emitted to the client.
_SUB_SESSION_EVENT_MAP: dict[str, str] = {
    "SUB_SESSION_SPAWNED": "agent:sub_session_spawned",
    "SUB_SESSION_PROGRESS": "agent:sub_session_progress",
    "SUB_SESSION_COMPLETE": "agent:sub_session_complete",
    "SUB_SESSION_FAILED": "agent:sub_session_failed",
    "SUB_SESSION_TIMEOUT": "agent:sub_session_failed",
}


async def emit_sub_session_event(
    parent_session_id: str,
    event_name: str,
    data: dict[str, Any],
) -> None:
    """Emit a sub-session event to the Socket.IO room for *parent_session_id*.

    This is the single entry point used both by the Redis bridge (for
    events originating in Celery workers) and by in-process code (e.g.
    the ``spawn_sub_session`` tool running in the API server).
    """
    room = f"session:{parent_session_id}"
    try:
        await sio.emit(event_name, data, room=room)
    except Exception:
        logger.warning(
            "Failed to emit %s to room %s",
            event_name,
            room,
            exc_info=True,
        )


# ---------------------------------------------------------------------------
# Redis Pub/Sub → Socket.IO bridge for sub-session events
# ---------------------------------------------------------------------------

_BRIDGE_CHANNEL_PATTERN = "sub_session_events:*"
_BRIDGE_STREAM_PATTERN = "sub_session_stream:*"
_BRIDGE_RECONNECT_DELAY_S = 3


async def _sub_session_event_bridge() -> None:
    """Long-running coroutine that subscribes to the Redis patterns
    ``sub_session_events:*`` and ``sub_session_stream:*`` and re-emits
    incoming messages to the appropriate Socket.IO room.

    - ``sub_session_events:*`` carries lifecycle events (spawned, progress,
      complete, failed) and is mapped through ``_SUB_SESSION_EVENT_MAP``.
    - ``sub_session_stream:*`` carries real-time streaming deltas (text,
      reasoning, tool activity) and is forwarded as-is with event name
      ``agent:sub_session_stream``.

    The coroutine reconnects automatically if the Redis connection drops.
    """
    from onyx.redis.redis_pool import get_async_redis_connection

    while True:
        pubsub = None
        try:
            redis = await get_async_redis_connection()
            pubsub = redis.pubsub()
            await pubsub.psubscribe(
                _BRIDGE_CHANNEL_PATTERN,
                _BRIDGE_STREAM_PATTERN,
            )
            logger.info(
                "Sub-session event bridge: subscribed to %s and %s",
                _BRIDGE_CHANNEL_PATTERN,
                _BRIDGE_STREAM_PATTERN,
            )

            while True:
                msg = await pubsub.get_message(
                    ignore_subscribe_messages=True,
                    timeout=30.0,
                )

                if msg is None:
                    # Timeout — no message, loop and poll again
                    continue

                if msg["type"] not in ("pmessage",):
                    continue

                # Extract channel name and parent_session_id.
                # Channel formats:
                #   ``sub_session_events:{parent_session_id}``
                #   ``sub_session_stream:{parent_session_id}``
                raw_channel: str | bytes = msg.get("channel", b"")
                if isinstance(raw_channel, bytes):
                    raw_channel = raw_channel.decode("utf-8")
                parts = raw_channel.split(":", 1)
                if len(parts) < 2:
                    continue
                channel_prefix = parts[0]
                parent_session_id = parts[1]

                # Parse the JSON payload
                raw_data: str | bytes = msg.get("data", b"")
                if isinstance(raw_data, bytes):
                    raw_data = raw_data.decode("utf-8")
                try:
                    payload: dict[str, Any] = json.loads(raw_data)
                except (json.JSONDecodeError, TypeError):
                    logger.warning(
                        "Sub-session event bridge: invalid JSON on channel %s",
                        raw_channel,
                    )
                    continue

                if channel_prefix == "sub_session_stream":
                    # Streaming delta from a Celery sub-session worker.
                    # Re-emit as standard agent events to the sub-session's
                    # own room so the thread panel's useAgentSocket receives
                    # them like any normal Socket.IO streaming session.
                    sub_session_id = payload.get("sub_session_id", "")
                    sub_room = f"session:{sub_session_id}"
                    stream_type = payload.get("type", "")

                    # Map SubSessionEmitter types → standard Socket.IO events
                    _STREAM_TYPE_MAP: dict[str, tuple[str, dict[str, Any]]] = {}
                    step = payload.get("step", 0)

                    if stream_type == "text_delta":
                        event_name = "agent:message_delta"
                        event_data = {
                            "session_id": sub_session_id,
                            "ind": step,
                            "content": payload.get("delta", ""),
                        }
                    elif stream_type == "reasoning_delta":
                        event_name = "agent:reasoning_delta"
                        event_data = {
                            "session_id": sub_session_id,
                            "ind": step,
                            "reasoning": payload.get("delta", ""),
                        }
                    elif stream_type == "tool_start":
                        event_name = "tool:start"
                        event_data = {
                            "session_id": sub_session_id,
                            "ind": step,
                            "tool_name": payload.get("tool_name", ""),
                        }
                    elif stream_type == "tool_result":
                        event_name = "tool:delta"
                        event_data = {
                            "session_id": sub_session_id,
                            "ind": step,
                            "tool_name": payload.get("tool_name", ""),
                            "tool_call_id": payload.get("tool_call_id", ""),
                            "response_type": "success",
                            "data": payload.get("result", ""),
                        }
                    elif stream_type == "section_end":
                        event_name = "agent:section_end"
                        event_data = {
                            "session_id": sub_session_id,
                            "ind": step,
                        }
                    else:
                        # Unknown stream type — skip
                        continue

                    try:
                        await sio.emit(event_name, event_data, room=sub_room)
                    except Exception:
                        logger.debug(
                            "Failed to emit %s to room %s",
                            event_name,
                            sub_room,
                            exc_info=True,
                        )
                    continue

                # Lifecycle event — map through _SUB_SESSION_EVENT_MAP
                event_type: str = payload.get("type", "")
                event_name = _SUB_SESSION_EVENT_MAP.get(event_type)
                if event_name is None:
                    logger.debug(
                        "Sub-session event bridge: unknown event type %s",
                        event_type,
                    )
                    continue

                # Inject parent_session_id into the payload for the client
                payload["parent_session_id"] = parent_session_id

                await emit_sub_session_event(
                    parent_session_id=parent_session_id,
                    event_name=event_name,
                    data=payload,
                )

        except asyncio.CancelledError:
            logger.info("Sub-session event bridge: shutting down")
            break
        except Exception:
            logger.warning(
                "Sub-session event bridge: error, reconnecting in %ds",
                _BRIDGE_RECONNECT_DELAY_S,
                exc_info=True,
            )
            await asyncio.sleep(_BRIDGE_RECONNECT_DELAY_S)
        finally:
            if pubsub is not None:
                try:
                    await pubsub.punsubscribe(
                        _BRIDGE_CHANNEL_PATTERN,
                        _BRIDGE_STREAM_PATTERN,
                    )
                    await pubsub.close()
                except Exception:
                    pass


_bridge_task: asyncio.Task[None] | None = None


def start_sub_session_event_bridge() -> None:
    """Launch the Redis→Socket.IO bridge as a background asyncio task.

    Safe to call multiple times; only the first call starts the task.
    Must be called from within a running asyncio event loop (e.g. from
    the FastAPI lifespan handler).
    """
    global _bridge_task
    if _bridge_task is not None and not _bridge_task.done():
        return

    loop = asyncio.get_running_loop()
    _bridge_task = loop.create_task(
        _sub_session_event_bridge(),
        name="sub_session_event_bridge",
    )
    logger.info("Sub-session event bridge task started")


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


async def _authenticate_from_token(token: str) -> User | None:
    """Validate a bearer/session token using the configured auth strategy.

    Supports both the Redis-backed and Postgres-backed strategies used by
    ``fastapi-users``.  Returns the ``User`` if the token is valid, otherwise
    ``None``.
    """
    from fastapi_users_db_sqlalchemy import SQLAlchemyUserDatabase
    from fastapi_users_db_sqlalchemy.access_token import (
        SQLAlchemyAccessTokenDatabase,
    )

    from onyx.auth.users import TenantAwareRedisStrategy
    from onyx.auth.users import RefreshableDatabaseStrategy

    async with get_async_session_context_manager() as async_db_session:
        user_db = SQLAlchemyUserDatabase(async_db_session, User, OAuthAccount)
        user_manager = UserManager(user_db)

        if AUTH_BACKEND == AuthBackend.REDIS:
            strategy = TenantAwareRedisStrategy()
        else:
            access_token_db = SQLAlchemyAccessTokenDatabase(
                async_db_session, AccessToken
            )
            strategy = RefreshableDatabaseStrategy(
                access_token_db, lifetime_seconds=SESSION_EXPIRE_TIME_SECONDS
            )

        user = await strategy.read_token(token, user_manager)
        return user


async def _authenticate_from_jwt(token: str) -> User | None:
    """Validate an external JWT (e.g. from Keycloak) when ``JWT_PUBLIC_KEY_URL``
    is configured.  Returns the ``User`` if the token resolves to a known
    user, otherwise ``None``.
    """
    from onyx.configs.app_configs import JWT_PUBLIC_KEY_URL

    if JWT_PUBLIC_KEY_URL is None:
        return None

    async with get_async_session_context_manager() as async_db_session:
        return await verify_jwt_token(token, async_db_session)


async def _authenticate_from_cookies(environ: dict[str, Any]) -> User | None:
    """Extract the ``fastapiusersauth`` cookie from the WSGI-style ``environ``
    dict that Engine.IO passes to the ``connect`` handler.  If the cookie is
    present, validate the token through the auth strategy.
    """
    raw_cookie: str | None = None

    # Engine.IO stores HTTP headers as a dict under ``HTTP_COOKIE`` (WSGI-style)
    # *or* passes an ``asgi.scope`` dict.  Handle both.
    if "HTTP_COOKIE" in environ:
        raw_cookie = environ["HTTP_COOKIE"]
    else:
        # When running under ASGI the scope is provided directly.
        scope: dict[str, Any] = environ.get("asgi.scope", {})
        headers: list[tuple[bytes, bytes]] = scope.get("headers", [])
        for name, value in headers:
            if name == b"cookie":
                raw_cookie = value.decode("latin-1")
                break

    if raw_cookie is None:
        return None

    cookie: SimpleCookie[str] = SimpleCookie()
    cookie.load(raw_cookie)

    morsel = cookie.get(FASTAPI_USERS_AUTH_COOKIE_NAME)
    if morsel is None:
        return None

    token = morsel.value
    if not token:
        return None

    return await _authenticate_from_token(token)


async def _authenticate(
    auth: dict[str, Any] | None,
    environ: dict[str, Any],
) -> User | None:
    """Authenticate the connecting client.

    The client may supply credentials in two ways (tried in order):

    1. **``auth`` dict** -- passed by the Socket.IO client as part of the
       handshake.  We look for ``auth["token"]``.  The token is first checked
       as a session token (cookie-style), then as an external JWT.
    2. **Cookies** -- the browser automatically sends cookies; we extract the
       ``fastapiusersauth`` cookie.

    When ``DISABLE_AUTH`` is ``True`` (auth type is ``disabled``), the
    connection is accepted unconditionally and ``None`` is returned for the
    user -- matching the behaviour of ``current_user`` in FastAPI endpoints.

    Returns the authenticated ``User``, or ``None`` when auth is disabled.
    """
    # --- auth disabled (dev mode) -------------------------------------------
    if DISABLE_AUTH:
        # Mirrors the FastAPI current_user path: user is None
        return None

    # --- try explicit token from auth dict -----------------------------------
    if auth and isinstance(auth, dict):
        token = auth.get("token")
        if token and isinstance(token, str):
            # Try session token first (Redis/Postgres strategy)
            user = await _authenticate_from_token(token)
            if user is not None:
                return user

            # Fall back to external JWT validation
            user = await _authenticate_from_jwt(token)
            if user is not None:
                return user

    # --- try cookies ---------------------------------------------------------
    user = await _authenticate_from_cookies(environ)
    if user is not None:
        return user

    return None


# ---------------------------------------------------------------------------
# Socket.IO event handlers
# ---------------------------------------------------------------------------


@sio.event
async def connect(
    sid: str,
    environ: dict[str, Any],
    auth: dict[str, Any] | None = None,
) -> bool | None:
    """Authenticate on connection using token or cookies.

    On success the user ID and email are stored in the Socket.IO session so
    that subsequent event handlers can retrieve them via
    ``sio.get_session(sid)``.

    Raises ``ConnectionRefusedError`` if authentication fails (when auth is
    enabled).
    """
    if DISABLE_AUTH:
        # Accept unconditionally; no user context to save.
        await sio.save_session(sid, {"user_id": None, "user_email": None})
        logger.info(
            "Socket.IO client connected — auth disabled (sid=%s)", sid
        )
        return True

    user = await _authenticate(auth, environ)
    if user is None:
        logger.warning(
            "Socket.IO connect rejected — authentication failed (sid=%s)", sid
        )
        raise socketio.exceptions.ConnectionRefusedError(
            "Authentication required"
        )

    await sio.save_session(
        sid, {"user_id": str(user.id), "user_email": user.email}
    )
    logger.info(
        "Socket.IO client connected (sid=%s, user=%s)",
        sid,
        user.email,
    )
    return True


@sio.event
async def disconnect(sid: str) -> None:
    """Handle client disconnect.

    If the session was in ``RUNNING`` state (LLM streaming), we set the
    stop flag so the ``_run_llm_turn`` coroutine picks it up on the next
    periodic check and cancels gracefully.

    If the session was ``AWAITING_TOOL`` or ``AWAITING_APPROVAL``, we
    leave the status as-is -- the client will reconnect and resend the
    tool result or approval.
    """
    session_data: dict[str, Any] = await sio.get_session(sid)
    logger.info(
        "Socket.IO client disconnected (sid=%s, user=%s)",
        sid,
        session_data.get("user_email", "unknown"),
    )
    # Note: We do NOT proactively cancel a RUNNING session on disconnect
    # because the _run_llm_turn coroutine is running in the same async
    # task as the event handler -- when the handler finishes (naturally
    # or via stop flag), the status is cleaned up.  If the connection
    # drops mid-stream, the coroutine is already running and will detect
    # the disconnect when it tries to emit.  For AWAITING_* states,
    # the server has nothing running, so no cleanup is needed.


# ---------------------------------------------------------------------------
# Agent event handlers
# ---------------------------------------------------------------------------


def _create_handler(session_data: dict[str, Any], sid: str) -> "AgentHandler":
    """Instantiate a fresh AgentHandler from the Socket.IO session."""
    from onyx.server.agent.agent_handler import AgentHandler

    return AgentHandler(
        user_id=session_data.get("user_id"),
        user_email=session_data.get("user_email"),
        sid=sid,
        sio=sio,
        model=session_data.get("model"),
        workspace_path=session_data.get("workspace_path"),
        timezone=session_data.get("timezone"),
        search_query=session_data.get("search_query", ""),
    )


@sio.on("agent:execute")
async def handle_execute(sid: str, data: dict[str, Any]) -> dict[str, Any]:
    """Start agent execution for a session.

    Returns an ack dict: ``{"session_id": ...}`` on success, or
    ``{"error": ..., "code": ...}`` on failure.
    """
    try:
        session_data: dict[str, Any] = await sio.get_session(sid)
        # Persist model/timezone so handle_tool_result can use them
        # for the follow-up LLM turn (otherwise it falls back to default).
        if data.get("model"):
            session_data["model"] = data["model"]
        if data.get("timezone"):
            session_data["timezone"] = data["timezone"]
        if data.get("workspace_path"):
            session_data["workspace_path"] = data["workspace_path"]
        # Persist original message for memory search + skill discovery
        # on subsequent turns (build_agent_run_context search_query param).
        session_data["search_query"] = data.get("message", "")
        await sio.save_session(sid, session_data)

        # Join the session room so that emits reach this sid (and survive
        # reconnects — the client re-joins via agent:rejoin).
        session_id = data.get("session_id", "")
        if session_id:
            await sio.enter_room(sid, f"session:{session_id}")

        handler = _create_handler(session_data, sid)
        result: dict[str, Any] = await handler.handle_execute(data)
        return result
    except Exception as exc:
        logger.exception("agent:execute error (sid=%s)", sid)
        return {"error": str(exc), "code": "INTERNAL_ERROR"}


@sio.on("tool:result")
async def handle_tool_result(sid: str, data: dict[str, Any]) -> None:
    """Submit the result of a local tool execution."""
    try:
        session_data: dict[str, Any] = await sio.get_session(sid)

        # Ensure this (possibly reconnected) sid is in the session room.
        session_id = data.get("session_id", "")
        if session_id:
            await sio.enter_room(sid, f"session:{session_id}")

        handler = _create_handler(session_data, sid)
        await handler.handle_tool_result(data)
    except Exception:
        logger.exception("tool:result error (sid=%s)", sid)
        # Emit agent:error for the session if possible
        session_id = data.get("session_id", "")
        if session_id:
            await sio.emit(
                "agent:error",
                {"session_id": session_id, "error": "Internal server error processing tool result"},
                room=f"session:{session_id}",
            )


@sio.on("tool:approval")
async def handle_approval(sid: str, data: dict[str, Any]) -> None:
    """Submit a user's approval or denial for a tool."""
    try:
        session_data: dict[str, Any] = await sio.get_session(sid)

        # Ensure this (possibly reconnected) sid is in the session room.
        session_id = data.get("session_id", "")
        if session_id:
            await sio.enter_room(sid, f"session:{session_id}")

        handler = _create_handler(session_data, sid)
        await handler.handle_approval(data)
    except Exception:
        logger.exception("tool:approval error (sid=%s)", sid)
        session_id = data.get("session_id", "")
        if session_id:
            await sio.emit(
                "agent:error",
                {"session_id": session_id, "error": "Internal server error processing approval"},
                room=f"session:{session_id}",
            )


@sio.on("agent:stop")
async def handle_stop(sid: str, data: dict[str, Any]) -> dict[str, Any]:
    """Stop a running agent execution.

    Returns an ack dict.
    """
    try:
        session_data: dict[str, Any] = await sio.get_session(sid)
        handler = _create_handler(session_data, sid)
        result: dict[str, Any] = await handler.handle_stop(data)
        return result
    except Exception as exc:
        logger.exception("agent:stop error (sid=%s)", sid)
        return {"error": str(exc), "code": "INTERNAL_ERROR"}


@sio.on("tool:delta")
async def handle_tool_delta(sid: str, data: dict[str, Any]) -> None:
    """Receive streaming tool output from the client.

    For display only -- the server does not act on partial output.  It
    is logged for debugging but no processing occurs until ``tool:result``
    arrives.
    """
    # No-op on the server side.  The client streams partial output for
    # display purposes and the server ignores it until the final
    # tool:result arrives.
    pass


@sio.on("file:sync")
async def handle_file_sync(sid: str, data: dict[str, Any]) -> None:
    """Sync a workspace file from the client."""
    try:
        session_data: dict[str, Any] = await sio.get_session(sid)
        handler = _create_handler(session_data, sid)
        await handler.handle_file_sync(data)
    except Exception:
        logger.exception("file:sync error (sid=%s)", sid)


@sio.on("agent:rejoin")
async def handle_rejoin(sid: str, data: dict[str, Any]) -> dict[str, Any]:
    """Re-join a session room after reconnecting.

    When the Socket.IO connection drops (e.g. OAuth token refresh) and
    reconnects with a new sid, the client emits ``agent:rejoin`` with the
    ``session_id`` it was working on.  This adds the new sid to the
    session's room so that the in-flight LLM coroutine's emits (which
    target the room) reach the reconnected client.
    """
    session_id: str = data.get("session_id", "")
    if not session_id:
        return {"error": "session_id required"}

    await sio.enter_room(sid, f"session:{session_id}")
    session_data: dict[str, Any] = await sio.get_session(sid)
    logger.info(
        "Socket.IO client re-joined session room (sid=%s, user=%s, session=%s)",
        sid,
        session_data.get("user_email", "unknown"),
        session_id,
    )
    return {"ok": True, "session_id": session_id}
