import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { useEffect } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { api } from "@cvx/api";
import type { Id } from "@cvx/dataModel";
import { Button, Card } from "~/components/ui";
import { StateBadge } from "~/components/StateBadge";

export const Route = createFileRoute("/branches/$id")({
  component: BranchPage,
});

function BranchPage() {
  const navigate = useNavigate();
  const { isAuthenticated, isLoading } = useConvexAuth();
  useEffect(() => {
    if (!isLoading && !isAuthenticated) void navigate({ to: "/login" });
  }, [isLoading, isAuthenticated, navigate]);
  if (isLoading || !isAuthenticated) return null;
  return <BranchDetail />;
}

function BranchDetail() {
  const { id } = Route.useParams();
  const branch = useQuery(api.branches.get, { branchId: id as Id<"branches"> });
  const update = useMutation(api.branches.update);

  if (branch === undefined) {
    return <main className="mx-auto max-w-3xl p-6 text-slate-400">Loading…</main>;
  }

  return (
    <main className="mx-auto max-w-3xl p-6">
      <Link to="/branches" className="text-sm text-slate-500 underline">
        ← Branches
      </Link>
      <div className="mt-3 flex items-center gap-3">
        <h1 className="text-2xl font-semibold">{branch.name}</h1>
        {branch.status === "inactive" && <StateBadge state="retired" />}
      </div>

      <Card className="mt-4 space-y-1 text-sm">
        <p>
          <span className="text-slate-500">Location:</span> {branch.locationText}
        </p>
        {branch.accessNotes && (
          <p>
            <span className="text-slate-500">Access:</span> {branch.accessNotes}
          </p>
        )}
        <p>
          <span className="text-slate-500">Host:</span> {branch.hostName}
          {branch.hostContact.email ? ` · ${branch.hostContact.email}` : ""}
        </p>
      </Card>

      <h2 className="mb-3 mt-6 text-lg font-semibold">Items here</h2>
      {branch.items.length === 0 ? (
        <p className="text-sm text-slate-500">Nothing flagged to this branch right now.</p>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          {branch.items.map((it) => (
            <Link key={it._id} to="/items/$id" params={{ id: it._id }} className="block">
              <Card className="overflow-hidden p-0 hover:shadow-md">
                <div className="aspect-square bg-slate-100">
                  {it.primaryPhotoUrl && (
                    <img src={it.primaryPhotoUrl} alt={it.title} className="h-full w-full object-cover" />
                  )}
                </div>
                <div className="p-2">
                  <p className="truncate text-sm font-medium">{it.title}</p>
                  <StateBadge state={it.state} />
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}

      {branch.isHost && branch.status === "active" && (
        <div className="mt-6 w-44">
          <Button
            disabled={branch.items.length > 0}
            title={branch.items.length > 0 ? "Move or hand off items first" : ""}
            onClick={() => void update({ branchId: branch._id, patch: { status: "inactive" } })}
          >
            Deactivate branch
          </Button>
        </div>
      )}
    </main>
  );
}
