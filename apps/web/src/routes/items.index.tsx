import { useConvexAuth, usePaginatedQuery, useQuery } from "convex/react";
import { useEffect, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { api } from "@cvx/api";
import type { Id } from "@cvx/dataModel";
import { PAGE_SIZE_CATALOG } from "@stwrd/shared";
import { Button, Card, Input } from "~/components/ui";
import { StateBadge } from "~/components/StateBadge";

export const Route = createFileRoute("/items/")({
  component: CatalogPage,
});

function CatalogPage() {
  const navigate = useNavigate();
  const { isAuthenticated, isLoading } = useConvexAuth();
  useEffect(() => {
    if (!isLoading && !isAuthenticated) void navigate({ to: "/login" });
  }, [isLoading, isAuthenticated, navigate]);
  if (isLoading || !isAuthenticated) return null;
  return <Catalog />;
}

function Catalog() {
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [needsRepair, setNeedsRepair] = useState(false);
  const categories = useQuery(api.categories.tree, {});

  const { results, status, loadMore } = usePaginatedQuery(
    api.items.list,
    {
      search: search || undefined,
      categoryId: (categoryId || undefined) as Id<"categories"> | undefined,
      conditionMax: needsRepair ? 2 : undefined,
    },
    { initialNumItems: PAGE_SIZE_CATALOG },
  );

  return (
    <main className="mx-auto max-w-5xl p-6">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Catalog</h1>
        <Link to="/contribute" className="text-sm font-medium text-slate-700 underline">
          + Contribute
        </Link>
      </div>

      <form
        className="mb-6 flex flex-wrap gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          setSearch(searchInput.trim());
        }}
      >
        <div className="min-w-48 flex-1">
          <Input
            placeholder="Search the catalog…"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
          />
        </div>
        <select
          className="h-10 rounded-md border border-slate-300 bg-white px-3 text-sm"
          value={categoryId}
          onChange={(e) => setCategoryId(e.target.value)}
        >
          <option value="">All categories</option>
          {(categories ?? []).map((c) => (
            <option key={c._id} value={c._id}>
              {c.name}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input
            type="checkbox"
            checked={needsRepair}
            onChange={(e) => setNeedsRepair(e.target.checked)}
          />
          Needs repair
        </label>
        <div className="w-28">
          <Button type="submit">Search</Button>
        </div>
      </form>

      {results.length === 0 && status !== "LoadingFirstPage" ? (
        <p className="text-slate-500">No items match.</p>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
          {results.map((item) => (
            <Link key={item._id} to="/items/$id" params={{ id: item._id }} className="block">
              <Card className="p-0 overflow-hidden transition-shadow hover:shadow-md">
                <div className="aspect-square bg-slate-100">
                  {item.primaryPhotoUrl && (
                    <img
                      src={item.primaryPhotoUrl}
                      alt={item.title}
                      className="h-full w-full object-cover"
                    />
                  )}
                </div>
                <div className="p-3">
                  <p className="truncate text-sm font-medium">{item.title}</p>
                  <div className="mt-1 flex items-center justify-between">
                    <StateBadge state={item.state} />
                    <span className="text-xs text-slate-400">{item.conditionRating}/5</span>
                  </div>
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}

      {status === "CanLoadMore" && (
        <div className="mt-6 w-40">
          <Button onClick={() => loadMore(PAGE_SIZE_CATALOG)}>Load more</Button>
        </div>
      )}
    </main>
  );
}
