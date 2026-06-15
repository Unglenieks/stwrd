// Opaque token + code generation and hashing (spec §6.1, §6.2, §23.1).
//
// We store only SHA-256 hashes of invite tokens, mfa_pending tokens, email OTPs,
// and recovery codes — the raw value is shown once and never persisted.
import { EMAIL_OTP_DIGITS, RECOVERY_CODE_COUNT } from "@stwrd/shared";

const enc = new TextEncoder();

function toB64Url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** A URL-safe high-entropy opaque token (default 32 bytes → 256 bits). */
export function generateToken(bytes = 32): string {
  return toB64Url(crypto.getRandomValues(new Uint8Array(bytes)));
}

/** SHA-256 hex digest — used to store tokens/codes at rest. */
export async function hashToken(raw: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", enc.encode(raw) as BufferSource);
  return toHex(new Uint8Array(digest));
}

/** Constant-time string comparison (for hashed-value matches). */
export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * A numeric OTP of the configured length, cryptographically uniform.
 * Draws a 32-bit value and rejection-samples by discarding the non-uniform top
 * region (`>= limit`) before reducing mod `max` — no modulo bias. Valid for up
 * to 9 digits (max < 2^32); EMAIL_OTP_DIGITS is 6.
 */
export function generateNumericOtp(digits = EMAIL_OTP_DIGITS): string {
  const max = 10 ** digits;
  const limit = Math.floor(0x1_0000_0000 / max) * max;
  let value: number;
  do {
    const buf = crypto.getRandomValues(new Uint8Array(4));
    value = ((buf[0]! << 24) | (buf[1]! << 16) | (buf[2]! << 8) | buf[3]!) >>> 0;
  } while (value >= limit);
  return (value % max).toString().padStart(digits, "0");
}

/**
 * Generate recovery codes (§23.1: 10 single-use codes). Returns the plaintext
 * codes (shown to the user exactly once) — the caller stores only their hashes.
 * Format: 4-4-4 lowercase base32-ish groups, e.g. `k7f2-9q4m-x3rt`.
 */
export function generateRecoveryCodes(count = RECOVERY_CODE_COUNT): string[] {
  const alphabet = "abcdefghijkmnpqrstuvwxyz23456789"; // no ambiguous chars
  const codes: string[] = [];
  for (let i = 0; i < count; i++) {
    const raw = crypto.getRandomValues(new Uint8Array(12));
    let s = "";
    for (let j = 0; j < 12; j++) {
      if (j > 0 && j % 4 === 0) s += "-";
      s += alphabet[raw[j]! % alphabet.length];
    }
    codes.push(s);
  }
  return codes;
}
