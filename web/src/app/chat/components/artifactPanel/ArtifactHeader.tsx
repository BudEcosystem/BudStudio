"use client";

import { cn } from "@/lib/utils";
import Text from "@/refresh-components/texts/Text";
import IconButton from "@/refresh-components/buttons/IconButton";
import SvgArrowWallRight from "@/icons/arrow-wall-right";

interface ArtifactHeaderProps {
  title: string;
  isStreaming: boolean;
  onClose: () => void;
}

export function ArtifactHeader({ title, isStreaming, onClose }: ArtifactHeaderProps) {
  return (
    <div
      className={cn(
        "sticky top-0 z-10 flex items-center justify-between",
        "border-b px-3 py-2 bg-background"
      )}
    >
      <div className="flex items-center gap-2 min-w-0">
        {isStreaming && (
          <span
            className="inline-block h-2 w-2 flex-shrink-0 rounded-full bg-theme-primary-05 animate-pulse"
            aria-label="Streaming"
          />
        )}
        <Text headingH3 text03 className="truncate">
          {title}
        </Text>
      </div>

      <IconButton
        icon={SvgArrowWallRight}
        tertiary
        onClick={onClose}
        tooltip="Close Artifact"
      />
    </div>
  );
}
