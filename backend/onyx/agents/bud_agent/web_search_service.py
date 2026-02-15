"""Web search service for BudAgent — provides web_search and open_url tools.

Reuses the existing web search provider infrastructure (EXA / SERPER) and
emits the same SearchToolStart / SearchToolDelta / FetchToolStart packets
that the chat session uses, so the frontend renders them identically via
MultiToolRenderer.

Documents retrieved by these tools are accumulated in a shared
BudAgentSearchContext so the orchestrator can inject citation instructions
into subsequent LLM turns.
"""

import json
import uuid
from dataclasses import dataclass
from dataclasses import field
from queue import Queue
from typing import Any
from typing import Callable
from typing import Coroutine
from uuid import UUID

from sqlalchemy.orm import Session

from onyx.agents.agent_search.dr.sub_agents.web_search.models import (
    WebSearchProvider,
)
from onyx.agents.agent_search.dr.sub_agents.web_search.providers import (
    get_default_provider,
)
from onyx.agents.agent_search.dr.sub_agents.web_search.utils import (
    dummy_inference_section_from_internet_content,
)
from onyx.agents.agent_search.dr.sub_agents.web_search.utils import (
    dummy_inference_section_from_internet_search_result,
)
from onyx.agents.agent_search.dr.sub_agents.web_search.utils import (
    truncate_search_result_content,
)
from onyx.agents.agent_search.dr.utils import (
    convert_inference_sections_to_search_docs,
)
from onyx.context.search.models import InferenceSection
from onyx.context.search.models import SavedSearchDoc
from onyx.prompts.chat_prompts import REQUIRE_CITATION_STATEMENT
from onyx.server.query_and_chat.streaming_models import FetchToolStart
from onyx.server.query_and_chat.streaming_models import Packet
from onyx.server.query_and_chat.streaming_models import SearchToolDelta
from onyx.server.query_and_chat.streaming_models import SearchToolStart
from onyx.server.query_and_chat.streaming_models import SectionEnd
from onyx.utils.logger import setup_logger
from onyx.utils.threadpool_concurrency import run_functions_in_parallel

logger = setup_logger()


# ---------------------------------------------------------------------------
# Search context — accumulates cited documents across tool calls
# ---------------------------------------------------------------------------


@dataclass
class BudAgentSearchContext:
    """Tracks web search state across tool calls within a single agent run.

    The orchestrator creates one instance per ``run()`` and passes it to the
    web search tools.  After the tools execute, the orchestrator checks
    ``should_cite`` and, if True, injects citation instructions and document
    context into the next LLM turn.
    """

    cited_documents: list[InferenceSection] = field(default_factory=list)
    should_cite: bool = False
    # Maps document_id → 1-based citation number for the current turn
    document_id_map: dict[str, int] = field(default_factory=dict)

    def add_documents(self, sections: list[InferenceSection]) -> None:
        """Add retrieved documents and update the citation map."""
        for section in sections:
            doc_id = section.center_chunk.document_id
            if doc_id not in self.document_id_map:
                self.document_id_map[doc_id] = len(self.document_id_map) + 1
            self.cited_documents.append(section)
        if sections:
            self.should_cite = True

    def build_citation_context(self) -> str:
        """Build a numbered document context string for injection into the LLM prompt.

        Returns something like:
            Document [1]: (title) ...content...
            Document [2]: (title) ...content...
        """
        if not self.cited_documents:
            return ""

        seen: set[str] = set()
        lines: list[str] = []
        for section in self.cited_documents:
            doc_id = section.center_chunk.document_id
            if doc_id in seen:
                continue
            seen.add(doc_id)

            num = self.document_id_map.get(doc_id, "?")
            title = section.center_chunk.title or section.center_chunk.semantic_identifier
            link = section.center_chunk.source_links.get(0, "")
            content = section.combined_content or section.center_chunk.content
            # Truncate very long content
            if len(content) > 3000:
                content = content[:3000] + "..."

            lines.append(
                f"Document [{num}]: {title}\n"
                f"Link: {link}\n"
                f"{content}\n"
            )

        return "\n".join(lines)

    def build_citation_instruction(self) -> str:
        """Build the full citation injection: instruction + document context."""
        if not self.should_cite or not self.cited_documents:
            return ""

        doc_context = self.build_citation_context()
        return (
            f"\n\n--- Retrieved Documents ---\n"
            f"{doc_context}\n"
            f"--- End Retrieved Documents ---\n"
            f"{REQUIRE_CITATION_STATEMENT}\n"
        )


