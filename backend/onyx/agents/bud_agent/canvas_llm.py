"""LLM-driven canvas generation from agent text responses.

After the agent finishes its text response, this module decides if the
response contains content worth rendering as rich UI (email draft, data
table, code block, chart, report).  If yes, it generates OpenUI Lang via
a secondary LLM call and returns it for the frontend canvas panel.

The tool-based canvas path (canvas_utils.py) is the fast path — it fires
when a tool returns structured data matching hardcoded key patterns.
This module is the fallback that analyses free-text responses.
"""

from __future__ import annotations

import re
from typing import Any

from onyx.utils.logger import setup_logger

logger = setup_logger()

# ---------------------------------------------------------------------------
# Official OpenUI system prompt (from @openuidev/react-ui)
# ---------------------------------------------------------------------------

OPENUI_SYSTEM_PROMPT = """\
You are an AI assistant that responds using openui-lang, a declarative UI language. \
Your ENTIRE response must be valid openui-lang code — no markdown, no explanations, just openui-lang.

## Syntax Rules

1. Each statement is on its own line: `identifier = Expression`
2. `root` is the entry point — every program must define `root = Card(...)`
3. Expressions are: strings ("..."), numbers, booleans (true/false), arrays ([...]), objects ({...}), or component calls TypeName(arg1, arg2, ...)
4. Use references for readability: define `name = ...` on one line, then use `name` later
5. EVERY variable (except root) MUST be referenced by at least one other variable. Unreferenced variables are silently dropped and will NOT render. Always include defined variables in their parent's children/items array.
6. Arguments are POSITIONAL (order matters, not names)
7. Optional arguments can be omitted from the end
8. No operators, no logic, no variables — only declarations
9. Strings use double quotes with backslash escaping

## Component Signatures

Arguments marked with ? are optional. Sub-components can be inline or referenced; prefer references for better streaming.
The `action` prop type accepts: ContinueConversation (sends message to LLM), OpenUrl (navigates to URL), or Custom (app-defined).

### Custom
EmailDraft(to: string[], cc: string[], subject: string, body: string) — Email draft with recipients, subject, and body

### Content
CardHeader(title?: string, subtitle?: string) — Header with optional title and subtitle
TextContent(text: string, size?: "small" | "default" | "large" | "small-heavy" | "large-heavy") — Text block. Supports markdown.
MarkDownRenderer(textMarkdown: string, variant?: "clear" | "card" | "sunk") — Renders markdown text
Callout(variant: "info" | "warning" | "error" | "success" | "neutral", title: string, description: string) — Callout banner
CodeBlock(language: string, codeString: string) — Syntax-highlighted code block
Separator(orientation?: "horizontal" | "vertical", decorative?: boolean) — Visual divider

### Tables
Table(columns: Col[], rows: (string | number | boolean)[][]) — Data table
Col(label: string, type?: "string" | "number" | "action") — Column definition

### Charts (2D)
BarChart(labels: string[], series: Series[], variant?: "grouped" | "stacked", xLabel?: string, yLabel?: string) — Vertical bars
LineChart(labels: string[], series: Series[], variant?: "linear" | "natural" | "step", xLabel?: string, yLabel?: string) — Lines over categories
AreaChart(labels: string[], series: Series[], variant?: "linear" | "natural" | "step", xLabel?: string, yLabel?: string) — Filled area under lines
RadarChart(labels: string[], series: Series[]) — Spider/web chart
HorizontalBarChart(labels: string[], series: Series[], variant?: "grouped" | "stacked", xLabel?: string, yLabel?: string) — Horizontal bars
Series(category: string, values: number[]) — One data series

### Charts (1D)
PieChart(slices: Slice[], variant?: "pie" | "donut") — Circular slices showing part-to-whole proportions
RadialChart(slices: Slice[]) — Radial bars showing proportional distribution
SingleStackedBarChart(slices: Slice[]) — Single horizontal stacked bar
Slice(category: string, value: number) — One slice with label and numeric value

### Charts (Scatter)
ScatterChart(datasets: ScatterSeries[], xLabel?: string, yLabel?: string) — X/Y scatter plot
ScatterSeries(name: string, points: Point[]) — Named dataset
Point(x: number, y: number, z?: number) — Data point

### Forms
Form(name: string, buttons: Buttons, fields) — Form container
FormControl(label: string, input: Input | TextArea | Select | DatePicker | Slider | CheckBoxGroup | RadioGroup, hint?: string)
Input(name: string, placeholder?: string, type?: "text" | "email" | "password" | "number" | "url", rules?: object)
TextArea(name: string, placeholder?: string, rows?: number, rules?: object)
Select(name: string, items: SelectItem[], placeholder?: string, rules?: object)
SelectItem(value: string, label: string)
DatePicker(name: string, mode: "single" | "range", rules?: object)
Slider(name: string, variant: "continuous" | "discrete", min: number, max: number, step?: number, defaultValue?: number[], rules?: object)
CheckBoxGroup(name: string, items: CheckBoxItem[], rules?: object)
CheckBoxItem(label: string, description: string, name: string, defaultChecked?: boolean)
RadioGroup(name: string, items: RadioItem[], defaultValue?: string, rules?: object)
RadioItem(label: string, description: string, value: string)

### Buttons
Button(label: string, action?: object, variant?: "primary" | "secondary" | "tertiary", type?: "normal" | "destructive", size?: "extra-small" | "small" | "medium" | "large")
Buttons(buttons: Button[], direction?: "row" | "column") — Group of buttons

### Lists & Follow-ups
ListBlock(items: ListItem[], variant?: "number" | "image") — Clickable list
ListItem(title: string, subtitle?: string, image?: object, actionLabel?: string, action?: object)
FollowUpBlock(items: FollowUpItem[]) — Clickable follow-up suggestions
FollowUpItem(text: string)

### Sections
SectionBlock(sections: SectionItem[], isFoldable?: boolean) — Collapsible accordion sections
SectionItem(value: string, trigger: string, content: ref[])

### Layout
Tabs(items: TabItem[]) — Tabbed container
TabItem(value: string, trigger: string, content: ref[])
Accordion(items: AccordionItem[]) — Collapsible sections
AccordionItem(value: string, trigger: string, content: ref[])
Steps(items: StepsItem[]) — Step-by-step guide
StepsItem(title: string, details: string)
Carousel(children: ref[][], variant?: "card" | "sunk") — Horizontal scrollable carousel

### Data Display
TagBlock(tags: string[])

### Container
Card(children: ref[]) — Vertical container for all content. Children stack top to bottom automatically.

## Important Rules
- ALWAYS start with root = Card(...)
- Card is the only layout container. Do NOT use Stack.
- Write statements in TOP-DOWN order: root → components → data
- Each statement on its own line
- No trailing text or explanations — output ONLY openui-lang code
- Choose components that best represent the content
- NEVER define a variable without referencing it from the tree
- Use FollowUpBlock at the END of a Card to suggest next actions
- Use SectionBlock to group long responses into collapsible sections
- For forms, define one FormControl reference per field"""

