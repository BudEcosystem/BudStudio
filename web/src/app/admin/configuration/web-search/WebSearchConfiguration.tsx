"use client";

import { useState } from "react";
import useSWR, { mutate } from "swr";
import { errorHandlingFetcher } from "@/lib/fetcher";
import {
  WebSearchProvider,
  deleteWebSearchProvider,
  upsertWebSearchProvider,
  testWebSearchProvider,
} from "@/lib/web-search";
import { ThreeDotsLoader } from "@/components/Loading";
import { Callout } from "@/components/ui/callout";
import Title from "@/components/ui/title";
import Text from "@/components/ui/text";
import Button from "@/refresh-components/buttons/Button";
import { Modal } from "@/components/Modal";
import { PopupSpec, usePopup } from "@/components/admin/connectors/Popup";
import { WebSearchProviderForm } from "./WebSearchProviderForm";

const WEB_SEARCH_PROVIDERS_URL = "/api/admin/web-search/provider";

export function WebSearchConfiguration() {
  const { popup, setPopup } = usePopup();
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingProvider, setEditingProvider] =
    useState<WebSearchProvider | null>(null);

  const {
    data: providers,
    isLoading,
    error,
  } = useSWR<WebSearchProvider[]>(WEB_SEARCH_PROVIDERS_URL, errorHandlingFetcher);

  const refreshProviders = () => {
    mutate(WEB_SEARCH_PROVIDERS_URL);
  };

  const handleDelete = async (providerId: number) => {
    const [error] = await deleteWebSearchProvider(providerId);
    if (error) {
      setPopup({
        type: "error",
        message: `Failed to delete provider: ${error}`,
      });
    } else {
      setPopup({
        type: "success",
        message: "Provider deleted successfully",
      });
      refreshProviders();
    }
  };

  if (isLoading) {
    return <ThreeDotsLoader />;
  }

  if (error) {
    return (
      <Callout type="danger" title="Error">
        Failed to load web search providers
      </Callout>
    );
  }

  const serperProvider = providers?.find((p) => p.provider_type === "serper");
  const exaProvider = providers?.find((p) => p.provider_type === "exa");
  const defaultProvider = providers?.find((p) => p.is_default);

  return (
    <div>
      {popup}

      <Text className="mb-4">
        Configure web search providers for use with the Deep Research agent.
        Choose between Serper (Google Search) or Exa (AI-powered search).
      </Text>

      <div className="mb-6">
        <Title className="text-lg mb-3">Configured Providers</Title>

        {(!providers || providers.length === 0) && (
          <Callout type="notice" title="No providers configured">
            Add a web search provider to enable web search functionality.
          </Callout>
        )}

        <div className="space-y-3">
          {/* Serper Provider Card */}
          <ProviderCard
            providerType="serper"
            displayName="Serper (Google Search)"
            provider={serperProvider}
            isDefault={serperProvider?.is_default || false}
            onEdit={() => setEditingProvider(serperProvider || null)}
            onDelete={() => serperProvider && handleDelete(serperProvider.id)}
            onAdd={() => setShowAddModal(true)}
          />

          {/* Exa Provider Card */}
          <ProviderCard
            providerType="exa"
            displayName="Exa (AI Search)"
            provider={exaProvider}
            isDefault={exaProvider?.is_default || false}
            onEdit={() => setEditingProvider(exaProvider || null)}
            onDelete={() => exaProvider && handleDelete(exaProvider.id)}
            onAdd={() => setShowAddModal(true)}
          />
        </div>
      </div>

      {defaultProvider && (
        <Callout type="notice" title="Default Provider">
          {defaultProvider.provider_type === "serper" ? "Serper" : "Exa"} is
          currently set as the default web search provider.
        </Callout>
      )}

      {/* Add/Edit Modal */}
      {(showAddModal || editingProvider) && (
        <Modal
          title={
            editingProvider
              ? `Edit ${editingProvider.provider_type === "serper" ? "Serper" : "Exa"} Provider`
              : "Add Web Search Provider"
          }
          onOutsideClick={() => {
            setShowAddModal(false);
            setEditingProvider(null);
          }}
        >
          <WebSearchProviderForm
            existingProvider={editingProvider}
            onClose={() => {
              setShowAddModal(false);
              setEditingProvider(null);
            }}
            onSuccess={() => {
              refreshProviders();
              setShowAddModal(false);
              setEditingProvider(null);
            }}
            setPopup={setPopup}
            availableProviders={
              editingProvider
                ? [editingProvider.provider_type]
                : ["serper", "exa"].filter(
                    (type) =>
                      !providers?.some((p) => p.provider_type === type)
                  ) as ("serper" | "exa")[]
            }
          />
        </Modal>
      )}
    </div>
  );
}

function ProviderCard({
  providerType,
  displayName,
  provider,
  isDefault,
  onEdit,
  onDelete,
  onAdd,
}: {
  providerType: "serper" | "exa";
  displayName: string;
  provider?: WebSearchProvider;
  isDefault: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onAdd: () => void;
}) {
  return (
    <div className="border p-4 bg-background-neutral-01 rounded-lg shadow-sm">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Text className="text-base font-medium">{displayName}</Text>
            {isDefault && (
              <span className="text-xs px-2 py-1 bg-blue-100 text-blue-800 rounded">
                Default
              </span>
            )}
          </div>
          {provider && (
            <Text className="text-sm text-text-secondary mt-1">
              API Key: {provider.api_key || "Not set"}
            </Text>
          )}
        </div>
        <div className="flex gap-2">
          {provider ? (
            <>
              <Button action onClick={onEdit}>
                Edit
              </Button>
              <Button action onClick={onDelete}>
                Delete
              </Button>
            </>
          ) : (
            <Button action onClick={onAdd}>
              Add
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
