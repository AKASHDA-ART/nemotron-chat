import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import OpenAI, { APIError } from "openai";
import { db, sessionsTable, messagesTable } from "@workspace/db";
import { logger } from "../lib/logger";

const ALLOWED_MODELS = new Set([
  "nvidia/nemotron-3-super-120b-a12b",
  "nvidia/llama-3.1-nemotron-ultra-253b-v1",
  "meta/llama-3.3-70b-instruct",
  "mistralai/mistral-small-4-119b-2603",
  "deepseek-ai/deepseek-v4-pro",
]);

// Only the native Nemotron architecture models support the extra_body
// thinking params. Llama-based Nemotron variants (nemotron-ultra) do not.
const THINKING_MODELS = new Set([
  "nvidia/nemotron-3-super-120b-a12b",
]);

const router: IRouter = Router();

// ---------------------------------------------------------------------------
// In-memory rate limiter — max 10 requests per 60 s per session (or per IP
// for the very first message in a new session).
// ---------------------------------------------------------------------------
const RATE_LIMIT_MAX = 10;
const RATE_LIMIT_WINDOW_MS = 60_000;
const rateLimitMap = new Map<string, number[]>();

function checkRateLimit(key: string): { allowed: boolean; retryAfterSecs: number } {
  const now = Date.now();
  const timestamps = (rateLimitMap.get(key) ?? []).filter(
    (t) => now - t < RATE_LIMIT_WINDOW_MS
  );

  if (timestamps.length >= RATE_LIMIT_MAX) {
    const oldest = timestamps[0];
    const retryAfterSecs = Math.ceil((oldest + RATE_LIMIT_WINDOW_MS - now) / 1000);
    rateLimitMap.set(key, timestamps);
    return { allowed: false, retryAfterSecs };
  }

  timestamps.push(now);
  rateLimitMap.set(key, timestamps);
  return { allowed: true, retryAfterSecs: 0 };
}

const client = new OpenAI({
  baseURL: "https://integrate.api.nvidia.com/v1",
  apiKey: process.env.NVIDIA_API_KEY ?? "",
  // 120s timeout — Nemotron can take a while to start thinking
  timeout: 120_000,
});

// System prompt injected at API-call time only — never stored in the database.
// Change this string to adjust the assistant's persona/instructions globally.
const SYSTEM_PROMPT = "You are a helpful assistant.";

// Sliding-window context management.
// The model's context window is 16 384 tokens. We reserve 4 096 for the response
// and system prompt overhead, leaving 12 288 tokens for conversation history.
// Estimation: 1 token ≈ 4 characters (standard English approximation).
const MODEL_CONTEXT_TOKENS = 16_384;
const RESPONSE_RESERVE_TOKENS = 4_096;
const MAX_HISTORY_TOKENS = MODEL_CONTEXT_TOKENS - RESPONSE_RESERVE_TOKENS;

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

/**
 * Prepend the system prompt and trim the oldest conversation turns if the
 * estimated token count would exceed MAX_HISTORY_TOKENS.
 * The system prompt and the most-recent user message are always preserved.
 */
function buildContextWindow(
  history: ChatMessage[],
  sessionId: number
): ChatMessage[] {
  const systemTokens = estimateTokens(SYSTEM_PROMPT);
  const budget = MAX_HISTORY_TOKENS - systemTokens;

  // Work with a mutable copy so we can slice from the front
  let window = [...history];
  let total = window.reduce((sum, m) => sum + estimateTokens(m.content), 0);

  if (total <= budget) {
    return [{ role: "system", content: SYSTEM_PROMPT }, ...window];
  }

  // Drop oldest messages one at a time, but always keep at least the last
  // user message so the model has something to respond to.
  let trimmed = 0;
  while (window.length > 1 && total > budget) {
    const removed = window.shift()!;
    total -= estimateTokens(removed.content);
    trimmed++;
  }

  logger.warn(
    {
      sessionId,
      trimmedMessages: trimmed,
      remainingMessages: window.length,
      estimatedHistoryTokens: total,
      systemTokens,
    },
    "Context window limit reached — trimmed oldest messages from history"
  );

  return [{ role: "system", content: SYSTEM_PROMPT }, ...window];
}

