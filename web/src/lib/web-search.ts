// Web Search Provider API functions

export interface WebSearchProvider {
  id: number;
  provider_type: "serper" | "exa";
  api_key: string | null; // Sanitized in responses
  is_default: boolean;
}

export interface WebSearchProviderUpsertRequest {
  provider_type: "serper" | "exa";
  api_key: string;
  api_key_changed: boolean;
  is_default: boolean;
}

export interface TestWebSearchRequest {
  provider_type: "serper" | "exa";
  api_key: string | null;
  api_key_changed: boolean;
}

async function handleResponse(
  response: Response
): Promise<[string | null, any]> {
  const responseJson = await response.json();
  if (response.ok) {
    return [null, responseJson];
  }
  return [responseJson.detail || responseJson.message || "Unknown error", null];
}

export async function fetchWebSearchProviders(): Promise<WebSearchProvider[]> {
  const response = await fetch("/api/admin/web-search/provider");
  if (!response.ok) {
    throw new Error(
      `Failed to fetch web search providers: ${await response.text()}`
    );
  }
  return await response.json();
}

export async function testWebSearchProvider(
  request: TestWebSearchRequest
): Promise<[string | null, any]> {
  const response = await fetch("/api/admin/web-search/test", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(request),
  });
  return handleResponse(response);
}

export async function upsertWebSearchProvider(
  request: WebSearchProviderUpsertRequest
): Promise<[string | null, WebSearchProvider | null]> {
  const response = await fetch("/api/admin/web-search/provider", {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(request),
  });
  return handleResponse(response);
}

export async function deleteWebSearchProvider(
  providerId: number
): Promise<[string | null, any]> {
  const response = await fetch(
    `/api/admin/web-search/provider/${providerId}`,
    {
      method: "DELETE",
    }
  );
  return handleResponse(response);
}
