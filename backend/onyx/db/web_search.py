from sqlalchemy import delete
from sqlalchemy import select
from sqlalchemy.orm import Session

from onyx.db.enums import WebSearchProviderType
from onyx.db.models import WebSearchProvider


def fetch_web_search_providers(db_session: Session) -> list[WebSearchProvider]:
    """Fetch all web search providers from the database"""
    return list(db_session.scalars(select(WebSearchProvider)).all())


def get_default_web_search_provider(
    db_session: Session,
) -> WebSearchProvider | None:
    """Get the default web search provider"""
    return db_session.scalar(
        select(WebSearchProvider).where(WebSearchProvider.is_default == True)  # noqa: E712
    )


def get_web_search_provider_by_type(
    db_session: Session, provider_type: WebSearchProviderType
) -> WebSearchProvider | None:
    """Get a web search provider by its type"""
    return db_session.scalar(
        select(WebSearchProvider).where(
            WebSearchProvider.provider_type == provider_type
        )
    )


def upsert_web_search_provider(
    db_session: Session,
    provider_type: WebSearchProviderType,
    api_key: str,
    is_default: bool = False,
) -> WebSearchProvider:
    """Create or update a web search provider

    Args:
        db_session: Database session
        provider_type: Type of web search provider (SERPER or EXA)
        api_key: API key for the provider (will be encrypted)
        is_default: Whether this should be the default provider

    Returns:
        The created or updated WebSearchProvider
    """
    # Fetch existing provider
    existing_provider = get_web_search_provider_by_type(db_session, provider_type)

    if existing_provider:
        # Update existing provider
        existing_provider.api_key = api_key
        if is_default and not existing_provider.is_default:
            # Unset other defaults before setting this one
            _unset_all_defaults(db_session)
            existing_provider.is_default = True
        elif not is_default and existing_provider.is_default:
            # If unsetting default, set to None instead of False for unique constraint
            existing_provider.is_default = None
    else:
        # Create new provider
        if is_default:
            # Unset other defaults before setting this one
            _unset_all_defaults(db_session)

        existing_provider = WebSearchProvider(
            provider_type=provider_type,
            api_key=api_key,
            is_default=True if is_default else None,  # Use None for non-default to satisfy unique constraint
        )
        db_session.add(existing_provider)

    db_session.commit()
    db_session.refresh(existing_provider)
    return existing_provider


def remove_web_search_provider(db_session: Session, provider_id: int) -> None:
    """Delete a web search provider by ID"""
    db_session.execute(
        delete(WebSearchProvider).where(WebSearchProvider.id == provider_id)
    )
    db_session.commit()


def _unset_all_defaults(db_session: Session) -> None:
    """Helper function to unset all default web search providers"""
    all_providers = fetch_web_search_providers(db_session)
    for provider in all_providers:
        if provider.is_default:
            provider.is_default = None
    db_session.flush()


def sanitize_api_key_for_display(api_key: str | None) -> str | None:
    """Sanitize API key for display in the UI (show first 4 + last 4 characters)"""
    if not api_key or len(api_key) < 8:
        return api_key
    return api_key[:4] + "****" + api_key[-4:]
