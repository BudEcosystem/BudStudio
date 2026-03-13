"""Deterministic OpenUI Lang mapping for known tool results.

Maps structured tool results to OpenUI Lang strings that the frontend
can render as artifact cards using @openuidev/react-ui components
(EmailDraft, Table, CodeBlock, BarChart, LineChart, PieChart, etc.).

No LLM involved -- pure template logic based on result shape.
"""

from __future__ import annotations

import json
from typing import Any


def generate_openui_for_artifact_tool(
    artifact_type: str, title: str, data: dict[str, Any] | list[Any]
) -> tuple[str, str] | None:
    """Convert render_artifact tool input to OpenUI Lang.

    Routes to the appropriate converter based on the explicit artifact_type,
    injecting the title into the data if not already present.
    Falls back to generic key-based detection if the type doesn't match.

    The ``data`` parameter may be a dict or a list.  When the LLM passes a
    bare list (e.g. chart data rows), we normalise it into the expected dict
    format so downstream converters work unchanged.
    """
    # Normalise: if data is a list, wrap it for the requested type.
    if isinstance(data, list):
        if artifact_type == "chart":
            # Infer xKey/yKey from the first row's keys when the LLM sends
            # a bare array of data-point dicts.
            if data and isinstance(data[0], dict):
                keys = list(data[0].keys())
                x_key = keys[0] if keys else "x"
                y_key = keys[1] if len(keys) > 1 else "y"
                data = {"data": data, "xKey": x_key, "yKey": y_key}
            else:
                data = {"data": data, "xKey": "x", "yKey": "y"}
        elif artifact_type == "table":
            # Bare list of dicts -> auto-infer table
            data = {"data": data}
        else:
            # Wrap generically so dict operations below don't crash
            data = {"data": data}

    enriched: dict[str, Any] = {**data, "title": data.get("title", title)}

    if artifact_type == "email":
        if {"to", "subject", "body"} <= enriched.keys():
            return _to_email_draft(enriched)
    elif artifact_type == "table":
        if "columns" in enriched and "rows" in enriched:
            return _to_data_table(enriched)
        if "data" in enriched and isinstance(enriched["data"], list):
            return _list_of_dicts_to_data_table(enriched["data"], title)
    elif artifact_type == "code":
        if "code" in enriched:
            return _to_code_block(enriched)
    elif artifact_type == "report":
        if {"title", "summary", "sections"} <= enriched.keys():
            return _to_analysis_report(enriched)
    elif artifact_type == "chart":
        if {"data", "xKey", "yKey"} <= enriched.keys():
            return _to_chart(enriched)

    # Fallback: try generic key-based detection
    return generate_openui_lang("render_artifact", enriched)


def generate_openui_lang(
    tool_name: str, tool_result: dict[str, Any]
) -> tuple[str, str] | None:
    """Given a tool name and its result dict, return (openui_lang, title).

    Returns a tuple of (openui_lang_string, title_string) if the result
    matches a known artifact-renderable pattern.  Returns None otherwise.

    Detection order:
    1. Email tools: result has 'to', 'subject', 'body' keys
    2. Table/data tools: result has 'columns'+'rows', or is list-of-dicts
    3. Code tools: result has 'code' and 'language' keys
    4. Analysis tools: result has 'title', 'summary', 'sections' keys
    5. Chart tools: result has 'data', 'xKey', 'yKey' keys
    """
    if not isinstance(tool_result, dict):
        return None

    # 1. Email draft
    if {"to", "subject", "body"} <= tool_result.keys():
        return _to_email_draft(tool_result)

    # 2. Table / data
    if "columns" in tool_result and "rows" in tool_result:
        return _to_data_table(tool_result)
    # List-of-dicts variant (e.g. tool returns {"data": [{...}, ...]})
    if "data" in tool_result and isinstance(tool_result["data"], list):
        data_list = tool_result["data"]
        if (
            data_list
            and isinstance(data_list[0], dict)
            and "xKey" not in tool_result
            and "yKey" not in tool_result
        ):
            return _list_of_dicts_to_data_table(
                data_list, tool_result.get("title")
            )

    # 3. Code block
    if "code" in tool_result and "language" in tool_result:
        return _to_code_block(tool_result)

    # 4. Analysis report
    if {"title", "summary", "sections"} <= tool_result.keys():
        return _to_analysis_report(tool_result)

    # 5. Chart
    if {"data", "xKey", "yKey"} <= tool_result.keys():
        return _to_chart(tool_result)

    return None


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _escape_openui_string(s: str) -> str:
    """Escape quotes and newlines for OpenUI Lang string literals."""
    return (
        s.replace("\\", "\\\\")
        .replace('"', '\\"')
        .replace("\n", "\\n")
        .replace("\r", "")
        .replace("\t", "\\t")
    )


def _format_string_array(arr: list[str]) -> str:
    """Format a Python list of strings as OpenUI Lang array: ["a", "b"]."""
    items = ", ".join(f'"{_escape_openui_string(s)}"' for s in arr)
    return f"[{items}]"


