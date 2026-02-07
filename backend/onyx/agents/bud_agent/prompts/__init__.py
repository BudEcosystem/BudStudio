"""Template loader for BudAgent prompt files.

Loads `.md` template files from this package directory and optionally
substitutes `$variable` placeholders using `string.Template.safe_substitute`.
"""

import functools
from importlib import resources
from string import Template


@functools.lru_cache(maxsize=64)
def load_prompt(name: str) -> str:
    """Load a `.md` prompt template by name (without extension).

    Files are read once and cached for the lifetime of the process.

    Raises:
        FileNotFoundError: If the template file does not exist.
    """
    package = resources.files(__package__)
    path = package.joinpath(f"{name}.md")
    return path.read_text(encoding="utf-8")


def render_prompt(name: str, **kwargs: str) -> str:
    """Load a template and substitute `$variable` placeholders.

    Uses `safe_substitute` so that stray `$` signs in markdown are
    left untouched rather than raising an error.
    """
    raw = load_prompt(name)
    return Template(raw).safe_substitute(**kwargs)
