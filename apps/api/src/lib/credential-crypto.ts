// AES-GCM encryption for vendor portal passwords (Zaptec, Easee, etc.).
//
// Key wrapping: a single Worker secret OCPP_CRED_KEK acts as the KEK.
// We derive a 256-bit AES key from the secret via SHA-256 (operator can
// rotate by changing the secret + a re-encrypt migration). Each row
// stores ciphertext + a 12-byte random IV; the auth tag is appended to
// the ciphertext per the WebCrypto AES-GCM convention.
//
// Why not use envelope encryption with a per-row data key? At pilot
// scale (low-tens of credentials, infrequent reads), the simpler
// single-KEK shape is plenty. If we ever need offline rotation or
// per-tenant KEKs the envelope shape slots in by extending the
// helper signature.

// @cloudflare/workers-types doesn't expose the DOM `KeyUsage` literal
// type, so spell out the array shape directly when calling importKey.

async function deriveAesKey(kek: string): Promise<CryptoKey> {
  if (!kek || kek.length < 16) {
    throw new Error("OCPP_CRED_KEK must be set and at least 16 characters");
  }
  // SHA-256 of the secret → 32 bytes → AES-256 key. Deterministic,
  // so the same KEK always derives the same key (round-trip works
  // across restarts and across Worker instances).
  const seedBytes = new TextEncoder().encode(kek);
  const hash = await crypto.subtle.digest("SHA-256", seedBytes);
  return crypto.subtle.importKey("raw", hash, { name: "AES-GCM" }, false, [
    "encrypt",
    "decrypt",
  ]);
}

export interface SealedPassword {
  /** AES-GCM ciphertext + auth tag. */
  cipher: Uint8Array;
  /** 12-byte random nonce. */
  iv: Uint8Array;
}

export async function sealPassword(kek: string, plaintext: string): Promise<SealedPassword> {
  if (!plaintext) throw new Error("plaintext password required");
  const key = await deriveAesKey(kek);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(plaintext),
  );
  return { cipher: new Uint8Array(ciphertext), iv };
}

export async function openPassword(
  kek: string,
  sealed: { cipher: Uint8Array | Buffer; iv: Uint8Array | Buffer },
): Promise<string> {
  const key = await deriveAesKey(kek);
  const cipher = sealed.cipher instanceof Uint8Array ? sealed.cipher : new Uint8Array(sealed.cipher);
  const iv = sealed.iv instanceof Uint8Array ? sealed.iv : new Uint8Array(sealed.iv);
  const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, cipher);
  return new TextDecoder().decode(plaintext);
}
