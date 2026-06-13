// Email template rendering (spec §23.4). Subject lines are NORMATIVE. Bodies are
// plain text and derive every absolute URL from `siteUrl` (PUBLIC_SITE_ORIGIN,
// §19.5) — there is no second editable base URL. The `[LOT#{claimId}]` subject
// token (and a reply-to plus-address where supported) is the inbound-matching
// key (§13).
import type { EmailTemplate } from "@lot/shared";

export interface RenderCtx {
  orgName: string;
  siteUrl: string;
}

export interface RenderedEmail {
  subject: string;
  text: string;
}

type Payload = Record<string, unknown>;

const s = (v: unknown, fallback = ""): string => (typeof v === "string" ? v : fallback);
const n = (v: unknown): number => (typeof v === "number" ? v : 0);

export function renderEmail(
  template: EmailTemplate | string,
  payload: Payload,
  ctx: RenderCtx,
): RenderedEmail {
  const { orgName, siteUrl } = ctx;
  const itemUrl = payload.itemId ? `${siteUrl}/items/${s(payload.itemId)}` : siteUrl;
  const claimToken = payload.claimId ? `[LOT#${s(payload.claimId)}] ` : "";
  const title = s(payload.itemTitle, "an item");

  switch (template) {
    case "invite":
      return {
        subject: `You're invited to ${orgName}`,
        text: `Hi ${s(payload.name, "there")},\n\nYou've been invited to join ${orgName}, a community library of things.\n\nAccept your invitation:\n${s(payload.inviteUrl, siteUrl)}\n\nThis link expires in 72 hours.`,
      };
    case "otp":
      return {
        subject: `${s(payload.code)} is your ${orgName} sign-in code`,
        text: `Your ${orgName} sign-in code is ${s(payload.code)}.\n\nIt expires in 10 minutes. If you didn't try to sign in, you can ignore this email.`,
      };
    case "claim_placed":
      return {
        subject: `${claimToken}${title}: claimed by ${s(payload.claimantName ?? payload.otherPartyName, "a member")}`,
        text: `${s(payload.claimantName ?? payload.otherPartyName, "A member")} has claimed your item "${title}".\n\nCoordinate the handoff: ${itemUrl}`,
      };
    case "claim_cancelled":
      return {
        subject: `${claimToken}${title}: claim cancelled (${s(payload.reason, "cancelled")})`,
        text: `The claim on "${title}" was cancelled (${s(payload.reason)}).\n\n${itemUrl}`,
      };
    case "claim_expiring":
      return {
        subject: `${claimToken}${title}: claim expires in ${n(payload.hoursLeft)} h`,
        text: `Your claim on "${title}" expires in about ${n(payload.hoursLeft)} hours. Complete the handoff before then, or it will return to the catalog.\n\n${itemUrl}`,
      };
    case "handoff_completed":
      return {
        subject: `${claimToken}${title}: handoff confirmed`,
        text: `The handoff for "${title}" is confirmed. The ledger has been updated.\n\n${itemUrl}`,
      };
    case "watched_item_available":
      return {
        subject: `${title} is available`,
        text: `An item you're watching, "${title}", is now available to claim. First confirmed claim wins.\n\n${itemUrl}`,
      };
    case "retirement_decision":
      return {
        subject: `${title}: retirement ${payload.approved ? "approved" : "denied"}`,
        text: `Your retirement proposal for "${title}" was ${payload.approved ? "approved" : "denied"}.${payload.note ? `\n\nNote: ${s(payload.note)}` : ""}\n\n${itemUrl}`,
      };
    case "branch_item_placed":
      return {
        subject: `${title} placed at ${s(payload.branchName, "a branch")}`,
        text: `"${title}" was placed at ${s(payload.branchName, "a branch")}.\n\n${siteUrl}/branches/${s(payload.branchId)}`,
      };
    case "security_alert":
      return {
        subject: `${orgName} account security notice`,
        text: `A security-related event occurred on your ${orgName} account: ${s(payload.event, "account update")}.\n\nIf this wasn't you, contact your server manager.`,
      };
    default:
      return {
        subject: `${orgName} notification`,
        text: `You have a new notification from ${orgName}.\n\n${siteUrl}`,
      };
  }
}

/** Which notification kinds (§23.5) have an email template (§23.4). */
export const EMAIL_TEMPLATE_FOR_KIND: Record<string, EmailTemplate> = {
  claim_placed: "claim_placed",
  claim_cancelled: "claim_cancelled",
  claim_expiring: "claim_expiring",
  handoff_completed: "handoff_completed",
  watched_item_available: "watched_item_available",
  retirement_decision: "retirement_decision",
  branch_item_placed: "branch_item_placed",
  security_alert: "security_alert",
};
