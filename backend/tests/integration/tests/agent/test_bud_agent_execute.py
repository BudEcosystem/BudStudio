"""Integration tests for BudAgent execution endpoints.

Tests the agent execution flow including session CRUD, messages, tool-result
submission, approval submission, stop, and memory management.

NOTE: These tests only exercise the API endpoints (session CRUD, messages,
tool-result, approval, stop, memories). They do NOT test actual agent
execution (which requires an LLM).
"""

from uuid import uuid4

import requests

from tests.integration.common_utils.constants import API_SERVER_URL
from tests.integration.common_utils.test_models import DATestUser


# ==============================================================================
# Helper Functions
# ==============================================================================


def create_session(
    user: DATestUser,
    title: str | None = None,
    workspace_path: str | None = None,
) -> dict:
    """Create an agent session and return the response JSON."""
    payload: dict = {}
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


def list_sessions(
    user: DATestUser,
    include_completed: bool = True,
    limit: int | None = None,
) -> dict:
    """List all agent sessions for the user."""
    params: dict = {"include_completed": include_completed}
    if limit is not None:
        params["limit"] = limit

    response = requests.get(
        f"{API_SERVER_URL}/agent/sessions",
        params=params,
        headers=user.headers,
        cookies=user.cookies,
    )
    response.raise_for_status()
    return response.json()


def get_session(user: DATestUser, session_id: str) -> requests.Response:
    """Get a specific agent session by ID."""
    return requests.get(
        f"{API_SERVER_URL}/agent/sessions/{session_id}",
        headers=user.headers,
        cookies=user.cookies,
    )


def get_session_history(
    user: DATestUser,
    session_id: str,
    limit: int | None = None,
    offset: int = 0,
) -> requests.Response:
    """Get the message history for an agent session."""
    params: dict = {"offset": offset}
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
    tool_input: dict | None = None,
    tool_output: dict | None = None,
    tool_error: str | None = None,
) -> requests.Response:
    """Add a message to an agent session."""
    payload: dict = {"role": role}
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


def delete_session(user: DATestUser, session_id: str) -> requests.Response:
    """Delete an agent session."""
    return requests.delete(
        f"{API_SERVER_URL}/agent/sessions/{session_id}",
        headers=user.headers,
        cookies=user.cookies,
    )


def update_session_status(
    user: DATestUser, session_id: str, status: str
) -> requests.Response:
    """Update the status of an agent session."""
    return requests.patch(
        f"{API_SERVER_URL}/agent/sessions/{session_id}/status",
        json={"status": status},
        headers=user.headers,
        cookies=user.cookies,
    )


def update_session_title(
    user: DATestUser, session_id: str, title: str
) -> requests.Response:
    """Update the title of an agent session."""
    return requests.patch(
        f"{API_SERVER_URL}/agent/sessions/{session_id}/title",
        json={"title": title},
        headers=user.headers,
        cookies=user.cookies,
    )


def submit_tool_result(
    user: DATestUser,
    session_id: str,
    tool_call_id: str,
    output: str | None = None,
    error: str | None = None,
) -> requests.Response:
    """Submit a tool result for an agent session."""
    payload: dict = {"tool_call_id": tool_call_id}
    if output is not None:
        payload["output"] = output
    if error is not None:
        payload["error"] = error

    return requests.post(
        f"{API_SERVER_URL}/agent/sessions/{session_id}/tool-result",
        json=payload,
        headers=user.headers,
        cookies=user.cookies,
    )


def submit_approval(
    user: DATestUser,
    session_id: str,
    tool_call_id: str,
    approved: bool,
) -> requests.Response:
    """Submit a tool approval decision for an agent session."""
    return requests.post(
        f"{API_SERVER_URL}/agent/sessions/{session_id}/approval",
        json={
            "tool_call_id": tool_call_id,
            "approved": approved,
        },
        headers=user.headers,
        cookies=user.cookies,
    )


