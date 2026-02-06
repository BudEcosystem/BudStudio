"use client";

import React, { useState, memo } from "react";
import SvgMoreHorizontal from "@/icons/more-horizontal";
import SvgTrash from "@/icons/trash";
import SvgEdit from "@/icons/edit";
import { cn, noProp } from "@/lib/utils";
import {
  Popover,
  PopoverContent,
  PopoverMenu,
  PopoverTrigger,
} from "@/components/ui/popover";
import SidebarTab from "@/refresh-components/buttons/SidebarTab";
import IconButton from "@/refresh-components/buttons/IconButton";
import MenuButton from "@/refresh-components/buttons/MenuButton";
import { PopoverAnchor } from "@radix-ui/react-popover";
import ButtonRenaming from "@/sections/sidebar/ButtonRenaming";
import ConfirmationModal from "@/refresh-components/modals/ConfirmationModal";
import Button from "@/refresh-components/buttons/Button";
import { AgentSession, useAgentSession } from "@/components/desktop/AgentSessionContext";
import SvgSparkle from "@/icons/sparkle";

interface AgentSessionButtonProps {
  session: AgentSession;
}

function AgentSessionButtonInner({ session }: AgentSessionButtonProps) {
  const [renaming, setRenaming] = useState(false);
  const [deleteConfirmationModalOpen, setDeleteConfirmationModalOpen] =
    useState(false);
  const [popoverOpen, setPopoverOpen] = useState(false);

  const { currentSessionId, selectSession, deleteSession, updateSessionTitle } =
    useAgentSession();

  const isActive = currentSessionId === session.id;

  async function handleRename(newName: string) {
    updateSessionTitle(session.id, newName);
    setRenaming(false);
  }

  async function handleDelete() {
    deleteSession(session.id);
    setDeleteConfirmationModalOpen(false);
  }

  const popoverItems = [
    <MenuButton
      key="rename"
      icon={SvgEdit}
      onClick={noProp(() => setRenaming(true))}
    >
      Rename
    </MenuButton>,
    null,
    <MenuButton
      key="delete"
      icon={SvgTrash}
      onClick={noProp(() => setDeleteConfirmationModalOpen(true))}
      danger
    >
      Delete
    </MenuButton>,
  ];

  const rightMenu = (
    <>
      <PopoverTrigger asChild onClick={noProp()}>
        <div>
          <IconButton
            icon={SvgMoreHorizontal}
            className={cn(
              !popoverOpen && "hidden",
              !renaming && "group-hover/SidebarTab:flex"
            )}
            active={popoverOpen}
            internal
          />
        </div>
      </PopoverTrigger>
      <PopoverContent side="right" align="end">
        <PopoverMenu>{popoverItems}</PopoverMenu>
      </PopoverContent>
    </>
  );

  return (
    <>
      {deleteConfirmationModalOpen && (
        <ConfirmationModal
          title="Delete Agent Session"
          icon={SvgTrash}
          onClose={() => setDeleteConfirmationModalOpen(false)}
          submit={
            <Button danger onClick={handleDelete}>
              Delete
            </Button>
          }
        >
          Are you sure you want to delete this agent session? This action cannot
          be undone.
        </ConfirmationModal>
      )}

      <Popover
        onOpenChange={(state) => {
          setPopoverOpen(state);
        }}
      >
        <PopoverAnchor>
          <SidebarTab
            leftIcon={SvgSparkle}
            onClick={() => selectSession(session.id)}
            active={isActive}
            rightChildren={rightMenu}
            focused={renaming}
          >
            {renaming ? (
              <ButtonRenaming
                initialName={session.title}
                onRename={handleRename}
                onClose={() => setRenaming(false)}
              />
            ) : (
              session.title
            )}
          </SidebarTab>
        </PopoverAnchor>
      </Popover>
    </>
  );
}

const AgentSessionButton = memo(AgentSessionButtonInner);
export default AgentSessionButton;
