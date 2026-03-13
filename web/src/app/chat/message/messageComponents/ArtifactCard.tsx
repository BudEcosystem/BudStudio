import React, { useCallback, useEffect, useRef } from "react";
import {
  Mail,
  Table,
  BarChart3,
  Code,
  FileText,
  ArrowRight,
  type LucideIcon,
} from "lucide-react";
import { useChatSessionStore } from "../../stores/useChatSessionStore";

interface ArtifactCardProps {
  openui_response: string;
  title?: string;
  toolName: string;
  isStreaming: boolean;
}

interface ComponentTypeInfo {
  icon: LucideIcon;
  label: string;
}

function detectComponentType(openui_response: string): ComponentTypeInfo {
  const lower = openui_response.toLowerCase();

  if (lower.includes("emaildraft") || lower.includes("email_draft")) {
    return { icon: Mail, label: "Email Draft" };
  }
  if (
    lower.includes("datatable") ||
    lower.includes("data_table") ||
    lower.includes("table(")
  ) {
    return { icon: Table, label: "Data Table" };
  }
  if (
    lower.includes("chart") ||
    lower.includes("barchart") ||
    lower.includes("linechart") ||
    lower.includes("areachart") ||
    lower.includes("piechart") ||
    lower.includes("radarchart") ||
    lower.includes("scatterchart")
  ) {
    return { icon: BarChart3, label: "Chart" };
  }
  if (lower.includes("codeblock") || lower.includes("code_block")) {
    return { icon: Code, label: "Code Block" };
  }
  if (lower.includes("accordion")) {
    return { icon: FileText, label: "Report" };
  }
  if (lower.includes("form(")) {
    return { icon: FileText, label: "Form" };
  }

  return { icon: FileText, label: "Artifact" };
}

function extractPreview(openui_response: string): string {
  // Try to extract meaningful preview from the first non-empty line
  const lines = openui_response.split("\n").filter((l) => l.trim().length > 0);
  if (lines.length === 0) return "View generated content";

  // Skip XML/tag-like opening lines to find content
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("<") && trimmed.length > 0) {
      return trimmed.length > 80 ? trimmed.slice(0, 77) + "..." : trimmed;
    }
  }

  return "View generated content";
}

export const ArtifactCard: React.FC<ArtifactCardProps> = ({
  openui_response,
  title,
  toolName,
  isStreaming,
}) => {
  const setCurrentActiveArtifact = useChatSessionStore(
    (s) => s.setCurrentActiveArtifact
  );
  const hasAutoOpened = useRef(false);

  const displayTitle = title || toolName;
  const { icon: Icon } = detectComponentType(openui_response);
  const preview = extractPreview(openui_response);

  const handleClick = useCallback(() => {
    setCurrentActiveArtifact({
      openui_lang: openui_response,
      title: displayTitle,
      isStreaming,
    });
  }, [openui_response, displayTitle, isStreaming, setCurrentActiveArtifact]);

  // Auto-open artifact panel when a new openui_response first arrives during streaming
  useEffect(() => {
    if (openui_response && !hasAutoOpened.current) {
      hasAutoOpened.current = true;
      setCurrentActiveArtifact({
        openui_lang: openui_response,
        title: displayTitle,
        isStreaming,
      });
    }
  }, [openui_response, displayTitle, isStreaming, setCurrentActiveArtifact]);

  // Keep the active artifact content up to date while streaming
  useEffect(() => {
    if (isStreaming && hasAutoOpened.current) {
      setCurrentActiveArtifact({
        openui_lang: openui_response,
        title: displayTitle,
        isStreaming: true,
      });
    }
  }, [openui_response, displayTitle, isStreaming, setCurrentActiveArtifact]);

  return (
    <button
      type="button"
      onClick={handleClick}
      className="group flex w-full max-w-md items-center gap-3 rounded-lg border
        border-border bg-background p-3 text-left shadow-sm transition-all
        hover:border-border-strong hover:shadow-md"
    >
      <div
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md
          bg-background-emphasis text-text-dark"
      >
        <Icon className="h-5 w-5" />
      </div>

      <div className="min-w-0 flex-1">
        <span className="truncate text-sm font-medium text-text-dark">
          {displayTitle}
        </span>
        <p className="mt-0.5 truncate text-xs text-text-subtle">{preview}</p>
      </div>

      <div
        className="flex shrink-0 items-center gap-1 text-xs font-medium
          text-text-subtle transition-colors group-hover:text-text-dark"
      >
        View
        <ArrowRight className="h-3.5 w-3.5" />
      </div>
    </button>
  );
};

export default ArtifactCard;
