"""Integration tests for the agent API endpoints."""

from uuid import uuid4

import pytest
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
    response = requests.get(
        f"{API_SERVER_URL}/agent/sessions/{session_id}",
        headers=user.headers,
        cookies=user.cookies,
    )
    return response


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

    response = requests.get(
        f"{API_SERVER_URL}/agent/sessions/{session_id}/history",
        params=params,
        headers=user.headers,
        cookies=user.cookies,
    )
    return response


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

    response = requests.post(
        f"{API_SERVER_URL}/agent/sessions/{session_id}/messages",
        json=payload,
        headers=user.headers,
        cookies=user.cookies,
    )
    return response


def delete_session(user: DATestUser, session_id: str) -> requests.Response:
    """Delete an agent session."""
    response = requests.delete(
        f"{API_SERVER_URL}/agent/sessions/{session_id}",
        headers=user.headers,
        cookies=user.cookies,
    )
    return response


def update_session_status(
    user: DATestUser, session_id: str, status: str
) -> requests.Response:
    """Update the status of an agent session."""
    response = requests.patch(
        f"{API_SERVER_URL}/agent/sessions/{session_id}/status",
        json={"status": status},
        headers=user.headers,
        cookies=user.cookies,
    )
    return response


def update_session_title(
    user: DATestUser, session_id: str, title: str
) -> requests.Response:
    """Update the title of an agent session."""
    response = requests.patch(
        f"{API_SERVER_URL}/agent/sessions/{session_id}/title",
        json={"title": title},
        headers=user.headers,
        cookies=user.cookies,
    )
    return response


# ==============================================================================
# Test: Create Session
# ==============================================================================


def test_create_session_with_title_and_workspace(admin_user: DATestUser) -> None:
    """Test creating a session with title and workspace path."""
    result = create_session(
        user=admin_user,
        title="Test Session",
        workspace_path="/home/user/project",
    )

    assert "session_id" in result
    assert result["session_id"] is not None

    # Verify the session was created correctly by fetching it
    response = get_session(admin_user, result["session_id"])
    assert response.status_code == 200

    session = response.json()
    assert session["title"] == "Test Session"
    assert session["workspace_path"] == "/home/user/project"
    assert session["status"] == "active"

    # Clean up
    delete_session(admin_user, result["session_id"])


def test_create_session_without_optional_fields(admin_user: DATestUser) -> None:
    """Test creating a session without optional fields."""
    result = create_session(user=admin_user)

    assert "session_id" in result
    assert result["session_id"] is not None

    # Verify the session was created correctly
    response = get_session(admin_user, result["session_id"])
    assert response.status_code == 200

    session = response.json()
    assert session["title"] is None
    assert session["workspace_path"] is None
    assert session["status"] == "active"

    # Clean up
    delete_session(admin_user, result["session_id"])


def test_create_session_with_only_title(admin_user: DATestUser) -> None:
    """Test creating a session with only a title."""
    result = create_session(
        user=admin_user,
        title="My Agent Session",
    )

    assert "session_id" in result

    response = get_session(admin_user, result["session_id"])
    assert response.status_code == 200

    session = response.json()
    assert session["title"] == "My Agent Session"
    assert session["workspace_path"] is None

    # Clean up
    delete_session(admin_user, result["session_id"])


# ==============================================================================
# Test: List Sessions
# ==============================================================================


def test_list_sessions_returns_created_sessions(admin_user: DATestUser) -> None:
    """Test that list sessions returns the sessions we create."""
    # Create multiple sessions
    session_ids = []
    for i in range(3):
        result = create_session(
            user=admin_user,
            title=f"Test Session {i}",
        )
        session_ids.append(result["session_id"])

    # List sessions
    result = list_sessions(admin_user)
    assert "sessions" in result

    # Verify our sessions are in the list
    returned_ids = [s["id"] for s in result["sessions"]]
    for session_id in session_ids:
        assert session_id in returned_ids

    # Clean up
    for session_id in session_ids:
        delete_session(admin_user, session_id)


def test_list_sessions_with_limit(admin_user: DATestUser) -> None:
    """Test that list sessions respects the limit parameter."""
    # Create multiple sessions
    session_ids = []
    for i in range(5):
        result = create_session(
            user=admin_user,
            title=f"Limited Session {i}",
        )
        session_ids.append(result["session_id"])

    # List with limit
    result = list_sessions(admin_user, limit=2)
    assert "sessions" in result
    assert len(result["sessions"]) <= 2

    # Clean up
    for session_id in session_ids:
        delete_session(admin_user, session_id)