def stop_agent(user: DATestUser, session_id: str) -> requests.Response:
    """Stop a running agent execution."""
    return requests.post(
        f"{API_SERVER_URL}/agent/sessions/{session_id}/stop",
        headers=user.headers,
        cookies=user.cookies,
    )


def create_memory(
    user: DATestUser,
    content: str,
) -> requests.Response:
    """Create a new memory."""
    return requests.post(
        f"{API_SERVER_URL}/agent/memories",
        json={"content": content},
        headers=user.headers,
        cookies=user.cookies,
    )


def list_memories(
    user: DATestUser,
    limit: int = 20,
    offset: int = 0,
) -> requests.Response:
    """List memories for the user."""
    return requests.get(
        f"{API_SERVER_URL}/agent/memories",
        params={"limit": limit, "offset": offset},
        headers=user.headers,
        cookies=user.cookies,
    )


def delete_memory(user: DATestUser, memory_id: str) -> requests.Response:
    """Delete a specific memory."""
    return requests.delete(
        f"{API_SERVER_URL}/agent/memories/{memory_id}",
        headers=user.headers,
        cookies=user.cookies,
    )


# ==============================================================================
# Tests: Session CRUD
# ==============================================================================


def test_create_and_list_sessions(admin_user: DATestUser) -> None:
    """Test creating a session and verifying it appears in the session list."""
    result = create_session(user=admin_user, title="Test Session 1")
    session_id = result["session_id"]

    try:
        sessions_data = list_sessions(admin_user)
        assert "sessions" in sessions_data
        session_ids = [s["id"] for s in sessions_data["sessions"]]
        assert session_id in session_ids
    finally:
        delete_session(admin_user, session_id)


def test_get_session(admin_user: DATestUser) -> None:
    """Test getting a specific session by ID."""
    result = create_session(user=admin_user, title="Fetch Me")
    session_id = result["session_id"]

    try:
        response = get_session(admin_user, session_id)
        assert response.status_code == 200

        data = response.json()
        assert data["id"] == session_id
        assert data["status"] == "active"
        assert data["title"] == "Fetch Me"
    finally:
        delete_session(admin_user, session_id)


def test_update_session_title(admin_user: DATestUser) -> None:
    """Test updating a session title."""
    result = create_session(user=admin_user, title="Original Title")
    session_id = result["session_id"]

    try:
        response = update_session_title(admin_user, session_id, "Updated Title")
        assert response.status_code == 200

        data = response.json()
        assert data["title"] == "Updated Title"

        # Confirm via GET
        get_resp = get_session(admin_user, session_id)
        assert get_resp.json()["title"] == "Updated Title"
    finally:
        delete_session(admin_user, session_id)


def test_delete_session(admin_user: DATestUser) -> None:
    """Test deleting a session and confirming it is gone."""
    result = create_session(user=admin_user, title="To Delete")
    session_id = result["session_id"]

    response = delete_session(admin_user, session_id)
    assert response.status_code == 200
    assert response.json()["status"] == "deleted"

    # Verify it's gone
    get_resp = get_session(admin_user, session_id)
    assert get_resp.status_code == 404


def test_session_not_found(admin_user: DATestUser) -> None:
    """Test accessing a non-existent session returns 404."""
    fake_id = str(uuid4())
    response = get_session(admin_user, fake_id)
    assert response.status_code == 404


# ==============================================================================
# Tests: Messages
# ==============================================================================


def test_add_and_get_messages(admin_user: DATestUser) -> None:
    """Test adding user and assistant messages, then retrieving history."""
    result = create_session(user=admin_user, title="Message Test")
    session_id = result["session_id"]

    try:
        # Add a user message
        user_msg_resp = add_message(
            user=admin_user,
            session_id=session_id,
            role="user",
            content="Hello!",
        )
        assert user_msg_resp.status_code == 200
        assert "message_id" in user_msg_resp.json()

        # Add an assistant message
        assistant_msg_resp = add_message(
            user=admin_user,
            session_id=session_id,
            role="assistant",
            content="Hi there!",
        )
        assert assistant_msg_resp.status_code == 200
        assert "message_id" in assistant_msg_resp.json()

        # Get history
        history_resp = get_session_history(admin_user, session_id)
        assert history_resp.status_code == 200

        data = history_resp.json()
        assert len(data["messages"]) == 2
        assert data["messages"][0]["role"] == "user"
        assert data["messages"][0]["content"] == "Hello!"
        assert data["messages"][1]["role"] == "assistant"
        assert data["messages"][1]["content"] == "Hi there!"
    finally:
        delete_session(admin_user, session_id)


