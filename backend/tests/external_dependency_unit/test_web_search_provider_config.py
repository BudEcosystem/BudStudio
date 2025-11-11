"""
Test web search provider configuration and fallback mechanisms.

This test suite validates that web search providers can be configured via:
1. Database configuration (primary method)
2. Environment variables (fallback for backwards compatibility)
"""

import os
from typing import Generator
from unittest.mock import patch

import pytest
from sqlalchemy.orm import Session

from onyx.agents.agent_search.dr.sub_agents.web_search.clients.exa_client import (
    ExaClient,
)
from onyx.agents.agent_search.dr.sub_agents.web_search.clients.serper_client import (
    SerperClient,
)
from onyx.agents.agent_search.dr.sub_agents.web_search.providers import (
    get_default_provider,
)
from onyx.db.enums import WebSearchProviderType
from onyx.db.web_search import upsert_web_search_provider


@pytest.fixture
def clean_env() -> Generator[None, None, None]:
    """Temporarily clear web search environment variables"""
    original_exa = os.environ.get("EXA_API_KEY")
    original_serper = os.environ.get("SERPER_API_KEY")

    # Clear env vars for the test
    if "EXA_API_KEY" in os.environ:
        del os.environ["EXA_API_KEY"]
    if "SERPER_API_KEY" in os.environ:
        del os.environ["SERPER_API_KEY"]

    yield

    # Restore original env vars
    if original_exa:
        os.environ["EXA_API_KEY"] = original_exa
    if original_serper:
        os.environ["SERPER_API_KEY"] = original_serper


def test_get_provider_from_database_exa(
    db_session: Session, tenant_context: None, clean_env: None
) -> None:
    """Test getting Exa provider from database configuration"""
    # Create a provider in the database
    test_api_key = "test-exa-api-key-123"
    upsert_web_search_provider(
        db_session=db_session,
        provider_type=WebSearchProviderType.EXA,
        api_key=test_api_key,
        is_default=True,
    )

    # Get the provider
    provider = get_default_provider(db_session)

    # Verify we got an ExaClient with the correct API key
    assert provider is not None
    assert isinstance(provider, ExaClient)
    assert provider.api_key == test_api_key


def test_get_provider_from_database_serper(
    db_session: Session, tenant_context: None, clean_env: None
) -> None:
    """Test getting Serper provider from database configuration"""
    # Create a provider in the database
    test_api_key = "test-serper-api-key-456"
    upsert_web_search_provider(
        db_session=db_session,
        provider_type=WebSearchProviderType.SERPER,
        api_key=test_api_key,
        is_default=True,
    )

    # Get the provider
    provider = get_default_provider(db_session)

    # Verify we got a SerperClient with the correct API key
    assert provider is not None
    assert isinstance(provider, SerperClient)
    assert provider.api_key == test_api_key


def test_fallback_to_env_var_exa(
    db_session: Session, tenant_context: None, clean_env: None
) -> None:
    """Test falling back to EXA_API_KEY environment variable when no DB config"""
    test_api_key = "test-exa-env-key-789"

    # Set environment variable
    with patch("onyx.agents.agent_search.dr.sub_agents.web_search.providers.EXA_API_KEY", test_api_key):
        # Get provider without database configuration
        provider = get_default_provider(db_session)

        # Verify we got an ExaClient (from env var)
        assert provider is not None
        assert isinstance(provider, ExaClient)


def test_fallback_to_env_var_serper(
    db_session: Session, tenant_context: None, clean_env: None
) -> None:
    """Test falling back to SERPER_API_KEY environment variable when no DB config"""
    test_api_key = "test-serper-env-key-012"

    # Set environment variable
    with patch("onyx.agents.agent_search.dr.sub_agents.web_search.providers.SERPER_API_KEY", test_api_key):
        # Get provider without database configuration
        provider = get_default_provider(db_session)

        # Verify we got a SerperClient (from env var)
        assert provider is not None
        assert isinstance(provider, SerperClient)


def test_db_config_takes_precedence_over_env(
    db_session: Session, tenant_context: None, clean_env: None
) -> None:
    """Test that database configuration takes precedence over environment variables"""
    db_api_key = "db-serper-key"
    env_api_key = "env-exa-key"

    # Create Serper provider in database
    upsert_web_search_provider(
        db_session=db_session,
        provider_type=WebSearchProviderType.SERPER,
        api_key=db_api_key,
        is_default=True,
    )

    # Set EXA environment variable
    with patch("onyx.agents.agent_search.dr.sub_agents.web_search.providers.EXA_API_KEY", env_api_key):
        # Get provider
        provider = get_default_provider(db_session)

        # Should get SerperClient from database, not ExaClient from env
        assert provider is not None
        assert isinstance(provider, SerperClient)
        assert provider.api_key == db_api_key


def test_no_provider_configured(
    db_session: Session, tenant_context: None, clean_env: None
) -> None:
    """Test that None is returned when no provider is configured anywhere"""
    # Don't create any database config, env vars are already cleared by clean_env

    # Patch the env var constants to ensure they're None
    with patch("onyx.agents.agent_search.dr.sub_agents.web_search.providers.EXA_API_KEY", None):
        with patch("onyx.agents.agent_search.dr.sub_agents.web_search.providers.SERPER_API_KEY", None):
            # Get provider
            provider = get_default_provider(db_session)

            # Should return None when no config exists
            assert provider is None


def test_no_db_session_provided_uses_env_fallback(clean_env: None) -> None:
    """Test that when no db_session is provided, it falls back to environment variables"""
    test_api_key = "test-exa-no-session-key"

    # Set environment variable
    with patch("onyx.agents.agent_search.dr.sub_agents.web_search.providers.EXA_API_KEY", test_api_key):
        # Call without db_session
        provider = get_default_provider(db_session=None)

        # Should get ExaClient from env var
        assert provider is not None
        assert isinstance(provider, ExaClient)


def test_multiple_providers_only_default_is_used(
    db_session: Session, tenant_context: None, clean_env: None
) -> None:
    """Test that only the default provider is returned when multiple are configured"""
    # Create multiple providers, but only mark Serper as default
    upsert_web_search_provider(
        db_session=db_session,
        provider_type=WebSearchProviderType.EXA,
        api_key="exa-key",
        is_default=False,
    )

    upsert_web_search_provider(
        db_session=db_session,
        provider_type=WebSearchProviderType.SERPER,
        api_key="serper-key-default",
        is_default=True,
    )

    # Get provider
    provider = get_default_provider(db_session)

    # Should get the default SerperClient
    assert provider is not None
    assert isinstance(provider, SerperClient)
    assert provider.api_key == "serper-key-default"
