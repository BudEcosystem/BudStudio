"use client";

import Image from "next/image";
import { StaticImageData } from "next/image";

import {
  ArrowSquareOutIcon as ArrowSquareOut,
  BrainIcon as Brain,
  GearIcon as Gear,
  LinkIcon as Link,
  LinkBreakIcon as LinkBreak,
  PlugIcon as Plug,
  QuestionIcon as Question,
  TrashIcon as Trash,
  XSquareIcon as XSquare,
} from "@phosphor-icons/react";

import {
  FiAlertCircle,
  FiAlertTriangle,
  FiBarChart2,
  FiChevronDown,
  FiChevronLeft,
  FiChevronRight,
  FiChevronUp,
  FiChevronsDown,
  FiChevronsUp,
  FiClipboard,
  FiCopy,
  FiCpu,
  FiEdit2,
  FiFile,
  FiGlobe,
  FiInfo,
  FiMail,
  FiThumbsDown,
  FiThumbsUp,
} from "react-icons/fi";

import { FaRobot } from "react-icons/fa";
import { SiBookstack } from "react-icons/si";

import axeroImage from "../../../public/Axero.jpeg";
import airtableIcon from "../../../public/Airtable.svg";
import amazonSVG from "../../../public/Amazon.svg";
import anthropicSVG from "../../../public/Anthropic.svg";
import asanaIcon from "../../../public/Asana.png";
import azureIcon from "../../../public/Azure.png";
import bitbucketIcon from "../../../public/Bitbucket.svg";
import clickupIcon from "../../../public/Clickup.svg";
import cohereIcon from "../../../public/Cohere.svg";
import confluenceSVG from "../../../public/Confluence.svg";
import deepseekSVG from "../../../public/Deepseek.svg";
import discordIcon from "../../../public/discord.png";
import discourseIcon from "../../../public/Discourse.png";
import document360Icon from "../../../public/Document360.png";
import dropboxIcon from "../../../public/Dropbox.png";
import egnyteIcon from "../../../public/Egnyte.png";
import firefliesIcon from "../../../public/Fireflies.png";
import freshdeskIcon from "../../../public/Freshdesk.png";
import geminiSVG from "../../../public/Gemini.svg";
import gitbookDarkIcon from "../../../public/GitBookDark.png";
import gitbookLightIcon from "../../../public/GitBookLight.png";
import githubLightIcon from "../../../public/Github.png";
import gongIcon from "../../../public/Gong.png";
import googleIcon from "../../../public/Google.png";
import googleCloudStorageIcon from "../../../public/GoogleCloudStorage.png";
import googleSitesIcon from "../../../public/GoogleSites.png";
import guruIcon from "../../../public/Guru.svg";
import highspotIcon from "../../../public/Highspot.png";
import hubSpotIcon from "../../../public/HubSpot.png";
import jiraSVG from "../../../public/Jira.svg";
import kimiIcon from "../../../public/Kimi.png";
import linearIcon from "../../../public/Linear.png";
import litellmIcon from "../../../public/litellm.png";
import mediawikiIcon from "../../../public/MediaWiki.svg";
import metaSVG from "../../../public/Meta.svg";
import microsoftIcon from "../../../public/microsoft.png";
import microsoftSVG from "../../../public/Microsoft.svg";
import mistralSVG from "../../../public/Mistral.svg";
import mixedBreadSVG from "../../../public/Mixedbread.png";
import nomicSVG from "../../../public/nomic.svg";
import OCIStorageSVG from "../../../public/OCI.svg";
import ollamaIcon from "../../../public/Ollama.png";
import openAISVG from "../../../public/Openai.svg";
import openSourceIcon from "../../../public/OpenSource.png";
import outlinePNG from "../../../public/Outline.png";
import qwenSVG from "../../../public/Qwen.svg";
import r2Icon from "../../../public/r2.png";
import s3Icon from "../../../public/S3.png";
import salesforceIcon from "../../../public/Salesforce.png";
import sharepointIcon from "../../../public/Sharepoint.png";
import slackIcon from "../../../public/Slack.png";
import teamsIcon from "../../../public/Teams.png";
import wikipediaIcon from "../../../public/Wikipedia.png";
import xenforoIcon from "../../../public/Xenforo.svg";
import zAIIcon from "../../../public/Z_AI.png";
import zendeskIcon from "../../../public/Zendesk.svg";
import zulipIcon from "../../../public/Zulip.png";

import gitlabIcon from "../../../public/Gitlab.png";
import gmailIcon from "../../../public/Gmail.png";
import googleDriveIcon from "../../../public/GoogleDrive.png";
import loopioIcon from "../../../public/Loopio.png";
import notionIcon from "../../../public/Notion.png";
import productboardIcon from "../../../public/Productboard.png";
import slabLogoIcon from "../../../public/SlabLogo.png";
export interface IconProps {
  size?: number;
  className?: string;
}
export interface LogoIconProps extends IconProps {
  src: string | StaticImageData;
}
export type OnyxIconType = (props: IconProps) => JSX.Element;

export const defaultTailwindCSS = "my-auto flex flex-shrink-0 text-default";
export const defaultTailwindCSSBlue = "my-auto flex flex-shrink-0 text-link";

export const LogoIcon = ({
  size = 16,
  className = defaultTailwindCSS,
  src,
}: LogoIconProps) => (
  <Image
    style={{ width: `${size}px`, height: `${size}px` }}
    className={`w-[${size}px] h-[${size}px] ` + className}
    src={src}
    alt="Logo"
    width="96"
    height="96"
  />
);

// Helper to create simple icon components from react-icon libraries
const createIcon = (
  IconComponent: React.ComponentType<{ size?: number; className?: string }>
) => {
  const IconWrapper = ({
    size = 16,
    className = defaultTailwindCSS,
  }: IconProps) => <IconComponent size={size} className={className} />;
  IconWrapper.displayName = `Icon(${
    IconComponent.displayName || IconComponent.name || "Component"
  })`;
  return IconWrapper;
};

/**
 * Creates a logo icon component that automatically supports dark mode adaptations.
 *
 * Depending on the options provided, the returned component handles:
 * 1. Light/Dark variants: If both `src` and `darkSrc` are provided, displays the
 *    appropriate image based on the current color theme.
 * 2. Monochromatic inversion: If `monochromatic` is true, applies a CSS color inversion
 *    in dark mode for a monochrome icon appearance.
 * 3. Static icon: If only `src` is provided, renders the image without dark mode adaptation.
 *
 * @param src - The image or SVG source used for the icon (light/default mode).
 * @param options - Optional settings:
 *   - darkSrc: The image or SVG source used specifically for dark mode.
 *   - monochromatic: If true, applies a CSS inversion in dark mode for monochrome logos.
 *   - sizeAdjustment: Number to add to the icon size (e.g., 4 to make icon larger).
 *   - classNameAddition: Additional CSS classes to apply (e.g., '-m-0.5' for margin).
 * @returns A React functional component that accepts {@link IconProps} and renders
 *          the logo with dark mode handling as needed.
 */
const createLogoIcon = (
  src: string | StaticImageData,
  options?: {
    darkSrc?: string | StaticImageData;
    monochromatic?: boolean;
    sizeAdjustment?: number;
    classNameAddition?: string;
  }
) => {
  const {
    darkSrc,
    monochromatic,
    sizeAdjustment = 0,
    classNameAddition = "",
  } = options || {};

  const LogoIconWrapper = ({
    size = 16,
    className = defaultTailwindCSS,
  }: IconProps) => {
    const adjustedSize = size + sizeAdjustment;

    // Build className dynamically (only apply monochromatic if no darkSrc)
    const monochromaticClass = !darkSrc && monochromatic ? "dark:invert" : "";
    const finalClassName = [className, classNameAddition, monochromaticClass]
      .filter(Boolean)
      .join(" ");

    // If darkSrc is provided, use CSS-based dark mode switching
    // This avoids hydration issues and content flashing since next-themes
    // sets the .dark class before React hydrates
    if (darkSrc) {
      return (
        <>
          <LogoIcon
            size={adjustedSize}
            className={`${finalClassName} dark:hidden`}
            src={src}
          />
          <LogoIcon
            size={adjustedSize}
            className={`${finalClassName} hidden dark:block`}
            src={darkSrc}
          />
        </>
      );
    }

    return (
      <LogoIcon size={adjustedSize} className={finalClassName} src={src} />
    );
  };

  LogoIconWrapper.displayName = "LogoIconWrapper";
  return LogoIconWrapper;
};

// ============================================================================
// GENERIC SVG COMPONENTS (sorted alphabetically)
// ============================================================================
export const AlertIcon = createIcon(FiAlertCircle);
export const AppSearchIcon = ({
  size = 16,
  className = defaultTailwindCSS,
}: IconProps) => {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      fill="none"
      style={{ width: `${size}px`, height: `${size}px` }}
      className={`w-[${size}px] h-[${size}px] ` + className}
    >
      <path
        d="M1.00261 7.5H2.5M1 4H3.25M1.00261 11H3.25M15 13L12.682 10.682M12.682 10.682C13.4963 9.86764 14 8.74264 14 7.5C14 5.01472 11.9853 3 9.49999 3C7.01472 3 5 5.01472 5 7.5C5 9.98528 7.01472 12 9.49999 12C10.7426 12 11.8676 11.4963 12.682 10.682Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
};
export const ArrowSquareOutIcon = ({
  size = 16,
  className = defaultTailwindCSS,
}: IconProps) => {
  return <ArrowSquareOut size={size} className={className} />;
};
export const ArtAsistantIcon = ({
  size = 24,
  className = defaultTailwindCSS,
}: IconProps) => {
  return (
    <svg
      style={{ width: `${size}px`, height: `${size}px` }}
      className={`w-[${size}px] h-[${size}px] ` + className}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M12 1.5C9.98656 1.4999 8.01555 2.07871 6.32185 3.16743C4.62815 4.25616 3.28318 5.8089 2.44724 7.6406C1.6113 9.47231 1.31963 11.5057 1.60699 13.4986C1.89435 15.4914 2.74862 17.3596 4.068 18.8805L10.422 12.6285C10.8429 12.2144 11.4096 11.9824 12 11.9824C12.5904 11.9824 13.1571 12.2144 13.578 12.6285L19.932 18.8805C21.2514 17.3596 22.1056 15.4914 22.393 13.4986C22.6804 11.5057 22.3887 9.47231 21.5528 7.6406C20.7168 5.8089 19.3719 4.25616 17.6782 3.16743C15.9845 2.07871 14.0134 1.4999 12 1.5ZM12 22.5C14.5238 22.5042 16.9639 21.5952 18.87 19.941L12.525 13.6965C12.3848 13.5591 12.1963 13.4821 12 13.4821C11.8037 13.4821 11.6152 13.5591 11.475 13.6965L5.13 19.941C7.03607 21.5952 9.47619 22.5042 12 22.5ZM0 12C0 8.8174 1.26428 5.76516 3.51472 3.51472C5.76516 1.26428 8.8174 0 12 0C15.1826 0 18.2348 1.26428 20.4853 3.51472C22.7357 5.76516 24 8.8174 24 12C24 15.1826 22.7357 18.2348 20.4853 20.4853C18.2348 22.7357 15.1826 24 12 24C8.8174 24 5.76516 22.7357 3.51472 20.4853C1.26428 18.2348 0 15.1826 0 12ZM16.5 8.25C16.5 8.05109 16.421 7.86032 16.2803 7.71967C16.1397 7.57902 15.9489 7.5 15.75 7.5C15.5511 7.5 15.3603 7.57902 15.2197 7.71967C15.079 7.86032 15 8.05109 15 8.25C15 8.44891 15.079 8.63968 15.2197 8.78033C15.3603 8.92098 15.5511 9 15.75 9C15.9489 9 16.1397 8.92098 16.2803 8.78033C16.421 8.63968 16.5 8.44891 16.5 8.25ZM18 8.25C18 8.54547 17.9418 8.83806 17.8287 9.11104C17.7157 9.38402 17.5499 9.63206 17.341 9.84099C17.1321 10.0499 16.884 10.2157 16.611 10.3287C16.3381 10.4418 16.0455 10.5 15.75 10.5C15.4545 10.5 15.1619 10.4418 14.889 10.3287C14.616 10.2157 14.3679 10.0499 14.159 9.84099C13.9501 9.63206 13.7843 9.38402 13.6713 9.11104C13.5582 8.83806 13.5 8.54547 13.5 8.25C13.5 7.65326 13.7371 7.08097 14.159 6.65901C14.581 6.23705 15.1533 6 15.75 6C16.3467 6 16.919 6.23705 17.341 6.65901C17.7629 7.08097 18 7.65326 18 8.25Z"
        fill="currentColor"
      />
    </svg>
  );
};
export const AssistantsIcon = ({
  size,
  className = defaultTailwindCSS,
}: IconProps) => {
  return (
    <svg
      style={{ width: `${size}px`, height: `${size}px` }}
      className={`w-[${size}px] h-[${size}px] ` + className}
      xmlns="http://www.w3.org/2000/svg"
      width="200"
      height="200"
      viewBox="0 0 24 24"
    >
      <path
        fill="currentColor"
        d="M20.893 12.84a3.23 3.23 0 0 0-1.796-.91l.639-.64c.3-.304.537-.664.698-1.06a3.207 3.207 0 0 0 0-2.48a3.16 3.16 0 0 0-.698-1.06l-2.564-2.56a2.993 2.993 0 0 0-.997-.71a3.244 3.244 0 0 0-2.484 0a3.113 3.113 0 0 0-.998.7l-.638.64a3.242 3.242 0 0 0-1.086-1.973A3.227 3.227 0 0 0 8.863 2H5.242a3.248 3.248 0 0 0-2.29.955A3.264 3.264 0 0 0 2 5.25v13.5c0 .862.342 1.689.95 2.298c.608.61 1.432.952 2.292.952h13.466a3.254 3.254 0 0 0 2.295-1A3.239 3.239 0 0 0 22 18.7v-3.58a3.246 3.246 0 0 0-1.107-2.28M6.928 19.35a2.34 2.34 0 0 1-2.166-1.45a2.356 2.356 0 0 1 .508-2.562A2.341 2.341 0 0 1 9.272 17a2.344 2.344 0 0 1-2.344 2.35m5.057-12.52l1.646-1.65c.162-.163.356-.293.569-.38c.426-.17.9-.17 1.326 0c.21.093.402.221.569.38l2.563 2.57a2 2 0 0 1 .38.57a1.788 1.788 0 0 1 0 1.34c-.09.21-.219.4-.38.56l-6.673 6.7z"
      />
      <path
        fill="currentColor"
        d="M7.795 17a.852.852 0 0 1-1.007.845a.847.847 0 0 1-.671-.665a.852.852 0 0 1 .83-1.02a.847.847 0 0 1 .848.84"
      />
    </svg>
  );
};

<svg
  xmlns="http://www.w3.org/2000/svg"
  width="200"
  height="200"
  viewBox="0 0 24 24"
>
  <g fill="none" stroke="currentColor" strokeWidth="1.5">
    <path
      strokeLinecap="round"
      d="M21.483 19c-.04.936-.165 1.51-.569 1.914c-.586.586-1.528.586-3.414.586c-1.886 0-2.828 0-3.414-.586c-.586-.586-.586-1.528-.586-3.414v-2c0-1.886 0-2.828.586-3.414c.586-.586 1.528-.586 3.414-.586c1.886 0 2.828 0 3.414.586c.532.531.581 1.357.585 2.914"
    />
    <path d="M2 8.5c0 1.886 0 2.828.586 3.414c.586.586 1.528.586 3.414.586c1.886 0 2.828 0 3.414-.586C10 11.328 10 10.386 10 8.5v-2c0-1.886 0-2.828-.586-3.414C8.828 2.5 7.886 2.5 6 2.5c-1.886 0-2.828 0-3.414.586C2 3.672 2 4.614 2 6.5v2Z" />
    <path
      strokeLinecap="round"
      d="M15.5 2.513c-.327.017-.562.055-.765.14a2 2 0 0 0-1.083 1.082c-.152.367-.152.833-.152 1.765c0 .932 0 1.398.152 1.765a2 2 0 0 0 1.083 1.083c.367.152.833.152 1.765.152h2c.932 0 1.398 0 1.765-.152a2 2 0 0 0 1.083-1.083c.152-.367.152-.833.152-1.765c0-.932 0-1.398-.152-1.765a2 2 0 0 0-1.083-1.083c-.204-.084-.438-.122-.765-.139"
    />
    <path d="M2 18.5c0 .932 0 1.398.152 1.765a2 2 0 0 0 1.083 1.083c.367.152.833.152 1.765.152h2c.932 0 1.398 0 1.765-.152a2 2 0 0 0 1.083-1.083C10 19.898 10 19.432 10 18.5c0-.932 0-1.398-.152-1.765a2 2 0 0 0-1.083-1.083C8.398 15.5 7.932 15.5 7 15.5H5c-.932 0-1.398 0-1.765.152a2 2 0 0 0-1.083 1.083C2 17.102 2 17.568 2 18.5Z" />
  </g>
