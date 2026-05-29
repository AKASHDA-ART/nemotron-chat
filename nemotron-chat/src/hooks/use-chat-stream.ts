import { useState, useRef, useCallback } from "react";
import type { Message } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { getListMessagesQueryKey, getListSessionsQueryKey } from "@workspace/api-client-react";

export type OptimisticMessage = Omit<Message, "id" | "sessionId" | "createdAt"> & {
  id?: number;
  sessionId?: number;
  createdAt?: string;
  isStreaming?: boolean;
};

export function useChatStream(sessionId?: number, onAutoCreateSession?: (title: string, userMessage: string) => Promise<number>) {
  const queryClient = useQueryClient();
  const [streamingMessage, setStreamingMessage] = useState<OptimisticMessage | null>(null);
  const [isWaiting, setIsWaiting] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);

  const sendMessage = useCallback(async (content: string) => {
    let targetSessionId = sessionId;

    // Auto-create session if none exists
    if (!targetSessionId) {
      if (!onAutoCreateSession) return;
      const title = content.substring(0, 50);
      targetSessionId = await onAutoCreateSession(title, content);
    }

    if (!targetSessionId) return;

    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    abortControllerRef.current = new AbortController();
    setIsWaiting(true);
    setStreamingMessage({
      role: "assistant",
      content: "",
      thinkingContent: "",
      isStreaming: true
    });

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: targetSessionId, message: content }),
        signal: abortControllerRef.current.signal
      });

      if (!response.ok) {
        throw new Error("Failed to stream chat");
      }

      setIsWaiting(false);

      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let done = false;
      let assistantContent = "";
      let assistantThinking = "";

      while (!done) {
        const { value, done: readerDone } = await reader.read();
        done = readerDone;
        if (value) {
          const chunk = decoder.decode(value, { stream: !done });
          const lines = chunk.split('\n');
          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const dataStr = line.substring(6).trim();
              if (!dataStr) continue;
              try {
                const data = JSON.parse(dataStr);
                if (data.type === 'thinking') {
                  assistantThinking += data.content;
                  setStreamingMessage(prev => prev ? { ...prev, thinkingContent: assistantThinking } : null);
                } else if (data.type === 'content') {
                  assistantContent += data.content;
                  setStreamingMessage(prev => prev ? { ...prev, content: assistantContent } : null);
                } else if (data.type === 'done') {
                  // End of stream
                }
              } catch (e) {
                console.error("Error parsing stream chunk", e, dataStr);
              }
            }
          }
        }
      }
    } catch (err: any) {
      if (err.name !== "AbortError") {
        console.error("Stream error", err);
      }
    } finally {
      setStreamingMessage(null);
      setIsWaiting(false);
      // Invalidate queries to refresh actual messages
      if (targetSessionId) {
        queryClient.invalidateQueries({ queryKey: getListMessagesQueryKey(targetSessionId) });
        queryClient.invalidateQueries({ queryKey: getListSessionsQueryKey() });
      }
    }
  }, [sessionId, queryClient, onAutoCreateSession]);

  const stopStream = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
  }, []);

  return { sendMessage, streamingMessage, isWaiting, stopStream };
}
