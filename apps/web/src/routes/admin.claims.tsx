import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { useEffect } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { api } from "@cvx/api";
import type { Id } from "@cvx/dataModel";
import { PERMISSIONS } from "@lot/shared";
import { Button, Card } from "~/components/ui";

export const Route = createFileRoute("/admin/claims")({
  component: AdminClaimsPage,
});

function AdminClaimsPage() {
  const navigate = useNavigate();
  const { isAuthenticated, isLoading } = useConvexAuth();
  const perms = useQuery(api.roles.myPermissions);
  useEffect(() => {
    if (!isLoading && !isAuthenticated) void navigate({ to: "/login" });
  }, [isLoading, isAuthenticated, navigate]);
  if (isLoading || !isAuthenticated || perms === undefined) return null;
  return <AdminClaims perms={perms} />;
}

function AdminClaims({ perms }: { perms: string[] }) {
  const canManageClaims = perms.includes(PERMISSIONS.claimsManageAny);
  const canManageUsers = perms.includes(PERMISSIONS.usersManage);
  return (
    <main className="mx-auto max-w-3xl p-6">
      <h1 className="mb-6 text-2xl font-semibold">Circulation admin</h1>
      {canManageClaims && <StuckQueue />}
      {canManageUsers && <RecoveryQueue />}
      {!canManageClaims && !canManageUsers && (
        <p className="text-slate-500">You don't have access to these queues.</p>
      )}
    </main>
  );
}

function StuckQueue() {
  const stuck = useQuery(api.admin.stuckClaims, {});
  const resolve = useMutation(api.claims.adminResolve);

  return (
    <section className="mb-8">
      <h2 className="mb-3 text-lg font-semibold">Stuck handoffs</h2>
      {stuck === undefined ? (
        <p className="text-slate-400">Loading…</p>
      ) : stuck.length === 0 ? (
        <p className="text-sm text-slate-500">No stuck handoffs. 🎉</p>
      ) : (
        <ul className="space-y-2">
          {stuck.map((c) => (
            <li key={c._id}>
              <Card className="p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <Link to="/items/$id" params={{ id: c.itemId }} className="font-medium underline">
                      {c.itemTitle}
                    </Link>
                    <p className="text-xs text-slate-500">
                      claimant {c.claimantName} · {c.giverConfirmed ? "holder ✓" : "holder…"}{" "}
                      {c.receiverConfirmed ? "receiver ✓" : "receiver…"}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      className="rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50"
                      onClick={() =>
                        void resolve({ claimId: c._id, resolution: "force_complete", note: "admin force-complete" })
                      }
                    >
                      Force-complete
                    </button>
                    <button
                      className="rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50"
                      onClick={() =>
                        void resolve({ claimId: c._id, resolution: "force_cancel", note: "admin force-cancel" })
                      }
                    >
                      Force-cancel
                    </button>
                  </div>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function RecoveryQueue() {
  const queue = useQuery(api.admin.recoveryQueue, {});
  const me = useQuery(api.users.me);
  const transfer = useMutation(api.users.adminTransfer);

  return (
    <section>
      <h2 className="mb-3 text-lg font-semibold">Custodian-inactive recovery</h2>
      {queue === undefined ? (
        <p className="text-slate-400">Loading…</p>
      ) : queue.length === 0 ? (
        <p className="text-sm text-slate-500">No items awaiting recovery.</p>
      ) : (
        <ul className="space-y-2">
          {queue.map((it) => (
            <li key={it.itemId}>
              <Card className="flex items-center justify-between p-4">
                <div>
                  <Link to="/items/$id" params={{ id: it.itemId }} className="font-medium underline">
                    {it.title}
                  </Link>
                  <p className="text-xs text-slate-500">held by {it.custodianName} (inactive)</p>
                </div>
                {me && (
                  <div className="w-32">
                    <Button
                      onClick={() =>
                        void transfer({
                          itemId: it.itemId as Id<"items">,
                          newCustodianId: me._id,
                          note: "recovered by admin",
                        })
                      }
                    >
                      Recover to me
                    </Button>
                  </div>
                )}
              </Card>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
