import { useConvexAuth, usePaginatedQuery, useQuery } from "convex/react";
import { useEffect } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { api } from "@cvx/api";
import { Card } from "~/components/ui";

export const Route = createFileRoute("/")({
  component: Home,
});

function Home() {
  const navigate = useNavigate();
  const { isAuthenticated, isLoading } = useConvexAuth();
  const setup = useQuery(api.settings.setupStatus);

  useEffect(() => {
    if (setup && !setup.setupComplete) void navigate({ to: "/setup" });
    else if (!isLoading && !isAuthenticated) void navigate({ to: "/login" });
  }, [setup, isLoading, isAuthenticated, navigate]);

  if (isLoading || !isAuthenticated) return null;
  return <LandingHome />;
}

function LandingHome() {
  const me = useQuery(api.users.me);
  const settings = useQuery(api.settings.get);
  const { results: availableItems, status } = usePaginatedQuery(
    api.items.list,
    { state: "available" },
    { initialNumItems: 8 },
  );

  const orgName = settings?.orgName ?? "Stwrd";

  return (
    <main>
      {/* Hero */}
      <div className="relative overflow-hidden border-b border-slate-200 bg-gradient-to-br from-slate-900 via-slate-800 to-slate-700">
        {/* Decorative grid overlay */}
        <div
          className="pointer-events-none absolute inset-0 opacity-10"
          style={{
            backgroundImage:
              "linear-gradient(rgba(255,255,255,.15) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.15) 1px, transparent 1px)",
            backgroundSize: "32px 32px",
          }}
        />
        <div className="relative mx-auto max-w-5xl px-6 py-16 sm:py-20">
          <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-slate-400">
            Welcome back, {me?.name ?? me?.email ?? "…"}
          </p>
          <h1 className="text-4xl font-bold tracking-tight text-white sm:text-5xl">
            {orgName}
          </h1>
          <p className="mt-3 max-w-md text-slate-300">
            Browse items your community has made available and claim what you need.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link
              to="/items"
              className="inline-flex items-center gap-1.5 rounded-lg bg-white px-4 py-2.5 text-sm font-semibold text-slate-900 shadow transition-colors hover:bg-slate-100"
            >
              Browse catalog
            </Link>
            <Link
              to="/contribute"
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-500 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:border-slate-400 hover:bg-slate-700"
            >
              Contribute an item
            </Link>
          </div>
        </div>
      </div>

      {/* Available items */}
      <div className="mx-auto max-w-5xl px-6 py-10">
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-900">Available for checkout</h2>
          <Link to="/items" className="text-sm font-medium text-slate-500 hover:text-slate-700">
            View all →
          </Link>
        </div>

        {status === "LoadingFirstPage" ? (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="animate-pulse rounded-xl border border-slate-100 bg-slate-50">
                <div className="aspect-square bg-slate-100" />
                <div className="p-3">
                  <div className="h-3.5 w-3/4 rounded bg-slate-200" />
                </div>
              </div>
            ))}
          </div>
        ) : availableItems.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
            {availableItems.map((item) => (
              <ItemCard key={item._id} item={item} />
            ))}
          </div>
        )}
      </div>
    </main>
  );
}

type AvailableItem = {
  _id: string;
  title: string;
  primaryPhotoUrl: string | null;
  conditionRating: number;
  tags: string[];
};

function ItemCard({ item }: { item: AvailableItem }) {
  return (
    <Link to="/items/$id" params={{ id: item._id }} className="group block">
      <Card className="overflow-hidden p-0 transition-shadow hover:shadow-md">
        <div className="relative aspect-square bg-slate-100">
          {item.primaryPhotoUrl ? (
            <img
              src={item.primaryPhotoUrl}
              alt={item.title}
              className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
            />
          ) : (
            <div className="flex h-full items-center justify-center text-slate-300">
              <svg className="h-10 w-10" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10" />
              </svg>
            </div>
          )}
          <span className="absolute left-2 top-2 rounded-full bg-green-500 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white shadow-sm">
            Available
          </span>
        </div>
        <div className="p-3">
          <p className="truncate text-sm font-medium text-slate-900">{item.title}</p>
          <div className="mt-1 flex items-center gap-1">
            {Array.from({ length: 5 }).map((_, i) => (
              <span
                key={i}
                className={`h-1.5 w-1.5 rounded-full ${i < item.conditionRating ? "bg-slate-400" : "bg-slate-200"}`}
              />
            ))}
          </div>
        </div>
      </Card>
    </Link>
  );
}

function EmptyState() {
  return (
    <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 py-16 text-center">
      <p className="text-sm font-medium text-slate-500">No items available right now.</p>
      <p className="mt-1 text-sm text-slate-400">
        Be the first to{" "}
        <Link to="/contribute" className="font-medium text-slate-600 underline underline-offset-2">
          contribute something
        </Link>
        .
      </p>
    </div>
  );
}
