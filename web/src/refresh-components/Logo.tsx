import { useMemo } from "react";
import { OnyxIcon, OnyxLogoTypeIcon } from "@/components/icons/icons";
import { useSettingsContext } from "@/components/settings/SettingsProvider";
import {
  NEXT_PUBLIC_DO_NOT_USE_TOGGLE_OFF_DANSWER_POWERED,
  NEXT_PUBLIC_AUTH_LOGO_URL,
} from "@/lib/constants";
import { cn } from "@/lib/utils";
import Text from "@/refresh-components/texts/Text";

const FOLDED_SIZE = 24;

export interface LogoProps {
  folded?: boolean;
  className?: string;
}

export default function Logo({ folded, className }: LogoProps) {
  const settings = useSettingsContext();

  const logo = useMemo(
    () =>
      // Priority 1: Use env var logo (shared with login page)
      NEXT_PUBLIC_AUTH_LOGO_URL ? (
        <img
          src={NEXT_PUBLIC_AUTH_LOGO_URL}
          alt="Logo"
          style={{
            objectFit: "contain",
            height: FOLDED_SIZE,
            width: FOLDED_SIZE,
          }}
          className={cn("flex-shrink-0", className)}
          onError={(e) => {
            (e.target as HTMLImageElement).style.display = "none";
          }}
        />
      ) : // Priority 2: Use enterprise custom logo if configured
        settings.enterpriseSettings?.use_custom_logo ? (
          <img
            src="/api/enterprise-settings/logo"
            alt="Logo"
            style={{
              objectFit: "contain",
              height: FOLDED_SIZE,
              width: FOLDED_SIZE,
            }}
            className={cn("flex-shrink-0", className)}
          />
        ) : (
          // Priority 3: Fall back to OnyxIcon SVG
          <OnyxIcon
            size={FOLDED_SIZE}
            className={cn("flex-shrink-0", className)}
          />
        ),
    [className, settings.enterpriseSettings?.use_custom_logo]
  );

  if (folded) return logo;

  return settings.enterpriseSettings?.application_name ? (
    <div className="flex flex-col">
      <div className="flex flex-row items-center gap-2">
        {logo}
        <Text headingH3 className="break-all line-clamp-2">
          {settings.enterpriseSettings?.application_name}
        </Text>
      </div>
    </div>
  ) : (
    NEXT_PUBLIC_AUTH_LOGO_URL ? (
      <img
        src={NEXT_PUBLIC_AUTH_LOGO_URL}
        alt="Logo"
        style={{
          objectFit: "contain",
          height: 45,
          width: 90,
        }}
        className={cn("flex-shrink-0", className)}
        onError={(e) => {
          (e.target as HTMLImageElement).style.display = "none";
        }}
      />
    ) : <OnyxLogoTypeIcon size={100} className={className} />
  )
}