def test_update_session_status(admin_user: DATestUser) -> None:
    """Test updating session status to completed."""
    result = create_session(user=admin_user, title="Status Test")
    session_id = result["session_id"]

    try:
        response = update_session_status(admin_user, session_id, "completed")
        assert response.status_code == 200
        assert response.json()["status"] == "completed"

        # Confirm via GET
        get_resp = get_session(admin_user, session_id)
        assert get_resp.json()["status"] == "completed"
    finally:
        delete_session(admin_user, session_id)


def test_invalid_message_role(admin_user: DATestUser) -> None:
    """Test adding a message with an invalid role returns 400."""
    result = create_session(user=admin_user, title="Invalid Role Test")
    session_id = result["session_id"]

    try:
        response = add_message(
            user=admin_user,
            session_id=session_id,
            role="invalid_role",
            content="test",
        )
        assert response.status_code == 400
    finally:
        delete_session(admin_user, session_id)


# ==============================================================================
# Tests: Tool Result Submission
# ==============================================================================


def test_tool_result_submission(admin_user: DATestUser) -> None:
    """Test submitting a tool result via the tool-result endpoint."""
    result = create_session(user=admin_user, title="Tool Result Test")
    session_id = result["session_id"]

    try:
        tool_call_id = str(uuid4())
        response = submit_tool_result(
            user=admin_user,
            session_id=session_id,
            tool_call_id=tool_call_id,
            output="file contents here",
        )
        assert response.status_code == 200
        assert response.json()["status"] == "submitted"
    finally:
        delete_session(admin_user, session_id)


def test_tool_result_submission_with_error(admin_user: DATestUser) -> None:
    """Test submitting a tool result that contains an error."""
    result = create_session(user=admin_user, title="Tool Error Result Test")
    session_id = result["session_id"]

    try:
        tool_call_id = str(uuid4())
        response = submit_tool_result(
            user=admin_user,
            session_id=session_id,
            tool_call_id=tool_call_id,
            error="File not found: /nonexistent",
        )
        assert response.status_code == 200
        assert response.json()["status"] == "submitted"
    finally:
        delete_session(admin_user, session_id)


def test_tool_result_for_nonexistent_session(admin_user: DATestUser) -> None:
    """Test that submitting a tool result for a non-existent session returns 404."""
    fake_id = str(uuid4())
    response = submit_tool_result(
        user=admin_user,
        session_id=fake_id,
        tool_call_id=str(uuid4()),
        output="test",
    )
    assert response.status_code == 404


# ==============================================================================
# Tests: Approval Submission
# ==============================================================================


def test_approval_submission_approved(admin_user: DATestUser) -> None:
    """Test submitting an approved tool approval."""
    result = create_session(user=admin_user, title="Approval Approved Test")
    session_id = result["session_id"]

    try:
        tool_call_id = str(uuid4())
        response = submit_approval(
            user=admin_user,
            session_id=session_id,
            tool_call_id=tool_call_id,
            approved=True,
        )
        assert response.status_code == 200
        assert response.json()["status"] == "submitted"
    finally:
        delete_session(admin_user, session_id)


def test_approval_submission_denied(admin_user: DATestUser) -> None:
    """Test submitting a denied tool approval."""
    result = create_session(user=admin_user, title="Approval Denied Test")
    session_id = result["session_id"]

    try:
        tool_call_id = str(uuid4())
        response = submit_approval(
            user=admin_user,
            session_id=session_id,
            tool_call_id=tool_call_id,
            approved=False,
        )
        assert response.status_code == 200
        assert response.json()["status"] == "submitted"
    finally:
        delete_session(admin_user, session_id)


