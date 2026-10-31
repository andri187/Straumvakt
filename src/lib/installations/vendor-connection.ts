// A short-lived, encrypted vendor connection for the authenticated CPO application.
//
// After the operator signs in to an OEM account once, the vendor access token has to survive between requests so that the
// next steps (list installations, onboard the selected ones) need no second sign-in. This module keeps it as ONE sealed
// cookie held by the browser, so the Worker keeps no session state and nothing here depends on Worker memory.
//
//   - Sealed with AES-256-GCM under a key derived (HKDF-SHA256) from CPO_SHELL_SESSION_SECRET with its own salt and purpose
//     label. The shell login's own signing is not touched or reused as a signature; only the secret is shared.
//   - Bound by authenticated data to: the vendor, the CPO organisation, the CURRENT signed shell session (a digest of its
//     token) and the expiry. A cookie replayed for another vendor, CPO or shell session, or with an edited expiry, fails
//     authentication and is treated as no connection at all.
//   - Lifetime is the vendor token's own lifetime, capped at 15 minutes. It holds no password and no refresh token.
//   - HttpOnly, SameSite=Strict, Secure on HTTPS, and Path-scoped to the one endpoint that uses it, so the browser sends it
//     nowhere else (not to pages, not to other APIs). Page script can never read it.
//   - A token too large for one cookie is refused with a clear error. It is never truncated or split.
//
// What this is not: a server-side session. It cannot be revoked before it expires (clearing it only removes the browser's
// copy), and the 15-minute cap is the revocation bound. It protects against reading and tampering, not against a client that
// already holds a valid cookie and a valid shell session. The wait cookie below is client-held too, so it is a courtesy that
// stops an honest page hammering a vendor, not a rate-limit guarantee.

import { shellCookieIsSecure } from "@/lib/cpo-shell-session";

export const CONNECTION_COOKIE_PREFIX = "straumvakt_vc_";
export const WAIT_COOKIE_PREFIX = "straumvakt_vw_";
/** The one endpoint that reads these cookies. */
export const VENDOR_COOKIE_PATH = "/api/cpo/installations";
export const MAX_LIFETIME_SECONDS = 15 * 60;
export const DEFAULT_LIFETIME_SECONDS = 10 * 60;
export const MIN_LIFETIME_SECONDS = 30;
/** Browsers accept about 4096 bytes per cookie including name and attributes; stay well inside that. */
export const MAX_COOKIE_VALUE_LENGTH = 3500;

const FORMAT = "1";
const PURPOSE = "straumvakt-vendor-connection-v1";
const SALT = "straumvakt-vendor-connection-salt-v1";
const MAX_WAIT_SECONDS = 86_400;

const enc = new TextEncoder();
const dec = new TextDecoder();

export type ConnectionBinding = {
  /** The vendor slug (hardware catalogue style, e.g. "easee"). */
  vendor: string;
  /** The CPO organisation this workspace works for. */
  orgId: string;
  /** The current signed shell session cookie value; only a digest of it is used. */
  shellSessionToken: string;
};

export type ConnectionErrorCode = "too_large" | "too_short" | "no_secret" | "bad_vendor";

export class ConnectionError extends Error {
  code: ConnectionErrorCode;
  constructor(code: ConnectionErrorCode, message: string) {
    super(message);
    this.name = "ConnectionError";
    this.code = code;
  }
}

const VENDOR_SLUG = /^[a-z][a-z0-9-]{1,31}$/;
export const isVendorSlug = (v: unknown): v is string => typeof v === "string" && VENDOR_SLUG.test(v);

function b64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

// The return type is inferred on purpose: a plain ArrayBuffer-backed array is what WebCrypto's BufferSource accepts in every TypeScript version.
function b64UrlDecode(input: string) {
  const base64 = input.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

async function digestHex(value: string): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(value)));
  return Array.from(d, (b) => b.toString(16).padStart(2, "0")).join("");
}

async function deriveKey(secret: string): Promise<CryptoKey> {
  if (!secret) throw new ConnectionError("no_secret", "No signing secret is configured.");
  const base = await crypto.subtle.importKey("raw", enc.encode(secret), "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: enc.encode(SALT), info: enc.encode(PURPOSE) },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

async function additionalData(binding: ConnectionBinding, expSeconds: number) {
  return enc.encode(JSON.stringify([PURPOSE, binding.vendor, binding.orgId, await digestHex(binding.shellSessionToken), expSeconds]));
}

export type SealedConnection = {
  /** The cookie value. */
  value: string;
  /** Epoch milliseconds at which the connection ends. */
  expiresAt: number;
  maxAgeSeconds: number;
};

/**
 * Seals an access token. The lifetime is the vendor's `expiresIn` capped at 15 minutes (10 minutes when the vendor did not
 * say). A token that expires almost at once is refused rather than stored.
 */
export async function sealConnection(
  input: { accessToken: string; vendorExpiresInSeconds: number | null },
  binding: ConnectionBinding,
  secret: string,
  nowMs: number = Date.now(),
): Promise<SealedConnection> {
  if (!isVendorSlug(binding.vendor)) throw new ConnectionError("bad_vendor", "Not a vendor.");
  const stated = input.vendorExpiresInSeconds;
  if (stated !== null && Number.isFinite(stated) && stated < MIN_LIFETIME_SECONDS) {
    throw new ConnectionError("too_short", "The vendor's access token expires too soon to be used. Try connecting again.");
  }
  const lifetime = Math.min(MAX_LIFETIME_SECONDS, stated !== null && Number.isFinite(stated) && stated > 0 ? Math.floor(stated) : DEFAULT_LIFETIME_SECONDS);
  const expiresAt = nowMs + lifetime * 1000;
  const exp = Math.floor(expiresAt / 1000);

  const key = await deriveKey(secret);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = enc.encode(JSON.stringify({ v: 1, vendor: binding.vendor, org: binding.orgId, token: input.accessToken }));
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: await additionalData(binding, exp) }, key, plaintext));
  const value = `${FORMAT}.${exp}.${b64UrlEncode(iv)}.${b64UrlEncode(sealed)}`;
  if (value.length > MAX_COOKIE_VALUE_LENGTH) {
    throw new ConnectionError("too_large", "The vendor's access token is too large to keep for this connection. Nothing was stored.");
  }
  return { value, expiresAt: exp * 1000, maxAgeSeconds: Math.max(1, exp - Math.floor(nowMs / 1000)) };
}

