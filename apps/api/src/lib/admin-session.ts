// Admin HMAC session — ported from monolith src/lib/admin-session.ts.
// Functions take secret as an explicit arg so Worker code passes
// c.env.AUTH_SECRET in, instead of reading process.env.

const SESSION_COOKIE_NAME = "straumvakt_admin_session";
const SESSION_TTL_SECONDS = 60 * 60 * 12; // 12h

export type SessionRole = "admin" | "superuser";

export type SessionPayload = {
  sub: "admin";
  role: SessionRole;
  email: string;
  exp: number;
  // Sprint 5.5 — resolved User.id of the bootstrap admin row.
  // Optional in the type for backward compatibility with cookies
  // minted by the pre-5.5 login route (those still validate; their
  // userId stays undefined and audit-log rows fall back to null).
  // The login route ALWAYS sets userId on freshly-minted cookies.
  userId?: string;
};

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

export async function createAdminSession(
  secret: string,
  email: string,
  options: { role?: SessionRole; userId?: string } = {},
): Promise<string> {
  const payload: SessionPayload = {
    sub: "admin",
    role: options.role ?? "admin",
    email,
    exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
    userId: options.userId,
  };
  const payloadPart = b64UrlEncode(encoder.encode(JSON.stringify(payload)));
  const signature = await signPayload(payloadPart, secret);
  const signaturePart = b64UrlEncode(signature);
  return `${payloadPart}.${signaturePart}`;
}

export async function verifyAdminSession(
  secret: string,
  token: string | undefined,
): Promise<SessionPayload | null> {
  if (!token) return null;
  const [payloadPart, signaturePart] = token.split(".");
  if (!payloadPart || !signaturePart) return null;
  try {
    const expectedSig = await signPayload(payloadPart, secret);
    const actualSig = b64UrlDecode(signaturePart);
    if (!timingSafeEqualBytes(expectedSig, actualSig)) return null;
    const payloadJson = decoder.decode(b64UrlDecode(payloadPart));
    const payload = JSON.parse(payloadJson) as SessionPayload;
    if (payload.sub !== "admin") return null;
    if (typeof payload.exp !== "number" || payload.exp <= Math.floor(Date.now() / 1000)) return null;
    if (!payload.email) return null;
    if (!payload.role) payload.role = "admin";
    return payload;
  } catch {
    return null;
  }
}

export function timingSafeEqualText(a: string, b: string): boolean {
  return timingSafeEqualBytes(encoder.encode(a), encoder.encode(b));
}

export const adminSessionConfig = {
  SESSION_COOKIE_NAME,
  SESSION_TTL_SECONDS,
};
