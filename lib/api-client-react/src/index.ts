import {
  useMutation,
  useQuery,
  type UseQueryOptions,
} from "@tanstack/react-query";

export type Session = {
  id: number;
  title: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
};

export type Message = {
  id: number;
  sessionId: number;
  role: string;
  content: string;
  thinkingContent: string | null;
  createdAt: string;
};

export const getListSessionsQueryKey = () => ["/api/sessions"] as const;

export const getListMessagesQueryKey = (sessionId: number) =>
  ["/api/sessions", sessionId, "messages"] as const;

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(body || `Request failed: ${res.status}`);
  }
  if (res.status === 204) {
    return undefined as T;
  }
  return res.json() as Promise<T>;
}

export function useListSessions() {
  return useQuery({
    queryKey: getListSessionsQueryKey(),
    queryFn: () => fetchJson<Session[]>("/api/sessions"),
  });
}

export function useCreateSession() {
  return useMutation({
    mutationFn: ({ data }: { data: { title: string } }) =>
      fetchJson<Session>("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      }),
  });
}

export function useDeleteSession() {
  return useMutation({
    mutationFn: ({ id }: { id: number }) =>
      fetchJson<void>(`/api/sessions/${id}`, { method: "DELETE" }),
  });
}

export function useListMessages(
  sessionId: number,
  options?: {
    query?: Partial<UseQueryOptions<Message[], Error>>;
  },
) {
  const { query: queryOptions } = options ?? {};
  return useQuery({
    ...queryOptions,
    queryKey: queryOptions?.queryKey ?? getListMessagesQueryKey(sessionId),
    queryFn: () => fetchJson<Message[]>(`/api/sessions/${sessionId}/messages`),
  });
}