def test_approval_for_nonexistent_session(admin_user: DATestUser) -> None:
    """Test that submitting an approval for a non-existent session returns 404."""
    fake_id = str(uuid4())
    response = submit_approval(
        user=admin_user,
        session_id=fake_id,
        tool_call_id=str(uuid4()),
        approved=True,
    )
    assert response.status_code == 404


# ==============================================================================
# Tests: Stop Agent
# ==============================================================================


def test_stop_agent(admin_user: DATestUser) -> None:
    """Test stopping an agent session."""
    result = create_session(user=admin_user, title="Stop Test")
    session_id = result["session_id"]

    try:
        response = stop_agent(admin_user, session_id)
        assert response.status_code == 200
        assert response.json()["status"] == "stopping"
    finally:
        delete_session(admin_user, session_id)


def test_stop_nonexistent_session(admin_user: DATestUser) -> None:
    """Test that stopping a non-existent session returns 404."""
    fake_id = str(uuid4())
    response = stop_agent(admin_user, fake_id)
    assert response.status_code == 404


# ==============================================================================
# Tests: Memory Management
# ==============================================================================


def test_create_and_list_memories(admin_user: DATestUser) -> None:
    """Test creating a memory and verifying it appears in the memory list."""
    # Create a memory
    create_resp = create_memory(admin_user, "User prefers dark mode")
    assert create_resp.status_code == 200

    data = create_resp.json()
    assert data["content"] == "User prefers dark mode"
    memory_id = data["id"]

    try:
        # List memories
        list_resp = list_memories(admin_user)
        assert list_resp.status_code == 200

        list_data = list_resp.json()
        assert "memories" in list_data
        memory_ids = [m["id"] for m in list_data["memories"]]
        assert memory_id in memory_ids
    finally:
        delete_memory(admin_user, memory_id)


def test_delete_memory(admin_user: DATestUser) -> None:
    """Test deleting a memory."""
    # Create a memory
    create_resp = create_memory(admin_user, "Memory to delete")
    assert create_resp.status_code == 200
    memory_id = create_resp.json()["id"]

    # Delete it
    del_resp = delete_memory(admin_user, memory_id)
    assert del_resp.status_code == 200
    assert del_resp.json()["status"] == "deleted"


def test_empty_memory_content_rejected(admin_user: DATestUser) -> None:
    """Test that empty memory content is rejected with 400."""
    response = create_memory(admin_user, "")
    assert response.status_code == 400


def test_whitespace_only_memory_content_rejected(admin_user: DATestUser) -> None:
    """Test that whitespace-only memory content is rejected with 400."""
    response = create_memory(admin_user, "   ")
    assert response.status_code == 400


def test_delete_nonexistent_memory(admin_user: DATestUser) -> None:
    """Test deleting a non-existent memory returns 404."""
    fake_id = str(uuid4())
    response = delete_memory(admin_user, fake_id)
    assert response.status_code == 404


# ==============================================================================
# Tests: User Isolation for Execution Endpoints
# ==============================================================================


def test_tool_result_user_isolation(
    admin_user: DATestUser, basic_user: DATestUser
) -> None:
    """Test that a user cannot submit tool results to another user's session."""
    # Admin creates a session
    result = create_session(user=admin_user, title="Admin Isolation Test")
    session_id = result["session_id"]

    try:
        # Basic user tries to submit a tool result
        response = submit_tool_result(
            user=basic_user,
            session_id=session_id,
            tool_call_id=str(uuid4()),
            output="unauthorized output",
        )
        assert response.status_code == 404
    finally:
        delete_session(admin_user, session_id)


