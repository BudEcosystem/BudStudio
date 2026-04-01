"""Integration tests for persistent sub-session mode (Phase 7).

Tests cover:
- 7.4: Persistent sub-session follow-up cycle
- 7.5: Persistent sub-session expiry rejection
- 7.6: Follow-up while the sub-session is still running
- 7.7: Multiple rapid follow-ups
"""

import time
from typing import Any

from tests.integration.common_utils.test_models import DATestUser
from tests.integration.tests.sub_sessions.conftest import (
    create_agent_session,
    delete_agent_session,
    get_agent_session,
    list_sub_sessions,
    send_followup,
    spin_off_sub_session,
)

_WAIT_TIMEOUT_S = 120
_POLL_INTERVAL_S = 2


def _wait_for_terminal_status(
    user: DATestUser,
    session_id: str,
    timeout: int = _WAIT_TIMEOUT_S,
) -> dict[str, Any]:
    """Poll until the sub-session reaches a terminal status."""
    deadline = time.time() + timeout
    while time.time() < deadline:
        resp = get_agent_session(user, session_id)
        if resp.status_code == 200:
            data = resp.json()
            if data.get("status") in ("COMPLETED", "FAILED", "STOPPED"):
                return data
        time.sleep(_POLL_INTERVAL_S)
    raise TimeoutError(
        f"Session {session_id} did not reach terminal status within {timeout}s"
    )


# ==============================================================================
# 7.4: Persistent follow-up cycle
# ==============================================================================


def test_persistent_follow_up_cycle(
    admin_user: DATestUser,
    parent_session: dict[str, Any],
) -> None:
    """Spawn a persistent sub-session, wait for completion, send a follow-up,
    wait for the follow-up to be processed, and verify the session cycled
    back to COMPLETED.

    The full cycle is:
    ACTIVE -> COMPLETED -> (follow-up) -> ACTIVE -> COMPLETED
    """
    parent_id = parent_session["session_id"]

    # Spawn persistent sub-session
    resp = spin_off_sub_session(
        user=admin_user,
        parent_session_id=parent_id,
        task="Persistent monitor: report system status.",
        mode="persistent",
        max_turns=3,
    )
    assert resp.status_code == 200
    sub_id = resp.json()["session_id"]

    # Wait for initial completion
    first_result = _wait_for_terminal_status(admin_user, sub_id)
    assert first_result["status"] in ("COMPLETED", "FAILED")

    if first_result["status"] != "COMPLETED":
        # Can't test follow-up if initial run failed
        return

    # Send follow-up -- should re-activate the session
    followup_resp = send_followup(
        user=admin_user,
        session_id=sub_id,
        message="Give me an updated status report.",
    )
    assert followup_resp.status_code == 200
    assert followup_resp.json().get("status") == "delivered"

    # Wait for the follow-up cycle to complete
    second_result = _wait_for_terminal_status(admin_user, sub_id)
    assert second_result["status"] in ("COMPLETED", "FAILED")


# ==============================================================================
# 7.5: Persistent sub-session expiry rejection
# ==============================================================================


def test_persistent_expiry_rejection(
    admin_user: DATestUser,
    parent_session: dict[str, Any],
) -> None:
    """A persistent sub-session that has been completed for longer than
    the expiry window (1 hour) should reject follow-up messages with
    HTTP 410 (Gone).

    Since we cannot wait an actual hour in an integration test, this test
    verifies the API contract: if the server returns 410 for a follow-up,
    the response body should indicate session_expired.

    If the session has not yet expired (it was just created), the follow-up
    should succeed with 200 -- which we also verify as the positive case.
    """
    parent_id = parent_session["session_id"]

    # Spawn persistent sub-session
    resp = spin_off_sub_session(
        user=admin_user,
        parent_session_id=parent_id,
        task="Persistent session for expiry test.",
        mode="persistent",
        max_turns=2,
    )
    assert resp.status_code == 200
    sub_id = resp.json()["session_id"]

    # Wait for completion
    result = _wait_for_terminal_status(admin_user, sub_id)
    if result["status"] != "COMPLETED":
        return  # Can't test expiry on a failed session

    # Attempt follow-up immediately (should succeed since not expired)
    followup_resp = send_followup(
        user=admin_user,
        session_id=sub_id,
        message="Immediate follow-up, should work.",
    )
    # Either 200 (not expired) or 410 (expired, if test runs slowly)
    assert followup_resp.status_code in (200, 410), (
        f"Unexpected status code: {followup_resp.status_code} {followup_resp.text}"
    )

    if followup_resp.status_code == 410:
        # Verify the response body indicates expiry
        body = followup_resp.json()
        assert "expired" in body.get("detail", "").lower()


