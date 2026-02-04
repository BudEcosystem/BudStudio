export class FetchError extends Error {
  status: number;
  info: any;
  constructor(message: string, status: number, info: any) {
    super(message);
    this.status = status;
    this.info = info;
  }
}

export class RedirectError extends FetchError {
  constructor(message: string, status: number, info: any) {
    super(message, status, info);
  }
}

export class OIDCReauthError extends FetchError {
  constructor(message: string, status: number, info: any) {
    super(message, status, info);
  }
}

const DEFAULT_AUTH_ERROR_MSG =
  "An error occurred while fetching the data, related to the user's authentication status.";

const DEFAULT_ERROR_MSG = "An error occurred while fetching the data.";

/**
 * Handles OIDC re-authentication by redirecting to the login page.
 * This is used when the user's external IDP token has expired but their Onyx session is still valid.
 * The user will need to re-enter credentials on the custom login page to get fresh tokens.
 */
export const handleOIDCReauth = (): void => {
  // Only redirect if not already on auth pages
  if (!window.location.pathname.includes("/auth")) {
    // Store current URL to return after re-auth
    const returnUrl = window.location.href;
    console.log("OIDC token expired, redirecting to login page for re-auth");
    // Add reauth=oidc to signal the login page to trigger OIDC flow
    // instead of redirecting back to chat (which would cause a loop)
    window.location.href = `/auth/login?next=${encodeURIComponent(returnUrl)}&reauth=oidc`;
  }
};

export const errorHandlingFetcher = async <T>(url: string): Promise<T> => {
  const res = await fetch(url);

  // Handle 401 with OIDC re-auth indicator
  if (res.status === 401) {
    const info = await res.json();
    if (info.reauth_required === "oidc") {
      handleOIDCReauth();
      throw new OIDCReauthError(
        "OIDC re-authentication required",
        res.status,
        info
      );
    }
  }

  if (res.status === 403) {
    const redirect = new RedirectError(
      DEFAULT_AUTH_ERROR_MSG,
      res.status,
      await res.json()
    );
    throw redirect;
  }

  if (!res.ok) {
    const error = new FetchError(
      DEFAULT_ERROR_MSG,
      res.status,
      await res.json()
    );
    throw error;
  }

  return res.json();
};
