// File storage: upload URLs, authenticated URL serving, and server-side photo
// verification (spec §18.1, §18.2).
import { v } from "convex/values";
import { AppError, PHOTO_MAX_BYTES } from "@lot/shared";
import type { ActionCtx } from "./_generated/server";
import { mutation, query } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { hasEmbeddedMetadata, isAcceptedImageType } from "./lib/exif";
import { requireUser } from "./lib/permissions";

/** A one-time upload URL the client PUTs a (downscaled, stripped) photo to. */
export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx); // any signed-in member; the write mutation enforces the real permission
    return ctx.storage.generateUploadUrl();
  },
});

/** Resolve a storage id to a served URL — authenticated access only (§18.1). */
export const fileUrl = query({
  args: { storageId: v.id("_storage") },
  handler: async (ctx, { storageId }) => {
    await requireUser(ctx);
    return ctx.storage.getUrl(storageId);
  },
});

/** Batch variant for galleries/timelines. */
export const fileUrls = query({
  args: { storageIds: v.array(v.id("_storage")) },
  handler: async (ctx, { storageIds }) => {
    await requireUser(ctx);
    const entries = await Promise.all(
      storageIds.map(async (id) => [id, await ctx.storage.getUrl(id)] as const),
    );
    return Object.fromEntries(entries);
  },
});

/**
 * Verify uploaded photos before they're committed to an item/ledger entry
 * (action — needs blob I/O). Rejects: non-images, > 5 MB, and anything still
 * carrying EXIF/GPS/XMP metadata (C-19). Throws `validation_failed` on the first
 * bad photo. Returns silently when all are clean.
 */
export async function verifyPhotos(
  ctx: ActionCtx,
  photoIds: Id<"_storage">[],
): Promise<void> {
  for (const id of photoIds) {
    const blob = await ctx.storage.get(id);
    if (!blob) throw new AppError("validation_failed", "photo not found");
    if (!isAcceptedImageType(blob.type)) {
      throw new AppError("validation_failed", "unsupported image type");
    }
    if (blob.size > PHOTO_MAX_BYTES) {
      throw new AppError("validation_failed", "photo exceeds size limit");
    }
    const bytes = new Uint8Array(await blob.arrayBuffer());
    if (hasEmbeddedMetadata(bytes)) {
      throw new AppError("validation_failed", "photo still carries EXIF/GPS metadata");
    }
  }
}
