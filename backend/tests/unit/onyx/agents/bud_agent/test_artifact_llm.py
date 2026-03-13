"""Unit tests for artifact_llm — LLM-driven artifact generation."""

from unittest.mock import MagicMock

from onyx.agents.bud_agent.artifact_llm import (
    build_artifact_prompt,
    maybe_generate_artifact,
    should_attempt_artifact,
)


# ---------------------------------------------------------------------------
# should_attempt_artifact
# ---------------------------------------------------------------------------


class TestShouldAttemptArtifact:
    def test_short_text_returns_false(self) -> None:
        assert should_attempt_artifact("Hello!") is False

    def test_short_greeting_returns_false(self) -> None:
        assert should_attempt_artifact("The answer is 4.") is False

    def test_simple_question_returns_false(self) -> None:
        text = "What time is it? I was wondering about the meeting."
        assert should_attempt_artifact(text) is False

    def test_code_fence_returns_true(self) -> None:
        text = "Here's the code:\n```python\n" + "x = 1\n" * 20 + "```"
        assert should_attempt_artifact(text) is True

    def test_markdown_table_returns_true(self) -> None:
        text = (
            "Here are the results:\n"
            "| Name | Score |\n"
            "| --- | --- |\n"
            "| Alice | 95 |\n" * 10
        )
        assert should_attempt_artifact(text) is True

    def test_email_pattern_returns_true(self) -> None:
        text = (
            "Here's the email I drafted:\n"
            "To: john@example.com\n"
            "Subject: Quarterly Results\n"
            "Body: Hi John, here are the quarterly results. " + "x " * 50
        )
        assert should_attempt_artifact(text) is True

    def test_section_headers_returns_true(self) -> None:
        text = (
            "# Overview\n"
            "This is the overview section with details.\n" * 5
            + "## Details\n"
            + "More content here.\n" * 5
        )
        assert should_attempt_artifact(text) is True

    def test_numbered_list_returns_true(self) -> None:
        text = "Here are the items:\n"
        for i in range(1, 6):
            text += f"{i}. Item number {i} with some description\n"
        text += "And more content " * 20
        assert should_attempt_artifact(text) is True

    def test_numbered_list_too_few_returns_false(self) -> None:
        text = "Here are the items:\n1. First item\n2. Second item\n"
        text += "Extra text " * 20  # Pad to meet length minimum
        assert should_attempt_artifact(text) is False

    def test_bold_email_subject_returns_true(self) -> None:
        text = (
            "**Subject:** Quarterly Results\n\n"
            "Hi John,\n\n"
            "Here are the quarterly results. " + "x " * 50
        )
        assert should_attempt_artifact(text) is True

    def test_bullet_list_returns_true(self) -> None:
        text = "Here are the items:\n"
        text += "- First item with details\n"
        text += "- Second item with details\n"
        text += "- Third item with details\n"
        text += "And more content " * 20
        assert should_attempt_artifact(text) is True

    def test_bullet_list_too_few_returns_false(self) -> None:
        text = "Here are the items:\n- First item\n- Second item\n"
        text += "Extra text " * 20
        assert should_attempt_artifact(text) is False


# ---------------------------------------------------------------------------
# build_artifact_prompt
# ---------------------------------------------------------------------------


class TestBuildArtifactPrompt:
    def test_includes_component_catalog(self) -> None:
        prompt = build_artifact_prompt("Some response text " * 20)
        # Official react-ui component names
        assert "EmailDraft" in prompt
        assert "Table" in prompt
        assert "Col" in prompt
        assert "CodeBlock" in prompt
        assert "BarChart" in prompt
        assert "LineChart" in prompt
        assert "PieChart" in prompt
        assert "AreaChart" in prompt
        assert "RadarChart" in prompt
        assert "HorizontalBarChart" in prompt
        assert "ScatterChart" in prompt
        assert "Series" in prompt
        assert "Slice" in prompt
        assert "Card" in prompt
        assert "TextContent" in prompt
        assert "Accordion" in prompt
        assert "AccordionItem" in prompt
        assert "SectionBlock" in prompt
        assert "Tabs" in prompt
        assert "Carousel" in prompt
        assert "ListBlock" in prompt
        assert "FollowUpBlock" in prompt
        assert "Form" in prompt

    def test_does_not_include_old_component_names(self) -> None:
        prompt = build_artifact_prompt("Some response text " * 20)
        assert "DataTable" not in prompt
        assert "AnalysisReport" not in prompt
        assert "Chart(type:" not in prompt

    def test_includes_response_text(self) -> None:
        response = "My unique test response " * 10
        prompt = build_artifact_prompt(response)
        assert "My unique test response" in prompt

    def test_truncates_long_text(self) -> None:
        long_text = "x" * 10000
        prompt = build_artifact_prompt(long_text)
        # The prompt should contain the truncated text (4000 chars)
        assert len(prompt) < 10000 + 2000  # prompt template + truncated text

    def test_includes_none_guidance(self) -> None:
        prompt = build_artifact_prompt("Some text " * 20)
        assert "NONE" in prompt
        # Should have examples of when to output NONE
        assert "What kind of graph" in prompt

    def test_rules_mention_card_as_root(self) -> None:
        prompt = build_artifact_prompt("Some text " * 20)
        assert "root = Card(...)" in prompt
        assert "Do NOT use Stack" in prompt

    def test_rules_mention_col(self) -> None:
        prompt = build_artifact_prompt("Some text " * 20)
        assert "Col(" in prompt

    def test_rules_mention_series_and_slice(self) -> None:
        prompt = build_artifact_prompt("Some text " * 20)
        assert "Series(" in prompt
        assert "Slice(" in prompt

    def test_rules_mention_section_block(self) -> None:
        prompt = build_artifact_prompt("Some text " * 20)
        assert "SectionBlock" in prompt


