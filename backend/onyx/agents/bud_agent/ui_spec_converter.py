"""Convert agent response text into a json-render UI spec via LLM."""

import json
from typing import Any

from onyx.agents.bud_agent.ui_spec_catalog import VALID_COMPONENT_TYPES
from onyx.agents.bud_agent.ui_spec_catalog import get_catalog_prompt
from onyx.llm.interfaces import LLM
from onyx.utils.logger import setup_logger

logger = setup_logger()


def _validate_spec(spec: dict[str, Any]) -> bool:
    """Validate a json-render flat-map spec.

    Expected format:
    {
      "root": "<elementKey>",
      "elements": {
        "<elementKey>": { "type": "...", "props": {...}, "children"?: [...] },
        ...
      }
    }
    """
    root_key = spec.get("root")
    if not isinstance(root_key, str):
        return False

    elements = spec.get("elements")
    if not isinstance(elements, dict):
        return False

    if root_key not in elements:
        return False

    # Validate each element has a valid type
    for key, element in elements.items():
        if not isinstance(element, dict):
            return False
        if element.get("type") not in VALID_COMPONENT_TYPES:
            return False
        # Validate children references exist
        children = element.get("children")
        if children is not None:
            if not isinstance(children, list):
                return False
            for child_key in children:
                if child_key not in elements:
                    return False

    return True


def convert_text_to_ui_spec(
    response_text: str,
    llm: LLM,
) -> dict[str, Any] | None:
    """Convert response text to a json-render UI spec using an LLM.

    Returns None on any failure (parsing error, invalid spec, LLM returns null).
    """
    catalog_prompt = get_catalog_prompt()
    prompt = (
        f"{catalog_prompt}\n\n"
        f"CONTENT TO CONVERT:\n\n{response_text}\n\n"
        f"JSON UI SPEC:"
    )

    response = llm.invoke(prompt)
    raw = str(response.content).strip()

    # Strip markdown fences if present
    if raw.startswith("```"):
        lines = raw.split("\n")
        # Remove first and last lines (fences)
        lines = lines[1:]
        if lines and lines[-1].strip() == "```":
            lines = lines[:-1]
        raw = "\n".join(lines).strip()

    # Handle explicit null response
    if raw.lower() in ("null", "none", ""):
        return None

    try:
        spec = json.loads(raw)
    except json.JSONDecodeError:
        logger.warning("UI spec conversion returned invalid JSON")
        return None

    if spec is None:
        return None

    if not isinstance(spec, dict):
        logger.warning("UI spec conversion returned non-dict: %s", type(spec))
        return None

    if not _validate_spec(spec):
        logger.warning("UI spec validation failed")
        return None

    return spec
