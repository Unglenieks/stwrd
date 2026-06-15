import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { useEffect } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { api } from "@cvx/api";
import { Card } from "~/components/ui";
import { StateBadge } from "~/components/StateBadge";

export const Route = createFileRoute("/me/")({
  component: MyLibraryPage,
});

function MyLibraryPage() {
  const navigate = useNavigate();
  const { isAuthenticated, isLoading } = useConvexAuth();
  useEffect(() => {
    if (!isLoading && !isAuthenticated) void navigate({ to: "/login" });
  }, [isLoading, isAuthenticated, navigate]);
  if (isLoading || !isAuthenticated) return null;
  return <MyLibrary />;
}

type ItemCard = {
  _id: string;
  title: string;
  state: string;
  conditionRating: number;
  primaryPhotoUrl: string | null;
};

function ItemGrid({ items }: { items: ItemCard[] | undefined }) {
  if (items === undefined) return <p className="text-sm text-slate-400">Loading…</p>;
  if (items.length === 0) return <p className="text-sm text-slate-500">Nothing here yet.</p>;
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
      {items.map((item) => (
        <Link key={item._id} to="/items/$id" params={{ id: item._id }} className="block">
          <Card className="overflow-hidden p-0 transition-shadow hover:shadow-md">
            <div className="aspect-square bg-slate-100">
              {item.primaryPhotoUrl && (
                <img src={item.primaryPhotoUrl} alt={item.title} className="h-full w-full object-cover" />
              )}
            </div>
            <div className="p-3">
              <p className="truncate text-sm font-medium">{item.title}</p>
              <div className="mt-1">
                <StateBadge state={item.state} />
              </div>
            </div>
          </Card>
        </Link>
      ))}
    </div>
  );
}

function NotificationPref({ pref }: { pref?: "in_app" | "email" }) {
  const update = useMutation(api.users.updateProfile);
  if (!pref) return null;
  return (
    <Card className="mb-8 flex items-center justify-between gap-4 py-4">
      <div>
        <p className="text-sm font-medium text-slate-800">Email notifications</p>
        <p className="text-xs text-slate-500">Receive item and claim updates by email in addition to in-app notifications.</p>
      </div>
      <button
        role="switch"
        aria-checked={pref === "email"}
        onClick={() => void update({ notificationPref: pref === "email" ? "in_app" : "email" })}
        className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 ${pref === "email" ? "bg-slate-900" : "bg-slate-200"}`}
      >
        <span
          className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow-sm ring-0 transition-transform ${pref === "email" ? "translate-x-5" : "translate-x-0"}`}
        />
      </button>
    </Card>
  );
}

function MyLibrary() {
  const me = useQuery(api.users.me);
  const custody = useQuery(api.me.custody, {});
  const claims = useQuery(api.me.claims, {});
  const contributions = useQuery(api.me.contributions, {});

  return (
    <main className="mx-auto max-w-5xl p-6">
      <h1 className="mb-6 text-2xl font-semibold">My library</h1>
      <NotificationPref pref={me?.notificationPref} />

      <section className="mb-8">
        <h2 className="mb-3 text-lg font-semibold">My active claims</h2>
        {claims === undefined ? (
          <p className="text-sm text-slate-400">Loading…</p>
        ) : claims.length === 0 ? (
          <p className="text-sm text-slate-500">No active claims.</p>
        ) : (
          <ul className="space-y-2">
            {claims.map((c) => (
              <li key={c._id}>
                <Link
                  to="/items/$id"
                  params={{ id: c.itemId }}
                  className="flex items-center justify-between rounded-md border border-slate-200 bg-white px-4 py-3 text-sm hover:bg-slate-50"
                >
                  <span className="font-medium">{c.itemTitle}</span>
                  <span className="text-slate-500">
                    {c.purpose === "repair" ? "Repair" : "Borrow"} ·{" "}
                    {c.giverConfirmed ? "holder ✓" : "holder…"}{" "}
                    {c.receiverConfirmed ? "you ✓" : "you…"}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mb-8">
        <h2 className="mb-3 text-lg font-semibold">In my care</h2>
        <ItemGrid items={custody} />
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold">Contributed by me</h2>
        <ItemGrid items={contributions} />
      </section>
    </main>
  );
}