</svg>;
export const AssistantsIconSkeleton = ({
  size,
  className = defaultTailwindCSS,
}: IconProps) => {
  return (
    <svg
      style={{ width: `${size}px`, height: `${size}px` }}
      className={`w-[${size}px] h-[${size}px] ` + className}
      xmlns="http://www.w3.org/2000/svg"
      width="200"
      height="200"
      viewBox="0 0 24 24"
    >
      <g
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.5"
      >
        <path d="M8.88 21.25h9.87a2.5 2.5 0 0 0 2.5-2.5v-3.63a2.5 2.5 0 0 0-2.5-2.48h-1.27m-6.1 6.09l6.1-6.11l1.87-1.87a2.49 2.49 0 0 0 0-3.53l-2.57-2.57a2.49 2.49 0 0 0-3.53 0l-1.87 1.87" />
        <path d="M8.88 2.75H5.25a2.5 2.5 0 0 0-2.5 2.5v13.5a2.5 2.5 0 0 0 2.5 2.5h3.63a2.5 2.5 0 0 0 2.5-2.5V5.25a2.5 2.5 0 0 0-2.5-2.5" />
        <path d="M7.065 18.594a1.594 1.594 0 1 0 0-3.188a1.594 1.594 0 0 0 0 3.188" />
      </g>
    </svg>
  );
};
export const BackIcon = ({
  size = 16,
  className = defaultTailwindCSS,
}: IconProps) => {
  return (
    <svg
      style={{ width: `${size}px`, height: `${size}px` }}
      className={`w-[${size}px] h-[${size}px]` + className}
      xmlns="http://www.w3.org/2000/svg"
      width="200"
      height="200"
      viewBox="0 0 24 24"
    >
      <g
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.5"
      >
        <path d="M9.32 3.5L4.11 8.71a1.214 1.214 0 0 0 0 1.724l5.21 5.209" />
        <path d="M20.249 20.5v-7.286a3.643 3.643 0 0 0-3.643-3.643H3.759" />
      </g>
    </svg>
  );
};
export const BarChartIcon = createIcon(FiBarChart2);
export const BellIcon = ({
  size = 16,
  className = defaultTailwindCSS,
}: IconProps) => {
  return (
    <svg
      style={{ width: `${size}px`, height: `${size}px` }}
      className={`w-[${size}px] h-[${size}px] ` + className}
      xmlns="http://www.w3.org/2000/svg"
      width="200"
      height="200"
      viewBox="0 0 24 24"
    >
      <path
        fill="currentColor"
        fillRule="evenodd"
        d="M12 1.25A7.75 7.75 0 0 0 4.25 9v.704a3.53 3.53 0 0 1-.593 1.958L2.51 13.385c-1.334 2-.316 4.718 2.003 5.35c.755.206 1.517.38 2.284.523l.002.005C7.567 21.315 9.622 22.75 12 22.75s4.433-1.435 5.202-3.487l.002-.005a28.472 28.472 0 0 0 2.284-.523c2.319-.632 3.337-3.35 2.003-5.35l-1.148-1.723a3.53 3.53 0 0 1-.593-1.958V9A7.75 7.75 0 0 0 12 1.25Zm3.376 18.287a28.46 28.46 0 0 1-6.753 0c.711 1.021 1.948 1.713 3.377 1.713c1.429 0 2.665-.692 3.376-1.713ZM5.75 9a6.25 6.25 0 1 1 12.5 0v.704c0 .993.294 1.964.845 2.79l1.148 1.723a2.02 2.02 0 0 1-1.15 3.071a26.96 26.96 0 0 1-14.187 0a2.021 2.021 0 0 1-1.15-3.07l1.15-1.724a5.03 5.03 0 0 0 .844-2.79V9Z"
        clipRule="evenodd"
      />
    </svg>
  );
};
export const BookIcon = ({
  size = 16,
  className = defaultTailwindCSS,
}: IconProps) => {
  return (
    <svg
      style={{ width: `${size}px`, height: `${size}px` }}
      className={`w-[${size}px] h-[${size}px] ` + className}
      xmlns="http://www.w3.org/2000/svg"
      width="200"
      height="200"
      viewBox="0 0 20 20"
    >
      <path
        fill="currentColor"
        d="M10.75 16.82A7.462 7.462 0 0 1 15 15.5a7.5 7.5 0 0 1 2.046.282a.75.75 0 0 0 .954-.722v-11a.75.75 0 0 0-.546-.721A9.006 9.006 0 0 0 15 3a8.963 8.963 0 0 0-4.25 1.065V16.82ZM9.25 4.065A8.963 8.963 0 0 0 5 3a9 9 0 0 0-2.454.339A.75.75 0 0 0 2 4.06v11a.75.75 0 0 0 .954.721A7.506 7.506 0 0 1 5 15.5c1.579 0 3.042.487 4.25 1.32V4.065Z"
      />
    </svg>
  );
};
export const BookmarkIcon = ({
  size = 16,
  className = defaultTailwindCSS,
}: IconProps) => {
  return (
    <svg
      style={{ width: `${size}px`, height: `${size}px` }}
      className={`w-[${size}px] h-[${size}px] ` + className}
      xmlns="http://www.w3.org/2000/svg"
      width="200"
      height="200"
      viewBox="0 0 16 16"
    >
      <path
        fill="currentColor"
        d="M3.75 2a.75.75 0 0 0-.75.75v10.5a.75.75 0 0 0 1.28.53L8 10.06l3.72 3.72a.75.75 0 0 0 1.28-.53V2.75a.75.75 0 0 0-.75-.75z"
      />
    </svg>
  );
};
export const BookmarkIconSkeleton = ({
  size = 16,
  className = defaultTailwindCSS,
}: IconProps) => {
  return (
    <svg
      style={{ width: `${size}px`, height: `${size}px` }}
      className={`w-[${size}px] h-[${size}px] ` + className}
      xmlns="http://www.w3.org/2000/svg"
      width="200"
      height="200"
      viewBox="0 0 24 24"
    >
      <path
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.5"
        d="M17.593 3.322c1.1.128 1.907 1.077 1.907 2.185V21L12 17.25L4.5 21V5.507c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0 1 11.186 0Z"
      />
    </svg>
  );
};
export const BrainIcon = ({
  size = 16,
  className = defaultTailwindCSS,
}: IconProps) => {
  return <Brain size={size} className={className} />;
};
export const BroomIcon = ({
  size = 16,
  className = defaultTailwindCSS,
}: IconProps) => {
  return (
    <svg
      style={{ width: `${size}px`, height: `${size}px` }}
      className={`w-[${size}px] h-[${size}px]` + className}
      xmlns="http://www.w3.org/2000/svg"
      width="200"
      height="200"
      viewBox="0 0 24 24"
    >
      <path
        fill="currentColor"
        d="M18.221 19.643c.477-.903.942-1.937 1.24-2.98c.411-1.438.56-2.788.602-3.818l-1.552-1.552l-5.804-5.804l-1.552-1.552c-1.03.042-2.38.19-3.817.602c-1.045.298-2.078.763-2.981 1.24C2.1 6.97 1.427 9.71 2.497 11.807l.013.025l.7 1.15a23.338 23.338 0 0 0 7.808 7.809l1.15.699l.025.013c2.096 1.07 4.837.396 6.028-1.86Zm3.554-16.33a.77.77 0 0 0-1.088-1.088L19.012 3.9a4.877 4.877 0 0 0-5.718 0l1.109 1.109l4.588 4.588l1.109 1.109a4.877 4.877 0 0 0 0-5.718l1.675-1.675Z"
      />
    </svg>
  );
};
export const CPUIcon = createIcon(FiCpu);
export const CameraIcon = ({
  size = 16,
  className = defaultTailwindCSS,
}: IconProps) => {
  return (
    <svg
      style={{ width: `${size}px`, height: `${size}px` }}
      className={`w-[${size}px] h-[${size}px] ` + className}
      xmlns="http://www.w3.org/2000/svg"
      width="200"
      height="200"
      viewBox="0 0 14 14"
    >
      <g
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M13.5 5a1 1 0 0 0-1-1h-2L9 2H5L3.5 4h-2a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1z" />
        <path d="M7 9.75a2.25 2.25 0 1 0 0-4.5a2.25 2.25 0 0 0 0 4.5" />
      </g>
    </svg>
  );
};
export const Caret = ({
  size = 24,
  className = defaultTailwindCSS,
}: IconProps) => {
  return (
    <svg
      style={{ width: `${size}px`, height: `${size}px` }}
      className={`w-[${size}px] h-[${size}px] ` + className}
      xmlns="http://www.w3.org/2000/svg"
      width="200"
      height="200"
      viewBox="0 0 24 24"
    >
      <path
        fill="currentColor"
        d="m12.37 15.835l6.43-6.63C19.201 8.79 18.958 8 18.43 8H5.57c-.528 0-.771.79-.37 1.205l6.43 6.63c.213.22.527.22.74 0Z"
      />
    </svg>
  );
};
export const ChatIcon = ({
  size = 16,
  className = defaultTailwindCSS,
}: IconProps) => {
  return (
    <svg
      style={{ width: `${size}px`, height: `${size}px` }}
      className={`w-[${size}px] h-[${size}px] ` + className}
      fill="none"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
      stroke="currentColor"
    >
      <path d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"></path>
    </svg>
  );
};
export const CheckmarkIcon = ({
  size = 16,
  className = defaultTailwindCSS,
}: IconProps) => {
  return (
    <svg
      style={{ width: `${size}px`, height: `${size}px` }}
      className={`w-[${size}px] h-[${size}px] ` + className}
      xmlns="http://www.w3.org/2000/svg"
      width="200"
      height="200"
      viewBox="0 0 24 24"
    >
      <path
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
        d="M20 6L9 17l-5-5"
      />
    </svg>
  );
};
export const ChevronDownIcon = createIcon(FiChevronDown);
export const ChevronIcon = ({
  size = 16,
  className = defaultTailwindCSS,
}: IconProps) => {
  return (
    <svg
      style={{ width: `${size}px`, height: `${size}px` }}
      className={`w-[${size}px] h-[${size}px] ` + className}
      xmlns="http://www.w3.org/2000/svg"
      width="200"
      height="200"
      viewBox="0 0 24 24"
    >
      <path
        fill="currentColor"
        d="M15.25 2h-6.5A6.76 6.76 0 0 0 2 8.75v6.5A6.76 6.76 0 0 0 8.75 22h6.5A6.76 6.76 0 0 0 22 15.25v-6.5A6.76 6.76 0 0 0 15.25 2m-.23 10.77a2.109 2.109 0 0 1-.46.67l-3.68 3.68a1 1 0 0 1-1.41 0a1 1 0 0 1 0-1.41l3.68-3.68v-.12L9.5 8.3a1 1 0 1 1 1.4-1.43l3.67 3.59a2.069 2.069 0 0 1 .63 1.49a2.07 2.07 0 0 1-.18.82"
      />
    </svg>
  );
};
export const ChevronLeftIcon = createIcon(FiChevronLeft);
export const ChevronRightIcon = createIcon(FiChevronRight);
export const ChevronUpIcon = createIcon(FiChevronUp);
export const ChevronsDownIcon = createIcon(FiChevronsDown);
export const ChevronsUpIcon = createIcon(FiChevronsUp);
export const CirclingArrowIcon = ({
  size = 24,
  className = defaultTailwindCSS,
}: IconProps) => {
  return (
    <svg
      style={{ width: `${size}px`, height: `${size}px` }}
      className={`w-[${size}px] h-[${size}px] ` + className}
      fill="currentColor"
      version="1.1"
      id="Capa_1"
      xmlns="http://www.w3.org/2000/svg"
      xmlnsXlink="http://www.w3.org/1999/xlink"
      width="800px"
      height="800px"
      viewBox="0 0 94.073 94.072"
      xmlSpace="preserve"
    >
      <g>
        <g>
          <path
            d="M91.465,5.491c-0.748-0.311-1.609-0.139-2.18,0.434l-8.316,8.316C72.046,5.057,60.125,0,47.399,0
			c-2.692,0-5.407,0.235-8.068,0.697C21.218,3.845,6.542,17.405,1.944,35.244c-0.155,0.599-0.023,1.235,0.355,1.724
			c0.379,0.489,0.962,0.775,1.581,0.775h12.738c0.839,0,1.59-0.524,1.878-1.313c3.729-10.193,12.992-17.971,23.598-19.814
			c1.747-0.303,3.525-0.456,5.288-0.456c8.428,0,16.299,3.374,22.168,9.5l-8.445,8.444c-0.571,0.572-0.742,1.432-0.434,2.179
			c0.311,0.748,1.039,1.235,1.848,1.235h28.181c1.104,0,2-0.896,2-2V7.338C92.7,6.53,92.211,5.801,91.465,5.491z"
          />
          <path
            d="M90.192,56.328H77.455c-0.839,0-1.59,0.523-1.878,1.312c-3.729,10.193-12.992,17.972-23.598,19.814
			c-1.748,0.303-3.525,0.456-5.288,0.456c-8.428,0-16.3-3.374-22.168-9.5l8.444-8.444c0.572-0.572,0.743-1.432,0.434-2.179
			c-0.31-0.748-1.039-1.235-1.848-1.235H3.374c-1.104,0-2,0.896-2,2v28.181c0,0.809,0.487,1.538,1.235,1.848
			c0.746,0.31,1.607,0.138,2.179-0.435l8.316-8.315c8.922,9.183,20.843,14.241,33.569,14.241c2.693,0,5.408-0.235,8.069-0.697
			c18.112-3.146,32.789-16.708,37.387-34.547c0.155-0.6,0.023-1.234-0.354-1.725C91.395,56.615,90.811,56.328,90.192,56.328z"
          />
        </g>
      </g>
    </svg>
  );
};
export const ClipboardIcon = createIcon(FiClipboard);
export const ClosedBookIcon = ({
  size = 16,
  className = defaultTailwindCSS,
}: IconProps) => {
  return (
    <svg
      style={{ width: `${size}px`, height: `${size}px` }}
      className={`w-[${size}px] h-[${size}px] ` + className}
      xmlns="http://www.w3.org/2000/svg"
      width="200"
      height="200"
      viewBox="0 0 14 14"
    >
      <path
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12.5 13.54H3a1.5 1.5 0 0 1 0-3h8.5a1 1 0 0 0 1-1v-8a1 1 0 0 0-1-1H3A1.5 1.5 0 0 0 1.5 2v10m10-1.46v3"
      />
    </svg>
  );
};
export const ConfigureIcon = ({
  size,
  className = defaultTailwindCSS,
}: IconProps) => {
  return (
    <svg
      style={{ width: `${size}px`, height: `${size}px` }}
      className={`w-[${size}px] h-[${size}px] ` + className}
      xmlns="http://www.w3.org/2000/svg"
      width="200"
      height="200"
      viewBox="0 0 24 24"
    >
      <g fill="none" stroke="currentColor" strokeWidth="1.5">
        <path
          strokeLinecap="round"
          d="M21.483 19c-.04.936-.165 1.51-.569 1.914c-.586.586-1.528.586-3.414.586c-1.886 0-2.828 0-3.414-.586c-.586-.586-.586-1.528-.586-3.414v-2c0-1.886 0-2.828.586-3.414c.586-.586 1.528-.586 3.414-.586c1.886 0 2.828 0 3.414.586c.532.531.581 1.357.585 2.914"
        />
        <path d="M2 8.5c0 1.886 0 2.828.586 3.414c.586.586 1.528.586 3.414.586c1.886 0 2.828 0 3.414-.586C10 11.328 10 10.386 10 8.5v-2c0-1.886 0-2.828-.586-3.414C8.828 2.5 7.886 2.5 6 2.5c-1.886 0-2.828 0-3.414.586C2 3.672 2 4.614 2 6.5v2Z" />
        <path
          strokeLinecap="round"
          d="M15.5 2.513c-.327.017-.562.055-.765.14a2 2 0 0 0-1.083 1.082c-.152.367-.152.833-.152 1.765c0 .932 0 1.398.152 1.765a2 2 0 0 0 1.083 1.083c.367.152.833.152 1.765.152h2c.932 0 1.398 0 1.765-.152a2 2 0 0 0 1.083-1.083c.152-.367.152-.833.152-1.765c0-.932 0-1.398-.152-1.765a2 2 0 0 0-1.083-1.083c-.204-.084-.438-.122-.765-.139"
        />
        <path d="M2 18.5c0 .932 0 1.398.152 1.765a2 2 0 0 0 1.083 1.083c.367.152.833.152 1.765.152h2c.932 0 1.398 0 1.765-.152a2 2 0 0 0 1.083-1.083C10 19.898 10 19.432 10 18.5c0-.932 0-1.398-.152-1.765a2 2 0 0 0-1.083-1.083C8.398 15.5 7.932 15.5 7 15.5H5c-.932 0-1.398 0-1.765.152a2 2 0 0 0-1.083 1.083C2 17.102 2 17.568 2 18.5Z" />
      </g>
    </svg>
  );
};
export const ConnectorIcon = ({
  size = 16,
  className = defaultTailwindCSS,
}: IconProps) => {
  return (
    <svg
      style={{ width: `${size}px`, height: `${size}px` }}
      className={`w-[${size}px] h-[${size}px] ` + className}
      xmlns="http://www.w3.org/2000/svg"
      width="200"
      height="200"
      viewBox="0 0 16 16"
    >
      <path
        fill="currentColor"
        fillRule="evenodd"
        d="M4.5 13a3.5 3.5 0 0 1-1.41-6.705a3.5 3.5 0 0 1 6.63-2.171a2.5 2.5 0 0 1 3.197 3.018A3.001 3.001 0 0 1 12 13zm.72-5.03a.75.75 0 0 0 1.06 1.06l.97-.97v2.69a.75.75 0 0 0 1.5 0V8.06l.97.97a.75.75 0 1 0 1.06-1.06L8.53 5.72a.75.75 0 0 0-1.06 0z"
        clipRule="evenodd"
      />
    </svg>
  );
};
export const ConnectorIconSkeleton = ({
  size = 16,
  className = defaultTailwindCSS,
}: IconProps) => {
  return (
    <svg
      style={{ width: `${size}px`, height: `${size}px` }}
      className={`w-[${size}px] h-[${size}px] ` + className}
      xmlns="http://www.w3.org/2000/svg"
      width="200"
      height="200"
      viewBox="0 0 24 24"
    >
      <path
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.5"
        d="M12 16.5V9.75m0 0l3 3m-3-3l-3 3M6.75 19.5a4.5 4.5 0 0 1-1.41-8.775a5.25 5.25 0 0 1 10.233-2.33a3 3 0 0 1 3.758 3.848A3.752 3.752 0 0 1 18 19.5H6.75Z"
      />
    </svg>
  );
};
export const CopyIcon = createIcon(FiCopy);
export const CopyMessageIcon = ({
  size = 16,
  className = defaultTailwindCSS,
}: IconProps) => {
  return (
    <svg
      style={{ width: `${size}px`, height: `${size}px` }}
      className={`w-[${size}px] h-[${size}px] ` + className}
      xmlns="http://www.w3.org/2000/svg"
      width="200"
      height="200"
      viewBox="0 0 24 24"
    >
      <g
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.5"
      >
        <path d="M18.327 7.286h-8.044a1.932 1.932 0 0 0-1.925 1.938v10.088c0 1.07.862 1.938 1.925 1.938h8.044a1.932 1.932 0 0 0 1.925-1.938V9.224c0-1.07-.862-1.938-1.925-1.938" />
        <path d="M15.642 7.286V4.688c0-.514-.203-1.007-.564-1.37a1.918 1.918 0 0 0-1.361-.568H5.673c-.51 0-1 .204-1.36.568a1.945 1.945 0 0 0-.565 1.37v10.088c0 .514.203 1.007.564 1.37c.361.364.85.568 1.361.568h2.685" />
      </g>
    </svg>
  );
};
export const CpuIcon = ({
  size = 16,
  className = defaultTailwindCSS,
}: IconProps) => {
  return (
    <svg
      style={{ width: `${size}px`, height: `${size}px` }}
      className={`w-[${size}px] h-[${size}px] ` + className}
      xmlns="http://www.w3.org/2000/svg"
      width="200"
      height="200"
      viewBox="0 0 24 24"
    >
      <g fill="currentColor">
        <path d="M16.5 7.5h-9v9h9v-9Z" />
        <path
          fillRule="evenodd"
          d="M8.25 2.25A.75.75 0 0 1 9 3v.75h2.25V3a.75.75 0 0 1 1.5 0v.75H15V3a.75.75 0 0 1 1.5 0v.75h.75a3 3 0 0 1 3 3v.75H21A.75.75 0 0 1 21 9h-.75v2.25H21a.75.75 0 0 1 0 1.5h-.75V15H21a.75.75 0 0 1 0 1.5h-.75v.75a3 3 0 0 1-3 3h-.75V21a.75.75 0 0 1-1.5 0v-.75h-2.25V21a.75.75 0 0 1-1.5 0v-.75H9V21a.75.75 0 0 1-1.5 0v-.75h-.75a3 3 0 0 1-3-3v-.75H3A.75.75 0 0 1 3 15h.75v-2.25H3a.75.75 0 0 1 0-1.5h.75V9H3a.75.75 0 0 1 0-1.5h.75v-.75a3 3 0 0 1 3-3h.75V3a.75.75 0 0 1 .75-.75ZM6 6.75A.75.75 0 0 1 6.75 6h10.5a.75.75 0 0 1 .75.75v10.5a.75.75 0 0 1-.75.75H6.75a.75.75 0 0 1-.75-.75V6.75Z"
          clipRule="evenodd"
        />
      </g>
    </svg>
  );
};
export const CpuIconSkeleton = ({
  size = 16,
  className = defaultTailwindCSS,
}: IconProps) => {
  return (
    <svg
      style={{ width: `${size}px`, height: `${size}px` }}
      className={`w-[${size}px] h-[${size}px] ` + className}
      xmlns="http://www.w3.org/2000/svg"
      width="200"
      height="200"
      viewBox="0 0 24 24"
    >
      <path
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.5"
        d="M8.25 3v1.5M4.5 8.25H3m18 0h-1.5M4.5 12H3m18 0h-1.5m-15 3.75H3m18 0h-1.5M8.25 19.5V21M12 3v1.5m0 15V21m3.75-18v1.5m0 15V21m-9-1.5h10.5a2.25 2.25 0 0 0 2.25-2.25V6.75a2.25 2.25 0 0 0-2.25-2.25H6.75A2.25 2.25 0 0 0 4.5 6.75v10.5a2.25 2.25 0 0 0 2.25 2.25Zm.75-12h9v9h-9v-9Z"
      />
    </svg>
  );
};
export const DatabaseIcon = ({
  size = 16,
  className = defaultTailwindCSS,
}: IconProps) => {
  return (
    <svg
      style={{ width: `${size}px`, height: `${size}px` }}
      className={`w-[${size}px] h-[${size}px] ` + className}
      xmlns="http://www.w3.org/2000/svg"
      width="200"
      height="200"
      viewBox="0 0 14 14"
    >
      <path
        fill="currentColor"
        fillRule="evenodd"
        d="M.552 2.278c0-.155.077-.368.357-.63c.28-.262.722-.527 1.319-.762C3.418.416 5.105.112 7 .112c1.895 0 3.582.304 4.772.774c.597.235 1.038.5 1.32.762c.28.262.356.475.356.63c0 .155-.077.368-.357.63c-.28.261-.722.526-1.319.762c-1.19.47-2.877.774-4.772.774c-1.895 0-3.582-.304-4.772-.774c-.597-.236-1.038-.5-1.32-.763c-.28-.261-.356-.474-.356-.63Zm12.96 1.89a6.317 6.317 0 0 1-1.281.665c-1.37.54-3.22.86-5.231.86c-2.012 0-3.861-.32-5.231-.86a6.315 6.315 0 0 1-1.281-.666v3.178c.056.085.135.178.246.279c.29.263.745.53 1.36.766c1.224.471 2.959.776 4.906.776c1.947 0 3.682-.305 4.907-.776c.614-.237 1.069-.503 1.359-.766c.11-.101.19-.194.246-.28zM.488 11.208V8.993c.341.213.732.4 1.156.564c1.402.539 3.295.859 5.356.859c2.06 0 3.954-.32 5.356-.86a6.821 6.821 0 0 0 1.156-.563v2.216C13.512 12.749 10.597 14 7 14C3.403 14 .488 12.75.488 11.209Z"
        clipRule="evenodd"
      />
    </svg>
  );
};
export const DatabaseIconSkeleton = ({
  size = 16,
  className = defaultTailwindCSS,
}: IconProps) => {
  return (
    <svg
      style={{ width: `${size}px`, height: `${size}px` }}
      className={`w-[${size}px] h-[${size}px] ` + className}
      xmlns="http://www.w3.org/2000/svg"
      width="200"
      height="200"
      viewBox="0 0 24 24"
    >
      <g fill="none" stroke="currentColor" strokeWidth="1.5">
        <path strokeLinecap="round" d="M4 18V6m16 0v12" />
        <path d="M12 10c4.418 0 8-1.79 8-4s-3.582-4-8-4s-8 1.79-8 4s3.582 4 8 4Zm8 2c0 2.21-3.582 4-8 4s-8-1.79-8-4m16 6c0 2.21-3.582 4-8 4s-8-1.79-8-4" />
      </g>
    </svg>
  );
};
export const DexpandTwoIcon = ({
  size = 16,
  className = defaultTailwindCSS,
}: IconProps) => {
  return (
    <svg
      style={{ width: `${size}px`, height: `${size}px` }}
      className={`w-[${size}px] h-[${size}px] ` + className}
      xmlns="http://www.w3.org/2000/svg"
      width="200"
      height="200"
      viewBox="0 0 14 14"
    >
      <path
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        d="m.5 13.5l5-5m-4 0h4v4m8-12l-5 5m4 0h-4v-4"
      />
    </svg>
  );
};
export const DisableIcon = ({
  size = 16,
  className = defaultTailwindCSS,
}: IconProps) => {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      fill="none"
      style={{ width: `${size}px`, height: `${size}px` }}
      className={`w-[${size}px] h-[${size}px] ` + className}
    >
      <g clipPath="url(#clip0_295_7943)">
        <path
          d="M3.28659 3.28665L12.7133 12.7133M14.6666 7.99998C14.6666 11.6819 11.6818 14.6666 7.99992 14.6666C4.31802 14.6666 1.33325 11.6819 1.33325 7.99998C1.33325 4.31808 4.31802 1.33331 7.99992 1.33331C11.6818 1.33331 14.6666 4.31808 14.6666 7.99998Z"
          stroke="currentColor"
          strokeOpacity="0.4"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </g>
      <defs>
        <clipPath id="clip0_295_7943">
          <rect width="16" height="16" fill="white" />
        </clipPath>
      </defs>
    </svg>
  );
};
export const DislikeFeedback = ({
  size = 16,
  className = defaultTailwindCSS,
}: IconProps) => {
  return (
    <svg
      style={{ width: `${size}px`, height: `${size}px` }}
      className={`w-[${size}px] h-[${size}px] ` + className}
      xmlns="http://www.w3.org/2000/svg"
      width="200"
      height="200"
      viewBox="0 0 24 24"
    >
      <g
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.5"
      >
        <path d="M5.75 2.75H4.568c-.98 0-1.775.795-1.775 1.776v8.284c0 .98.795 1.775 1.775 1.775h1.184c.98 0 1.775-.794 1.775-1.775V4.526c0-.98-.795-1.776-1.775-1.776" />
        <path d="m21.16 11.757l-1.42-7.101a2.368 2.368 0 0 0-2.367-1.906h-7.48a2.367 2.367 0 0 0-2.367 2.367v7.101a3.231 3.231 0 0 0 1.184 2.367l.982 5.918a.887.887 0 0 0 1.278.65l1.1-.543a3.551 3.551 0 0 0 1.87-4.048l-.496-1.965h5.396a2.368 2.368 0 0 0 2.32-2.84" />
      </g>
    </svg>
  );
};
export const DislikeFeedbackIcon = ({
  size = 16,
  className = defaultTailwindCSS,
}: IconProps) => {
  return (
    <svg
      style={{ width: `${size}px`, height: `${size}px` }}
      className={`w-[${size}px] h-[${size}px] ` + className}
      xmlns="http://www.w3.org/2000/svg"
      width="200"
      height="200"
      viewBox="0 0 24 24"
    >
      <g
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.5"
      >
        <path d="M5.75 2.75H4.568c-.98 0-1.775.795-1.775 1.776v8.284c0 .98.795 1.775 1.775 1.775h1.184c.98 0 1.775-.794 1.775-1.775V4.526c0-.98-.795-1.776-1.775-1.776" />
        <path d="m21.16 11.757l-1.42-7.101a2.368 2.368 0 0 0-2.367-1.906h-7.48a2.367 2.367 0 0 0-2.367 2.367v7.101a3.231 3.231 0 0 0 1.184 2.367l.982 5.918a.887.887 0 0 0 1.278.65l1.1-.543a3.551 3.551 0 0 0 1.87-4.048l-.496-1.965h5.396a2.368 2.368 0 0 0 2.32-2.84" />
      </g>
    </svg>
  );
};
export const DocumentIcon2 = ({
  size = 16,
  className = defaultTailwindCSS,
}: IconProps) => {
  return (
    <svg
      style={{ width: `${size}px`, height: `${size}px` }}
      className={`w-[${size}px] h-[${size}px] ` + className}
      xmlns="http://www.w3.org/2000/svg"
      width="200"
      height="200"
      viewBox="0 0 24 24"
    >
      <path
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.5"
        d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z"
      />
    </svg>
  );
};
export const DocumentSetIcon = ({
  size = 16,
  className = defaultTailwindCSS,
}: IconProps) => {
  return (
    <svg
      style={{ width: `${size}px`, height: `${size}px` }}
      className={`w-[${size}px] h-[${size}px] ` + className}
      xmlns="http://www.w3.org/2000/svg"
      width="200"
      height="200"
      viewBox="0 0 24 24"
    >
      <path
        fill="currentColor"
        d="M22 9.885v7.7a3.85 3.85 0 0 1-2.373 3.542a3.8 3.8 0 0 1-1.467.288H5.83A3.82 3.82 0 0 1 2 17.585V6.425a3.82 3.82 0 0 1 3.83-3.84h3.08a3.87 3.87 0 0 1 3.2 1.71l.87 1.33a1 1 0 0 0 .36.32a.94.94 0 0 0 .47.12h4.35a3.79 3.79 0 0 1 2.71 1.11A3.85 3.85 0 0 1 22 9.885"
      />
    </svg>
  );
};
export const DocumentSetIconSkeleton = ({
  size = 16,
  className = defaultTailwindCSS,
}: IconProps) => {
  return (
    <svg
      style={{ width: `${size}px`, height: `${size}px` }}
      className={`w-[${size}px] h-[${size}px] ` + className}
      xmlns="http://www.w3.org/2000/svg"
      width="200"
      height="200"
      viewBox="0 0 24 24"
    >
      <path
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.5"
        d="M21.25 9.883v7.698a3.083 3.083 0 0 1-3.083 3.083H5.833a3.083 3.083 0 0 1-3.083-3.083V6.419a3.083 3.083 0 0 1 3.083-3.083h3.084a3.083 3.083 0 0 1 2.57 1.377l.873 1.326a1.748 1.748 0 0 0 1.449.77h4.358a3.084 3.084 0 0 1 3.083 3.074"
      />
    </svg>
  );
};
export const DownloadCSVIcon = ({
  size = 16,
  className = defaultTailwindCSS,
}: IconProps) => {
  return (
    <svg
      style={{ width: `${size}px`, height: `${size}px` }}
      className={`w-[${size}px] h-[${size}px] ` + className}
      xmlns="http://www.w3.org/2000/svg"
      width="200"
      height="200"
      viewBox="0 0 14 14"
    >
      <path
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M.5 10.5v1a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2v-1M4 6l3 3.5L10 6M7 9.5v-9"
      />
    </svg>
  );
};
export const EditIcon = createIcon(FiEdit2);
export const EmailIcon = createIcon(FiMail);