# ---------------------------------------------------------------------------
# Minimum response length to even consider canvas generation.
# ---------------------------------------------------------------------------
_MIN_CHARS = 150

# Patterns that indicate structured content.
_CODE_FENCE_RE = re.compile(r"```\w*\n", re.MULTILINE)
_MD_TABLE_RE = re.compile(r"\|.*\|.*\|", re.MULTILINE)
_EMAIL_RE = re.compile(
    r"(?:^|\n)\s*\**(?:To|Subject|From)\**\s*:", re.IGNORECASE
)
_SECTION_HEADER_RE = re.compile(r"(?:^|\n)#{1,3}\s+\S", re.MULTILINE)
_NUMBERED_LIST_RE = re.compile(
    r"(?:^|\n)\s*\d+\.\s+\S", re.MULTILINE
)
_BULLET_LIST_RE = re.compile(
    r"(?:^|\n)\s*[-*]\s+\S", re.MULTILINE
)


def should_attempt_canvas(response_text: str) -> bool:
    """Cheap pre-filter — no LLM call.

    Returns True if the text contains indicators of structured content
    that could be rendered as a canvas component.
    """
    if len(response_text) < _MIN_CHARS:
        return False

    # Check for structural indicators
    if _CODE_FENCE_RE.search(response_text):
        return True
    if _MD_TABLE_RE.search(response_text):
        return True
    if _EMAIL_RE.search(response_text):
        return True
    if _SECTION_HEADER_RE.search(response_text):
        return True
    # Numbered list with at least 3 items suggests data
    if len(_NUMBERED_LIST_RE.findall(response_text)) >= 3:
        return True
    # Bullet list with at least 3 items suggests structured content
    if len(_BULLET_LIST_RE.findall(response_text)) >= 3:
        return True

    return False


def build_canvas_prompt(response_text: str) -> str:
    """Build the prompt sent to the LLM for canvas generation."""
    truncated = response_text[:4000]
    return f"""{OPENUI_SYSTEM_PROMPT}

## Task

Given the AI assistant response below, convert it into openui-lang.
If the response is conversational, a simple answer, a question back to the user, \
or doesn't contain structured/renderable content, output exactly: NONE

Before writing the openui-lang, output a title line: TITLE: <short title>

Examples of when to output NONE:
- "The answer is 42."
- "What kind of graph do you want?"
- "Sure, I can help with that. What details do you need?"

Examples of when to generate openui-lang:
- Response contains a table, code block, email draft, chart data, step-by-step guide, or structured report

AI Assistant Response:
---
{truncated}
---

Output:"""


def maybe_generate_canvas(
    llm: Any,
    response_text: str,
) -> tuple[str, str] | None:
    """Attempt to generate canvas OpenUI Lang from the agent's text response.

    Returns (openui_lang, title) if canvas content was generated, else None.
    Uses the same LLM the agent used for the conversation.
    """
    if not should_attempt_canvas(response_text):
        return None

    try:
        prompt = build_canvas_prompt(response_text)
        result = llm.invoke(prompt)

        # Extract text content from the LLM response
        if hasattr(result, "content"):
            text = str(result.content).strip()
        else:
            text = str(result).strip()

        logger.info(
            "[CANVAS-LLM] Raw LLM response (first 500 chars): %r",
            text[:500],
        )

        if not text or text.upper() == "NONE":
            logger.info("[CANVAS-LLM] LLM returned empty or NONE")
            return None

        # Parse the response: look for "root = " line and optional "TITLE: " line
        lines = text.split("\n")
        openui_lines: list[str] = []
        title = "Canvas"

        for line in lines:
            stripped = line.strip()
            if stripped.upper().startswith("TITLE:"):
                title = stripped[6:].strip().strip('"').strip("'")
            elif stripped and stripped.upper() != "NONE":
                openui_lines.append(line)

        openui_lang = "\n".join(openui_lines).strip()

        if not openui_lang or not openui_lang.startswith("root ="):
            logger.info(
                "[CANVAS-LLM] Parsed openui_lang doesn't start with 'root =': %r",
                openui_lang[:200] if openui_lang else "(empty)",
            )
            return None

        return openui_lang, title

    except Exception:
        logger.warning(
            "Canvas LLM generation failed, skipping canvas",
            exc_info=True,
        )
        return None
