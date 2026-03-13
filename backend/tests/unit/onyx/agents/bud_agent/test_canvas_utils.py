"""Unit tests for canvas_utils — deterministic OpenUI Lang mapping."""

from onyx.agents.bud_agent.canvas_utils import (
    _escape_openui_string,
    _format_string_array,
    _to_analysis_report,
    _to_chart,
    _to_code_block,
    _to_data_table,
    _to_email_draft,
    generate_openui_for_canvas_tool,
    generate_openui_lang,
)


# ---------------------------------------------------------------------------
# Escape helpers
# ---------------------------------------------------------------------------


class TestEscapeOpenUIString:
    def test_plain_string(self) -> None:
        assert _escape_openui_string("hello") == "hello"

    def test_quotes_escaped(self) -> None:
        assert _escape_openui_string('say "hi"') == 'say \\"hi\\"'

    def test_newlines_escaped(self) -> None:
        assert _escape_openui_string("a\nb") == "a\\nb"

    def test_tabs_escaped(self) -> None:
        assert _escape_openui_string("a\tb") == "a\\tb"

    def test_carriage_return_stripped(self) -> None:
        assert _escape_openui_string("a\r\nb") == "a\\nb"

    def test_backslash_escaped(self) -> None:
        assert _escape_openui_string("a\\b") == "a\\\\b"


class TestFormatStringArray:
    def test_empty_list(self) -> None:
        assert _format_string_array([]) == "[]"

    def test_single_element(self) -> None:
        assert _format_string_array(["a"]) == '["a"]'

    def test_multiple_elements(self) -> None:
        result = _format_string_array(["a", "b", "c"])
        assert result == '["a", "b", "c"]'

    def test_element_with_quotes(self) -> None:
        result = _format_string_array(['say "hi"'])
        assert result == '["say \\"hi\\""]'


# ---------------------------------------------------------------------------
# Email Draft
# ---------------------------------------------------------------------------


class TestToEmailDraft:
    def test_basic_email(self) -> None:
        result = {
            "to": ["john@example.com"],
            "subject": "Q4 Report",
            "body": "Here are the results.",
        }
        openui, title = _to_email_draft(result)
        assert "EmailDraft" in openui
        assert '"john@example.com"' in openui
        assert '"Q4 Report"' in openui
        assert '"Here are the results."' in openui
        assert title == "Email: Q4 Report"

    def test_email_with_cc(self) -> None:
        result = {
            "to": ["a@test.com"],
            "cc": ["b@test.com"],
            "subject": "Hi",
            "body": "Hello",
        }
        openui, title = _to_email_draft(result)
        assert '"b@test.com"' in openui

    def test_email_string_to(self) -> None:
        result = {
            "to": "single@test.com",
            "subject": "Test",
            "body": "body",
        }
        openui, title = _to_email_draft(result)
        assert '"single@test.com"' in openui

    def test_email_no_subject(self) -> None:
        result = {
            "to": ["a@test.com"],
            "subject": "",
            "body": "body",
        }
        _, title = _to_email_draft(result)
        assert title == "Email Draft"


# ---------------------------------------------------------------------------
# Table (was DataTable)
# ---------------------------------------------------------------------------


class TestToDataTable:
    def test_basic_table(self) -> None:
        result = {
            "columns": [
                {"key": "name", "label": "Name", "type": "string"},
            ],
            "rows": [{"name": "Alice"}],
            "title": "Users",
        }
        openui, title = _to_data_table(result)
        assert "Card" in openui
        assert "Table" in openui
        assert "TextContent" in openui
        assert 'Col("Name", "string")' in openui
        assert '"Users"' in openui
        assert title == "Users"
        # Rows should be array-of-arrays
        assert '["Alice"]' in openui

    def test_table_default_title(self) -> None:
        result = {
            "columns": [{"key": "x", "label": "X", "type": "number"}],
            "rows": [{"x": 1}],
        }
        _, title = _to_data_table(result)
        assert title == "Data"

    def test_table_multiple_columns_and_rows(self) -> None:
        result = {
            "columns": [
                {"key": "name", "label": "Name", "type": "string"},
                {"key": "age", "label": "Age", "type": "number"},
            ],
            "rows": [
                {"name": "Alice", "age": 30},
                {"name": "Bob", "age": 25},
            ],
            "title": "People",
        }
        openui, title = _to_data_table(result)
        assert 'Col("Name", "string")' in openui
        assert 'Col("Age", "number")' in openui
        assert '["Alice", 30]' in openui
        assert '["Bob", 25]' in openui
        assert title == "People"

    def test_table_structure(self) -> None:
        """Verify the overall structure: Card wrapping TextContent + Table."""
        result = {
            "columns": [{"key": "x", "label": "X", "type": "string"}],
            "rows": [{"x": "val"}],
            "title": "Test",
        }
        openui, _ = _to_data_table(result)
        lines = openui.split("\n")
        assert lines[0] == "root = Card([title, tbl])"
        assert lines[1].startswith('title = TextContent("Test", "large-heavy")')
        assert lines[2] == "tbl = Table(cols, rows)"
        assert lines[3].startswith("cols = [Col(")
        assert lines[4].startswith("rows = [")


