from typing import TYPE_CHECKING

from pydantic import BaseModel

from onyx.db.enums import WebSearchProviderType

if TYPE_CHECKING:
    from onyx.db.models import WebSearchProvider as WebSearchProviderModel


class TestWebSearchRequest(BaseModel):
    """Request to test web search provider credentials"""

    provider_type: WebSearchProviderType
    api_key: str | None = None
    api_key_changed: bool = False


class WebSearchProviderResponse(BaseModel):
    """Response model for web search provider"""

    id: int
    provider_type: WebSearchProviderType
    api_key: str | None = None  # Sanitized in API responses
    is_default: bool

    @classmethod
    def from_model(
        cls, provider_model: "WebSearchProviderModel"
    ) -> "WebSearchProviderResponse":
        return cls(
            id=provider_model.id,
            provider_type=provider_model.provider_type,
            api_key=provider_model.api_key,
            is_default=provider_model.is_default or False,
        )


class WebSearchProviderUpsertRequest(BaseModel):
    """Request to create or update a web search provider"""

    provider_type: WebSearchProviderType
    api_key: str
    api_key_changed: bool = False
    is_default: bool = False