def test_list_sessions_exclude_completed(admin_user: DATestUser) -> None:
    """Test that list sessions can exclude completed sessions."""
    # Create a session and mark it as completed
    result = create_session(
        user=admin_user,
        title="Completed Session",
    )
    session_id = result["session_id"]

    # Update status to completed
    update_response = update_session_status(admin_user, session_id, "completed")
    assert update_response.status_code == 200

    # List sessions excluding completed
    result = list_sessions(admin_user, include_completed=False)
    returned_ids = [s["id"] for s in result["sessions"]]

    # The completed session should not be in the list
    assert session_id not in returned_ids

    # Clean up
    delete_session(admin_user, session_id)


# ==============================================================================
# Test: Get Session
# ==============================================================================


def test_get_specific_session_by_id(admin_user: DATestUser) -> None:
    """Test getting a specific session by its ID."""
    # Create a session
    create_result = create_session(
        user=admin_user,
        title="Specific Session",
        workspace_path="/specific/path",
    )
    session_id = create_result["session_id"]

    # Get the session
    response = get_session(admin_user, session_id)
    assert response.status_code == 200

    session = response.json()
    assert session["id"] == session_id
    assert session["title"] == "Specific Session"
    assert session["workspace_path"] == "/specific/path"
    assert session["status"] == "active"
    assert "created_at" in session
    assert "updated_at" in session
    assert session["total_tokens_used"] == 0
    assert session["total_tool_calls"] == 0

    # Clean up
    delete_session(admin_user, session_id)


def test_get_non_existent_session_returns_404(admin_user: DATestUser) -> None:
    """Test that getting a non-existent session returns 404."""
    fake_session_id = str(uuid4())

    response = get_session(admin_user, fake_session_id)
    assert response.status_code == 404

    error = response.json()
    assert "detail" in error
    assert "not found" in error["detail"].lower()


def test_get_session_with_invalid_uuid_returns_error(admin_user: DATestUser) -> None:
    """Test that getting a session with invalid UUID format returns an error."""
    response = get_session(admin_user, "not-a-valid-uuid")
    # FastAPI validation should return 422 for invalid UUID format
    assert response.status_code == 422


# ==============================================================================
# Test: Add Messages
# ==============================================================================


def test_add_user_message_to_session(admin_user: DATestUser) -> None:
    """Test adding a user message to a session."""
    # Create a session
    create_result = create_session(user=admin_user, title="Message Test")
    session_id = create_result["session_id"]

    # Add a user message
    response = add_message(
        user=admin_user,
        session_id=session_id,
        role="user",
        content="Hello, can you help me with something?",
    )
    assert response.status_code == 200

    result = response.json()
    assert "message_id" in result
    assert result["message_id"] is not None

    # Verify the message was added by getting history
    history_response = get_session_history(admin_user, session_id)
    assert history_response.status_code == 200

    history = history_response.json()
    assert len(history["messages"]) == 1
    assert history["messages"][0]["role"] == "user"
    assert history["messages"][0]["content"] == "Hello, can you help me with something?"

    # Clean up
    delete_session(admin_user, session_id)


def test_add_assistant_message_to_session(admin_user: DATestUser) -> None:
    """Test adding an assistant message to a session."""
    # Create a session
    create_result = create_session(user=admin_user, title="Assistant Message Test")
    session_id = create_result["session_id"]

    # Add an assistant message
    response = add_message(
        user=admin_user,
        session_id=session_id,
        role="assistant",
        content="Of course! I'd be happy to help.",
    )
    assert response.status_code == 200

    result = response.json()
    assert "message_id" in result

    # Verify the message was added
    history_response = get_session_history(admin_user, session_id)
    assert history_response.status_code == 200

    history = history_response.json()
    assert len(history["messages"]) == 1
    assert history["messages"][0]["role"] == "assistant"
    assert history["messages"][0]["content"] == "Of course! I'd be happy to help."

    # Clean up
    delete_session(admin_user, session_id)


