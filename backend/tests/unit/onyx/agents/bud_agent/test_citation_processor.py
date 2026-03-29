"""Unit tests for CitationProcessor.

Uses lightweight dataclass stubs instead of the real Pydantic models so
that no external dependencies (DB, Vespa, etc.) are needed.
"""

from __future__ import annotations

from dataclasses import dataclass
from dataclasses import field
from typing import Any

from onyx.agents.bud_agent.citation_processor import CitationProcessor
from onyx.server.query_and_chat.streaming_models import CitationInfo


# ---------------------------------------------------------------------------
# Lightweight stubs
# ---------------------------------------------------------------------------


@dataclass
class _FakeChunk:
    document_id: str = "doc-1"
    source_links: dict[int, str] | None = None
    title: str | None = "Test Title"
    semantic_identifier: str = "test-doc"


@dataclass
class _FakeSection:
    center_chunk: _FakeChunk = field(default_factory=_FakeChunk)
    combined_content: str = "some content"


@dataclass
class _FakeSearchContext:
    """Minimal stand-in for ``BudAgentSearchContext``."""

    cited_documents: list[Any] = field(default_factory=list)
    should_cite: bool = False
    document_id_map: dict[str, int] = field(default_factory=dict)


def _make_context(
    docs: list[tuple[str, str, str | None]] | None = None,
) -> _FakeSearchContext:
    """Helper to build a fake search context.

    Each tuple is ``(document_id, link, title)``.
    """
    if docs is None:
        return _FakeSearchContext()

    ctx = _FakeSearchContext(should_cite=True)
    for i, (doc_id, link, title) in enumerate(docs):
        chunk = _FakeChunk(
            document_id=doc_id,
            source_links={0: link},
            title=title,
            semantic_identifier=title or "untitled",
        )
        section = _FakeSection(center_chunk=chunk)
        ctx.cited_documents.append(section)
        ctx.document_id_map[doc_id] = i + 1  # 1-based
    return ctx


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


class TestSingleCitationConversion:
    """``[1]`` should become ``[[1]](link)``."""

    def test_simple_bracket(self) -> None:
        ctx = _make_context([("d1", "https://example.com", "Example")])
        cp = CitationProcessor(ctx)  # type: ignore[arg-type]

        text, citations = cp.process_token("See [1] for details.")
        assert text == "See [[1]](https://example.com) for details."
        assert len(citations) == 1
        assert citations[0].citation_num == 1
        assert citations[0].document_id == "d1"


class TestDoubleBracketPassthrough:
    """``[[1]]`` should also resolve to ``[[1]](link)``."""

    def test_double_bracket(self) -> None:
        ctx = _make_context([("d1", "https://a.com", "A")])
        cp = CitationProcessor(ctx)  # type: ignore[arg-type]

        text, citations = cp.process_token("Check [[1]] now.")
        assert text == "Check [[1]](https://a.com) now."
        assert len(citations) == 1


class TestMultiCitationExpansion:
    """``[1, 2, 3]`` should expand into three separate linked citations."""

    def test_multi(self) -> None:
        ctx = _make_context([
            ("d1", "https://a.com", "A"),
            ("d2", "https://b.com", "B"),
            ("d3", "https://c.com", "C"),
        ])
        cp = CitationProcessor(ctx)  # type: ignore[arg-type]

        text, citations = cp.process_token("Sources: [1, 2, 3].")
        assert "[[1]](https://a.com)" in text
        assert "[[2]](https://b.com)" in text
        assert "[[3]](https://c.com)" in text
        assert len(citations) == 3


class TestPartialBuffering:
    """A lone ``[`` should be held; completing it with ``1]`` should resolve."""

    def test_partial_then_complete(self) -> None:
        ctx = _make_context([("d1", "https://x.com", "X")])
        cp = CitationProcessor(ctx)  # type: ignore[arg-type]

        # First token ends with a lone bracket — should buffer.
        text1, cit1 = cp.process_token("ref [")
        assert text1 == ""
        assert cit1 == []

        # Second token completes the citation.
        text2, cit2 = cp.process_token("1] ok")
        assert "[[1]](https://x.com)" in text2
        assert "ok" in text2
        assert len(cit2) == 1


