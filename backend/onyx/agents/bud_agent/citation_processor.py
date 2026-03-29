"""Stateful citation buffer for stream processing.

Extracts duplicated citation logic from orchestrator.py and agent_handler.py
into a single reusable processor.  During an LLM streaming turn the
orchestrator feeds each token through ``process_token()``; the processor
buffers text that *might* contain a citation reference, resolves complete
references against the search context, and returns markdown-linked citations
together with new ``CitationInfo`` packets for the frontend.
"""

from __future__ import annotations

import re
from typing import Any
from typing import TYPE_CHECKING

from onyx.server.query_and_chat.streaming_models import CitationInfo
from onyx.utils.logger import setup_logger

if TYPE_CHECKING:
    from onyx.agents.bud_agent.web_search_service import BudAgentSearchContext

logger = setup_logger()


class CitationProcessor:
    """Converts raw ``[N]`` / ``[[N]]`` / ``[1, 2, 3]`` citation references
    in an LLM token stream into markdown links and emits ``CitationInfo``
    packets for each newly-seen document.

    Usage::

        cp = CitationProcessor(search_context)
        for token in llm_stream:
            text, new_citations = cp.process_token(token)
            ...
        remaining, _ = cp.flush()
    """

    def __init__(self, search_context: BudAgentSearchContext) -> None:
        self._search_context = search_context
        self._buffer: str = ""
        self._emitted_doc_ids: set[str] = set()

        # Matches complete citations: [[1]] or [1] or [1, 2, 3]
        self._citation_pattern: re.Pattern[str] = re.compile(
            r"(\[\[\d+\]\])|(\[\d+(?:, ?\d+)*\])"
        )
        # Matches a *partial* citation at the end of the buffer — signals
        # that more tokens are needed before we can decide.
        self._possible_citation_pattern: re.Pattern[str] = re.compile(
            r"(\[+(?:\d+,? ?)*$)"
        )

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    @property
    def active(self) -> bool:
        """Whether citation processing is active (search context has docs)."""
        return self._search_context.should_cite

    def process_token(self, token: str) -> tuple[str, list[CitationInfo]]:
        """Feed one token and get back resolved text + any new citations.

        Text that *might* be the start of a citation is held in an internal
        buffer and only released once we can determine it is (or is not) a
        valid reference.
        """
        self._buffer += token

        possible = bool(re.search(self._possible_citation_pattern, self._buffer))
        matches = list(self._citation_pattern.finditer(self._buffer))

        # Buffer looks like it might become a citation — hold everything.
        if not matches and possible:
            return "", []

        # No citations at all — flush the entire buffer.
        if not matches:
            result = self._buffer
            self._buffer = ""
            return result, []

        # We have complete citation matches — resolve them.
        result = ""
        new_citations: list[CitationInfo] = []
        last_end = 0

        for match in matches:
            # Emit any text before this match verbatim.
            result += self._buffer[last_end : match.start()]
            last_end = match.end()

            citation_str = match.group()
            is_formatted = match.lastindex == 1  # [[N]] form

            # Strip outer brackets to get the number(s).
            content = citation_str[2:-2] if is_formatted else citation_str[1:-1]

            for num_str in content.split(","):
                num = int(num_str.strip())
                link = self._get_citation_link(num)
                doc_id = self._get_citation_doc_id(num)

                result += f"[[{num}]]({link})"

                if doc_id and doc_id not in self._emitted_doc_ids:
                    self._emitted_doc_ids.add(doc_id)
                    new_citations.append(
                        CitationInfo(citation_num=num, document_id=doc_id)
                    )

        remainder = self._buffer[last_end:]

        # If the remainder looks like the start of another citation, keep
        # it in the buffer for the next token.
        if possible and remainder:
            self._buffer = remainder
        else:
            result += remainder
            self._buffer = ""

        return result, new_citations

    def flush(self) -> tuple[str, list[CitationInfo]]:
        """Drain whatever is left in the buffer (end of stream)."""
        result = self._buffer
        self._buffer = ""
        return result, []

    def build_ui_spec(self) -> dict[str, Any] | None:
        """Build a UI-friendly metadata dict from the search context.

        Returns ``None`` when there is nothing to cite.
        """
        if (
            not self._search_context.should_cite
            or not self._search_context.cited_documents
        ):
            return None

        citations_data: list[dict[str, Any]] = []
        seen_doc_ids: set[str] = set()

        for section in self._search_context.cited_documents:
            doc_id = section.center_chunk.document_id
            if doc_id in seen_doc_ids:
                continue
            seen_doc_ids.add(doc_id)

            num = self._search_context.document_id_map.get(doc_id)
            link = (section.center_chunk.source_links or {}).get(0, "")
            title = (
                section.center_chunk.title
                or section.center_chunk.semantic_identifier
            )
            citations_data.append(
                {
                    "citation_num": num,
                    "document_id": doc_id,
                    "link": link,
                    "title": title,
                }
            )

        search_docs_data: list[dict[str, Any]] = []
        for section in self._search_context.cited_documents:
            doc_id = section.center_chunk.document_id
            link = (section.center_chunk.source_links or {}).get(0, "")
            title = (
                section.center_chunk.title
                or section.center_chunk.semantic_identifier
            )
            search_docs_data.append(
                {
                    "document_id": doc_id,
                    "semantic_identifier": title,
                    "link": link,
                    "source_type": "web",
                    "is_internet": True,
                }
            )

        return {"citations": citations_data, "search_docs": search_docs_data}

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _get_citation_link(self, citation_num: int) -> str:
        """Look up the source link for a 1-based citation number."""
        for section in self._search_context.cited_documents:
            doc_id = section.center_chunk.document_id
            num = self._search_context.document_id_map.get(doc_id)
            if num == citation_num:
                return (section.center_chunk.source_links or {}).get(0, "")
        return ""

    def _get_citation_doc_id(self, citation_num: int) -> str | None:
        """Reverse-lookup: citation number → document_id."""
        for doc_id, num in self._search_context.document_id_map.items():
            if num == citation_num:
                return doc_id
        return None