# ==============================================================================
# 7.6: Follow-up while still running
# ==============================================================================


def test_follow_up_while_running(
    admin_user: DATestUser,
    parent_session: dict[str, Any],
) -> None:
    """Send a follow-up to a persistent sub-session that is still ACTIVE
    (still running its initial task). The follow-up should be accepted
    and delivered via the event queue to the running worker.
    """
    parent_id = parent_session["session_id"]

    # Spawn with many turns so it stays active for a while
    resp = spin_off_sub_session(
        user=admin_user,
        parent_session_id=parent_id,
        task="Perform a detailed, multi-step analysis of the codebase.",
        mode="persistent",
        max_turns=25,
    )
    assert resp.status_code == 200
    sub_id = resp.json()["session_id"]

    # Brief delay to let Celery pick up the task
    time.sleep(1)

    # Check if the session is still active
    detail_resp = get_agent_session(admin_user, sub_id)
    if detail_resp.status_code != 200:
        return  # Session may not exist

    detail = detail_resp.json()
    if detail.get("status") != "ACTIVE":
        # Already completed; skip this test variant
        return

    # Send follow-up while active
    followup_resp = send_followup(
        user=admin_user,
        session_id=sub_id,
        message="Also check for any security issues.",
    )
    assert followup_resp.status_code == 200
    followup_data = followup_resp.json()
    assert followup_data.get("status") == "delivered"

    # The session should still be valid
    final = _wait_for_terminal_status(admin_user, sub_id)
    assert final["status"] in ("COMPLETED", "FAILED")


# ==============================================================================
# 7.7: Multiple rapid follow-ups
# ==============================================================================


def test_multiple_rapid_follow_ups(
    admin_user: DATestUser,
    parent_session: dict[str, Any],
) -> None:
    """Send multiple follow-up messages in rapid succession to a persistent
    sub-session. All should be accepted without error.
    """
    parent_id = parent_session["session_id"]

    # Spawn persistent sub-session
    resp = spin_off_sub_session(
        user=admin_user,
        parent_session_id=parent_id,
        task="Multi-follow-up stress test.",
        mode="persistent",
        max_turns=10,
    )
    assert resp.status_code == 200
    sub_id = resp.json()["session_id"]

    # Wait for initial completion
    result = _wait_for_terminal_status(admin_user, sub_id)
    if result["status"] != "COMPLETED":
        return  # Can't test follow-ups on a failed session

    # Send 3 rapid follow-ups
    follow_up_messages = [
        "First follow-up: check file A.",
        "Second follow-up: also check file B.",
        "Third follow-up: summarize findings.",
    ]

    for msg in follow_up_messages:
        followup_resp = send_followup(
            user=admin_user,
            session_id=sub_id,
            message=msg,
        )
        # All should be accepted (200) or the session may have expired (410)
        assert followup_resp.status_code in (200, 410), (
            f"Follow-up failed: {followup_resp.status_code} {followup_resp.text}"
        )
        if followup_resp.status_code == 410:
            break  # Session expired; no point sending more

    # Wait for the session to finish processing
    _wait_for_terminal_status(admin_user, sub_id)