function friendlyError(err: unknown): { message: string; code: string } {
  if (err instanceof APIError) {
    if (err.status === 401 || err.status === 403) {
      return { message: "Invalid or missing NVIDIA API key.", code: "auth_error" };
    }
    if (err.status === 429) {
      return { message: "Rate limit reached. Please wait a moment and try again.", code: "rate_limit" };
    }
    if (err.status === 503 || err.status === 502) {
      return { message: "The AI service is temporarily unavailable. Try again shortly.", code: "service_unavailable" };
    }
    if (err.status === 408 || err.message?.toLowerCase().includes("timeout")) {
      return { message: "The request timed out. The model may be overloaded — try again.", code: "timeout" };
    }
    const msg = err.message ?? "Unknown API error";
    return { message: `AI API error: ${msg}`, code: "api_error" };
  }
  if (err instanceof Error) {
    if (err.name === "AbortError" || err.message?.includes("timeout")) {
      return { message: "Request timed out after 120 seconds. Try a shorter prompt.", code: "timeout" };
    }
    if (err.message?.includes("ECONNREFUSED") || err.message?.includes("ENOTFOUND")) {
      return { message: "Could not connect to the AI service. Check your network.", code: "network_error" };
    }
  }
  return { message: "An unexpected error occurred. Please try again.", code: "unknown" };
}

/**
 * Generate a short session title by asking the model to summarise the first
 * user message in 4 words or fewer. Non-streaming, fire-and-forget friendly.
 */
async function generateSessionTitle(sessionId: number, firstMessage: string): Promise<void> {
  const completion = await client.chat.completions.create({
    model: "nvidia/nemotron-3-super-120b-a12b",
    messages: [
      {
        role: "system",
        content:
          "Reply with only a 4 word or less title for this conversation. No punctuation, no quotes, just the words.",
      },
      { role: "user", content: firstMessage },
    ],
    temperature: 0.7,
    max_tokens: 20,
    stream: false,
  });

  const title = completion.choices[0]?.message?.content?.trim();
  if (!title) return;

  await db
    .update(sessionsTable)
    .set({ title, updatedAt: new Date() })
    .where(eq(sessionsTable.id, sessionId));

  logger.info({ sessionId, title }, "Auto-generated session title");
}

