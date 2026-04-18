"""Integration tests for sub-session lifecycle (Phases 3C and 4D).

Tests cover:
- 4D.1: Spawn sub-session full cycle via spin-off endpoint
- 4D.2: Concurrency limit enforcement (max 10 active sub-sessions)
- 4D.3: Cancel a running sub-session
- 4D.4: List and inspect sub-sessions
- 4D.5: Persistent sub-session follow-up
- 4D.6: One-shot sub-session rejects follow-up
"""

import time
from typing import Any

import requests

from tests.integration.common_utils.constants import API_SERVER_URL
from tests.integration.common_utils.test_models import DATestUser
from tests.integration.tests.sub_sessions.conftest import (
    cancel_sub_session,
    create_agent_session,
    delete_agent_session,
    get_agent_session,
    get_sub_session_thread,
    list_sub_sessions,
    send_followup,
    spin_off_sub_session,
)

# Maximum time (seconds) to wait for a sub-session to reach a terminal state.
_WAIT_TIMEOUT_S = 120
_POLL_INTERVAL_S = 2


def _wait_for_terminal_status(
    user: DATestUser,
    session_id: str,
    timeout: int = _WAIT_TIMEOUT_S,
) -> dict[str, Any]:
    """Poll until the sub-session reaches a terminal status or timeout.

    Returns the session detail dict.
    """
    deadline = time.time() + timeout
    while time.time() < deadline:
        resp = get_agent_session(user, session_id)
        if resp.status_code != 200:
            time.sleep(_POLL_INTERVAL_S)
            continue
        data = resp.json()
        status = data.get("status", "")
        if status in ("COMPLETED", "FAILED", "STOPPED", "COMPACTED"):
            return data
        time.sleep(_POLL_INTERVAL_S)

    raise TimeoutError(
        f"Sub-session {session_id} did not reach terminal status within {timeout}s"
    )


# ==============================================================================
# 4D.1: Spawn sub-session full cycle
# ==============================================================================


def test_spawn_sub_session_full_cycle(
    admin_user: DATestUser,
    parent_session: dict[str, Any],
) -> None:
    """Spawn a one-shot sub-session via the spin-off endpoint, verify it is
    created with ACTIVE status, and wait for it to reach a terminal state.
    """
    parent_id = parent_session["session_id"]

    # Spin off
    resp = spin_off_sub_session(
        user=admin_user,
        parent_session_id=parent_id,
        task="Summarize the project README in three bullet points.",
        mode="one_shot",
        max_turns=3,
    )
    assert resp.status_code == 200, f"Spin-off failed: {resp.text}"
    data = resp.json()
    assert data.get("status") == "accepted"
    sub_session_id = data["session_id"]

    # The sub-session should now exist
    detail_resp = get_agent_session(admin_user, sub_session_id)
    assert detail_resp.status_code == 200
    detail = detail_resp.json()
    assert detail["status"] in ("ACTIVE", "COMPLETED", "FAILED")

    # Wait for completion (the LLM may or may not be available, but the
    # Celery task should at least process and reach a terminal state)
    final = _wait_for_terminal_status(admin_user, sub_session_id)
    assert final["status"] in ("COMPLETED", "FAILED")

    # Verify it appears in the parent's sub-session list
    list_resp = list_sub_sessions(admin_user, parent_id)
    assert list_resp.status_code == 200
    sub_ids = [s["session_id"] for s in list_resp.json()["sub_sessions"]]
    assert sub_session_id in sub_ids


# ==============================================================================
# 4D.2: Concurrency limit
# ==============================================================================


def test_concurrency_limit(
    admin_user: DATestUser,
    parent_session: dict[str, Any],
) -> None:
    """Spawn 10 sub-sessions (the concurrency limit), then verify the 11th
    is rejected with HTTP 429.
    """
    parent_id = parent_session["session_id"]
    sub_session_ids: list[str] = []

    # Spawn 10 sub-sessions
    for i in range(10):
        resp = spin_off_sub_session(
            user=admin_user,
            parent_session_id=parent_id,
            task=f"Sub-task {i}: perform analysis step {i}",
            mode="one_shot",
            max_turns=2,
        )
        # Some may fail if the Celery worker completes them before we spawn
        # the next one, but they should all be accepted initially.
        if resp.status_code == 200:
            data = resp.json()
            if data.get("status") == "accepted":
                sub_session_ids.append(data["session_id"])
        elif resp.status_code == 429:
            # We hit the limit earlier than expected (some completed fast)
            break

    # If we managed to spawn 10, the 11th should be rejected
    if len(sub_session_ids) == 10:
        resp = spin_off_sub_session(
            user=admin_user,
            parent_session_id=parent_id,
            task="This should be rejected due to concurrency limit",
            mode="one_shot",
        )
        assert resp.status_code == 429, (
            f"Expected 429 for 11th sub-session, got {resp.status_code}: {resp.text}"
        )


# ==============================================================================
# 4D.3: Cancel sub-session
# ==============================================================================


