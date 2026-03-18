import { cookies } from "next/headers";
import { HOST_URL, INTERNAL_URL } from "./constants";

export function buildClientUrl(path: string) {
  if (path.startsWith("/")) {
    return `${HOST_URL}${path}`;
  }
  return `${HOST_URL}/${path}`;
}

export function buildUrl(path: string) {
  if (path.startsWith("/")) {
    return `${INTERNAL_URL}${path}`;
  }
  return `${INTERNAL_URL}/${path}`;
}

export class UrlBuilder {
  private url: URL;

  constructor(baseUrl: string) {
    try {
      this.url = new URL(baseUrl);
    } catch {
      // Handle relative URLs by prepending a base
      this.url = new URL(baseUrl, "http://placeholder.com");
    }
  }

  addParam(key: string, value: string | number | boolean): UrlBuilder {
    this.url.searchParams.set(key, String(value));
    return this;
  }

  addParams(params: Record<string, string | number | boolean>): UrlBuilder {
    Object.entries(params).forEach(([key, value]) => {
      this.url.searchParams.set(key, String(value));
    });
    return this;
  }

  toString(): string {
    // Extract just the path and query parts for relative URLs
    if (this.url.origin === "http://placeholder.com") {
      return `${this.url.pathname}${this.url.search}`;
    }
    return this.url.toString();
  }

  static fromInternalUrl(path: string): UrlBuilder {
    return new UrlBuilder(buildUrl(path));
  }

  static fromClientUrl(path: string): UrlBuilder {
    return new UrlBuilder(buildClientUrl(path));
  }
}

/** Default timeout for server-side fetches to the backend (10 seconds). */
const SS_FETCH_TIMEOUT_MS = 10_000;

export async function fetchSS(url: string, options?: RequestInit) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), SS_FETCH_TIMEOUT_MS);

  const init = options || {
    credentials: "include",
    cache: "no-store",
    headers: {
      cookie: (await cookies())
        .getAll()
        .map((cookie) => `${cookie.name}=${cookie.value}`)
        .join("; "),
    },
  };

  try {
    return await fetch(buildUrl(url), {
      ...init,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeoutId);
  }
}