router.post("/chat", async (req, res): Promise<void> => {
  const { sessionId, message, model } = req.body as {
    sessionId: number | null;
    message: string;
    model: string;
  };

  if (!message || typeof message !== "string") {
    res.status(400).json({ error: "message is required" });
    return;
  }

  if (!model || !ALLOWED_MODELS.has(model)) {
    res.status(400).json({
      error: `Invalid model. Allowed values: ${[...ALLOWED_MODELS].join(", ")}`,
    });
    return;
  }

  // Track whether this is the very first message in a new session so we know
  // to generate a title after the main response completes.
  const wasNewSession = !sessionId;
  let resolvedSessionId = sessionId;

  if (!resolvedSessionId) {
    // Placeholder title (first 50 chars) until the auto-title arrives.
    const placeholderTitle = message.slice(0, 50);
    const [session] = await db
      .insert(sessionsTable)
      .values({ title: placeholderTitle })
      .returning();
    resolvedSessionId = session.id;
  }

  await db.insert(messagesTable).values({
    sessionId: resolvedSessionId,
    role: "user",
    content: message,
    thinkingContent: null,
  });

  const history = await db
    .select()
    .from(messagesTable)
    .where(eq(messagesTable.sessionId, resolvedSessionId))
    .orderBy(messagesTable.createdAt);

  const apiMessages = buildContextWindow(
    history.map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
    resolvedSessionId
  );

  // Rate limit check — must happen after session resolution so we can key by
  // session ID, but before SSE headers so we can still return a JSON 429.
  const rateLimitKey = resolvedSessionId
    ? `session:${resolvedSessionId}`
    : `ip:${req.ip ?? "unknown"}`;
  const { allowed, retryAfterSecs } = checkRateLimit(rateLimitKey);
  if (!allowed) {
    logger.warn({ rateLimitKey, retryAfterSecs }, "Rate limit exceeded");
    res.status(429).json({
      error: `Too many requests. You've sent 10 messages in the last minute — please wait ${retryAfterSecs}s before trying again.`,
    });
    return;
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  const sendEvent = (payload: object) =>
    res.write(`data: ${JSON.stringify(payload)}\n\n`);

  sendEvent({ type: "session", sessionId: resolvedSessionId });

  let thinkingContent = "";
  let responseContent = "";

  // Abort controller wired to client disconnect — cancels the NVIDIA stream
  // immediately when the user hits Stop, rather than letting it run to completion.
  const streamAbort = new AbortController();
  req.on("close", () => streamAbort.abort());

  // Idempotent save: called both on normal completion and on user-abort.
  // The flag prevents double-inserts if both paths fire close together.
  let savedToDb = false;
  const savePartial = async (partial: boolean) => {
    if (savedToDb || !responseContent) return;
    savedToDb = true;
    await db.insert(messagesTable).values({
      sessionId: resolvedSessionId!,
      role: "assistant",
      content: responseContent,
      thinkingContent: thinkingContent || null,
    });
    await db
      .update(sessionsTable)
      .set({ updatedAt: new Date() })
      .where(eq(sessionsTable.id, resolvedSessionId!));
    if (partial) {
      logger.info(
        { sessionId: resolvedSessionId, contentLength: responseContent.length },
        "Saved partial assistant message after stream abort"
      );
    }
  };

  try {
    const completion = await (client.chat.completions.create as Function)({
      model,
      messages: apiMessages,
      temperature: 1,
      top_p: 0.95,
      max_tokens: 16384,
      // Thinking params only apply to Nemotron reasoning models.
      ...(THINKING_MODELS.has(model) && {
        extra_body: {
          chat_template_kwargs: { enable_thinking: true },
          reasoning_budget: 16384,
        },
      }),
      stream: true,
      signal: streamAbort.signal,
    });

    for await (const chunk of completion) {
      if (!chunk.choices?.length) continue;

      const delta = chunk.choices[0].delta as {
        content?: string | null;
        reasoning_content?: string | null;
      };

      if (delta.reasoning_content) {
        thinkingContent += delta.reasoning_content;
        sendEvent({ type: "thinking", content: delta.reasoning_content });
      }

      if (delta.content) {
        responseContent += delta.content;
        sendEvent({ type: "content", content: delta.content });
      }
    }

    await savePartial(false);

    // Signal that the main response is complete — frontend re-enables input
    // immediately on receiving this event without waiting for stream close.
    sendEvent({ type: "done", sessionId: resolvedSessionId });

    // For new sessions, generate a proper title now. The SSE stream stays open
    // briefly so we can push the result live; the frontend handles "title" events
    // separately from the main handoff.
    if (wasNewSession && resolvedSessionId) {
      try {
        await generateSessionTitle(resolvedSessionId, message);
        // Re-read the freshly saved title and send it to the frontend.
        const [session] = await db
          .select({ title: sessionsTable.title })
          .from(sessionsTable)
          .where(eq(sessionsTable.id, resolvedSessionId));
        if (session?.title) {
          sendEvent({ type: "title", title: session.title });
        }
      } catch (titleErr) {
        logger.error({ titleErr }, "Auto-title generation failed — session keeps placeholder title");
      }
    }

    res.end();
  } catch (err) {
    // AbortError means the client disconnected (user hit Stop).
    // Save whatever was generated — don't treat this as an error.
    if (err instanceof Error && err.name === "AbortError") {
      await savePartial(true);
      res.end();
      return;
    }
    const { message: errMsg, code } = friendlyError(err);
    logger.error({ err, code }, "Error calling NVIDIA API");
    sendEvent({ type: "error", message: errMsg, code });
    res.end();
  }
});

export default router;
