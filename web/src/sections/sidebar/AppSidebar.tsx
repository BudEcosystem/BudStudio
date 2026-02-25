"use client";

import React, { useCallback, useEffect, memo, useMemo, useState } from "react";
import Image from "next/image";
import { useSettingsContext } from "@/components/settings/SettingsProvider";
import { MinimalPersonaSnapshot } from "@/app/admin/assistants/interfaces";
import Text from "@/refresh-components/texts/Text";
import ChatButton from "@/sections/sidebar/ChatButton";
import AgentButton from "@/sections/sidebar/AgentButton";
import { DragEndEvent } from "@dnd-kit/core";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  pointerWithin,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { useDroppable } from "@dnd-kit/core";
import {
  restrictToFirstScrollableAncestor,
  restrictToVerticalAxis,
} from "@dnd-kit/modifiers";
import SvgEditBig from "@/icons/edit-big";
import SvgMoreHorizontal from "@/icons/more-horizontal";
import Settings from "@/sections/sidebar/Settings";
import { SidebarSection } from "@/sections/sidebar/SidebarSection";
import AgentsModal from "@/sections/AgentsModal";
import { useChatContext } from "@/refresh-components/contexts/ChatContext";
import { useAgentsContext } from "@/refresh-components/contexts/AgentsContext";
import { useAppSidebarContext } from "@/refresh-components/contexts/AppSidebarContext";
import {
  ModalIds,
  useChatModal,
} from "@/refresh-components/contexts/ChatModalContext";
import SvgFolderPlus from "@/icons/folder-plus";
import SvgOnyxOctagon from "@/icons/onyx-octagon";
import ProjectFolderButton from "@/sections/sidebar/ProjectFolderButton";
import CreateProjectModal from "@/components/modals/CreateProjectModal";
import MoveCustomAgentChatModal from "@/components/modals/MoveCustomAgentChatModal";
import { useProjectsContext } from "@/app/chat/projects/ProjectsContext";
import { removeChatSessionFromProject } from "@/app/chat/projects/projectsService";
import type { Project } from "@/app/chat/projects/projectsService";
import { useAppRouter } from "@/hooks/appNavigation";
import { useSearchParams } from "next/navigation";
import SidebarWrapper from "@/sections/sidebar/SidebarWrapper";
import { usePopup } from "@/components/admin/connectors/Popup";
import IconButton from "@/refresh-components/buttons/IconButton";
import { cn } from "@/lib/utils";
import {
  DRAG_TYPES,
  DEFAULT_PERSONA_ID,
  LOCAL_STORAGE_KEYS,
} from "@/sections/sidebar/constants";
import { showErrorNotification, handleMoveOperation } from "./sidebarUtils";
import SidebarTab from "@/refresh-components/buttons/SidebarTab";
import { ChatSession } from "@/app/chat/interfaces";
import { SidebarBody } from "@/sections/sidebar/utils";
import SvgSettings from "@/icons/settings";
import { useDesktopMode } from "@/components/desktop/DesktopModeContext";
import { ModeSwitcher } from "@/components/desktop/ModeSwitcher";
import { useAgentSession } from "@/components/desktop/AgentSessionContext";
import SvgSparkle from "@/icons/sparkle";
import SvgClock from "@/icons/clock";
import SvgPlug from "@/icons/plug";
import SvgInbox from "@/icons/inbox";
import { useCronNotifications } from "@/components/desktop/CronNotificationContext";
import { useInbox } from "@/components/desktop/InboxContext";
import { CronNotificationPanel } from "@/components/desktop/CronNotificationPanel";
import { useTheme } from "next-themes";
import SvgSun from "@/icons/sun";
import SvgMoon from "@/icons/moon";
import SimpleTooltip from "@/refresh-components/SimpleTooltip";

// Visible-agents = pinned-agents + current-agent (if current-agent not in pinned-agents)
// OR Visible-agents = pinned-agents (if current-agent in pinned-agents)
function buildVisibleAgents(
  pinnedAgents: MinimalPersonaSnapshot[],
  currentAgent: MinimalPersonaSnapshot | null
): [MinimalPersonaSnapshot[], boolean] {
  /* NOTE: The unified agent (id = 0) is not visible in the sidebar, 
  so we filter it out. */
  if (!currentAgent)
    return [pinnedAgents.filter((agent) => agent.id !== 0), false];
  const currentAgentIsPinned = pinnedAgents.some(
    (pinnedAgent) => pinnedAgent.id === currentAgent.id
  );
  const visibleAgents = (
    currentAgentIsPinned ? pinnedAgents : [...pinnedAgents, currentAgent]
  ).filter((agent) => agent.id !== 0);

  return [visibleAgents, currentAgentIsPinned];
}

