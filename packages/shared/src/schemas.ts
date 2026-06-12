/**
 * Shared Zod schemas — spec §22 (Interface contract).
 *
 * These are the single source for argument shapes; the frontend (TanStack Form)
 * and the Convex validators both import them. Convex document IDs are opaque
 * strings here (the backend re-brands them as `Id<"table">`).
 */
import { z } from "zod";
import {
  ATTRIBUTE_KEY_MAX,
  ATTRIBUTE_VALUE_MAX,
  ATTRIBUTES_MAX_PAIRS,
  CLAIM_EXPIRY_HOURS_MAX,
  CLAIM_EXPIRY_HOURS_MIN,
  CONDITION_MAX,
  CONDITION_MIN,
  DESCRIPTION_MAX,
  NOTE_MAX,
  PASSWORD_MIN_LENGTH,
  PHOTOS_MAX_PER_ENTRY,
  TAG_MAX_LENGTH,
  TAGS_MAX_PER_ITEM,
  TITLE_MAX,
} from "./constants.js";
import {
  CLAIM_PURPOSES,
  EXCHANGE_MODES,
  NOTIFICATION_PREFS,
  TWO_FACTOR_POLICIES,
} from "./enums.js";

/** A Convex document id, opaque at the shared layer. */
export const zId = z.string().min(1);

/** Storage file id (Convex `_storage`). */
export const zFileId = z.string().min(1);

/** Condition rating: integer 1–5. Spec §20.3. */
export const zCondition = z.number().int().min(CONDITION_MIN).max(CONDITION_MAX);

/**
 * Tag normalization (§7.7): trimmed, lowercased, <= 32 chars. Applied on write.
 * Use `.parse` to normalize a single tag; invalid input -> validation_failed upstream.
 */
export const zTag = z
  .string()
  .transform((s) => s.trim().toLowerCase())
  .pipe(z.string().min(1).max(TAG_MAX_LENGTH));

export const zTags = z.array(zTag).max(TAGS_MAX_PER_ITEM).default([]);

export const zAttribute = z.object({
  key: z.string().trim().min(1).max(ATTRIBUTE_KEY_MAX),
  value: z.string().trim().min(1).max(ATTRIBUTE_VALUE_MAX),
});
export const zAttributes = z.array(zAttribute).max(ATTRIBUTES_MAX_PAIRS).default([]);

export const zPhotoIds = z.array(zFileId).max(PHOTOS_MAX_PER_ENTRY);
export const zPhotoIdsAtLeastOne = zPhotoIds.min(1);

export const zTitle = z.string().trim().min(1).max(TITLE_MAX);
export const zDescription = z.string().max(DESCRIPTION_MAX).default("");
export const zNote = z.string().trim().min(1).max(NOTE_MAX);

export const zExchangeMode = z.enum(EXCHANGE_MODES);
export const zClaimPurpose = z.enum(CLAIM_PURPOSES);

/** Password gate: min length here; zxcvbn score >= 3 is enforced separately. Spec §23.1. */
export const zPassword = z.string().min(PASSWORD_MIN_LENGTH);

// ── Auth (HTTP actions, §22.1) ──────────────────────────────────────────────

export const loginInput = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const mfaSendOtpInput = z.object({ pendingToken: z.string().min(1) });

export const mfaVerifyInput = z
  .object({
    pendingToken: z.string().min(1),
    otp: z.string().optional(),
    totp: z.string().optional(),
    recoveryCode: z.string().optional(),
  })
  .refine((v) => Boolean(v.otp || v.totp || v.recoveryCode), {
    message: "one of otp / totp / recoveryCode is required",
  });

export const inviteAcceptInput = z.object({
  token: z.string().min(1),
  password: zPassword,
});

// ── Items (§22.2) ───────────────────────────────────────────────────────────

export const itemsContributeInput = z.object({
  title: zTitle,
  description: zDescription,
  categoryId: zId,
  tags: zTags,
  attributes: zAttributes,
  condition: zCondition,
  photoIds: zPhotoIdsAtLeastOne,
  exchangeMode: zExchangeMode,
  branchId: zId.optional(),
});

export const itemsUpdateInput = z.object({
  itemId: zId,
  patch: z
    .object({
      title: zTitle.optional(),
      description: zDescription.optional(),
      categoryId: zId.optional(),
      tags: zTags.optional(),
      attributes: zAttributes.optional(),
      photoIds: zPhotoIds.optional(),
    })
    // Condition is never editable via update — only rated events change it (§22.4).
    .strict(),
});

export const itemsStatusUpdateInput = z.object({
  itemId: zId,
  note: zNote,
  photoIds: zPhotoIds.optional(),
});

export const itemsMarkAvailableInput = z.object({
  itemId: zId,
  exchangeMode: zExchangeMode,
  branchId: zId.optional(),
});

export const itemsWithdrawListingInput = z.object({ itemId: zId });

export const itemsRepairCompleteInput = z.object({
  itemId: zId,
  note: zNote,
  photoIds: zPhotoIds.optional(),
  newCondition: zCondition,
});

export const itemsProposeRetirementInput = z.object({
  itemId: zId,
  reason: zNote,
  photoIds: zPhotoIdsAtLeastOne,
});

export const retirementsDecideInput = z.object({
  itemId: zId,
  approve: z.boolean(),
  note: z.string().max(NOTE_MAX).default(""),
});

// ── Claims (§22.2) ──────────────────────────────────────────────────────────

export const claimsCreateInput = z.object({
  itemId: zId,
  purpose: zClaimPurpose,
});

export const claimsCreateStagingInput = z.object({
  itemId: zId,
  branchId: zId,
});

export const claimsConfirmGiverInput = z.object({ claimId: zId });