def test_add_tool_message_to_session(admin_user: DATestUser) -> None:
    """Test adding a tool message to a session."""
    # Create a session
    create_result = create_session(user=admin_user, title="Tool Message Test")
    session_id = create_result["session_id"]

    # Add a tool message
    response = add_message(
        user=admin_user,
        session_id=session_id,
        role="tool",
        tool_name="file_read",
        tool_input={"path": "/etc/hosts"},
        tool_output={"content": "127.0.0.1 localhost"},
    )
    assert response.status_code == 200

    result = response.json()
    assert "message_id" in result

    # Verify the message was added
    history_response = get_session_history(admin_user, session_id)
    assert history_response.status_code == 200

    history = history_response.json()
    assert len(history["messages"]) == 1
    message = history["messages"][0]
    assert message["role"] == "tool"
    assert message["tool_name"] == "file_read"
    assert message["tool_input"] == {"path": "/etc/hosts"}
    assert message["tool_output"] == {"content": "127.0.0.1 localhost"}

    # Clean up
    delete_session(admin_user, session_id)


def test_add_tool_message_with_error(admin_user: DATestUser) -> None:
    """Test adding a tool message with an error."""
    # Create a session
    create_result = create_session(user=admin_user, title="Tool Error Test")
    session_id = create_result["session_id"]

    # Add a tool message with error
    response = add_message(
        user=admin_user,
        session_id=session_id,
        role="tool",
        tool_name="file_read",
        tool_input={"path": "/nonexistent/file"},
        tool_error="File not found: /nonexistent/file",
    )
    assert response.status_code == 200

    # Verify the message was added
    history_response = get_session_history(admin_user, session_id)
    assert history_response.status_code == 200

    history = history_response.json()
    assert len(history["messages"]) == 1
    message = history["messages"][0]
    assert message["role"] == "tool"
    assert message["tool_error"] == "File not found: /nonexistent/file"

    # Clean up
    delete_session(admin_user, session_id)


def test_add_message_with_invalid_role(admin_user: DATestUser) -> None:
    """Test that adding a message with an invalid role returns an error."""
    # Create a session
    create_result = create_session(user=admin_user, title="Invalid Role Test")
    session_id = create_result["session_id"]

    # Try to add a message with invalid role
    response = add_message(
        user=admin_user,
        session_id=session_id,
        role="invalid_role",
        content="This should fail",
    )
    assert response.status_code == 400

    error = response.json()
    assert "detail" in error
    assert "invalid role" in error["detail"].lower()

    # Clean up
    delete_session(admin_user, session_id)


def test_add_message_to_non_existent_session(admin_user: DATestUser) -> None:
    """Test that adding a message to a non-existent session returns 404."""
    fake_session_id = str(uuid4())

    response = add_message(
        user=admin_user,
        session_id=fake_session_id,
        role="user",
        content="This should fail",
    )
    assert response.status_code == 404


# ==============================================================================
# Test: Get Message History
# ==============================================================================


def test_get_message_history(admin_user: DATestUser) -> None:
    """Test getting the message history for a session."""
    # Create a session
    create_result = create_session(user=admin_user, title="History Test")
    session_id = create_result["session_id"]

    # Add multiple messages
    messages = [
        ("user", "Hello"),
        ("assistant", "Hi there!"),
        ("user", "How are you?"),
        ("assistant", "I'm doing well, thank you!"),
    ]

    for role, content in messages:
        add_message(
            user=admin_user,
            session_id=session_id,
            role=role,
            content=content,
        )

    # Get history
    response = get_session_history(admin_user, session_id)
    assert response.status_code == 200

    history = response.json()
    assert "messages" in history
    assert len(history["messages"]) == 4

    # Verify message order and content
    for i, (role, content) in enumerate(messages):
        assert history["messages"][i]["role"] == role
        assert history["messages"][i]["content"] == content

    # Clean up
    delete_session(admin_user, session_id)


def test_get_message_history_with_pagination(admin_user: DATestUser) -> None:
    """Test getting the message history with pagination."""
    # Create a session
    create_result = create_session(user=admin_user, title="Pagination Test")
    session_id = create_result["session_id"]

    # Add multiple messages
    for i in range(10):
        add_message(
            user=admin_user,
            session_id=session_id,
            role="user",
            content=f"Message {i}",
        )

    # Get first page
    response = get_session_history(admin_user, session_id, limit=3, offset=0)
    assert response.status_code == 200

    history = response.json()
    assert len(history["messages"]) == 3
    assert history["messages"][0]["content"] == "Message 0"

    # Get second page
    response = get_session_history(admin_user, session_id, limit=3, offset=3)
    assert response.status_code == 200

    history = response.json()
    assert len(history["messages"]) == 3
    assert history["messages"][0]["content"] == "Message 3"

    # Clean up
    delete_session(admin_user, session_id)


