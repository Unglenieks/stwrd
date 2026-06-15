import { useConvexAuth, useAction, useMutation, useQuery } from "convex/react";
import { useEffect, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { api } from "@cvx/api";
import type { Id } from "@cvx/dataModel";
import { PERMISSIONS } from "@stwrd/shared";
import { Button, Card, FieldError, Input, Label } from "~/components/ui";

export const Route = createFileRoute("/admin/members")({
  component: AdminMembersPage,
});

function AdminMembersPage() {
  const navigate = useNavigate();
  const { isAuthenticated, isLoading } = useConvexAuth();
  const perms = useQuery(api.roles.myPermissions);
  useEffect(() => {
    if (!isLoading && !isAuthenticated) void navigate({ to: "/login" });
  }, [isLoading, isAuthenticated, navigate]);
  if (isLoading || !isAuthenticated || perms === undefined) return null;
  const canCreate = perms.includes(PERMISSIONS.usersCreate);
  const canManage = perms.includes(PERMISSIONS.usersManage);
  if (!canCreate && !canManage) {
    return <main className="p-6 text-slate-500">You don't have access to member management.</main>;
  }
  return <MembersPanel canCreate={canCreate} canManage={canManage} />;
}

function MembersPanel({ canCreate, canManage }: { canCreate: boolean; canManage: boolean }) {
  const me = useQuery(api.users.me);
  const users = useQuery(api.users.list);
  const roleNames = useQuery(api.roles.listNames);
  const roleMap = new Map(roleNames?.map((r) => [r._id as string, r.name]) ?? []);

  return (
    <main className="mx-auto max-w-4xl p-6">
      <h1 className="mb-1 text-2xl font-semibold">Members</h1>
      <p className="mb-6 text-sm text-slate-500">
        {users === undefined
          ? "Loading…"
          : `${users.length} member${users.length === 1 ? "" : "s"}`}
      </p>
      {canCreate && <InviteForm />}
      <MembersTable
        users={users}
        roleMap={roleMap}
        canManage={canManage}
        meId={me?._id}
      />
    </main>
  );
}

function InviteForm() {
  const inviteUser = useAction(api.users.invite);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{
    inviteUrl: string;
    emailQueued: boolean;
    name: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setResult(null);
    setBusy(true);
    try {
      const r = await inviteUser({ name, email });
      setResult({ ...r, name });
      setName("");
      setEmail("");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("validation_failed")) {
        setError("That email address already has an active account.");
      } else {
        setError("Could not send invite. Please try again.");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="mb-6">
      <h2 className="mb-3 font-semibold">Invite a new member</h2>
      <form onSubmit={handleSubmit} className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor="invite-name">Name</Label>
            <Input
              id="invite-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              placeholder="Full name"
            />
          </div>
          <div>
            <Label htmlFor="invite-email">Email</Label>
            <Input
              id="invite-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              placeholder="name@example.com"
            />
          </div>
        </div>
        {result && (
          <div className="rounded-md bg-green-50 p-3 text-sm text-green-800">
            {result.emailQueued ? (
              <span>Invitation email sent to {result.name}.</span>
            ) : (
              <>
                <span>
                  Email not configured — share this link with {result.name}:
                </span>
                <div className="mt-2 flex gap-2">
                  <Input
                    value={result.inviteUrl}
                    readOnly
                    className="text-xs"
                    onFocus={(e) => e.target.select()}
                  />
                  <button
                    type="button"
                    onClick={() => void navigator.clipboard.writeText(result.inviteUrl)}
                    className="shrink-0 rounded-md border border-green-300 bg-white px-3 text-xs font-medium text-green-700 hover:bg-green-50"
                  >
                    Copy
                  </button>
                </div>
              </>
            )}
          </div>
        )}
        <FieldError>{error}</FieldError>
        <div className="w-36">
          <Button type="submit" disabled={busy}>
            Send invite
          </Button>
        </div>
      </form>
    </Card>
  );
}

const STATUS_STYLES: Record<string, string> = {
  active: "bg-green-100 text-green-800",
  invited: "bg-amber-100 text-amber-800",
  inactive: "bg-slate-100 text-slate-600",
};

type UserRow = {
  _id: Id<"users">;
  name: string;
  email: string;
  status: string;
  roleIds: Id<"roles">[];
  heldItemCount: number;
};

function MembersTable({
  users,
  roleMap,
  canManage,
  meId,
}: {
  users: UserRow[] | undefined;
  roleMap: Map<string, string>;
  canManage: boolean;
  meId: Id<"users"> | undefined;
}) {
  const deactivate = useMutation(api.users.deactivate);
  const reactivate = useMutation(api.users.reactivate);
  const [busy, setBusy] = useState<string | null>(null);
  const [rowError, setRowError] = useState<{ id: string; msg: string } | null>(null);

  if (users === undefined) return <p className="text-slate-400">Loading…</p>;
  if (users.length === 0) return <p className="text-sm text-slate-500">No members yet.</p>;

  async function handleDeactivate(userId: Id<"users">) {
    setRowError(null);
    setBusy(userId);
    try {
      await deactivate({ userId });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Action failed.";
      setRowError({
        id: userId,
        msg: msg.includes("last_admin")
          ? "Cannot deactivate the last admin."
          : "Could not deactivate.",
      });
    } finally {
      setBusy(null);
    }
  }

  async function handleReactivate(userId: Id<"users">) {
    setRowError(null);
    setBusy(userId);
    try {
      await reactivate({ userId });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Action failed.";
      setRowError({ id: userId, msg });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-100 bg-slate-50 text-left">
            <th className="px-4 py-3 font-medium text-slate-600">Name</th>
            <th className="px-4 py-3 font-medium text-slate-600">Email</th>
            <th className="px-4 py-3 font-medium text-slate-600">Status</th>
            <th className="px-4 py-3 font-medium text-slate-600">Roles</th>
            <th className="px-4 py-3 text-right font-medium text-slate-600">Items</th>
            {canManage && (
              <th className="px-4 py-3 font-medium text-slate-600" />
            )}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {users.map((u) => {
            const isMe = u._id === meId;
            const thisRowError = rowError?.id === u._id ? rowError.msg : null;
            return (
              <tr key={u._id} className="hover:bg-slate-50">
                <td className="px-4 py-3 font-medium text-slate-900">
                  {u.name || <span className="text-slate-400">—</span>}
                </td>
                <td className="px-4 py-3 text-slate-600">{u.email}</td>
                <td className="px-4 py-3">
                  <span
                    className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[u.status] ?? "bg-slate-100 text-slate-600"}`}
                  >
                    {u.status}
                  </span>
                </td>
                <td className="px-4 py-3">
                  {u.roleIds.length === 0 ? (
                    <span className="text-slate-400">—</span>
                  ) : (
                    <span className="flex flex-wrap gap-1">
                      {u.roleIds.map((rid) => (
                        <span
                          key={rid}
                          className="inline-block rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-700"
                        >
                          {roleMap.get(rid as string) ?? "…"}
                        </span>
                      ))}
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 text-right text-slate-600">
                  {u.heldItemCount}
                </td>
                {canManage && (
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-2">
                      {thisRowError && (
                        <span className="text-xs text-red-600">{thisRowError}</span>
                      )}
                      {isMe ? (
                        <span className="text-xs text-slate-400">You</span>
                      ) : u.status === "inactive" ? (
                        <button
                          disabled={busy === u._id}
                          onClick={() => void handleReactivate(u._id)}
                          className="rounded px-2 py-1 text-xs font-medium text-green-700 hover:bg-green-50 disabled:opacity-50"
                        >
                          Reactivate
                        </button>
                      ) : (
                        <button
                          disabled={busy === u._id}
                          onClick={() => void handleDeactivate(u._id)}
                          className="rounded px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
                        >
                          Deactivate
                        </button>
                      )}
                    </div>
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