//  COMPANY LOGOS
export const EmbeddingIcon = ({
  size = 16,
  className = defaultTailwindCSS,
}: IconProps) => {
  return (
    <svg
      style={{ width: `${size}px`, height: `${size}px` }}
      className={`w-[${size}px] h-[${size}px] ` + className}
      xmlns="http://www.w3.org/2000/svg"
      width="200"
      height="200"
      viewBox="0 0 24 24"
    >
      <path
        fill="currentColor"
        fillRule="evenodd"
        d="M2.25 5.25a3 3 0 0 1 3-3h13.5a3 3 0 0 1 3 3V15a3 3 0 0 1-3 3h-3v.257c0 .597.237 1.17.659 1.591l.621.622a.75.75 0 0 1-.53 1.28h-9a.75.75 0 0 1-.53-1.28l.621-.622a2.25 2.25 0 0 0 .659-1.59V18h-3a3 3 0 0 1-3-3V5.25Zm1.5 0v7.5a1.5 1.5 0 0 0 1.5 1.5h13.5a1.5 1.5 0 0 0 1.5-1.5v-7.5a1.5 1.5 0 0 0-1.5-1.5H5.25a1.5 1.5 0 0 0-1.5 1.5Z"
        clipRule="evenodd"
      />
    </svg>
  );
};
export const EmbeddingIconSkeleton = ({
  size = 16,
  className = defaultTailwindCSS,
}: IconProps) => {
  return (
    <svg
      style={{ width: `${size}px`, height: `${size}px` }}
      className={`w-[${size}px] h-[${size}px] ` + className}
      xmlns="http://www.w3.org/2000/svg"
      width="200"
      height="200"
      viewBox="0 0 24 24"
    >
      <path
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.5"
        d="M9 17.25v1.007a3 3 0 0 1-.879 2.122L7.5 21h9l-.621-.621A3 3 0 0 1 15 18.257V17.25m6-12V15a2.25 2.25 0 0 1-2.25 2.25H5.25A2.25 2.25 0 0 1 3 15V5.25m18 0A2.25 2.25 0 0 0 18.75 3H5.25A2.25 2.25 0 0 0 3 5.25m18 0V12a2.25 2.25 0 0 1-2.25 2.25H5.25A2.25 2.25 0 0 1 3 12V5.25"
      />
    </svg>
  );
};
export const ExpandTwoIcon = ({
  size = 16,
  className = defaultTailwindCSS,
}: IconProps) => {
  return (
    <svg
      style={{ width: `${size}px`, height: `${size}px` }}
      className={`w-[${size}px] h-[${size}px] ` + className}
      xmlns="http://www.w3.org/2000/svg"
      width="200"
      height="200"
      viewBox="0 0 14 14"
    >
      <path
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        d="m8.5 5.5l5-5m-4 0h4v4m-8 4l-5 5m4 0h-4v-4"
      />
    </svg>
  );
};
export const ExtendIcon = ({
  size = 16,
  className = defaultTailwindCSS,
}: IconProps) => {
  return (
    <svg
      style={{ width: `${size}px`, height: `${size}px` }}
      className={`w-[${size}px] h-[${size}px] ` + className}
      xmlns="http://www.w3.org/2000/svg"
      width="200"
      height="200"
      viewBox="0 0 24 24"
    >
      <path
        fill="currentColor"
        d="M16.75 11.989a1.82 1.82 0 0 1-.57 1.36l-6.82 6.1a1.27 1.27 0 0 1-.65.31h-.19a1.3 1.3 0 0 1-.52-.1a1.23 1.23 0 0 1-.54-.47a1.19 1.19 0 0 1-.21-.68v-13a1.2 1.2 0 0 1 .21-.69a1.23 1.23 0 0 1 1.25-.56c.24.039.464.143.65.3l6.76 6.09c.19.162.344.363.45.59c.114.234.175.49.18.75"
      />
    </svg>
  );
};
export const FileIcon = createIcon(FiFile);
export const FileIcon2 = ({
  size = 16,
  className = defaultTailwindCSSBlue,
}: IconProps) => {
  return (
    <svg
      style={{ width: `${size}px`, height: `${size}px` }}
      className={`w-[${size}px] h-[${size}px] ` + className}
      xmlns="http://www.w3.org/2000/svg"
      width="200"
      height="200"
      viewBox="0 0 14 14"
    >
      <path
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12.5 12.5a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1v-11a1 1 0 0 1 1-1h5l5 5Zm-8-8h2m-2 3h5m-5 3h5"
      />
    </svg>
  );
};
export const FileOptionIcon = ({
  size = 24,
  className = defaultTailwindCSS,
}: IconProps) => {
  return (
    <svg
      style={{ width: `${size}px`, height: `${size}px` }}
      className={`w-[${size}px] h-[${size}px] ` + className}
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M20.6801 7.02928C20.458 6.5654 20.1451 6.15072 19.76 5.80973L16.76 3.09074C16.0939 2.47491 15.2435 2.09552 14.3401 2.01115C14.2776 1.99628 14.2125 1.99628 14.15 2.01115H8.21008C7.54764 1.98307 6.88617 2.08698 6.26428 2.31683C5.64239 2.54667 5.07249 2.89785 4.58765 3.34995C4.10281 3.80205 3.71274 4.34605 3.44019 4.95025C3.16763 5.55445 3.01797 6.20679 3 6.86934V17.1655C3.03538 18.1647 3.36978 19.1303 3.95984 19.9375C4.5499 20.7448 5.36855 21.3566 6.31006 21.6939C6.92247 21.9253 7.57613 22.0274 8.22998 21.9937H15.79C16.4525 22.0218 17.1138 21.9179 17.7357 21.6881C18.3576 21.4582 18.9276 21.107 19.4125 20.6549C19.8973 20.2028 20.2874 19.6588 20.5599 19.0546C20.8325 18.4504 20.982 17.7981 21 17.1355V8.56872C21.0034 8.03873 20.8944 7.51404 20.6801 7.02928ZM16.0601 7.41915C15.9174 7.42047 15.7759 7.39353 15.6437 7.33986C15.5115 7.2862 15.3913 7.20687 15.2899 7.10649C15.1886 7.00611 15.1081 6.88664 15.0532 6.755C14.9983 6.62336 14.97 6.48215 14.97 6.33953V3.69052C15.63 3.85046 18.2 6.48947 18.76 6.92931C18.9256 7.06878 19.0675 7.23423 19.1801 7.41915H16.0601Z"
        fill="currentColor"
      />
    </svg>
  );
};
export const FileUploadIcon = ({ size = 16 }: IconProps) => {
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <g clipPath="url(#clip0_16_2625)">
        <path
          d="M7.99999 5.33333V10.6667M5.33333 7.99999H10.6667M14.6667 7.99999C14.6667 11.6819 11.6819 14.6667 7.99999 14.6667C4.3181 14.6667 1.33333 11.6819 1.33333 7.99999C1.33333 4.3181 4.3181 1.33333 7.99999 1.33333C11.6819 1.33333 14.6667 4.3181 14.6667 7.99999Z"
          stroke="currentColor"
          strokeOpacity="0.8"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </g>
      <defs>
        <clipPath id="clip0_16_2625">
          <rect width="16" height="16" fill="white" />
        </clipPath>
      </defs>
    </svg>
  );
};
export const FilledLikeIcon = ({
  size = 16,
  className = defaultTailwindCSS,
}: IconProps) => {
  return (
    <svg
      style={{ width: `${size}px`, height: `${size}px` }}
      className={`w-[${size}px] h-[${size}px] ` + className}
      xmlns="http://www.w3.org/2000/svg"
      width="200"
      height="200"
      viewBox="0 0 14 14"
    >
      <path
        fill="currentColor"
        fillRule="evenodd"
        d="M4.41 12.961a2.5 2.5 0 0 0 1.076.244h5.346a2.5 2.5 0 0 0 2.47-2.114l.626-4.003a2 2 0 0 0-1.976-2.31H8.67V2.422a1.625 1.625 0 0 0-3.044-.794l-2.077 3.71a1.5 1.5 0 0 0-.191.733v5.442a1.5 1.5 0 0 0 .854 1.354l.2.095Zm-3.366-7.44a.996.996 0 0 0-.997.996v5.112a.997.997 0 0 0 .997.997h.496a.5.5 0 0 0 .5-.5V6.02a.5.5 0 0 0-.5-.5h-.496Z"
        clipRule="evenodd"
      />
    </svg>
  );
};
export const FilterIcon = ({ size = 16 }: IconProps) => {
  return (
    <svg
      width={size}
      height={size - 2}
      viewBox={`0 0 ${size} ${size - 2}`}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M14.6667 1H1.33334L6.66668 7.30667V11.6667L9.33334 13V7.30667L14.6667 1Z"
        stroke="currentColor"
        strokeOpacity="0.8"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
};
export const FolderMoveIcon = ({
  size = 24,
  className = defaultTailwindCSS,
}: IconProps) => {
  return (
    <svg
      style={{ width: `${size}px`, height: `${size}px` }}
      className={` w-[${size}px] h-[${size}px] ` + className}
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="10"></circle>
      <polyline points="12 8 8 12 12 16"></polyline>
      <line x1="16" y1="12" x2="8" y2="12"></line>
    </svg>
  );
};
export const GearIcon = ({
  size = 16,
  className = defaultTailwindCSS,
}: IconProps) => {
  return <Gear size={size} className={className} />;
};
export const GeneralAssistantIcon = ({
  size = 24,
  className = defaultTailwindCSS,
}: IconProps) => {
  return (
    <svg
      style={{ width: `${size}px`, height: `${size}px` }}
      className={`w-[${size}px] h-[${size}px] ` + className}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect
        x="0.65"
        y="0.65"
        width="22.7"
        height="22.7"
        rx="11.35"
        stroke="currentColor"
        strokeWidth="1.3"
      />
      <path
        d="M8.06264 10.3125C8.06253 9.66355 8.22283 9.02463 8.52926 8.45258C8.83569 7.88054 9.27876 7.3931 9.81906 7.03363C10.3594 6.67415 10.9801 6.4538 11.6261 6.39216C12.2722 6.33052 12.9234 6.42951 13.5219 6.68032C14.1204 6.93113 14.6477 7.32598 15.0568 7.82976C15.4659 8.33353 15.7441 8.93061 15.8667 9.56787C15.9893 10.2051 15.9525 10.8628 15.7596 11.4824C15.5667 12.102 15.2236 12.6644 14.7609 13.1194C14.5438 13.3331 14.3525 13.611 14.2603 13.9474L13.8721 15.375H10.1281L9.73889 13.9474C9.64847 13.6321 9.47612 13.3464 9.23939 13.1194C8.86681 12.753 8.57088 12.3161 8.36885 11.8342C8.16682 11.3523 8.06272 10.835 8.06264 10.3125ZM10.4364 16.5H13.5639L13.3715 17.211C13.3389 17.3301 13.2681 17.4351 13.1699 17.5099C13.0717 17.5847 12.9516 17.6252 12.8281 17.625H11.1721C11.0487 17.6252 10.9286 17.5847 10.8304 17.5099C10.7322 17.4351 10.6614 17.3301 10.6288 17.211L10.4364 16.5ZM12.0001 5.25C10.9954 5.25017 10.0134 5.5493 9.17925 6.10932C8.34506 6.66934 7.69637 7.46491 7.31577 8.39477C6.93516 9.32463 6.83985 10.3467 7.04197 11.3309C7.24409 12.3151 7.7345 13.2169 8.45076 13.9215C8.54562 14.0093 8.61549 14.1207 8.65326 14.2444L9.54426 17.5069C9.64173 17.8639 9.85387 18.179 10.148 18.4037C10.4422 18.6283 10.802 18.75 11.1721 18.75H12.8281C13.1983 18.75 13.5581 18.6283 13.8523 18.4037C14.1464 18.179 14.3585 17.8639 14.456 17.5069L15.3459 14.2444C15.384 14.1206 15.4542 14.0092 15.5495 13.9215C16.2658 13.2169 16.7562 12.3151 16.9583 11.3309C17.1604 10.3467 17.0651 9.32463 16.6845 8.39477C16.3039 7.46491 15.6552 6.66934 14.821 6.10932C13.9868 5.5493 13.0049 5.25017 12.0001 5.25Z"
        fill="currentColor"
      />
    </svg>
  );
};
export const GlobeIcon = createIcon(FiGlobe);
export const GlobeIcon2 = ({
  size = 16,
  className = defaultTailwindCSS,
}: IconProps) => {
  return (
    <svg
      style={{ width: `${size}px`, height: `${size}px` }}
      className={`w-[${size}px] h-[${size}px] ` + className}
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 14 14"
    >
      <g stroke="#3B82F6" strokeLinecap="round" strokeLinejoin="round">
        <circle fill="transparent" cx="7" cy="7" r="6.5" />
        <path
          fill="transparent"
          d="M.5 7h13m-4 0A11.22 11.22 0 0 1 7 13.5A11.22 11.22 0 0 1 4.5 7A11.22 11.22 0 0 1 7 .5A11.22 11.22 0 0 1 9.5 7Z"
        />
      </g>
    </svg>
  );
};
export const GroupsIcon = ({
  size = 16,
  className = defaultTailwindCSS,
}: IconProps) => {
  return (
    <svg
      style={{ width: `${size}px`, height: `${size}px` }}
      className={`w-[${size}px] h-[${size}px] ` + className}
      xmlns="http://www.w3.org/2000/svg"
      width="200"
      height="200"
      viewBox="0 0 16 16"
    >
      <path
        fill="currentColor"
        d="M8.5 4.5a2.5 2.5 0 1 1-5 0a2.5 2.5 0 0 1 5 0m2.4 7.506c.11.542-.348.994-.9.994H2c-.553 0-1.01-.452-.902-.994a5.002 5.002 0 0 1 9.803 0M14.002 12h-1.59a2.556 2.556 0 0 0-.04-.29a6.476 6.476 0 0 0-1.167-2.603a3.002 3.002 0 0 1 3.633 1.911c.18.522-.283.982-.836.982M12 8a2 2 0 1 0 0-4a2 2 0 0 0 0 4"
      />
    </svg>
  );
};
export const GroupsIconSkeleton = ({
  size = 16,
  className = defaultTailwindCSS,
}: IconProps) => {
  return (
    <svg
      style={{ width: `${size}px`, height: `${size}px` }}
      className={`w-[${size}px] h-[${size}px] ` + className}
      xmlns="http://www.w3.org/2000/svg"
      width="200"
      height="200"
      viewBox="0 0 24 24"
    >
      <g fill="none" stroke="currentColor" strokeWidth="1.5">
        <circle cx="9" cy="6" r="4" />
        <path strokeLinecap="round" d="M15 9a3 3 0 1 0 0-6" />
        <ellipse cx="9" cy="17" rx="7" ry="4" />
        <path
          strokeLinecap="round"
          d="M18 14c1.754.385 3 1.359 3 2.5c0 1.03-1.014 1.923-2.5 2.37"
        />
      </g>
    </svg>
  );
};
export const ImageIcon = ({
  size = 16,
  className = defaultTailwindCSS,
}: IconProps) => {
  return (
    <svg
      style={{ width: `${size}px`, height: `${size}px` }}
      className={`w-[${size}px] h-[${size}px] ` + className}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
        d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
      />
    </svg>
  );
};
export const InfoIcon = createIcon(FiInfo);
export const KeyIcon = ({
  size = 16,
  className = defaultTailwindCSS,
}: IconProps) => {
  return (
    <svg
      style={{ width: `${size}px`, height: `${size}px` }}
      className={`w-[${size}px] h-[${size}px] ` + className}
      xmlns="http://www.w3.org/2000/svg"
      width="200"
      height="200"
      viewBox="0 0 20 20"
    >
      <path
        fill="currentColor"
        fillRule="evenodd"
        d="M8 7a5 5 0 1 1 3.61 4.804l-1.903 1.903A1 1 0 0 1 9 14H8v1a1 1 0 0 1-1 1H6v1a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1v-2a1 1 0 0 1 .293-.707L8.196 8.39A5.002 5.002 0 0 1 8 7Zm5-3a.75.75 0 0 0 0 1.5A1.5 1.5 0 0 1 14.5 7A.75.75 0 0 0 16 7a3 3 0 0 0-3-3Z"
        clipRule="evenodd"
      />
    </svg>
  );
};
export const KeyIconSkeleton = ({
  size = 16,
  className = defaultTailwindCSS,
}: IconProps) => {
  return (
    <svg
      style={{ width: `${size}px`, height: `${size}px` }}
      className={`w-[${size}px] h-[${size}px] ` + className}
      xmlns="http://www.w3.org/2000/svg"
      width="200"
      height="200"
      viewBox="0 0 24 24"
    >
      <path
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.5"
        d="M15.75 5.25a3 3 0 0 1 3 3m3 0a6 6 0 0 1-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1 1 21.75 8.25Z"
      />
    </svg>
  );
};
export const KnowledgeGroupIcon = ({
  size = 24,
  className = defaultTailwindCSS,
}: IconProps) => {
  return (
    <svg
      style={{ width: `${size}px`, height: `${size}px` }}
      className={`w-[${size}px] h-[${size}px] ` + className}
      xmlns="http://www.w3.org/2000/svg"
      width="200"
      height="200"
      viewBox="0 0 24 24"
    >
      <path
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.5"
        d="M21.25 9.883v7.698a3.083 3.083 0 0 1-3.083 3.083H5.833a3.083 3.083 0 0 1-3.083-3.083V6.419a3.083 3.083 0 0 1 3.083-3.083h3.084a3.083 3.083 0 0 1 2.57 1.377l.873 1.326a1.748 1.748 0 0 0 1.449.77h4.358a3.084 3.084 0 0 1 3.083 3.074"
      />
    </svg>
  );
};
export const LeftToLineIcon = ({
  size = 16,
  className = defaultTailwindCSS,
}: IconProps) => {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="200"
      height="200"
      viewBox="0 0 24 24"
      style={{ width: `${size}px`, height: `${size}px` }}
      className={`w-[${size}px] h-[${size}px] ` + className}
    >
      <path
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
        d="M3 19V5m10 1l-6 6l6 6m-6-6h14"
      />
    </svg>
  );
};
export const LightBulbIcon = ({
  size,
  className = defaultTailwindCSS,
}: IconProps) => {
  return (
    <svg
      style={{ width: `${size}px`, height: `${size}px` }}
      className={`w-[${size}px] h-[${size}px] ` + className}
      xmlns="http://www.w3.org/2000/svg"
      width="200"
      height="200"
      viewBox="0 0 24 24"
    >
      <path
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.5"
        d="M12 18v-5.25m0 0a6.01 6.01 0 0 0 1.5-.189m-1.5.189a6.01 6.01 0 0 1-1.5-.189m3.75 7.478a12.06 12.06 0 0 1-4.5 0m3.75 2.383a14.406 14.406 0 0 1-3 0M14.25 18v-.192c0-.983.658-1.823 1.508-2.316a7.5 7.5 0 1 0-7.517 0c.85.493 1.509 1.333 1.509 2.316V18"
      />
    </svg>
  );
};
export const LightSettingsIcon = ({
  size = 16,
  className = defaultTailwindCSS,
}: IconProps) => {
  return (
    <svg
      style={{ width: `${size}px`, height: `${size}px` }}
      className={`w-[${size}px] h-[${size}px] ` + className}
      xmlns="http://www.w3.org/2000/svg"
      width="200"
      height="200"
      viewBox="0 0 24 24"
    >
      <g
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.5"
      >
        <path d="M12.132 15.404a3.364 3.364 0 1 0 0-6.728a3.364 3.364 0 0 0 0 6.728" />
        <path d="M20.983 15.094a9.43 9.43 0 0 1-1.802 3.1l-2.124-.482a7.245 7.245 0 0 1-2.801 1.56l-.574 2.079a9.462 9.462 0 0 1-1.63.149a9.117 9.117 0 0 1-2.032-.23l-.609-2.146a7.475 7.475 0 0 1-2.457-1.493l-2.1.54a9.357 9.357 0 0 1-1.837-3.33l1.55-1.722a7.186 7.186 0 0 1 .069-2.652L3.107 8.872a9.356 9.356 0 0 1 2.067-3.353l2.17.54A7.68 7.68 0 0 1 9.319 4.91l.574-2.124a8.886 8.886 0 0 1 2.17-.287c.585 0 1.17.054 1.745.16l.551 2.113c.83.269 1.608.68 2.296 1.217l2.182-.563a9.368 9.368 0 0 1 2.043 3.1l-1.48 1.607a7.405 7.405 0 0 1 .068 3.364z" />
      </g>
    </svg>
  );
};
export const LikeFeedback = ({
  size = 16,
  className = defaultTailwindCSS,
}: IconProps) => {
  return (
    <svg
      style={{ width: `${size}px`, height: `${size}px` }}
      className={`w-[${size}px] h-[${size}px] ` + className}
      xmlns="http://www.w3.org/2000/svg"
      width="200"
      height="200"
      viewBox="0 0 24 24"
    >
      <g
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.5"
      >
        <path d="M5.75 9.415H4.568c-.98 0-1.775.794-1.775 1.775v8.284c0 .98.795 1.776 1.775 1.776h1.184c.98 0 1.775-.795 1.775-1.776V11.19c0-.98-.795-1.775-1.775-1.775" />
        <path d="m21.16 12.243l-1.42 7.101a2.367 2.367 0 0 1-2.367 1.906h-7.48a2.367 2.367 0 0 1-2.367-2.367v-7.101A3.231 3.231 0 0 1 8.71 9.415l.982-5.918a.888.888 0 0 1 1.278-.65l1.1.544a3.55 3.55 0 0 1 1.87 4.047l-.496 1.965h5.396a2.367 2.367 0 0 1 2.32 2.84" />
      </g>
    </svg>
  );
};
export const LikeFeedbackIcon = ({
  size = 16,
  className = defaultTailwindCSS,
}: IconProps) => {
  return (
    <svg
      style={{ width: `${size}px`, height: `${size}px` }}
      className={`w-[${size}px] h-[${size}px] ` + className}
      xmlns="http://www.w3.org/2000/svg"
      width="200"
      height="200"
      viewBox="0 0 24 24"
    >
      <g
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.5"
      >
        <path d="M5.75 9.415H4.568c-.98 0-1.775.794-1.775 1.775v8.284c0 .98.795 1.776 1.775 1.776h1.184c.98 0 1.775-.795 1.775-1.776V11.19c0-.98-.795-1.775-1.775-1.775" />
        <path d="m21.16 12.243l-1.42 7.101a2.367 2.367 0 0 1-2.367 1.906h-7.48a2.367 2.367 0 0 1-2.367-2.367v-7.101A3.231 3.231 0 0 1 8.71 9.415l.982-5.918a.888.888 0 0 1 1.278-.65l1.1.544a3.55 3.55 0 0 1 1.87 4.047l-.496 1.965h5.396a2.367 2.367 0 0 1 2.32 2.84" />
      </g>
    </svg>
  );
};
export const LinkBreakIcon = ({
  size = 16,
  className = defaultTailwindCSS,
}: IconProps) => {
  return <LinkBreak size={size} className={className} />;
};
export const LinkIcon = ({
  size = 16,
  className = defaultTailwindCSS,
}: IconProps) => {
  return <Link size={size} className={className} />;
};
export const MacIcon = ({
  size = 16,
  className = "my-auto flex flex-shrink-0 ",
}: IconProps) => {
  return (
    <svg
      style={{ width: `${size}px`, height: `${size}px` }}
      className={`w-[${size}px] h-[${size}px] ` + className}
      xmlns="http://www.w3.org/2000/svg"
      width="200"
      height="200"
      viewBox="0 0 24 24"
    >
      <path
        fill="currentColor"
        d="M6.5 4.5a2 2 0 0 1 2 2v2h-2a2 2 0 1 1 0-4Zm4 4v-2a4 4 0 1 0-4 4h2v3h-2a4 4 0 1 0 4 4v-2h3v2a4 4 0 1 0 4-4h-2v-3h2a4 4 0 1 0-4-4v2h-3Zm0 2h3v3h-3v-3Zm5-2v-2a2 2 0 1 1 2 2h-2Zm0 7h2a2 2 0 1 1-2 2v-2Zm-7 0v2a2 2 0 1 1-2-2h2Z"
      />
    </svg>
  );
};
export const MagnifyingIcon = ({
  size = 16,
  className = defaultTailwindCSS,
}: IconProps) => {
  return (
    <svg
      style={{ width: `${size}px`, height: `${size}px` }}
      className={`w-[${size}px] h-[${size}px] ` + className}
      xmlns="http://www.w3.org/2000/svg"
      width="200"
      height="200"
      viewBox="0 0 16 16"
    >
      <path
        fill="currentColor"
        fillRule="evenodd"
        d="M9.965 11.026a5 5 0 1 1 1.06-1.06l2.755 2.754a.75.75 0 1 1-1.06 1.06zM10.5 7a3.5 3.5 0 1 1-7 0a3.5 3.5 0 0 1 7 0"
        clipRule="evenodd"
      />
    </svg>
  );
};
export const MinusIcon = ({
  size = 16,
  className = defaultTailwindCSS,
}: IconProps) => {
  return (
    <svg
      style={{ width: `${size}px`, height: `${size}px` }}
      className={`w-[${size}px] h-[${size}px] ` + className}
      xmlns="http://www.w3.org/2000/svg"
      width="200"
      height="200"
      viewBox="0 0 16 16"
    >
      <path
        fill="currentColor"
        d="M3.75 7.25a.75.75 0 0 0 0 1.5h8.5a.75.75 0 0 0 0-1.5z"
      />
    </svg>
  );
};
export const MoreActionsIcon = ({
  size = 16,
  className = defaultTailwindCSS,
}: IconProps) => {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      fill="none"
      style={{ width: `${size}px`, height: `${size}px` }}
      className={`w-[${size}px] h-[${size}px] ` + className}
    >
      <path
        d="M3.06 6.24449L5.12 4.12225L3.06 2.00001M11.5501 14L14 11.5501M14 11.5501L11.5501 9.10017M14 11.5501H9.75552M4.12224 9.09889L6.24448 10.3242V12.7747L4.12224 14L2 12.7747V10.3242L4.12224 9.09889ZM14 4.12225C14 5.29433 13.0498 6.24449 11.8778 6.24449C10.7057 6.24449 9.75552 5.29433 9.75552 4.12225C9.75552 2.95017 10.7057 2.00001 11.8778 2.00001C13.0498 2.00001 14 2.95017 14 4.12225Z"
        stroke="currentColor"
        strokeOpacity="0.4"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
};
export const NewChatIcon = ({
  size = 24,
  className = defaultTailwindCSS,
}: IconProps) => {
  return (
    <svg
      style={{ width: `${size}px`, height: `${size}px` }}
      className={`w-[${size}px] h-[${size}px] ` + className}
      viewBox="0 0 20 20"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M12.5 1.99982H6C3.79086 1.99982 2 3.79068 2 5.99982V13.9998C2 16.209 3.79086 17.9998 6 17.9998H14C16.2091 17.9998 18 16.209 18 13.9998V8.49982"
        stroke="currentColor"
        strokeLinecap="round"
      />
      <path
        d="M17.1471 5.13076C17.4492 4.82871 17.6189 4.41901 17.619 3.9918C17.6191 3.56458 17.4494 3.15484 17.1474 2.85271C16.8453 2.55058 16.4356 2.38082 16.0084 2.38077C15.5812 2.38071 15.1715 2.55037 14.8693 2.85242L11.0562 6.66651L7.24297 10.4806C7.1103 10.6129 7.01218 10.7758 6.95726 10.9549L6.20239 13.4418C6.18762 13.4912 6.18651 13.5437 6.19916 13.5937C6.21182 13.6437 6.23778 13.6894 6.27428 13.7258C6.31078 13.7623 6.35646 13.7881 6.40648 13.8007C6.45651 13.8133 6.509 13.8121 6.5584 13.7972L9.04585 13.0429C9.2248 12.9885 9.38766 12.891 9.52014 12.7589L17.1471 5.13076Z"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
};
export const NotebookIcon = ({
  size = 16,
  className = defaultTailwindCSS,
}: IconProps) => {
  return (
    <svg
      style={{ width: `${size}px`, height: `${size}px` }}
      className={`w-[${size}px] h-[${size}px] ` + className}
      xmlns="http://www.w3.org/2000/svg"
      width="200"
      height="200"
      viewBox="0 0 24 24"
    >
      <path
        fill="currentColor"
        d="M11.25 4.533A9.707 9.707 0 0 0 6 3a9.735 9.735 0 0 0-3.25.555a.75.75 0 0 0-.5.707v14.25a.75.75 0 0 0 1 .707A8.237 8.237 0 0 1 6 18.75c1.995 0 3.823.707 5.25 1.886V4.533Zm1.5 16.103A8.214 8.214 0 0 1 18 18.75c.966 0 1.89.166 2.75.47a.75.75 0 0 0 1-.708V4.262a.75.75 0 0 0-.5-.707A9.735 9.735 0 0 0 18 3a9.707 9.707 0 0 0-5.25 1.533v16.103Z"
      />
    </svg>
  );
};
export const NotebookIconSkeleton = ({
  size = 16,
  className = defaultTailwindCSS,
}: IconProps) => {
  return (
    <svg
      style={{ width: `${size}px`, height: `${size}px` }}
      className={`w-[${size}px] h-[${size}px] ` + className}
      xmlns="http://www.w3.org/2000/svg"
      width="200"
      height="200"
      viewBox="0 0 24 24"
    >
      <path
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.5"
        d="M12 6.042A8.967 8.967 0 0 0 6 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 0 1 6 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 0 1 6-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0 0 18 18a8.967 8.967 0 0 0-6 2.292m0-14.25v14.25"
      />
    </svg>
  );
};
export const OnyxIcon = ({
  size = 16,
  className = defaultTailwindCSS,
}: IconProps) => {
  return (
    <svg
      style={{ width: `${size}px`, height: `${size}px` }}
      className={`w-[${size}px] h-[${size}px] ` + className}
      viewBox="0 0 148 146"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
<path d="M0 0 C48.84 0 97.68 0 148 0 C148 48.18 148 96.36 148 146 C99.16 146 50.32 146 0 146 C0 97.82 0 49.64 0 0 Z " fill="#BE83FE" transform="translate(0,0)"/>
<path d="M0 0 C48.84 0 97.68 0 148 0 C148 48.18 148 96.36 148 146 C99.16 146 50.32 146 0 146 C0 97.82 0 49.64 0 0 Z M7.84375 10.31640625 C7.4003125 11.05761719 6.956875 11.79882812 6.5 12.5625 C5.80390625 13.67818359 5.80390625 13.67818359 5.09375 14.81640625 C3.25802685 18.4812964 2.87448497 21.72892074 2.87060547 25.80126953 C2.86750366 26.76250732 2.86440186 27.72374512 2.86120605 28.71411133 C2.86317993 29.75978271 2.86515381 30.8054541 2.8671875 31.8828125 C2.86577759 32.98568604 2.86436768 34.08855957 2.86291504 35.22485352 C2.86076449 38.85826734 2.86711405 42.49159485 2.875 46.125 C2.8765509 47.36231873 2.87810181 48.59963745 2.87969971 49.87445068 C2.9050984 67.20166158 3.02216465 84.52767185 3.31939697 101.85247803 C3.35631827 104.025485 3.39031817 106.19854366 3.42132568 108.37164307 C3.46625274 111.39647861 3.52401093 114.42078311 3.5859375 117.4453125 C3.59749878 118.33033447 3.60906006 119.21535645 3.62097168 120.12719727 C3.73369775 124.7921817 4.22095489 128.61168873 6 133 C6.66 133 7.32 133 8 133 C8.226875 133.5775 8.45375 134.155 8.6875 134.75 C10.36684391 137.62887527 12.22790829 139.17447619 15 141 C15.99 140.67 16.98 140.34 18 140 C17.05125 139.443125 16.1025 138.88625 15.125 138.3125 C11.91121213 135.93429698 11.04434882 134.75965574 10 131 C11.051875 132.1446875 11.051875 132.1446875 12.125 133.3125 C18.16096218 138.95481247 23.28800259 139.44160196 31.19287109 139.40405273 C32.20502182 139.41091599 33.21717255 139.41777924 34.25999451 139.42485046 C37.59795251 139.44311597 40.93544035 139.43928083 44.2734375 139.43359375 C46.59982455 139.43815599 48.92621025 139.44346169 51.25259399 139.44947815 C56.12645953 139.45840904 61.00016121 139.45598664 65.87402344 139.44604492 C72.11053668 139.4345615 78.34648319 139.45475783 84.58292198 139.48396206 C89.38715185 139.50233625 94.19124627 139.50202901 98.99550247 139.49632454 C101.29433613 139.49617144 103.59317905 139.50220608 105.89197922 139.51461601 C109.11112422 139.52954486 112.32922676 139.51883371 115.54833984 139.50170898 C116.49197891 139.51137695 117.43561798 139.52104492 118.40785217 139.53100586 C124.22885997 139.46638204 129.28361945 138.66527588 134 135 C134.33 134.01 134.66 133.02 135 132 C135.66 132 136.32 132 137 132 C140.44393223 126.51331199 140.43314514 121.85750006 140.40405273 115.59179688 C140.41091599 114.55692642 140.41777924 113.52205597 140.42485046 112.45582581 C140.4431156 109.0433267 140.43928161 105.63128739 140.43359375 102.21875 C140.43815529 99.84273123 140.44346078 97.46671377 140.44947815 95.09069824 C140.45840843 90.11428462 140.45598649 85.13803148 140.44604492 80.16162109 C140.43454872 73.78591143 140.45477775 67.41075508 140.48396206 61.0351181 C140.50231013 56.12974533 140.50203444 51.22450553 140.49632454 46.31910706 C140.49617119 43.96838097 140.50222658 41.61764595 140.51461601 39.26695251 C140.52949928 35.98034959 140.51886794 32.69477398 140.50170898 29.40820312 C140.51137695 28.43867203 140.52104492 27.46914093 140.53100586 26.4702301 C140.46900139 20.79639288 139.82349873 17.48045083 136 13 C129.91383844 7.31076202 124.72513923 4.5469554 116.37182617 4.58349609 C115.63082169 4.57491074 114.8898172 4.56632538 114.12635803 4.55747986 C111.68179722 4.53245093 109.23764608 4.52803542 106.79296875 4.5234375 C105.067803 4.50909367 103.34264853 4.49333072 101.61750793 4.47622681 C97.06511733 4.43437581 92.51279625 4.4094176 87.96026611 4.38873291 C80.75971527 4.35307014 73.5593326 4.29097 66.35895157 4.23096466 C63.74165993 4.21102277 61.12438084 4.19667959 58.50704956 4.18304443 C51.0459883 4.13547222 43.61521261 4.03097994 36.16650391 3.57910156 C34.44419304 3.47718002 34.44419304 3.47718002 32.68708801 3.37319946 C30.65049617 3.24004774 28.61518601 3.08382942 26.58280945 2.89706421 C18.91290047 2.38315767 13.13236706 4.63497524 7.84375 10.31640625 Z " fill="#B476FC" transform="translate(0,0)"/>
<path d="M0 0 C6.53388068 0.62227435 10.26281299 3.18384994 14.75 7.875 C19.08292666 13.89295369 19.3217237 19.53481831 19.4140625 26.6953125 C19.43365524 27.65625824 19.45324799 28.61720398 19.47343445 29.60726929 C19.53458795 32.77975925 19.58084821 35.95223058 19.625 39.125 C19.66034257 41.3417978 19.6957439 43.55859466 19.73120117 45.77539062 C19.82011275 51.6415109 19.89101784 57.50772842 19.95709229 63.37414551 C20.00012924 67.01092096 20.05080703 70.64752547 20.10302734 74.28417969 C20.18578314 80.21702248 20.24429123 86.14967143 20.28509521 92.08294678 C20.30324679 94.34623393 20.32794038 96.60947884 20.35943604 98.87261963 C20.40133133 102.05071051 20.41681946 105.22791734 20.42578125 108.40625 C20.44323898 109.33343842 20.46069672 110.26062683 20.47868347 111.21591187 C20.45387137 118.81623792 18.76340246 126.40540339 13.4375 132.125 C11 134 11 134 8 134 C8 134.66 8 135.32 8 136 C2.49561932 138.30220132 -2.50457027 138.28337388 -8.36401367 138.25878906 C-9.90891731 138.26404602 -9.90891731 138.26404602 -11.48503113 138.26940918 C-14.8794128 138.27819113 -18.27358507 138.27239104 -21.66796875 138.265625 C-24.02875305 138.26697235 -26.38953708 138.26891347 -28.75032043 138.27142334 C-33.69221647 138.27436955 -38.63404012 138.2700919 -43.57592773 138.26074219 C-49.91815268 138.24932926 -56.26020869 138.25592202 -62.60242748 138.26788712 C-67.47420024 138.27510326 -72.34593273 138.27281923 -77.21770668 138.26763153 C-79.55694918 138.26629533 -81.89619531 138.26794172 -84.23543358 138.27259064 C-87.49844478 138.27765381 -90.76117939 138.26994925 -94.02416992 138.25878906 C-95.4806192 138.26486176 -95.4806192 138.26486176 -96.9664917 138.27105713 C-97.85384506 138.26541748 -98.74119843 138.25977783 -99.65544128 138.25396729 C-100.42656344 138.25321323 -101.1976856 138.25245918 -101.9921751 138.25168228 C-106.6041533 137.67356753 -110.84161355 133.2742251 -113.875 129.9375 C-114.431875 128.9784375 -114.431875 128.9784375 -115 128 C-114.67 127.01 -114.34 126.02 -114 125 C-112.948125 126.1446875 -112.948125 126.1446875 -111.875 127.3125 C-105.83903782 132.95481247 -100.71199741 133.44160196 -92.80712891 133.40405273 C-91.79497818 133.41091599 -90.78282745 133.41777924 -89.74000549 133.42485046 C-86.40204749 133.44311597 -83.06455965 133.43928083 -79.7265625 133.43359375 C-77.40017545 133.43815599 -75.07378975 133.44346169 -72.74740601 133.44947815 C-67.87354047 133.45840904 -62.99983879 133.45598664 -58.12597656 133.44604492 C-51.88946332 133.4345615 -45.65351681 133.45475783 -39.41707802 133.48396206 C-34.61284815 133.50233625 -29.80875373 133.50202901 -25.00449753 133.49632454 C-22.70566387 133.49617144 -20.40682095 133.50220608 -18.10802078 133.51461601 C-14.88887578 133.52954486 -11.67077324 133.51883371 -8.45166016 133.50170898 C-7.50802109 133.51137695 -6.56438202 133.52104492 -5.59214783 133.53100586 C0.34953675 133.46504231 5.0796873 132.49914468 10 129 C10.33 128.34 10.66 127.68 11 127 C11.66 127 12.32 127 13 127 C15.30318323 121.48862491 15.29601314 116.45986559 15.29052734 110.59179688 C15.29724457 109.55692642 15.30396179 108.52205597 15.31088257 107.45582581 C15.32984241 104.04341806 15.33378539 100.6312071 15.3359375 97.21875 C15.34236542 94.84273193 15.34909377 92.46671465 15.35610962 90.09069824 C15.36807634 85.11432052 15.37179092 80.13801219 15.37060547 75.16162109 C15.370402 68.78593686 15.39773654 62.41069694 15.43214989 56.0351181 C15.45438517 51.12976028 15.45844408 46.22451011 15.45738602 41.31910706 C15.4597458 38.96837326 15.46859049 36.61763666 15.48405075 34.26695251 C15.50364736 30.98038531 15.49789753 27.69478593 15.48583984 24.40820312 C15.49707886 23.43867203 15.50831787 22.46914093 15.51989746 21.4702301 C15.46700208 15.79610553 14.82166259 12.48589018 11 8 C7.63554193 4.90115704 4.13780763 2.92456169 0 1 C0 0.67 0 0.34 0 0 Z " fill="#AF75F8" transform="translate(124,5)"/>
<path d="M0 0 C1.39895508 -0.01836914 1.39895508 -0.01836914 2.82617188 -0.03710938 C4.16325195 -0.04000977 4.16325195 -0.04000977 5.52734375 -0.04296875 C6.348396 -0.04707764 7.16944824 -0.05118652 8.01538086 -0.05541992 C10.0625 0.1875 10.0625 0.1875 12.0625 2.1875 C11.93594368 7.75597804 9.74893612 10.32123773 6.0625 14.1875 C2.83005038 15.80372481 -0.44323136 15.77204308 -3.9375 15.1875 C-7.08609383 13.46883525 -9.28141258 11.10031729 -11.375 8.1875 C-12.1151646 5.55580363 -11.70894026 3.78234451 -10.9375 1.1875 C-8.63740227 -1.11259773 -3.08959334 0.00212635 0 0 Z " fill="#FE0139" transform="translate(73.9375,81.8125)"/>
<path d="M0 0 C0.33 0.99 0.66 1.98 1 3 C-1.63845153 7.85475081 -5.45499981 12.83528571 -10.91124249 14.62794113 C-13.1229017 15.0218918 -15.17378756 15.13166731 -17.42012024 15.14044189 C-18.29898895 15.14615204 -19.17785767 15.15186218 -20.08335876 15.15774536 C-21.51803246 15.15942215 -21.51803246 15.15942215 -22.98168945 15.16113281 C-23.99515442 15.16609772 -25.00861938 15.17106262 -26.05279541 15.17617798 C-29.40629759 15.19078563 -32.75975247 15.19759921 -36.11328125 15.203125 C-38.44492087 15.20887748 -40.77656048 15.21463521 -43.10820007 15.22039795 C-47.99816101 15.23090388 -52.88810553 15.23674926 -57.77807617 15.24023438 C-64.03928901 15.245719 -70.30028438 15.26974831 -76.56142902 15.29820633 C-81.37846 15.31684332 -86.19543869 15.32203888 -91.01250267 15.32357025 C-93.32054013 15.32659476 -95.62857671 15.33461646 -97.93657875 15.34775543 C-101.16792917 15.36483811 -104.39874952 15.36293005 -107.63012695 15.35644531 C-109.0556916 15.37026749 -109.0556916 15.37026749 -110.51005554 15.3843689 C-117.67567977 15.33939517 -122.49150578 14.29500535 -127.9375 9.3125 C-128.618125 8.549375 -129.29875 7.78625 -130 7 C-129.67 6.01 -129.34 5.02 -129 4 C-128.29875 4.763125 -127.5975 5.52625 -126.875 6.3125 C-120.83903782 11.95481247 -115.71199741 12.44160196 -107.80712891 12.40405273 C-106.79497818 12.41091599 -105.78282745 12.41777924 -104.74000549 12.42485046 C-101.40204749 12.44311597 -98.06455965 12.43928083 -94.7265625 12.43359375 C-92.40017545 12.43815599 -90.07378975 12.44346169 -87.74740601 12.44947815 C-82.87354047 12.45840904 -77.99983879 12.45598664 -73.12597656 12.44604492 C-66.88946332 12.4345615 -60.65351681 12.45475783 -54.41707802 12.48396206 C-49.61284815 12.50233625 -44.80875373 12.50202901 -40.00449753 12.49632454 C-37.70566387 12.49617144 -35.40682095 12.50220608 -33.10802078 12.51461601 C-29.88887578 12.52954486 -26.67077324 12.51883371 -23.45166016 12.50170898 C-22.50802109 12.51137695 -21.56438202 12.52104492 -20.59214783 12.53100586 C-14.65046325 12.46504231 -9.9203127 11.49914468 -5 8 C-4.67 7.34 -4.34 6.68 -4 6 C-3.34 6 -2.68 6 -2 6 C-1.34 4.02 -0.68 2.04 0 0 Z " fill="#9661D9" transform="translate(139,126)"/>
<path d="M0 0 C4.94834903 7.23212361 5.69214757 13.77374296 5.48828125 22.3515625 C5.48120651 23.49160736 5.47413177 24.63165222 5.46684265 25.8062439 C5.43906882 29.41319073 5.37635905 33.01852999 5.3125 36.625 C5.2873953 39.08461285 5.26458596 41.54425026 5.24414062 44.00390625 C5.18929803 50.00314375 5.10584309 56.00145698 5 62 C4.67 62 4.34 62 4 62 C3.99413376 61.39136108 3.98826752 60.78272217 3.98222351 60.15563965 C3.91807261 53.79584279 3.8335976 47.43654183 3.73754883 41.07714844 C3.70438427 38.70677242 3.67632622 36.33631905 3.65356445 33.96582031 C3.61986312 30.54979624 3.56753791 27.1344757 3.51171875 23.71875 C3.50532883 22.66635132 3.4989389 21.61395264 3.49235535 20.52966309 C3.3573793 13.70772418 2.8304976 7.47440227 -1.6484375 1.9765625 C-2.21820313 1.53054688 -2.78796875 1.08453125 -3.375 0.625 C-4.22191406 -0.06722656 -4.22191406 -0.06722656 -5.0859375 -0.7734375 C-9.9800631 -3.90967309 -14.48445914 -4.30259982 -20.18676758 -4.31884766 C-20.99704407 -4.32889328 -21.80732056 -4.3389389 -22.64215088 -4.34928894 C-25.30960406 -4.38007993 -27.97695704 -4.39714466 -30.64453125 -4.4140625 C-32.49827433 -4.43277744 -34.35200892 -4.4523511 -36.20573425 -4.4727478 C-41.0767618 -4.52404058 -45.94781695 -4.56368161 -50.81896973 -4.60089111 C-55.79279393 -4.64094862 -60.76650355 -4.69203301 -65.74023438 -4.7421875 C-75.49340906 -4.83891301 -85.24664849 -4.92332864 -95 -5 C-95 -5.33 -95 -5.66 -95 -6 C-84.70763855 -6.17740731 -74.41516122 -6.34333061 -64.12238312 -6.49477577 C-59.34254484 -6.56546205 -54.56283442 -6.64003633 -49.78320312 -6.72363281 C-45.16676975 -6.8042296 -40.55028249 -6.87443464 -35.93357849 -6.93757248 C-34.17616497 -6.96340698 -32.41880145 -6.9929249 -30.66151428 -7.02626419 C-28.19169412 -7.07247948 -25.72201746 -7.1053474 -23.25195312 -7.13525391 C-22.53265625 -7.1517952 -21.81335938 -7.16833649 -21.07226562 -7.18537903 C-13.11090482 -7.2513018 -5.79612499 -5.73890904 0 0 Z " fill="#AB76E7" transform="translate(139,10)"/>
<path d="M0 0 C0.886875 -0.00257812 1.77375 -0.00515625 2.6875 -0.0078125 C4.0796875 0.00378906 4.0796875 0.00378906 5.5 0.015625 C6.428125 0.00789063 7.35625 0.00015625 8.3125 -0.0078125 C9.6428125 -0.00394531 9.6428125 -0.00394531 11 0 C11.8146875 0.00225586 12.629375 0.00451172 13.46875 0.00683594 C15.5 0.265625 15.5 0.265625 17.5 2.265625 C17.125 4.390625 17.125 4.390625 16.5 6.265625 C15.84 5.935625 15.18 5.605625 14.5 5.265625 C11.66966668 5.30336278 8.88490995 5.40798798 6.0625 5.578125 C5.28583984 5.61357422 4.50917969 5.64902344 3.70898438 5.68554688 C-0.12349916 5.90671518 -2.24829523 6.09782182 -5.5 8.265625 C-6.125 5.390625 -6.125 5.390625 -6.5 2.265625 C-4.05013068 -0.18424432 -3.362922 0.00931189 0 0 Z " fill="#14050B" transform="translate(68.5,81.734375)"/>
<path d="M0 0 C1.72766602 0.10538086 1.72766602 0.10538086 3.49023438 0.21289062 C6.30855465 0.38830475 9.12268298 0.58865579 11.9375 0.8125 C11.9375 1.1425 11.9375 1.4725 11.9375 1.8125 C11.348479 1.82708252 10.75945801 1.84166504 10.15258789 1.85668945 C7.43446198 1.93203764 4.71745058 2.02840384 2 2.125 C1.07380859 2.14755859 0.14761719 2.17011719 -0.80664062 2.19335938 C-8.16610721 2.47740896 -14.93901304 3.38312125 -20.875 8 C-27.67316248 16.74049462 -27.71241691 24.70834788 -27.8125 35.3125 C-27.84069898 36.81774211 -27.87063182 38.3229528 -27.90234375 39.828125 C-27.97574292 43.48943617 -28.02560126 47.15061788 -28.0625 50.8125 C-28.3925 50.8125 -28.7225 50.8125 -29.0625 50.8125 C-29.13718636 46.25931299 -29.19135256 41.70649002 -29.22729492 37.15283203 C-29.2422933 35.60687032 -29.26269887 34.06095052 -29.28881836 32.51513672 C-29.44409999 23.08253866 -29.46905839 15.44642348 -24.4375 7.125 C-16.95530175 -0.1602983 -10.11990791 -0.81169486 0 0 Z " fill="#C092E7" transform="translate(32.0625,3.1875)"/>
<path d="M0 0 C4.62 0 9.24 0 14 0 C14 4.95 14 9.9 14 15 C13.01 13.68 12.02 12.36 11 11 C7.6917472 6.79689193 4.80228048 3.54238378 0 1 C0 0.67 0 0.34 0 0 Z " fill="#000002" transform="translate(134,0)"/>
<path d="M0 0 C0.33 0 0.66 0 1 0 C1 4.95 1 9.9 1 15 C-3.29 15 -7.58 15 -12 15 C-9.84352356 12.84352356 -7.67425574 10.69809069 -5.4375 8.625 C-2.91294219 5.90624544 -1.49225654 3.37721217 0 0 Z " fill="#000006" transform="translate(147,131)"/>
<path d="M0 0 C0.99 1.32 1.98 2.64 3 4 C6.17238608 8.00722452 8.93986496 10.75189197 13 14 C8.71 14 4.42 14 0 14 C0 9.38 0 4.76 0 0 Z " fill="#000003" transform="translate(0,132)"/>
<path d="M0 0 C4.62 0 9.24 0 14 0 C12.35 1.32 10.7 2.64 9 4 C8.154375 4.86625 7.30875 5.7325 6.4375 6.625 C4 9 4 9 0 11 C0 7.37 0 3.74 0 0 Z " fill="#000000" transform="translate(0,0)"/>
<path d="M0 0 C0.495 1.485 0.495 1.485 1 3 C-1.63041429 7.83996229 -5.41925187 12.76017796 -10.82128906 14.63061523 C-13.53180212 15.09016322 -16.10973299 15.11168504 -18.859375 15.09765625 C-19.97441406 15.09443359 -21.08945313 15.09121094 -22.23828125 15.08789062 C-23.39714844 15.07951172 -24.55601563 15.07113281 -25.75 15.0625 C-26.92433594 15.05798828 -28.09867188 15.05347656 -29.30859375 15.04882812 C-32.20578072 15.03705094 -35.10286454 15.02060326 -38 15 C-38 14.67 -38 14.34 -38 14 C-37.28457031 13.96036133 -36.56914063 13.92072266 -35.83203125 13.87988281 C-32.55334756 13.68795469 -29.27696917 13.46919526 -26 13.25 C-24.87464844 13.188125 -23.74929687 13.12625 -22.58984375 13.0625 C-15.76421826 12.58350874 -10.82510626 11.66869673 -5 8 C-4.67 7.34 -4.34 6.68 -4 6 C-3.34 6 -2.68 6 -2 6 C-1.34 4.02 -0.68 2.04 0 0 Z " fill="#9967D8" transform="translate(139,126)"/>
<path d="M0 0 C2.625 0.375 2.625 0.375 5 1 C5.625 3.375 5.625 3.375 6 6 C5.34 6.66 4.68 7.32 4 8 C1.375 7.625 1.375 7.625 -1 7 C-1.625 4.625 -1.625 4.625 -2 2 C-1.34 1.34 -0.68 0.68 0 0 Z " fill="#252227" transform="translate(45,61)"/>
<path d="M0 0 C1.85546875 -0.09375 1.85546875 -0.09375 4.85546875 0.15625 C5.51546875 1.14625 6.17546875 2.13625 6.85546875 3.15625 C5.59089844 3.21683594 4.32632813 3.27742188 3.0234375 3.33984375 C1.36327004 3.42425904 -0.29688562 3.50890655 -1.95703125 3.59375 C-2.79041016 3.63306641 -3.62378906 3.67238281 -4.48242188 3.71289062 C-5.28486328 3.75478516 -6.08730469 3.79667969 -6.9140625 3.83984375 C-8.02164917 3.89483032 -8.02164917 3.89483032 -9.15161133 3.95092773 C-11.35202625 4.10467141 -11.35202625 4.10467141 -14.14453125 5.15625 C-13.4375 3.203125 -13.4375 3.203125 -12.14453125 1.15625 C-10.0078125 0.546875 -10.0078125 0.546875 -7.45703125 0.40625 C-6.56628906 0.3546875 -5.67554687 0.303125 -4.7578125 0.25 C-3.17070808 0.19306352 -1.58392677 0.1154045 0 0 Z " fill="#F4000D" transform="translate(78.14453125,85.84375)"/>
<path d="M0 0 C2.375 -0.125 2.375 -0.125 5 0 C5.66 0.66 6.32 1.32 7 2 C6.625 4.625 6.625 4.625 6 7 C1.25 8.125 1.25 8.125 -1 7 C-1 4 -1 4 1 2 C0.67 1.34 0.34 0.68 0 0 Z " fill="#17121C" transform="translate(99,59)"/>
<path d="M0 0 C6.7128509 1.29546245 12.08230668 3.18519983 16.359375 8.77734375 C17.5 10.625 17.5 10.625 19 14 C18.67 14.99 18.34 15.98 18 17 C17.69707031 16.46890625 17.39414063 15.9378125 17.08203125 15.390625 C12.6072998 7.84553935 8.23470364 4.79142496 0 2 C0 1.34 0 0.68 0 0 Z " fill="#9D67DF" transform="translate(124,3)"/>
<path d="M0 0 C2.94121588 4.41182382 2.09156277 8.92459351 1.921875 14.04492188 C1.84094964 18.08781783 2.02336234 21.5492188 3.125 25.45703125 C3.41375 26.62621094 3.7025 27.79539063 4 29 C3.34 29.66 2.68 30.32 2 31 C-0.36096509 24.52128871 -0.23053565 18.40202165 -0.125 11.5625 C-0.11597656 10.44939453 -0.10695313 9.33628906 -0.09765625 8.18945312 C-0.0742224 5.45940977 -0.041414 2.7298199 0 0 Z " fill="#AE75F2" transform="translate(6,101)"/>
<path d="M0 0 C6.72505081 0.16439013 10.21055351 1.21055351 15 6 C14.01 6.33 13.02 6.66 12 7 C11.0925 6.360625 10.185 5.72125 9.25 5.0625 C5.47926504 2.66953359 3.37746984 2.64980241 -1 3 C-0.67 2.01 -0.34 1.02 0 0 Z " fill="#16101D" transform="translate(93,47)"/>
<path d="M0 0 C0.33 0.99 0.66 1.98 1 3 C-1.60412629 7.79159238 -4.76320505 10.72611299 -9 14 C-10.32 13.34 -11.64 12.68 -13 12 C-12.43410156 11.73445312 -11.86820312 11.46890625 -11.28515625 11.1953125 C-10.55167969 10.84210938 -9.81820312 10.48890625 -9.0625 10.125 C-7.96615234 9.60292969 -7.96615234 9.60292969 -6.84765625 9.0703125 C-4.83667541 8.1315023 -4.83667541 8.1315023 -4 6 C-3.34 6 -2.68 6 -2 6 C-1.34 4.02 -0.68 2.04 0 0 Z " fill="#A26CE6" transform="translate(139,126)"/>
<path d="M0 0 C0.44730469 0.40992188 0.89460937 0.81984375 1.35546875 1.2421875 C4.73744485 4.25640074 7.579668 6.66050545 12 8 C11.67 8.66 11.34 9.32 11 10 C7.44849408 9.69558521 6.02861198 9.02406007 3.25 6.6875 C1.11322057 4.13523568 0.60972019 3.10824748 0 0 Z " fill="#9D66E2" transform="translate(9,130)"/>
<path d="M0 0 C2.31 0 4.62 0 7 0 C7.33 1.98 7.66 3.96 8 6 C4.08597051 4.73058503 2.20927127 3.48832306 0 0 Z " fill="#FB0550" transform="translate(64,91)"/>
<path d="M0 0 C0.33 0.66 0.66 1.32 1 2 C-0.01320313 2.19916016 -0.01320313 2.19916016 -1.046875 2.40234375 C-2.38492188 2.66724609 -2.38492188 2.66724609 -3.75 2.9375 C-4.63171875 3.11152344 -5.5134375 3.28554688 -6.421875 3.46484375 C-8.63235053 3.92368488 -10.81512068 4.43336074 -13 5 C-13 4.34 -13 3.68 -13 3 C-8.70614007 -0.4887612 -5.28129105 -0.26854022 0 0 Z " fill="#17111C" transform="translate(48,49)"/>
<path d="M0 0 C2.31 0 4.62 0 7 0 C3.55384615 4.8 3.55384615 4.8 0.75 5.8125 C-0.11625 5.9053125 -0.11625 5.9053125 -1 6 C-0.67 4.02 -0.34 2.04 0 0 Z " fill="#FB0654" transform="translate(77,91)"/>
</svg>

  );
};
export const OnyxLogoTypeIcon = ({
  size = 16,
  className = defaultTailwindCSS,
}: IconProps) => {
  const aspectRatio = 2570 / 1074; // Calculate the aspect ratio of the original SVG
  const height = size / aspectRatio; // Calculate the height based on the aspect ratio

  return (
    <svg
      version="1.1"
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={height}
      viewBox="0 0 2570 1074"
      style={{ width: `${size}px`, height: `${height}px` }}
      className={`w-[${size}px] h-[${height}px] ` + className}
    >
      <path d="M0 0 C33.66 0 67.32 0 102 0 C113.48348497 17.22522745 113.48348497 17.22522745 117.19921875 22.890625 C117.63260056 23.55042862 118.06598236 24.21023224 118.51249695 24.89002991 C119.90463461 27.00971176 121.29606533 29.12985663 122.6875 31.25 C123.69151292 32.77892681 124.6955833 34.30781588 125.69970703 35.83666992 C127.77480423 38.99627002 129.84966036 42.15602819 131.92431641 45.31591797 C136.73934231 52.64933972 141.55714727 59.98093523 146.375 67.3125 C146.84497406 68.02772827 147.31494812 68.74295654 147.79916382 69.4798584 C155.88900327 81.7912407 163.98487249 94.0986496 172.0824585 106.40493774 C180.03173311 118.48596329 187.976067 130.57022328 195.91699219 142.65673828 C204.48573433 155.69856433 213.06141876 168.73581358 221.63989258 181.77124023 C226.83023927 189.65873654 232.01780509 197.54803831 237.19921875 205.44140625 C238.21614061 206.9902378 239.23306763 208.53906597 240.25 210.08789062 C242.12190047 212.93892489 243.99288677 215.79055572 245.86328125 218.64257812 C253.18800286 229.79911305 260.59623123 240.89434684 268 252 C268.33 168.84 268.66 85.68 269 0 C302.66 0 336.32 0 371 0 C371 136.95 371 273.9 371 415 C337.34 415 303.68 415 269 415 C257.54511971 397.81767956 257.54511971 397.81767956 252.03125 389.4375 C251.42543091 388.51767334 250.81961182 387.59784668 250.19543457 386.65014648 C247.66140629 382.80265531 245.12834978 378.95452469 242.59521484 375.10644531 C236.34333215 365.61028148 230.08968891 356.11594475 223.77252197 346.66305542 C218.51255933 338.78432729 213.31622578 330.86352415 208.10900879 322.94989014 C198.53167011 308.39647343 188.93043166 293.86006647 179.25 279.375 C172.43712641 269.17875597 165.67321367 258.95356759 158.97729492 248.67993164 C151.70840149 237.53372594 144.38562879 226.42312502 137.0625 215.3125 C136.43971161 214.36724457 135.81692322 213.42198914 135.17526245 212.4480896 C127.81499902 201.27743021 120.43037201 190.12415365 113 179 C109.7 174.05 106.4 169.1 103 164 C102.67 246.83 102.34 329.66 102 415 C68.34 415 34.68 415 0 415 C0 278.05 0 141.1 0 0 Z " fill="#2BA8E0" transform="translate(174,401)"/>
<path d="M0 0 C38.94 0 77.88 0 118 0 C140.60416667 62.16145833 140.60416667 62.16145833 147.765625 82.0690918 C150.02877623 88.3594526 152.29520056 94.64863341 154.5625 100.9375 C154.79146973 101.57262009 155.02043945 102.20774017 155.25634766 102.86210632 C160.14423266 116.41778155 165.06897082 129.95997023 170 143.5 C177.09670652 162.98773375 184.15603862 182.48865487 191.1875 202 C191.4196307 202.64412086 191.6517614 203.28824173 191.89092636 203.95188141 C193.05150389 207.17232396 194.21202831 210.39278565 195.37254333 213.61325073 C195.59908537 214.24190914 195.8256274 214.87056755 196.05903435 215.51827621 C196.513651 216.77986156 196.96825741 218.0414506 197.42285347 219.30304337 C201.87693339 231.66367017 206.3419838 244.02030947 210.8125 256.375 C211.15453461 257.32028564 211.49656921 258.26557129 211.84896851 259.23950195 C213.55099166 263.94326037 215.25322333 268.64694329 216.95556641 273.35058594 C219.75969566 281.09881568 222.56221805 288.84762654 225.36474609 296.59643555 C226.78280428 300.51725667 228.2011101 304.43798808 229.61962891 308.35864258 C232.83727585 317.25237116 236.05367253 326.14654305 239.26423645 335.04283142 C240.71343394 339.05825238 242.16340671 343.07339312 243.61355591 347.08847046 C244.32516198 349.05909211 245.03648953 351.02981437 245.74752808 353.00064087 C249.5133995 363.43663478 253.30626711 373.86120173 257.1796875 384.2578125 C257.5109816 385.14881149 257.8422757 386.03981049 258.18360901 386.95780945 C259.74327534 391.15156275 261.30912321 395.34277488 262.88745117 399.52954102 C263.4369434 401.00267101 263.98619327 402.47589145 264.53515625 403.94921875 C264.78735931 404.61039703 265.03956238 405.27157532 265.29940796 405.95278931 C266.51519927 409.2365034 267 411.43030496 267 415 C231.69 415 196.38 415 160 415 C150.56459752 391.4114938 143.15029475 367.06277498 135 343 C58.77 342.505 58.77 342.505 -19 342 C-19.66 344.97 -20.32 347.94 -21 351 C-21.67450116 353.2390835 -22.38621583 355.46737544 -23.13891602 357.68139648 C-23.55597305 358.91554794 -23.97303009 360.1496994 -24.40272522 361.42124939 C-24.85297473 362.73791348 -25.30337183 364.05452712 -25.75390625 365.37109375 C-26.2198481 366.74336884 -26.68541272 368.11577206 -27.15061951 369.48829651 C-28.12025802 372.3459632 -29.09293171 375.20257049 -30.06811523 378.05834961 C-31.31878924 381.72100852 -32.56402826 385.38548524 -33.80731297 389.05065823 C-34.99595778 392.55394532 -36.18735705 396.05629368 -37.37890625 399.55859375 C-37.6057416 400.22614622 -37.83257694 400.89369869 -38.06628609 401.58148003 C-38.70615311 403.46296294 -39.34826075 405.34368341 -39.99047852 407.22436523 C-40.5376931 408.82911964 -40.5376931 408.82911964 -41.09596252 410.46629333 C-42 413 -42 413 -43 415 C-78.31 415 -113.62 415 -150 415 C-145.31522798 400.94568394 -140.63676788 386.97082565 -135.53201294 373.07650757 C-134.15734912 369.33468209 -132.79060961 365.58997294 -131.42308044 361.84553528 C-130.70224202 359.87207769 -129.98101871 357.89876065 -129.25941467 355.92558289 C-125.33383919 345.18917 -121.44723112 334.43874377 -117.5625 323.6875 C-116.84810179 321.71124905 -116.13366479 319.73501213 -115.41918945 317.75878906 C-113.98712554 313.79759077 -112.55525044 309.83632431 -111.12353516 305.875 C-107.66712478 296.31198119 -104.20858485 286.74973256 -100.75 277.1875 C-100.40591095 276.23612152 -100.0618219 275.28474304 -99.70730591 274.30453491 C-93.19309618 256.29354812 -86.67268 238.28481052 -80.15161133 220.27630615 C-72.11610655 198.08531672 -64.08670565 175.8921251 -56.06054688 153.69775391 C-53.96245903 147.89607948 -51.86407595 142.09451185 -49.765625 136.29296875 C-49.4141037 135.32110626 -49.0625824 134.34924377 -48.70040894 133.34793091 C-46.92363537 128.43567458 -45.14673789 123.52346312 -43.36962891 118.61132812 C-40.19905809 109.84713015 -37.02926946 101.08265429 -33.86407471 92.31651306 C-26.20555274 71.10599889 -18.5220034 49.9047966 -10.78973389 28.72103882 C-9.93361367 26.37548983 -9.07785688 24.02980815 -8.22247314 21.68399048 C-7.03499917 18.42818549 -5.84589937 15.17297939 -4.65625 11.91796875 C-4.29981415 10.94016449 -3.9433783 9.96236023 -3.57614136 8.95492554 C-3.25001862 8.06383087 -2.92389587 7.17273621 -2.58789062 6.25463867 C-2.30385376 5.47706711 -2.01981689 4.69949554 -1.72717285 3.89836121 C-1 2 -1 2 0 0 Z M58 115 C54.78595668 122.71569384 52.05263174 130.55136789 49.41503906 138.48022461 C48.97134651 139.80694523 48.52740522 141.13358269 48.08323669 142.46014404 C46.88852093 146.031009 45.69758326 149.60312268 44.50761509 153.17557216 C43.5119806 156.16355088 42.51455355 159.15092997 41.51716304 162.13832289 C39.16606326 169.18056828 36.81813147 176.22386433 34.47216797 183.26782227 C32.0522749 190.53356331 29.62684954 197.79744099 27.19876885 205.06044954 C25.11053826 211.30755008 23.02577766 217.55580113 20.94380164 223.80498892 C19.70173366 227.53300694 18.45833014 231.26056598 17.21155548 234.98701286 C16.04199576 238.48315579 14.87676465 241.98071129 13.71489143 245.47941589 C13.08337779 247.37746338 12.44740868 249.27402662 11.81132507 251.17054749 C11.43846878 252.29613068 11.06561249 253.42171387 10.68145752 254.58140564 C10.35480732 255.5611885 10.02815712 256.54097136 9.69160843 257.5504446 C8.86414106 260.0569688 8.86414106 260.0569688 9 263 C42 263 75 263 109 263 C98.79466045 232.37887495 98.79466045 232.37887495 88.53125 201.77734375 C87.79568999 199.59070501 87.06013511 197.40406454 86.32458496 195.21742249 C84.81279928 190.72367755 83.30057658 186.23007997 81.78808594 181.73657227 C79.85941328 176.00631417 77.93248649 170.2754705 76.00592804 164.5445013 C74.50034345 160.06677526 72.99355479 155.58945507 71.48643494 151.11224556 C70.77477799 148.9974698 70.06355509 146.88254792 69.35279846 144.76746941 C64.35037679 129.82263777 64.35037679 129.82263777 59 115 C58.67 115 58.34 115 58 115 Z " fill="#2BA8E0" transform="translate(2157,401)"/>
<path d="M0 0 C33.66 0 67.32 0 102 0 C102.029729 11.61340576 102.029729 11.61340576 102.06005859 23.46142578 C102.12494857 48.27034895 102.19948658 73.0792342 102.28005161 97.88811112 C102.29256958 101.74555692 102.3050025 105.60300298 102.31738281 109.46044922 C102.31984881 110.22835548 102.3223148 110.99626175 102.32485552 111.7874379 C102.36451423 124.20016557 102.39729195 136.61290226 102.42749982 149.02565612 C102.4586799 161.77455063 102.49731702 174.52340703 102.54279006 187.27225864 C102.57058762 195.13076746 102.59265822 202.98924861 102.60726251 210.84779321 C102.61911062 216.88687725 102.64136393 222.92587861 102.66738319 228.96492004 C102.67641508 231.43269223 102.68213889 233.90047922 102.68421364 236.36826706 C102.70984294 262.23372212 104.32851274 287.69044131 123.1015625 307.421875 C138.99579599 321.5596029 160.3700321 325.01849631 181 324 C198.4690357 322.62798503 216.27377052 316.92720738 228.24609375 303.4765625 C240.66306292 287.31900904 245.13832874 269.26517261 245.15821838 249.1673584 C245.16315636 248.09879939 245.16809434 247.03024037 245.17318195 245.92930079 C245.18849797 242.36107182 245.19690157 238.79286077 245.20532227 235.22460938 C245.21490542 232.66188399 245.22491576 230.09916017 245.23532104 227.53643799 C245.25673793 222.02537055 245.27519128 216.51430596 245.29092598 211.0032196 C245.3136806 203.03520813 245.34181552 195.06722273 245.37124526 187.09923345 C245.4188528 174.17033384 245.46213541 161.24142353 245.50268555 148.3125 C245.54207533 135.75650196 245.58350986 123.2005134 245.62768555 110.64453125 C245.63177196 109.48275566 245.63177196 109.48275566 245.63594092 108.29750985 C245.64962097 104.41181628 245.66334113 100.52612285 245.67708123 96.6404295 C245.79093854 64.42697165 245.89697247 32.21349476 246 0 C279.66 0 313.32 0 348 0 C348.04418747 32.76500889 348.08107847 65.52998858 348.10213066 98.29501836 C348.10463172 102.1734856 348.1072204 106.05195278 348.10986328 109.93041992 C348.11065021 111.0884969 348.11065021 111.0884969 348.11145304 112.26996938 C348.120128 124.72972195 348.13588174 137.18945583 348.15430559 149.64919736 C348.17308596 162.45798816 348.18413382 175.26676926 348.18817699 188.07557327 C348.19090527 195.96326148 348.19948507 203.85089688 348.21583293 211.73856882 C348.22777146 217.81251076 348.22889102 223.8864084 348.22621536 229.96036339 C348.22676069 232.43327151 348.2306726 234.90618184 348.23841095 237.37907791 C348.36694413 280.61413177 341.78450899 322.27960879 314 357 C313.52949219 357.58861816 313.05898437 358.17723633 312.57421875 358.78369141 C284.07331397 394.00562089 242.47532224 412.80041742 198 418 C150.05044046 423.01444337 97.26360501 415.1019294 58.58984375 384.3359375 C55.30879692 381.64953872 52.1368569 378.85263456 49 376 C48.13761719 375.22140625 47.27523437 374.4428125 46.38671875 373.640625 C14.12560376 342.97455717 1.53118073 298.27540338 0 255 C-0.17154509 246.55526028 -0.12692255 238.10787259 -0.11352539 229.66186523 C-0.11324279 227.14707439 -0.11340268 224.63228347 -0.1139679 222.11749268 C-0.11419422 216.73753171 -0.11139306 211.35758644 -0.10573006 205.97762871 C-0.09754805 198.19944208 -0.09499303 190.42126129 -0.09374207 182.64307082 C-0.09156199 170.01863566 -0.08493042 157.39420702 -0.07543945 144.76977539 C-0.06623818 132.51782259 -0.05917068 120.26587158 -0.05493164 108.01391602 C-0.05466892 107.25669844 -0.05440619 106.49948087 -0.05413551 105.71931731 C-0.05283032 101.91997994 -0.05156665 98.12064255 -0.05032361 94.32130516 C-0.03998356 62.88086432 -0.02156295 31.44043564 0 0 Z " fill="#2BA8E0" transform="translate(963,401)"/>
<path d="M0 0 C15.24659521 -0.25733186 30.49309015 -0.45111611 45.74137115 -0.56993389 C52.82213571 -0.6265791 59.90154862 -0.70375252 66.98144531 -0.82983398 C73.81559512 -0.95148074 80.64834087 -1.01514634 87.48350525 -1.04364967 C90.08957508 -1.0639582 92.69556898 -1.10361875 95.30104065 -1.16303062 C115.65574617 -1.60866741 115.65574617 -1.60866741 121.20281982 2.1978302 C123.3228891 5.05069654 124.65136092 7.72104909 126 11 C127.00691627 12.56359877 128.04786757 14.10594933 129.12597656 15.62133789 C130.13352072 17.15336374 131.13832192 18.6871964 132.140625 20.22265625 C132.69697632 21.0696962 133.25332764 21.91673615 133.82653809 22.78944397 C135.01791566 24.60363107 136.20815742 26.4185645 137.39733887 28.23419189 C140.60266482 33.12750412 143.81699091 38.0148965 147.03125 42.90234375 C147.69074646 43.90543579 148.35024292 44.90852783 149.02972412 45.9420166 C155.88968594 56.36761892 162.81628306 66.74836764 169.75 77.125 C179.92565399 92.35733318 190.02867726 107.63299649 200 123 C202.88402396 119.55123895 205.22994714 116.07583543 207.43359375 112.16015625 C208.07570801 111.02610352 208.71782227 109.89205078 209.37939453 108.72363281 C209.71473206 108.12699829 210.05006958 107.53036377 210.39556885 106.91564941 C212.17720998 103.74687266 213.97389823 100.58664372 215.76953125 97.42578125 C216.13012634 96.79034393 216.49072144 96.15490662 216.86224365 95.50021362 C220.05602018 89.88076229 223.32329078 84.30672275 226.625 78.75 C231.03095967 71.33022037 235.40745142 63.89459395 239.75 56.4375 C244.73002547 47.88975811 249.71639736 39.34579631 254.71618652 30.80960083 C255.42994611 29.59076157 256.14342115 28.37175561 256.85656738 27.15255737 C258.50426867 24.33586816 260.16184072 21.53272353 261.87869263 18.75733948 C263.37115482 16.25486384 264.47636478 13.83459169 265.44668579 11.09008789 C267.19168092 6.66564557 269.12186966 2.89376156 273 0 C281.28313374 -2.79690805 290.65398631 -1.73751864 299.25390625 -1.46484375 C301.84172915 -1.43684717 304.42963186 -1.41550452 307.01756287 -1.40052795 C313.1180425 -1.34923073 319.21383385 -1.23122357 325.31255239 -1.08028561 C332.26005527 -0.91210692 339.20776216 -0.8300273 346.15679657 -0.75485408 C360.4400448 -0.59842793 374.71987746 -0.33492353 389 0 C388.06911602 1.72563349 387.13586595 3.4499907 386.20166016 5.17382812 C385.42249741 6.61441589 385.42249741 6.61441589 384.62759399 8.08410645 C382.06385035 12.67714599 379.22904401 17.08360251 376.375 21.5 C375.13511462 23.43340008 373.89553659 25.3669973 372.65625 27.30078125 C371.73392578 28.73671631 371.73392578 28.73671631 370.79296875 30.20166016 C368.13415788 34.35134563 365.50296567 38.51823618 362.875 42.6875 C361.88935167 44.25001814 360.90367471 45.81251822 359.91796875 47.375 C359.19359619 48.52355469 359.19359619 48.52355469 358.45458984 49.6953125 C357.00918211 51.98545164 355.56159316 54.27419657 354.11328125 56.5625 C348.5481092 65.35800909 343.01198169 74.17104885 337.5 83 C331.51421661 92.58787459 325.49635422 102.15474523 319.45166016 111.70556641 C316.96526467 115.63545958 314.48287225 119.56788032 312 123.5 C311.00001836 125.08334493 310.00001838 126.66667828 309 128.25 C308.2575 129.425625 308.2575 129.425625 307.5 130.625 C303 137.75 303 137.75 301.50073242 140.1237793 C300.49821757 141.71113526 299.49577646 143.29853779 298.4934082 144.88598633 C296.03248037 148.78315395 293.57038288 152.67957101 291.10546875 156.57421875 C284.18212533 167.51719306 277.29391629 178.48176306 270.453125 189.4765625 C268.40774962 192.76098479 266.34410404 196.03000504 264.234375 199.2734375 C263.84733398 199.87623535 263.46029297 200.4790332 263.06152344 201.10009766 C262.09099391 202.60857018 261.10859663 204.10939014 260.125 205.609375 C258.7861552 208.45442019 259.00891189 209.10480024 260 212 C261.01848494 213.90764914 261.01848494 213.90764914 262.31542969 215.81079102 C262.80352112 216.55434341 263.29161255 217.29789581 263.79449463 218.0639801 C264.33153015 218.86915573 264.86856567 219.67433136 265.421875 220.50390625 C265.98485291 221.35730087 266.54783081 222.2106955 267.12786865 223.08995056 C268.99611455 225.91801771 270.87287494 228.74032003 272.75 231.5625 C274.06734808 233.55189081 275.38440093 235.54147714 276.70117188 237.53125 C286.15470766 251.79770532 295.71197402 265.99350108 305.30480957 280.16653442 C314.47184044 293.71174048 323.52249958 307.32851432 332.5 321 C342.29855408 335.92084621 352.1915622 350.77312151 362.1875 365.5625 C363.09681778 366.90838699 363.09681778 366.90838699 364.02450562 368.28146362 C366.93849728 372.59435993 369.85335865 376.90666771 372.76855469 381.21875 C377.06534998 387.57551242 381.36099526 393.93296635 385.63345337 400.30612183 C386.41036843 401.46346083 387.18895507 402.61967972 387.96932983 403.77468872 C389.01115653 405.31697575 390.04680542 406.8634308 391.08203125 408.41015625 C391.93631714 409.68064819 391.93631714 409.68064819 392.80786133 410.97680664 C394 413 394 413 394 415 C378.99396962 416.03761887 363.98956763 416.80814602 348.95553303 417.27973557 C341.96799012 417.50485257 335.00313926 417.81087822 328.0300293 418.31933594 C284.27230306 421.44734946 284.27230306 421.44734946 272.21251678 413.06176758 C261.1631648 403.12939344 254.53952873 389.49038517 248.45742798 376.17068481 C245.34419416 369.41367585 241.32419609 363.53454661 237 357.5 C235.62364837 355.45492048 234.25314914 353.4058804 232.890625 351.3515625 C232.49016968 350.75152405 232.08971436 350.1514856 231.67712402 349.53326416 C224.04638779 338.0726991 216.4928729 326.56061141 208.921875 315.06054688 C208.31160461 314.13368073 207.70133423 313.20681458 207.0725708 312.25186157 C205.92870047 310.51439201 204.78508517 308.7767545 203.64178467 307.03890991 C202.60695029 305.4668428 201.56999271 303.8961707 200.53063965 302.3270874 C199.45682439 300.69452682 198.39614895 299.05328362 197.34533691 297.40582275 C196.81275269 296.57983582 196.28016846 295.75384888 195.73144531 294.90283203 C195.2545929 294.15373566 194.77774048 293.40463928 194.28643799 292.63284302 C193.86191345 292.09400482 193.43738892 291.55516663 193 291 C192.34 291 191.68 291 191 291 C190.63463135 291.63574951 190.2692627 292.27149902 189.89282227 292.92651367 C180.39607111 309.44177134 170.80697129 325.90042996 161.15722656 342.32666016 C157.95360603 347.78070557 154.75589884 353.23821643 151.55773926 358.69546509 C150.50464428 360.49207673 149.45111932 362.28843553 148.39746094 364.0847168 C145.11209079 369.68621197 141.82953994 375.28930335 138.55670166 380.89813232 C137.03082418 383.51271619 135.50338224 386.12638452 133.97583008 388.73999023 C133.25646579 389.97179589 132.53784622 391.20403684 131.82006836 392.43676758 C130.81690626 394.15951153 129.81082902 395.88055693 128.8046875 397.6015625 C128.23733887 398.57432129 127.66999023 399.54708008 127.08544922 400.54931641 C126.74967361 401.05917587 126.41389801 401.56903534 126.06794739 402.09434509 C124.86959784 404.08110522 124.86959784 404.08110522 124.11308289 406.80909729 C122.54368764 410.64871445 121.32720456 412.46533336 118 415 C109.70066657 417.14995058 100.64719781 416.27245914 92.16015625 416.07421875 C89.59186637 416.05369442 87.02353333 416.0380401 84.45518494 416.02705383 C78.39458652 415.98939775 72.33651601 415.90279071 66.27686828 415.79220945 C59.3750933 415.66901031 52.47321007 415.60871736 45.57060826 415.55355966 C31.37922806 415.43875642 17.18969218 415.2454333 3 415 C4.27982036 411.7356783 5.62829168 408.74217841 7.43359375 405.734375 C7.91183594 404.93572021 8.39007812 404.13706543 8.8828125 403.31420898 C9.39585938 402.46802002 9.90890625 401.62183105 10.4375 400.75 C10.97246094 399.86320557 11.50742188 398.97641113 12.05859375 398.06274414 C16.31563429 391.04402384 20.73274727 384.14069554 25.22265625 377.26953125 C29.73206981 370.36214058 34.10277947 363.36616489 38.49707031 356.38525391 C39.9614961 354.06110836 41.42925869 351.73911211 42.8984375 349.41796875 C48.42012945 340.69271061 53.90990762 331.94832976 59.375 323.1875 C64.77839325 314.52679571 70.23359789 305.90112294 75.72558594 297.29638672 C80.70782066 289.48097914 85.62308306 281.62473033 90.52856445 273.76098633 C95.83739361 265.25233389 101.18495134 256.76876893 106.54833984 248.29443359 C108.02942336 245.95349466 109.50910717 243.61167713 110.98828125 241.26953125 C111.48577881 240.4818335 111.98327637 239.69413574 112.49584961 238.88256836 C113.49062089 237.30685453 114.48493194 235.73085006 115.47875977 234.15454102 C118.09036664 230.01408374 120.71294976 225.88112126 123.3515625 221.7578125 C124.17333984 220.46907227 124.17333984 220.46907227 125.01171875 219.15429688 C126.06039235 217.51018996 127.11230142 215.8681407 128.16796875 214.22851562 C128.64105469 213.48537109 129.11414062 212.74222656 129.6015625 211.9765625 C130.01744629 211.32768066 130.43333008 210.67879883 130.86181641 210.01025391 C131.23741699 209.34687012 131.61301758 208.68348633 132 208 C132.48525146 207.26515381 132.97050293 206.53030762 133.47045898 205.77319336 C134.22010818 201.84729882 132.72753893 200.21937792 130.5453949 197.00071716 C129.99287552 196.22575394 129.44035614 195.45079071 128.87109375 194.65234375 C128.02025963 193.41176964 128.02025963 193.41176964 127.15223694 192.14613342 C125.91531376 190.34686356 124.67000964 188.55333371 123.41748047 186.76489258 C120.72156744 182.91515537 118.06543086 179.03858626 115.40652466 175.16323853 C114.01753993 173.13966206 112.6264532 171.11752696 111.23336792 169.09677124 C104.77999391 159.72633732 98.51190138 150.24044295 92.28128052 140.72097778 C82.14120878 125.23160952 71.87851133 109.83050337 61.5 94.5 C50.26165438 77.8982663 39.17094277 61.20458817 28.1652832 44.44775391 C26.98785338 42.65523375 25.81036421 40.86275258 24.6328125 39.0703125 C24.06537827 38.20652985 23.49794403 37.34274719 22.91331482 36.45278931 C19.36156522 31.05235634 15.78397916 25.67018392 12.1796875 20.3046875 C11.74341537 19.65453674 11.30714325 19.00438599 10.85765076 18.33453369 C8.8856175 15.39718784 6.90874099 12.46331694 4.9230957 9.53515625 C4.26140381 8.55160156 3.59971191 7.56804687 2.91796875 6.5546875 C2.34844482 5.71405762 1.7789209 4.87342773 1.19213867 4.00732422 C0 2 0 2 0 0 Z " fill="#2BA8E0" transform="translate(1532,401)"/>
<path d="M0 0 C105.93 0 211.86 0 321 0 C321 27.06 321 54.12 321 82 C284.7 82 248.4 82 211 82 C211 191.89 211 301.78 211 415 C177.34 415 143.68 415 109 415 C109 305.11 109 195.22 109 82 C73.03 82 37.06 82 0 82 C0 54.94 0 27.88 0 0 Z " fill="#2BA8E0" transform="translate(595,401)"/>
<path d="M0 0 C33.66 0 67.32 0 102 0 C102 136.95 102 273.9 102 415 C68.34 415 34.68 415 0 415 C0 278.05 0 141.1 0 0 Z " fill="#2BA8E0" transform="translate(1380,401)"/>
<path d="M0 0 C33.66 0 67.32 0 102 0 C102 136.95 102 273.9 102 415 C68.34 415 34.68 415 0 415 C0 278.05 0 141.1 0 0 Z " fill="#2BA8E0" transform="translate(0,401)"/>
<path d="M0 0 C33.33 0 66.66 0 101 0 C101 136.95 101 273.9 101 415 C67.67 415 34.34 415 0 415 C0 278.05 0 141.1 0 0 Z " fill="#2BA8E0" transform="translate(2469,401)"/>
<path d="M0 0 C22.3273815 20.34579759 30.62135044 47.4456209 33.71850586 76.6965332 C33.71850586 83.9565332 33.71850586 91.2165332 33.71850586 98.6965332 C-7.86149414 98.6965332 -49.44149414 98.6965332 -92.28149414 98.6965332 C-94.32590615 82.34123715 -94.73810192 71.66448375 -92.28149414 55.6965332 C-69.84149414 55.6965332 -47.40149414 55.6965332 -24.28149414 55.6965332 C-30.61015673 38.39345478 -30.61015673 38.39345478 -44.28149414 27.6965332 C-56.26981501 23.00776771 -67.47936265 23.75859477 -79.28149414 28.6965332 C-82.28882096 30.40166785 -84.77804715 32.31940693 -87.28149414 34.6965332 C-87.82290039 35.20958008 -88.36430664 35.72262695 -88.92211914 36.2512207 C-101.49756976 49.52530747 -101.92951311 68.56702368 -101.56665039 85.73950195 C-101.00704618 100.69428068 -96.64256081 116.46234293 -86.28149414 127.6965332 C-80.83969096 132.02268647 -75.18469508 135.44140576 -68.28149414 136.6965332 C-67.55833008 136.82801758 -66.83516602 136.95950195 -66.09008789 137.0949707 C-54.84988321 138.71875629 -45.01691735 136.29036753 -35.28149414 130.6965332 C-34.54930664 130.34977539 -33.81711914 130.00301758 -33.06274414 129.64575195 C-30.31876636 128.18350064 -29.69664881 125.67151764 -28.50805664 122.88012695 C-27.30420539 120.63987745 -26.25732443 119.31206198 -24.28149414 117.6965332 C-13.21920517 115.9821159 -0.58032008 118.35663083 10.53100586 119.1965332 C12.49516661 119.34149809 14.45935918 119.48603261 16.42358398 119.63012695 C21.18893895 119.98063885 25.9538265 120.33695882 30.71850586 120.6965332 C31.98989801 124.56264647 31.16959096 126.53719053 29.36987305 130.17797852 C29.01054688 130.86472656 28.6512207 131.55147461 28.28100586 132.2590332 C27.91265625 132.97285156 27.54430664 133.68666992 27.16479492 134.42211914 C19.15342734 149.591128 7.8404063 162.41143564 -7.28149414 170.6965332 C-8.23797852 171.22891602 -9.19446289 171.76129883 -10.17993164 172.30981445 C-35.58191832 185.74419848 -67.63936362 187.21722851 -94.96069336 178.92944336 C-106.98160686 174.99851284 -117.94052153 169.28959148 -127.28149414 160.6965332 C-128.11036133 159.95918945 -128.93922852 159.2218457 -129.79321289 158.4621582 C-147.00239205 142.33349412 -157.17536783 117.88905972 -158.45849609 94.46533203 C-159.02566027 63.81361054 -155.44335433 35.59359982 -134.28149414 11.6965332 C-133.44102539 10.7374707 -132.60055664 9.7784082 -131.73461914 8.7902832 C-117.32990969 -6.95849174 -97.35183701 -16.43193334 -76.28149414 -19.3034668 C-75.50161133 -19.41303711 -74.72172852 -19.52260742 -73.91821289 -19.63549805 C-47.85676256 -22.75289641 -20.212986 -17.4670491 0 0 Z " fill="#E8262A" transform="translate(1090.281494140625,72.303466796875)"/>
<path d="M0 0 C20.13 0 40.26 0 61 0 C64.56147036 11.27798948 68.06767401 22.47219968 71.1875 33.86328125 C71.56671947 35.2368885 71.9463048 36.61039479 72.32621765 37.98381042 C73.13384277 40.90538523 73.93958382 43.82746957 74.7437439 46.75 C76.93073947 54.69652481 79.13187028 62.63914366 81.33203125 70.58203125 C81.56066172 71.40780293 81.78929218 72.2335746 82.02485085 73.08436966 C87.5144084 92.90780614 93.09495037 112.70541496 98.6875 132.5 C98.91554321 133.30724644 99.14358643 134.11449287 99.37854004 134.94620132 C100.72037509 139.69617888 100.72037509 139.69617888 102.0628376 144.44597912 C103.13413883 148.23557038 104.20398061 152.02555896 105.27023315 155.8165741 C107.15622271 162.51649906 109.05447105 169.21179514 111.01032162 175.891716 C111.87733899 178.85671252 112.73527826 181.82429888 113.59232521 184.79219055 C113.99699445 186.18390426 114.40614093 187.57432518 114.8201046 188.96330261 C115.38852178 190.87129345 115.94036947 192.78419694 116.49145508 194.69726562 C116.80810623 195.77415649 117.12475739 196.85104736 117.45100403 197.96057129 C119.4373229 208.95750919 110.52354853 222.34915021 104.91015625 231.3515625 C96.15576858 242.91666359 84.92366513 247.45251267 70.95703125 249.68359375 C53.51479138 252.04834779 35.51932913 251.12695166 18 251 C18 236.48 18 221.96 18 207 C21.3825 206.87625 24.765 206.7525 28.25 206.625 C44.09162007 206.79880829 44.09162007 206.79880829 57.59765625 199.96875 C61.68811461 194.22615665 63.96480646 186.99484687 63 180 C59.60956795 167.28089585 54.82008735 154.89880928 50.4375 142.5 C49.58906481 140.09425469 48.74067703 137.68849265 47.89233398 135.28271484 C40.23856957 113.59861849 32.47871584 91.95284121 24.70344543 70.31208801 C20.43188657 58.4219678 16.16775017 46.52919806 11.91279697 34.63312531 C10.78799246 31.48845165 9.66226957 28.34411472 8.53518677 25.20025635 C7.28991299 21.72658409 6.04701065 18.25207217 4.8046875 14.77734375 C4.43273758 13.74144608 4.06078766 12.7055484 3.67756653 11.63825989 C3.33779282 10.68634262 2.9980191 9.73442535 2.64794922 8.75366211 C2.35217987 7.92756943 2.05641052 7.10147675 1.75167847 6.25035095 C1.06616777 4.19809095 0.52477984 2.09911938 0 0 Z " fill="#E8262A" transform="translate(169,58)"/>
<path d="M0 0 C19.14 0 38.28 0 58 0 C58 82.5 58 165 58 250 C38.86 250 19.72 250 0 250 C0 167.5 0 85 0 0 Z " fill="#E8262A" transform="translate(74,0)"/>
<path d="M0 0 C11.81149735 9.26478045 17.77725365 24.811347 19.58932495 39.30204773 C21.24558239 54.5179692 21.2576972 69.66723098 21.1953125 84.95703125 C21.19044252 87.68470653 21.1886316 90.41238167 21.18673706 93.14006042 C21.18058791 99.5248938 21.16426879 105.90965644 21.14403808 112.29445904 C21.11924603 120.29720378 21.10848879 128.29996066 21.09765625 136.30273438 C21.07833086 150.53521096 21.03824218 164.76753383 21 179 C2.19 179 -16.62 179 -36 179 C-36.03738281 170.23695313 -36.07476563 161.47390625 -36.11328125 152.4453125 C-36.14741954 146.17796974 -36.18341239 139.91065908 -36.22207737 133.64334488 C-36.2718798 125.53080157 -36.31734984 117.41831094 -36.34643555 109.30566406 C-36.36948349 102.88099843 -36.40295667 96.45648399 -36.44870156 90.03193843 C-36.47254274 86.63340288 -36.49133085 83.23501621 -36.49761391 79.83639908 C-36.50727255 76.03279796 -36.53535486 72.22973692 -36.56762695 68.42626953 C-36.56619186 67.31208145 -36.56475677 66.19789337 -36.5632782 65.04994202 C-36.67709089 55.53067579 -38.27436264 45.25788204 -45 38 C-52.05946962 32.86816133 -59.76732806 31.50138624 -68.34375 32.1875 C-76.26796491 33.52680393 -83.24616239 37.5781492 -88 44 C-88.66 44 -89.32 44 -90 44 C-90.22317413 37.8621392 -90.38610822 31.72665783 -90.49438477 25.58569336 C-90.53953282 23.49901174 -90.60086991 21.41261311 -90.67895508 19.3269043 C-91.30959228 2.04414764 -91.30959228 2.04414764 -88.17407227 -2.85009766 C-85.84594265 -4.70369313 -83.74380595 -5.87063012 -81 -7 C-79.93394531 -7.62390625 -78.86789062 -8.2478125 -77.76953125 -8.890625 C-51.06663521 -21.16619676 -23.16458145 -17.69263308 0 0 Z " fill="#E8262A" transform="translate(881,71)"/>
<path d="M0 0 C0 14.85 0 29.7 0 45 C-6.435 46.98 -6.435 46.98 -13 49 C-24.55856394 54.77928197 -30.65125827 62.90954222 -35 75 C-41.24885396 93.84694508 -40.39721141 118.60211826 -31.75 136.5 C-26.25396959 146.64651769 -19.80803961 151.81415253 -9 156 C-6.03 156.66 -3.06 157.32 0 158 C0 173.18 0 188.36 0 204 C-25.55974324 204 -49.67079101 196.20091427 -68.09765625 177.99609375 C-88.94393126 156.71791146 -96.58237934 128.02908468 -96.28344727 98.85180664 C-95.61391636 70.30957785 -85.49973039 44.40574619 -64.80078125 24.3828125 C-47.09106071 9.31596518 -23.30868634 0 0 0 Z " fill="#E8262A" transform="translate(593,52)"/>
<path d="M0 0 C17.47820849 1.1652139 17.47820849 1.1652139 24.5625 3.1875 C25.75963623 3.51959473 25.75963623 3.51959473 26.98095703 3.85839844 C39.74199265 7.52486309 50.45915445 12.96278309 61 21 C61.73863281 21.55300781 62.47726562 22.10601562 63.23828125 22.67578125 C81.45922092 37.39128964 90.9002328 61.08727388 94.375 83.625 C97.39415124 112.02966774 92.5970014 142.75415574 75 166 C71.49149137 170.17501863 67.82814726 174.11732073 64 178 C63.28070312 178.7321875 62.56140625 179.464375 61.8203125 180.21875 C45.53046558 195.70947236 22.22165681 204 0 204 C0 188.82 0 173.64 0 158 C5.94 156.02 5.94 156.02 12 154 C23.05068747 147.68532145 30.18274815 139.19128415 33.9375 126.94140625 C39.25695039 106.45640741 39.59411722 81.9313423 29 63 C21.59376649 52.27845047 12.38511036 48.09627759 0 45 C0 30.15 0 15.3 0 0 Z " fill="#E8262A" transform="translate(602,52)"/>
<path d="M0 0 C18.48 0 36.96 0 56 0 C56 63.36 56 126.72 56 192 C37.52 192 19.04 192 0 192 C0 128.64 0 65.28 0 0 Z " fill="#E8262A" transform="translate(727,58)"/>
<path d="M0 0 C18.48 0 36.96 0 56 0 C56 63.36 56 126.72 56 192 C37.52 192 19.04 192 0 192 C0 128.64 0 65.28 0 0 Z " fill="#E8262A" transform="translate(374,58)"/>
<path d="M0 0 C3.64531015 0.76018783 5.24717187 2.53917187 7.37890625 5.49609375 C8.2820695 8.2055835 8.52548125 9.89744709 8.58422852 12.69213867 C8.60417374 13.53278366 8.62411896 14.37342865 8.64466858 15.23954773 C8.66138107 16.1427626 8.67809357 17.04597748 8.6953125 17.9765625 C8.7160936 18.90455154 8.73687469 19.83254059 8.75828552 20.78865051 C8.82367948 23.75355615 8.88261887 26.71855047 8.94140625 29.68359375 C8.98460112 31.69336855 9.02821572 33.70313438 9.07226562 35.71289062 C9.17935052 40.64053407 9.2806467 45.56826674 9.37890625 50.49609375 C9.88172119 50.0386377 10.38453613 49.58118164 10.90258789 49.10986328 C26.0521631 35.55282141 44.10564354 29.1319034 64.37890625 29.49609375 C86.0989027 30.9267522 105.23473357 39.79904395 119.69140625 56.12109375 C133.23259649 73.33932265 138.06906531 92.85839347 136.37890625 114.49609375 C133.90444063 134.86442229 123.59708927 151.13074012 108.37890625 164.49609375 C90.16301141 178.15157361 69.38112084 182.117502 47.02050781 179.18701172 C29.4202765 175.98659808 11.89847254 165.03587646 1.37890625 150.49609375 C-7.85539903 136.02391365 -12.9159441 122.51981491 -12.92749023 105.25073242 C-12.93581375 104.17465729 -12.94413727 103.09858215 -12.95271301 101.98989868 C-12.97663648 98.46458232 -12.98555957 94.93945118 -12.9921875 91.4140625 C-13.00116095 88.95168505 -13.01028292 86.48930814 -13.01954651 84.02693176 C-13.03598645 78.88195472 -13.04372862 73.73704243 -13.04663086 68.59204102 C-13.05203697 61.99658059 -13.08983083 55.40172611 -13.13537502 48.80643749 C-13.16508053 43.72870132 -13.17235287 38.65111303 -13.17335701 33.5732975 C-13.17756527 31.14078278 -13.19002364 28.70826785 -13.21087456 26.27583885 C-13.23767755 22.88159299 -13.23299772 19.48877943 -13.22045898 16.09448242 C-13.23529327 15.09023727 -13.25012756 14.08599213 -13.26541138 13.05131531 C-13.21590121 8.35369645 -13.16254849 6.20574278 -10.23988342 2.37519836 C-6.6117089 -0.2281873 -4.33504423 -0.2131989 0 0 Z M22.37890625 67.49609375 C11.00821625 81.36907151 6.94437323 95.69414938 8.37890625 113.49609375 C11.25744469 128.54584361 19.6515012 141.35311769 32.21484375 150.1875 C45.19730316 158.03790416 59.14494081 160.61752928 74.01953125 157.80859375 C89.73983882 153.33836411 101.59756782 143.74114321 109.75390625 129.6484375 C116.32344815 116.9041579 117.35996446 102.13665779 113.41015625 88.3671875 C108.64775379 75.10822609 99.24980914 63.62439207 86.6796875 57.09375 C63.77269066 46.31214849 41.13387419 50.71273873 22.37890625 67.49609375 Z " fill="#A761FF" transform="translate(2014.62109375,913.50390625)"/>
<path d="M0 0 C0.84304687 -0.03996094 1.68609375 -0.07992187 2.5546875 -0.12109375 C6.45113053 0.72570162 7.71442349 2.26992896 10.125 5.4375 C10.8610765 8.95229033 10.78774024 12.4081894 10.74023438 15.98828125 C10.74578339 17.05077591 10.7513324 18.11327057 10.75704956 19.20796204 C10.76886355 22.72243299 10.74453838 26.23561897 10.71875 29.75 C10.71703831 32.20035748 10.71710517 34.65071678 10.71887207 37.10107422 C10.71721744 42.24252803 10.69850224 47.3835466 10.66699219 52.52490234 C10.62748218 59.08710911 10.62292694 65.64874131 10.63045502 72.21104431 C10.63353981 77.27627745 10.62134789 82.34138363 10.60432434 87.40658569 C10.597332 89.82407839 10.5941652 92.24158548 10.59501648 94.65908813 C10.57924214 124.16069046 10.57924214 124.16069046 3.4375 137.5625 C3.08864746 138.2335376 2.73979492 138.9045752 2.38037109 139.59594727 C-7.41731117 157.98364956 -22.81373559 171.28822016 -42.875 177.4375 C-63.20422146 183.15937046 -84.73991328 179.72690658 -103.0703125 169.77734375 C-109.15612613 166.21936555 -114.01960431 161.49396269 -118.875 156.4375 C-119.55046875 155.75816406 -120.2259375 155.07882812 -120.921875 154.37890625 C-135.19889048 139.18588757 -139.58990338 119.95600985 -139.1796875 99.76171875 C-138.35174811 80.58568448 -129.56171844 62.75169687 -115.875 49.4375 C-99.46798734 34.67569603 -78.89933164 28.58361817 -57.08203125 29.6171875 C-41.40075845 31.23653917 -27.16912535 37.25387233 -15.21704102 47.55664062 C-14.59015884 48.0963147 -13.96327667 48.63598877 -13.31739807 49.1920166 C-12.84140671 49.60302612 -12.36541534 50.01403564 -11.875 50.4375 C-11.86041748 49.19661621 -11.84583496 47.95573242 -11.83081055 46.67724609 C-11.77269277 42.05879379 -11.69546053 37.44082216 -11.61254883 32.82275391 C-11.57936287 30.82673971 -11.55131132 28.83063311 -11.52856445 26.83447266 C-11.49490207 23.9595616 -11.44258023 21.08549257 -11.38671875 18.2109375 C-11.38032883 17.32320648 -11.3739389 16.43547546 -11.36735535 15.52084351 C-11.2479217 10.44994181 -10.7466568 6.79855615 -7.875 2.4375 C-4.72405867 0.33687245 -3.6525634 0.09436714 0 0 Z M-85.875 55.4375 C-86.65875 55.788125 -87.4425 56.13875 -88.25 56.5 C-102.10303466 63.42651733 -110.69920509 75.23773966 -115.9296875 89.45703125 C-120.13750356 102.7238232 -118.43689175 116.68974955 -112.58984375 129.18359375 C-104.49557476 143.63603503 -92.62043588 152.69090183 -76.875 157.4375 C-76.27429687 157.62957031 -75.67359375 157.82164062 -75.0546875 158.01953125 C-61.67673274 160.58483799 -47.69455631 157.94724331 -36.0625 150.9765625 C-22.88183491 141.70302313 -13.87321039 129.44639461 -10.875 113.4375 C-9.16796375 98.41206137 -11.85074748 84.63943325 -21.1875 72.4453125 C-23.29672525 69.93572505 -25.43649382 67.63215556 -27.875 65.4375 C-28.35066406 64.96957031 -28.82632813 64.50164062 -29.31640625 64.01953125 C-40.65815458 53.38835029 -54.23010892 50.81558045 -69.1640625 51.12109375 C-75.20740059 51.40938872 -80.3945361 52.89777283 -85.875 55.4375 Z " fill="#A761FF" transform="translate(2500.875,913.5625)"/>
<path d="M0 0 C14.10753006 7.09550329 23.68377605 18.73342288 28.92578125 33.4765625 C29.92938169 36.89692135 30.81339803 40.31197912 31.61328125 43.78515625 C31.94972656 45.21021484 31.94972656 45.21021484 32.29296875 46.6640625 C32.75789578 48.69891438 33.19038461 50.74115582 33.61328125 52.78515625 C34.25265625 52.12515625 34.89203125 51.46515625 35.55078125 50.78515625 C39.63310205 48.11915083 42.85653658 47.79033619 47.61328125 48.78515625 C50.67911528 50.51247646 53.01555683 52.5897074 54.61328125 55.78515625 C54.98613455 60.25939582 55.05817705 62.81799146 53.17578125 66.91015625 C48.69312943 71.93947292 43.03578247 75.68071999 36.61328125 77.78515625 C33.80078125 77.91015625 33.80078125 77.91015625 31.61328125 77.78515625 C31.59910156 78.41679688 31.58492187 79.0484375 31.5703125 79.69921875 C30.48120045 100.12742847 18.30381641 118.22503386 3.61328125 131.78515625 C-12.81520175 145.77125608 -31.72578533 151.33421776 -52.99414062 150.00390625 C-69.11789313 148.52973459 -84.21893993 141.32220183 -96.38671875 130.78515625 C-97.57587891 129.88990234 -97.57587891 129.88990234 -98.7890625 128.9765625 C-110.7870353 118.8549644 -120.05879659 102.30463729 -122.38671875 86.78515625 C-122.63059485 81.90763435 -122.11334226 78.84206317 -119.32421875 74.78515625 C-115.64355278 72.27917091 -112.82055669 71.48956705 -108.38671875 71.78515625 C-103.4973756 73.44568788 -101.73239674 75.29666971 -99.38671875 79.78515625 C-98.7287394 81.81012127 -98.1273875 83.8540861 -97.57421875 85.91015625 C-93.23884106 100.44352465 -85.40907027 111.00211817 -72.38671875 118.78515625 C-59.08122622 125.78999772 -45.24073522 128.30057789 -30.57421875 124.22265625 C-14.66601621 118.61147095 -4.26562277 107.30215975 3.61328125 92.78515625 C6.50005619 86.55955645 8.09777466 80.6156186 8.61328125 73.78515625 C7.88625 73.40746094 7.15921875 73.02976562 6.41015625 72.640625 C-11.91303882 62.60985026 -23.75991153 47.66557792 -30.38671875 27.78515625 C-31.57893343 11.30914028 -31.57893343 11.30914028 -26.38671875 4.78515625 C-19.15773598 -2.25846798 -9.36012086 -3.357552 0 0 Z M-6.38671875 23.78515625 C-5.82757518 28.25008211 -4.13211909 31.13738995 -1.63671875 34.84765625 C-0.96125 35.86988281 -0.28578125 36.89210938 0.41015625 37.9453125 C2.58125048 40.74386836 4.76158541 42.70621016 7.61328125 44.78515625 C4.90946714 35.56760815 1.15377402 29.75824322 -6.38671875 23.78515625 Z " fill="#A761FF" transform="translate(2295.38671875,943.21484375)"/>
<path d="M0 0 C1.04590805 0.00222061 2.0918161 0.00444122 3.16941833 0.00672913 C4.35056717 0.00680466 5.531716 0.00688019 6.74865723 0.00695801 C8.03404892 0.01211929 9.31944061 0.01728058 10.64378357 0.02259827 C11.95193527 0.02401321 13.26008698 0.02542816 14.60787964 0.02688599 C18.09150591 0.03071042 21.57509071 0.04054005 25.05870056 0.05158997 C28.6111444 0.06180569 32.16359491 0.06638395 35.71604919 0.07142639 C42.69067564 0.0821624 49.66527449 0.09923792 56.63987732 0.12025452 C55.88541239 4.56635231 54.5185049 8.76006152 53.08641052 13.02357483 C52.82589905 13.8070076 52.56538757 14.59044037 52.29698181 15.39761353 C51.4311384 17.99885596 50.56096483 20.59862714 49.69065857 23.19837952 C49.07521953 25.04350068 48.46000482 26.88869667 47.84500122 28.73396301 C46.54630435 32.62848588 45.24559458 36.52232864 43.94334412 40.41566467 C42.3191695 45.27162342 40.69871346 50.12881135 39.07968044 54.98648643 C32.25551409 75.45830699 25.36696475 95.90649937 18.37193298 116.32058334 C14.74093939 126.91956085 11.15261905 137.52968038 7.65940857 148.17494202 C7.29948318 149.26967834 6.9395578 150.36441467 6.56872559 151.49232483 C5.16059258 155.77869203 3.75440164 160.06561649 2.3603363 164.35658264 C1.30143903 167.61124888 0.23144219 170.86208321 -0.84059143 174.11244202 C-1.15304306 175.08390167 -1.46549469 176.05536133 -1.78741455 177.05625916 C-2.08235306 177.94475555 -2.37729156 178.83325195 -2.6811676 179.74867249 C-2.93428207 180.52435577 -3.18739655 181.30003906 -3.44818115 182.09922791 C-4.43741963 184.29155847 -5.56573029 185.54232284 -7.36012268 187.12025452 C-11.98040954 172.50369312 -16.28431128 157.80654628 -20.48268127 143.06385803 C-21.31975665 140.12802728 -22.16593937 137.19504804 -23.01979065 134.26405334 C-24.06462651 130.67703692 -25.09312939 127.08570449 -26.11041641 123.49078178 C-26.49629651 122.13732347 -26.88774654 120.78543894 -27.28515244 119.4353199 C-27.83915657 117.54905701 -28.37030444 115.65612772 -28.90065002 113.76307678 C-29.20755768 112.69436844 -29.51446533 111.6256601 -29.83067322 110.52456665 C-31.02078795 102.87223664 -28.88112433 95.56819592 -26.87574768 88.21009827 C-26.62361511 87.26429398 -26.37148254 86.31848969 -26.11170959 85.34402466 C-25.28426422 82.24684106 -24.44741819 79.15228839 -23.61012268 76.05775452 C-23.03054357 73.89837743 -22.45144928 71.73887015 -21.87281799 69.57923889 C-20.66303724 65.06950179 -19.44884445 60.56098452 -18.23121643 56.05335999 C-16.66734604 50.26334039 -15.11237591 44.47097706 -13.56037903 38.67776489 C-12.36727051 34.22654777 -11.17063558 29.77628516 -9.97279358 25.32633972 C-9.39780679 23.1894221 -8.82366895 21.05227587 -8.25038147 18.91490173 C-7.4518488 15.94074827 -6.64885123 12.9678382 -5.84449768 9.99525452 C-5.6065448 9.10596756 -5.36859192 8.2166806 -5.12342834 7.30044556 C-3.18304297 0.16218449 -3.18304297 0.16218449 0 0 Z " fill="#E8262A" transform="translate(298.36012268066406,57.87974548339844)"/>
<path d="M0 0 C6.90418489 4.55936738 11.06021505 11.71965205 12.71875 19.7890625 C14.57856045 34.40923908 11.19357308 47.78723103 3 60 C-4.0037998 68.94235153 -14.46294503 76.4664811 -26 78 C-36.16589706 78.71607358 -46.16054117 78.773451 -54.41796875 72.0234375 C-59.42564655 67.1487069 -59.42564655 67.1487069 -61 64 C-62.51894369 69.78965104 -63.69548544 75.56067673 -64.69140625 81.4609375 C-64.841577 82.33271637 -64.99174774 83.20449524 -65.14646912 84.10269165 C-65.78340981 87.80060084 -66.4133365 91.49969554 -67.04370117 95.19873047 C-67.50704928 97.91157798 -67.97411314 100.62376722 -68.44140625 103.3359375 C-68.58308731 104.17546967 -68.72476837 105.01500183 -68.8707428 105.87997437 C-69.88714164 111.77428329 -69.88714164 111.77428329 -71 114 C-74.63 114 -78.26 114 -82 114 C-81.3252038 107.29149207 -80.32410355 100.70070198 -79.14233398 94.06420898 C-78.95687012 93.00950912 -78.77140625 91.95480927 -78.58032227 90.8681488 C-77.97159641 87.41031789 -77.35887477 83.95320812 -76.74609375 80.49609375 C-76.3212908 78.08761383 -75.89673902 75.67908959 -75.47242737 73.27052307 C-74.35867608 66.95234498 -73.24152672 60.63477236 -72.12365723 54.31732178 C-70.98206914 47.86230224 -69.84371157 41.40671313 -68.70507812 34.95117188 C-66.47320494 22.30022322 -64.23773977 9.64991217 -62 -3 C-58.04 -3 -54.08 -3 -50 -3 C-50.33 0.96 -50.66 4.92 -51 9 C-49.88625 7.948125 -48.7725 6.89625 -47.625 5.8125 C-35.29181359 -5.00646957 -14.56740325 -8.92840844 0 0 Z M-46.234375 14.97265625 C-54.57123187 23.60725801 -58.38726706 34.56070049 -58.2109375 46.4453125 C-57.60965743 53.72748223 -54.22186457 59.02867944 -49 64 C-42.26223571 68.81268878 -35.04412498 68.63237052 -27 68 C-17.35294366 65.95155762 -9.51248985 59.10694609 -4.0625 51.0625 C1.21108684 41.5251621 3.11531996 30.14650009 0.34375 19.47265625 C-2.23614426 13.67901439 -6.87917535 9.77127886 -12.3125 6.6875 C-25.41417741 3.3359081 -36.05587467 5.98639284 -46.234375 14.97265625 Z " fill="#A761FF" transform="translate(1132,962)"/>
<path d="M0 0 C22.11 0 44.22 0 67 0 C67 15.51 67 31.02 67 47 C44.89 47 22.78 47 0 47 C0 31.49 0 15.98 0 0 Z " fill="#E8262A" transform="translate(140,0)"/>
<path d="M0 0 C22.11 0 44.22 0 67 0 C67 15.51 67 31.02 67 47 C44.89 47 22.78 47 0 47 C0 31.49 0 15.98 0 0 Z " fill="#E8262A" transform="translate(0,0)"/>
<path d="M0 0 C3.96 0 7.92 0 12 0 C8.22364448 23.2543998 4.19204386 46.46231532 0.09962463 69.66279602 C-0.3130201 72.00294953 -0.72510956 74.34320026 -1.13708496 76.68347168 C-1.7947721 80.41850785 -2.45412872 84.15324559 -3.11483574 87.88774872 C-3.36190414 89.28519638 -3.60853003 90.68272236 -3.85469246 92.0803299 C-4.19512378 94.01213033 -4.53757772 95.94357399 -4.88012695 97.875 C-5.16941826 99.51082031 -5.16941826 99.51082031 -5.46455383 101.1796875 C-5.8992124 103.46912957 -6.43481013 105.73924051 -7 108 C-10.63 108 -14.26 108 -18 108 C-17.67 103.71 -17.34 99.42 -17 95 C-18.258125 96.216875 -19.51625 97.43375 -20.8125 98.6875 C-30.37511803 107.20774734 -40.60713641 109.52360097 -53.1328125 109.27734375 C-60.71596135 108.73350176 -67.86926756 106.28170244 -73.43359375 100.9453125 C-80.54881333 92.10895501 -82.5528918 82.86440928 -81.7734375 71.77734375 C-80.13524555 58.3024119 -74.60516938 45.86657933 -64.42578125 36.67578125 C-52.51621849 27.48452097 -40.72469084 25.41926622 -26 27 C-18.07053424 28.77965433 -12.59294997 34.40705003 -7 40 C-4.69 26.8 -2.38 13.6 0 0 Z M-59 46 C-64.01284123 51.72220555 -67.15355515 57.64376372 -69 65 C-69.226875 65.804375 -69.45375 66.60875 -69.6875 67.4375 C-70.71926941 75.89800917 -70.41189274 82.99047494 -65.5234375 90.16796875 C-61.68435187 94.97997334 -58.12513238 97.92339823 -52 99 C-42.49203995 100.05200118 -34.13314759 98.666534 -26.265625 93.046875 C-20.73903874 88.37053278 -16.86231806 83.64383582 -14 77 C-13.52433594 75.97326172 -13.52433594 75.97326172 -13.0390625 74.92578125 C-10.02542934 67.44699437 -9.59989466 58.82906704 -11.84375 51.08984375 C-14.50500907 45.12898307 -18.16341438 40.98082765 -24 38 C-36.56098276 33.74414071 -49.34224839 37.09414947 -59 46 Z " fill="#A761FF" transform="translate(1682,931)"/>
<path d="M0 0 C1.51400391 0.01740234 1.51400391 0.01740234 3.05859375 0.03515625 C4.07050781 0.04417969 5.08242187 0.05320312 6.125 0.0625 C7.29869141 0.07990234 7.29869141 0.07990234 8.49609375 0.09765625 C8.31433594 1.20278564 8.13257813 2.30791504 7.9453125 3.4465332 C7.27201085 7.54428613 6.60184003 11.64254594 5.93261719 15.7409668 C5.64245704 17.51519546 5.35144641 19.28928524 5.05957031 21.06323242 C4.64034277 23.61210736 4.22416973 26.16146499 3.80859375 28.7109375 C3.67735107 29.50478348 3.5461084 30.29862946 3.41088867 31.11653137 C2.91959603 34.14524258 2.49609375 37.02367604 2.49609375 40.09765625 C2.94597656 39.65035156 3.39585938 39.20304688 3.859375 38.7421875 C14.2403435 28.98532532 24.98207637 26.60909972 38.734375 26.8203125 C46.67838165 27.13187257 53.12423856 29.83506384 58.9609375 35.2578125 C66.56785431 44.37449906 67.14709755 54.70508977 66.49609375 66.09765625 C64.60993014 79.02906606 58.74787289 91.58707821 48.3671875 99.77734375 C36.95809368 107.75378847 26.30124026 110.06080601 12.49609375 109.09765625 C4.20390216 107.48042137 -1.22534791 103.61822831 -6.50390625 97.09765625 C-6.83390625 96.43765625 -7.16390625 95.77765625 -7.50390625 95.09765625 C-8.49390625 99.38765625 -9.48390625 103.67765625 -10.50390625 108.09765625 C-14.13390625 108.09765625 -17.76390625 108.09765625 -21.50390625 108.09765625 C-20.92637463 100.99852619 -20.10395697 94.05995747 -18.84570312 87.05224609 C-18.68135269 86.11590332 -18.51700226 85.17956055 -18.34767151 84.21484375 C-17.81054925 81.16193709 -17.26683466 78.11024989 -16.72265625 75.05859375 C-16.34505072 72.92441789 -15.96773601 70.79019055 -15.59069824 68.65591431 C-14.80348516 64.20579034 -14.01303974 59.75625641 -13.22021484 55.30712891 C-12.20212993 49.59259138 -11.19180825 43.87671334 -10.18379974 38.16039085 C-9.40780443 33.76429468 -8.62797639 29.36888533 -7.84693909 24.9736824 C-7.47259993 22.86465285 -7.09941957 20.75541728 -6.72740173 18.64597702 C-6.20951031 15.71298663 -5.68652939 12.78095016 -5.16210938 9.84912109 C-5.00831314 8.97232697 -4.85451691 8.09553284 -4.69606018 7.19216919 C-3.42383739 0.133535 -3.42383739 0.133535 0 0 Z M6.78515625 46.69140625 C-0.79426332 54.84793898 -5.12691588 65.91022434 -4.75 77.0625 C-3.87323981 84.31316763 -1.11144456 90.34049188 4.49609375 95.09765625 C11.24922259 99.70888362 18.54484417 100.03594239 26.49609375 99.09765625 C36.27655893 96.76963003 43.46033477 90.39676566 49.1796875 82.32421875 C54.18077876 73.8653997 56.61457343 64.0771684 54.80859375 54.34765625 C53.07988437 47.84496136 49.31677604 42.57526728 43.49609375 39.09765625 C30.08603165 33.79304308 17.26397984 36.93031031 6.78515625 46.69140625 Z " fill="#A761FF" transform="translate(1761.50390625,930.90234375)"/>
<path d="M0 0 C3.96 0 7.92 0 12 0 C12.20681396 1.83216064 12.41362793 3.66432129 12.62670898 5.55200195 C13.31054251 11.60324083 13.99737089 17.65413388 14.68624783 23.70480061 C15.10383056 27.37356491 15.52020722 31.04245777 15.93383789 34.71166992 C16.33300642 38.25219489 16.73532953 41.79234837 17.13984871 45.33226585 C17.29367704 46.68333353 17.4463654 48.0345315 17.59789848 49.38585854 C17.81021908 51.27751768 18.02695769 53.16867937 18.24389648 55.05981445 C18.36603012 56.13681107 18.48816376 57.21380768 18.61399841 58.32344055 C18.93270351 61.09407007 18.93270351 61.09407007 20 64 C30.56 42.88 41.12 21.76 52 0 C55.96 0 59.92 0 64 0 C64.34780518 2.37517822 64.34780518 2.37517822 64.70263672 4.79833984 C65.5685074 10.7066039 66.43780437 16.61435972 67.30810547 22.52197266 C67.68338097 25.07261776 68.05774318 27.62339741 68.43115234 30.17431641 C68.9698926 33.8535532 69.51198047 37.532284 70.0546875 41.2109375 C70.21935516 42.34050873 70.38402283 43.47007996 70.55368042 44.63388062 C71.51638248 51.13370997 72.63481321 57.57227846 74 64 C76.95974536 57.62565466 79.91781405 51.25053309 82.875 44.875 C83.30907166 43.93938232 83.74314331 43.00376465 84.19036865 42.03979492 C89.62248211 30.32867039 95.04404543 18.61418747 100.31982422 6.83154297 C102.89703172 1.10296828 102.89703172 1.10296828 104 0 C105.85287502 -0.07226502 107.70833878 -0.0838122 109.5625 -0.0625 C110.57441406 -0.05347656 111.58632812 -0.04445313 112.62890625 -0.03515625 C113.41136719 -0.02355469 114.19382812 -0.01195312 115 0 C113.34336967 5.61756141 110.82100563 10.68882901 108.23046875 15.91796875 C107.75729218 16.88099915 107.2841156 17.84402954 106.79660034 18.83624268 C105.26354757 21.95497124 103.72547474 25.0711962 102.1875 28.1875 C100.09473473 32.44191295 98.00452524 36.69758031 95.9140625 40.953125 C95.4010408 41.99653549 94.8880191 43.03994598 94.35945129 44.11497498 C90.22054841 52.53679501 86.12382614 60.97803171 82.0625 69.4375 C81.53229248 70.54182373 81.00208496 71.64614746 80.45581055 72.78393555 C79.30251261 75.18863806 78.15098841 77.5941912 77 80 C73.04 80 69.08 80 65 80 C64.7326001 78.30472168 64.4652002 76.60944336 64.18969727 74.86279297 C63.30382911 69.24690866 62.41772036 63.63106236 61.53144932 58.01524162 C60.99438061 54.6120707 60.45740697 51.20888484 59.9206543 47.80566406 C59.3028586 43.88862657 58.68464275 39.97165544 58.06640625 36.0546875 C57.87470352 34.83884979 57.68300079 33.62301208 57.48548889 32.37033081 C57.21532204 30.6592363 57.21532204 30.6592363 56.93969727 28.91357422 C56.70320213 27.41466141 56.70320213 27.41466141 56.46192932 25.88546753 C55.98742143 22.92142724 55.49662973 19.96040711 55 17 C52.2681472 22.29028391 49.53949805 27.58221207 46.8125 32.875 C46.40660645 33.66244598 46.00071289 34.44989197 45.58251953 35.26119995 C41.33775803 43.49990186 37.10437922 51.74296752 32.98046875 60.04296875 C32.67881302 60.64981506 32.37715729 61.25666138 32.06636047 61.88189697 C30.66620581 64.70236283 29.27269031 67.52592157 27.88598633 70.35302734 C27.39767334 71.34125488 26.90936035 72.32948242 26.40625 73.34765625 C25.98666016 74.20367432 25.56707031 75.05969238 25.13476562 75.94165039 C24 78 24 78 22 80 C19.3984375 80.1953125 19.3984375 80.1953125 16.375 80.125 C15.37210938 80.10695313 14.36921875 80.08890625 13.3359375 80.0703125 C12.56507812 80.04710937 11.79421875 80.02390625 11 80 C8.15627278 62.39008675 5.68050769 44.73342955 3.25 27.0625 C3.08966278 25.9015683 2.92932556 24.7406366 2.76412964 23.54452515 C2.30392521 20.2083888 1.84672285 16.87185624 1.390625 13.53515625 C1.25018265 12.51743134 1.1097403 11.49970642 0.96504211 10.45114136 C0.83768173 9.51343903 0.71032135 8.57573669 0.57910156 7.60961914 C0.46681213 6.78869278 0.35452271 5.96776642 0.23883057 5.1219635 C0 3 0 3 0 0 Z " fill="#A761FF" transform="translate(1252,959)"/>
<path d="M0 0 C0.79140381 -0.01401855 1.58280762 -0.02803711 2.39819336 -0.04248047 C11.83353691 0.03379239 18.64311662 2.68877477 25.48828125 9.1875 C30.96973578 15.33903213 32.57135707 22.01418936 32.625 30.125 C32.63917969 31.08921875 32.65335938 32.0534375 32.66796875 33.046875 C32.37947023 37.21298929 31.34342143 41.29835358 30.4375 45.375 C8.6575 45.375 -13.1225 45.375 -35.5625 45.375 C-35.5625 52.93680933 -34.70977541 58.71667893 -30.875 65.25 C-25.34672934 70.3300325 -19.03821209 72.48657779 -11.5625 72.375 C-1.46848339 71.35460952 5.53046026 68.1065528 11.9921875 60.27734375 C13.20047672 58.68697388 14.32959287 57.03686069 15.4375 55.375 C18.2578125 55.08203125 18.2578125 55.08203125 21.5625 55.1875 C23.20605469 55.22810547 23.20605469 55.22810547 24.8828125 55.26953125 C26.14738281 55.32173828 26.14738281 55.32173828 27.4375 55.375 C23.15594422 66.5409957 14.54359625 74.73070705 3.75 79.6875 C-5.79114418 83.82141439 -18.74518229 84.05496472 -28.625 80.8125 C-36.94397389 77.18951744 -41.9738966 71.95808678 -45.6640625 63.7109375 C-46.7675459 60.84188066 -47.37395497 58.4545689 -47.5625 55.375 C-47.624375 54.63378906 -47.68625 53.89257812 -47.75 53.12890625 C-48.46809359 38.02650043 -43.26683896 25.11888385 -33.8125 13.625 C-24.46537037 3.56706203 -13.34801756 0.16260758 0 0 Z M-26.3515625 20.296875 C-30.06218727 25.01284146 -33.5625 30.21210696 -33.5625 36.375 C-15.7425 36.375 2.0775 36.375 20.4375 36.375 C21.53922554 28.6629212 21.29605737 24.82660654 17.6875 18.125 C13.22593872 12.67198065 8.22024043 10.45015064 1.4375 9.375 C-8.99250874 8.40925845 -19.2427993 12.66038702 -26.3515625 20.296875 Z " fill="#A761FF" transform="translate(1557.5625,957.625)"/>
<path d="M0 0 C0.83909912 -0.02247803 1.67819824 -0.04495605 2.54272461 -0.06811523 C11.64351732 -0.03334876 18.58966738 3.37065803 25.2109375 9.50390625 C30.6282465 15.57080208 32.08167401 22.25017863 32.125 30.1875 C32.13917969 31.35796875 32.15335938 32.5284375 32.16796875 33.734375 C31.9375 37.4375 31.9375 37.4375 29.9375 45.4375 C8.1575 45.4375 -13.6225 45.4375 -36.0625 45.4375 C-35.59116683 57.57479442 -35.59116683 57.57479442 -29.40625 66.96484375 C-22.5865058 71.7861793 -14.61249256 73.04655494 -6.4375 71.9375 C3.42140425 69.74037277 9.50612921 63.58455618 14.9375 55.4375 C17.7578125 55.14453125 17.7578125 55.14453125 21.0625 55.25 C22.70605469 55.29060547 22.70605469 55.29060547 24.3828125 55.33203125 C25.64738281 55.38423828 25.64738281 55.38423828 26.9375 55.4375 C24.79840794 64.70689894 17.76083723 71.52726723 9.9375 76.4375 C-1.27924 83.06259204 -14.83874478 84.58489569 -27.5 81.375 C-35.41710126 78.50938254 -41.44296159 73.38064297 -45.12890625 65.8046875 C-49.70042944 54.21329397 -48.55335452 41.80462723 -44.29296875 30.25390625 C-42.2959779 25.68301609 -39.89759056 21.53659819 -37.0625 17.4375 C-36.62292969 16.80070313 -36.18335938 16.16390625 -35.73046875 15.5078125 C-26.77739002 3.89719167 -13.95667322 0.24377911 0 0 Z M-29.49609375 24.1796875 C-32.1892291 27.98756386 -34.0625 31.75567685 -34.0625 36.4375 C-16.2425 36.4375 1.5775 36.4375 19.9375 36.4375 C22.08879144 32.13491712 21.10779923 27.35240581 19.875 22.875 C17.77488452 17.14119634 14.20430579 13.96123981 8.7265625 11.40625 C-6.22597363 5.89473497 -19.82610524 12.42814834 -29.49609375 24.1796875 Z " fill="#A761FF" transform="translate(1415.0625,957.5625)"/>
<path d="M0 0 C6.2402498 4.74629169 10.17941814 11.86242142 11.75 19.50390625 C13.46971338 33.02276417 10.97945698 46.50624983 3.03125 57.71484375 C-4.85487547 67.24710221 -15.24860916 75.37808018 -27.96875 76.71484375 C-39.55785894 77.50641576 -49.94451967 77.09953456 -59.34375 69.46484375 C-67.08461223 62.02536755 -69.97763102 54.07885724 -70.28125 43.46484375 C-70.01918719 29.29707304 -65.2248603 17.31239541 -55.48828125 7.04296875 C-40.98553458 -6.35801887 -17.21290754 -11.23620353 0 0 Z M-49.21875 15.90234375 C-57.5450072 26.29277056 -58.85850613 37.92777711 -57.96875 50.71484375 C-56.40074059 57.04355643 -52.23027479 61.09156645 -46.96875 64.71484375 C-39.56852929 68.69957798 -31.75686121 68.02151363 -23.96875 65.71484375 C-12.86606291 61.42337959 -7.20679293 53.93724394 -1.859375 43.5625 C1.32640641 35.7332919 1.32209677 25.79347826 -0.7421875 17.671875 C-3.59964738 10.9740701 -8.35658142 7.51468388 -14.96875 4.71484375 C-27.98551566 1.54334479 -40.18531313 6.29279484 -49.21875 15.90234375 Z " fill="#A761FF" transform="translate(1225.96875,963.28515625)"/>
<path d="M0 0 C0 16.83 0 33.66 0 51 C-7.92 51 -15.84 51 -24 51 C-32.7201128 52.88935777 -38.3308165 55.25070388 -45 61 C-45.99 61.66 -46.98 62.32 -48 63 C-48.1269815 56.13171166 -48.21442746 49.26372702 -48.2746582 42.39453125 C-48.29977181 40.0588042 -48.33386928 37.72315549 -48.37719727 35.38769531 C-48.43798492 32.02649586 -48.46624212 28.66633715 -48.48828125 25.3046875 C-48.51408768 24.26384003 -48.5398941 23.22299255 -48.56648254 22.15060425 C-48.56960703 14.03801911 -48.56960703 14.03801911 -45.66723633 10.42138672 C-35.88344452 1.53940529 -12.96898445 -6.48449222 0 0 Z " fill="#E8262A" transform="translate(487,55)"/>
<path d="M0 0 C4.29 0 8.58 0 13 0 C17.62 20.79 22.24 41.58 27 63 C29.92204678 60.07795322 31.41674569 57.7030962 33.37109375 54.1015625 C33.68962814 53.51867966 34.00816254 52.93579681 34.33634949 52.33525085 C35.01958342 51.0840431 35.70054918 49.8315946 36.37945557 48.57803345 C38.16521291 45.28172214 39.96837969 41.99494816 41.76953125 38.70703125 C42.12932068 38.04924179 42.48911011 37.39145233 42.85980225 36.71372986 C46.0551373 30.87906762 49.31891631 25.08516305 52.625 19.3125 C53.08447021 18.50828613 53.54394043 17.70407227 54.01733398 16.87548828 C54.89079327 15.35360735 55.77226577 13.83629078 56.66259766 12.32421875 C57.62849664 10.64562103 58.55004428 8.94123457 59.44287109 7.22265625 C63.21762162 0.23794963 63.21762162 0.23794963 67.2109375 -0.9765625 C68.77714844 -0.80253906 68.77714844 -0.80253906 70.375 -0.625 C71.43460938 -0.53476562 72.49421875 -0.44453125 73.5859375 -0.3515625 C74.38257813 -0.23554687 75.17921875 -0.11953125 76 0 C71.71079321 8.96188571 67.00790206 17.54505441 61.921875 26.07421875 C58.46974611 31.86817777 55.11276841 37.71637703 51.75 43.5625 C46.29459035 53.03667315 40.80544528 62.49025725 35.28808594 71.9284668 C32.17758049 77.25390914 29.07940469 82.5861995 26 87.9296875 C25.66508545 88.51083313 25.3301709 89.09197876 24.98510742 89.69073486 C23.37126114 92.49211183 21.75903111 95.29440788 20.1484375 98.09765625 C18.98971689 100.11137995 17.82414455 102.12118075 16.65087891 104.12646484 C15.5469876 106.0479083 14.48138448 107.99184195 13.45458984 109.95556641 C9.77392146 116.76462243 9.77392146 116.76462243 5.7890625 117.9765625 C4.22285156 117.80253906 4.22285156 117.80253906 2.625 117.625 C1.56539062 117.53476563 0.50578125 117.44453125 -0.5859375 117.3515625 C-1.78089844 117.17753906 -1.78089844 117.17753906 -3 117 C-1.38422964 110.81657113 1.96661979 105.72236471 5.25 100.3125 C6.38211883 98.43474428 7.51233068 96.5558375 8.640625 94.67578125 C9.14110352 93.84989502 9.64158203 93.02400879 10.15722656 92.1730957 C10.7653418 91.12597412 11.37345703 90.07885254 12 89 C12.54898956 88.27916733 13.09797913 87.55833466 13.66360474 86.81565857 C17.08757434 81.80676031 18.47274048 78.11032247 17.48400307 71.99763107 C16.67116371 68.08475026 15.67575231 64.23227159 14.6484375 60.37109375 C14.23266159 58.68856219 13.82058012 57.00511379 13.41201782 55.32081604 C12.33307271 50.91448263 11.20610266 46.52189081 10.06787109 42.1305542 C8.91396282 37.64553879 7.80398097 33.14971031 6.69140625 28.65429688 C5.44108655 23.60982374 4.18631076 18.56684188 2.89828491 13.53184509 C2.70374725 12.76981781 2.50920959 12.00779053 2.30877686 11.22267151 C1.94424061 9.79781846 1.57774426 8.37346492 1.20895386 6.94970703 C0 2.22091063 0 2.22091063 0 0 Z " fill="#A761FF" transform="translate(1842,959)"/>
<path d="M0 0 C-0.66 3.96 -1.32 7.92 -2 12 C-2.89460938 12.07476563 -3.78921875 12.14953125 -4.7109375 12.2265625 C-13.01975997 13.13008051 -19.64378941 14.35950213 -26 20 C-33.88288967 30.42662022 -34.7248878 44.71820038 -36.8125 57.1875 C-37.39926469 60.5925606 -37.99126664 63.99664928 -38.58659363 67.40022278 C-38.95331811 69.50698547 -39.31410428 71.61479205 -39.66841125 73.72367859 C-39.82915634 74.6658876 -39.98990143 75.60809662 -40.15551758 76.57885742 C-40.29508377 77.41092209 -40.43464996 78.24298676 -40.57844543 79.1002655 C-41 81 -41 81 -42 82 C-45.66655195 82.14300125 -49.33144219 82.04216733 -53 82 C-51.68349193 72.36118721 -50.144659 62.78775958 -48.43359375 53.2109375 C-48.19206021 51.85050331 -47.9506951 50.49003921 -47.70948792 49.12954712 C-47.2092424 46.31087332 -46.7074269 43.49248544 -46.2043457 40.67431641 C-45.56067274 37.0681869 -44.92038925 33.46146549 -44.28117275 29.85454369 C-43.7855542 27.05938357 -43.28851204 24.26447815 -42.79100227 21.46965408 C-42.43974983 19.49553604 -42.08942685 17.52125269 -41.73912048 15.54696655 C-41.52542313 14.35116974 -41.31172577 13.15537292 -41.09155273 11.92333984 C-40.90439194 10.87302582 -40.71723114 9.82271179 -40.5243988 8.74057007 C-40.09146744 6.47801963 -39.5587046 4.23481839 -39 2 C-35.37 2 -31.74 2 -28 2 C-28 5.3 -28 8.6 -28 12 C-26.865625 10.9275 -25.73125 9.855 -24.5625 8.75 C-17.15647533 2.26316279 -9.73999439 0 0 0 Z M-30 13 C-29 15 -29 15 -29 15 Z " fill="#A761FF" transform="translate(1509,957)"/>
<path d="M0 0 C4.34757007 3.6398261 7.36207363 6.89970889 7.92578125 12.703125 C8.13566047 20.61225767 6.99638838 24.64915088 1.5625 30.5625 C-3.2400064 33.38136245 -8.1393918 34.60600726 -13.71484375 33.98046875 C-19.92453462 32.33516604 -23.86645224 28.59342524 -27.3125 23.25 C-28.9612472 18.2270725 -28.76645476 13.63575662 -27.125 8.625 C-24.08279846 2.96021092 -20.56176846 -0.30448683 -14.4921875 -2.30859375 C-9.15064787 -3.39030339 -4.77212367 -2.52112194 0 0 Z " fill="#FFD877" transform="translate(2192.3125,965.75)"/>
    </svg>
  );
};
export const OnyxSparkleIcon = ({
  size = 16,
  className = defaultTailwindCSS,
}: IconProps) => {
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 16 16`}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={`w-[${size}px] h-[${size}px] ` + className}
    >
      <path
        d="M4 2L8 4L12 2M12 14L8 12L4 14M2 12L4 7.99999L2 3.99999M14 3.99999L12 7.99999L14 12"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
};
export const OpenIcon = ({
  size = 16,
  className = defaultTailwindCSS,
}: IconProps) => {
  return (
    <svg
      style={{ width: `${size}px`, height: `${size}px` }}
      className={`w-[${size}px] h-[${size}px] ` + className}
      xmlns="http://www.w3.org/2000/svg"
      width="200"
      height="200"
      viewBox="0 0 14 14"
    >
      <path
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M7 13.5a9.26 9.26 0 0 0-5.61-2.95a1 1 0 0 1-.89-1V1.5A1 1 0 0 1 1.64.51A9.3 9.3 0 0 1 7 3.43zm0 0a9.26 9.26 0 0 1 5.61-2.95a1 1 0 0 0 .89-1V1.5a1 1 0 0 0-1.14-.99A9.3 9.3 0 0 0 7 3.43z"
      />
    </svg>
  );
};
export const PackageIcon = ({
  size = 16,
  className = defaultTailwindCSS,
}: IconProps) => {
  return (
    <svg
      style={{ width: `${size}px`, height: `${size}px` }}
      className={`w-[${size}px] h-[${size}px] ` + className}
      xmlns="http://www.w3.org/2000/svg"
      width="200"
      height="200"
      viewBox="0 0 20 20"
    >
      <g fill="currentColor">
        <path d="M2 3a1 1 0 0 0-1 1v1a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1V4a1 1 0 0 0-1-1H2Z" />
        <path
          fillRule="evenodd"
          d="M2 7.5h16l-.811 7.71a2 2 0 0 1-1.99 1.79H4.802a2 2 0 0 1-1.99-1.79L2 7.5ZM7 11a1 1 0 0 1 1-1h4a1 1 0 1 1 0 2H8a1 1 0 0 1-1-1Z"
          clipRule="evenodd"
        />
      </g>
    </svg>
  );
};
export const PackageIconSkeleton = ({
  size = 16,
  className = defaultTailwindCSS,
}: IconProps) => {
  return (
    <svg
      style={{ width: `${size}px`, height: `${size}px` }}
      className={`w-[${size}px] h-[${size}px] ` + className}
      xmlns="http://www.w3.org/2000/svg"
      width="200"
      height="200"
      viewBox="0 0 24 24"
    >
      <path
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.5"
        d="m20.25 7.5l-.625 10.632a2.25 2.25 0 0 1-2.247 2.118H6.622a2.25 2.25 0 0 1-2.247-2.118L3.75 7.5M10 11.25h4M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125Z"
      />
    </svg>
  );
};
export const PaintingIcon = ({
  size = 16,
  className = defaultTailwindCSS,
}: IconProps) => {
  return (
    <svg
      style={{ width: `${size}px`, height: `${size}px` }}
      className={`w-[${size}px] h-[${size}px] ` + className}
      xmlns="http://www.w3.org/2000/svg"
      width="200"
      height="200"
      viewBox="0 0 36 36"
    >
      <path
        fill="currentColor"
        d="M32 4H4a2 2 0 0 0-2 2v24a2 2 0 0 0 2 2h28a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2ZM8.92 8a3 3 0 1 1-3 3a3 3 0 0 1 3-3ZM6 27v-4.1l6-6.08a1 1 0 0 1 1.41 0L16 19.35L8.32 27Zm24 0H11.15l6.23-6.23l5.4-5.4a1 1 0 0 1 1.41 0L30 21.18Z"
      />
      <path fill="none" d="M0 0h36v36H0z" />
    </svg>
  );
};
export const PaintingIconSkeleton = ({
  size = 16,
  className = defaultTailwindCSS,
}: IconProps) => {
  return (
    <svg
      style={{ width: `${size}px`, height: `${size}px` }}
      className={`w-[${size}px] h-[${size}px] ` + className}
      xmlns="http://www.w3.org/2000/svg"
      width="200"
      height="200"
      viewBox="0 0 14 14"
    >
      <g
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M1.5 12h11a1 1 0 0 0 1-1V3a1 1 0 0 0-1-1h-11a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1" />
        <path d="M9.502 6.212a1.245 1.245 0 1 0 0-2.49a1.245 1.245 0 0 0 0 2.49M9.083 12a7.098 7.098 0 0 0-7.136-5.786A7.6 7.6 0 0 0 .5 6.349" />
        <path d="M13.5 8.94a7.716 7.716 0 0 0-5.506.225" />
      </g>
    </svg>
  );
};
export const PinIcon = ({
  size = 16,
  className = defaultTailwindCSS,
}: IconProps) => {
  return (
    <svg
      style={{ width: `${size}px`, height: `${size}px` }}
      className={`w-[${size}px] h-[${size}px] ` + className}
      xmlns="http://www.w3.org/2000/svg"
      width="200"
      height="200"
      viewBox="0 0 24 24"
    >
      <path
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.5"
        d="m17.942 6.076l2.442 2.442a1.22 1.22 0 0 1-.147 1.855l-1.757.232a1.697 1.697 0 0 0-.94.452c-.72.696-1.453 1.428-2.674 2.637c-.21.212-.358.478-.427.769l-.94 3.772a1.22 1.22 0 0 1-1.978.379l-3.04-3.052l-3.052-3.04a1.221 1.221 0 0 1 .379-1.978l3.747-.964a1.8 1.8 0 0 0 .77-.44c1.379-1.355 1.88-1.855 2.66-2.698c.233-.25.383-.565.428-.903l.232-1.783a1.221 1.221 0 0 1 1.856-.146zm-9.51 9.498L3.256 20.75"
      />
    </svg>
  );
};
export const PinnedIcon = ({
  size = 16,
  className = defaultTailwindCSS,
}: IconProps) => {
  return (
    <svg
      style={{ width: `${size}px`, height: `${size}px` }}
      className={`w-[${size}px] h-[${size}px] ` + className}
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 14 14"
      fill="none"
    >
      <path
        d="M5.33165 8.74445L1 13M2.33282 5.46113L8.4591 11.4798L9.58999 10.3688L9.32809 7.88941L13 4.83L9.10152 1L5.98673 4.6074L3.46371 4.3501L2.33282 5.46113Z"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
};
export const PlugIcon = ({
  size = 16,
  className = defaultTailwindCSS,
}: IconProps) => {
  return <Plug size={size} className={className} />;
};
export const PlusCircleIcon = ({
  size = 16,
  className = defaultTailwindCSS,
}: IconProps) => {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="200"
      height="200"
      viewBox="0 0 24 24"
      style={{ width: `${size}px`, height: `${size}px` }}
      className={`w-[${size}px] h-[${size}px] ` + className}
    >
      <path
        fill="currentColor"
        fillRule="evenodd"
        d="M12 2.25c-5.385 0-9.75 4.365-9.75 9.75s4.365 9.75 9.75 9.75s9.75-4.365 9.75-9.75S17.385 2.25 12 2.25ZM12.75 9a.75.75 0 0 0-1.5 0v2.25H9a.75.75 0 0 0 0 1.5h2.25V15a.75.75 0 0 0 1.5 0v-2.25H15a.75.75 0 0 0 0-1.5h-2.25V9Z"
        clipRule="evenodd"
      />
    </svg>
  );
};
export const PlusIcon = ({
  size = 16,
  className = defaultTailwindCSS,
}: IconProps) => {
  return (
    <svg
      style={{ width: `${size}px`, height: `${size}px` }}
      className={`w-[${size}px] h-[${size}px] ` + className}
      xmlns="http://www.w3.org/2000/svg"
      width="200"
      height="200"
      viewBox="0 0 16 16"
    >
      <path
        fill="currentColor"
        d="M8.75 3.75a.75.75 0 0 0-1.5 0v3.5h-3.5a.75.75 0 0 0 0 1.5h3.5v3.5a.75.75 0 0 0 1.5 0v-3.5h3.5a.75.75 0 0 0 0-1.5h-3.5z"
      />
    </svg>
  );
};
export const QuestionIcon = ({
  size = 16,
  className = defaultTailwindCSS,
}: IconProps) => {
  return <Question size={size} className={className} />;
};
export const QuestionMarkIcon = ({
  size = 16,
  className = defaultTailwindCSS,
}: IconProps) => {
  return (
    <svg
      style={{ width: `${size}px`, height: `${size}px` }}
      className={`w-[${size}px] h-[${size}px] ` + className}
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="10" />
      <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
};
export const RightToLineIcon = ({
  size = 16,
  className = defaultTailwindCSS,
}: IconProps) => {
  return (
    <svg
      style={{ width: `${size}px`, height: `${size}px` }}
      className={`w-[${size}px] h-[${size}px] ` + className}
      xmlns="http://www.w3.org/2000/svg"
      width="200"
      height="200"
      viewBox="0 0 24 24"
    >
      <path
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
        d="M17 12H3m8 6l6-6l-6-6m10-1v14"
      />
    </svg>
  );
};
export const RobotIcon = ({
  size = 16,
  className = defaultTailwindCSS,
}: IconProps) => {
  return <FaRobot size={size} className={className} />;
};
export const SearchAssistantIcon = ({
  size = 24,
  className = defaultTailwindCSS,
}: IconProps) => {
  return (
    <svg
      style={{ width: `${size}px`, height: `${size}px` }}
      className={`w-[${size}px] h-[${size}px] ` + className}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect
        x="0.65"
        y="0.65"
        width="22.7"
        height="22.7"
        rx="11.35"
        stroke="currentColor"
        strokeWidth="1.3"
      />
      <path
        d="M17.0667 18L12.8667 13.8C12.5333 14.0667 12.15 14.2778 11.7167 14.4333C11.2833 14.5889 10.8222 14.6667 10.3333 14.6667C9.12222 14.6667 8.09733 14.2471 7.25867 13.408C6.42 12.5689 6.00044 11.544 6 10.3333C5.99956 9.12267 6.41911 8.09778 7.25867 7.25867C8.09822 6.41956 9.12311 6 10.3333 6C11.5436 6 12.5687 6.41956 13.4087 7.25867C14.2487 8.09778 14.668 9.12267 14.6667 10.3333C14.6667 10.8222 14.5889 11.2833 14.4333 11.7167C14.2778 12.15 14.0667 12.5333 13.8 12.8667L18 17.0667L17.0667 18ZM10.3333 13.3333C11.1667 13.3333 11.8751 13.0418 12.4587 12.4587C13.0422 11.8756 13.3338 11.1671 13.3333 10.3333C13.3329 9.49956 13.0413 8.79133 12.4587 8.20867C11.876 7.626 11.1676 7.33422 10.3333 7.33333C9.49911 7.33244 8.79089 7.62422 8.20867 8.20867C7.62644 8.79311 7.33467 9.50133 7.33333 10.3333C7.332 11.1653 7.62378 11.8738 8.20867 12.4587C8.79356 13.0436 9.50178 13.3351 10.3333 13.3333Z"
        fill="currentColor"
      />
    </svg>
  );
};
export const SearchIcon = ({
  size = 16,
  className = defaultTailwindCSS,
}: IconProps) => {
  return (
    <svg
      style={{ width: `${size}px`, height: `${size}px` }}
      className={`w-[${size}px] h-[${size}px] ` + className}
      fill="none"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
      stroke="currentColor"
    >
      <path d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path>
    </svg>
  );
};
export const SendIcon = ({
  size = 16,
  className = defaultTailwindCSS,
}: IconProps) => {
  return (
    <svg
      style={{ width: `${size}px`, height: `${size}px` }}
      className={`w-[${size}px] h-[${size}px] ` + className}
      xmlns="http://www.w3.org/2000/svg"
      width="200"
      height="200"
      viewBox="0 0 24 24"
    >
      <path
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
        d="M12 19V5m-7 7l7-7l7 7"
      />
    </svg>
  );
};
export const SettingsIcon = ({
  size = 16,
  className = defaultTailwindCSS,
}: IconProps) => {
  return (
    <svg
      style={{ width: `${size}px`, height: `${size}px` }}
      className={`w-[${size}px] h-[${size}px] ` + className}
      xmlns="http://www.w3.org/2000/svg"
      width="200"
      height="200"
      viewBox="0 0 24 24"
    >
      <path
        fill="currentColor"
        d="m21.51 14.59l-1.25-1.32a7.878 7.878 0 0 0-.06-2.9l1.22-1.32a.76.76 0 0 0 .14-.79a10.257 10.257 0 0 0-2.2-3.35a.74.74 0 0 0-.72-.19l-1.84.47a8.48 8.48 0 0 0-1.83-1l-.45-1.72a.73.73 0 0 0-.59-.55a9.92 9.92 0 0 0-1.89-.17a9.36 9.36 0 0 0-2.35.31a.73.73 0 0 0-.53.53l-.48 1.77a8.23 8.23 0 0 0-1.52.88l-1.82-.45a.73.73 0 0 0-.72.21a10 10 0 0 0-2.23 3.62a.76.76 0 0 0 .16.77l1.26 1.31a8.85 8.85 0 0 0-.1 1.27c0 .3 0 .6.05.9l-1.31 1.46a.75.75 0 0 0-.16.73a10 10 0 0 0 2 3.59a.75.75 0 0 0 .76.24l1.72-.44a7.918 7.918 0 0 0 2 1.23l.5 1.79a.77.77 0 0 0 .56.53c.721.163 1.459.247 2.2.25c.59-.006 1.178-.063 1.76-.17a.75.75 0 0 0 .59-.53l.47-1.69a8.109 8.109 0 0 0 2.38-1.34l1.76.4a.74.74 0 0 0 .73-.24a10.118 10.118 0 0 0 2-3.34a.76.76 0 0 0-.21-.75m-9.39 1.27a3.81 3.81 0 1 1-.021-7.619a3.81 3.81 0 0 1 .02 7.62"
      />
    </svg>
  );
};
export const SettingsIconSkeleton = ({
  size = 16,
  className = defaultTailwindCSS,
}: IconProps) => {
  return (
    <svg
      style={{ width: `${size}px`, height: `${size}px` }}
      className={`w-[${size}px] h-[${size}px] ` + className}
      xmlns="http://www.w3.org/2000/svg"
      width="200"
      height="200"
      viewBox="0 0 24 24"
    >
      <g fill="none" stroke="currentColor" strokeWidth="1.5">
        <path strokeLinecap="round" d="M4 18V6m16 0v12" />
        <path d="M12 10c4.418 0 8-1.79 8-4s-3.582-4-8-4s-8 1.79-8 4s3.582 4 8 4Zm8 2c0 2.21-3.582 4-8 4s-8-1.79-8-4m16 6c0 2.21-3.582 4-8 4s-8-1.79-8-4" />
      </g>
    </svg>
  );
};
export const ShieldIcon = ({
  size = 16,
  className = defaultTailwindCSS,
}: IconProps) => {
  return (
    <svg
      style={{ width: `${size}px`, height: `${size}px` }}
      className={`w-[${size}px] h-[${size}px] ` + className}
      xmlns="http://www.w3.org/2000/svg"
      width="200"
      height="200"
      viewBox="0 0 16 16"
    >
      <path
        fill="currentColor"
        fillRule="evenodd"
        d="M8.5 1.709a.75.75 0 0 0-1 0a8.963 8.963 0 0 1-4.84 2.217a.75.75 0 0 0-.654.72a10.499 10.499 0 0 0 5.647 9.672a.75.75 0 0 0 .694-.001a10.499 10.499 0 0 0 5.647-9.672a.75.75 0 0 0-.654-.719A8.963 8.963 0 0 1 8.5 1.71m2.34 5.504a.75.75 0 0 0-1.18-.926L7.394 9.17l-1.156-.99a.75.75 0 1 0-.976 1.138l1.75 1.5a.75.75 0 0 0 1.078-.106z"
        clipRule="evenodd"
      />
    </svg>
  );
};
export const ShieldIconSkeleton = ({
  size = 16,
  className = defaultTailwindCSS,
}: IconProps) => {
  return (
    <svg
      style={{ width: `${size}px`, height: `${size}px` }}
      className={`w-[${size}px] h-[${size}px] ` + className}
      xmlns="http://www.w3.org/2000/svg"
      width="200"
      height="200"
      viewBox="0 0 24 24"
    >
      <path
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.5"
        d="M9 12.75L11.25 15L15 9.75m-3-7.036A11.959 11.959 0 0 1 3.598 6A11.99 11.99 0 0 0 3 9.749c0 5.592 3.824 10.29 9 11.623c5.176-1.332 9-6.03 9-11.622c0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285Z"
      />
    </svg>
  );
};
export const SlidersVerticalIcon = ({
  size = 16,
  className = defaultTailwindCSS,
}: IconProps) => {
  return (
    <svg
      style={{ width: `${size}px`, height: `${size}px` }}
      className={`w-[${size}px] h-[${size}px] ` + className}
      viewBox={`0 0 ${size} ${size}`}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <g clipPath="url(#clip0_16_2627)">
        <path
          d="M2.66666 14V9.33333M2.66666 6.66667V2M7.99999 14V8M7.99999 5.33333V2M13.3333 14V10.6667M13.3333 8V2M0.666656 9.33333H4.66666M5.99999 5.33333H9.99999M11.3333 10.6667H15.3333"
          stroke="currentColor"
          strokeOpacity="0.8"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </g>
      <defs>
        <clipPath id="clip0_16_2627">
          <rect width="16" height="16" fill="white" />
        </clipPath>
      </defs>
    </svg>
  );
};
export const SortIcon = ({
  size = 24,
  className = defaultTailwindCSS,
}: IconProps) => {
  return (
    <svg
      style={{ width: `${size}px`, height: `${size}px` }}
      className={`w-[${size}px] h-[${size}px] ` + className}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        fill="currentColor"
        fillRule="evenodd"
        d="M17 3.25a.75.75 0 0 1 .75.75v13.75l1.65-2.2a.75.75 0 1 1 1.2.9l-3 4a.75.75 0 0 1-1.35-.45V4a.75.75 0 0 1 .75-.75ZM7.25 6A.75.75 0 0 1 8 5.25h5a.75.75 0 0 1 0 1.5H8A.75.75 0 0 1 7.25 6Zm-2 5a.75.75 0 0 1 .75-.75h7a.75.75 0 0 1 0 1.5H6a.75.75 0 0 1-.75-.75Zm-2 5a.75.75 0 0 1 .75-.75h9a.75.75 0 0 1 0 1.5H4a.75.75 0 0 1-.75-.75Z"
        clipRule="evenodd"
      />
    </svg>
  );
};
export const SourcesIcon = ({
  size = 16,
  className = defaultTailwindCSS,
}: IconProps) => {
  return (
    <svg
      style={{ width: `${size}px`, height: `${size}px` }}
      className={`w-[${size}px] h-[${size}px] ` + className}
      viewBox="0 0 28 29"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M6 22.5L14 14.5L22 6.5V14.5H14V22.5H6Z" fill="black" />
    </svg>
  );
};
export const StarFeedback = ({
  size = 16,
  className = defaultTailwindCSS,
}: IconProps) => {
  return (
    <svg
      style={{ width: `${size}px`, height: `${size}px` }}
      className={`w-[${size}px] h-[${size}px] ` + className}
      xmlns="http://www.w3.org/2000/svg"
      width="200"
      height="200"
      viewBox="0 0 24 24"
    >
      <path
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.5"
        d="m12.495 18.587l4.092 2.15a1.044 1.044 0 0 0 1.514-1.106l-.783-4.552a1.045 1.045 0 0 1 .303-.929l3.31-3.226a1.043 1.043 0 0 0-.575-1.785l-4.572-.657A1.044 1.044 0 0 1 15 7.907l-2.088-4.175a1.044 1.044 0 0 0-1.88 0L8.947 7.907a1.044 1.044 0 0 1-.783.575l-4.51.657a1.044 1.044 0 0 0-.584 1.785l3.309 3.226a1.044 1.044 0 0 1 .303.93l-.783 4.55a1.044 1.044 0 0 0 1.513 1.107l4.093-2.15a1.043 1.043 0 0 1 .991 0"
      />
    </svg>
  );
};
export const StarIconSkeleton = ({
  size = 16,
  className = defaultTailwindCSS,
}: IconProps) => {
  return (
    <svg
      style={{ width: `${size}px`, height: `${size}px` }}
      className={`w-[${size}px] h-[${size}px] ` + className}
      xmlns="http://www.w3.org/2000/svg"
      width="200"
      height="200"
      viewBox="0 0 24 24"
    >
      <path
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.5"
        d="m14.92 8.797l-.624 1.86a4.75 4.75 0 0 1-3.029 3.03l-1.882.626a.316.316 0 0 0 0 .601l1.882.626a4.744 4.744 0 0 1 3.005 3.007l.625 1.883a.317.317 0 0 0 .6 0l.649-1.86a4.749 4.749 0 0 1 3.005-3.007l1.881-.625a.316.316 0 0 0 0-.601l-1.858-.65a4.744 4.744 0 0 1-3.028-3.03l-.625-1.884a.317.317 0 0 0-.6.024M6.859 3.516l-.446 1.329A3.392 3.392 0 0 1 4.25 7.01l-1.345.446a.226.226 0 0 0 0 .43l1.345.447a3.388 3.388 0 0 1 2.146 2.148l.446 1.345a.226.226 0 0 0 .43 0l.462-1.328A3.392 3.392 0 0 1 9.88 8.35l1.345-.447a.226.226 0 0 0 0-.43L9.897 7.01a3.388 3.388 0 0 1-2.163-2.165l-.446-1.346a.226.226 0 0 0-.43.017"
      />
    </svg>
  );
};
export const StopGeneratingIcon = ({
  size = 16,
  className = defaultTailwindCSS,
}: IconProps) => {
  return (
    <svg
      style={{ width: `${size}px`, height: `${size}px` }}
      className={`w-[${size}px] h-[${size}px] ` + className}
      xmlns="http://www.w3.org/2000/svg"
      width="200"
      height="200"
      viewBox="0 0 14 14"
    >
      <path
        fill="currentColor"
        fillRule="evenodd"
        d="M1.5 0A1.5 1.5 0 0 0 0 1.5v11A1.5 1.5 0 0 0 1.5 14h11a1.5 1.5 0 0 0 1.5-1.5v-11A1.5 1.5 0 0 0 12.5 0z"
        clipRule="evenodd"
      />
    </svg>
  );
};
export const SwapIcon = ({
  size = 16,
  className = defaultTailwindCSS,
}: IconProps) => {
  return (
    <svg
      style={{ width: `${size}px`, height: `${size}px` }}
      className={`w-[${size}px] h-[${size}px] ` + className}
      xmlns="http://www.w3.org/2000/svg"
      width="200"
      height="200"
      viewBox="0 0 24 24"
    >
      <g
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.5"
      >
        <path d="M3.53 11.47v2.118a4.235 4.235 0 0 0 4.235 4.236H20.47M3.53 6.176h12.705a4.235 4.235 0 0 1 4.236 4.236v2.117" />
        <path d="m17.294 14.647l3.177 3.176L17.294 21M6.706 9.353L3.529 6.176L6.706 3" />
      </g>
    </svg>
  );
};
export const ThumbsDownIcon = createIcon(FiThumbsDown);
export const ThumbsUpIcon = createIcon(FiThumbsUp);
export const ThumbsUpIconSkeleton = ({
  size = 16,
  className = defaultTailwindCSS,
}: IconProps) => {
  return (
    <svg
      style={{ width: `${size}px`, height: `${size}px` }}
      className={`w-[${size}px] h-[${size}px] ` + className}
      xmlns="http://www.w3.org/2000/svg"
      width="200"
      height="200"
      viewBox="0 0 24 24"
    >
      <path
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.5"
        d="M8.625 9.75a.375.375 0 1 1-.75 0a.375.375 0 0 1 .75 0Zm0 0H8.25m4.125 0a.375.375 0 1 1-.75 0a.375.375 0 0 1 .75 0Zm0 0H12m4.125 0a.375.375 0 1 1-.75 0a.375.375 0 0 1 .75 0Zm0 0h-.375m-13.5 3.01c0 1.6 1.123 2.994 2.707 3.227c1.087.16 2.185.283 3.293.369V21l4.184-4.183a1.14 1.14 0 0 1 .778-.332a48.294 48.294 0 0 0 5.83-.498c1.585-.233 2.708-1.626 2.708-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0 0 12 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018Z"
      />
    </svg>
  );
};
export const ToggleDown = ({
  size = 16,
  className = defaultTailwindCSS,
}: IconProps) => {
  return (
    <svg
      style={{ width: `${size}px`, height: `${size}px` }}
      className={`w-[${size}px] h-[${size}px] ` + className}
      xmlns="http://www.w3.org/2000/svg"
      width="200"
      height="200"
      viewBox="0 0 16 16"
    >
      <path
        fill="currentColor"
        fillRule="evenodd"
        d="M4.22 6.22a.75.75 0 0 1 1.06 0L8 8.94l2.72-2.72a.75.75 0 1 1 1.06 1.06l-3.25 3.25a.75.75 0 0 1-1.06 0L4.22 7.28a.75.75 0 0 1 0-1.06"
        clipRule="evenodd"
      />
    </svg>
  );
};
export const ToggleUp = ({
  size = 16,
  className = defaultTailwindCSS,
}: IconProps) => {
  return (
    <svg
      style={{ width: `${size}px`, height: `${size}px` }}
      className={`w-[${size}px] h-[${size}px] ` + className}
      xmlns="http://www.w3.org/2000/svg"
      width="200"
      height="200"
      viewBox="0 0 16 16"
    >
      <path
        fill="currentColor"
        fillRule="evenodd"
        d="M11.78 9.78a.75.75 0 0 1-1.06 0L8 7.06L5.28 9.78a.75.75 0 0 1-1.06-1.06l3.25-3.25a.75.75 0 0 1 1.06 0l3.25 3.25a.75.75 0 0 1 0 1.06"
        clipRule="evenodd"
      />
    </svg>
  );
};
export const ToolIcon = ({
  size = 16,
  className = defaultTailwindCSS,
}: IconProps) => {
  return (
    <svg
      style={{ width: `${size}px`, height: `${size}px` }}
      className={`w-[${size}px] h-[${size}px] ` + className}
      xmlns="http://www.w3.org/2000/svg"
      width="200"
      height="200"
      viewBox="0 0 24 24"
    >
      <path
        fill="currentColor"
        fillRule="evenodd"
        d="M12 6.75a5.25 5.25 0 0 1 6.775-5.025a.75.75 0 0 1 .313 1.248l-3.32 3.319a2.248 2.248 0 0 0 1.941 1.939l3.318-3.319a.75.75 0 0 1 1.248.313a5.25 5.25 0 0 1-5.472 6.756c-1.018-.086-1.87.1-2.309.634L7.344 21.3A3.298 3.298 0 1 1 2.7 16.657l8.684-7.151c.533-.44.72-1.291.634-2.309A5.342 5.342 0 0 1 12 6.75ZM4.117 19.125a.75.75 0 0 1 .75-.75h.008a.75.75 0 0 1 .75.75v.008a.75.75 0 0 1-.75.75h-.008a.75.75 0 0 1-.75-.75v-.008Z"
        clipRule="evenodd"
      />
    </svg>
  );
};
export const ToolIconSkeleton = ({
  size = 16,
  className = defaultTailwindCSS,
}: IconProps) => {
  return (
    <svg
      style={{ width: `${size}px`, height: `${size}px` }}
      className={`w-[${size}px] h-[${size}px] ` + className}
      xmlns="http://www.w3.org/2000/svg"
      width="200"
      height="200"
      viewBox="0 0 24 24"
    >
      <g
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.5"
      >
        <path d="M21.75 6.75a4.5 4.5 0 0 1-4.884 4.484c-1.076-.091-2.264.071-2.95.904l-7.152 8.684a2.548 2.548 0 1 1-3.586-3.586l8.684-7.152c.833-.686.995-1.874.904-2.95a4.5 4.5 0 0 1 6.336-4.486l-3.276 3.276a3.004 3.004 0 0 0 2.25 2.25l3.276-3.276c.256.565.398 1.192.398 1.852Z" />
        <path d="M4.867 19.125h.008v.008h-.008v-.008Z" />
      </g>
    </svg>
  );
};
export const TrashIcon = ({
  size = 16,
  className = defaultTailwindCSS,
}: IconProps) => {
  return <Trash size={size} className={className} />;
};
export const TriangleAlertIcon = createIcon(FiAlertTriangle);
export const TwoRightArrowIcons = ({
  size = 16,
  className = defaultTailwindCSS,
}: IconProps) => {
  return (
    <svg
      style={{ width: `${size}px`, height: `${size}px` }}
      className={`w-[${size}px] h-[${size}px] ` + className}
      xmlns="http://www.w3.org/2000/svg"
      width="200"
      height="200"
      viewBox="0 0 24 24"
    >
      <path
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.5"
        d="m5.36 19l5.763-5.763a1.738 1.738 0 0 0 0-2.474L5.36 5m7 14l5.763-5.763a1.738 1.738 0 0 0 0-2.474L12.36 5"
      />
    </svg>
  );
};
export const UndoIcon = ({
  size = 16,
  className = defaultTailwindCSS,
}: IconProps) => {
  return (
    <svg
      style={{ width: `${size}px`, height: `${size}px` }}
      className={`w-[${size}px] h-[${size}px]` + className}
      xmlns="http://www.w3.org/2000/svg"
      width="200"
      height="200"
      viewBox="0 0 24 24"
    >
      <path
        fill="currentColor"
        fillRule="evenodd"
        d="M3.464 3.464C2 4.93 2 7.286 2 12c0 4.714 0 7.071 1.464 8.535C4.93 22 7.286 22 12 22c4.714 0 7.071 0 8.535-1.465C22 19.072 22 16.715 22 12c0-4.714 0-7.071-1.465-8.536C19.072 2 16.714 2 12 2S4.929 2 3.464 3.464Zm5.795 4.51A.75.75 0 1 0 8.24 6.872L5.99 8.949a.75.75 0 0 0 0 1.102l2.25 2.077a.75.75 0 1 0 1.018-1.102l-.84-.776h5.62c.699 0 1.168 0 1.526.036c.347.034.507.095.614.164c.148.096.275.223.37.371c.07.106.13.267.165.614c.035.358.036.827.036 1.526c0 .7 0 1.169-.036 1.527c-.035.346-.095.507-.164.614a1.25 1.25 0 0 1-.371.37c-.107.07-.267.13-.614.165c-.358.035-.827.036-1.526.036H9.5a.75.75 0 1 0 0 1.5h4.576c.652 0 1.196 0 1.637-.044c.462-.046.89-.145 1.28-.397c.327-.211.605-.49.816-.816c.252-.39.351-.818.397-1.28c.044-.441.044-.985.044-1.637v-.075c0-.652 0-1.196-.044-1.637c-.046-.462-.145-.891-.397-1.28a2.748 2.748 0 0 0-.816-.817c-.39-.251-.818-.35-1.28-.396c-.44-.044-.985-.044-1.637-.044H8.418l.84-.776Z"
        clipRule="evenodd"
      />
    </svg>
  );
};
export const UserIcon = ({
  size = 16,
  className = defaultTailwindCSS,
}: IconProps) => {
  return (
    <svg
      style={{ width: `${size}px`, height: `${size}px` }}
      className={`w-[${size}px] h-[${size}px] ` + className}
      xmlns="http://www.w3.org/2000/svg"
      width="200"
      height="200"
      viewBox="0 0 24 24"
    >
      <path
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.5"
        d="M19.618 21.25c0-3.602-4.016-6.53-7.618-6.53c-3.602 0-7.618 2.928-7.618 6.53M12 11.456a4.353 4.353 0 1 0 0-8.706a4.353 4.353 0 0 0 0 8.706"
      />
    </svg>
  );
};
export const UsersIcon = ({
  size = 16,
  className = defaultTailwindCSS,
}: IconProps) => {
  return (
    <svg
      style={{ width: `${size}px`, height: `${size}px` }}
      className={`w-[${size}px] h-[${size}px] ` + className}
      xmlns="http://www.w3.org/2000/svg"
      width="200"
      height="200"
      viewBox="0 0 16 16"
    >
      <path
        fill="currentColor"
        d="M8 8a3 3 0 1 0 0-6a3 3 0 0 0 0 6m4.735 6c.618 0 1.093-.561.872-1.139a6.002 6.002 0 0 0-11.215 0c-.22.578.254 1.139.872 1.139z"
      />
    </svg>
  );
  // return <FiUser size={size} className={className} />;
};
export const UsersIconSkeleton = ({
  size = 16,
  className = defaultTailwindCSS,
}: IconProps) => {
  return (
    <svg
      style={{ width: `${size}px`, height: `${size}px` }}
      className={`w-[${size}px] h-[${size}px] ` + className}
      xmlns="http://www.w3.org/2000/svg"
      width="200"
      height="200"
      viewBox="0 0 24 24"
    >
      <g fill="none" stroke="currentColor" strokeWidth="1.5">
        <circle cx="12" cy="6" r="4" />
        <path
          strokeLinecap="round"
          d="M19.997 18c.003-.164.003-.331.003-.5c0-2.485-3.582-4.5-8-4.5s-8 2.015-8 4.5S4 22 12 22c2.231 0 3.84-.157 5-.437"
        />
      </g>
    </svg>
  );
};
export const WebSearchIcon = ({
  size = 24,
  className = defaultTailwindCSS,
}: IconProps) => {
  return (
    <svg
      style={{ width: `${size}px`, height: `${size}px` }}
      className={`w-[${size}px] h-[${size}px] ` + className}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect
        x="0.65"
        y="0.65"
        width="22.7"
        height="22.7"
        rx="11.35"
        stroke="black"
        strokeWidth="1.3"
      />
      <path
        d="M9.24406 10.8918H10.8918V9.24406L8.96945 7.32174C9.58439 7.02805 10.2753 6.93222 10.9469 7.04746C11.6186 7.1627 12.238 7.48333 12.7199 7.96521C13.2017 8.44708 13.5224 9.0665 13.6376 9.73816C13.7528 10.4098 13.657 11.1007 13.3633 11.7156L16.6587 15.011C16.8772 15.2295 17 15.5259 17 15.8349C17 16.1439 16.8772 16.4402 16.6587 16.6587C16.4402 16.8772 16.1439 17 15.8349 17C15.5259 17 15.2295 16.8772 15.011 16.6587L11.7156 13.3633C11.1007 13.657 10.4098 13.7528 9.73816 13.6376C9.0665 13.5224 8.44708 13.2017 7.96521 12.7199C7.48333 12.238 7.1627 11.6186 7.04746 10.9469C6.93222 10.2753 7.02805 9.58439 7.32174 8.96945L9.24406 10.8918Z"
        stroke="black"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
};
export const WindowsIcon = ({
  size = 16,
  className = "my-auto flex flex-shrink-0 ",
}: IconProps) => {
  return (
    <svg
      style={{ width: `${size}px`, height: `${size}px` }}
      className={`w-[${size}px] h-[${size}px] ` + className}
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width="24"
      height="24"
    >
      <path
        fill="currentColor"
        d="M3 3h8v8H3V3zm10 0h8v8h-8V3zm-10 10h8v8H3v-8zm10 0h8v8h-8v-8z"
      />
    </svg>
  );
};
export const XIcon = ({
  size = 16,
  className = defaultTailwindCSS,
}: IconProps) => {
  return (
    <svg
      style={{ width: `${size}px`, height: `${size}px` }}
      className={`w-[${size}px] h-[${size}px] ` + className}
      xmlns="http://www.w3.org/2000/svg"
      width="200"
      height="200"
      viewBox="0 0 24 24"
    >
      <path
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
        d="M18 6L6 18M6 6l12 12"
      />
    </svg>
  );
};
export const XSquareIcon = ({
  size = 16,
  className = defaultTailwindCSS,
}: IconProps) => {
  return <XSquare size={size} className={className} />;
};
export const ZoomInIcon = ({
  size = 16,
  className = defaultTailwindCSS,
}: IconProps) => {
  return (
    <svg
      style={{ width: `${size}px`, height: `${size}px` }}
      className={`w-[${size}px] h-[${size}px] ` + className}
      xmlns="http://www.w3.org/2000/svg"
      width="200"
      height="200"
      viewBox="0 0 20 20"
    >
      <g fill="currentColor">
        <path d="M8 10a1.5 1.5 0 1 1 3 0a1.5 1.5 0 0 1-3 0Z" />
        <path
          fillRule="evenodd"
          d="M4.5 2A1.5 1.5 0 0 0 3 3.5v13A1.5 1.5 0 0 0 4.5 18h11a1.5 1.5 0 0 0 1.5-1.5V7.621a1.5 1.5 0 0 0-.44-1.06l-4.12-4.122A1.5 1.5 0 0 0 11.378 2H4.5Zm5 5a3 3 0 1 0 1.524 5.585l1.196 1.195a.75.75 0 1 0 1.06-1.06l-1.195-1.196A3 3 0 0 0 9.5 7Z"
          clipRule="evenodd"
        />
      </g>
    </svg>
  );
};
export const ZoomInIconSkeleton = ({
  size = 16,
  className = defaultTailwindCSS,
}: IconProps) => {
  return (
    <svg
      style={{ width: `${size}px`, height: `${size}px` }}
      className={`w-[${size}px] h-[${size}px] ` + className}
      xmlns="http://www.w3.org/2000/svg"
      width="200"
      height="200"
      viewBox="0 0 24 24"
    >
      <path
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.5"
        d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m5.231 13.481L15 17.25m-4.5-15H5.625c-.621 0-1.125.504-1.125 1.125v16.5c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Zm3.75 11.625a2.625 2.625 0 1 1-5.25 0a2.625 2.625 0 0 1 5.25 0Z"
      />
    </svg>
  );
};

// ============================================================================
// THIRD-PARTY / COMPANY ICONS (Alphabetically)
// ============================================================================
export const AirtableIcon = createLogoIcon(airtableIcon);
export const AmazonIcon = createLogoIcon(amazonSVG);
export const AnthropicIcon = createLogoIcon(anthropicSVG);
export const AsanaIcon = createLogoIcon(asanaIcon);
export const AxeroIcon = createLogoIcon(axeroImage);
export const AzureIcon = createLogoIcon(azureIcon);
export const BitbucketIcon = createLogoIcon(bitbucketIcon);
export const BookstackIcon = createIcon(SiBookstack);
export const ClickupIcon = createLogoIcon(clickupIcon);
export const CohereIcon = createLogoIcon(cohereIcon);
export const ColorDiscordIcon = createLogoIcon(discordIcon);
export const ColorSlackIcon = createLogoIcon(slackIcon);
export const ConfluenceIcon = createLogoIcon(confluenceSVG, {
  sizeAdjustment: 4,
  classNameAddition: "-m-0.5",
});
export const DeepseekIcon = createLogoIcon(deepseekSVG);
export const DiscourseIcon = createLogoIcon(discourseIcon);
export const Document360Icon = createLogoIcon(document360Icon);
export const DropboxIcon = createLogoIcon(dropboxIcon);
export const EgnyteIcon = createLogoIcon(egnyteIcon);
export const FirefliesIcon = createLogoIcon(firefliesIcon);
export const FreshdeskIcon = createLogoIcon(freshdeskIcon);
export const GeminiIcon = createLogoIcon(geminiSVG);
export const GitbookIcon = createLogoIcon(gitbookDarkIcon, {
  darkSrc: gitbookLightIcon,
});
export const GithubIcon = createLogoIcon(githubLightIcon, {
  monochromatic: true,
});
export const GitlabIcon = createLogoIcon(gitlabIcon);
export const GmailIcon = createLogoIcon(gmailIcon);
export const GongIcon = createLogoIcon(gongIcon);
export const GoogleDriveIcon = createLogoIcon(googleDriveIcon);
export const GoogleIcon = createLogoIcon(googleIcon);
export const GoogleSitesIcon = createLogoIcon(googleSitesIcon);
export const GoogleStorageIcon = createLogoIcon(googleCloudStorageIcon, {
  sizeAdjustment: 4,
  classNameAddition: "-m-0.5",
});
export const GuruIcon = createLogoIcon(guruIcon, { monochromatic: true });
export const HighspotIcon = createLogoIcon(highspotIcon);
export const HubSpotIcon = createLogoIcon(hubSpotIcon);
export const JiraIcon = createLogoIcon(jiraSVG);
export const KimiIcon = createLogoIcon(kimiIcon);
export const LinearIcon = createLogoIcon(linearIcon, { monochromatic: true });
export const LiteLLMIcon = createLogoIcon(litellmIcon);
export const LoopioIcon = createLogoIcon(loopioIcon, { monochromatic: true });
export const MediaWikiIcon = createLogoIcon(mediawikiIcon);
export const MetaIcon = createLogoIcon(metaSVG);
export const MicrosoftIcon = createLogoIcon(microsoftIcon);
export const MicrosoftIconSVG = createLogoIcon(microsoftSVG);
export const MistralIcon = createLogoIcon(mistralSVG);
export const MixedBreadIcon = createLogoIcon(mixedBreadSVG);
export const NomicIcon = createLogoIcon(nomicSVG);
export const NotionIcon = createLogoIcon(notionIcon, { monochromatic: true });
export const OCIStorageIcon = createLogoIcon(OCIStorageSVG);
export const OllamaIcon = createLogoIcon(ollamaIcon);
export const OpenAIISVG = ({
  size = 16,
  className = defaultTailwindCSS,
}: IconProps) => (
  <svg
    fill="currentColor"
    width={size}
    style={{ width: `${size}px`, height: `${size}px` }}
    height={size}
    className={`w-[${size}px] h-[${size}px] ` + className}
    viewBox="0 0 24 24"
    role="img"
    xmlns="http://www.w3.org/2000/svg"
  >
    <path
      fill="currentColor"
      d="M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.872zm16.5963 3.8558L13.1038 8.364 15.1192 7.2a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.407-.667zm2.0107-3.0231l-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66zM8.3065 12.863l-2.02-1.1638a.0804.0804 0 0 1-.038-.0567V6.0742a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.459a.7948.7948 0 0 0-.3927.6813zm1.0976-2.3654l2.602-1.4998 2.6069 1.4998v2.9994l-2.5974 1.4997-2.6067-1.4997Z"
    />
  </svg>
);
export const OpenAIIcon = createLogoIcon(openAISVG, { monochromatic: true });
export const OpenAISVG = ({
  size = 16,
  className = defaultTailwindCSS,
}: IconProps) => {
  return (
    <svg
      style={{ width: `${size}px`, height: `${size}px` }}
      className={`w-[${size}px] h-[${size}px] ` + className}
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 50 50"
    >
      <path
        fill="currentColor"
        d="M45.403,25.562c-0.506-1.89-1.518-3.553-2.906-4.862c1.134-2.665,0.963-5.724-0.487-8.237	c-1.391-2.408-3.636-4.131-6.322-4.851c-1.891-0.506-3.839-0.462-5.669,0.088C28.276,5.382,25.562,4,22.647,4	c-4.906,0-9.021,3.416-10.116,7.991c-0.01,0.001-0.019-0.003-0.029-0.002c-2.902,0.36-5.404,2.019-6.865,4.549	c-1.391,2.408-1.76,5.214-1.04,7.9c0.507,1.891,1.519,3.556,2.909,4.865c-1.134,2.666-0.97,5.714,0.484,8.234	c1.391,2.408,3.636,4.131,6.322,4.851c0.896,0.24,1.807,0.359,2.711,0.359c1.003,0,1.995-0.161,2.957-0.45	C21.722,44.619,24.425,46,27.353,46c4.911,0,9.028-3.422,10.12-8.003c2.88-0.35,5.431-2.006,6.891-4.535	C45.754,31.054,46.123,28.248,45.403,25.562z M35.17,9.543c2.171,0.581,3.984,1.974,5.107,3.919c1.049,1.817,1.243,4,0.569,5.967	c-0.099-0.062-0.193-0.131-0.294-0.19l-9.169-5.294c-0.312-0.179-0.698-0.177-1.01,0.006l-10.198,6.041l-0.052-4.607l8.663-5.001	C30.733,9.26,33,8.963,35.17,9.543z M29.737,22.195l0.062,5.504l-4.736,2.805l-4.799-2.699l-0.062-5.504l4.736-2.805L29.737,22.195z M14.235,14.412C14.235,9.773,18.009,6,22.647,6c2.109,0,4.092,0.916,5.458,2.488C28,8.544,27.891,8.591,27.787,8.651l-9.17,5.294	c-0.312,0.181-0.504,0.517-0.5,0.877l0.133,11.851l-4.015-2.258V14.412z M6.528,23.921c-0.581-2.17-0.282-4.438,0.841-6.383	c1.06-1.836,2.823-3.074,4.884-3.474c-0.004,0.116-0.018,0.23-0.018,0.348V25c0,0.361,0.195,0.694,0.51,0.872l10.329,5.81	L19.11,34.03l-8.662-5.002C8.502,27.905,7.11,26.092,6.528,23.921z M14.83,40.457c-2.171-0.581-3.984-1.974-5.107-3.919	c-1.053-1.824-1.249-4.001-0.573-5.97c0.101,0.063,0.196,0.133,0.299,0.193l9.169,5.294c0.154,0.089,0.327,0.134,0.5,0.134	c0.177,0,0.353-0.047,0.51-0.14l10.198-6.041l0.052,4.607l-8.663,5.001C19.269,40.741,17.001,41.04,14.83,40.457z M35.765,35.588	c0,4.639-3.773,8.412-8.412,8.412c-2.119,0-4.094-0.919-5.459-2.494c0.105-0.056,0.216-0.098,0.32-0.158l9.17-5.294	c0.312-0.181,0.504-0.517,0.5-0.877L31.75,23.327l4.015,2.258V35.588z M42.631,32.462c-1.056,1.83-2.84,3.086-4.884,3.483	c0.004-0.12,0.018-0.237,0.018-0.357V25c0-0.361-0.195-0.694-0.51-0.872l-10.329-5.81l3.964-2.348l8.662,5.002	c1.946,1.123,3.338,2.937,3.92,5.107C44.053,28.249,43.754,30.517,42.631,32.462z"
      />
    </svg>
  );
};
export const OpenSourceIcon = createLogoIcon(openSourceIcon);
export const OutlineIcon = createLogoIcon(outlinePNG, {
  sizeAdjustment: 4,
  classNameAddition: "-m-0.5",
});
export const ProductboardIcon = createLogoIcon(productboardIcon);
export const QwenIcon = createLogoIcon(qwenSVG);
export const R2Icon = createLogoIcon(r2Icon);
export const S3Icon = createLogoIcon(s3Icon);
export const SalesforceIcon = createLogoIcon(salesforceIcon);
export const SharepointIcon = createLogoIcon(sharepointIcon);
export const SlabIcon = createLogoIcon(slabLogoIcon);
export const SlackIcon = ({
  size = 16,
  className = defaultTailwindCSS,
}: IconProps) => {
  return (
    <svg
      style={{ width: `${size}px`, height: `${size}px` }}
      className={`w-[${size}px] h-[${size}px] ` + className}
      xmlns="http://www.w3.org/2000/svg"
      width="200"
      height="200"
      viewBox="0 0 24 24"
    >
      <path
        fill="currentColor"
        d="M16.923 16.52h-2.39a1.984 1.984 0 0 1-1.973-1.195a2.006 2.006 0 0 1 .47-2.263a1.99 1.99 0 0 1 1.502-.53h4.858a1.978 1.978 0 0 1 1.969 1.63a1.951 1.951 0 0 1-1.147 2.173a2.21 2.21 0 0 1-.876.174c-.8.022-1.601.01-2.413.01m-9.435.501v-2.477a2.003 2.003 0 0 1 .56-1.402a1.987 1.987 0 0 1 1.377-.608a1.942 1.942 0 0 1 1.393.522c.377.352.6.84.62 1.357c.043 1.738.043 3.477 0 5.215A1.94 1.94 0 0 1 10.805 21a1.922 1.922 0 0 1-1.423.495a1.954 1.954 0 0 1-1.359-.614a1.97 1.97 0 0 1-.535-1.395c-.01-.815 0-1.64 0-2.466m8.938-9.963v2.434a1.996 1.996 0 0 1-.524 1.5a1.98 1.98 0 0 1-2.242.469a1.981 1.981 0 0 1-1.078-1.165a1.996 1.996 0 0 1-.106-.804V4.46a1.963 1.963 0 0 1 .605-1.386a1.947 1.947 0 0 1 1.408-.537a1.962 1.962 0 0 1 1.383.602a1.979 1.979 0 0 1 .553 1.408c.011.836 0 1.673 0 2.51M6.97 11.511H4.545a1.962 1.962 0 0 1-1.393-.579a1.978 1.978 0 0 1-.427-2.155a1.978 1.978 0 0 1 1.066-1.07a1.97 1.97 0 0 1 .754-.15h4.923a1.962 1.962 0 0 1 1.392.579a1.98 1.98 0 0 1-1.392 3.375zm4.478-6.171v.902c0 .18-.06.261-.216.261H9.165A1.916 1.916 0 0 1 7.9 5.787a1.929 1.929 0 0 1-.4-1.402c.022-.492.227-.958.574-1.306a1.965 1.965 0 0 1 3.342 1.12c.032.38.032.487.032.832v.214zm-5.009 7.204c.06.813.06 1.63 0 2.444a1.902 1.902 0 0 1-.754 1.18a1.887 1.887 0 0 1-1.356.34a1.988 1.988 0 0 1-1.293-.627a2.003 2.003 0 0 1-.536-1.338a1.96 1.96 0 0 1 .497-1.346c.33-.369.786-.599 1.278-.643c.736-.065 1.471-.01 2.164-.01M17.443 11.5V9.329c.052-.509.299-.977.689-1.305c.39-.329.891-.492 1.399-.455c.522 0 1.023.208 1.392.579a1.981 1.981 0 0 1 0 2.796c-.37.371-.87.58-1.392.58c-.671 0-1.363-.022-2.088-.022m-4.967 6.072c.8-.055 1.603-.055 2.402 0c.488.09.92.367 1.208.773c.286.406.405.908.329 1.4a1.99 1.99 0 0 1-.67 1.264a1.98 1.98 0 0 1-1.343.485a1.922 1.922 0 0 1-1.314-.528a1.937 1.937 0 0 1-.6-1.287c-.044-.695-.012-1.401-.012-2.107"
      />
    </svg>
  );
};
export const SlackIconSkeleton = ({
  size = 16,
  className = defaultTailwindCSS,
}: IconProps) => {
  return (
    <svg
      style={{ width: `${size}px`, height: `${size}px` }}
      className={`w-[${size}px] h-[${size}px] ` + className}
      xmlns="http://www.w3.org/2000/svg"
      width="200"
      height="200"
      viewBox="0 0 14 14"
    >
      <g fill="none" stroke="currentColor">
        <path d="M5.5 2a.5.5 0 1 0 1 0a.5.5 0 1 0-1 0m6 4a.5.5 0 1 0 1 0a.5.5 0 1 0-1 0m-4 6a.5.5 0 1 0 1 0a.5.5 0 1 0-1 0m-6-4a.5.5 0 1 0 1 0a.5.5 0 1 0-1 0" />
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M8.793 1.219v4.937m-3.59 1.692v4.937M1.215 5.207h4.937m1.692 3.59h4.937"
        />
      </g>
    </svg>
  );
};
export const TeamsIcon = createLogoIcon(teamsIcon);
export const VoyageIconSVG = ({
  size = 16,
  className = defaultTailwindCSS,
}: IconProps) => (
  <svg
    style={{ width: `${size}px`, height: `${size}px` }}
    className={`w-[${size}px] h-[${size}px] ` + className}
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 200 200"
    width="200"
    height="200"
  >
    <path
      d="M0 0 C18.56364691 14.8685395 31.52865476 35.60458591 34.68359375 59.39453125 C36.85790415 84.17093249 31.86661083 108.64738046 15.83569336 128.38696289 C-0.18749615 147.32766215 -21.13158775 159.50726579 -46 162 C-70.46026633 163.68595557 -94.53744209 157.16585411 -113.375 141.1875 C-131.5680983 125.12913912 -143.31327081 103.12304227 -145.16845703 78.79052734 C-146.52072106 52.74671426 -138.40787353 29.42123969 -121 10 C-120.39929688 9.30519531 -119.79859375 8.61039063 -119.1796875 7.89453125 C-88.7732111 -25.07872563 -34.66251161 -26.29920259 0 0 Z M-111 6 C-111.96292969 6.76441406 -112.92585938 7.52882813 -113.91796875 8.31640625 C-129.12066 21.0326872 -138.48510826 41.64930525 -141 61 C-142.57102569 86.19086606 -137.40498471 109.10013392 -120.54980469 128.68505859 C-106.05757815 144.84161953 -85.8110604 156.92053779 -63.68798828 158.12597656 C-39.72189393 158.83868932 -17.08757891 154.40601729 1.1875 137.6875 C3.15800523 135.82115685 5.07881363 133.91852176 7 132 C8.22396484 130.7934375 8.22396484 130.7934375 9.47265625 129.5625 C26.2681901 112.046746 31.70691205 89.639394 31.3125 66 C30.4579168 43.32505919 19.07700136 22.58412979 3 7 C-29.27431062 -21.68827611 -78.26536136 -21.67509486 -111 6 Z "
      fill="currentColor"
      transform="translate(155,29)"
    />
    <path
      d="M0 0 C2.62278901 2.33427271 3.96735488 4.64596813 5.4453125 7.81640625 C6.10080078 9.20956055 6.10080078 9.20956055 6.76953125 10.63085938 C7.21683594 11.59830078 7.66414063 12.56574219 8.125 13.5625 C8.58003906 14.53380859 9.03507812 15.50511719 9.50390625 16.50585938 C10.34430119 18.30011504 11.18198346 20.09564546 12.01611328 21.89282227 C12.65935931 23.27045415 13.32005367 24.64010734 14 26 C12.02 26 10.04 26 8 26 C6.515 22.535 6.515 22.535 5 19 C1.7 19 -1.6 19 -5 19 C-5.99 21.31 -6.98 23.62 -8 26 C-9.32 26 -10.64 26 -12 26 C-10.34176227 20.46347949 -7.92776074 15.38439485 -5.4375 10.1875 C-5.02564453 9.31673828 -4.61378906 8.44597656 -4.18945312 7.54882812 C-1.13502139 1.13502139 -1.13502139 1.13502139 0 0 Z M-1 8 C-3.2013866 11.80427492 -3.2013866 11.80427492 -4 16 C-1.69 16 0.62 16 3 16 C2.43260132 11.87026372 2.43260132 11.87026372 1 8 C0.34 8 -0.32 8 -1 8 Z "
      fill="currentColor"
      transform="translate(158,86)"
    />
    <path
      d="M0 0 C2.64453125 1.0234375 2.64453125 1.0234375 4.4453125 4.296875 C4.96971298 5.65633346 5.47294966 7.0241056 5.95703125 8.3984375 C6.22064453 9.08421875 6.48425781 9.77 6.75585938 10.4765625 C7.8687821 13.4482107 8.64453125 15.82826389 8.64453125 19.0234375 C9.30453125 19.0234375 9.96453125 19.0234375 10.64453125 19.0234375 C10.75667969 18.34925781 10.86882813 17.67507812 10.984375 16.98046875 C11.77373626 13.44469078 12.95952974 10.10400184 14.20703125 6.7109375 C14.44099609 6.06576172 14.67496094 5.42058594 14.91601562 4.75585938 C15.48900132 3.17722531 16.06632589 1.60016724 16.64453125 0.0234375 C17.96453125 0.0234375 19.28453125 0.0234375 20.64453125 0.0234375 C20.11164835 5.93359329 17.66052325 10.65458241 15.08203125 15.8984375 C14.65728516 16.77757813 14.23253906 17.65671875 13.79492188 18.5625 C12.75156566 20.71955106 11.70131241 22.87294038 10.64453125 25.0234375 C9.65453125 25.0234375 8.66453125 25.0234375 7.64453125 25.0234375 C6.36851794 22.52596727 5.09866954 20.02565814 3.83203125 17.5234375 C3.29739258 16.47929688 3.29739258 16.47929688 2.75195312 15.4140625 C0.37742917 10.70858383 -1.58321849 5.98797449 -3.35546875 1.0234375 C-2.35546875 0.0234375 -2.35546875 0.0234375 0 0 Z "
      fill="currentColor"
      transform="translate(23.35546875,86.9765625)"
    />
    <path
      d="M0 0 C4.56944444 2.13888889 4.56944444 2.13888889 6 5 C6.58094684 9.76376411 6.98189835 13.6696861 4.0625 17.625 C-0.08290736 19.4862033 -3.52913433 19.80184004 -8 19 C-11.18487773 17.20850628 -12.56721386 16.06753914 -13.9375 12.6875 C-14.04047475 8.25958558 -13.25966827 4.50191217 -10.375 1.0625 C-6.92547207 -0.48070986 -3.67744273 -0.55453501 0 0 Z M-7.66796875 3.21484375 C-9.3387892 5.45403713 -9.40271257 6.72874309 -9.375 9.5 C-9.38273437 10.2734375 -9.39046875 11.046875 -9.3984375 11.84375 C-8.90844456 14.49547648 -8.12507645 15.38331504 -6 17 C-3.17884512 17.42317323 -1.66049093 17.38718434 0.8125 15.9375 C2.65621741 12.92932949 2.30257262 10.44932782 2 7 C1.54910181 4.59436406 1.54910181 4.59436406 0 3 C-4.00690889 1.63330935 -4.00690889 1.63330935 -7.66796875 3.21484375 Z "
      fill="currentColor"
      transform="translate(58,93)"
    />
    <path
      d="M0 0 C0.91007812 0.00902344 1.82015625 0.01804687 2.7578125 0.02734375 C3.45648438 0.03894531 4.15515625 0.05054687 4.875 0.0625 C5.205 1.3825 5.535 2.7025 5.875 4.0625 C4.6375 3.815 3.4 3.5675 2.125 3.3125 C-1.0391959 2.93032359 -1.83705309 2.89394571 -4.6875 4.5625 C-6.71059726 8.08093001 -6.12332701 10.21181009 -5.125 14.0625 C-3.22744856 16.41223818 -3.22744856 16.41223818 0 16.1875 C0.94875 16.14625 1.8975 16.105 2.875 16.0625 C2.875 14.4125 2.875 12.7625 2.875 11.0625 C4.525 11.3925 6.175 11.7225 7.875 12.0625 C8.1875 14.375 8.1875 14.375 7.875 17.0625 C5.25185816 19.29988569 3.33979578 19.9932751 -0.0625 20.5 C-3.96030088 19.9431713 -6.06489651 18.49667323 -9.125 16.0625 C-11.6165904 12.3251144 -11.58293285 10.48918417 -11.125 6.0625 C-7.83836921 1.02299945 -5.86190884 -0.07515268 0 0 Z "
      fill="currentColor"
      transform="translate(113.125,92.9375)"
    />
    <path
      d="M0 0 C4.28705043 1.42901681 5.23208702 4.57025431 7.1875 8.375 C7.55552734 9.06078125 7.92355469 9.7465625 8.30273438 10.453125 C11 15.59744608 11 15.59744608 11 19 C9.35 19 7.7 19 6 19 C5.67 17.68 5.34 16.36 5 15 C2.03 14.67 -0.94 14.34 -4 14 C-4.33 15.65 -4.66 17.3 -5 19 C-5.99 19 -6.98 19 -8 19 C-7.38188466 14.44684052 -5.53234107 10.71540233 -3.4375 6.6875 C-2.9434668 5.71973633 -2.9434668 5.71973633 -2.43945312 4.73242188 C-1.63175745 3.15214772 -0.81662387 1.57567895 0 0 Z M0 6 C-0.33 7.65 -0.66 9.3 -1 11 C0.32 11 1.64 11 3 11 C2.34 9.35 1.68 7.7 1 6 C0.67 6 0.34 6 0 6 Z "
      fill="currentColor"
      transform="translate(90,93)"
    />
    <path
      d="M0 0 C3.63 0 7.26 0 11 0 C11 0.66 11 1.32 11 2 C8.69 2 6.38 2 4 2 C4 3.98 4 5.96 4 8 C5.98 8 7.96 8 10 8 C9.67 8.99 9.34 9.98 9 11 C7.68 11 6.36 11 5 11 C4.67 12.98 4.34 14.96 4 17 C7.465 16.505 7.465 16.505 11 16 C11 16.99 11 17.98 11 19 C7.37 19 3.74 19 0 19 C0 12.73 0 6.46 0 0 Z "
      fill="currentColor"
      transform="translate(124,93)"
    />
    <path
      d="M0 0 C2.25 -0.3125 2.25 -0.3125 5 0 C9 4.10810811 9 4.10810811 9 7 C9.78375 6.21625 10.5675 5.4325 11.375 4.625 C12.91666667 3.08333333 14.45833333 1.54166667 16 0 C16.99 0 17.98 0 19 0 C17.84356383 2.5056117 16.63134741 4.4803655 14.9375 6.6875 C12.52118995 10.81861073 12.20924288 14.29203528 12 19 C10.68 19 9.36 19 8 19 C8.00902344 18.443125 8.01804687 17.88625 8.02734375 17.3125 C7.78294047 11.0217722 5.92390505 8.0388994 1.49609375 3.62890625 C0 2 0 2 0 0 Z "
      fill="currentColor"
      transform="translate(64,93)"
    />
    <path
      d="M0 0 C1.32 0 2.64 0 4 0 C4 8.25 4 16.5 4 25 C2.68 25 1.36 25 0 25 C0 16.75 0 8.5 0 0 Z "
      fill="currentColor"
      transform="translate(173,87)"
    />
    <path
      d="M0 0 C0.66 0.33 1.32 0.66 2 1 C1.125 5.75 1.125 5.75 0 8 C1.093125 7.95875 2.18625 7.9175 3.3125 7.875 C7 8 7 8 10 10 C4.555 10.495 4.555 10.495 -1 11 C-1.99 13.31 -2.98 15.62 -4 18 C-5.32 18 -6.64 18 -8 18 C-6.65150163 13.64029169 -4.95092154 9.68658562 -2.875 5.625 C-2.33617187 4.56539063 -1.79734375 3.50578125 -1.2421875 2.4140625 C-0.83226562 1.61742188 -0.42234375 0.82078125 0 0 Z "
      fill="currentColor"
      transform="translate(154,94)"
    />
    <path
      d="M0 0 C0.66 0.33 1.32 0.66 2 1 C2 1.66 2 2.32 2 3 C1.34 3 0.68 3 0 3 C-0.05429959 4.74965358 -0.09292823 6.49979787 -0.125 8.25 C-0.14820313 9.22453125 -0.17140625 10.1990625 -0.1953125 11.203125 C0.00137219 14.0196498 0.55431084 15.60949036 2 18 C1.34 18.33 0.68 18.66 0 19 C-4.69653179 15.74855491 -4.69653179 15.74855491 -5.9375 12.6875 C-6.02161912 9.07037805 -5.30970069 6.36780178 -4 3 C-1.875 1.0625 -1.875 1.0625 0 0 Z "
      fill="currentColor"
      transform="translate(50,93)"
    />
    <path
      d="M0 0 C2.79192205 -0.05380578 5.5828141 -0.09357669 8.375 -0.125 C9.1690625 -0.14175781 9.963125 -0.15851563 10.78125 -0.17578125 C12.85492015 -0.19335473 14.92883241 -0.10335168 17 0 C17.66 0.66 18.32 1.32 19 2 C17 4 17 4 13.0859375 4.1953125 C11.51550649 4.18200376 9.94513779 4.15813602 8.375 4.125 C7.57320312 4.11597656 6.77140625 4.10695312 5.9453125 4.09765625 C3.96341477 4.07406223 1.98167019 4.03819065 0 4 C0 2.68 0 1.36 0 0 Z "
      fill="currentColor"
      transform="translate(92,187)"
    />
    <path
      d="M0 0 C0.99 0.33 1.98 0.66 3 1 C1.66666667 4.33333333 0.33333333 7.66666667 -1 11 C0.65 11 2.3 11 4 11 C4 11.33 4 11.66 4 12 C1.36 12.33 -1.28 12.66 -4 13 C-4.33 14.98 -4.66 16.96 -5 19 C-5.99 19 -6.98 19 -8 19 C-7.38188466 14.44684052 -5.53234107 10.71540233 -3.4375 6.6875 C-2.9434668 5.71973633 -2.9434668 5.71973633 -2.43945312 4.73242188 C-1.63175745 3.15214772 -0.81662387 1.57567895 0 0 Z "
      fill="currentColor"
      transform="translate(90,93)"
    />
    <path
      d="M0 0 C0.99 0 1.98 0 3 0 C2.43454163 3.95820859 1.19097652 6.6659053 -1 10 C-1.66 9.67 -2.32 9.34 -3 9 C-2.44271087 5.65626525 -1.64826111 2.96687001 0 0 Z "
      fill="currentColor"
      transform="translate(37,97)"
    />
    <path
      d="M0 0 C4.92127034 -0.16682272 8.50343896 -0.24828052 13 2 C9.60268371 4.09065618 6.95730595 4.42098999 3 4 C1.125 2.5625 1.125 2.5625 0 1 C0 0.67 0 0.34 0 0 Z "
      fill="currentColor"
      transform="translate(110,12)"
    />
    <path
      d="M0 0 C0 0.99 0 1.98 0 3 C-3.08888522 5.05925681 -3.70935927 5.2390374 -7.1875 5.125 C-9.0746875 5.063125 -9.0746875 5.063125 -11 5 C-10.67 4.34 -10.34 3.68 -10 3 C-7.96875 2.40234375 -7.96875 2.40234375 -5.5 1.9375 C-2.46226779 1.54135157 -2.46226779 1.54135157 0 0 Z "
      fill="currentColor"
      transform="translate(62,107)"
    />
    <path
      d="M0 0 C0.66 0.33 1.32 0.66 2 1 C1.25 5.75 1.25 5.75 -1 8 C-1.66 8 -2.32 8 -3 8 C-1.125 1.125 -1.125 1.125 0 0 Z "
      fill="currentColor"
      transform="translate(154,94)"
    />
    <path
      d="M0 0 C2.64 0 5.28 0 8 0 C8.33 1.32 8.66 2.64 9 4 C6.03 3.01 3.06 2.02 0 1 C0 0.67 0 0.34 0 0 Z "
      fill="currentColor"
      transform="translate(110,93)"
    />
    <path
      d="M0 0 C1.67542976 0.28604898 3.34385343 0.61781233 5 1 C4.67 2.32 4.34 3.64 4 5 C2.0625 4.6875 2.0625 4.6875 0 4 C-0.33 3.01 -0.66 2.02 -1 1 C-0.67 0.67 -0.34 0.34 0 0 Z "
      fill="currentColor"
      transform="translate(21,87)"
    />
  </svg>
);
export const WikipediaIcon = createLogoIcon(wikipediaIcon);
export const XenforoIcon = createLogoIcon(xenforoIcon);
export const ZAIIcon = createLogoIcon(zAIIcon);
export const ZendeskIcon = ({
  size = 16,
  className = defaultTailwindCSS,
}: IconProps) => (
  <div
    className="rounded-full overflow-visible dark:overflow-hidden flex items-center justify-center dark:bg-[#fff]/90"
    style={{ width: size, height: size }}
  >
    <LogoIcon
      size={
        typeof window !== "undefined" &&
        window.matchMedia("(prefers-color-scheme: dark)").matches
          ? size * 0.8
          : size
      }
      className={`${className}`}
      src={zendeskIcon}
    />
  </div>
);
export const ZulipIcon = createLogoIcon(zulipIcon);

// ============================================================================
// FILE TYPE ICONS (Alphabetically)
// ============================================================================
export const DOCIcon = ({
  size = 24,
  className = defaultTailwindCSS,
}: IconProps) => {
  return (
    <svg
      style={{ width: `${size}px`, height: `${size}px` }}
      className={`text-blue-600 w-[${size}px] h-[${size}px] ` + className}
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M15.5,17H14L12,9.5L10,17H8.5L6.1,7H7.8L9.34,14.5L11.3,7H12.7L14.67,14.5L16.2,7H17.9M19,3H5C3.89,3 3,3.89 3,5V19A2,2 0 0,0 5,21H19A2,2 0 0,0 21,19V5C21,3.89 20.1,3 19,3Z"
        fill="currentColor"
      />
    </svg>
  );
};
export const HTMLIcon = ({
  size = 24,
  className = defaultTailwindCSS,
}: IconProps) => {
  return (
    <svg
      style={{ width: `${size}px`, height: `${size}px` }}
      className={`text-orange-600 w-[${size}px] h-[${size}px] ` + className}
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
    >
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zm-1 2 5 5h-5V4zM8.531 18h-.76v-1.411H6.515V18h-.767v-3.373h.767v1.296h1.257v-1.296h.76V18zm3-2.732h-.921V18h-.766v-2.732h-.905v-.641h2.592v.641zM14.818 18l-.05-1.291c-.017-.405-.03-.896-.03-1.387h-.016c-.104.431-.245.911-.375 1.307l-.41 1.316h-.597l-.359-1.307a15.154 15.154 0 0 1-.306-1.316h-.011c-.021.456-.034.976-.059 1.396L12.545 18h-.705l.216-3.373h1.015l.331 1.126c.104.391.21.811.284 1.206h.017c.095-.391.209-.836.32-1.211l.359-1.121h.996L15.563 18h-.745zm3.434 0h-2.108v-3.373h.767v2.732h1.342V18z"></path>
    </svg>
  );
};
export const ImagesIcon = ({
  size = 24,
  className = defaultTailwindCSS,
}: IconProps) => {
  return (
    <svg
      style={{ width: `${size}px`, height: `${size}px` }}
      className={`text-blue-600 w-[${size}px] h-[${size}px] ` + className}
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M19 3H5C3.9 3 3 3.9 3 5V19C3 20.1 3.9 21 5 21H19C20.1 21 21 20.1 21 19V5C21 3.9 20.1 3 19 3M9 11.5C9 12.3 8.3 13 7.5 13H6.5V15H5V9H7.5C8.3 9 9 9.7 9 10.5V11.5M14 15H12.5L11.5 12.5V15H10V9H11.5L12.5 11.5V9H14V15M19 10.5H16.5V13.5H17.5V12H19V13.7C19 14.4 18.5 15 17.7 15H16.4C15.6 15 15.1 14.3 15.1 13.7V10.4C15 9.7 15.5 9 16.3 9H17.6C18.4 9 18.9 9.7 18.9 10.3V10.5H19M6.5 10.5H7.5V11.5H6.5V10.5Z"
        fill="currentColor"
      />
    </svg>
  );
};
export const JSONIcon = ({
  size = 24,
  className = defaultTailwindCSS,
}: IconProps) => {
  return (
    <svg
      style={{ width: `${size}px`, height: `${size}px` }}
      className={`text-yellow-500 w-[${size}px] h-[${size}px] ` + className}
      xmlns="http://www.w3.org/2000/svg"
      width="200"
      height="200"
      viewBox="0 0 24 24"
    >
      <path
        fill="currentColor"
        d="M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2m3.25 8a1.25 1.25 0 1 0-2.5 0v2a1.25 1.25 0 1 0 2.5 0v-2m4.25-1.25a1.25 1.25 0 0 0-1.25 1.25v2a1.25 1.25 0 1 0 2.5 0v-2a1.25 1.25 0 0 0-1.25-1.25m4.25 1.25a1.25 1.25 0 1 0-2.5 0v2a1.25 1.25 0 1 0 2.5 0v-2z"
      />
    </svg>
  );
};
export const PDFIcon = ({
  size = 24,
  className = defaultTailwindCSS,
}: IconProps) => {
  return (
    <svg
      style={{ width: `${size}px`, height: `${size}px` }}
      className={`text-red-500 w-[${size}px] h-[${size}px] ` + className}
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M19 3H5C3.9 3 3 3.9 3 5V19C3 20.1 3.9 21 5 21H19C20.1 21 21 20.1 21 19V5C21 3.9 20.1 3 19 3M9.5 11.5C9.5 12.3 8.8 13 8 13H7V15H5.5V9H8C8.8 9 9.5 9.7 9.5 10.5V11.5M14.5 13.5C14.5 14.3 13.8 15 13 15H10.5V9H13C13.8 9 14.5 9.7 14.5 10.5V13.5M18.5 10.5H17V11.5H18.5V13H17V15H15.5V9H18.5V10.5M12 10.5H13V13.5H12V10.5M7 10.5H8V11.5H7V10.5Z"
        fill="currentColor"
      />
    </svg>
  );
};
export const TXTIcon = ({
  size = 24,
  className = defaultTailwindCSS,
}: IconProps) => {
  return (
    <svg
      style={{ width: `${size}px`, height: `${size}px` }}
      className={`text-blue-600 w-[${size}px] h-[${size}px] ` + className}
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      fill="currentColor"
      viewBox="0 0 24 24"
    >
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zM9.998 14.768H8.895v3.274h-.917v-3.274H6.893V14h3.105v.768zm2.725 3.274-.365-.731c-.15-.282-.246-.492-.359-.726h-.013c-.083.233-.185.443-.312.726l-.335.731h-1.045l1.171-2.045L10.336 14h1.05l.354.738c.121.245.21.443.306.671h.013c.096-.258.174-.438.276-.671l.341-.738h1.043l-1.139 1.973 1.198 2.069h-1.055zm4.384-3.274h-1.104v3.274h-.917v-3.274h-1.085V14h3.105v.768zM14 9h-1V4l5 5h-4z"></path>
    </svg>
  );
};
export const XMLIcon = ({
  size = 24,
  className = defaultTailwindCSS,
}: IconProps) => {
  return (
    <svg
      style={{ width: `${size}px`, height: `${size}px` }}
      className={`text-teal-500 w-[${size}px] h-[${size}px] ` + className}
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M19 3H5C3.89 3 3 3.89 3 5V19C3 20.11 3.89 21 5 21H19C20.11 21 21 20.11 21 19V5C21 3.89 20.11 3 19 3M8 15H6.5L6 13L5.5 15H4L4.75 12L4 9H5.5L6 11L6.5 9H8L7.25 12L8 15M15.5 15H14V10.5H13V14H11.5V10.5H10.5V15H9V11C9 9.9 9.9 9 11 9H13.5C14.61 9 15.5 9.9 15.5 11V15M20 15H17V9H18.5V13.5H20V15Z"
        fill="currentColor"
      />
    </svg>
  );
};
