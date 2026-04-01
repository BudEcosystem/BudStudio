"""Fixtures and helpers for sub-session integration tests.

All helpers use raw HTTP calls via ``requests`` against the running
Onyx deployment.  No mocking is allowed in integration tests.
"""

from typing import Any

import pytest
import requests

from tests.integration.common_utils.constants import API_SERVER_URL
from tests.integration.common_utils.test_models import DATestUser


# ==============================================================================
# Helper Functions (shared across all sub-session test modules)
# ==============================================================================


def create_agent_session(
    user: DATestUser,
    title: str | None = None,
    workspace_path: str | None = None,
) -> dict[str, Any]:
    """Create a parent agent session and return the response JSON."""
    payload: dict[str, Any] = {}
    if title is not None:
        payload["title"] = title
    if workspace_path is not None:
        payload["workspace_path"] = workspace_path

    response = requests.post(
        f"{API_SERVER_URL}/agent/sessions",
        json=payload,
        headers=user.headers,
        cookies=user.cookies,
    )
    response.raise_for_status()
    return response.json()


def delete_agent_session(
    user: DATestUser,
    session_id: str,
) -> requests.Response:
    """Delete an agent session."""
    return requests.delete(
        f"{API_SERVER_URL}/agent/sessions/{session_id}",
        headers=user.headers,
        cookies=user.cookies,
    )


def get_agent_session(
    user: DATestUser,
    session_id: str,
) -> requests.Response:
    """Get a specific agent session by ID."""
    return requests.get(
        f"{API_SERVER_URL}/agent/sessions/{session_id}",
        headers=user.headers,
        cookies=user.cookies,
    )


def spin_off_sub_session(
    user: DATestUser,
    parent_session_id: str,
    task: str,
    task_context: str | None = None,
    mode: str = "one_shot",
    max_turns: int | None = None,
) -> requests.Response:
    """POST /agent/sessions/{id}/spin-off to spawn a sub-session."""
    payload: dict[str, Any] = {"task": task, "mode": mode}
    if task_context is not None:
        payload["task_context"] = task_context
    if max_turns is not None:
        payload["max_turns"] = max_turns

    return requests.post(
        f"{API_SERVER_URL}/agent/sessions/{parent_session_id}/spin-off",
        json=payload,
        headers=user.headers,
        cookies=user.cookies,
    )


def cancel_sub_session(
    user: DATestUser,
    session_id: str,
    reason: str | None = None,
) -> requests.Response:
    """POST /agent/sessions/{id}/cancel to cancel a sub-session."""
    payload: dict[str, Any] = {}
    if reason is not None:
        payload["reason"] = reason

    return requests.post(
        f"{API_SERVER_URL}/agent/sessions/{session_id}/cancel",
        json=payload,
        headers=user.headers,
        cookies=user.cookies,
    )


def list_sub_sessions(
    user: DATestUser,
    parent_session_id: str,
    status_filter: str | None = None,
    limit: int | None = None,
) -> requests.Response:
    """GET /agent/sessions/{id}/sub-sessions to list sub-sessions."""
    params: dict[str, Any] = {}
    if status_filter is not None:
        params["status_filter"] = status_filter
    if limit is not None:
        params["limit"] = limit

    return requests.get(
        f"{API_SERVER_URL}/agent/sessions/{parent_session_id}/sub-sessions",
        params=params,
        headers=user.headers,
        cookies=user.cookies,
    )


def get_sub_session_thread(
    user: DATestUser,
    session_id: str,
) -> requests.Response:
    """GET /agent/sessions/{id}/thread to get sub-session messages."""
    return requests.get(
        f"{API_SERVER_URL}/agent/sessions/{session_id}/thread",
        headers=user.headers,
        cookies=user.cookies,
    )


def send_followup(
    user: DATestUser,
    session_id: str,
    message: str,
) -> requests.Response:
    """POST /agent/sessions/{id}/followup to send a follow-up message."""
    return requests.post(
        f"{API_SERVER_URL}/agent/sessions/{session_id}/followup",
        json={"message": message},
        headers=user.headers,
        cookies=user.cookies,
    )


def update_session_status(
    user: DATestUser,
    session_id: str,
    status: str,
) -> requests.Response:
    """PATCH /agent/sessions/{id}/status to update session status."""
    return requests.patch(
        f"{API_SERVER_URL}/agent/sessions/{session_id}/status",
        json={"status": status},
        headers=user.headers,
        cookies=user.cookies,
    )


def get_session_history(
    user: DATestUser,
    session_id: str,
    limit: int | None = None,
    offset: int = 0,
) -> requests.Response:
    """GET /agent/sessions/{id}/history to get message history."""
    params: dict[str, Any] = {"offset": offset}
    if limit is not None:
        params["limit"] = limit

    return requests.get(
        f"{API_SERVER_URL}/agent/sessions/{session_id}/history",
        params=params,
        headers=user.headers,
        cookies=user.cookies,
    )


def add_message(
    user: DATestUser,
    session_id: str,
    role: str,
    content: str | None = None,
    tool_name: str | None = None,
    tool_input: dict[str, Any] | None = None,
    tool_output: dict[str, Any] | None = None,
    tool_error: str | None = None,
) -> requests.Response:
    """POST /agent/sessions/{id}/messages to add a message."""
    payload: dict[str, Any] = {"role": role}
    if content is not None:
        payload["content"] = content
    if tool_name is not None:
        payload["tool_name"] = tool_name
    if tool_input is not None:
        payload["tool_input"] = tool_input
    if tool_output is not None:
        payload["tool_output"] = tool_output
    if tool_error is not None:
        payload["tool_error"] = tool_error

    return requests.post(
        f"{API_SERVER_URL}/agent/sessions/{session_id}/messages",
        json=payload,
        headers=user.headers,
        cookies=user.cookies,
    )


# ==============================================================================
# Fixtures
# ==============================================================================


@pytest.fixture
def parent_session(admin_user: DATestUser) -> dict[str, Any]:
    """Create a parent agent session for sub-session tests.

    Yields the session creation response (contains ``session_id``).
    Cleans up after the test.
    """
    result = create_agent_session(
        user=admin_user,
        title="Sub-session integration test parent",
        workspace_path="/tmp/test-workspace",
    )

    yield result  # type: ignore[misc]

    # Cleanup: best-effort deletion (may already be gone)
    try:
        delete_agent_session(admin_user, result["session_id"])
    except Exception:
        pass
