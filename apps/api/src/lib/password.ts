// PBKDF2-SHA256 password hashing for UserCredential.
//
// Web Crypto native — no WASM, runs in any Cloudflare Worker. Per-
// user 16-byte salt; 100,000 iterations (NIST 800-63B floor for
// PBKDF2-SHA256 as of 2017, still acceptable in 2026 for the
// operator-portal threat model — Sprint 9 hardening can bump or
// migrate to argon2/scrypt under the same prefix scheme).
//
// Storage shape:
//   pbkdf2:sha256:<iterations>:<saltBase64>:<hashBase64>
//
// The prefix lets future migrations sniff the algorithm without
// reading the row's age — "pbkdf2" rows can be re-hashed lazily
// on the next successful login.

const ALGO_PREFIX = "pbkdf2:sha256";
const DEFAULT_ITERATIONS = 100_000;
const SALT_BYTES = 16;
const HASH_BYTES = 32;

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

function timingSafeEqualBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

async function deriveBits(
  password: string,
  salt: Uint8Array,
  iterations: number,
): Promise<Uint8Array> {
  const baseKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    { name: "PBKDF2" },
    false,
    ["deriveBits"],
  );
  const derived = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      // Uint8Array is an ArrayBufferView which satisfies the BufferSource
      // union (ArrayBuffer | ArrayBufferView). The previous cast to
      // ArrayBuffer was structurally incorrect — Uint8Array IS NOT an
      // ArrayBuffer and the cast would silently produce wrong results in
      // environments that distinguish the two.
      salt,
      iterations,
    },
    baseKey,
    HASH_BYTES * 8,
  );
  return new Uint8Array(derived);
}

/**
 * Hash a fresh plaintext for storage. Returns the encoded prefix:
 * salt:hash string, ready to write to UserCredential.passwordHash.
 */
export async function hashPassword(plaintext: string): Promise<string> {
  if (plaintext.length === 0) throw new Error("password_empty");
  const salt = new Uint8Array(SALT_BYTES);
  crypto.getRandomValues(salt);
  const hash = await deriveBits(plaintext, salt, DEFAULT_ITERATIONS);
  return `${ALGO_PREFIX}:${DEFAULT_ITERATIONS}:${bytesToBase64(salt)}:${bytesToBase64(hash)}`;
}

/**
 * Verify a presented plaintext against a stored hash. Constant-time
 * compare on the derived bits. Returns false on any parse/format
 * problem rather than throwing — the caller treats unrecognised
 * shapes the same as "wrong password" so timing/error-message
 * channels don't leak which case applies.
 */
export async function verifyPassword(
  plaintext: string,
  stored: string,
): Promise<boolean> {
  if (plaintext.length === 0 || stored.length === 0) return false;
  const parts = stored.split(":");
  if (parts.length !== 5) return false;
  const [algo, hash, iterStr, saltB64, hashB64] = parts;
  if (algo !== "pbkdf2" || hash !== "sha256") return false;
  const iterations = Number(iterStr);
  if (!Number.isInteger(iterations) || iterations < 1) return false;
  let salt: Uint8Array;
  let expected: Uint8Array;
  try {
    salt = base64ToBytes(saltB64);
    expected = base64ToBytes(hashB64);
  } catch {
    return false;
  }
  const derived = await deriveBits(plaintext, salt, iterations);
  return timingSafeEqualBytes(derived, expected);
}
