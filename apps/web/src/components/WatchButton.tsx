import { useMutation } from "convex/react";
import { useState } from "react";
import { api } from "@cvx/api";
import type { Id } from "@cvx/dataModel";

/** Watch / unwatch toggle (§9.5). Optimistic-ish via local pending state. */
export function WatchButton({ itemId, watching }: { itemId: Id<"items">; watching: boolean }) {
  const toggle = useMutation(api.watches.toggle);
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await toggle({ itemId });
        } finally {
          setBusy(false);
        }
      }}
      className="inline-flex h-9 items-center gap-1.5 rounded-md border border-slate-300 px-3 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
    >
      {watching ? "★ Watching" : "☆ Watch"}
    </button>
  );
}