# ---------------------------------------------------------------------------
# CodeBlock
# ---------------------------------------------------------------------------


class TestToCodeBlock:
    def test_basic_code(self) -> None:
        result = {
            "language": "python",
            "code": "print('hello')",
            "filename": "test.py",
        }
        openui, title = _to_code_block(result)
        assert "CodeBlock" in openui
        assert '"python"' in openui
        assert "print" in openui
        assert "codeStr" in openui
        assert title == "test.py"

    def test_code_no_filename(self) -> None:
        result = {
            "language": "javascript",
            "code": "console.log(1)",
        }
        openui, title = _to_code_block(result)
        assert "CodeBlock" in openui
        assert "codeStr" in openui
        assert title == "javascript code"

    def test_code_with_newlines(self) -> None:
        result = {
            "language": "python",
            "code": "def foo():\n    return 42",
        }
        openui, _ = _to_code_block(result)
        # Newlines should be escaped
        assert "\\n" in openui

    def test_code_uses_card_wrapper(self) -> None:
        result = {
            "language": "python",
            "code": "x = 1",
        }
        openui, _ = _to_code_block(result)
        assert openui.startswith("root = Card([title, cb])")
        assert "TextContent" in openui

    def test_code_no_filename_prop(self) -> None:
        """CodeBlock should not have a filename parameter — only language and codeString."""
        result = {
            "language": "python",
            "code": "x = 1",
            "filename": "test.py",
        }
        openui, _ = _to_code_block(result)
        # The CodeBlock call itself should only have language and codeStr
        for line in openui.split("\n"):
            if line.startswith("cb = CodeBlock"):
                assert "codeStr" in line
                # Should be exactly: cb = CodeBlock("python", codeStr)
                assert line == 'cb = CodeBlock("python", codeStr)'
                break


# ---------------------------------------------------------------------------
# AnalysisReport -> Stack + Accordion
# ---------------------------------------------------------------------------


class TestToAnalysisReport:
    def test_basic_report(self) -> None:
        result = {
            "title": "Market Analysis",
            "summary": "Sales are up.",
            "sections": [
                {"heading": "Revenue", "body": "Revenue increased by 20%."},
            ],
        }
        openui, title = _to_analysis_report(result)
        assert "Card" in openui
        assert "TextContent" in openui
        assert "Accordion" in openui
        assert "AccordionItem" in openui
        assert '"Market Analysis"' in openui
        assert '"Sales are up."' in openui
        assert '"Revenue"' in openui
        assert title == "Market Analysis"

    def test_report_structure(self) -> None:
        result = {
            "title": "Report",
            "summary": "Summary text",
            "sections": [
                {"heading": "Section A", "body": "Body A"},
                {"heading": "Section B", "body": "Body B"},
            ],
        }
        openui, _ = _to_analysis_report(result)
        lines = openui.split("\n")
        assert lines[0] == "root = Card([title, summary, accordion])"
        assert 'title = TextContent("Report", "large-heavy")' in lines[1]
        assert 'summary = TextContent("Summary text")' in lines[2]
        assert "accordion = Accordion([s0, s1])" in lines[3]
        assert lines[4].startswith('s0 = AccordionItem("sec0", "Section A"')
        assert lines[5].startswith('s1 = AccordionItem("sec1", "Section B"')

    def test_report_empty_sections(self) -> None:
        result = {
            "title": "Empty",
            "summary": "No sections",
            "sections": [],
        }
        openui, title = _to_analysis_report(result)
        assert "accordion = Accordion([])" in openui
        assert title == "Empty"


# ---------------------------------------------------------------------------
# Chart -> BarChart / LineChart / PieChart
# ---------------------------------------------------------------------------


