// At-rest encryption for SMTP/IMAP credentials and TOTP secrets (spec §7.10,
// §18.1). AES-256-GCM via Web Crypto, which runs in the Convex isolate. The key
// derives from APP_SECRETS_KEY, a Convex deployment env var (§19.1) — never the
// frontend.
import { AppError } from "@stwrd/shared";

export interface EncryptedSecret {
  ciphertext: string; // base64
  iv: string; // base64
  tag: string; // base64 (GCM auth tag)
}

const enc = new TextEncoder();
const dec = new TextDecoder();

function toB64(bytes: ArrayBuffer | Uint8Array): string {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = "";
  for (const b of u8) s += String.fromCharCode(b);
  return btoa(s);
}

function fromB64(b64: string): Uint8Array {
  const s = atob(b64);
  const u8 = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) u8[i] = s.charCodeAt(i);
  return u8;
}

async function importKey(): Promise<CryptoKey> {
  const raw = process.env.APP_SECRETS_KEY;
  if (!raw) {
    // Configuration error, not a user error — surfaced as a 500-equivalent.
    throw new AppError("validation_failed", "APP_SECRETS_KEY is not set on the deployment");
  }
  // APP_SECRETS_KEY is base64 of 32 random bytes (§19.1). Hash to a stable
  // 256-bit key so any sufficiently-strong input works.
  const digest = await crypto.subtle.digest("SHA-256", enc.encode(raw));
  return crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, [
    "encrypt",
    "decrypt",
  ]);
}

export async function encryptSecret(plaintext: string): Promise<EncryptedSecret> {
  const key = await importKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const combined = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: iv as BufferSource },
      key,
      enc.encode(plaintext) as BufferSource,
    ),
  );
  // Web Crypto appends the 16-byte tag to the ciphertext; split to match schema.
  const tag = combined.slice(combined.length - 16);
  const ciphertext = combined.slice(0, combined.length - 16);
  return { ciphertext: toB64(ciphertext), iv: toB64(iv), tag: toB64(tag) };
}

export async function decryptSecret(secret: EncryptedSecret): Promise<string> {
  const key = await importKey();
  const iv = fromB64(secret.iv);
  const ciphertext = fromB64(secret.ciphertext);
  const tag = fromB64(secret.tag);
  const combined = new Uint8Array(ciphertext.length + tag.length);
  combined.set(ciphertext, 0);
  combined.set(tag, ciphertext.length);
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: iv as BufferSource },
    key,
    combined as BufferSource,
  );
  return dec.decode(plain);
}
