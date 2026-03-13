import { z } from "zod";
import { defineComponent, createLibrary } from "@openuidev/react-lang";
import { openuiChatLibrary } from "@openuidev/react-ui";
import { EmailDraftRenderer } from "./components/EmailDraft";

/* ------------------------------------------------------------------ */
/*  Custom components not provided by @openuidev/react-ui              */
/* ------------------------------------------------------------------ */

const EmailDraft = defineComponent({
  name: "EmailDraft",
  description: "Renders an email draft with recipients, subject, and body",
  props: z.object({
    to: z.array(z.string()),
    cc: z.array(z.string()).optional(),
    subject: z.string(),
    body: z.string(),
  }),
  component: EmailDraftRenderer,
});

/* ------------------------------------------------------------------ */
/*  Merged library: react-ui components + custom EmailDraft            */
/* ------------------------------------------------------------------ */

export const budStudioLibrary = createLibrary({
  root: "Card",
  components: [
    ...Object.values(openuiChatLibrary.components),
    EmailDraft,
  ],
  componentGroups: openuiChatLibrary.componentGroups
    ? [...openuiChatLibrary.componentGroups]
    : undefined,
});

export { EmailDraft };
