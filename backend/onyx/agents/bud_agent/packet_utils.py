"""Reconstruct Packet objects from persisted AgentMessage rows.

This module converts stored agent messages into the same Packet format used
during SSE streaming, so the frontend can use a single rendering path for
both live streaming and history playback.
"""

from typing import Any

from onyx.context.search.models import SavedSearchDoc
from onyx.db.enums import AgentMessageRole
from onyx.db.models import AgentMessage
from onyx.server.query_and_chat.streaming_models import CitationDelta
from onyx.server.query_and_chat.streaming_models import CitationInfo
from onyx.server.query_and_chat.streaming_models import CustomToolDelta
from onyx.server.query_and_chat.streaming_models import CustomToolStart
from onyx.server.query_and_chat.streaming_models import FetchToolStart
from onyx.server.query_and_chat.streaming_models import MessageDelta
from onyx.server.query_and_chat.streaming_models import MessageStart
from onyx.server.query_and_chat.streaming_models import OverallStop
from onyx.server.query_and_chat.streaming_models import Packet
from onyx.server.query_and_chat.streaming_models import ReasoningDelta
from onyx.server.query_and_chat.streaming_models import ReasoningStart
from onyx.server.query_and_chat.streaming_models import SearchToolDelta
from onyx.server.query_and_chat.streaming_models import SearchToolStart
from onyx.server.query_and_chat.streaming_models import SectionEnd


def translate_agent_messages_to_packets(
    messages: list[AgentMessage],
) -> list[list[Packet]]:
    """Convert a list of AgentMessage rows into packet turns.

    Returns a list of turns, where each turn is a list of Packets.
    A turn is delimited by user messages: every user message starts a
    new turn that includes the subsequent assistant and tool messages.
    """
    # Group messages into turns (user -> assistant/tool messages until next user)
    turns: list[list[AgentMessage]] = []
    current_turn: list[AgentMessage] = []

    for msg in messages:
        if msg.role == AgentMessageRole.USER:
            if current_turn:
                turns.append(current_turn)
            current_turn = [msg]
        else:
            current_turn.append(msg)

    if current_turn:
        turns.append(current_turn)

    result: list[list[Packet]] = []
    for turn_messages in turns:
        packets = _turn_to_packets(turn_messages)
        if packets:
            result.append(packets)

    return result


def _saved_search_doc_from_dict(data: dict[str, Any]) -> SavedSearchDoc:
    """Build a SavedSearchDoc from serialized dictionary data stored in tool_output."""
    return SavedSearchDoc(
        document_id=data.get("document_id", ""),
        chunk_ind=data.get("chunk_ind", 0),
        semantic_identifier=data.get("semantic_identifier", ""),
        link=data.get("link"),
        blurb=data.get("blurb", ""),
        source_type=data.get("source_type", "web"),
        boost=data.get("boost", 1),
        hidden=data.get("hidden", False),
        metadata=data.get("metadata", {}),
        score=data.get("score", 0.0),
        match_highlights=data.get("match_highlights", []),
        is_internet=data.get("is_internet", True),
        db_doc_id=data.get("db_doc_id", 0),
    )


def _emit_web_search_packets(
    msg: AgentMessage, step: int
) -> list[Packet]:
    """Reconstruct SearchToolStart + SearchToolDelta packets from a web_search tool message."""
    packets: list[Packet] = []
    tool_input = msg.tool_input or {}
    tool_output = msg.tool_output or {}
    queries: list[str] = tool_input.get("queries", [])

    # SearchToolStart
    packets.append(
        Packet(
            ind=step,
            obj=SearchToolStart(
                type="internal_search_tool_start",
                is_internet_search=True,
            ),
        )
    )

    # SearchToolDelta with queries (no documents yet)
    packets.append(
        Packet(
            ind=step,
            obj=SearchToolDelta(
                type="internal_search_tool_delta",
                queries=queries,
                documents=[],
            ),
        )
    )

    # SearchToolDelta with results
    search_docs_data: list[dict[str, Any]] = tool_output.get("search_docs", [])
    if search_docs_data:
        saved_docs = [_saved_search_doc_from_dict(d) for d in search_docs_data]
        packets.append(
            Packet(
                ind=step,
                obj=SearchToolDelta(
                    type="internal_search_tool_delta",
                    queries=queries,
                    documents=saved_docs,
                ),
            )
        )

    packets.append(Packet(ind=step, obj=SectionEnd()))
    return packets


