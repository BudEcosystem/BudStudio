import { redirect } from "next/navigation";
import { unstable_noStore as noStore } from "next/cache";
import { fetchChatData } from "@/lib/chat/fetchChatData";
import { ChatProvider } from "@/refresh-components/contexts/ChatContext";
import { ProjectsProvider } from "@/app/chat/projects/ProjectsContext";
import AppSidebar from "@/sections/sidebar/AppSidebar";
import { ChatModalProvider } from "@/refresh-components/contexts/ChatModalContext";
import {
  DesktopModeProvider,
  DesktopHeader,
  ModeRenderer,
  AgentSessionProvider,
  CronNotificationProvider,
  InboxProvider,
  EventStreamProvider,
  UpdateNotification,
} from "@/components/desktop";

export default async function WorkflowsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  noStore();

  const safeSearchParams = {};

  const data = await fetchChatData(
    safeSearchParams as { [key: string]: string }
  );

  if ("redirect" in data) {
    redirect(data.redirect);
  }

  const {
    chatSessions,
    availableSources,
    documentSets,
    tags,
    llmProviders,
    availableTools,
    sidebarInitiallyVisible,
    defaultAssistantId,
    shouldShowWelcomeModal,
    ccPairs,
    inputPrompts,
    proSearchToggled,
    projects,
  } = data;

  return (
    <DesktopModeProvider>
      <EventStreamProvider>
        <CronNotificationProvider>
          <InboxProvider>
            <DesktopHeader />
            <ChatProvider
              proSearchToggled={proSearchToggled}
              inputPrompts={inputPrompts}
              chatSessions={chatSessions}
              sidebarInitiallyVisible={sidebarInitiallyVisible}
              availableSources={availableSources}
              ccPairs={ccPairs}
              documentSets={documentSets}
              tags={tags}
              availableDocumentSets={documentSets}
              availableTags={tags}
              llmProviders={llmProviders}
              availableTools={availableTools}
              shouldShowWelcomeModal={shouldShowWelcomeModal}
              defaultAssistantId={defaultAssistantId}
            >
              <ChatModalProvider>
                <ProjectsProvider initialProjects={projects}>
                  <AgentSessionProvider>
                    <div className="flex flex-row w-full h-full">
                      <AppSidebar />
                      <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
                        {children}
                      </div>
                    </div>
                  </AgentSessionProvider>
                </ProjectsProvider>
              </ChatModalProvider>
            </ChatProvider>
          </InboxProvider>
        </CronNotificationProvider>
      </EventStreamProvider>
      <UpdateNotification />
    </DesktopModeProvider>
  );
}
