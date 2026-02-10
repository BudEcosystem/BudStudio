"use client";

import { useState, useEffect, useCallback } from "react";
import { AgentConfigSkeleton } from "./AgentConfigSkeleton";

interface WorkspaceFile {
  path: string;
  content: string;
  created_at: string;
  updated_at: string;
}

export function AgentConfigView() {
  const [files, setFiles] = useState<WorkspaceFile[]>([]);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [editorContent, setEditorContent] = useState("");
  const [savedContent, setSavedContent] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isDirty = editorContent !== savedContent;

  const fetchFiles = useCallback(async () => {
    try {
      setLoading(true);
      const resp = await fetch("/api/agent/workspace-files");
      if (!resp.ok) throw new Error("Failed to fetch workspace files");
      const data = (await resp.json()) as { files: WorkspaceFile[] };
      setFiles(data.files);
      const firstFile = data.files[0];
      if (firstFile && !selectedPath) {
        setSelectedPath(firstFile.path);
        setEditorContent(firstFile.content);
        setSavedContent(firstFile.content);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [selectedPath]);

  useEffect(() => {
    fetchFiles();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const [fileError, setFileError] = useState<string | null>(null);

  const selectFile = useCallback(
    async (path: string) => {
      if (path === selectedPath) return;
      setFileError(null);
      try {
        const encodedPath = path
          .split("/")
          .map(encodeURIComponent)
          .join("/");
        const resp = await fetch(
          `/api/agent/workspace-files/${encodedPath}`
        );
        if (!resp.ok) throw new Error("Failed to read file");
        const data = (await resp.json()) as WorkspaceFile;
        setSelectedPath(path);
        setEditorContent(data.content);
        setSavedContent(data.content);
      } catch (err) {
        setSelectedPath(path);
        setEditorContent("");
        setSavedContent("");
        setFileError(err instanceof Error ? err.message : "Unknown error");
      }
    },
    [selectedPath]
  );

  const saveFile = useCallback(async () => {
    if (!selectedPath) return;
    try {
      setSaving(true);
      const resp = await fetch("/api/agent/workspace-files", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: selectedPath, content: editorContent }),
      });
      if (!resp.ok) throw new Error("Failed to save file");
      setSavedContent(editorContent);
      // Refresh file list to update timestamps
      const listResp = await fetch("/api/agent/workspace-files");
      if (listResp.ok) {
        const data = (await listResp.json()) as { files: WorkspaceFile[] };
        setFiles(data.files);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setSaving(false);
    }
  }, [selectedPath, editorContent]);

  if (loading) {
    return <AgentConfigSkeleton />;
  }

  if (error) {
    return (
      <div className="h-full flex items-center justify-center text-red-500">
        {error}
      </div>
    );
  }

  return (
    <div className="flex-1 h-full overflow-hidden">
      <div className="h-full flex flex-col px-4 md:px-12 pt-24 pb-4">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-text-04 mb-1">
            Configuration
          </h1>
          <p className="text-sm text-text-02">
            View and edit workspace files that persist across agent sessions.
          </p>
        </div>

        {files.length === 0 ? (
          <div className="flex-1 flex items-center justify-center text-text-02">
            No workspace files found. Start a conversation with the Bud Agent
            to create them.
          </div>
        ) : (
          <div className="flex-1 flex gap-4 min-h-0">
            {/* File list */}
            <div className="w-48 shrink-0 overflow-y-auto border border-border rounded-lg">
              {files.map((file) => (
                <button
                  key={file.path}
                  className={`w-full text-left px-3 py-2 text-sm border-b border-border last:border-b-0 transition-colors ${
                    selectedPath === file.path
                      ? "bg-background-tint-03 text-text-04 font-medium"
                      : "text-text-03 hover:bg-background-tint-01"
                  }`}
                  onClick={() => selectFile(file.path)}
                >
                  {file.path}
                </button>
              ))}
            </div>

            {/* Editor */}
            <div className="flex-1 flex flex-col min-w-0 border border-border rounded-lg overflow-hidden">
              <div className="flex items-center justify-between px-4 py-2 border-b border-border bg-background-tint-01">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-text-04 font-mono">
                    {selectedPath}
                  </span>
                  {isDirty && (
                    <span className="text-xs text-amber-500">
                      (unsaved)
                    </span>
                  )}
                </div>
                <button
                  className="px-3 py-1 text-sm rounded bg-purple-600 text-white hover:bg-purple-700 disabled:bg-purple-400 disabled:cursor-not-allowed"
                  disabled={!isDirty || saving}
                  onClick={saveFile}
                >
                  {saving ? "Saving..." : "Save"}
                </button>
              </div>
              {fileError ? (
                <div className="flex-1 flex items-center justify-center text-sm text-red-500">
                  {fileError}
                </div>
              ) : (
                <textarea
                  className="flex-1 w-full p-4 text-sm font-mono bg-transparent text-text-04 resize-none focus:outline-none"
                  value={editorContent}
                  onChange={(e) => setEditorContent(e.target.value)}
                  spellCheck={false}
                />
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
