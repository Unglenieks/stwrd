// Custodian + approver controls on the item page (spec §10, §11, §16): status
// updates, mark-available / withdraw, repair completion, retirement proposal, and
// the approver decision card. Affordances are gated by state + permissions; the
// server re-checks everything.
import { useAction, useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { api } from "@cvx/api";
import type { Id } from "@cvx/dataModel";
import { CONDITION_RUBRIC, PERMISSIONS } from "@lot/shared";
import { Button, Card, FieldError, Textarea } from "~/components/ui";
import { processImage, uploadToConvex } from "~/lib/imageUpload";

interface ItemDetail {
  _id: Id<"items">;
  state: string;
  isMine: boolean;
  conditionRating: number;
  retirementProposed: boolean;
}

export function StewardControls({ item }: { item: ItemDetail }) {
  const perms = useQuery(api.roles.myPermissions) ?? [];
  const canPropose = perms.includes(PERMISSIONS.itemsRetirePropose);
  const canApprove = perms.includes(PERMISSIONS.itemsRetireApprove);

  return (
    <div className="space-y-4">
      {item.isMine && <CustodianActions item={item} canPropose={canPropose} />}
      {canApprove && item.retirementProposed && <ApproverCard itemId={item._id} />}
    </div>
  );
}

function useUpload() {
  const generateUploadUrl = useMutation(api.storage.generateUploadUrl);
  return async (files: File[]): Promise<Id<"_storage">[]> => {
    const ids: Id<"_storage">[] = [];
    for (const f of files) {
      const blob = await processImage(f);
      const url = await generateUploadUrl();
      ids.push((await uploadToConvex(url, blob)) as Id<"_storage">);
    }
    return ids;
  };
}

function CustodianActions({ item, canPropose }: { item: ItemDetail; canPropose: boolean }) {
  const statusUpdate = useAction(api.items.statusUpdate);
  const markAvailable = useMutation(api.items.markAvailable);
  const withdraw = useMutation(api.items.withdrawListing);
  const repairComplete = useAction(api.items.repairComplete);
  const proposeRetirement = useAction(api.items.proposeRetirement);
  const upload = useUpload();

  const [note, setNote] = useState("");
  const [condition, setCondition] = useState(item.conditionRating);
  const [retireReason, setRetireReason] = useState("");
  const [retirePhotos, setRetirePhotos] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (fn: () => Promise<unknown>) => {
    setError(null);
    setBusy(true);
    try {
      await fn();
      setNote("");
      setRetireReason("");
      setRetirePhotos([]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Action failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="space-y-4">
      <h3 className="font-semibold">Holder controls</h3>

      {/* Status update — allowed in every non-retired state. */}
      {item.state !== "retired" && (
        <div className="space-y-2">
          <Textarea
            placeholder="Post a status update…"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <div className="flex flex-wrap gap-2">
            <div className="w-40">
              <Button
                disabled={busy || !note.trim()}
                onClick={() => run(() => statusUpdate({ itemId: item._id, note }))}
              >
                Post update
              </Button>
            </div>
            {item.state === "in_custody" && (
              <div className="w-40">
                <Button
                  disabled={busy}
                  onClick={() =>
                    run(() =>
                      markAvailable({ itemId: item._id, exchangeMode: "reveal_contact" }),
                    )
                  }
                >
                  Mark available
                </Button>
              </div>
            )}
            {item.state === "available" && (
              <div className="w-40">
                <Button disabled={busy} onClick={() => run(() => withdraw({ itemId: item._id }))}>
                  Withdraw listing
                </Button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Repair completion. */}
      {item.state === "under_repair" && (
        <div className="space-y-2 border-t border-slate-100 pt-4">
          <label className="block text-sm font-medium">
            New condition: {condition} — {CONDITION_RUBRIC[condition]?.label}
            <input
              type="range"
              min={1}
              max={5}
              value={condition}
              onChange={(e) => setCondition(Number(e.target.value))}
              className="w-full"
            />
          </label>
          <div className="w-40">
            <Button
              disabled={busy || !note.trim()}
              onClick={() => run(() => repairComplete({ itemId: item._id, note, newCondition: condition }))}
            >
              Complete repair
            </Button>
          </div>
        </div>
      )}

      {/* Retirement proposal. */}
      {canPropose && item.state !== "retired" && !item.retirementProposed && (
        <div className="space-y-2 border-t border-slate-100 pt-4">
          <p className="text-sm font-medium">Propose retirement</p>
          <Textarea
            placeholder="Why is this beyond economical repair?"
            value={retireReason}
            onChange={(e) => setRetireReason(e.target.value)}
          />
          <input
            type="file"
            accept="image/*"
            multiple
            onChange={(e) => setRetirePhotos(Array.from(e.target.files ?? []))}
            className="block w-full text-sm"
          />
          <div className="w-44">
            <Button
              disabled={busy || !retireReason.trim() || retirePhotos.length === 0}
              onClick={() =>
                run(async () =>
                  proposeRetirement({
                    itemId: item._id,
                    reason: retireReason,
                    photoIds: await upload(retirePhotos),
                  }),
                )
              }
            >
              Propose retirement
            </Button>
          </div>
        </div>
      )}

      <FieldError>{error}</FieldError>
    </Card>
  );
}

function ApproverCard({ itemId }: { itemId: Id<"items"> }) {
  const decide = useMutation(api.retirements.decide);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const act = async (approve: boolean) => {
    setBusy(true);
    try {
      await decide({ itemId, approve, note: note || undefined });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="space-y-3 border-amber-200 bg-amber-50">
      <h3 className="font-semibold text-amber-900">Retirement proposed</h3>
      <Textarea
        placeholder="Decision note (optional)…"
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />
      <div className="flex gap-2">
        <div className="w-32">
          <Button disabled={busy} onClick={() => act(true)}>
            Approve
          </Button>
        </div>
        <div className="w-32">
          <Button disabled={busy} onClick={() => act(false)}>
            Deny
          </Button>
        </div>
      </div>
    </Card>
  );
}
