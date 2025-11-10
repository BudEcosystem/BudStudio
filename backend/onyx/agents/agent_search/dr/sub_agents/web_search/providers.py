from sqlalchemy.orm import Session

from onyx.agents.agent_search.dr.sub_agents.web_search.clients.exa_client import (
    ExaClient,
)
from onyx.agents.agent_search.dr.sub_agents.web_search.clients.serper_client import (
    SerperClient,
)
from onyx.agents.agent_search.dr.sub_agents.web_search.models import (
    WebSearchProvider,
)
from onyx.configs.chat_configs import EXA_API_KEY
from onyx.configs.chat_configs import SERPER_API_KEY
from onyx.db.enums import WebSearchProviderType
from onyx.db.web_search import get_default_web_search_provider


def get_default_provider(db_session: Session | None = None) -> WebSearchProvider | None:
    """Get the default web search provider.

    First checks the database for a configured default provider,
    then falls back to environment variables (Exa prioritized over Serper).

    Args:
        db_session: Optional database session. If provided, checks DB for configured providers.

    Returns:
        WebSearchProvider instance or None if no provider is configured
    """
    # Check database first if session is provided
    if db_session:
        try:
            db_provider = get_default_web_search_provider(db_session)
            if db_provider:
                # Return the appropriate client based on provider type
                if db_provider.provider_type == WebSearchProviderType.EXA:
                    return ExaClient(api_key=db_provider.api_key)
                elif db_provider.provider_type == WebSearchProviderType.SERPER:
                    return SerperClient(api_key=db_provider.api_key)
        except Exception:
            # If database check fails, fall through to env var fallback
            pass

    # Fall back to environment variables (for backwards compatibility)
    if EXA_API_KEY:
        return ExaClient()
    if SERPER_API_KEY:
        return SerperClient()
    return None
