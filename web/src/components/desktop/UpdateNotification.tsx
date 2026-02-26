"use client";

import { useAutoUpdate, UpdateStatus } from "@/lib/desktop/useAutoUpdate";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import Button from "@/refresh-components/buttons/Button";
import { FiDownload, FiCheckCircle, FiAlertCircle, FiLoader } from "react-icons/fi";

function StatusIcon({ status }: { status: UpdateStatus }) {
  switch (status) {
    case "available":
      return <FiDownload className="w-5 h-5" />;
    case "downloading":
      return <FiLoader className="w-5 h-5 animate-spin" />;
    case "ready":
      return <FiCheckCircle className="w-5 h-5" />;
    case "error":
      return <FiAlertCircle className="w-5 h-5" />;
    default:
      return null;
  }
}

export function UpdateNotification() {
  const { status, updateInfo, error, installUpdate, dismiss } =
    useAutoUpdate();

  const isOpen =
    status === "available" ||
    status === "downloading" ||
    status === "ready" ||
    status === "error";

  if (!isOpen) return null;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && dismiss()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-3 mb-2">
            <div className="flex items-center justify-center w-10 h-10 rounded-full bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400">
              <StatusIcon status={status} />
            </div>
            <DialogTitle className="text-xl">
              {status === "available" && "Update Available"}
              {status === "downloading" && "Downloading Update"}
              {status === "ready" && "Update Ready"}
              {status === "error" && "Update Error"}
            </DialogTitle>
          </div>
          <DialogDescription className="text-left">
            {status === "available" &&
              `Version ${updateInfo?.version} is available. ${
                updateInfo?.body || "Would you like to update now?"
              }`}
            {status === "downloading" &&
              "Downloading and installing the update. Please wait..."}
            {status === "ready" &&
              "Update installed successfully. The app will restart shortly."}
            {status === "error" &&
              `Failed to update: ${error || "Unknown error"}. You can try again later.`}
          </DialogDescription>
        </DialogHeader>

        <DialogFooter className="gap-2 sm:gap-0">
          {status === "available" && (
            <>
              <Button secondary onClick={dismiss} className="min-w-[100px]">
                Later
              </Button>
              <Button action onClick={installUpdate} className="min-w-[100px]">
                Update Now
              </Button>
            </>
          )}
          {status === "downloading" && (
            <Button secondary disabled className="min-w-[100px]">
              Installing...
            </Button>
          )}
          {status === "error" && (
            <Button secondary onClick={dismiss} className="min-w-[100px]">
              Dismiss
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default UpdateNotification;