def _emit_open_url_packets(
    msg: AgentMessage, step: int
) -> list[Packet]:
    """Reconstruct FetchToolStart packets from an open_url tool message."""
    packets: list[Packet] = []
    tool_output = msg.tool_output or {}

    # Build SavedSearchDocs from stored fetch_docs data
    fetch_docs_data: list[dict[str, Any]] = tool_output.get("fetch_docs", [])
    if fetch_docs_data:
        saved_docs = [_saved_search_doc_from_dict(d) for d in fetch_docs_data]
    else:
        # Fallback: reconstruct from urls in tool_input
        tool_input = msg.tool_input or {}
        urls: list[str] = tool_input.get("urls", [])
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

    packets.append(
        Packet(
            ind=step,
            obj=FetchToolStart(
                type="fetch_tool_start",
                documents=saved_docs,
            ),
        )
    )

    packets.append(Packet(ind=step, obj=SectionEnd()))
    return packets


def _emit_citation_packets(
    ui_spec: dict[str, Any], step: int
) -> list[Packet]:
    """Reconstruct CitationDelta packets from stored citation metadata in ui_spec."""
    packets: list[Packet] = []
    citations_data: list[dict[str, Any]] = ui_spec.get("citations", [])

    if citations_data:
        citation_infos = [
            CitationInfo(
                citation_num=c["citation_num"],
                document_id=c["document_id"],
            )
            for c in citations_data
            if "citation_num" in c and "document_id" in c
        ]
        if citation_infos:
            packets.append(
                Packet(
                    ind=step,
                    obj=CitationDelta(citations=citation_infos),
                )
            )

    return packets


def _emit_tool_packets(
    msg: AgentMessage, step: int
) -> list[Packet]:
    """Emit packets for a single tool message at the given step index."""
    tool_name = msg.tool_name or "unknown"

    if tool_name == "web_search":
        return _emit_web_search_packets(msg, step)
    elif tool_name == "open_url":
        return _emit_open_url_packets(msg, step)

    # Generic tool rendering
    packets: list[Packet] = []
    packets.append(
        Packet(ind=step, obj=CustomToolStart(tool_name=tool_name))
    )

    if msg.tool_output is not None:
        data = msg.tool_output
        if isinstance(data, dict) and "output" in data and len(data) == 1:
            data = data["output"]

        packets.append(
            Packet(
                ind=step,
                obj=CustomToolDelta(
                    tool_name=tool_name,
                    response_type="json"
                    if isinstance(data, (dict, list))
                    else "text",
                    data=data,
                ),
            )
        )
    elif msg.tool_error:
        packets.append(
            Packet(
                ind=step,
                obj=CustomToolDelta(
                    tool_name=tool_name,
                    response_type="error",
                    data=msg.tool_error,
                ),
            )
        )

    packets.append(Packet(ind=step, obj=SectionEnd()))
    return packets


def _emit_reasoning_packets(text: str, step: int) -> list[Packet]:
    """Emit ReasoningStart / ReasoningDelta / SectionEnd for an intermediate text."""
    return [
        Packet(ind=step, obj=ReasoningStart()),
        Packet(ind=step, obj=ReasoningDelta(reasoning=text)),
        Packet(ind=step, obj=SectionEnd()),
    ]


