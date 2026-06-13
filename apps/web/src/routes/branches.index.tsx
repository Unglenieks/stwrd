import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { useEffect, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { api } from "@cvx/api";
import { PERMISSIONS } from "@lot/shared";
import { Button, Card, FieldError, Input, Label, Textarea } from "~/components/ui";

export const Route = createFileRoute("/branches/")({
  component: BranchesPage,
});

function BranchesPage() {
  const navigate = useNavigate();
  const { isAuthenticated, isLoading } = useConvexAuth();
  useEffect(() => {
    if (!isLoading && !isAuthenticated) void navigate({ to: "/login" });
  }, [isLoading, isAuthenticated, navigate]);
  if (isLoading || !isAuthenticated) return null;
  return <Branches />;
}

function Branches() {
  const branches = useQuery(api.branches.list, {});
  const perms = useQuery(api.roles.myPermissions) ?? [];

  return (
    <main className="mx-auto max-w-3xl p-6">
      <h1 className="mb-1 text-2xl font-semibold">Branches</h1>
      <p className="mb-6 text-sm text-slate-500">
        Member-hosted drop points — a "little free library" so two schedules never
        have to align.
      </p>

      {branches === undefined ? (
        <p className="text-slate-400">Loading…</p>
      ) : branches.length === 0 ? (
        <p className="text-slate-500">No branches yet.</p>
      ) : (
        <ul className="space-y-2">
          {branches.map((b) => (
            <li key={b._id}>
              <Link to="/branches/$id" params={{ id: b._id }}>
                <Card className="p-4 hover:shadow-md">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-medium">{b.name}</p>
                      <p className="text-sm text-slate-500">{b.locationText}</p>
                    </div>
                    <span className="text-sm text-slate-400">
                      {b.itemCount} item{b.itemCount === 1 ? "" : "s"} · host {b.hostName}
                    </span>
                  </div>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {perms.includes(PERMISSIONS.branchesCreate) && <CreateBranch />}
    </main>
  );
}

function CreateBranch() {
  const create = useMutation(api.branches.create);
  const [name, setName] = useState("");
  const [locationText, setLocationText] = useState("");
  const [accessNotes, setAccessNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await create({ name, locationText, accessNotes });
      setName("");
      setLocationText("");
      setAccessNotes("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not register the branch.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="mt-6">
      <h2 className="mb-3 text-lg font-semibold">Register a branch on your property</h2>
      <form onSubmit={onSubmit} className="space-y-3">
        <div>
          <Label htmlFor="b-name">Name</Label>
          <Input id="b-name" value={name} onChange={(e) => setName(e.target.value)} required />
        </div>
        <div>
          <Label htmlFor="b-loc">Location (free text)</Label>
          <Input
            id="b-loc"
            value={locationText}
            onChange={(e) => setLocationText(e.target.value)}
            placeholder="blue shed behind the co-op"
            required
          />
        </div>
        <div>
          <Label htmlFor="b-access">Access notes</Label>
          <Textarea
            id="b-access"
            value={accessNotes}
            onChange={(e) => setAccessNotes(e.target.value)}
            placeholder="combo 4312, latch sticks"
          />
        </div>
        <FieldError>{error}</FieldError>
        <div className="w-40">
          <Button type="submit" disabled={busy}>
            Register branch
          </Button>
        </div>
      </form>
    </Card>
  );
}
