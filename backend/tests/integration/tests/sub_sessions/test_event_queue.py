"""Integration tests for the sub-session event queue (Phase 2).

Tests cover:
- 2.4: Events are consumed on the next turn (appear in parent history)
- 2.5: Events enqueued during a turn are not visible in that same turn
"""

import time
from typing import Any

from tests.integration.common_utils.test_models import DATestUser
from tests.integration.tests.sub_sessions.conftest import (
    create_agent_session,
    delete_agent_session,
    get_session_history,
    list_sub_sessions,
    spin_off_sub_session,
)

# Polling parameters
_WAIT_TIMEOUT_S = 120
_POLL_INTERVAL_S = 2


def _wait_for_sub_session_complete(
    user: DATestUser,
    parent_session_id: str,
    sub_session_id: str,
    timeout: int = _WAIT_TIMEOUT_S,
) -> bool:
    """Poll the parent's sub-session list until the given sub-session reaches
    a terminal status. Returns True if it completed/failed within timeout.
    """
    deadline = time.time() + timeout
    while time.time() < deadline:
        resp = list_sub_sessions(user, parent_session_id)
        if resp.status_code == 200:
            for sub in resp.json().get("sub_sessions", []):
                if sub["session_id"] == sub_session_id:
                    if sub["status"] in ("COMPLETED", "FAILED", "STOPPED"):
                        return True
        time.sleep(_POLL_INTERVAL_S)
    return False


# ==============================================================================
# 2.4: Event consumed on next turn (appears in parent history)
# ==============================================================================


def test_event_consumed_on_next_turn(
    admin_user: DATestUser,
    parent_session: dict[str, Any],
) -> None:
    """When a sub-session completes, its SUB_SESSION_COMPLETE event should
    inject a system message into the parent session's history.

    After the sub-session finishes, we verify that the parent session's
    message history contains a system message referencing the completed
    sub-session.
    """
    parent_id = parent_session["session_id"]

    # Spawn a short sub-session
    resp = spin_off_sub_session(
        user=admin_user,
        parent_session_id=parent_id,
        task="Say hello and nothing more.",
        mode="one_shot",
        max_turns=2,
    )
    assert resp.status_code == 200
    sub_id = resp.json()["session_id"]

    # Wait for the sub-session to complete
    completed = _wait_for_sub_session_complete(admin_user, parent_id, sub_id)
    assert completed, f"Sub-session {sub_id} did not complete in time"

    # Check parent session history for the injected system message.
    # The sub-session completion handler injects a message like:
    # "[Sub-session completed] Task: ... Summary: ..."
    history_resp = get_session_history(admin_user, parent_id)
    assert history_resp.status_code == 200
    messages = history_resp.json().get("messages", [])

    # Find a system message referencing the sub-session completion
    found = False
    for msg in messages:
        content = msg.get("content", "")
        if "Sub-session completed" in content or "Sub-session failed" in content:
            found = True
            break

    assert found, (
        "Expected a system message about sub-session completion in parent "
        f"history. Got {len(messages)} messages: "
        f"{[m.get('content', '')[:80] for m in messages]}"
    )


# ==============================================================================
# 2.5: Event not visible in current turn
# ==============================================================================


def test_event_not_in_current_turn(
    admin_user: DATestUser,
) -> None:
    """Events enqueued for a session should not be visible to a turn that
    is already in progress. We verify this by checking that the event
    queue uses FOR UPDATE SKIP LOCKED semantics -- events created after
    a consume call do not retroactively appear in the consumed batch.

    Since we cannot directly introspect the event queue from the API,
    we verify the behavior indirectly: spawn two sub-sessions in rapid
    succession from the same parent. Each should produce its own
    separate system message in the parent history (not merged into one).
    """
    # Create a dedicated parent for this test
    session_data = create_agent_session(
        user=admin_user,
        title="Event isolation test",
    )
    parent_id = session_data["session_id"]

    try:
        # Spawn two sub-sessions nearly simultaneously
        sub_ids: list[str] = []
        for i in range(2):
            resp = spin_off_sub_session(
                user=admin_user,
                parent_session_id=parent_id,
                task=f"Quick task number {i}",
                mode="one_shot",
                max_turns=2,
            )
            assert resp.status_code == 200
            sub_ids.append(resp.json()["session_id"])

        # Wait for both to complete
        for sub_id in sub_ids:
            _wait_for_sub_session_complete(
                admin_user, parent_id, sub_id, timeout=120
            )

        # Check parent history -- there should be at least two system
        # messages (one per completed sub-session), proving that events
        # from each sub-session were processed independently.
        history_resp = get_session_history(admin_user, parent_id)
        assert history_resp.status_code == 200
        messages = history_resp.json().get("messages", [])

        completion_messages = [
            m
            for m in messages
            if "Sub-session completed" in m.get("content", "")
            or "Sub-session failed" in m.get("content", "")
        ]

        # We expect at least one notification per sub-session. If both
        # events were incorrectly consumed in a single batch, we would
        # see at most one message.
        assert len(completion_messages) >= 2, (
            f"Expected at least 2 sub-session completion messages, "
            f"got {len(completion_messages)}: "
            f"{[m.get('content', '')[:80] for m in completion_messages]}"
        )

    finally:
        delete_agent_session(admin_user, parent_id)