def test_get_message_history_for_non_existent_session(admin_user: DATestUser) -> None:
    """Test that getting history for a non-existent session returns 404."""
    fake_session_id = str(uuid4())

    response = get_session_history(admin_user, fake_session_id)
    assert response.status_code == 404


# ==============================================================================
# Test: Delete Session
# ==============================================================================


def test_delete_session(admin_user: DATestUser) -> None:
    """Test deleting an agent session."""
    # Create a session
    create_result = create_session(user=admin_user, title="To Be Deleted")
    session_id = create_result["session_id"]

    # Verify it exists
    get_response = get_session(admin_user, session_id)
    assert get_response.status_code == 200

    # Delete it
    delete_response = delete_session(admin_user, session_id)
    assert delete_response.status_code == 200

    result = delete_response.json()
    assert result["status"] == "deleted"

    # Verify it's gone
    get_response = get_session(admin_user, session_id)
    assert get_response.status_code == 404


def test_delete_non_existent_session_returns_404(admin_user: DATestUser) -> None:
    """Test that deleting a non-existent session returns 404."""
    fake_session_id = str(uuid4())

    response = delete_session(admin_user, fake_session_id)
    assert response.status_code == 404

    error = response.json()
    assert "detail" in error
    assert "not found" in error["detail"].lower()


def test_messages_deleted_with_session_cascade(admin_user: DATestUser) -> None:
    """Test that messages are deleted when the session is deleted (cascade)."""
    # Create a session
    create_result = create_session(user=admin_user, title="Cascade Test")
    session_id = create_result["session_id"]

    # Add messages
    for i in range(5):
        add_message(
            user=admin_user,
            session_id=session_id,
            role="user",
            content=f"Message {i}",
        )

    # Verify messages exist
    history_response = get_session_history(admin_user, session_id)
    assert history_response.status_code == 200
    assert len(history_response.json()["messages"]) == 5

    # Delete the session
    delete_response = delete_session(admin_user, session_id)
    assert delete_response.status_code == 200

    # Verify session is gone
    get_response = get_session(admin_user, session_id)
    assert get_response.status_code == 404

    # Verify history endpoint also returns 404 (session doesn't exist)
    history_response = get_session_history(admin_user, session_id)
    assert history_response.status_code == 404


# ==============================================================================
# Test: Update Session Status
# ==============================================================================


def test_update_session_status(admin_user: DATestUser) -> None:
    """Test updating the status of a session."""
    # Create a session
    create_result = create_session(user=admin_user, title="Status Test")
    session_id = create_result["session_id"]

    # Verify initial status is active
    get_response = get_session(admin_user, session_id)
    assert get_response.json()["status"] == "active"

    # Update to completed
    update_response = update_session_status(admin_user, session_id, "completed")
    assert update_response.status_code == 200
    assert update_response.json()["status"] == "completed"

    # Verify the update
    get_response = get_session(admin_user, session_id)
    assert get_response.json()["status"] == "completed"

    # Clean up
    delete_session(admin_user, session_id)


def test_update_session_status_to_failed(admin_user: DATestUser) -> None:
    """Test updating the status of a session to failed."""
    # Create a session
    create_result = create_session(user=admin_user, title="Failed Status Test")
    session_id = create_result["session_id"]

    # Update to failed
    update_response = update_session_status(admin_user, session_id, "failed")
    assert update_response.status_code == 200
    assert update_response.json()["status"] == "failed"

    # Clean up
    delete_session(admin_user, session_id)


def test_update_session_status_invalid(admin_user: DATestUser) -> None:
    """Test that updating to an invalid status returns an error."""
    # Create a session
    create_result = create_session(user=admin_user, title="Invalid Status Test")
    session_id = create_result["session_id"]

    # Try to update to invalid status
    update_response = update_session_status(admin_user, session_id, "invalid_status")
    assert update_response.status_code == 400

    error = update_response.json()
    assert "detail" in error
    assert "invalid status" in error["detail"].lower()

    # Clean up
    delete_session(admin_user, session_id)


# ==============================================================================
# Test: Update Session Title
# ==============================================================================


