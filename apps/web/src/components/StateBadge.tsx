import { cn } from "~/lib/utils";

const STATE_STYLE: Record<string, { label: string; className: string }> = {
  available: { label: "Available", className: "bg-green-100 text-green-800" },
  claimed: { label: "Spoken for", className: "bg-amber-100 text-amber-800" },
  in_custody: { label: "In care", className: "bg-slate-100 text-slate-700" },
  under_repair: { label: "Under repair", className: "bg-blue-100 text-blue-800" },
  retired: { label: "Retired", className: "bg-slate-200 text-slate-500" },
};

export function StateBadge({ state }: { state: string }) {
  const s = STATE_STYLE[state] ?? { label: state, className: "bg-slate-100 text-slate-700" };
  return (
    <span className={cn("inline-block rounded px-2 py-0.5 text-xs font-medium", s.className)}>
      {s.label}
    </span>
  );
}

/** Human-readable label for a ledger entry type (§16 timeline). */
export const LEDGER_LABEL: Record<string, string> = {
  contributed: "Contributed",
  claimed: "Claimed",
  claim_cancelled: "Claim cancelled",
  handoff_completed: "Handoff completed",
  status_update: "Status update",
  repair_started: "Repair started",
  repair_completed: "Repair completed",
  marked_available: "Listed as available",
  placed_at_branch: "Placed at branch",
  removed_from_branch: "Removed from branch",
  retirement_proposed: "Retirement proposed",
  retired: "Retired",
  retirement_denied: "Retirement denied",
  admin_transfer: "Administrative transfer",
  annotation: "Annotation",
};
