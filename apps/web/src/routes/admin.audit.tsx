import { useConvexAuth, usePaginatedQuery, useQuery } from "convex/react";
import { useEffect } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { api } from "@cvx/api";
import { PAGE_SIZE_ADMIN, PERMISSIONS } from "@lot/shared";
import { Card } from "~/components/ui";

export const Route = createFileRoute("/admin/audit")({
  component: AdminAuditPage,
});

function AdminAuditPage() {
  const navigate = useNavigate();
  const { isAuthenticated, isLoading } = useConvexAuth();
  const perms = useQuery(api.roles.myPermissions);
  useEffect(() => {
    if (!isLoading && !isAuthenticated) void navigate({ to: "/login" });
  }, [isLoading, isAuthenticated, navigate]);
  if (isLoading || !isAuthenticated || perms === undefined) return null;
  if (!perms.includes(PERMISSIONS.instanceAuditView)) {
    return <main className="p-6 text-slate-500">You don't have access to the audit feed.</main>;
  }
  return <Audit />;
}

function Audit() {
  const audit = usePaginatedQuery(api.admin.auditFeed, {}, { initialNumItems: PAGE_SIZE_ADMIN });
  const emails = usePaginatedQuery(api.admin.emailLog, {}, { initialNumItems: PAGE_SIZE_ADMIN });
  const unmatched = useQuery(api.admin.unmatchedInbound, {}) ?? [];

  return (
    <main className="mx-auto max-w-3xl p-6">
      <h1 className="mb-6 text-2xl font-semibold">Audit &amp; email</h1>

      <section className="mb-8">
        <h2 className="mb-3 text-lg font-semibold">Sensitive events</h2>
        <Card className="divide-y divide-slate-100 p-0">
          {audit.results.length === 0 ? (
            <p className="p-4 text-sm text-slate-500">No events yet.</p>
          ) : (
            audit.results.map((e) => (
              <div key={e._id} className="flex items-center justify-between gap-3 p-3 text-sm">
                <div>
                  <span className="font-medium">{e.action}</span>{" "}
                  <span className="text-slate-500">by {e.actorName}</span>
                </div>
                <time className="text-xs text-slate-400">{new Date(e.createdAt).toLocaleString()}</time>
              </div>
            ))
          )}
        </Card>
        {audit.status === "CanLoadMore" && (
          <button className="mt-2 text-sm underline" onClick={() => audit.loadMore(PAGE_SIZE_ADMIN)}>
            Load more
          </button>
        )}
      </section>

      <section className="mb-8">
        <h2 className="mb-3 text-lg font-semibold">Email delivery log</h2>
        <Card className="divide-y divide-slate-100 p-0">
          {emails.results.length === 0 ? (
            <p className="p-4 text-sm text-slate-500">No email sent yet.</p>
          ) : (
            emails.results.map((m) => (
              <div key={m._id} className="flex items-center justify-between gap-3 p-3 text-sm">
                <div className="min-w-0">
                  <span className="font-medium">{m.template}</span>{" "}
                  <span className="text-slate-500">→ {m.to}</span>
                  {m.lastError && <p className="truncate text-xs text-red-600">{m.lastError}</p>}
                </div>
                <span
                  className={
                    m.state === "sent"
                      ? "text-xs text-green-700"
                      : m.state === "failed"
                        ? "text-xs text-red-600"
                        : "text-xs text-slate-400"
                  }
                >
                  {m.state}
                  {m.attempts > 0 ? ` (${m.attempts})` : ""}
                </span>
              </div>
            ))
          )}
        </Card>
        {emails.status === "CanLoadMore" && (
          <button className="mt-2 text-sm underline" onClick={() => emails.loadMore(PAGE_SIZE_ADMIN)}>
            Load more
          </button>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold">Unmatched inbound mail</h2>
        <Card className="divide-y divide-slate-100 p-0">
          {unmatched.length === 0 ? (
            <p className="p-4 text-sm text-slate-500">Nothing unmatched.</p>
          ) : (
            unmatched.map((r) => (
              <div key={r._id} className="p-3 text-sm">
                <div className="flex items-center justify-between">
                  <span className="font-medium">{r.subject || "(no subject)"}</span>
                  <span className="text-xs text-slate-400">{r.disposition}</span>
                </div>
                <p className="text-xs text-slate-500">from {r.from}</p>
              </div>
            ))
          )}
        </Card>
      </section>
    </main>
  );
}
