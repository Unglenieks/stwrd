import { useConvexAuth, useMutation, usePaginatedQuery, useQuery } from "convex/react";
import { useEffect, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { api } from "@cvx/api";
import type { Id } from "@cvx/dataModel";
import { CONDITION_RUBRIC, PAGE_SIZE_LEDGER } from "@lot/shared";
import { Button, Card, FieldError } from "~/components/ui";
import { ClaimScreen } from "~/components/ClaimScreen";
import { StewardControls } from "~/components/StewardControls";
import { WatchButton } from "~/components/WatchButton";
import { LEDGER_LABEL, StateBadge } from "~/components/StateBadge";

export const Route = createFileRoute("/items/$id")({
  component: ItemPage,
});

function ItemPage() {
  const navigate = useNavigate();
  const { isAuthenticated, isLoading } = useConvexAuth();
  useEffect(() => {
    if (!isLoading && !isAuthenticated) void navigate({ to: "/login" });
  }, [isLoading, isAuthenticated, navigate]);
  if (isLoading || !isAuthenticated) return null;
  return <ItemDetail />;
}

function ItemDetail() {
  const { id } = Route.useParams();
  const itemId = id as Id<"items">;
  const item = useQuery(api.items.get, { itemId });
  const ledger = usePaginatedQuery(
    api.items.ledger,
    { itemId },
    { initialNumItems: PAGE_SIZE_LEDGER },
  );

  if (item === undefined) {
    return <main className="mx-auto max-w-3xl p-6 text-slate-400">Loading…</main>;
  }

  const rubric = CONDITION_RUBRIC[item.conditionRating];

  return (
    <main className="mx-auto max-w-3xl p-6">
      <Link to="/items" className="text-sm text-slate-500 underline">
        ← Catalog
      </Link>

      <div className="mt-4 grid gap-6 sm:grid-cols-2">
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-slate-100">
          {item.primaryPhotoUrl && (
            <img src={item.primaryPhotoUrl} alt={item.title} className="w-full object-cover" />
          )}
        </div>
        <div>
          <div className="mb-2 flex items-center gap-2">
            <h1 className="text-2xl font-semibold">{item.title}</h1>
          </div>
          <div className="flex items-center gap-3">
            <StateBadge state={item.state} />
            <WatchButton itemId={item._id} watching={item.isWatching} />
          </div>
          <dl className="mt-4 space-y-1 text-sm">
            <Row label="Condition">
              {item.conditionRating}/5 — {rubric?.label}
            </Row>
            <Row label="In the care of">{item.custodianName}</Row>
            <Row label="Category">
              {item.categoryName}
              {item.categoryArchived ? " (archived)" : ""}
            </Row>
            {item.branchName && <Row label="At branch">{item.branchName}</Row>}
          </dl>
          {item.tags.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {item.tags.map((t) => (
                <span key={t} className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                  {t}
                </span>
              ))}
            </div>
          )}
          {/* Claim affordance — replaced by the live checklist once the viewer
              is a party to an active claim (§9, §16). */}
          {item.state === "available" && !item.isMine && (
            <ClaimActions itemId={item._id} />
          )}
        </div>
      </div>

      {item.myActiveClaimId && (
        <div className="mt-6">
          <ClaimScreen claimId={item.myActiveClaimId} />
        </div>
      )}

      <div className="mt-6">
        <StewardControls item={item} />
      </div>

      {item.description && (
        <Card className="mt-6">
          <p className="whitespace-pre-wrap text-sm text-slate-700">{item.description}</p>
        </Card>
      )}

      {item.attributes.length > 0 && (
        <Card className="mt-4">
          <dl className="grid grid-cols-2 gap-2 text-sm">
            {item.attributes.map((a) => (
              <div key={a.key}>
                <dt className="text-slate-500">{a.key}</dt>
                <dd className="font-medium">{a.value}</dd>
              </div>
            ))}
          </dl>
        </Card>
      )}

      {/* Ledger timeline — the centerpiece (§16). */}
      <h2 className="mb-3 mt-8 text-lg font-semibold">History</h2>
      <ol className="relative space-y-5 border-l border-slate-200 pl-5">
        {ledger.results.map((e) => (
          <li key={e._id} className="relative">
            <span className="absolute -left-[1.45rem] top-1.5 h-2.5 w-2.5 rounded-full bg-slate-400" />
            <div className="flex items-baseline justify-between gap-2">
              <p className="text-sm font-medium">{LEDGER_LABEL[e.type] ?? e.type}</p>
              <time className="text-xs text-slate-400">
                {new Date(e.createdAt).toLocaleString()}
              </time>
            </div>
            <p className="text-xs text-slate-500">
              by {e.actorName}
              {e.counterpartyName ? ` → ${e.counterpartyName}` : ""}
              {e.conditionRating ? ` · condition ${e.conditionRating}/5` : ""}
            </p>
            {e.note && <p className="mt-1 text-sm text-slate-700">{e.note}</p>}
            {e.reason && <p className="mt-1 text-sm text-slate-600">Reason: {e.reason}</p>}
            {e.photoUrls.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-2">
                {e.photoUrls.map((u, i) => (
                  <img
                    key={i}
                    src={u}
                    alt="ledger evidence"
                    className="h-16 w-16 rounded object-cover"
                  />
                ))}
              </div>
            )}
          </li>
        ))}
      </ol>
      {ledger.status === "CanLoadMore" && (
        <div className="mt-4 w-40">
          <Button onClick={() => ledger.loadMore(PAGE_SIZE_LEDGER)}>Load more</Button>
        </div>
      )}
    </main>
  );
}

function ClaimActions({ itemId }: { itemId: Id<"items"> }) {
  const createClaim = useMutation(api.claims.create);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function claim(purpose: "use" | "repair") {
    setError(null);
    setBusy(true);
    try {
      await createClaim({ itemId, purpose });
      // The item page is reactive; myActiveClaimId flips and the checklist shows.
    } catch (err) {
      const code = err instanceof Error ? err.message : "";
      setError(
        code.includes("item_not_available")
          ? "Someone just claimed this — you missed it by a moment."
          : "Could not place the claim.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-4 space-y-2">
      <div className="flex gap-2">
        <div className="w-32">
          <Button onClick={() => claim("use")} disabled={busy}>
            Claim to borrow
          </Button>
        </div>
        <div className="w-32">
          <Button onClick={() => claim("repair")} disabled={busy}>
            Claim to repair
          </Button>
        </div>
      </div>
      <FieldError>{error}</FieldError>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-2">
      <dt className="w-28 shrink-0 text-slate-500">{label}</dt>
      <dd className="font-medium text-slate-800">{children}</dd>
    </div>
  );
}
