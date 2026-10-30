// Session and credential primitives for the CPO test shell.
//
// Deliberately separate from src/lib/admin-session.ts: a different cookie
// name, a different subject, a different signing secret and a domain-
// separated signature, so a shell session can never satisfy an admin/staff
// check and an admin cookie can never satisfy the shell. Nothing here reads
// ADMIN_*/AUTH_SECRET.
//
// Server-only configuration (no defaults — a missing value disables login):
//   CPO_SHELL_USERNAME        the test username
//   CPO_SHELL_PASSWORD        the test password (secret)
//   CPO_SHELL_SESSION_SECRET  HMAC signing secret, at least 32 characters (secret)
//
// This is a shared test credential for the empty shell. It is not a user
// account, an organisation membership or a permission model.

export const SHELL_COOKIE_NAME = "straumvakt_cpo_shell";
export const SHELL_SESSION_TTL_SECONDS = 60 * 60 * 8;
export const SHELL_SECRET_MIN_LENGTH = 32;

const SIGNATURE_CONTEXT = "straumvakt-cpo-shell-v1:";
const SUBJECT = "cpo-shell";

export type ShellEnv = Record<string, string | undefined>;

export type ShellConfig = {
  username: string;
  password: string;
  secret: string;
};

export type ShellSession = {
  v: 1;
  sub: typeof SUBJECT;
  username: string;
  iat: number;
  exp: number;
};

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** Returns the configuration, or null when any required value is missing. */
export function readShellConfig(env: ShellEnv = process.env): ShellConfig | null {
  const username = env.CPO_SHELL_USERNAME?.trim();
  const password = env.CPO_SHELL_PASSWORD;
  const secret = env.CPO_SHELL_SESSION_SECRET;
  if (!username || !password) return null;
  if (!secret || secret.length < SHELL_SECRET_MIN_LENGTH) return null;
  return { username, password, secret };
}

function b64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function b64UrlDecode(input: string): Uint8Array {
  const base64 = input.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

async function hmac(secret: string, message: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return new Uint8Array(
    await crypto.subtle.sign("HMAC", key, encoder.encode(message)),
  );
}

async function sha256(value: string): Promise<Uint8Array> {
  return new Uint8Array(
    await crypto.subtle.digest("SHA-256", encoder.encode(value)),
  );
}

/**
 * Compares both fields in constant time over fixed-length digests, so
 * neither the length nor the content of the expected values leaks and a
 * wrong username does not short-circuit the password comparison.
 */
export async function verifyShellCredentials(
  username: unknown,
  password: unknown,
  config: ShellConfig,
): Promise<boolean> {
  if (typeof username !== "string" || typeof password !== "string") return false;
  const [uGiven, uWanted, pGiven, pWanted] = await Promise.all([
    sha256(username.trim()),
    sha256(config.username),
    sha256(password),
    sha256(config.password),
  ]);
  const userOk = bytesEqual(uGiven, uWanted);
  const passOk = bytesEqual(pGiven, pWanted);
  return userOk && passOk;
}

export async function createShellSession(
  config: ShellConfig,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): Promise<string> {
  const payload: ShellSession = {
    v: 1,
    sub: SUBJECT,
    username: config.username,
    iat: nowSeconds,
    exp: nowSeconds + SHELL_SESSION_TTL_SECONDS,
  };
  const payloadPart = b64UrlEncode(encoder.encode(JSON.stringify(payload)));
  const signature = await hmac(config.secret, SIGNATURE_CONTEXT + payloadPart);
  return `${payloadPart}.${b64UrlEncode(signature)}`;
}

/**
 * Verifies signature, subject, expiry and that the session still belongs to
 * the configured username. Returns null for anything else, including a
 * missing configuration.
 */
export async function verifyShellSession(
  token: string | undefined | null,
  config: ShellConfig | null = readShellConfig(),
  nowSeconds: number = Math.floor(Date.now() / 1000),
): Promise<ShellSession | null> {
  if (!token || !config) return null;
  const parts = token.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  const [payloadPart, signaturePart] = parts;

  try {
    const expected = await hmac(config.secret, SIGNATURE_CONTEXT + payloadPart);
    if (!bytesEqual(expected, b64UrlDecode(signaturePart))) return null;

    const payload = JSON.parse(
      decoder.decode(b64UrlDecode(payloadPart)),
    ) as Partial<ShellSession>;
    if (payload.v !== 1 || payload.sub !== SUBJECT) return null;
    if (typeof payload.exp !== "number" || payload.exp <= nowSeconds) return null;
    if (typeof payload.iat !== "number" || payload.iat > nowSeconds + 60) return null;
    if (payload.username !== config.username) return null;
    return payload as ShellSession;
  } catch {
    return null;
  }
}

/** Secure everywhere except plain-HTTP loopback (local development). */
export function shellCookieIsSecure(requestUrl: string): boolean {
  const url = new URL(requestUrl);
  if (url.protocol === "https:") return true;
  const host = url.hostname;
  return !(host === "localhost" || host === "127.0.0.1" || host === "[::1]");
}

// Host-only on purpose: no Domain attribute, so the cookie is never sent to
// sibling subdomains.
export function shellCookieHeader(
  token: string,
  requestUrl: string,
  maxAgeSeconds: number = SHELL_SESSION_TTL_SECONDS,
): string {
  const parts = [
    `${SHELL_COOKIE_NAME}=${token}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAgeSeconds}`,
  ];
  if (shellCookieIsSecure(requestUrl)) parts.push("Secure");
  return parts.join("; ");
}

export function shellClearCookieHeader(requestUrl: string): string {
  return shellCookieHeader("", requestUrl, 0);
}