def _format_json_value(value: Any) -> str:
    """Format a Python value as a JSON-compatible OpenUI Lang literal."""
    if isinstance(value, str):
        return f'"{_escape_openui_string(value)}"'
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (int, float)):
        return str(value)
    if value is None:
        return "null"
    # For complex types, use JSON serialization
    return json.dumps(value, ensure_ascii=False)


def _format_row_value(value: Any) -> str:
    """Format a single cell value for an OpenUI Lang rows array."""
    if isinstance(value, str):
        return f'"{_escape_openui_string(value)}"'
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (int, float)):
        return str(value)
    if value is None:
        return "null"
    return f'"{_escape_openui_string(str(value))}"'


# ---------------------------------------------------------------------------
# Component generators
# ---------------------------------------------------------------------------


def _to_email_draft(result: dict[str, Any]) -> tuple[str, str]:
    """Generate EmailDraft OpenUI Lang.

    Format:
        root = EmailDraft(["to@x.com"], ["cc@x.com"], "Subject", "Body")
    """
    to_list: list[str] = result["to"] if isinstance(result["to"], list) else [result["to"]]
    cc_list: list[str] = result.get("cc", [])
    if isinstance(cc_list, str):
        cc_list = [cc_list] if cc_list else []
    subject: str = str(result.get("subject", ""))
    body: str = str(result.get("body", ""))

    to_arr = _format_string_array(to_list)
    cc_arr = _format_string_array(cc_list)
    subj_str = f'"{_escape_openui_string(subject)}"'
    body_str = f'"{_escape_openui_string(body)}"'

    openui = f"root = EmailDraft({to_arr}, {cc_arr}, {subj_str}, {body_str})"
    title = f"Email: {subject}" if subject else "Email Draft"
    return openui, title


def _to_data_table(result: dict[str, Any]) -> tuple[str, str]:
    """Generate Table OpenUI Lang from columns + rows.

    Format:
        root = Card([title, tbl])
        title = TextContent("Title", "large-heavy")
        tbl = Table(cols, rows)
        cols = [Col("Name", "string"), Col("Age", "number")]
        rows = [["Alice", 30], ["Bob", 25]]
    """
    table_title: str = str(result.get("title", "Data"))
    columns: list[dict[str, Any]] = result["columns"]
    rows_data: list[dict[str, Any]] = result["rows"]

    # Build Col sub-components
    col_keys: list[str] = []
    col_items: list[str] = []
    for col in columns:
        key = str(col.get("key", ""))
        label = str(col.get("label", key))
        col_type = str(col.get("type", "string"))
        col_keys.append(key)
        col_items.append(f'Col("{_escape_openui_string(label)}", "{col_type}")')
    cols_str = f"[{', '.join(col_items)}]"

    # Build rows as arrays-of-arrays (values in column order)
    row_arrays: list[str] = []
    for row in rows_data:
        cells = [_format_row_value(row.get(k)) for k in col_keys]
        row_arrays.append(f"[{', '.join(cells)}]")
    rows_str = f"[{', '.join(row_arrays)}]"

    lines = [
        "root = Card([title, tbl])",
        f'title = TextContent("{_escape_openui_string(table_title)}", "large-heavy")',
        "tbl = Table(cols, rows)",
        f"cols = {cols_str}",
        f"rows = {rows_str}",
    ]
    openui = "\n".join(lines)
    return openui, table_title


def _list_of_dicts_to_data_table(
    data: list[dict[str, Any]], title: str | None = None
) -> tuple[str, str]:
    """Generate Table from a list of dicts (auto-infer columns)."""
    if not data:
        return (
            'root = Card([title, tbl])\n'
            'title = TextContent("Data", "large-heavy")\n'
            "tbl = Table([], [])"
        ), "Data"

    # Infer columns from the first row's keys
    first = data[0]
    col_keys: list[str] = list(first.keys())
    col_items: list[str] = []
    for key in col_keys:
        val = first[key]
        col_type = "number" if isinstance(val, (int, float)) else "string"
        label = key.replace("_", " ").title()
        col_items.append(f'Col("{_escape_openui_string(label)}", "{col_type}")')
    cols_str = f"[{', '.join(col_items)}]"

    # Build rows as arrays-of-arrays
    row_arrays: list[str] = []
    for row in data:
        cells = [_format_row_value(row.get(k)) for k in col_keys]
        row_arrays.append(f"[{', '.join(cells)}]")
    rows_str = f"[{', '.join(row_arrays)}]"

    table_title = title or "Data"

    lines = [
        "root = Card([title, tbl])",
        f'title = TextContent("{_escape_openui_string(table_title)}", "large-heavy")',
        "tbl = Table(cols, rows)",
        f"cols = {cols_str}",
        f"rows = {rows_str}",
    ]
    openui = "\n".join(lines)
    return openui, table_title