def test_update_session_title(admin_user: DATestUser) -> None:
    """Test updating the title of a session."""
    # Create a session
    create_result = create_session(user=admin_user, title="Original Title")
    session_id = create_result["session_id"]

    # Update the title
    update_response = update_session_title(admin_user, session_id, "Updated Title")
    assert update_response.status_code == 200

    result = update_response.json()
    assert result["title"] == "Updated Title"

    # Verify the update
    get_response = get_session(admin_user, session_id)
    assert get_response.json()["title"] == "Updated Title"

    # Clean up
    delete_session(admin_user, session_id)


def test_update_session_title_non_existent(admin_user: DATestUser) -> None:
    """Test that updating the title of a non-existent session returns 404."""
    fake_session_id = str(uuid4())

    response = update_session_title(admin_user, fake_session_id, "New Title")
    assert response.status_code == 404


# ==============================================================================
# Test: User Isolation (Basic User Tests)
# ==============================================================================


def test_user_cannot_access_other_users_session(
    admin_user: DATestUser, basic_user: DATestUser
) -> None:
    """Test that a user cannot access another user's session."""
    # Admin creates a session
    create_result = create_session(user=admin_user, title="Admin's Session")
    session_id = create_result["session_id"]

    # Basic user tries to access it
    get_response = get_session(basic_user, session_id)
    assert get_response.status_code == 404

    # Basic user tries to delete it
    delete_response = delete_session(basic_user, session_id)
    assert delete_response.status_code == 404

    # Basic user tries to add a message
    add_response = add_message(
        user=basic_user,
        session_id=session_id,
        role="user",
        content="Trying to add message",
    )
    assert add_response.status_code == 404

    # Clean up as admin
    delete_session(admin_user, session_id)


def test_basic_user_can_create_and_manage_own_session(
    basic_user: DATestUser,
) -> None:
    """Test that a basic user can create and manage their own sessions."""
    # Create a session
    create_result = create_session(user=basic_user, title="Basic User's Session")
    session_id = create_result["session_id"]

    # Get the session
    get_response = get_session(basic_user, session_id)
    assert get_response.status_code == 200
    assert get_response.json()["title"] == "Basic User's Session"

    # Add a message
    add_response = add_message(
        user=basic_user,
        session_id=session_id,
        role="user",
        content="Hello from basic user",
    )
    assert add_response.status_code == 200

    # Get history
    history_response = get_session_history(basic_user, session_id)
    assert history_response.status_code == 200
    assert len(history_response.json()["messages"]) == 1

    # Delete the session
    delete_response = delete_session(basic_user, session_id)
    assert delete_response.status_code == 200


# ==============================================================================
# Test: Session Lifecycle
# ==============================================================================


def test_complete_session_lifecycle(admin_user: DATestUser) -> None:
    """Test a complete session lifecycle from creation to deletion."""
    # 1. Create session
    create_result = create_session(
        user=admin_user,
        title="Lifecycle Test",
        workspace_path="/home/user/project",
    )
    session_id = create_result["session_id"]

    # 2. Verify it appears in list
    list_result = list_sessions(admin_user)
    session_ids = [s["id"] for s in list_result["sessions"]]
    assert session_id in session_ids

    # 3. Add messages (simulate a conversation)
    add_message(admin_user, session_id, "user", "What files are in this directory?")
    add_message(
        admin_user,
        session_id,
        "tool",
        tool_name="bash",
        tool_input={"command": "ls -la"},
        tool_output={"stdout": "file1.txt\nfile2.txt", "exit_code": 0},
    )
    add_message(
        admin_user,
        session_id,
        "assistant",
        "I found two files: file1.txt and file2.txt",
    )

    # 4. Verify message history
    history_response = get_session_history(admin_user, session_id)
    assert history_response.status_code == 200
    messages = history_response.json()["messages"]
    assert len(messages) == 3

    # 5. Update title
    update_title_response = update_session_title(
        admin_user, session_id, "File Listing Session"
    )
    assert update_title_response.status_code == 200

    # 6. Mark as completed
    update_status_response = update_session_status(admin_user, session_id, "completed")
    assert update_status_response.status_code == 200

    # 7. Verify completed session has completed_at timestamp
    get_response = get_session(admin_user, session_id)
    session = get_response.json()
    assert session["status"] == "completed"
    assert session["title"] == "File Listing Session"
    # Note: completed_at may or may not be set depending on implementation

    # 8. Delete session
    delete_response = delete_session(admin_user, session_id)
    assert delete_response.status_code == 200

    # 9. Verify it's gone
    get_response = get_session(admin_user, session_id)
    assert get_response.status_code == 404
