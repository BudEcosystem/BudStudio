"use client";

import { useState } from "react";
import {
  WebSearchProvider,
  upsertWebSearchProvider,
  testWebSearchProvider,
} from "@/lib/web-search";
import Button from "@/refresh-components/buttons/Button";
import Text from "@/components/ui/text";
import { PopupSpec } from "@/components/admin/connectors/Popup";

export function WebSearchProviderForm({
  existingProvider,
  onClose,
  onSuccess,
  setPopup,
  availableProviders,
}: {
  existingProvider: WebSearchProvider | null;
  onClose: () => void;
  onSuccess: () => void;
  setPopup: (popup: PopupSpec) => void;
  availableProviders: ("serper" | "exa")[];
}) {
  const [providerType, setProviderType] = useState<"serper" | "exa">(
    existingProvider?.provider_type || availableProviders[0] || "serper"
  );
  const [apiKey, setApiKey] = useState("");
  const [isDefault, setIsDefault] = useState(existingProvider?.is_default || false);
  const [isTesting, setIsTesting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const isEditing = existingProvider !== null;
  const apiKeyChanged = apiKey.length > 0;

  const handleTest = async () => {
    if (!apiKeyChanged && !existingProvider) {
      setPopup({
        type: "error",
        message: "Please enter an API key to test",
      });
      return;
    }

    setIsTesting(true);
    const [error] = await testWebSearchProvider({
      provider_type: providerType,
      api_key: apiKey || null,
      api_key_changed: apiKeyChanged,
    });

    setIsTesting(false);

    if (error) {
      setPopup({
        type: "error",
        message: `Test failed: ${error}`,
      });
    } else {
      setPopup({
        type: "success",
        message: "Provider credentials are valid!",
      });
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!apiKeyChanged && !isEditing) {
      setPopup({
        type: "error",
        message: "Please enter an API key",
      });
      return;
    }

    setIsSaving(true);
    const [error] = await upsertWebSearchProvider({
      provider_type: providerType,
      api_key: apiKey || (existingProvider?.api_key ?? ""),
      api_key_changed: apiKeyChanged,
      is_default: isDefault,
    });

    setIsSaving(false);

    if (error) {
      setPopup({
        type: "error",
        message: `Failed to save provider: ${error}`,
      });
    } else {
      setPopup({
        type: "success",
        message: `Provider ${isEditing ? "updated" : "added"} successfully`,
      });
      onSuccess();
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4 p-4">
      {/* Provider Type Selection */}
      {!isEditing && availableProviders.length > 1 && (
        <div>
          <label className="block text-sm font-medium mb-2">
            Provider Type
          </label>
          <select
            value={providerType}
            onChange={(e) => setProviderType(e.target.value as "serper" | "exa")}
            className="w-full border rounded p-2"
          >
            {availableProviders.map((type) => (
              <option key={type} value={type}>
                {type === "serper" ? "Serper (Google Search)" : "Exa (AI Search)"}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* API Key */}
      <div>
        <label className="block text-sm font-medium mb-2">
          API Key
          {isEditing && (
            <span className="text-xs text-text-secondary ml-2">
              (leave blank to keep existing)
            </span>
          )}
        </label>
        <input
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder={
            isEditing ? existingProvider?.api_key || "" : "Enter API key"
          }
          className="w-full border rounded p-2"
        />
        <Text className="text-xs text-text-secondary mt-1">
          {providerType === "serper" ? (
            <>
              Get your API key from{" "}
              <a
                href="https://serper.dev"
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-600 hover:underline"
              >
                serper.dev
              </a>
            </>
          ) : (
            <>
              Get your API key from{" "}
              <a
                href="https://exa.ai"
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-600 hover:underline"
              >
                exa.ai
              </a>
            </>
          )}
        </Text>
      </div>

      {/* Set as Default */}
      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          id="is-default"
          checked={isDefault}
          onChange={(e) => setIsDefault(e.target.checked)}
          className="rounded"
        />
        <label htmlFor="is-default" className="text-sm">
          Set as default provider
        </label>
      </div>

      {/* Action Buttons */}
      <div className="flex gap-2 pt-4">
        <Button
          type="button"
          action
          onClick={handleTest}
          disabled={isTesting}
          className="flex-1"
        >
          {isTesting ? "Testing..." : "Test Credentials"}
        </Button>
        <Button
          type="submit"
          action
          disabled={isSaving}
          className="flex-1"
        >
          {isSaving ? "Saving..." : isEditing ? "Update" : "Add"}
        </Button>
        <Button
          type="button"
          onClick={onClose}
          disabled={isSaving || isTesting}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}
