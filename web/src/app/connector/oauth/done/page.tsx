"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useState, Suspense } from "react";
import { markOAuthComplete } from "@/lib/agent/connector-utils";

type CallbackState = "loading" | "success" | "error";

function OAuthDoneContent() {
  const searchParams = useSearchParams();
  const [state, setState] = useState<CallbackState>("loading");
  const [errorMsg, setErrorMsg] = useState<string>("");

  const oauthStatus = searchParams.get("oauth_status");
  const gatewayId = searchParams.get("gateway_id");
  const errorParam = searchParams.get("error");

  useEffect(() => {
    if (oauthStatus !== "success" || !gatewayId) {
      const msg = errorParam || "OAuth authorization was not completed.";
      setErrorMsg(msg);
      setState("error");
      window.opener?.postMessage(
        { type: "OAUTH_COMPLETE", gatewayId, status: "error", error: msg },
        window.location.origin
      );
      return;
    }

    // Call backend to verify and mark OAuth complete
    markOAuthComplete(gatewayId)
      .then(() => {
        setState("success");
        window.opener?.postMessage(
          { type: "OAUTH_COMPLETE", gatewayId, status: "success" },
          window.location.origin
        );
        // If opened from desktop app (no window.opener), redirect via deep link
        // Otherwise auto-close the popup window
        setTimeout(() => {
          if (!window.opener) {
            window.location.href = "budstudio://oauth-success";
          } else {
            window.close();
          }
        }, 1500);
      })
      .catch((err: unknown) => {
        const msg =
          err instanceof Error ? err.message : "Failed to complete OAuth";
        setErrorMsg(msg);
        setState("error");
        window.opener?.postMessage(
          { type: "OAUTH_COMPLETE", gatewayId, status: "error", error: msg },
          window.location.origin
        );
      });
  }, [oauthStatus, gatewayId, errorParam]);

  return (
    <div className="flex items-center justify-center min-h-screen bg-background">
      <div className="text-center p-8 max-w-sm">
        {state === "loading" && (
          <>
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-600 mx-auto mb-4" />
            <p className="text-text-03">Completing connection...</p>
          </>
        )}

        {state === "success" && (
          <>
            <div className="text-green-600 text-4xl mb-4">&#10003;</div>
            <h1 className="text-lg font-semibold text-text-04 mb-2">
              Connected successfully!
            </h1>
            <p className="text-sm text-text-02">
              Returning to Bud Studio...
            </p>
            <a
              href="budstudio://oauth-success"
              className="mt-4 text-sm text-purple-600 hover:text-purple-700 underline"
            >
              Click here if you&apos;re not automatically redirected
            </a>
          </>
        )}

        {state === "error" && (
          <>
            <div className="text-red-500 text-4xl mb-4">&#10007;</div>
            <h1 className="text-lg font-semibold text-text-04 mb-2">
              Connection failed
            </h1>
            <p className="text-sm text-red-500 mb-4">{errorMsg}</p>
            <a
              href="budstudio://oauth-error"
              className="text-sm text-purple-600 hover:text-purple-700 underline"
            >
              Return to Bud Studio
            </a>
          </>
        )}
      </div>
    </div>
  );
}

export default function OAuthDonePage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center min-h-screen bg-background">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-600" />
        </div>
      }
    >
      <OAuthDoneContent />
    </Suspense>
  );
}
