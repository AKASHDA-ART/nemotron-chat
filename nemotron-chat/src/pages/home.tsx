import { useState, useRef, useEffect, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useListMessages, getListMessagesQueryKey, getListSessionsQueryKey } from "@workspace/api-client-react";
import { SessionSidebar } from "@/components/chat/sidebar";
import { AssistantMarkdown } from "@/components/chat/assistant-markdown";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Send, Square, ChevronDown, ChevronRight, Loader2, Brain, AlertTriangle, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";

type StreamingState = { thinking: string; content: string };
type StreamError = { message: string; retryText: string };

const MODELS = [
  { id: "nvidia/nemotron-3-super-120b-a12b",        label: "Nemotron Super 120B" },
  { id: "nvidia/llama-3.1-nemotron-ultra-253b-v1",  label: "Nemotron Ultra 253B" },
  { id: "meta/llama-3.3-70b-instruct",              label: "Llama 3.3 70B" },
  { id: "mistralai/mistral-small-4-119b-2603",      label: "Mistral Small 4" },
  { id: "deepseek-ai/deepseek-v4-pro",              label: "DeepSeek V4 Pro" },
] as const;

type ModelId = typeof MODELS[number]["id"];

const DEFAULT_MODEL: ModelId = "nvidia/nemotron-3-super-120b-a12b";

function readStoredModel(): ModelId {
  try {
    const v = localStorage.getItem("selectedModel");
    if (v && MODELS.some((m) => m.id === v)) return v as ModelId;
  } catch { /* ignore */ }
  return DEFAULT_MODEL;
}

