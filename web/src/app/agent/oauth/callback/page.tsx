"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

export default function AgentOAuthCallbackPage() {
  const searchParams = useSearchParams();
  const [status, setStatus] = useState<"processing" | "success" | "error">("processing");
  const [errorMessage, setErrorMessage] = useState<string>("");

  useEffect(() => {
    const gatewayId = searchParams.get("gateway_id");
    const code = searchParams.get("code");
    const state = searchParams.get("state");

    if (!gatewayId || !code) {
      setStatus("error");
      setErrorMessage("Missing required OAuth parameters");
      return;
    }

    // Send the OAuth code to the backend
    fetch(`/api/agent/connectors/${gatewayId}/oauth/callback`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, state }),
    })
      .then((resp) => {
        if (!resp.ok) {
          throw new Error(`OAuth callback failed: ${resp.status}`);
        }
        setStatus("success");

        // Try to redirect back to desktop app via deep link
        if (typeof window !== "undefined") {
          // Give user a moment to see success message, then redirect
          setTimeout(() => {
            window.location.href = "budstudio://oauth-success";
          }, 2000);
        }
      })
      .catch((error) => {
        setStatus("error");
        setErrorMessage(error.message || "OAuth callback failed");
      });
  }, [searchParams]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="max-w-md w-full mx-4 p-8 bg-background-emphasis rounded-lg border border-border shadow-lg">
        {status === "processing" && (
          <>
            <div className="flex justify-center mb-4">
              <div className="w-12 h-12 border-4 border-purple-500 border-t-transparent rounded-full animate-spin" />
            </div>
            <h1 className="text-xl font-semibold text-center mb-2">
              Completing OAuth...
            </h1>
            <p className="text-sm text-text-subtle text-center">
              Please wait while we complete the authentication.
            </p>
          </>
        )}

        {status === "success" && (
          <>
            <div className="flex justify-center mb-4">
              <svg
                className="w-16 h-16 text-green-500"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M5 13l4 4L19 7"
                />
              </svg>
            </div>
            <h1 className="text-xl font-semibold text-center mb-2 text-green-600">
              Connection Successful!
            </h1>
            <p className="text-sm text-text-subtle text-center mb-4">
              Your connector has been successfully connected.
            </p>
            <p className="text-xs text-text-subtle text-center">
              Returning to Bud Studio...
            </p>
            <div className="mt-4 text-center">
              <a
                href="budstudio://oauth-success"
                className="text-purple-500 hover:text-purple-600 text-sm underline"
              >
                Click here if you&apos;re not automatically redirected
              </a>
            </div>
          </>
        )}

        {status === "error" && (
          <>
            <div className="flex justify-center mb-4">
              <svg
                className="w-16 h-16 text-red-500"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </div>
            <h1 className="text-xl font-semibold text-center mb-2 text-red-600">
              Connection Failed
            </h1>
            <p className="text-sm text-text-subtle text-center mb-4">
              {errorMessage || "An error occurred during OAuth authentication."}
            </p>
            <div className="mt-4 text-center">
              <a
                href="budstudio://oauth-error"
                className="text-purple-500 hover:text-purple-600 text-sm underline"
              >
                Return to Bud Studio
              </a>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