# ---------------------------------------------------------------------------
# maybe_generate_artifact
# ---------------------------------------------------------------------------


class TestMaybeGenerateArtifact:
    def test_short_text_returns_none(self) -> None:
        llm = MagicMock()
        result = maybe_generate_artifact(llm, "Hello!")
        assert result is None
        llm.invoke.assert_not_called()

    def test_llm_returns_valid_openui(self) -> None:
        llm = MagicMock()
        llm_response = MagicMock()
        llm_response.content = (
            'TITLE: Email Draft\n'
            'root = EmailDraft(["john@example.com"], [], "Q4 Results", "Hi John")'
        )
        llm.invoke.return_value = llm_response

        text = (
            "Here's the email I drafted:\n"
            "To: john@example.com\n"
            "Subject: Q4 Results\n"
            "Body: Hi John, " + "x " * 50
        )
        result = maybe_generate_artifact(llm, text)
        assert result is not None
        openui_lang, title = result
        assert "EmailDraft" in openui_lang
        assert openui_lang.startswith("root =")
        assert title == "Email Draft"

    def test_llm_returns_none_string(self) -> None:
        llm = MagicMock()
        llm_response = MagicMock()
        llm_response.content = "NONE"
        llm.invoke.return_value = llm_response

        text = "```python\n" + "x = 1\n" * 20 + "```"
        result = maybe_generate_artifact(llm, text)
        assert result is None

    def test_llm_raises_exception_returns_none(self) -> None:
        llm = MagicMock()
        llm.invoke.side_effect = RuntimeError("LLM connection failed")

        text = "```python\n" + "x = 1\n" * 20 + "```"
        result = maybe_generate_artifact(llm, text)
        assert result is None

    def test_llm_returns_invalid_format_returns_none(self) -> None:
        llm = MagicMock()
        llm_response = MagicMock()
        llm_response.content = "This is not valid OpenUI Lang at all."
        llm.invoke.return_value = llm_response

        text = "```python\n" + "x = 1\n" * 20 + "```"
        result = maybe_generate_artifact(llm, text)
        assert result is None

    def test_llm_returns_multiline_openui(self) -> None:
        llm = MagicMock()
        llm_response = MagicMock()
        llm_response.content = (
            'TITLE: Python Code\n'
            'root = Card([title, cb])\n'
            'title = TextContent("Code", "large-heavy")\n'
            'cb = CodeBlock("python", codeStr)\n'
            'codeStr = "def hello():\\n    print(42)"'
        )
        llm.invoke.return_value = llm_response

        text = "Here is the code:\n```python\n" + "def hello():\n    print(42)\n" * 5 + "```"
        result = maybe_generate_artifact(llm, text)
        assert result is not None
        openui_lang, title = result
        assert "CodeBlock" in openui_lang
        assert "codeStr" in openui_lang
        assert "Card" in openui_lang
        assert title == "Python Code"

    def test_llm_returns_empty_string_returns_none(self) -> None:
        llm = MagicMock()
        llm_response = MagicMock()
        llm_response.content = ""
        llm.invoke.return_value = llm_response

        text = "```python\n" + "x = 1\n" * 20 + "```"
        result = maybe_generate_artifact(llm, text)
        assert result is None

    def test_pre_filter_passes_before_llm_call(self) -> None:
        """Verify that pre-filter runs and LLM is only called for structured content."""
        llm = MagicMock()
        llm_response = MagicMock()
        llm_response.content = "NONE"
        llm.invoke.return_value = llm_response

        # Simple text that passes length but has no structure
        simple_text = "The weather today is nice. " * 10
        result = maybe_generate_artifact(llm, simple_text)
        assert result is None
        # LLM should NOT be called because pre-filter rejects this
        llm.invoke.assert_not_called()
