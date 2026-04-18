"""Integration tests for sub-session lifecycle interactions (Phase 6).

Tests cover:
- 6.3: Compaction re-points sub-sessions to the new session
- 6.4: Creating a new session re-points sub-sessions from the old session
"""

import time
from typing import Any

from tests.integration.common_utils.test_models import DATestUser
from tests.integration.tests.sub_sessions.conftest import (
    add_message,
    create_agent_session,
    delete_agent_session,
    get_agent_session,
    list_sub_sessions,
    spin_off_sub_session,
)

_WAIT_TIMEOUT_S = 120
_POLL_INTERVAL_S = 2


# ==============================================================================
# 6.3: Compaction re-points sub-sessions
# ==============================================================================


def test_compaction_repoints_sub_sessions(
    admin_user: DATestUser,
) -> None:
    """When a session is compacted (a new session is created in the
    compaction chain), active sub-sessions should be re-pointed to the
    new session.

    Strategy:
    1. Create parent session A.
    2. Spawn a sub-session from A (with many max_turns so it stays active).
    3. Fill A with enough messages to trigger compaction (>200K chars).
       Since we cannot trigger compaction via the REST API directly,
       we simulate the effect by creating a new session (which calls
       create_session -> deactivate old -> re-point sub-sessions).
    4. Verify the sub-session's parent_session_id is now the new session.

    Note: This test exercises the re-pointing logic via the create_session
    path (which is also used by compaction internally).
    """
    # 1. Create parent session A
    session_a_data = create_agent_session(
        user=admin_user,
        title="Compaction re-point test A",
    )
    session_a_id = session_a_data["session_id"]

    try:
        # 2. Spawn a sub-session from A
        resp = spin_off_sub_session(
            user=admin_user,
            parent_session_id=session_a_id,
            task="Long-running analysis for compaction test.",
            mode="one_shot",
            max_turns=25,
        )
        assert resp.status_code == 200
        sub_session_id = resp.json()["session_id"]

        # Give the sub-session a moment to start
        time.sleep(1)

        # 3. Create a new session B.
        # This triggers deactivation of A and re-pointing of A's
        # active sub-sessions to B.
        session_b_data = create_agent_session(
            user=admin_user,
            title="Compaction re-point test B",
        )
        session_b_id = session_b_data["session_id"]

        # 4. Verify: list sub-sessions of B should now include the
        # sub-session that was originally spawned from A.
        list_resp = list_sub_sessions(admin_user, session_b_id)
        assert list_resp.status_code == 200
        sub_ids = [s["session_id"] for s in list_resp.json()["sub_sessions"]]
        assert sub_session_id in sub_ids, (
            f"Sub-session {sub_session_id} was not re-pointed to new session "
            f"{session_b_id}. Sub-sessions of B: {sub_ids}"
        )

        # Also verify it is no longer listed under A
        list_a_resp = list_sub_sessions(admin_user, session_a_id)
        if list_a_resp.status_code == 200:
            sub_ids_a = [
                s["session_id"] for s in list_a_resp.json()["sub_sessions"]
            ]
            # The sub-session should have been moved away from A
            # (unless it already completed and thus was not re-pointed)
            # Only assert if the sub-session is still active
            sub_detail = get_agent_session(admin_user, sub_session_id)
            if (
                sub_detail.status_code == 200
                and sub_detail.json().get("status") == "ACTIVE"
            ):
                assert sub_session_id not in sub_ids_a, (
                    f"Sub-session {sub_session_id} should have been moved "
                    f"from session A ({session_a_id}) to session B"
                )

    finally:
        # Cleanup
        try:
            delete_agent_session(admin_user, session_a_id)
        except Exception:
            pass
        try:
            delete_agent_session(admin_user, session_b_id)  # type: ignore[possibly-undefined]
        except Exception:
            pass


# ==============================================================================
# 6.4: New session creation re-points sub-sessions
# ==============================================================================


def test_new_session_repoints_sub_sessions(
    admin_user: DATestUser,
) -> None:
    """Creating a new session should re-point active sub-sessions from
    the old active session to the new one.

    This directly tests the ``create_session`` -> ``repoint_sub_sessions_parent``
    path.
    """
    # Create the original session
    original_data = create_agent_session(
        user=admin_user,
        title="Original session for re-point test",
    )
    original_id = original_data["session_id"]

    try:
        # Spawn two sub-sessions from the original
        sub_ids: list[str] = []
        for i in range(2):
            resp = spin_off_sub_session(
                user=admin_user,
                parent_session_id=original_id,
                task=f"Re-point test task {i}",
                mode="one_shot",
                max_turns=20,
            )
            assert resp.status_code == 200
            sub_ids.append(resp.json()["session_id"])

        # Brief pause to let Celery pick up the tasks
        time.sleep(1)

        # Create a new session, which should deactivate the original
        # and re-point its active sub-sessions
        new_data = create_agent_session(
            user=admin_user,
            title="New session for re-point test",
        )
        new_id = new_data["session_id"]

        # Verify the sub-sessions are now under the new session
        list_resp = list_sub_sessions(admin_user, new_id)
        assert list_resp.status_code == 200
        new_sub_ids = [
            s["session_id"] for s in list_resp.json()["sub_sessions"]
        ]

        # At least the sub-sessions that are still ACTIVE should have
        # been re-pointed
        for sub_id in sub_ids:
            detail_resp = get_agent_session(admin_user, sub_id)
            if (
                detail_resp.status_code == 200
                and detail_resp.json().get("status") == "ACTIVE"
            ):
                assert sub_id in new_sub_ids, (
                    f"Active sub-session {sub_id} was not re-pointed "
                    f"to new session {new_id}"
                )

        # Verify the original session is no longer ACTIVE
        original_resp = get_agent_session(admin_user, original_id)
        if original_resp.status_code == 200:
            assert original_resp.json()["status"] != "ACTIVE", (
                "Original session should have been deactivated"
            )

    finally:
        try:
            delete_agent_session(admin_user, original_id)
        except Exception:
            pass
        try:
            delete_agent_session(admin_user, new_id)  # type: ignore[possibly-undefined]
        except Exception:
            pass