function ThemeSwitcher({
  isDark,
  folded,
  onToggle,
}: {
  isDark: boolean;
  folded: boolean;
  onToggle: () => void;
}) {
  // next-themes resolvedTheme is undefined during SSR/hydration.
  // Use a mounted flag to avoid showing stale state before the client hydrates.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const activeText = "#ffffff";
  const inactiveText = isDark ? "rgba(255,255,255,0.7)" : "rgba(0,0,0,0.7)";
  const activeBg = isDark ? "#101416" : "#101416";

  if (!mounted) return null;

  if (folded) {
    return (
      <SimpleTooltip tooltip={isDark ? "Switch to Light" : "Switch to Dark"}>
        <button
          onClick={onToggle}
          className="flex items-center justify-center w-full p-1.5 rounded-08 cursor-pointer hover:bg-background-neutral-03"
        >
          <div className="w-[1rem] h-[1rem] flex items-center justify-center">
            {isDark ? (
              <SvgMoon className="h-[1rem] w-[1rem] stroke-text-03" />
            ) : (
              <SvgSun className="h-[1rem] w-[1rem] stroke-text-03" />
            )}
          </div>
        </button>
      </SimpleTooltip>
    );
  }

  return (
    <div
      className="flex items-center rounded-lg p-1 border mt-4 bg-background-neutral-03 border-border-02"
    >
      <button
        onClick={() => !isDark || onToggle()}
        className={cn(
          "flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium transition-all duration-200 rounded-md",
          isDark && "hover:opacity-70"
        )}
        style={{
          color: !isDark ? activeText : inactiveText,
          background: !isDark ? activeBg : "transparent",
        }}
      >
        <SvgSun className="h-3 w-3" style={{ stroke: !isDark ? activeText : inactiveText }} />
        Light
      </button>
      <button
        onClick={() => isDark || onToggle()}
        className={cn(
          "flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium transition-all duration-200 rounded-md",
          !isDark && "hover:opacity-70"
        )}
        style={{
          color: isDark ? activeText : inactiveText,
          background: isDark ? activeBg : "transparent",
        }}
      >
        <SvgMoon className="h-3 w-3" style={{ stroke: isDark ? activeText : inactiveText }} />
        Dark
      </button>
    </div>
  );
}

interface RecentsSectionProps {
  isHistoryEmpty: boolean;
  chatSessions: ChatSession[];
}

function RecentsSection({ isHistoryEmpty, chatSessions }: RecentsSectionProps) {
  const { setNodeRef, isOver } = useDroppable({
    id: DRAG_TYPES.RECENTS,
    data: {
      type: DRAG_TYPES.RECENTS,
    },
  });

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "transition-colors duration-200 rounded-08 h-full",
        isOver && "bg-background-tint-03"
      )}
    >
      <SidebarSection title="Recents">
        {isHistoryEmpty ? (
          <Text text01 className="px-3">
            Try sending a message! Your chat history will appear here.
          </Text>
        ) : (
          chatSessions.map((chatSession) => (
            <ChatButton
              key={chatSession.id}
              chatSession={chatSession}
              draggable
            />
          ))
        )}
      </SidebarSection>
    </div>
  );
}