export type OpenedConnection =
  | { ok: true; accessToken: string; expiresAt: number }
  | { ok: false; reason: "missing" | "malformed" | "expired" | "rejected" };

/**
 * Opens a sealed connection for exactly this binding. Any failure (a different vendor, CPO, shell session or secret; an
 * edited expiry; a damaged value) is `rejected` or `malformed` and yields no token. Expiry is checked before decryption.
 */
export async function openConnection(
  value: string | null | undefined,
  binding: ConnectionBinding,
  secret: string,
  nowMs: number = Date.now(),
): Promise<OpenedConnection> {
  if (!value) return { ok: false, reason: "missing" };
  const parts = value.split(".");
  if (parts.length !== 4 || parts[0] !== FORMAT || !/^\d{1,12}$/.test(parts[1]) || !parts[2] || !parts[3]) return { ok: false, reason: "malformed" };
  const exp = Number(parts[1]);
  if (exp * 1000 <= nowMs) return { ok: false, reason: "expired" };
  // A genuine value never outlives the cap; a larger expiry was not produced by sealConnection.
  if (exp * 1000 > nowMs + (MAX_LIFETIME_SECONDS + 60) * 1000) return { ok: false, reason: "malformed" };
  try {
    const key = await deriveKey(secret);
    const plain = new Uint8Array(
      await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: b64UrlDecode(parts[2]), additionalData: await additionalData(binding, exp) },
        key,
        b64UrlDecode(parts[3]),
      ),
    );
    const payload = JSON.parse(dec.decode(plain)) as { v?: unknown; vendor?: unknown; org?: unknown; token?: unknown };
    if (payload.v !== 1 || payload.vendor !== binding.vendor || payload.org !== binding.orgId) return { ok: false, reason: "rejected" };
    if (typeof payload.token !== "string" || !payload.token) return { ok: false, reason: "rejected" };
    return { ok: true, accessToken: payload.token, expiresAt: exp * 1000 };
  } catch {
    return { ok: false, reason: "rejected" };
  }
}

// ── Cookies ────────────────────────────────────────────────────────────────

/** Reads one cookie from a raw Cookie header. */
export function readCookie(cookieHeader: string | null | undefined, name: string): string | undefined {
  if (!cookieHeader) return undefined;
  for (const part of cookieHeader.split(";")) {
    const index = part.indexOf("=");
    if (index < 0) continue;
    if (part.slice(0, index).trim() === name) return part.slice(index + 1).trim();
  }
  return undefined;
}

export const connectionCookieName = (vendor: string) => `${CONNECTION_COOKIE_PREFIX}${vendor}`;
export const waitCookieName = (vendor: string) => `${WAIT_COOKIE_PREFIX}${vendor}`;

function cookieHeader(name: string, value: string, maxAgeSeconds: number, requestUrl: string): string {
  const parts = [`${name}=${value}`, `Path=${VENDOR_COOKIE_PATH}`, "HttpOnly", "SameSite=Strict", `Max-Age=${Math.max(0, Math.floor(maxAgeSeconds))}`];
  if (shellCookieIsSecure(requestUrl)) parts.push("Secure");
  return parts.join("; ");
}

export const connectionCookie = (vendor: string, sealed: SealedConnection, requestUrl: string) =>
  cookieHeader(connectionCookieName(vendor), sealed.value, sealed.maxAgeSeconds, requestUrl);
export const clearConnectionCookie = (vendor: string, requestUrl: string) => cookieHeader(connectionCookieName(vendor), "", 0, requestUrl);

/** Remembers a vendor's Retry-After in the browser so the next call is refused before it leaves the Worker. */
export function waitCookie(vendor: string, retryAfterSeconds: number, requestUrl: string, nowMs: number = Date.now()): string {
  const seconds = Math.min(MAX_WAIT_SECONDS, Math.max(1, Math.ceil(retryAfterSeconds)));
  return cookieHeader(waitCookieName(vendor), String(nowMs + seconds * 1000), seconds, requestUrl);
}

/** Seconds still to wait, from the wait cookie; 0 when there is none, it is spent, or it is not a plausible deadline. */
export function remainingWaitSeconds(cookieHeaderValue: string | null | undefined, vendor: string, nowMs: number = Date.now()): number {
  const raw = readCookie(cookieHeaderValue, waitCookieName(vendor));
  if (!raw || !/^\d{1,15}$/.test(raw)) return 0;
  const until = Number(raw);
  if (until <= nowMs || until > nowMs + MAX_WAIT_SECONDS * 1000) return 0;
  return Math.ceil((until - nowMs) / 1000);
}
