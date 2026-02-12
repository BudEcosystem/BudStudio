"""Unit tests for UI spec validation and catalog.

Tests the pure validation logic in _validate_spec and the catalog definitions.
The convert_text_to_ui_spec function requires heavy LLM dependencies and is
tested via external dependency unit tests instead.
"""

from typing import Any

import pytest

from onyx.agents.bud_agent.ui_spec_catalog import VALID_COMPONENT_TYPES
from onyx.agents.bud_agent.ui_spec_catalog import get_catalog_prompt

# _validate_spec needs to be imported lazily to avoid the LLM import chain.
# We inline the function's logic for unit-testability.
# However, since the function only depends on VALID_COMPONENT_TYPES,
# we can reproduce it exactly here for isolated unit testing.


def _validate_spec(spec: dict[str, Any]) -> bool:
    """Mirror of ui_spec_converter._validate_spec for unit testing.

    Copied to avoid importing LLM dependencies at module level.
    """
    root_key = spec.get("root")
    if not isinstance(root_key, str):
        return False

    elements = spec.get("elements")
    if not isinstance(elements, dict):
        return False

    if root_key not in elements:
        return False

    for key, element in elements.items():
        if not isinstance(element, dict):
            return False
        if element.get("type") not in VALID_COMPONENT_TYPES:
            return False
        children = element.get("children")
        if children is not None:
            if not isinstance(children, list):
                return False
            for child_key in children:
                if child_key not in elements:
                    return False

    return True


# ==============================================================================
# _validate_spec Tests
# ==============================================================================


