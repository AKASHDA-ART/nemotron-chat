import { Router, type IRouter } from "express";
import { eq, desc, sql } from "drizzle-orm";
import { db, sessionsTable, messagesTable } from "@workspace/db";
import {
  CreateSessionBody,
  DeleteSessionParams,
  ListMessagesParams,
  ListSessionsResponse,
  ListMessagesResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/sessions", async (_req, res): Promise<void> => {
  const rows = await db
    .select({
      id: sessionsTable.id,
      title: sessionsTable.title,
      createdAt: sessionsTable.createdAt,
      updatedAt: sessionsTable.updatedAt,
      messageCount: sql<number>`cast(count(${messagesTable.id}) as int)`,
    })
    .from(sessionsTable)
    .leftJoin(messagesTable, eq(messagesTable.sessionId, sessionsTable.id))
    .groupBy(sessionsTable.id)
    .orderBy(desc(sessionsTable.updatedAt));

  const serialized = rows.map((r) => ({
    ...r,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  }));

  res.json(ListSessionsResponse.parse(serialized));
});

router.post("/sessions", async (req, res): Promise<void> => {
  const parsed = CreateSessionBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [session] = await db
    .insert(sessionsTable)
    .values({ title: parsed.data.title })
    .returning();

  res.status(201).json({
    id: session.id,
    title: session.title,
    createdAt: session.createdAt.toISOString(),
    updatedAt: session.updatedAt.toISOString(),
    messageCount: 0,
  });
});

router.delete("/sessions/:id", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const params = DeleteSessionParams.safeParse({ id: parseInt(raw, 10) });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  await db.delete(sessionsTable).where(eq(sessionsTable.id, params.data.id));
  res.sendStatus(204);
});

router.get("/sessions/:id/messages", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const params = ListMessagesParams.safeParse({ id: parseInt(raw, 10) });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const messages = await db
    .select()
    .from(messagesTable)
    .where(eq(messagesTable.sessionId, params.data.id))
    .orderBy(messagesTable.createdAt);

  const serialized = messages.map((m) => ({
    ...m,
    createdAt: m.createdAt.toISOString(),
  }));

  res.json(ListMessagesResponse.parse(serialized));
});

export default router;