def test_approval_user_isolation(
    admin_user: DATestUser, basic_user: DATestUser
) -> None:
    """Test that a user cannot submit approvals to another user's session."""
    # Admin creates a session
    result = create_session(user=admin_user, title="Admin Approval Isolation Test")
    session_id = result["session_id"]

    try:
        # Basic user tries to submit an approval
        response = submit_approval(
            user=basic_user,
            session_id=session_id,
            tool_call_id=str(uuid4()),
            approved=True,
        )
        assert response.status_code == 404
    finally:
        delete_session(admin_user, session_id)


def test_stop_user_isolation(
    admin_user: DATestUser, basic_user: DATestUser
) -> None:
    """Test that a user cannot stop another user's agent session."""
    # Admin creates a session
    result = create_session(user=admin_user, title="Admin Stop Isolation Test")
    session_id = result["session_id"]

    try:
        # Basic user tries to stop the session
        response = stop_agent(basic_user, session_id)
        assert response.status_code == 404
    finally:
        delete_session(admin_user, session_id)


# ==============================================================================
# Tests: End-to-End Lifecycle (No LLM)
# ==============================================================================


def test_execution_endpoint_lifecycle(admin_user: DATestUser) -> None:
    """Test a full lifecycle: create session, add messages, submit tool result,
    submit approval, stop, then clean up.

    NOTE: This does NOT invoke the actual LLM /execute endpoint. It exercises
    the surrounding CRUD and signalling endpoints together.
    """
    # 1. Create session
    result = create_session(
        user=admin_user,
        title="Lifecycle Execute Test",
        workspace_path="/home/user/project",
    )
    session_id = result["session_id"]

    try:
        # 2. Add a user message
        msg_resp = add_message(
            user=admin_user,
            session_id=session_id,
            role="user",
            content="List the files in this directory",
        )
        assert msg_resp.status_code == 200

        # 3. Add a tool message (simulating agent tool use)
        tool_msg_resp = add_message(
            user=admin_user,
            session_id=session_id,
            role="tool",
            tool_name="bash",
            tool_input={"command": "ls -la"},
            tool_output={"stdout": "file1.txt\nfile2.txt", "exit_code": 0},
        )
        assert tool_msg_resp.status_code == 200

        # 4. Add an assistant message
        asst_resp = add_message(
            user=admin_user,
            session_id=session_id,
            role="assistant",
            content="I found two files: file1.txt and file2.txt",
        )
        assert asst_resp.status_code == 200

        # 5. Verify message history
        history_resp = get_session_history(admin_user, session_id)
        assert history_resp.status_code == 200
        messages = history_resp.json()["messages"]
        assert len(messages) == 3
        assert messages[0]["role"] == "user"
        assert messages[1]["role"] == "tool"
        assert messages[1]["tool_name"] == "bash"
        assert messages[2]["role"] == "assistant"

        # 6. Submit a tool result (simulating desktop tool execution)
        tool_call_id = str(uuid4())
        tr_resp = submit_tool_result(
            user=admin_user,
            session_id=session_id,
            tool_call_id=tool_call_id,
            output="OK",
        )
        assert tr_resp.status_code == 200

        # 7. Submit an approval
        approval_id = str(uuid4())
        ap_resp = submit_approval(
            user=admin_user,
            session_id=session_id,
            tool_call_id=approval_id,
            approved=True,
        )
        assert ap_resp.status_code == 200

        # 8. Stop the agent
        stop_resp = stop_agent(admin_user, session_id)
        assert stop_resp.status_code == 200
        assert stop_resp.json()["status"] == "stopping"

        # 9. Update status to completed
        status_resp = update_session_status(admin_user, session_id, "completed")
        assert status_resp.status_code == 200
        assert status_resp.json()["status"] == "completed"

        # 10. Verify final session state
        final_resp = get_session(admin_user, session_id)
        assert final_resp.status_code == 200
        final_session = final_resp.json()
        assert final_session["status"] == "completed"
        assert final_session["title"] == "Lifecycle Execute Test"
        assert final_session["workspace_path"] == "/home/user/project"
    finally:
        delete_session(admin_user, session_id)
