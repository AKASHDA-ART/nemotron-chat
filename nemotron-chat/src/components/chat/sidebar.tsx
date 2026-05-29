import { useListSessions, useCreateSession, useDeleteSession, getListSessionsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Plus, MessageSquare, Trash2, Loader2 } from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";

interface SessionSidebarProps {
  currentSessionId?: number;
  onSelectSession: (id: number) => void;
}

export function SessionSidebar({ currentSessionId, onSelectSession }: SessionSidebarProps) {
  const { data: sessions, isLoading } = useListSessions();
  const createSession = useCreateSession();
  const deleteSession = useDeleteSession();
  const queryClient = useQueryClient();

  const handleCreateSession = () => {
    createSession.mutate({ data: { title: "New Session" } }, {
      onSuccess: (newSession) => {
        queryClient.invalidateQueries({ queryKey: getListSessionsQueryKey() });
        onSelectSession(newSession.id);
      }
    });
  };

  const handleDeleteSession = (e: React.MouseEvent, id: number) => {
    e.stopPropagation();
    if (confirm("Delete this session?")) {
      deleteSession.mutate({ id }, {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListSessionsQueryKey() });
          if (currentSessionId === id) {
            onSelectSession(0); // clear
          }
        }
      });
    }
  };

  return (
    <div className="w-64 h-full border-r border-border bg-sidebar flex flex-col flex-shrink-0">
      <div className="p-4 border-b border-border flex items-center justify-between">
        <h2 className="font-mono text-sm font-semibold text-sidebar-foreground">Sessions</h2>
        <Button variant="ghost" size="icon" className="h-8 w-8 text-sidebar-foreground hover:bg-sidebar-accent" onClick={handleCreateSession} data-testid="button-new-session">
          <Plus className="h-4 w-4" />
        </Button>
      </div>

      <ScrollArea className="flex-1">
        {isLoading ? (
          <div className="p-4 flex justify-center">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        ) : sessions?.length === 0 ? (
          <div className="p-4 text-xs text-muted-foreground text-center font-mono">No sessions found.</div>
        ) : (
          <div className="p-2 flex flex-col gap-1">
            {sessions?.map((session) => (
              <div
                key={session.id}
                onClick={() => onSelectSession(session.id)}
                className={cn(
                  "group flex items-center justify-between p-2 rounded cursor-pointer transition-colors",
                  currentSessionId === session.id
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "hover:bg-sidebar-accent/50 text-muted-foreground hover:text-sidebar-foreground"
                )}
                data-testid={`session-item-${session.id}`}
              >
                <div className="flex items-center gap-2 overflow-hidden">
                  <MessageSquare className="h-4 w-4 flex-shrink-0" />
                  <div className="flex flex-col overflow-hidden">
                    <span className="text-xs truncate font-medium">{session.title || "Untitled"}</span>
                    <span className="text-[10px] opacity-70 truncate font-mono">
                      {format(new Date(session.createdAt), "MMM d, h:mm a")}
                    </span>
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className={cn(
                    "h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0",
                    currentSessionId === session.id ? "text-sidebar-accent-foreground" : "text-muted-foreground"
                  )}
                  onClick={(e) => handleDeleteSession(e, session.id)}
                  data-testid={`button-delete-session-${session.id}`}
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}
