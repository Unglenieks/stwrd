// RFC 6238 TOTP via Web Crypto (isolate-safe) — spec §6.2.
// ±1 time-step tolerance (TOTP_STEP_TOLERANCE), 30-second period, 6 digits,
// HMAC-SHA-1 (the otpauth default that authenticator apps expect).
import { TOTP_STEP_TOLERANCE } from "@stwrd/shared";

const PERIOD_SECONDS = 30;
const DIGITS = 6;
const B32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += B32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32_ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(input: string): Uint8Array {
  const clean = input.toUpperCase().replace(/=+$/, "").replace(/\s/g, "");
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = B32_ALPHABET.indexOf(ch);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return new Uint8Array(out);
}

/** A fresh random TOTP secret (20 bytes → 160 bits), base32-encoded. */
export function generateTotpSecret(): string {
  return base32Encode(crypto.getRandomValues(new Uint8Array(20)));
}

async function hotp(secretB32: string, counter: number): Promise<string> {
  const key = base32Decode(secretB32);
  const msg = new Uint8Array(8);
  // 64-bit big-endian counter.
  let c = counter;
  for (let i = 7; i >= 0; i--) {
    msg[i] = c & 0xff;
    c = Math.floor(c / 256);
  }
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    key as BufferSource,
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", cryptoKey, msg as BufferSource));
  const offset = sig[sig.length - 1]! & 0x0f;
  const bin =
    ((sig[offset]! & 0x7f) << 24) |
    ((sig[offset + 1]! & 0xff) << 16) |
    ((sig[offset + 2]! & 0xff) << 8) |
    (sig[offset + 3]! & 0xff);
  return (bin % 10 ** DIGITS).toString().padStart(DIGITS, "0");
}

/** Verify a TOTP code with ±TOTP_STEP_TOLERANCE step tolerance. */
export async function verifyTotp(
  secretB32: string,
  token: string,
  atMs = Date.now(),
): Promise<boolean> {
  const normalized = token.replace(/\s/g, "");
  if (!/^\d{6}$/.test(normalized)) return false;
  const counter = Math.floor(atMs / 1000 / PERIOD_SECONDS);
  for (let w = -TOTP_STEP_TOLERANCE; w <= TOTP_STEP_TOLERANCE; w++) {
    if (await hotp(secretB32, counter + w) === normalized) return true;
  }
  return false;
}

/** The otpauth:// enrollment URI for QR rendering. */
export function totpAuthUri(secretB32: string, account: string, issuer: string): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const params = new URLSearchParams({
    secret: secretB32,
    issuer,
    algorithm: "SHA1",
    digits: String(DIGITS),
    period: String(PERIOD_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}