def _turn_to_packets(turn_messages: list[AgentMessage]) -> list[Packet]:
    """Convert a single turn's messages into a list of Packets."""
    packets: list[Packet] = []
    step_counter = 0

    # Sort by step_number if available, otherwise by created_at
    non_user = [m for m in turn_messages if m.role != AgentMessageRole.USER]
    non_user.sort(
        key=lambda m: (
            m.step_number if m.step_number is not None else 999999,
            m.created_at,
        )
    )

    # Find the assistant message and check for intermediate texts
    assistant_msg: AgentMessage | None = None
    intermediate_texts: list[str] = []
    for msg in non_user:
        if msg.role == AgentMessageRole.ASSISTANT:
            assistant_msg = msg
            if msg.ui_spec and "intermediate_texts" in msg.ui_spec:
                intermediate_texts = msg.ui_spec["intermediate_texts"]
            break

    tool_msgs = [m for m in non_user if m.role == AgentMessageRole.TOOL]

    if intermediate_texts and tool_msgs:
        # ── Interleaved path: reasoning → tool → … → final message ──
        # Emit thinking_content (extended thinking from o1/o3) first
        if assistant_msg and assistant_msg.thinking_content:
            packets.extend(
                _emit_reasoning_packets(
                    assistant_msg.thinking_content, step_counter
                )
            )
            step_counter += 1

        # Interleave intermediate texts with tool messages
        for i, tool_msg in enumerate(tool_msgs):
            # Emit the intermediate reasoning text before this tool
            if i < len(intermediate_texts) and intermediate_texts[i]:
                packets.extend(
                    _emit_reasoning_packets(
                        intermediate_texts[i], step_counter
                    )
                )
                step_counter += 1

            packets.extend(_emit_tool_packets(tool_msg, step_counter))
            step_counter += 1

        # Emit any remaining intermediate texts beyond the tool count
        for text in intermediate_texts[len(tool_msgs):]:
            if text:
                packets.extend(
                    _emit_reasoning_packets(text, step_counter)
                )
                step_counter += 1

        # Emit the final answer as a message
        if assistant_msg and assistant_msg.content:
            packets.append(
                Packet(
                    ind=step_counter,
                    obj=MessageStart(
                        content=assistant_msg.content,
                        final_documents=None,
                    ),
                )
            )
            packets.append(
                Packet(
                    ind=step_counter,
                    obj=MessageDelta(content=assistant_msg.content),
                )
            )
            if assistant_msg.ui_spec and "citations" in assistant_msg.ui_spec:
                packets.extend(
                    _emit_citation_packets(
                        assistant_msg.ui_spec, step_counter
                    )
                )
            packets.append(Packet(ind=step_counter, obj=SectionEnd()))
            step_counter += 1
    else:
        # ── Original path: no intermediate texts ──
        for msg in non_user:
            if msg.role == AgentMessageRole.ASSISTANT:
                # Emit reasoning packets for thinking_content
                if msg.thinking_content:
                    step = (
                        msg.step_number
                        if msg.step_number is not None
                        else step_counter
                    )
                    packets.extend(
                        _emit_reasoning_packets(
                            msg.thinking_content, step
                        )
                    )
                    step_counter = step + 1

                # Emit message packets for content
                if msg.content:
                    step = (
                        msg.step_number
                        if msg.step_number is not None
                        else step_counter
                    )
                    packets.append(
                        Packet(
                            ind=step,
                            obj=MessageStart(
                                content=msg.content,
                                final_documents=None,
                            ),
                        )
                    )
                    packets.append(
                        Packet(
                            ind=step,
                            obj=MessageDelta(content=msg.content),
                        )
                    )

                    # Emit citation packets if ui_spec has citation data
                    if msg.ui_spec and "citations" in msg.ui_spec:
                        packets.extend(
                            _emit_citation_packets(msg.ui_spec, step)
                        )

                    packets.append(
                        Packet(ind=step, obj=SectionEnd())
                    )
                    step_counter = step + 1

            elif msg.role == AgentMessageRole.TOOL:
                step = (
                    msg.step_number
                    if msg.step_number is not None
                    else step_counter
                )
                packets.extend(_emit_tool_packets(msg, step))
                step_counter = step + 1

    # Add OverallStop at the end
    if packets:
        packets.append(Packet(ind=step_counter, obj=OverallStop()))

    return packets