export const claimsConfirmReceiverInput = z.object({
  claimId: zId,
  photoIds: zPhotoIdsAtLeastOne,
  condition: zCondition,
});

export const claimsCancelInput = z.object({
  claimId: zId,
  note: z.string().max(NOTE_MAX).optional(),
});

export const claimsAdminResolveInput = z.object({
  claimId: zId,
  resolution: z.enum(["force_complete", "force_cancel"]),
  note: zNote,
});

// ── Watches, branches, categories, tags (§22.2) ─────────────────────────────

export const watchesToggleInput = z.object({ itemId: zId });

export const branchesCreateInput = z.object({
  name: z.string().trim().min(1).max(TITLE_MAX),
  description: z.string().max(DESCRIPTION_MAX).default(""),
  locationText: z.string().trim().min(1).max(DESCRIPTION_MAX),
  accessNotes: z.string().max(DESCRIPTION_MAX).default(""),
  geo: z.object({ lat: z.number(), lng: z.number() }).optional(),
  photoIds: zPhotoIds.default([]),
});

export const branchesUpdateInput = z.object({
  branchId: zId,
  patch: z
    .object({
      name: z.string().trim().min(1).max(TITLE_MAX).optional(),
      description: z.string().max(DESCRIPTION_MAX).optional(),
      locationText: z.string().trim().min(1).max(DESCRIPTION_MAX).optional(),
      accessNotes: z.string().max(DESCRIPTION_MAX).optional(),
      geo: z.object({ lat: z.number(), lng: z.number() }).optional(),
      photoIds: zPhotoIds.optional(),
      status: z.enum(["active", "inactive"]).optional(),
    })
    .strict(),
});

export const categoriesUpsertInput = z.object({
  categoryId: zId.optional(),
  name: z.string().trim().min(1).max(TITLE_MAX),
  parentId: zId.optional(),
  description: z.string().max(DESCRIPTION_MAX).optional(),
});

export const categoriesArchiveInput = z.object({ categoryId: zId });

export const tagsRenameInput = z.object({ from: zTag, to: zTag });
export const tagsMergeInput = z.object({ from: zTag, to: zTag });

// ── Users & roles (§22.2) ───────────────────────────────────────────────────

export const usersInviteInput = z.object({
  name: z.string().trim().min(1).max(TITLE_MAX),
  email: z.string().email(),
});

export const usersDeactivateInput = z.object({ userId: zId });

export const usersAdminTransferInput = z.object({
  itemId: zId,
  newCustodianId: zId,
  note: zNote,
});

export const rolesUpsertInput = z.object({
  roleId: zId.optional(),
  name: z.string().trim().min(1).max(TITLE_MAX),
  description: z.string().max(DESCRIPTION_MAX).default(""),
  permissions: z.array(z.string()).default([]),
});

export const rolesAssignInput = z.object({
  userId: zId,
  roleId: zId,
  remove: z.boolean().optional(),
});

// ── Settings (§22.2, §7.10) ─────────────────────────────────────────────────

export const smtpConfigInput = z.object({
  host: z.string().trim().min(1),
  port: z.number().int().min(1).max(65535),
  secure: z.boolean().default(true),
  username: z.string().min(1),
  password: z.string().min(1),
  fromAddress: z.string().email(),
  replyToDomain: z.string().optional(),
});

export const imapConfigInput = z.object({
  host: z.string().trim().min(1),
  port: z.number().int().min(1).max(65535),
  secure: z.boolean().default(true),
  username: z.string().min(1),
  password: z.string().min(1),
});

export const settingsUpdateInput = z
  .object({
    orgName: z.string().trim().min(1).max(TITLE_MAX).optional(),
    claimExpiryHours: z
      .number()
      .int()
      .min(CLAIM_EXPIRY_HOURS_MIN)
      .max(CLAIM_EXPIRY_HOURS_MAX)
      .optional(),
    twoFactorPolicy: z.enum(TWO_FACTOR_POLICIES).optional(),
    branchesEnabled: z.boolean().optional(),
    photoMaxEdgePx: z.number().int().min(512).max(8192).optional(),
    smtp: smtpConfigInput.nullable().optional(),
    imap: imapConfigInput.nullable().optional(),
  })
  .strict();

export const notificationsMarkReadInput = z.object({ ids: z.array(zId).min(1) });

// ── Account settings (§16) ──────────────────────────────────────────────────

export const accountSettingsInput = z
  .object({
    name: z.string().trim().min(1).max(TITLE_MAX).optional(),
    contactPhone: z.string().max(64).nullable().optional(),
    defaultExchangePref: z.enum(EXCHANGE_MODES).nullable().optional(),
    notificationPref: z.enum(NOTIFICATION_PREFS).optional(),
  })
  .strict();

// ── Setup wizard (§6.3) ─────────────────────────────────────────────────────

export const setupWizardInput = z.object({
  serverManagerName: z.string().trim().min(1).max(TITLE_MAX),
  serverManagerEmail: z.string().email(),
  password: zPassword,
  orgName: z.string().trim().min(1).max(TITLE_MAX),
  twoFactorPolicy: z.enum(TWO_FACTOR_POLICIES),
  claimExpiryHours: z
    .number()
    .int()
    .min(CLAIM_EXPIRY_HOURS_MIN)
    .max(CLAIM_EXPIRY_HOURS_MAX),
  smtp: smtpConfigInput.optional(),
  imap: imapConfigInput.optional(),
});

export type SetupWizardInput = z.infer<typeof setupWizardInput>;
export type ItemsContributeInput = z.infer<typeof itemsContributeInput>;
export type ClaimsCreateInput = z.infer<typeof claimsCreateInput>;
export type ClaimsConfirmReceiverInput = z.infer<typeof claimsConfirmReceiverInput>;
