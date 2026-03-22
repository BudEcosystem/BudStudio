"""Artifact tool for BudAgent — renders content as a rich UI artifact.

The model provides content (markdown, text, data) and a type hint.
The tool calls the LLM with the OpenUI Lang spec to convert the content
into a renderable OpenUI Lang program, then emits it as a CustomToolDelta
packet for the frontend artifact panel.
"""

import json
import uuid
from queue import Queue
from typing import Any
from typing import Callable
from uuid import UUID

from agents import FunctionTool
from agents import RunContextWrapper

from onyx.agents.bud_agent.tool_definitions import REMOTE_TOOL_SCHEMAS
from onyx.db.agent import add_tool_message
from onyx.db.agent import update_tool_message_result
from onyx.server.query_and_chat.streaming_models import CustomToolDelta
from onyx.server.query_and_chat.streaming_models import CustomToolStart
from onyx.server.query_and_chat.streaming_models import Packet
from onyx.server.query_and_chat.streaming_models import SectionEnd
from onyx.utils.logger import setup_logger

logger = setup_logger()

TOOL_NAME = "render_artifact"

# ---------------------------------------------------------------------------
# OpenUI Lang system prompt (from @openuidev/react-ui)
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
# Helpers
# ---------------------------------------------------------------------------


def _build_artifact_prompt(
    artifact_type: str, title: str, content: str
) -> str:
    """Build the LLM prompt for converting content to OpenUI Lang."""
    truncated = content[:4000]
    return f"""{OPENUI_SYSTEM_PROMPT}

## Task

Render the following content as a "{artifact_type}" style openui-lang component.
Title: {title}

Content:
---
{truncated}
---

Output ONLY valid openui-lang code starting with root = Card(...)"""


def _parse_openui_response(text: str) -> str | None:
    """Extract valid OpenUI Lang from an LLM response.

    Returns the openui-lang string starting with ``root =``, or None.
    """
    if not text:
        return None

    lines = text.split("\n")
    openui_lines: list[str] = []

    for line in lines:
        stripped = line.strip()
        # Skip title lines and NONE responses
        if stripped.upper().startswith("TITLE:"):
            continue
        if stripped.upper() == "NONE":
            return None
        if stripped:
            openui_lines.append(line)

    openui_lang = "\n".join(openui_lines).strip()

    if not openui_lang or "root =" not in openui_lang:
        return None

    return openui_lang


def _generate_openui_via_llm(
    llm: Any, artifact_type: str, title: str, content: str
) -> str | None:
    """Call the LLM via streaming to generate OpenUI Lang from content.

    Uses llm.stream() instead of llm.invoke() to avoid proxy/gateway
    read timeouts on slow models (e.g. kimi-k25 with extended thinking).
    """
    prompt = _build_artifact_prompt(artifact_type, title, content)

    # Stream chunks and accumulate the full response text
    text_parts: list[str] = []
    for chunk in llm.stream(prompt):
        chunk_text = ""
        if hasattr(chunk, "content") and chunk.content:
            chunk_text = str(chunk.content)
        elif isinstance(chunk, str):
            chunk_text = chunk
        if chunk_text:
            text_parts.append(chunk_text)

    text = "".join(text_parts).strip()

    logger.info(
        "[ARTIFACT-LLM] Raw response (first 500 chars): %r",
        text[:500],
    )

    return _parse_openui_response(text)


# ---------------------------------------------------------------------------
# Tool factory
# ---------------------------------------------------------------------------


def create_artifact_tool(
    session_id: UUID,
    packet_queue: Queue[Any],
    step_number_fn: Callable[[], int] | None = None,
    db_session: Any | None = None,
    llm: Any | None = None,
) -> list[FunctionTool]:
    """Create the render_artifact FunctionTool.

    Returns a single-element list for consistency with other tool factories.
    """
    schema = REMOTE_TOOL_SCHEMAS[TOOL_NAME]

    tool = FunctionTool(
        name=TOOL_NAME,
        description=schema["description"],
        params_json_schema=schema["parameters"],
        on_invoke_tool=_make_invoke_handler(
            session_id=str(session_id),
            packet_queue=packet_queue,
            step_number_fn=step_number_fn,
            db_session=db_session,
            llm=llm,
        ),
    )
    return [tool]


def _make_invoke_handler(
    session_id: str,
    packet_queue: Queue[Any],
    step_number_fn: Callable[[], int] | None = None,
    db_session: Any | None = None,
    llm: Any | None = None,
) -> Any:
    """Create an async handler for the render_artifact tool."""

    async def handler(
        _ctx: RunContextWrapper[Any], json_string: str
    ) -> str:
        # Get step number (also closes any open message/reasoning section)
        tool_step = step_number_fn() if step_number_fn else 0
        tool_call_id = str(uuid.uuid4())

        def _emit(obj: Any) -> None:
            packet_queue.put(Packet(ind=tool_step, obj=obj))

        # Parse input
        try:
            args = json.loads(json_string) if isinstance(json_string, str) else json_string
        except (json.JSONDecodeError, TypeError):
            error_msg = "render_artifact: invalid JSON input"
            logger.warning(error_msg)
            return error_msg

        artifact_type: str = args.get("type", "")
        title: str = args.get("title", "Artifact")
        content: str = args.get("content", "")

        logger.info(
            "render_artifact invoked: type=%r, title=%r, content_len=%d",
            artifact_type,
            title,
            len(content),
        )

        # Emit tool start
        _emit(CustomToolStart(tool_name=TOOL_NAME))

        # Persist tool call to DB
        if db_session:
            try:
                add_tool_message(
                    db_session=db_session,
                    session_id=UUID(session_id),
                    tool_name=TOOL_NAME,
                    tool_input=args,
                    tool_call_id=tool_call_id,
                    step_number=tool_step,
                )
            except Exception:
                logger.warning(
                    "Failed to persist render_artifact tool call",
                    exc_info=True,
                )

        # Generate OpenUI Lang via LLM
        openui_lang: str | None = None
        if llm and content:
            try:
                openui_lang = _generate_openui_via_llm(
                    llm, artifact_type, title, content
                )
            except Exception:
                logger.warning(
                    "render_artifact: LLM generation failed",
                    exc_info=True,
                )

        if not openui_lang:
            error_msg = (
                f"render_artifact: could not generate artifact for "
                f"type={artifact_type!r}."
            )
            if not content:
                error_msg += " No content was provided."
            if not llm:
                error_msg += " LLM not available."
            _emit(
                CustomToolDelta(
                    tool_name=TOOL_NAME,
                    response_type="text",
                    data=error_msg,
                )
            )
            _emit(SectionEnd())
            return error_msg

        # Emit artifact result
        _emit(
            CustomToolDelta(
                tool_name=TOOL_NAME,
                response_type="text",
                data={"title": title, "type": artifact_type},
                openui_response=openui_lang,
            )
        )
        _emit(SectionEnd())

        # Persist result to DB
        if db_session:
            try:
                update_tool_message_result(
                    db_session=db_session,
                    session_id=UUID(session_id),
                    tool_call_id=tool_call_id,
                    tool_output={
                        "title": title,
                        "type": artifact_type,
                        "openui_lang": openui_lang,
                    },
                )
            except Exception:
                logger.warning(
                    "Failed to update render_artifact tool result",
                    exc_info=True,
                )

        return f"Artifact rendered: {title}"

    return handler
