// Password hashing for the credentials provider (spec §6.2).
//
// DEVIATION (documented): the spec specifies Argon2id. Argon2 has no Web Crypto
// primitive and native/WASM builds don't load in the Convex V8 isolate where
// hashing runs, so we use PBKDF2-HMAC-SHA-256 — a FIPS-grade KDF available in
// Web Crypto and isolate-safe. Format is self-describing so the algorithm/params
// can be upgraded later (e.g. WASM Argon2id) with transparent re-hash on login.
//
// Stored format: `pbkdf2$<iterations>$<saltB64>$<hashB64>`

const ITERATIONS = 600_000; // OWASP ASVS 5.0 minimum for PBKDF2-HMAC-SHA-256
const KEY_LEN_BYTES = 32;
const SALT_LEN_BYTES = 16;

const enc = new TextEncoder();

function toB64(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function fromB64(b64: string): Uint8Array {
  const s = atob(b64);
  const u8 = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) u8[i] = s.charCodeAt(i);
  return u8;
}

async function derive(
  password: string,
  salt: Uint8Array,
  iterations: number,
): Promise<Uint8Array> {
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    enc.encode(password) as BufferSource,
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: salt as BufferSource, iterations, hash: "SHA-256" },
    keyMaterial,
    KEY_LEN_BYTES * 8,
  );
  return new Uint8Array(bits);
}

/** Constant-time comparison of two equal-length byte arrays. */
function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}

export async function hashSecret(secret: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LEN_BYTES));
  const hash = await derive(secret, salt, ITERATIONS);
  return `pbkdf2$${ITERATIONS}$${toB64(salt)}$${toB64(hash)}`;
}

export async function verifySecret(secret: string, stored: string): Promise<boolean> {
  try {
    const parts = stored.split("$");
    if (parts.length !== 4 || parts[0] !== "pbkdf2") return false;
    const iterations = Number(parts[1]);
    if (!Number.isInteger(iterations) || iterations <= 0) return false;
    const salt = fromB64(parts[2]!);
    const expected = fromB64(parts[3]!);
    const actual = await derive(secret, salt, iterations);
    return timingSafeEqual(actual, expected);
  } catch {
    // Malformed/tampered stored hash (e.g. invalid base64) → verification fails
    // closed rather than throwing.
    return false;
  }
}
