import { z } from "zod";

export const HealthCheckResponse = z.object({
  status: z.string(),
});

export const CreateSessionBody = z.object({
  title: z.string().min(1),
});

export const DeleteSessionParams = z.object({
  id: z.number().int().positive(),
});

export const ListMessagesParams = z.object({
  id: z.number().int().positive(),
});

export const SessionSchema = z.object({
  id: z.number(),
  title: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  messageCount: z.number(),
});

export const ListSessionsResponse = z.array(SessionSchema);

export const MessageSchema = z.object({
  id: z.number(),
  sessionId: z.number(),
  role: z.string(),
  content: z.string(),
  thinkingContent: z.string().nullable(),
  createdAt: z.string(),
});

export const ListMessagesResponse = z.array(MessageSchema);