def _to_code_block(result: dict[str, Any]) -> tuple[str, str]:
    """Generate CodeBlock OpenUI Lang.

    Format:
        root = Card([title, cb])
        title = TextContent("Title", "large-heavy")
        cb = CodeBlock("python", codeStr)
        codeStr = "escaped code string"
    """
    language: str = str(result.get("language", "text"))
    code: str = str(result.get("code", ""))
    filename: str = str(result.get("filename", ""))

    code_escaped = _escape_openui_string(code)
    lang_str = f'"{_escape_openui_string(language)}"'

    display_title = filename if filename else f"{language} code"

    lines = [
        "root = Card([title, cb])",
        f'title = TextContent("{_escape_openui_string(display_title)}", "large-heavy")',
        f"cb = CodeBlock({lang_str}, codeStr)",
        f'codeStr = "{code_escaped}"',
    ]
    openui = "\n".join(lines)
    return openui, display_title


def _to_analysis_report(result: dict[str, Any]) -> tuple[str, str]:
    """Generate Card + TextContent + Accordion OpenUI Lang.

    Format:
        root = Card([title, summary, accordion])
        title = TextContent("Title", "large-heavy")
        summary = TextContent("Summary text")
        accordion = Accordion([s0, s1, ...])
        s0 = AccordionItem("Section Title", [TextContent("content")])
        ...
    """
    report_title: str = str(result.get("title", "Analysis"))
    summary_text: str = str(result.get("summary", ""))
    sections: list[dict[str, Any]] = result.get("sections", [])

    # Build accordion items
    section_refs: list[str] = []
    section_lines: list[str] = []
    for i, section in enumerate(sections):
        ref_name = f"s{i}"
        section_refs.append(ref_name)
        heading = str(section.get("heading", f"Section {i + 1}"))
        body = str(section.get("body", ""))
        section_lines.append(
            f'{ref_name} = AccordionItem("sec{i}", '
            f'"{_escape_openui_string(heading)}", '
            f'[TextContent("{_escape_openui_string(body)}")])'
        )

    accordion_children = f"[{', '.join(section_refs)}]"

    lines = [
        "root = Card([title, summary, accordion])",
        f'title = TextContent("{_escape_openui_string(report_title)}", "large-heavy")',
        f'summary = TextContent("{_escape_openui_string(summary_text)}")',
        f"accordion = Accordion({accordion_children})",
    ]
    lines.extend(section_lines)
    openui = "\n".join(lines)
    return openui, report_title


def _to_chart(result: dict[str, Any]) -> tuple[str, str]:
    """Generate BarChart/LineChart/PieChart OpenUI Lang.

    For bar/line:
        root = Card([title, chart])
        title = TextContent("Title", "large-heavy")
        chart = BarChart(labels, [s1], "grouped")
        labels = ["Jan", "Feb"]
        s1 = Series("Values", [10, 20])

    For pie:
        root = Card([title, chart])
        title = TextContent("Title", "large-heavy")
        chart = PieChart([sl0, sl1, ...])
        sl0 = Slice("Category", 42)
        ...
    """
    chart_type: str = str(result.get("type", "bar"))
    chart_title: str = str(result.get("title", "Chart"))
    data: list[dict[str, Any]] = result.get("data", [])
    x_key: str = str(result.get("xKey", "x"))
    y_key: str = str(result.get("yKey", "y"))

    # Extract labels and values from data
    labels: list[str] = [str(row.get(x_key, "")) for row in data]
    values: list[float | int] = []
    for row in data:
        val = row.get(y_key, 0)
        values.append(val if isinstance(val, (int, float)) else 0)

    labels_str = _format_string_array(labels)

    if chart_type == "pie":
        # PieChart with Slice sub-components
        slice_refs: list[str] = []
        slice_lines: list[str] = []
        for i, (label, value) in enumerate(zip(labels, values)):
            ref_name = f"sl{i}"
            slice_refs.append(ref_name)
            slice_lines.append(
                f'{ref_name} = Slice("{_escape_openui_string(label)}", {value})'
            )

        slices_arr = f"[{', '.join(slice_refs)}]"
        lines = [
            "root = Card([title, chart])",
            f'title = TextContent("{_escape_openui_string(chart_title)}", "large-heavy")',
            f"chart = PieChart({slices_arr})",
        ]
        lines.extend(slice_lines)
    elif chart_type == "line":
        # LineChart with Series
        values_str = f"[{', '.join(str(v) for v in values)}]"
        lines = [
            "root = Card([title, chart])",
            f'title = TextContent("{_escape_openui_string(chart_title)}", "large-heavy")',
            'chart = LineChart(labels, [s1])',
            f"labels = {labels_str}",
            f's1 = Series("{_escape_openui_string(y_key)}", {values_str})',
        ]
    else:
        # BarChart (default) with Series
        values_str = f"[{', '.join(str(v) for v in values)}]"
        lines = [
            "root = Card([title, chart])",
            f'title = TextContent("{_escape_openui_string(chart_title)}", "large-heavy")',
            'chart = BarChart(labels, [s1], "grouped")',
            f"labels = {labels_str}",
            f's1 = Series("{_escape_openui_string(y_key)}", {values_str})',
        ]

    openui = "\n".join(lines)
    return openui, chart_title