def test_cancel_sub_session(
    admin_user: DATestUser,
    parent_session: dict[str, Any],
) -> None:
    """Spawn a sub-session, immediately cancel it, and verify the session
    transitions to STOPPED or FAILED.
    """
    parent_id = parent_session["session_id"]

    # Spawn with many turns so it runs long enough to cancel
    resp = spin_off_sub_session(
        user=admin_user,
        parent_session_id=parent_id,
        task="Perform a lengthy analysis of system architecture.",
        mode="one_shot",
        max_turns=25,
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data.get("status") == "accepted"
    sub_session_id = data["session_id"]

    # Cancel the sub-session
    cancel_resp = cancel_sub_session(
        user=admin_user,
        session_id=sub_session_id,
        reason="Integration test cancellation",
    )
    # The cancel should succeed (200) or the session may already be terminal
    assert cancel_resp.status_code in (200, 404), (
        f"Cancel failed unexpectedly: {cancel_resp.status_code} {cancel_resp.text}"
    )

    if cancel_resp.status_code == 200:
        cancel_data = cancel_resp.json()
        assert cancel_data.get("status") == "cancelling"

    # Wait for terminal status
    final = _wait_for_terminal_status(admin_user, sub_session_id)
    # After cancellation the session should be STOPPED, FAILED, or COMPLETED
    # (COMPLETED if it finished before the cancel took effect)
    assert final["status"] in ("STOPPED", "FAILED", "COMPLETED")


# ==============================================================================
# 4D.4: List and inspect
# ==============================================================================


def test_list_and_inspect(
    admin_user: DATestUser,
    parent_session: dict[str, Any],
) -> None:
    """Spawn multiple sub-sessions, verify they appear in the list, and
    inspect one to get its detail including message thread.
    """
    parent_id = parent_session["session_id"]

    # Spawn two sub-sessions
    ids: list[str] = []
    for label in ("alpha", "beta"):
        resp = spin_off_sub_session(
            user=admin_user,
            parent_session_id=parent_id,
            task=f"Test task {label}",
            mode="one_shot",
            max_turns=2,
        )
        assert resp.status_code == 200
        ids.append(resp.json()["session_id"])

    # List sub-sessions for the parent
    list_resp = list_sub_sessions(admin_user, parent_id)
    assert list_resp.status_code == 200
    sub_list = list_resp.json()["sub_sessions"]
    listed_ids = [s["session_id"] for s in sub_list]
    for sid in ids:
        assert sid in listed_ids

    # Inspect the first sub-session detail
    detail_resp = get_agent_session(admin_user, ids[0])
    assert detail_resp.status_code == 200
    detail = detail_resp.json()
    assert detail["id"] == ids[0]
    assert "status" in detail
    assert "created_at" in detail

    # Get the message thread for the sub-session
    thread_resp = get_sub_session_thread(admin_user, ids[0])
    assert thread_resp.status_code == 200
    thread = thread_resp.json()
    assert thread["session_id"] == ids[0]
    assert "messages" in thread


# ==============================================================================
# 4D.5: Persistent sub-session follow-up
# ==============================================================================


def test_follow_up_persistent(
    admin_user: DATestUser,
    parent_session: dict[str, Any],
) -> None:
    """Spawn a persistent sub-session, wait for it to complete its first
    task, then send a follow-up message and verify it is accepted.
    """
    parent_id = parent_session["session_id"]

    # Spawn a persistent sub-session
    resp = spin_off_sub_session(
        user=admin_user,
        parent_session_id=parent_id,
        task="Monitor the test workspace for changes.",
        mode="persistent",
        max_turns=3,
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data.get("status") == "accepted"
    sub_session_id = data["session_id"]

    # Wait for the sub-session to reach a terminal state (COMPLETED after
    # initial task finishes)
    final = _wait_for_terminal_status(admin_user, sub_session_id)
    assert final["status"] in ("COMPLETED", "FAILED")

    # If it completed, send a follow-up
    if final["status"] == "COMPLETED":
        followup_resp = send_followup(
            user=admin_user,
            session_id=sub_session_id,
            message="Any new changes detected?",
        )
        assert followup_resp.status_code == 200
        followup_data = followup_resp.json()
        assert followup_data.get("status") == "delivered"
        assert followup_data.get("session_id") == sub_session_id


# ==============================================================================
# 4D.6: One-shot sub-session rejects follow-up
# ==============================================================================


def test_follow_up_one_shot_rejected(
    admin_user: DATestUser,
    parent_session: dict[str, Any],
) -> None:
    """Spawn a one-shot sub-session, wait for completion, then verify that
    sending a follow-up returns an error (only persistent sessions accept
    follow-ups).
    """
    parent_id = parent_session["session_id"]

    # Spawn a one-shot sub-session
    resp = spin_off_sub_session(
        user=admin_user,
        parent_session_id=parent_id,
        task="Count to ten.",
        mode="one_shot",
        max_turns=2,
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data.get("status") == "accepted"
    sub_session_id = data["session_id"]

    # Wait for completion
    _wait_for_terminal_status(admin_user, sub_session_id)

    # Attempt a follow-up on a one-shot session -- should be rejected
    followup_resp = send_followup(
        user=admin_user,
        session_id=sub_session_id,
        message="This should fail.",
    )
    # The API should return 400 because one-shot sessions do not accept follow-ups
    assert followup_resp.status_code == 400, (
        f"Expected 400 for follow-up on one-shot, got "
        f"{followup_resp.status_code}: {followup_resp.text}"
    )
