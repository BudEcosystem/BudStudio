import httpx
from fastapi import APIRouter
from fastapi import Depends
from fastapi import HTTPException
from sqlalchemy.orm import Session

from onyx.auth.users import current_admin_user
from onyx.db.engine.sql_engine import get_session
from onyx.db.models import User
from onyx.db.web_search import fetch_web_search_providers
from onyx.db.web_search import get_web_search_provider_by_type
from onyx.db.web_search import remove_web_search_provider
from onyx.db.web_search import sanitize_api_key_for_display
from onyx.db.web_search import upsert_web_search_provider
from onyx.server.manage.web_search.models import TestWebSearchRequest
from onyx.server.manage.web_search.models import WebSearchProviderResponse
from onyx.server.manage.web_search.models import WebSearchProviderUpsertRequest
from onyx.utils.logger import setup_logger

logger = setup_logger()

admin_router = APIRouter(prefix="/admin/web-search")


@admin_router.post("/test")
def test_web_search_provider(
    test_request: TestWebSearchRequest,
    _: User | None = Depends(current_admin_user),
    db_session: Session = Depends(get_session),
) -> dict[str, str]:
    """Test web search provider credentials by making a simple search request"""

    # Get API key - use existing if not changed
    test_api_key = test_request.api_key
    if not test_request.api_key_changed:
        existing_provider = get_web_search_provider_by_type(
            db_session, test_request.provider_type
        )
        if existing_provider:
            test_api_key = existing_provider.api_key

    if not test_api_key:
        raise HTTPException(status_code=400, detail="API key is required for testing")

    # Test the provider based on type
    try:
        if test_request.provider_type.value == "serper":
            _test_serper(test_api_key)
        elif test_request.provider_type.value == "exa":
            _test_exa(test_api_key)
        else:
            raise HTTPException(
                status_code=400, detail=f"Unknown provider type: {test_request.provider_type}"
            )
        return {"message": "Web search provider credentials are valid"}
    except Exception as e:
        logger.exception(f"Failed to test {test_request.provider_type} provider")
        raise HTTPException(
            status_code=400,
            detail=f"Failed to validate credentials: {str(e)}",
        )


def _test_serper(api_key: str) -> None:
    """Test Serper.dev API with a simple search"""
    url = "https://google.serper.dev/search"
    headers = {"X-API-KEY": api_key, "Content-Type": "application/json"}
    data = {"q": "test", "num": 1}  # Minimal test search

    with httpx.Client(timeout=10.0) as client:
        response = client.post(url, headers=headers, json=data)
        response.raise_for_status()


def _test_exa(api_key: str) -> None:
    """Test Exa API with a simple search"""
    url = "https://api.exa.ai/search"
    headers = {"x-api-key": api_key, "Content-Type": "application/json"}
    data = {"query": "test", "numResults": 1}  # Minimal test search

    with httpx.Client(timeout=10.0) as client:
        response = client.post(url, headers=headers, json=data)
        response.raise_for_status()


@admin_router.get("/provider")
def list_web_search_providers(
    _: User | None = Depends(current_admin_user),
    db_session: Session = Depends(get_session),
) -> list[WebSearchProviderResponse]:
    """List all configured web search providers"""
    providers = fetch_web_search_providers(db_session)

    response_list = []
    for provider in providers:
        provider_response = WebSearchProviderResponse.from_model(provider)
        # Sanitize API key for display
        if provider_response.api_key:
            provider_response.api_key = sanitize_api_key_for_display(
                provider_response.api_key
            )
        response_list.append(provider_response)

    return response_list


@admin_router.put("/provider")
def upsert_web_search_provider_endpoint(
    request: WebSearchProviderUpsertRequest,
    _: User | None = Depends(current_admin_user),
    db_session: Session = Depends(get_session),
) -> WebSearchProviderResponse:
    """Create or update a web search provider"""

    # Get existing provider to handle API key changes
    existing_provider = get_web_search_provider_by_type(
        db_session, request.provider_type
    )

    # If API key wasn't changed, use the existing one
    api_key_to_use = request.api_key
    if existing_provider and not request.api_key_changed:
        api_key_to_use = existing_provider.api_key

    try:
        provider = upsert_web_search_provider(
            db_session=db_session,
            provider_type=request.provider_type,
            api_key=api_key_to_use,
            is_default=request.is_default,
        )

        response = WebSearchProviderResponse.from_model(provider)
        # Sanitize API key for response
        if response.api_key:
            response.api_key = sanitize_api_key_for_display(response.api_key)

        return response
    except Exception as e:
        logger.exception("Failed to upsert web search provider")
        raise HTTPException(status_code=400, detail=str(e))


@admin_router.delete("/provider/{provider_id}")
def delete_web_search_provider(
    provider_id: int,
    _: User | None = Depends(current_admin_user),
    db_session: Session = Depends(get_session),
) -> dict[str, str]:
    """Delete a web search provider"""
    try:
        remove_web_search_provider(db_session, provider_id)
        return {"message": "Web search provider deleted successfully"}
    except Exception as e:
        logger.exception(f"Failed to delete web search provider {provider_id}")
        raise HTTPException(status_code=400, detail=str(e))