# ---------------------------------------------------------------------------
# FunctionTool factories
# ---------------------------------------------------------------------------


def create_web_search_tools(
    db_session: Session,
    packet_queue: Queue[Any],
    search_context: BudAgentSearchContext,
    step_number_fn: Callable[[], int],
    step_increment_fn: Callable[[], None] | None = None,
    session_id: UUID | None = None,
) -> list[Any]:
    """Create Agents SDK FunctionTool objects for web_search and open_url.

    Args:
        db_session: DB session for looking up the web search provider.
        packet_queue: Queue for emitting UI packets.
        search_context: Shared search context for document accumulation.
        step_number_fn: Callable that returns the current step number from
            the orchestrator (used for packet ``ind``).
        step_increment_fn: Callable that emits SectionEnd and increments the
            orchestrator's step number.  When provided, each tool call gets
            its own step in the MultiToolRenderer.
        session_id: Agent session ID for persisting tool messages to DB.

    Returns:
        List of ``FunctionTool`` instances. Empty if no search provider is
        configured.
    """
    from agents import FunctionTool
    from agents import RunContextWrapper

    from onyx.agents.bud_agent.tool_definitions import REMOTE_TOOL_SCHEMAS

    # Check if a web search provider is available
    provider = get_default_provider(db_session)
    if provider is None:
        logger.info("No web search provider configured — skipping web search tools")
        return []

    InvokeHandler = Callable[
        [RunContextWrapper[Any], str],
        Coroutine[Any, Any, str],
    ]

    tools: list[FunctionTool] = []

    def _emit(obj: Any) -> None:
        """Put a Packet on the queue using the current step number."""
        packet_queue.put(Packet(ind=step_number_fn(), obj=obj))

    def _close_step() -> None:
        """Emit SectionEnd and increment step number so the next tool gets
        its own visual step in the MultiToolRenderer."""
        _emit(SectionEnd())
        if step_increment_fn:
            step_increment_fn()

    # ── web_search ────────────────────────────────────────────────────────

    web_search_schema = REMOTE_TOOL_SCHEMAS["web_search"]

    async def _handle_web_search(
        _ctx: RunContextWrapper[Any], json_string: str
    ) -> str:
        try:
            args: dict[str, Any] = json.loads(json_string) if json_string else {}
            queries: list[str] = args.get("queries", [])
            if not queries:
                return "Error: queries list cannot be empty."

            tool_call_id = str(uuid.uuid4())
            tool_step = step_number_fn()

            # Emit search start
            _emit(
                SearchToolStart(
                    type="internal_search_tool_start",
                    is_internet_search=True,
                )
            )
            _emit(
                SearchToolDelta(
                    type="internal_search_tool_delta",
                    queries=queries,
                    documents=[],
                )
            )

            # Search all queries in parallel
            from onyx.utils.threadpool_concurrency import FunctionCall

            function_calls = [
                FunctionCall(func=provider.search, args=(q,)) for q in queries
            ]
            search_results_dict = run_functions_in_parallel(function_calls)

            # Aggregate hits from all queries
            all_hits = []
            for result_id in search_results_dict:
                hits = search_results_dict[result_id]
                if hits:
                    all_hits.extend(hits)

            if not all_hits:
                _close_step()
                return json.dumps({"results": []})

            # Convert to InferenceSections and accumulate
            inference_sections = [
                dummy_inference_section_from_internet_search_result(r)
                for r in all_hits
            ]
            search_context.add_documents(inference_sections)

            # Emit results to UI
            saved_docs = convert_inference_sections_to_search_docs(
                inference_sections, is_internet=True
            )
            _emit(
                SearchToolDelta(
                    type="internal_search_tool_delta",
                    queries=queries,
                    documents=saved_docs,
                )
            )

            # Build response for the LLM
            results = []
            for i, r in enumerate(all_hits):
                results.append({
                    "tag": str(i + 1),
                    "title": r.title,
                    "link": r.link,
                    "snippet": r.snippet or "",
                    "author": r.author,
                    "published_date": (
                        r.published_date.isoformat() if r.published_date else None
                    ),
                })

            # Persist tool message to DB
            if session_id is not None:
                try:
                    from onyx.db.agent import add_tool_message

                    # Build serializable search doc data for history
                    search_docs_data = [
                        {
                            "document_id": sd.document_id,
                            "semantic_identifier": sd.semantic_identifier,
                            "link": sd.link,
                            "blurb": sd.blurb,
                            "source_type": sd.source_type,
                            "is_internet": sd.is_internet,
                        }
                        for sd in saved_docs
                    ]
                    add_tool_message(
                        db_session=db_session,
                        session_id=session_id,
                        tool_name="web_search",
                        tool_input={"queries": queries},
                        tool_call_id=tool_call_id,
                        step_number=tool_step,
                        tool_output={
                            "results": results,
                            "search_docs": search_docs_data,
                        },
                    )
                except Exception:
                    logger.warning(
                        "Failed to persist web_search tool message",
                        exc_info=True,
                    )

            _close_step()
            return json.dumps({"results": results})

        except Exception as e:
            logger.exception("web_search tool failed")
            _close_step()
            return f"Error performing web search: {e}"

    tools.append(
        FunctionTool(
            name="web_search",
            description=web_search_schema["description"],
            params_json_schema=web_search_schema["parameters"],
            on_invoke_tool=_handle_web_search,
        )
    )

    # ── open_url ──────────────────────────────────────────────────────────

    open_url_schema = REMOTE_TOOL_SCHEMAS["open_url"]

    async def _handle_open_url(
        _ctx: RunContextWrapper[Any], json_string: str
    ) -> str:
        try:
            args: dict[str, Any] = json.loads(json_string) if json_string else {}
            urls: list[str] = args.get("urls", [])
            if not urls:
                return "Error: urls list cannot be empty."

            tool_call_id = str(uuid.uuid4())
            tool_step = step_number_fn()

            # Create SavedSearchDoc placeholders for UI
            saved_docs = [
                SavedSearchDoc(
                    document_id=f"INTERNET_SEARCH_DOC_{url}",
                    chunk_ind=0,
                    semantic_identifier=url,
                    link=url,
                    blurb=url,
                    source_type="web",
                    boost=1,
                    hidden=False,
                    metadata={},
                    score=0.0,
                    match_highlights=[],
                    is_internet=True,
                    db_doc_id=0,
                )
                for url in urls
            ]

            _emit(
                FetchToolStart(
                    type="fetch_tool_start",
                    documents=saved_docs,
                )
            )

            # Fetch content
            docs = provider.contents(urls)

            # Convert to InferenceSections and accumulate
            inference_sections = [
                dummy_inference_section_from_internet_content(d)
                for d in docs
            ]
            search_context.add_documents(inference_sections)

            # Build response for the LLM
            results = []
            for i, d in enumerate(docs):
                results.append({
                    "tag": str(i + 1),
                    "title": d.title,
                    "link": d.link,
                    "truncated_content": truncate_search_result_content(
                        d.full_content
                    ),
                    "published_date": (
                        d.published_date.isoformat() if d.published_date else None
                    ),
                })

            # Persist tool message to DB
            if session_id is not None:
                try:
                    from onyx.db.agent import add_tool_message

                    fetch_docs_data = [
                        {
                            "document_id": sd.document_id,
                            "semantic_identifier": sd.semantic_identifier,
                            "link": sd.link,
                            "is_internet": sd.is_internet,
                        }
                        for sd in saved_docs
                    ]
                    add_tool_message(
                        db_session=db_session,
                        session_id=session_id,
                        tool_name="open_url",
                        tool_input={"urls": urls},
                        tool_call_id=tool_call_id,
                        step_number=tool_step,
                        tool_output={
                            "results": results,
                            "fetch_docs": fetch_docs_data,
                        },
                    )
                except Exception:
                    logger.warning(
                        "Failed to persist open_url tool message",
                        exc_info=True,
                    )

            _close_step()
            return json.dumps({"results": results})

        except Exception as e:
            logger.exception("open_url tool failed")
            _close_step()
            return f"Error fetching URLs: {e}"

    tools.append(
        FunctionTool(
            name="open_url",
            description=open_url_schema["description"],
            params_json_schema=open_url_schema["parameters"],
            on_invoke_tool=_handle_open_url,
        )
    )

    return tools
