import type { ActionEvent } from "@openuidev/react-lang";

/**
 * Central handler for artifact action events emitted by OpenUI components.
 *
 * @param event   The structured ActionEvent from the Renderer's onAction callback.
 * @param sendMessage  A function that sends a chat message on behalf of the user
 *                     (e.g. continues the conversation with the agent).
 */
export function handleArtifactAction(
  event: ActionEvent,
  sendMessage: (msg: string) => void
): void {
  switch (event.type) {
    case "continue_conversation": {
      const message =
        event.humanFriendlyMessage || event.params?.message || "";
      if (message) {
        sendMessage(String(message));
      }
      break;
    }

    case "copy_to_clipboard": {
      const text = event.params?.text ?? "";
      if (typeof navigator !== "undefined" && navigator.clipboard) {
        navigator.clipboard.writeText(String(text)).catch(() => {
          // Clipboard API may fail in insecure contexts — silent fallback
        });
      }
      break;
    }

    case "download": {
      const url = event.params?.url;
      if (url) {
        const urlStr = String(url);
        // Only allow http(s) URLs to prevent javascript: injection
        if (/^https?:\/\//i.test(urlStr)) {
          window.open(urlStr, "_blank", "noopener,noreferrer");
        }
      } else if (event.params?.content) {
        // Create a blob download from inline content
        const blob = new Blob([String(event.params.content)], {
          type: (event.params.mimeType as string) || "text/plain",
        });
        const blobUrl = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = blobUrl;
        anchor.download =
          (event.params.filename as string) || "download.txt";
        document.body.appendChild(anchor);
        anchor.click();
        document.body.removeChild(anchor);
        URL.revokeObjectURL(blobUrl);
      }
      break;
    }

    case "open_url": {
      const url = event.params?.url;
      if (url) {
        const urlStr = String(url);
        if (/^https?:\/\//i.test(urlStr)) {
          window.open(urlStr, "_blank", "noopener,noreferrer");
        }
      }
      break;
    }

    default: {
      // Unknown action types are forwarded as conversation continuations
      // so the agent can decide what to do with them.
      if (event.humanFriendlyMessage) {
        sendMessage(event.humanFriendlyMessage);
      }
      break;
    }
  }
}
