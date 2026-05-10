// Driver-app bearer-token session — Flutter / mobile clients call
// /api/driver/login to mint these, attach Authorization: Bearer <token>
// on subsequent calls. Mirrors admin-session.ts shape but with a
// distinct payload (`sub: 'driver'`) so admin and driver tokens are
// never interchangeable even when signed with the same secret.
//
// Tokens are stateless — no driver_sessions DB table. Revocation
// today = wait for expiry. Add a denylist if revocation gets needed.
//
// Pilot reuses AUTH_SECRET for signing; future operator-driven
// rotation can split to a dedicated DRIVER_AUTH_SECRET without code
// changes (just a different env var resolved at the route layer).

const ACCESS_TOKEN_TTL_SECONDS = 60 * 60; // 1h
const REFRESH_TOKEN_TTL_SECONDS = 60 * 60 * 24 * 30; // 30d

export type DriverTokenKind = "access" | "refresh";

export interface DriverTokenPayload {
  sub: "driver";
  kind: DriverTokenKind;
  userId: string;
  email: string;
  exp: number;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function b64UrlEncode(input: Uint8Array): string {
  const binary = String.fromCharCode(...input);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function b64UrlDecode(input: string): Uint8Array {
  const base64 = input.replace(/-/g, "+").replace(/_/g, "/");
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(base64 + padding);
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

function timingSafeEqualBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

async function importHmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

async function signPayload(payloadPart: string, secret: string): Promise<Uint8Array> {
  const key = await importHmacKey(secret);
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(payloadPart));
  return new Uint8Array(signature);
}

export async function mintDriverToken(
  secret: string,
  input: { userId: string; email: string; kind: DriverTokenKind },
): Promise<{ token: string; expiresAtSeconds: number; ttlSeconds: number }> {
  const ttl = input.kind === "access" ? ACCESS_TOKEN_TTL_SECONDS : REFRESH_TOKEN_TTL_SECONDS;
  const exp = Math.floor(Date.now() / 1000) + ttl;
  const payload: DriverTokenPayload = {
    sub: "driver",
    kind: input.kind,
    userId: input.userId,
    email: input.email,
    exp,
  };
  const payloadPart = b64UrlEncode(encoder.encode(JSON.stringify(payload)));
  const signature = await signPayload(payloadPart, secret);
  const signaturePart = b64UrlEncode(signature);
  return {
    token: `${payloadPart}.${signaturePart}`,
    expiresAtSeconds: exp,
    ttlSeconds: ttl,
  };
}

export async function verifyDriverToken(
  secret: string,
  token: string | undefined,
  expectedKind: DriverTokenKind = "access",
): Promise<DriverTokenPayload | null> {
  if (!token) return null;
  const [payloadPart, signaturePart] = token.split(".");
  if (!payloadPart || !signaturePart) return null;
  try {
    const expectedSig = await signPayload(payloadPart, secret);
    const actualSig = b64UrlDecode(signaturePart);
    if (!timingSafeEqualBytes(expectedSig, actualSig)) return null;
    const payloadJson = decoder.decode(b64UrlDecode(payloadPart));
    const payload = JSON.parse(payloadJson) as DriverTokenPayload;
    if (payload.sub !== "driver") return null;
    if (payload.kind !== expectedKind) return null;
    if (typeof payload.exp !== "number" || payload.exp <= Math.floor(Date.now() / 1000)) return null;
    if (!payload.userId || !payload.email) return null;
    return payload;
  } catch {
    return null;
  }
}

export const driverSessionConfig = {
  ACCESS_TOKEN_TTL_SECONDS,
  REFRESH_TOKEN_TTL_SECONDS,
};