function ThinkingBlock({ content }: { content: string }) {
  const [open, setOpen] = useState(false);
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="mb-2">
      <CollapsibleTrigger
        className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors font-mono"
        data-testid="button-toggle-thinking"
      >
        <Brain className="h-3 w-3" />
        <span>Reasoning</span>
        {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div
          className="mt-1.5 p-3 border border-border bg-card text-xs text-muted-foreground font-mono leading-relaxed whitespace-pre-wrap overflow-auto max-h-64"
          data-testid="text-thinking-content"
        >
          {content}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

function MessageBubble({
  role,
  content,
  thinkingContent,
  isStreaming,
}: {
  role: "user" | "assistant";
  content: string;
  thinkingContent?: string | null;
  isStreaming?: boolean;
}) {
  const isUser = role === "user";
  return (
    <div
      className={cn("flex gap-3 px-4 py-3", isUser ? "justify-end" : "justify-start")}
      data-testid={`message-${role}`}
    >
      {!isUser && (
        <div className="flex-shrink-0 w-6 h-6 bg-primary flex items-center justify-center mt-0.5">
          <span className="text-primary-foreground text-[10px] font-mono font-bold">N</span>
        </div>
      )}
      <div className={cn("max-w-[75%] flex flex-col gap-1", isUser ? "items-end" : "items-start")}>
        {!isUser && thinkingContent && <ThinkingBlock content={thinkingContent} />}
        <div
          className={cn(
            "px-3 py-2 text-sm leading-relaxed min-w-0",
            isUser
              ? "whitespace-pre-wrap font-mono bg-primary text-primary-foreground"
              : "bg-card border border-border text-foreground"
          )}
          data-testid={`text-message-content-${role}`}
        >
          {isUser ? (
            <>
              {content}
              {isStreaming && (
                <span className="inline-block w-0.5 h-4 bg-current animate-pulse ml-0.5 align-middle" />
              )}
            </>
          ) : (
            <AssistantMarkdown content={content} isStreaming={isStreaming} />
          )}
        </div>
      </div>
      {isUser && (
        <div className="flex-shrink-0 w-6 h-6 bg-muted border border-border flex items-center justify-center mt-0.5">
          <span className="text-muted-foreground text-[10px] font-mono font-bold">U</span>
        </div>
      )}
    </div>
  );
}

function ErrorBubble({ error, onRetry }: { error: StreamError; onRetry: () => void }) {
  return (
    <div className="flex gap-3 px-4 py-3 justify-start" data-testid="error-bubble">
      <div className="flex-shrink-0 w-6 h-6 bg-destructive flex items-center justify-center mt-0.5">
        <AlertTriangle className="h-3 w-3 text-destructive-foreground" />
      </div>
      <div className="max-w-[75%] flex flex-col gap-2">
        <div className="px-3 py-2 border border-destructive bg-card text-sm font-mono text-destructive leading-relaxed">
          {error.message}
        </div>
        <button
          onClick={onRetry}
          className="flex items-center gap-1.5 text-xs font-mono text-muted-foreground hover:text-foreground transition-colors self-start"
          data-testid="button-retry"
        >
          <RotateCcw className="h-3 w-3" />
          Retry
        </button>
      </div>
    </div>
  );
}

function EmptyState({ onPrompt }: { onPrompt: (p: string) => void }) {
  const examples = [
    "Explain quantum entanglement simply",
    "Write a sorting algorithm and explain it",
    "What are the limits of AI reasoning?",
  ];
  return (
    <div
      className="flex-1 flex flex-col items-center justify-center text-center p-8 select-none"
      data-testid="empty-state"
    >
      <div className="w-12 h-12 bg-primary flex items-center justify-center mb-4">
        <span className="text-primary-foreground text-xl font-mono font-bold">N</span>
      </div>
      <h2 className="text-base font-mono font-semibold text-foreground mb-1">Nemotron Super 120B</h2>
      <p className="text-xs text-muted-foreground font-mono max-w-xs leading-relaxed">
        A 120B reasoning model with visible thinking. Ask anything — complex problems welcome.
      </p>
      <div className="mt-6 flex flex-col gap-2 w-full max-w-sm">
        {examples.map((prompt) => (
          <button
            key={prompt}
            onClick={() => onPrompt(prompt)}
            className="p-2 border border-border text-xs font-mono text-muted-foreground hover:text-foreground hover:border-muted-foreground transition-colors text-left"
            data-testid="text-example-prompt"
          >
            {prompt}
          </button>
        ))}
      </div>
    </div>
  );
}

export default function Home() {
  const [currentSessionId, setCurrentSessionId] = useState<number | undefined>();
  const [selectedModel, setSelectedModel] = useState<ModelId>(readStoredModel);
  const [inputValue, setInputValue] = useState("");
  const [isWaiting, setIsWaiting] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [streaming, setStreaming] = useState<StreamingState | null>(null);
  const [optimisticUserMsg, setOptimisticUserMsg] = useState<string | null>(null);
  const [streamError, setStreamError] = useState<StreamError | null>(null);
  const pendingClearRef = useRef(false);
  const isGeneratingRef = useRef(false); // synchronous guard against rapid double-clicks
  const handoffDoneRef = useRef(false);  // prevents double-handoff when "done" event fires early
  const abortRef = useRef<AbortController | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();

  const { data: messages = [] } = useListMessages(currentSessionId!, {
    query: {
      enabled: !!currentSessionId,
      queryKey: getListMessagesQueryKey(currentSessionId!),
    },
  });

  // Once messages contains the assistant reply we can safely drop the streaming overlay.
  useEffect(() => {
    if (
      pendingClearRef.current &&
      messages.length > 0 &&
      messages[messages.length - 1].role === "assistant"
    ) {
      pendingClearRef.current = false;
      setStreaming(null);
      setOptimisticUserMsg(null);
    }
  }, [messages]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streaming, isWaiting, optimisticUserMsg, streamError]);

  useEffect(() => {
    const ta = textareaRef.current;
    if (ta) {
      ta.style.height = "auto";
      ta.style.height = Math.min(ta.scrollHeight, 160) + "px";
    }
  }, [inputValue]);

  const clearErrorState = () => {
    setStreamError(null);
    setStreaming(null);
    setOptimisticUserMsg(null);
    pendingClearRef.current = false;
  };

  const handleSend = useCallback(
    async (content?: string) => {
      const text = (content ?? inputValue).trim();
      // Check the ref first — synchronous guard that works even before React
      // re-renders the isGenerating state (prevents rapid double-click firing).
      if (!text || isGeneratingRef.current) return;
      isGeneratingRef.current = true;
      handoffDoneRef.current = false;

      setInputValue("");
      setStreamError(null);
      setOptimisticUserMsg(text);
      setIsGenerating(true);
      setIsWaiting(true);
      setStreaming(null);

      abortRef.current = new AbortController();
      let resolvedSessionId: number | undefined = currentSessionId;
      // Track whether a fatal error occurred so finally knows whether to
      // attempt the normal "pending clear" handoff or clean up immediately.
      let fatalError: StreamError | null = null;
      // Set to true when the user hits Stop — triggers the partial-save handoff.
      let wasStopped = false;

      try {
        let response: Response;
        try {
          response = await fetch("/api/chat", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ sessionId: currentSessionId ?? null, message: text, model: selectedModel }),
            signal: abortRef.current.signal,
          });
        } catch (fetchErr: unknown) {
          if (fetchErr instanceof Error && fetchErr.name === "AbortError") {
            // User cancelled — clean up silently
            return;
          }
          // Network error before the connection was established
          fatalError = {
            message: "Could not reach the server. Check your network connection.",
            retryText: text,
          };
          return;
        }

        if (!response.ok) {
          let errMsg = `Server error (${response.status})`;
          try {
            const body = await response.json() as { error?: string };
            if (body.error) errMsg = body.error;
          } catch { /* ignore */ }
          fatalError = { message: errMsg, retryText: text };
          return;
        }

        if (!response.body) {
          fatalError = { message: "No response body received from server.", retryText: text };
          return;
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let thinkingAcc = "";
        let contentAcc = "";

        try {
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;

            const lines = decoder.decode(value, { stream: true }).split("\n");

            for (const line of lines) {
              if (!line.startsWith("data: ")) continue;
              const dataStr = line.slice(6).trim();
              if (!dataStr) continue;

              try {
                const evt = JSON.parse(dataStr) as {
                  type: string;
                  content?: string;
                  sessionId?: number;
                  message?: string;
                  title?: string;
                };

                if (evt.type === "session" && evt.sessionId) {
                  resolvedSessionId = evt.sessionId;
                } else if (evt.type === "thinking" && evt.content) {
                  setIsWaiting(false);
                  thinkingAcc += evt.content;
                  setStreaming({ thinking: thinkingAcc, content: contentAcc });
                } else if (evt.type === "content" && evt.content) {
                  setIsWaiting(false);
                  contentAcc += evt.content;
                  setStreaming({ thinking: thinkingAcc, content: contentAcc });
                } else if (evt.type === "error") {
                  fatalError = {
                    message: evt.message ?? "An error occurred while generating the response.",
                    retryText: text,
                  };
                } else if (evt.type === "done" && !fatalError && resolvedSessionId) {
                  // Main response complete — re-enable input immediately without
                  // waiting for the stream to fully close (title may still be coming).
                  if (!handoffDoneRef.current) {
                    handoffDoneRef.current = true;
                    const sid = resolvedSessionId;
                    setIsWaiting(false);
                    setIsGenerating(false);
                    isGeneratingRef.current = false;
                    pendingClearRef.current = true;
                    setCurrentSessionId(sid);
                    queryClient.invalidateQueries({ queryKey: getListMessagesQueryKey(sid) });
                    queryClient.invalidateQueries({ queryKey: getListSessionsQueryKey() });
                  }
                } else if (evt.type === "title" && evt.title) {
                  // Auto-generated title arrived — refresh the sessions sidebar.
                  queryClient.invalidateQueries({ queryKey: getListSessionsQueryKey() });
                }
              } catch { /* ignore malformed JSON */ }
            }
          }
        } catch (readErr: unknown) {
          if (readErr instanceof Error && readErr.name === "AbortError") {
            // User hit Stop — don't treat as error, fall through to finally
            // for the partial-save handoff path.
            wasStopped = true;
          } else {
            // Stream dropped mid-way (network disconnect, server restart, etc.)
            fatalError = {
              message: "Connection lost mid-stream. The response may be incomplete.",
              retryText: text,
            };
          }
        }
      } finally {
        setIsWaiting(false);
        setIsGenerating(false);
        isGeneratingRef.current = false;

        if (fatalError) {
          // Show the error bubble; keep the optimistic user message visible so
          // the user can see what they sent alongside the retry button.
          setStreaming(null);
          setStreamError(fatalError);
          // Don't clear optimisticUserMsg — it stays as context for the error
        } else if (wasStopped && resolvedSessionId) {
          // User hit Stop — backend is saving the partial message right now.
          // Wait briefly for the DB write to finish, then reload the session.
          const stoppedSessionId = resolvedSessionId;
          pendingClearRef.current = true;
          setCurrentSessionId(stoppedSessionId);
          setTimeout(() => {
            queryClient.invalidateQueries({ queryKey: getListMessagesQueryKey(stoppedSessionId) });
            queryClient.invalidateQueries({ queryKey: getListSessionsQueryKey() });
          }, 600);
        } else if (wasStopped) {
          // Stopped before a session was created (no content yet) — just clean up.
          setStreaming(null);
          setOptimisticUserMsg(null);
        } else if (!handoffDoneRef.current && resolvedSessionId) {
          // Normal completion path — only runs if the "done" SSE event didn't
          // already trigger the handoff (e.g. for returning sessions or errors).
          pendingClearRef.current = true;
          setCurrentSessionId(resolvedSessionId);
          queryClient.invalidateQueries({ queryKey: getListMessagesQueryKey(resolvedSessionId) });
          queryClient.invalidateQueries({ queryKey: getListSessionsQueryKey() });
        } else if (!handoffDoneRef.current) {
          setStreaming(null);
          setOptimisticUserMsg(null);
        }
        // If handoffDoneRef.current is true, the "done" SSE event already handled
        // the handoff — nothing left to do here.
      }
    },
    [inputValue, isGenerating, currentSessionId, queryClient, selectedModel]
  );

  const stopStream = () => {
    abortRef.current?.abort();
    // State cleanup is handled by handleSend's finally block via wasStopped.
  };

  const handleRetry = () => {
    if (!streamError) return;
    const text = streamError.retryText;
    clearErrorState();
    handleSend(text);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleSelectSession = (id: number) => {
    abortRef.current?.abort();
    setCurrentSessionId(id > 0 ? id : undefined);
    clearErrorState();
    setIsWaiting(false);
    setIsGenerating(false);
  };

  const displayMessages = [
    ...messages,
    ...(optimisticUserMsg
      ? [{ id: -2, sessionId: currentSessionId ?? -1, role: "user" as const, content: optimisticUserMsg, thinkingContent: null, createdAt: "" }]
      : []),
    ...(streaming
      ? [{ id: -1, sessionId: currentSessionId ?? -1, role: "assistant" as const, content: streaming.content, thinkingContent: streaming.thinking || null, createdAt: "" }]
      : []),
  ];

  const isActive = isGenerating || isWaiting;
  const canSend = inputValue.trim().length > 0 && !isActive;
  const isEmpty = displayMessages.length === 0 && !isWaiting && !streamError;

  return (
    <div className="flex h-screen w-full overflow-hidden bg-background">
      <SessionSidebar currentSessionId={currentSessionId} onSelectSession={handleSelectSession} />

      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 h-10 border-b border-border flex-shrink-0">
          <span className="text-xs font-mono text-muted-foreground">
            {currentSessionId ? `session_${currentSessionId}` : "no session"}
          </span>
          <select
            value={selectedModel}
            onChange={(e) => {
              const id = e.target.value as ModelId;
              setSelectedModel(id);
              try { localStorage.setItem("selectedModel", id); } catch { /* ignore */ }
            }}
            disabled={isActive}
            className="text-xs font-mono text-muted-foreground bg-transparent border-none outline-none cursor-pointer hover:text-foreground transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            data-testid="select-model"
          >
            {MODELS.map((m) => (
              <option key={m.id} value={m.id} className="bg-background text-foreground">
                {m.label}
              </option>
            ))}
          </select>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto" data-testid="messages-container">
          {isEmpty ? (
            <EmptyState onPrompt={(p) => handleSend(p)} />
          ) : (
            <div className="py-4">
              {displayMessages.map((msg) => (
                <MessageBubble
                  key={msg.id}
                  role={msg.role as "user" | "assistant"}
                  content={msg.content}
                  thinkingContent={msg.thinkingContent}
                  isStreaming={msg.id === -1}
                />
              ))}

              {isWaiting && (
                <div className="flex gap-3 px-4 py-3" data-testid="thinking-indicator">
                  <div className="w-6 h-6 bg-primary flex items-center justify-center flex-shrink-0 mt-0.5">
                    <span className="text-primary-foreground text-[10px] font-mono font-bold">N</span>
                  </div>
                  <div className="flex items-center gap-1.5 text-muted-foreground">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    <span className="text-xs font-mono animate-pulse">thinking...</span>
                  </div>
                </div>
              )}

              {streamError && (
                <ErrorBubble error={streamError} onRetry={handleRetry} />
              )}

              <div ref={bottomRef} />
            </div>
          )}
        </div>

        {/* Input area */}
        <div className="border-t border-border p-3 flex-shrink-0">
          <div className="flex gap-2 items-end">
            <div className="flex-1 border border-border bg-card focus-within:border-muted-foreground transition-colors">
              <textarea
                ref={textareaRef}
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Send a message..."
                rows={1}
                disabled={isActive}
                className="w-full bg-transparent px-3 py-2 text-sm font-mono text-foreground placeholder:text-muted-foreground resize-none focus:outline-none leading-relaxed disabled:opacity-50"
                style={{ minHeight: "38px", maxHeight: "160px" }}
                data-testid="input-message"
              />
            </div>
            <Button
              size="icon"
              className="h-9 w-9 flex-shrink-0"
              onClick={isActive ? stopStream : () => handleSend()}
              disabled={!isActive && !canSend}
              data-testid="button-send"
            >
              {isActive ? <Square className="h-4 w-4" /> : <Send className="h-4 w-4" />}
            </Button>
          </div>
          <p className="text-[10px] text-muted-foreground font-mono mt-1.5 px-0.5">
            Enter to send · Shift+Enter for newline
          </p>
        </div>
      </div>
    </div>
  );
}
