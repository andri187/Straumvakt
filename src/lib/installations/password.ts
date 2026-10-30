// Installation OCPP password: PBKDF2-SHA256 verifier + generator.
//
// Web Crypto only, so it runs in the Worker. 100 000 iterations is the maximum
// the Workers runtime accepts for PBKDF2, and it is the same scheme and storage
// shape as apps/api/src/lib/password.ts (pbkdf2:sha256:<iter>:<salt>:<hash>).
// A bare SHA-256 of a human-chosen password is deliberately not used.
//
// Only the verifier is stored. It is never returned by a read endpoint and is
// never placed in a change-history diff. A password cannot be recovered; the
// only operations are set, generate (shown once) and clear.

import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from "./model";

const ITERATIONS = 100_000;
const SALT_BYTES = 16;
const HASH_BYTES = 32;

const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));

async function derive(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), { name: "PBKDF2" }, false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: salt as BufferSource, iterations }, key, HASH_BYTES * 8);
  return new Uint8Array(bits);
}

export async function hashInstallationPassword(password: string): Promise<string> {
  if (password.length < MIN_PASSWORD_LENGTH || password.length > MAX_PASSWORD_LENGTH) {
    throw new RangeError("password length out of range");
  }
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const hash = await derive(password, salt, ITERATIONS);
  return `pbkdf2:sha256:${ITERATIONS}:${b64(salt)}:${b64(hash)}`;
}

/** Constant-time verification, for the future gateway consumer and for tests. */
export async function verifyInstallationPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split(":");
  if (parts.length !== 5 || parts[0] !== "pbkdf2" || parts[1] !== "sha256") return false;
  const iterations = Number(parts[2]);
  if (!Number.isInteger(iterations) || iterations < 1 || iterations > ITERATIONS) return false;
  try {
    const salt = Uint8Array.from(atob(parts[3]), (c) => c.charCodeAt(0));
    const want = Uint8Array.from(atob(parts[4]), (c) => c.charCodeAt(0));
    const got = await derive(password, salt, iterations);
    if (got.length !== want.length) return false;
    let diff = 0;
    for (let i = 0; i < got.length; i++) diff |= got[i] ^ want[i];
    return diff === 0;
  } catch {
    return false;
  }
}

// Avoids look-alike characters; 24 characters from 32 symbols = 120 bits.
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789a";

export function generateInstallationPassword(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  let out = "";
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length];
  return out;
}
