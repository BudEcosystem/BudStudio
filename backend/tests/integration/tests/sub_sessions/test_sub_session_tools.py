"""Integration tests for sub-session tool invocations (Phase 4D remaining).

Tests cover:
- 4D.7: Spin-off from a user message (tool initiated by user context)
- 4D.8: Spin-off from an agent message (tool initiated by agent context)

These tests exercise the spin-off endpoint with different task_context
sources, verifying that sub-sessions can be spawned whether the triggering
context comes from a user message or an agent-generated message.
"""

import time
from typing import Any

from tests.integration.common_utils.test_models import DATestUser
from tests.integration.tests.sub_sessions.conftest import (
    add_message,
    create_agent_session,
    delete_agent_session,
    get_agent_session,
    get_sub_session_thread,
    list_sub_sessions,
    spin_off_sub_session,
)

_WAIT_TIMEOUT_S = 120
_POLL_INTERVAL_S = 2


def _wait_for_terminal(
    user: DATestUser,
    session_id: str,
    timeout: int = _WAIT_TIMEOUT_S,
) -> dict[str, Any]:
    """Poll until terminal status."""
    deadline = time.time() + timeout
    while time.time() < deadline:
        resp = get_agent_session(user, session_id)
        if resp.status_code == 200:
            data = resp.json()
            if data.get("status") in ("COMPLETED", "FAILED", "STOPPED"):
                return data
        time.sleep(_POLL_INTERVAL_S)
    raise TimeoutError(f"Session {session_id} did not complete within {timeout}s")


# ==============================================================================
# 4D.7: Spin-off from user message context
# ==============================================================================


def test_spin_off_from_user_message(
    admin_user: DATestUser,
) -> None:
    """Spawn a sub-session where the task_context is derived from a user
    message in the parent session. This simulates the scenario where
    the agent decides to delegate part of a user's request.

    Steps:
    1. Create parent session.
    2. Add a user message to the parent.
    3. Spin off a sub-session using the user message as task_context.
    4. Verify the sub-session was created and processes the context.
    """
    session_data = create_agent_session(
        user=admin_user,
        title="Spin-off from user message test",
    )
    parent_id = session_data["session_id"]

    try:
        # Add a user message to establish context
        user_msg = (
            "Please analyze the authentication module and identify "
            "any potential security vulnerabilities."
        )
        msg_resp = add_message(
            user=admin_user,
            session_id=parent_id,
            role="user",
            content=user_msg,
        )
        assert msg_resp.status_code == 200

        # Spin off a sub-session using the user message as context
        resp = spin_off_sub_session(
            user=admin_user,
            parent_session_id=parent_id,
            task="Analyze authentication module for security vulnerabilities.",
            task_context=user_msg,
            mode="one_shot",
            max_turns=3,
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data.get("status") == "accepted"
        sub_id = data["session_id"]

        # Verify the sub-session exists
        detail_resp = get_agent_session(admin_user, sub_id)
        assert detail_resp.status_code == 200

        # Verify it is listed under the parent
        list_resp = list_sub_sessions(admin_user, parent_id)
        assert list_resp.status_code == 200
        sub_ids = [s["session_id"] for s in list_resp.json()["sub_sessions"]]
        assert sub_id in sub_ids

        # Wait for completion
        result = _wait_for_terminal(admin_user, sub_id)
        assert result["status"] in ("COMPLETED", "FAILED")

        # Verify the sub-session thread contains a user message with the task
        thread_resp = get_sub_session_thread(admin_user, sub_id)
        assert thread_resp.status_code == 200
        thread = thread_resp.json()
        assert len(thread["messages"]) > 0
        # The first message should be the task description as a user message
        first_msg = thread["messages"][0]
        assert first_msg["role"] == "user"

    finally:
        delete_agent_session(admin_user, parent_id)


# ==============================================================================
# 4D.8: Spin-off from agent message context
# ==============================================================================


def test_spin_off_from_agent_message(
    admin_user: DATestUser,
) -> None:
    """Spawn a sub-session where the task_context is derived from an
    agent (assistant) message in the parent session. This simulates
    the scenario where the agent creates a plan and delegates sub-tasks.

    Steps:
    1. Create parent session.
    2. Add an assistant message with a plan.
    3. Spin off a sub-session for one of the plan steps.
    4. Verify the sub-session processes correctly.
    """
    session_data = create_agent_session(
        user=admin_user,
        title="Spin-off from agent message test",
    )
    parent_id = session_data["session_id"]

    try:
        # Add a user message
        msg_resp = add_message(
            user=admin_user,
            session_id=parent_id,
            role="user",
            content="Help me refactor the database layer.",
        )
        assert msg_resp.status_code == 200

        # Add an assistant message with a plan
        agent_plan = (
            "I'll break this into three sub-tasks:\n"
            "1. Audit current schema definitions\n"
            "2. Identify redundant queries\n"
            "3. Propose migration strategy"
        )
        plan_resp = add_message(
            user=admin_user,
            session_id=parent_id,
            role="assistant",
            content=agent_plan,
        )
        assert plan_resp.status_code == 200

        # Spin off a sub-session for sub-task 1, using agent context
        resp = spin_off_sub_session(
            user=admin_user,
            parent_session_id=parent_id,
            task="Audit current schema definitions and report findings.",
            task_context=agent_plan,
            mode="one_shot",
            max_turns=3,
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data.get("status") == "accepted"
        sub_id = data["session_id"]

        # Verify the sub-session exists
        detail_resp = get_agent_session(admin_user, sub_id)
        assert detail_resp.status_code == 200

        # Verify it is listed under the parent
        list_resp = list_sub_sessions(admin_user, parent_id)
        assert list_resp.status_code == 200
        sub_ids = [s["session_id"] for s in list_resp.json()["sub_sessions"]]
        assert sub_id in sub_ids

        # Wait for completion
        result = _wait_for_terminal(admin_user, sub_id)
        assert result["status"] in ("COMPLETED", "FAILED")

    finally:
        delete_agent_session(admin_user, parent_id)
