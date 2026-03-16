"use client";

import { useParams, useRouter } from "next/navigation";
import { useCallback } from "react";
import { CanvasView } from "@/app/workflows/components/CanvasView";

export default function WorkflowDetailPage() {
  const params = useParams();
  const router = useRouter();
  const workflowId = params.workflowId as string;

  const handleNavigate = useCallback(
    (newId: string | null) => {
      if (newId) {
        router.replace(`/workflows/${newId}`, { scroll: false });
      } else {
        router.replace("/workflows", { scroll: false });
      }
    },
    [router]
  );

  return (
    <CanvasView
      initialFocusedWorkflowId={workflowId}
      onWorkflowNavigate={handleNavigate}
      testId="workflow-detail-page"
      emptyMessage="Workflow not found or no data available."
      showEmptyIcon={false}
    />
  );
}
