"""Unit tests for MCP client result processing."""

from unittest.mock import MagicMock

from onyx.tools.tool_implementations.mcp.mcp_client import process_mcp_result


def _make_text_block(text: str) -> MagicMock:
    block = MagicMock()
    block.type = "text"
    block.text = text
    return block


def _make_result(
    content: list[MagicMock] | None = None,
    is_error: bool = False,
    structured_content: dict | None = None,
) -> MagicMock:
    result = MagicMock()
    result.content = content or []
    result.isError = is_error
    result.structuredContent = structured_content
    return result


def test_process_mcp_result_text_blocks() -> None:
    result = _make_result([_make_text_block("Hello"), _make_text_block("World")])
    assert process_mcp_result(result) == "Hello\n\nWorld"


def test_process_mcp_result_single_text() -> None:
    result = _make_result([_make_text_block("Only one")])
    assert process_mcp_result(result) == "Only one"


def test_process_mcp_result_empty_text_blocks_skipped() -> None:
    result = _make_result([_make_text_block(""), _make_text_block("Real")])
    assert process_mcp_result(result) == "Real"


def test_process_mcp_result_none_text_treated_as_empty() -> None:
    block = _make_text_block("")
    block.text = None
    result = _make_result([block, _make_text_block("Data")])
    assert process_mcp_result(result) == "Data"


def test_process_mcp_result_structured_content_fallback() -> None:
    result = _make_result(structured_content={"key": "value"})
    assert "key" in process_mcp_result(result)
    assert "value" in process_mcp_result(result)


def test_process_mcp_result_empty_returns_message() -> None:
    result = _make_result()
    output = process_mcp_result(result)
    assert output == "Tool returned an empty response (no data)."


def test_process_mcp_result_error_with_no_content() -> None:
    result = _make_result(is_error=True)
    output = process_mcp_result(result)
    assert output == "Tool returned an error with no details."


def test_process_mcp_result_resource_link() -> None:
    block = MagicMock()
    block.type = "resource_link"
    block.uri = "https://example.com"
    block.title = "Example"
    block.description = "A link"
    result = _make_result([block])
    output = process_mcp_result(result)
    assert "https://example.com" in output
    assert "Example" in output
