// The live two-slot handoff checklist (spec §9.2, §16) — designed for two phones
// standing in a driveway. Reactive: when one party confirms, the other's screen
// updates instantly. The receiver's confirm button stays disabled until a photo
// is attached, and the photo + condition rating are required (C-08).
import { useAction, useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { api } from "@cvx/api";
import type { Id } from "@cvx/dataModel";
import { CONDITION_RUBRIC } from "@stwrd/shared";
import { Button, Card, FieldError } from "~/components/ui";
import { processImage, uploadToConvex } from "~/lib/imageUpload";

export function ClaimScreen({ claimId }: { claimId: Id<"claims"> }) {
  const claim = useQuery(api.claims.get, { claimId });
  const confirmGiver = useMutation(api.claims.confirmGiver);
  const confirmReceiver = useAction(api.claims.confirmReceiver);
  const cancel = useMutation(api.claims.cancel);
  const generateUploadUrl = useMutation(api.storage.generateUploadUrl);

  const [photo, setPhoto] = useState<File | null>(null);
  const [condition, setCondition] = useState(4);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (claim === undefined) return null;
  if (claim.state === "completed") {
    return (
      <Card className="border-green-200 bg-green-50">
        <p className="font-medium text-green-800">Handoff complete ✓</p>
      </Card>
    );
  }

  const isGiver = claim.myRole === "giver";
  const isReceiver = claim.myRole === "receiver";

  async function onGiverConfirm() {
    setError(null);
    setBusy(true);
    try {
      await confirmGiver({ claimId });
    } catch {
      setError("Could not confirm. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function onReceiverConfirm() {
    if (!photo) return;
    setError(null);
    setBusy(true);
    try {
      const blob = await processImage(photo);
      const url = await generateUploadUrl();
      const storageId = await uploadToConvex(url, blob);
      await confirmReceiver({ claimId, photoIds: [storageId as Id<"_storage">], condition });
    } catch {
      setError("Could not confirm receipt. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function onCancel() {
    setBusy(true);
    try {
      await cancel({ claimId });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="space-y-4">
      <div>
        <h3 className="font-semibold">Handoff in progress</h3>
        <p className="text-sm text-slate-500">
          {claim.purpose === "repair" ? "For repair" : "To borrow"} · {claim.giverName} →{" "}
          {claim.claimantName}
        </p>
      </div>

      {claim.exchangeMode === "reveal_contact" && claim.otherContact && (
        <div className="rounded-md bg-slate-50 p-3 text-sm">
          <p className="font-medium">Coordinate with {claim.otherContact.name}</p>
          {claim.otherContact.email && <p className="text-slate-600">{claim.otherContact.email}</p>}
          {claim.otherContact.phone && <p className="text-slate-600">{claim.otherContact.phone}</p>}
        </div>
      )}

      {/* Giver slot */}
      <div className="flex items-start gap-3">
        <Slot done={claim.giverConfirmed} />
        <div className="flex-1">
          <p className="text-sm font-medium">Holder hands it off</p>
          {claim.giverConfirmed ? (
            <p className="text-xs text-green-700">Confirmed</p>
          ) : isGiver ? (
            <div className="mt-2 w-44">
              <Button onClick={onGiverConfirm} disabled={busy}>
                I handed it off
              </Button>
            </div>
          ) : (
            <p className="text-xs text-slate-400">Waiting for the holder…</p>
          )}
        </div>
      </div>

      {/* Receiver slot */}
      <div className="flex items-start gap-3">
        <Slot done={claim.receiverConfirmed} />
        <div className="flex-1">
          <p className="text-sm font-medium">Receiver confirms with a photo</p>
          {claim.receiverConfirmed ? (
            <p className="text-xs text-green-700">Confirmed</p>
          ) : isReceiver ? (
            <div className="mt-2 space-y-2">
              <input
                type="file"
                accept="image/*"
                capture="environment"
                onChange={(e) => setPhoto(e.target.files?.[0] ?? null)}
                className="block w-full text-sm"
              />
              <label className="block text-sm">
                Condition: {condition} — {CONDITION_RUBRIC[condition]?.label}
                <input
                  type="range"
                  min={1}
                  max={5}
                  value={condition}
                  onChange={(e) => setCondition(Number(e.target.value))}
                  className="w-full"
                />
              </label>
              <div className="w-44">
                <Button onClick={onReceiverConfirm} disabled={busy || !photo}>
                  Confirm receipt
                </Button>
              </div>
            </div>
          ) : (
            <p className="text-xs text-slate-400">Waiting for the receiver…</p>
          )}
        </div>
      </div>

      <FieldError>{error}</FieldError>
      <button
        type="button"
        onClick={onCancel}
        disabled={busy}
        className="text-xs text-red-600 underline disabled:opacity-50"
      >
        Cancel this claim
      </button>
    </Card>
  );
}

function Slot({ done }: { done: boolean }) {
  return (
    <span
      className={
        done
          ? "mt-0.5 flex h-6 w-6 items-center justify-center rounded-full bg-green-600 text-xs text-white"
          : "mt-0.5 h-6 w-6 rounded-full border-2 border-slate-300"
      }
    >
      {done ? "✓" : ""}
    </span>
  );
}
