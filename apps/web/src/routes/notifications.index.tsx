import { useConvexAuth, useMutation, usePaginatedQuery } from "convex/react";
import { useEffect } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { api } from "@cvx/api";
import { PAGE_SIZE_ADMIN } from "@lot/shared";
import { Button, Card } from "~/components/ui";

export const Route = createFileRoute("/notifications/")({
  component: NotificationsPage,
});

function NotificationsPage() {
  const navigate = useNavigate();
  const { isAuthenticated, isLoading } = useConvexAuth();
  useEffect(() => {
    if (!isLoading && !isAuthenticated) void navigate({ to: "/login" });
  }, [isLoading, isAuthenticated, navigate]);
  if (isLoading || !isAuthenticated) return null;
  return <Inbox />;
}

type Payload = Record<string, unknown>;
const str = (v: unknown, f = "") => (typeof v === "string" ? v : f);
const num = (v: unknown) => (typeof v === "number" ? v : 0);

/** Human message for a notification — renderers key off `kind` alone (§23.5). */
function message(kind: string, p: Payload): string {
  const title = str(p.itemTitle, "an item");
  switch (kind) {
    case "claim_placed":
      return `${str(p.otherPartyName, "A member")} claimed “${title}”.`;
    case "claim_cancelled":
      return `The claim on “${title}” was cancelled (${str(p.reason)}).`;
    case "claim_expiring":
      return `Your claim on “${title}” expires in ${num(p.hoursLeft)} h.`;
    case "watched_item_available":
      return `“${title}” is now available.`;
    case "handoff_confirmed_by_other":
      return `${str(p.otherPartyName, "The other party")} confirmed the handoff for “${title}”.`;
    case "handoff_completed":
      return `Handoff complete for “${title}”.`;
    case "retirement_decision":
      return `“${title}”: retirement ${p.approved ? "approved" : "denied"}.`;
    case "inbound_reply":
      return `New reply on a claim for “${title}”.`;
    case "security_alert":
      return `Account security notice.`;
    default:
      return "New notification.";
  }
}

function Inbox() {
  const { results, status, loadMore } = usePaginatedQuery(
    api.notifications.list,
    {},
    { initialNumItems: PAGE_SIZE_ADMIN },
  );
  const markAllRead = useMutation(api.notifications.markAllRead);

  return (
    <main className="mx-auto max-w-2xl p-6">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Notifications</h1>
        <div className="w-32">
          <Button onClick={() => void markAllRead({})}>Mark all read</Button>
        </div>
      </div>

      {results.length === 0 && status !== "LoadingFirstPage" ? (
        <p className="text-slate-500">No notifications.</p>
      ) : (
        <ul className="space-y-2">
          {results.map((n) => {
            const p = (n.payload ?? {}) as Payload;
            const body = (
              <div className="flex items-start gap-3">
                {!n.read && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-blue-500" />}
                <div className="flex-1">
                  <p className={n.read ? "text-sm text-slate-600" : "text-sm font-medium"}>
                    {message(n.kind, p)}
                  </p>
                  <time className="text-xs text-slate-400">
                    {new Date(n.createdAt).toLocaleString()}
                  </time>
                </div>
              </div>
            );
            return (
              <li key={n._id}>
                <Card className="p-3">
                  {p.itemId ? (
                    <Link to="/items/$id" params={{ id: str(p.itemId) }}>
                      {body}
                    </Link>
                  ) : (
                    body
                  )}
                </Card>
              </li>
            );
          })}
        </ul>
      )}

      {status === "CanLoadMore" && (
        <div className="mt-4 w-40">
          <Button onClick={() => loadMore(PAGE_SIZE_ADMIN)}>Load more</Button>
        </div>
      )}
    </main>
  );
}