class TestFlush:
    """``flush()`` should drain whatever is left in the internal buffer."""

    def test_flush_drains(self) -> None:
        ctx = _make_context([("d1", "https://x.com", "X")])
        cp = CitationProcessor(ctx)  # type: ignore[arg-type]

        # Feed a partial that will be buffered.
        text, _ = cp.process_token("trailing [")
        assert text == ""

        # Flush returns the buffered content as-is.
        remainder, cit = cp.flush()
        assert remainder == "trailing ["
        assert cit == []


class TestBuildUiSpec:
    """``build_ui_spec()`` should return correct metadata when docs exist."""

    def test_returns_spec(self) -> None:
        ctx = _make_context([
            ("d1", "https://a.com", "Doc A"),
            ("d2", "https://b.com", "Doc B"),
        ])
        cp = CitationProcessor(ctx)  # type: ignore[arg-type]

        spec = cp.build_ui_spec()
        assert spec is not None
        assert len(spec["citations"]) == 2
        assert spec["citations"][0]["citation_num"] == 1
        assert spec["citations"][0]["document_id"] == "d1"
        assert spec["citations"][0]["link"] == "https://a.com"
        assert spec["citations"][0]["title"] == "Doc A"

        assert len(spec["search_docs"]) == 2
        assert spec["search_docs"][1]["document_id"] == "d2"
        assert spec["search_docs"][1]["is_internet"] is True

    def test_returns_none_when_empty(self) -> None:
        ctx = _make_context()
        cp = CitationProcessor(ctx)  # type: ignore[arg-type]

        assert cp.build_ui_spec() is None


class TestInactiveProcessor:
    """When search context has no docs, ``active`` is False and text passes through."""

    def test_inactive_passthrough(self) -> None:
        ctx = _make_context()  # empty — should_cite=False
        cp = CitationProcessor(ctx)  # type: ignore[arg-type]

        assert cp.active is False

        text, citations = cp.process_token("Hello [1] world.")
        # No search context, so [1] is not a known citation, but the pattern
        # still matches syntactically.  The processor resolves it with an
        # empty link and no CitationInfo because doc_id lookup returns None.
        assert "[[1]](" in text
        assert citations == []


class TestUnknownCitationNumber:
    """A citation number not in the document map should produce an empty link."""

    def test_unknown_num(self) -> None:
        ctx = _make_context([("d1", "https://a.com", "A")])
        cp = CitationProcessor(ctx)  # type: ignore[arg-type]

        text, citations = cp.process_token("See [99].")
        assert "[[99]]()" in text
        assert citations == []


class TestDeduplication:
    """The same document should only emit ``CitationInfo`` once."""

    def test_dedup(self) -> None:
        ctx = _make_context([("d1", "https://a.com", "A")])
        cp = CitationProcessor(ctx)  # type: ignore[arg-type]

        _, cit1 = cp.process_token("[1]")
        assert len(cit1) == 1

        _, cit2 = cp.process_token("[1]")
        assert len(cit2) == 0  # already emitted


class TestBuildUiSpecDeduplicates:
    """Duplicate document sections should be deduplicated in citations list."""

    def test_dedup_in_spec(self) -> None:
        ctx = _make_context([("d1", "https://a.com", "A")])
        # Manually add the same doc again to cited_documents
        ctx.cited_documents.append(ctx.cited_documents[0])

        cp = CitationProcessor(ctx)  # type: ignore[arg-type]
        spec = cp.build_ui_spec()
        assert spec is not None
        # citations should be deduplicated
        assert len(spec["citations"]) == 1
        # search_docs is NOT deduplicated (reflects all sections)
        assert len(spec["search_docs"]) == 2


class TestTitleFallback:
    """When title is None, semantic_identifier should be used."""

    def test_fallback_to_semantic_identifier(self) -> None:
        ctx = _make_context([("d1", "https://a.com", None)])
        # The _make_context helper sets semantic_identifier = title or "untitled"
        # so for None title, semantic_identifier = "untitled"
        cp = CitationProcessor(ctx)  # type: ignore[arg-type]

        spec = cp.build_ui_spec()
        assert spec is not None
        assert spec["citations"][0]["title"] == "untitled"
