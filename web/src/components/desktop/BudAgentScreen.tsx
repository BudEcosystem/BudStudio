"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { cn } from "@/lib/utils";
import { Logo } from "@/components/logo/Logo";
import { useAgentSession, AgentMessage } from "./AgentSessionContext";
import ChatInputBar from "@/app/chat/components/input/ChatInputBar";
import { useChatContext } from "@/refresh-components/contexts/ChatContext";
import { useAgentsContext } from "@/refresh-components/contexts/AgentsContext";
import { useLlmManager, useFilters } from "@/lib/hooks";
import { useProjectsContext } from "@/app/chat/projects/ProjectsContext";
import { ChatState } from "@/app/chat/interfaces";

/**
 * BudAgent Screen - Autonomous agent chat interface
 * Similar to chat but with its own sessions for agent tasks
 */
export function BudAgentScreen() {
  const [message, setMessage] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [chatState, setChatState] = useState<ChatState>("input");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textAreaRef = useRef<HTMLTextAreaElement>(null);

  const { currentSession, currentSessionId, createSession, addMessage } =
    useAgentSession();

  // Get data from chat context (same providers wrap BudAgentScreen)
  const { llmProviders } = useChatContext();
  const { agents: availableAssistants, liveAssistant } = useAgentsContext();
  const { setCurrentMessageFiles } = useProjectsContext();

  // Set up hooks that ChatInputBar needs
  const llmManager = useLlmManager(llmProviders);
  const filterManager = useFilters();

  // Use the default assistant or first available
  const selectedAssistant = liveAssistant || availableAssistants[0];

  const messages = currentSession?.messages || [];

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSubmit = useCallback(() => {
    if (!message.trim() || isProcessing) return;

    // Create a new session if there isn't one
    let sessionId = currentSessionId;
    if (!sessionId) {
      const newSession = createSession();
      sessionId = newSession.id;
    }

    // Add user message
    addMessage(sessionId, {
      role: "user",
      content: message,
    });

    setMessage("");
    setIsProcessing(true);
    setChatState("streaming");

    // Simulate agent response (TODO: integrate with actual agent backend)
    setTimeout(() => {
      addMessage(sessionId!, {
        role: "agent",
        content:
          "I understand you want me to help with that task. Let me work on it autonomously...",
        status: "complete",
      });
      setIsProcessing(false);
      setChatState("input");
    }, 1500);
  }, [message, isProcessing, currentSessionId, createSession, addMessage]);

  const stopProcessing = useCallback(() => {
    setIsProcessing(false);
    setChatState("input");
  }, []);

  const handleFileUpload = useCallback(
    (files: File[]) => {
      // TODO: Implement file upload for agent
      console.log("File upload for agent:", files);
    },
    []
  );

  // No-op handlers for features not used in agent mode
  const noOp = useCallback(() => {}, []);

  return (
    <div className="flex-1 flex flex-col h-full">
      {/* Messages Area */}
      <div className="flex-1 overflow-auto">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center px-4">
            <div className="mb-6">
              <Logo size="large" />
            </div>
            <h2 className="text-2xl font-semibold mb-3">Bud Agent</h2>
            <p className="text-base max-w-lg mb-8 text-text-subtle">
              I can work autonomously on complex tasks. Just describe what you
              need and I'll handle it.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-w-2xl w-full">
              {[
                "Research and summarize the latest AI trends",
                "Analyze my project and suggest improvements",
                "Write a technical blog post about...",
                "Create a data analysis report from...",
              ].map((suggestion, i) => (
                <button
                  key={i}
                  onClick={() => setMessage(suggestion)}
                  className="text-left px-4 py-3 rounded-lg border border-border transition-all hover:border-purple-500/50 hover:bg-background-emphasis"
                >
                  <span className="text-sm text-text-subtle">{suggestion}</span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="max-w-3xl mx-auto py-6 px-4 space-y-6">
            {messages.map((msg: AgentMessage) => (
              <div
                key={msg.id}
                className={cn(
                  "flex",
                  msg.role === "user" ? "justify-end" : "justify-start"
                )}
              >
                <div
                  className={cn(
                    "max-w-[80%] rounded-2xl px-4 py-3",
                    msg.role === "user"
                      ? "bg-purple-600 text-white"
                      : "bg-background-emphasis"
                  )}
                >
                  {msg.role === "agent" && (
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-purple-500 text-xs font-medium">
                        Bud Agent
                      </span>
                      {msg.status && msg.status !== "complete" && (
                        <span className="text-xs text-text-subtle">
                          {msg.status}...
                        </span>
                      )}
                    </div>
                  )}
                  <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
                </div>
              </div>
            ))}
            {isProcessing && (
              <div className="flex justify-start">
                <div className="rounded-2xl px-4 py-3 bg-background-emphasis">
                  <div className="flex items-center gap-2">
                    <span className="text-purple-500 text-xs font-medium">
                      Bud Agent
                    </span>
                    <div className="flex gap-1">
                      <span
                        className="w-2 h-2 rounded-full bg-purple-500 animate-bounce"
                        style={{ animationDelay: "0ms" }}
                      />
                      <span
                        className="w-2 h-2 rounded-full bg-purple-500 animate-bounce"
                        style={{ animationDelay: "150ms" }}
                      />
                      <span
                        className="w-2 h-2 rounded-full bg-purple-500 animate-bounce"
                        style={{ animationDelay: "300ms" }}
                      />
                    </div>
                  </div>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* Input Area - using the same ChatInputBar component */}
      <div className="p-4 flex justify-center">
        <ChatInputBar
          message={message}
          setMessage={setMessage}
          onSubmit={handleSubmit}
          stopGenerating={stopProcessing}
          chatState={chatState}
          llmManager={llmManager}
          filterManager={filterManager}
          selectedAssistant={selectedAssistant}
          selectedDocuments={[]}
          removeDocs={noOp}
          toggleDocumentSidebar={noOp}
          handleFileUpload={handleFileUpload}
          textAreaRef={textAreaRef}
          retrievalEnabled={false}
          deepResearchEnabled={false}
          toggleDeepResearch={noOp}
          currentSessionFileTokenCount={0}
          availableContextTokens={120000}
        />
      </div>
    </div>
  );
}