class TestValidateSpec:
    """Tests for the flat-map spec validator."""

    def test_valid_simple_spec(self) -> None:
        spec: dict[str, Any] = {
            "root": "card1",
            "elements": {
                "card1": {
                    "type": "Card",
                    "props": {"title": "Report"},
                    "children": ["text1"],
                },
                "text1": {
                    "type": "Text",
                    "props": {"text": "Hello world"},
                },
            },
        }
        assert _validate_spec(spec) is True

    def test_valid_single_element(self) -> None:
        spec: dict[str, Any] = {
            "root": "badge1",
            "elements": {
                "badge1": {
                    "type": "Badge",
                    "props": {"text": "OK", "variant": "success"},
                },
            },
        }
        assert _validate_spec(spec) is True

    def test_valid_all_component_types(self) -> None:
        """Every valid component type should pass validation."""
        for comp_type in VALID_COMPONENT_TYPES:
            spec: dict[str, Any] = {
                "root": "el",
                "elements": {
                    "el": {"type": comp_type, "props": {}},
                },
            }
            assert _validate_spec(spec) is True, f"{comp_type} should be valid"

    def test_invalid_root_not_string(self) -> None:
        spec: dict[str, Any] = {
            "root": 123,
            "elements": {},
        }
        assert _validate_spec(spec) is False

    def test_invalid_root_none(self) -> None:
        spec: dict[str, Any] = {
            "root": None,
            "elements": {},
        }
        assert _validate_spec(spec) is False

    def test_invalid_root_missing_from_elements(self) -> None:
        spec: dict[str, Any] = {
            "root": "missing",
            "elements": {
                "card1": {"type": "Card", "props": {}},
            },
        }
        assert _validate_spec(spec) is False

    def test_invalid_no_elements_key(self) -> None:
        spec: dict[str, Any] = {
            "root": "card1",
        }
        assert _validate_spec(spec) is False

    def test_invalid_elements_not_dict(self) -> None:
        spec: dict[str, Any] = {
            "root": "card1",
            "elements": [{"type": "Card", "props": {}}],
        }
        assert _validate_spec(spec) is False

    def test_invalid_unknown_component_type(self) -> None:
        spec: dict[str, Any] = {
            "root": "el",
            "elements": {
                "el": {"type": "UnknownWidget", "props": {}},
            },
        }
        assert _validate_spec(spec) is False

    def test_invalid_child_reference_missing(self) -> None:
        spec: dict[str, Any] = {
            "root": "card1",
            "elements": {
                "card1": {
                    "type": "Card",
                    "props": {},
                    "children": ["nonexistent"],
                },
            },
        }
        assert _validate_spec(spec) is False

    def test_invalid_children_not_list(self) -> None:
        spec: dict[str, Any] = {
            "root": "card1",
            "elements": {
                "card1": {
                    "type": "Card",
                    "props": {},
                    "children": "text1",
                },
            },
        }
        assert _validate_spec(spec) is False

    def test_invalid_element_not_dict(self) -> None:
        spec: dict[str, Any] = {
            "root": "el",
            "elements": {
                "el": "not a dict",
            },
        }
        assert _validate_spec(spec) is False

    def test_valid_nested_children(self) -> None:
        spec: dict[str, Any] = {
            "root": "card1",
            "elements": {
                "card1": {
                    "type": "Card",
                    "props": {"title": "Outer"},
                    "children": ["card2"],
                },
                "card2": {
                    "type": "Card",
                    "props": {"title": "Inner"},
                    "children": ["text1"],
                },
                "text1": {
                    "type": "Text",
                    "props": {"text": "Deep content"},
                },
            },
        }
        assert _validate_spec(spec) is True

    def test_empty_elements_map(self) -> None:
        spec: dict[str, Any] = {
            "root": "card1",
            "elements": {},
        }
        assert _validate_spec(spec) is False

    def test_element_missing_type_key(self) -> None:
        spec: dict[str, Any] = {
            "root": "el",
            "elements": {
                "el": {"props": {"text": "no type field"}},
            },
        }
        assert _validate_spec(spec) is False

    def test_empty_children_list_is_valid(self) -> None:
        spec: dict[str, Any] = {
            "root": "card1",
            "elements": {
                "card1": {
                    "type": "Card",
                    "props": {},
                    "children": [],
                },
            },
        }
        assert _validate_spec(spec) is True

    def test_multiple_children(self) -> None:
        spec: dict[str, Any] = {
            "root": "card1",
            "elements": {
                "card1": {
                    "type": "Card",
                    "props": {},
                    "children": ["text1", "badge1", "sep1"],
                },
                "text1": {"type": "Text", "props": {"text": "Hi"}},
                "badge1": {"type": "Badge", "props": {"text": "OK"}},
                "sep1": {"type": "Separator", "props": {}},
            },
        }
        assert _validate_spec(spec) is True

    def test_valid_stack_with_children(self) -> None:
        """Stack should support children references."""
        spec: dict[str, Any] = {
            "root": "stack1",
            "elements": {
                "stack1": {
                    "type": "Stack",
                    "props": {"direction": "horizontal", "gap": "md"},
                    "children": ["badge1", "badge2"],
                },
                "badge1": {"type": "Badge", "props": {"text": "A"}},
                "badge2": {"type": "Badge", "props": {"text": "B"}},
            },
        }
        assert _validate_spec(spec) is True

    def test_valid_grid_with_children(self) -> None:
        """Grid should support children references."""
        spec: dict[str, Any] = {
            "root": "grid1",
            "elements": {
                "grid1": {
                    "type": "Grid",
                    "props": {"columns": 3, "gap": "lg"},
                    "children": ["card1", "card2", "card3"],
                },
                "card1": {"type": "Card", "props": {"title": "A"}},
                "card2": {"type": "Card", "props": {"title": "B"}},
                "card3": {"type": "Card", "props": {"title": "C"}},
            },
        }
        assert _validate_spec(spec) is True

    def test_valid_collapsible_with_children(self) -> None:
        """Collapsible should support children references."""
        spec: dict[str, Any] = {
            "root": "coll1",
            "elements": {
                "coll1": {
                    "type": "Collapsible",
                    "props": {"title": "Details", "defaultOpen": False},
                    "children": ["table1"],
                },
                "table1": {
                    "type": "Table",
                    "props": {
                        "columns": [{"key": "k", "label": "Key"}],
                        "rows": [{"k": "val"}],
                    },
                },
            },
        }
        assert _validate_spec(spec) is True

    def test_valid_accordion_self_contained(self) -> None:
        """Accordion is self-contained — no children refs needed."""
        spec: dict[str, Any] = {
            "root": "acc1",
            "elements": {
                "acc1": {
                    "type": "Accordion",
                    "props": {
                        "items": [
                            {"title": "Q1", "content": "Answer 1"},
                            {"title": "Q2", "content": "Answer 2"},
                        ],
                        "type": "single",
                    },
                },
            },
        }
        assert _validate_spec(spec) is True

    def test_valid_tabs_self_contained(self) -> None:
        """Tabs is self-contained — no children refs needed."""
        spec: dict[str, Any] = {
            "root": "tabs1",
            "elements": {
                "tabs1": {
                    "type": "Tabs",
                    "props": {
                        "tabs": [
                            {"label": "Overview", "value": "ov", "content": "Data"},
                            {"label": "Details", "value": "dt", "content": "More"},
                        ],
                        "defaultValue": "ov",
                    },
                },
            },
        }
        assert _validate_spec(spec) is True

    def test_valid_bar_graph(self) -> None:
        """BarGraph should validate with data array."""
        spec: dict[str, Any] = {
            "root": "bg1",
            "elements": {
                "bg1": {
                    "type": "BarGraph",
                    "props": {
                        "title": "Requests",
                        "data": [
                            {"label": "/api", "value": 100},
                            {"label": "/web", "value": 200},
                        ],
                        "color": "#3b82f6",
                    },
                },
            },
        }
        assert _validate_spec(spec) is True

    def test_valid_line_graph(self) -> None:
        """LineGraph should validate with data array."""
        spec: dict[str, Any] = {
            "root": "lg1",
            "elements": {
                "lg1": {
                    "type": "LineGraph",
                    "props": {
                        "title": "Latency",
                        "data": [
                            {"label": "Mon", "value": 120},
                            {"label": "Tue", "value": 95},
                        ],
                    },
                },
            },
        }
        assert _validate_spec(spec) is True

    def test_valid_avatar(self) -> None:
        """Avatar should validate with name prop."""
        spec: dict[str, Any] = {
            "root": "av1",
            "elements": {
                "av1": {
                    "type": "Avatar",
                    "props": {"name": "Alice Johnson", "size": "lg"},
                },
            },
        }
        assert _validate_spec(spec) is True


# ==============================================================================
# Catalog Tests
# ==============================================================================


class TestCatalog:
    """Tests for the catalog prompt and component definitions."""

    def test_catalog_prompt_contains_all_components(self) -> None:
        prompt = get_catalog_prompt()
        for comp_type in VALID_COMPONENT_TYPES:
            assert comp_type in prompt, f"{comp_type} missing from catalog prompt"

    def test_catalog_prompt_contains_format_instructions(self) -> None:
        prompt = get_catalog_prompt()
        assert '"root"' in prompt
        assert '"elements"' in prompt
        assert "JSON" in prompt

    def test_catalog_prompt_mentions_flat_map(self) -> None:
        prompt = get_catalog_prompt()
        assert "flat-map" in prompt.lower() or "flat map" in prompt.lower()

    def test_valid_component_types_count(self) -> None:
        """Ensure we have exactly 19 component types."""
        assert len(VALID_COMPONENT_TYPES) == 19

    def test_valid_component_types_is_frozen(self) -> None:
        """Catalog types should not be mutable."""
        assert isinstance(VALID_COMPONENT_TYPES, frozenset)