class TestToChart:
    def test_bar_chart(self) -> None:
        result = {
            "type": "bar",
            "title": "Revenue",
            "data": [
                {"month": "Jan", "value": 100},
                {"month": "Feb", "value": 200},
            ],
            "xKey": "month",
            "yKey": "value",
        }
        openui, title = _to_chart(result)
        assert "BarChart" in openui
        assert "Card" in openui
        assert "TextContent" in openui
        assert "Series" in openui
        assert '"Revenue"' in openui
        assert '"Jan"' in openui
        assert '"Feb"' in openui
        assert "[100, 200]" in openui
        assert title == "Revenue"

    def test_line_chart(self) -> None:
        result = {
            "type": "line",
            "title": "Trend",
            "data": [
                {"day": "Mon", "count": 5},
                {"day": "Tue", "count": 8},
            ],
            "xKey": "day",
            "yKey": "count",
        }
        openui, title = _to_chart(result)
        assert "LineChart" in openui
        assert "Series" in openui
        assert '"Mon"' in openui
        assert "[5, 8]" in openui
        assert title == "Trend"

    def test_pie_chart(self) -> None:
        result = {
            "type": "pie",
            "title": "Market Share",
            "data": [
                {"company": "A", "share": 40},
                {"company": "B", "share": 35},
                {"company": "C", "share": 25},
            ],
            "xKey": "company",
            "yKey": "share",
        }
        openui, title = _to_chart(result)
        assert "PieChart" in openui
        assert "Slice" in openui
        assert 'Slice("A", 40)' in openui
        assert 'Slice("B", 35)' in openui
        assert 'Slice("C", 25)' in openui
        assert title == "Market Share"

    def test_chart_defaults(self) -> None:
        result = {
            "data": [{"x": 1, "y": 2}],
            "xKey": "x",
            "yKey": "y",
        }
        openui, title = _to_chart(result)
        assert "BarChart" in openui  # default type
        assert title == "Chart"  # default title

    def test_bar_chart_grouped_mode(self) -> None:
        result = {
            "type": "bar",
            "title": "Test",
            "data": [{"x": "A", "y": 10}],
            "xKey": "x",
            "yKey": "y",
        }
        openui, _ = _to_chart(result)
        assert '"grouped"' in openui


# ---------------------------------------------------------------------------
# generate_openui_lang — top-level dispatcher
# ---------------------------------------------------------------------------


class TestGenerateOpenUILang:
    def test_returns_none_for_non_dict(self) -> None:
        assert generate_openui_lang("tool", "not a dict") is None  # type: ignore[arg-type]

    def test_returns_none_for_unrecognized_dict(self) -> None:
        assert generate_openui_lang("tool", {"foo": "bar"}) is None

    def test_detects_email(self) -> None:
        result = {
            "to": ["a@b.com"],
            "subject": "Hi",
            "body": "Hello",
        }
        mapping = generate_openui_lang("send_email", result)
        assert mapping is not None
        openui, title = mapping
        assert "EmailDraft" in openui
        assert "Email" in title

    def test_detects_table(self) -> None:
        result = {
            "columns": [{"key": "id", "label": "ID", "type": "number"}],
            "rows": [{"id": 1}],
        }
        mapping = generate_openui_lang("query_db", result)
        assert mapping is not None
        openui, _ = mapping
        assert "Table" in openui
        assert "Col" in openui

    def test_detects_code(self) -> None:
        result = {"code": "x = 1", "language": "python"}
        mapping = generate_openui_lang("generate_code", result)
        assert mapping is not None
        openui, _ = mapping
        assert "CodeBlock" in openui
        assert "codeStr" in openui

    def test_detects_analysis(self) -> None:
        result = {
            "title": "Report",
            "summary": "Summary here",
            "sections": [],
        }
        mapping = generate_openui_lang("analyze", result)
        assert mapping is not None
        openui, _ = mapping
        assert "Accordion" in openui
        assert "Card" in openui

    def test_detects_chart(self) -> None:
        result = {
            "data": [{"x": 1, "y": 2}],
            "xKey": "x",
            "yKey": "y",
        }
        mapping = generate_openui_lang("chart_data", result)
        assert mapping is not None
        openui, _ = mapping
        assert "BarChart" in openui

    def test_list_of_dicts_becomes_data_table(self) -> None:
        result = {
            "data": [
                {"name": "Alice", "age": 30},
                {"name": "Bob", "age": 25},
            ],
        }
        mapping = generate_openui_lang("list_users", result)
        assert mapping is not None
        openui, _ = mapping
        assert "Table" in openui
        assert "Col" in openui

    def test_data_with_xkey_ykey_is_chart_not_table(self) -> None:
        """When data has xKey+yKey, it should be chart, not table."""
        result = {
            "data": [{"x": 1, "y": 2}],
            "xKey": "x",
            "yKey": "y",
        }
        mapping = generate_openui_lang("plot", result)
        assert mapping is not None
        openui, _ = mapping
        assert "BarChart" in openui

    def test_empty_data_list_returns_none(self) -> None:
        """Empty data list should not match list-of-dicts table pattern."""
        result = {"data": []}
        assert generate_openui_lang("tool", result) is None

    def test_data_list_of_non_dicts_returns_none(self) -> None:
        """Data list of non-dicts should not match table pattern."""
        result = {"data": [1, 2, 3]}
        assert generate_openui_lang("tool", result) is None