function AppSidebarInner() {
  const route = useAppRouter();
  const searchParams = useSearchParams();
  const { pinnedAgents, setPinnedAgents, currentAgent } = useAgentsContext();
  const { folded, setFolded } = useAppSidebarContext();
  const { chatSessions, refreshChatSessions } = useChatContext();
  const combinedSettings = useSettingsContext();
  const { refreshCurrentProjectDetails, fetchProjects, currentProjectId } =
    useProjectsContext();
  const { popup, setPopup } = usePopup();
  const { isDesktop, currentMode, setMode, agentView, setAgentView } =
    useDesktopMode();
  const { clearCurrentSession } = useAgentSession();
  const { unreadCount } = useCronNotifications();
  const { unreadCount: inboxUnreadCount } = useInbox();
  const { resolvedTheme, setTheme } = useTheme();
  const isDark = resolvedTheme === "dark";
  const [showNotifications, setShowNotifications] = useState(false);

  // State for custom agent modal
  const [pendingMoveChatSession, setPendingMoveChatSession] =
    useState<ChatSession | null>(null);
  const [pendingMoveProjectId, setPendingMoveProjectId] = useState<
    number | null
  >(null);
  const [showMoveCustomAgentModal, setShowMoveCustomAgentModal] =
    useState(false);
  const { isOpen, toggleModal } = useChatModal();
  const { projects } = useProjectsContext();

  const [visibleAgents, currentAgentIsPinned] = useMemo(
    () => buildVisibleAgents(pinnedAgents, currentAgent),
    [pinnedAgents, currentAgent]
  );
  const visibleAgentIds = useMemo(
    () => visibleAgents.map((agent) => agent.id),
    [visibleAgents]
  );

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  // Handle agent drag and drop
  const handleAgentDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over) return;
      if (active.id === over.id) return;

      setPinnedAgents((prev) => {
        const activeIndex = visibleAgentIds.findIndex(
          (agentId) => agentId === active.id
        );
        const overIndex = visibleAgentIds.findIndex(
          (agentId) => agentId === over.id
        );

        if (currentAgent && !currentAgentIsPinned) {
          // This is the case in which the user is dragging the UNPINNED agent and moving it to somewhere else in the list.
          // This is an indication that we WANT to pin this agent!
          if (activeIndex === visibleAgentIds.length - 1) {
            const prevWithVisible = [...prev, currentAgent];
            return arrayMove(prevWithVisible, activeIndex, overIndex);
          }
        }

        return arrayMove(prev, activeIndex, overIndex);
      });
    },
    [visibleAgentIds, setPinnedAgents, currentAgent, currentAgentIsPinned]
  );

  // Perform the actual move
  async function performChatMove(
    targetProjectId: number,
    chatSession: ChatSession
  ) {
    try {
      await handleMoveOperation(
        {
          chatSession,
          targetProjectId,
          refreshChatSessions,
          refreshCurrentProjectDetails,
          fetchProjects,
          currentProjectId,
        },
        setPopup
      );
      const projectRefreshPromise = currentProjectId
        ? refreshCurrentProjectDetails()
        : fetchProjects();
      await Promise.all([refreshChatSessions(), projectRefreshPromise]);
    } catch (error) {
      console.error("Failed to move chat:", error);
      throw error;
    }
  }

  // Handle chat to project drag and drop
  const handleChatProjectDragEnd = useCallback(
    async (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over) return;

      const activeData = active.data.current;
      const overData = over.data.current;

      if (!activeData || !overData) {
        return;
      }

      // Check if we're dragging a chat onto a project
      if (
        activeData?.type === DRAG_TYPES.CHAT &&
        overData?.type === DRAG_TYPES.PROJECT
      ) {
        const chatSession = activeData.chatSession as ChatSession;
        const targetProject = overData.project as Project;
        const sourceProjectId = activeData.projectId;

        // Don't do anything if dropping on the same project
        if (sourceProjectId === targetProject.id) {
          return;
        }

        const hideModal =
          typeof window !== "undefined" &&
          window.localStorage.getItem(
            LOCAL_STORAGE_KEYS.HIDE_MOVE_CUSTOM_AGENT_MODAL
          ) === "true";

        const isChatUsingDefaultAssistant =
          chatSession.persona_id === DEFAULT_PERSONA_ID;

        if (!isChatUsingDefaultAssistant && !hideModal) {
          setPendingMoveChatSession(chatSession);
          setPendingMoveProjectId(targetProject.id);
          setShowMoveCustomAgentModal(true);
          return;
        }

        try {
          await performChatMove(targetProject.id, chatSession);
        } catch (error) {
          showErrorNotification(
            setPopup,
            "Failed to move chat. Please try again."
          );
        }
      }

      // Check if we're dragging a chat from a project to the Recents section
      if (
        activeData?.type === DRAG_TYPES.CHAT &&
        overData?.type === DRAG_TYPES.RECENTS
      ) {
        const chatSession = activeData.chatSession as ChatSession;
        const sourceProjectId = activeData.projectId;

        // Only remove from project if it was in a project
        if (sourceProjectId) {
          try {
            await removeChatSessionFromProject(chatSession.id);
            const projectRefreshPromise = currentProjectId
              ? refreshCurrentProjectDetails()
              : fetchProjects();
            await Promise.all([refreshChatSessions(), projectRefreshPromise]);
          } catch (error) {
            console.error("Failed to remove chat from project:", error);
          }
        }
      }
    },
    [
      currentProjectId,
      refreshChatSessions,
      refreshCurrentProjectDetails,
      fetchProjects,
    ]
  );

  const isHistoryEmpty = useMemo(
    () => !chatSessions || chatSessions.length === 0,
    [chatSessions]
  );

  const newSessionButton = useMemo(
    () => (
      <div data-testid="AppSidebar/new-session">
        <SidebarTab
          leftIcon={SvgEditBig}
          folded={folded}
          onClick={() => {
            if (isDesktop && currentMode === "agent") {
              clearCurrentSession();
            } else {
              route({});
            }
          }}
          active={
            isDesktop && currentMode === "agent"
              ? false
              : Array.from(searchParams).length === 0
          }
        >
          New Session
        </SidebarTab>
      </div>
    ),
    [folded, route, searchParams, isDesktop, currentMode, clearCurrentSession]
  );

  const settingsButton = useMemo(
    () => (
      <div className="px-4">
        <Settings folded={folded} />
        <ThemeSwitcher isDark={isDark} folded={folded} onToggle={() => setTheme(isDark ? "light" : "dark")} />
      </div>
    ),
    [folded, isDark, setTheme]
  );

  if (!combinedSettings) {
    return null;
  }

  return (
    <>
      {popup}
      <AgentsModal />
      <CreateProjectModal />
      <CronNotificationPanel
        isOpen={showNotifications}
        onClose={() => setShowNotifications(false)}
      />

      {showMoveCustomAgentModal && (
        <MoveCustomAgentChatModal
          onCancel={() => {
            setShowMoveCustomAgentModal(false);
            setPendingMoveChatSession(null);
            setPendingMoveProjectId(null);
          }}
          onConfirm={async (doNotShowAgain: boolean) => {
            if (doNotShowAgain && typeof window !== "undefined") {
              window.localStorage.setItem(
                LOCAL_STORAGE_KEYS.HIDE_MOVE_CUSTOM_AGENT_MODAL,
                "true"
              );
            }
            const chat = pendingMoveChatSession;
            const target = pendingMoveProjectId;
            setShowMoveCustomAgentModal(false);
            setPendingMoveChatSession(null);
            setPendingMoveProjectId(null);
            if (chat && target != null) {
              try {
                await performChatMove(target, chat);
              } catch (error) {
                showErrorNotification(
                  setPopup,
                  "Failed to move chat. Please try again."
                );
              }
            }
          }}
        />
      )}

      <SidebarWrapper folded={folded} setFolded={setFolded} hideLogo={isDesktop}>
        {folded ? (
          <div className="flex flex-col h-full justify-between">
            <div className="px-2">
              {isDesktop ? (
                <>
                  {/* Mode switcher above notifications */}
                  <ModeSwitcher currentMode={currentMode} onModeChange={setMode} className="mb-2" />

                  {currentMode === "agent" ? (
                    <>
                      {/* Notification button above agent nav — Bud admin style */}
                      <div className="mb-[3%]">
                        <button
                          onClick={() => setShowNotifications(true)}
                          data-testid="sidebar-notifications-tab"
                          className="flex justify-start items-center rounded-[6.4px] bg-black/[0.03] dark:bg-white/[0.03] cursor-pointer w-full hover:bg-black/[0.08] dark:hover:bg-white/[0.1] hover:shadow-md p-[0.35rem] transition-all"
                        >
                          <div className="h-[1.5rem] flex justify-center items-center pl-[0.15rem]">
                            <Image
                              src="/images/BudIcon.png"
                              alt="info"
                              width={24}
                              height={24}
                              style={{ height: "auto", width: "1.5rem" }}
                            />
                          </div>
                          <div className="flex flex-row items-center justify-between w-full">
                            <span className="text-[0.625rem] font-normal text-muted-foreground pl-[1rem] whitespace-nowrap max-w-[70%] overflow-hidden text-ellipsis">
                              {unreadCount > 0
                                ? `${unreadCount} Notification${unreadCount > 1 ? "s" : ""}`
                                : "Notifications"}
                            </span>
                          </div>
                        </button>
                      </div>

                      <SidebarTab
                        leftIcon={SvgSparkle}
                        onClick={() => setAgentView("chat")}
                        active={agentView === "chat"}
                        folded
                      >
                        Chat
                      </SidebarTab>
                  <SidebarTab
                    leftIcon={SvgSettings}
                    onClick={() => setAgentView("configuration")}
                    active={agentView === "configuration"}
                    folded
                  >
                    Configuration
                  </SidebarTab>
                  <SidebarTab
                    leftIcon={SvgClock}
                    onClick={() => setAgentView("cron")}
                    active={agentView === "cron"}
                    folded
                    testId="sidebar-cron-tab"
                  >
                    Scheduled
                  </SidebarTab>
                  <SidebarTab
                    leftIcon={SvgPlug}
                    onClick={() => setAgentView("connectors")}
                    active={agentView === "connectors"}
                    folded
                    testId="sidebar-connectors-tab"
                  >
                    Connectors
                  </SidebarTab>
                  <SidebarTab
                    leftIcon={SvgInbox}
                    onClick={() => setAgentView("inbox")}
                    active={agentView === "inbox"}
                    folded
                    testId="sidebar-inbox-tab"
                  >
                    Inbox
                    {inboxUnreadCount > 0 && (
                      <span className="ml-auto text-xs bg-purple-600 text-white rounded-full px-1.5 py-0.5 min-w-[1.25rem] text-center">
                        {inboxUnreadCount}
                      </span>
                    )}
                  </SidebarTab>
                    </>
                  ) : (
                    <>
                      {newSessionButton}
                      <SidebarTab
                        leftIcon={SvgOnyxOctagon}
                        onClick={() => toggleModal(ModalIds.AgentsModal, true)}
                        active={isOpen(ModalIds.AgentsModal)}
                        folded
                      >
                        Agents
                      </SidebarTab>
                      <SidebarTab
                        leftIcon={SvgFolderPlus}
                        onClick={() =>
                          toggleModal(ModalIds.CreateProjectModal, true)
                        }
                        active={isOpen(ModalIds.CreateProjectModal)}
                        folded
                      >
                        New Project
                      </SidebarTab>
                    </>
                  )}
                </>
              ) : (
                <>
                  {newSessionButton}
                  <SidebarTab
                    leftIcon={SvgOnyxOctagon}
                    onClick={() => toggleModal(ModalIds.AgentsModal, true)}
                    active={isOpen(ModalIds.AgentsModal)}
                    folded
                  >
                    Agents
                  </SidebarTab>
                  <SidebarTab
                    leftIcon={SvgFolderPlus}
                    onClick={() =>
                      toggleModal(ModalIds.CreateProjectModal, true)
                    }
                    active={isOpen(ModalIds.CreateProjectModal)}
                    folded
                  >
                    New Project
                  </SidebarTab>
                </>
              )}
            </div>
            {settingsButton}
          </div>
        ) : (
          <>
            <SidebarBody
              actionButton={
                isDesktop
                  ? undefined
                  : newSessionButton
              }
              footer={settingsButton}
            >
              <>
                {isDesktop && (
                  <>
                    <ModeSwitcher currentMode={currentMode} onModeChange={setMode} className="mb-2" />
                    {currentMode === "chat" && newSessionButton}
                  </>
                )}

                {/* Agent mode: show a single "Chat" link */}
                {isDesktop && currentMode === "agent" ? (
                  <>
                    {/* Notification button above Bud Agent section — Bud admin style */}
                    <div className="mb-[3%]">
                      <button
                        onClick={() => setShowNotifications(true)}
                        data-testid="sidebar-notifications-tab"
                        className="flex justify-start items-center rounded-[6.4px] bg-black/[0.03] dark:bg-white/[0.03] cursor-pointer w-full hover:bg-black/[0.08] dark:hover:bg-white/[0.1] hover:shadow-md p-[0.35rem] transition-all"
                      >
                        <div className="h-[1.5rem] flex justify-center items-center pl-[0.15rem]">
                          <Image
                            src="/images/BudIcon.png"
                            alt="info"
                            width={24}
                            height={24}
                            style={{ height: "auto", width: "1.5rem" }}
                          />
                        </div>
                        <div className="flex flex-row items-center justify-between w-full">
                          <span className="text-[0.625rem] font-normal text-muted-foreground pl-[1rem] whitespace-nowrap max-w-[70%] overflow-hidden text-ellipsis">
                            {unreadCount > 0
                              ? `${unreadCount} Notification${unreadCount > 1 ? "s" : ""}`
                              : "Notifications"}
                          </span>
                        </div>
                      </button>
                    </div>

                    <SidebarSection title="">
                      <SidebarTab
                        leftIcon={SvgSparkle}
                        onClick={() => setAgentView("chat")}
                        active={agentView === "chat"}
                      >
                        Chat
                      </SidebarTab>
                      <SidebarTab
                        leftIcon={SvgSettings}
                        onClick={() => setAgentView("configuration")}
                        active={agentView === "configuration"}
                      >
                        Configuration
                      </SidebarTab>
                      <SidebarTab
                        leftIcon={SvgClock}
                        onClick={() => setAgentView("cron")}
                        active={agentView === "cron"}
                        testId="sidebar-cron-tab"
                      >
                        Scheduled Tasks
                      </SidebarTab>
                      <SidebarTab
                        leftIcon={SvgPlug}
                        onClick={() => setAgentView("connectors")}
                        active={agentView === "connectors"}
                        testId="sidebar-connectors-tab"
                      >
                        Connectors
                      </SidebarTab>
                      <SidebarTab
                        leftIcon={SvgInbox}
                        onClick={() => setAgentView("inbox")}
                        active={agentView === "inbox"}
                        testId="sidebar-inbox-tab"
                      >
                        Inbox
                        {inboxUnreadCount > 0 && (
                          <span className="ml-auto text-xs bg-purple-600 text-white rounded-full px-1.5 py-0.5 min-w-[1.25rem] text-center">
                            {inboxUnreadCount}
                          </span>
                        )}
                      </SidebarTab>
                    </SidebarSection>
                  </>
                ) : (
                  <>
                    {/* Chat mode: show agents, projects, and recents */}
                    <DndContext
                      sensors={sensors}
                      collisionDetection={closestCenter}
                      onDragEnd={handleAgentDragEnd}
                    >
                      <SidebarSection title="Agents">
                        <SortableContext
                          items={visibleAgentIds}
                          strategy={verticalListSortingStrategy}
                        >
                          {visibleAgents.map((visibleAgent) => (
                            <AgentButton
                              key={visibleAgent.id}
                              agent={visibleAgent}
                            />
                          ))}
                        </SortableContext>
                        <div data-testid="AppSidebar/more-agents">
                          <SidebarTab
                            leftIcon={SvgMoreHorizontal}
                            onClick={() => toggleModal(ModalIds.AgentsModal, true)}
                            lowlight
                          >
                            More Agents
                          </SidebarTab>
                        </div>
                      </SidebarSection>
                    </DndContext>

                    {/* Wrap Projects and Recents in a shared DndContext for chat-to-project drag */}
                    <DndContext
                      sensors={sensors}
                      collisionDetection={pointerWithin}
                      modifiers={[
                        restrictToFirstScrollableAncestor,
                        restrictToVerticalAxis,
                      ]}
                      onDragEnd={handleChatProjectDragEnd}
                    >
                      <SidebarSection
                        title="Projects"
                        action={
                          <IconButton
                            icon={SvgFolderPlus}
                            internal
                            tooltip="New Project"
                            onClick={() =>
                              toggleModal(ModalIds.CreateProjectModal, true)
                            }
                          />
                        }
                      >
                        {projects.map((project) => (
                          <ProjectFolderButton key={project.id} project={project} />
                        ))}

                        <SidebarTab
                          leftIcon={SvgFolderPlus}
                          onClick={() =>
                            toggleModal(ModalIds.CreateProjectModal, true)
                          }
                          lowlight
                        >
                          New Project
                        </SidebarTab>
                      </SidebarSection>

                      {/* Recents */}
                      <RecentsSection
                        isHistoryEmpty={isHistoryEmpty}
                        chatSessions={chatSessions}
                      />
                    </DndContext>
                  </>
                )}
              </>
            </SidebarBody>
          </>
        )}
      </SidebarWrapper>
    </>
  );
}

const AppSidebar = memo(AppSidebarInner);
AppSidebar.displayName = "AppSidebar";

export default AppSidebar;
