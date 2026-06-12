import { describe, expect, it } from "vitest";
import {
  ALL_PERMISSIONS,
  MEMBER_PERMISSIONS,
  isFullPermissionSet,
  isPermission,
} from "./permissions.js";
import { CLAIM_EXPIRY_HOURS_DEFAULT, OUTBOX_BACKOFF_MS, OUTBOX_MAX_ATTEMPTS } from "./constants.js";

describe("permission catalog (§5.2)", () => {
  it("has exactly 16 closed keys", () => {
    expect(ALL_PERMISSIONS).toHaveLength(16);
    expect(new Set(ALL_PERMISSIONS).size).toBe(16);
  });

  it("rejects unknown keys", () => {
    expect(isPermission("items.contribute")).toBe(true);
    expect(isPermission("items.delete_everything")).toBe(false);
  });

  it("Member default is the baseline circulation set (✦)", () => {
    expect(MEMBER_PERMISSIONS).toEqual([
      "items.contribute",
      "items.claim",
      "items.update_own",
      "items.retire_propose",
      "branches.create",
    ]);
  });

  it("only the full set counts as full-permission (§5.1 last-admin guard)", () => {
    expect(isFullPermissionSet(ALL_PERMISSIONS)).toBe(true);
    expect(isFullPermissionSet(MEMBER_PERMISSIONS)).toBe(false);
    expect(isFullPermissionSet(ALL_PERMISSIONS.slice(1))).toBe(false);
  });
});

describe("normative constants (§23.1)", () => {
  it("claim expiry default is 168 h", () => {
    expect(CLAIM_EXPIRY_HOURS_DEFAULT).toBe(168);
  });

  it("outbox backoff matches 1m / 10m / 60m across 3 attempts", () => {
    expect(OUTBOX_MAX_ATTEMPTS).toBe(3);
    expect(OUTBOX_BACKOFF_MS).toEqual([60_000, 600_000, 3_600_000]);
  });
});