# ---------------------------------------------------------------------------
# generate_openui_for_canvas_tool — type-routed wrapper
# ---------------------------------------------------------------------------


class TestGenerateOpenUIForCanvasTool:
    def test_chart_type_routes_to_chart(self) -> None:
        data = {
            "data": [{"city": "NYC", "temp": 72}],
            "xKey": "city",
            "yKey": "temp",
        }
        result = generate_openui_for_canvas_tool("chart", "Temperatures", data)
        assert result is not None
        openui, title = result
        assert "BarChart" in openui
        assert title == "Temperatures"

    def test_table_type_routes_to_table(self) -> None:
        data = {
            "columns": [{"key": "name", "label": "Name", "type": "string"}],
            "rows": [{"name": "Alice"}],
        }
        result = generate_openui_for_canvas_tool("table", "Users", data)
        assert result is not None
        openui, title = result
        assert "Table" in openui
        assert title == "Users"

    def test_email_type_routes_to_email(self) -> None:
        data = {
            "to": ["a@test.com"],
            "subject": "Hello",
            "body": "Hi there",
        }
        result = generate_openui_for_canvas_tool("email", "My Email", data)
        assert result is not None
        openui, title = result
        assert "EmailDraft" in openui

    def test_code_type_routes_to_code(self) -> None:
        data = {"code": "print(1)", "language": "python"}
        result = generate_openui_for_canvas_tool("code", "Snippet", data)
        assert result is not None
        openui, title = result
        assert "CodeBlock" in openui

    def test_report_type_routes_to_report(self) -> None:
        data = {
            "title": "Report",
            "summary": "Summary",
            "sections": [{"heading": "Sec1", "body": "Body1"}],
        }
        result = generate_openui_for_canvas_tool("report", "Analysis", data)
        assert result is not None
        openui, title = result
        assert "Accordion" in openui

    def test_title_injected_when_missing(self) -> None:
        data = {
            "data": [{"x": "A", "y": 10}],
            "xKey": "x",
            "yKey": "y",
        }
        result = generate_openui_for_canvas_tool("chart", "My Chart", data)
        assert result is not None
        openui, title = result
        assert title == "My Chart"

    def test_title_not_overridden_when_present(self) -> None:
        data = {
            "data": [{"x": "A", "y": 10}],
            "xKey": "x",
            "yKey": "y",
            "title": "Original",
        }
        result = generate_openui_for_canvas_tool("chart", "Override", data)
        assert result is not None
        _, title = result
        assert title == "Original"

    def test_unknown_type_falls_back_to_generic(self) -> None:
        data = {
            "to": ["a@test.com"],
            "subject": "Hi",
            "body": "Body",
        }
        # Type is "unknown" but data matches email pattern via fallback
        result = generate_openui_for_canvas_tool("unknown", "Title", data)
        assert result is not None
        openui, _ = result
        assert "EmailDraft" in openui

    def test_mismatched_type_and_data_returns_none(self) -> None:
        data = {"foo": "bar"}
        result = generate_openui_for_canvas_tool("chart", "Title", data)
        assert result is None

    def test_pie_chart(self) -> None:
        data = {
            "data": [
                {"cat": "A", "val": 40},
                {"cat": "B", "val": 60},
            ],
            "xKey": "cat",
            "yKey": "val",
            "type": "pie",
        }
        result = generate_openui_for_canvas_tool("chart", "Shares", data)
        assert result is not None
        openui, _ = result
        assert "PieChart" in openui
        assert "Slice" in openui

    def test_chart_with_list_data(self) -> None:
        """When the LLM sends data as a bare list, it should still render."""
        data_list: list[dict[str, object]] = [
            {"city": "Tokyo", "population": 37},
            {"city": "Delhi", "population": 35},
        ]
        result = generate_openui_for_canvas_tool("chart", "Populations", data_list)  # type: ignore[arg-type]
        assert result is not None
        openui, title = result
        assert "BarChart" in openui
        assert "Tokyo" in openui
        assert title == "Populations"

    def test_table_with_list_data(self) -> None:
        """Bare list of dicts for table type should auto-infer columns."""
        data_list: list[dict[str, object]] = [
            {"name": "Alice", "age": 30},
        ]
        result = generate_openui_for_canvas_tool("table", "Users", data_list)  # type: ignore[arg-type]
        assert result is not None
        openui, title = result
        assert "Table" in openui
        assert "Alice" in openui
        assert title == "Users"
