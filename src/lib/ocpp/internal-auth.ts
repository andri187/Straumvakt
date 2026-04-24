/**
 * Shared helpers for OCPP-gateway-initiated internal calls to the main
 * app. Gateway → main-app traffic uses `OCPP_INGEST_SECRET` header as
 * belt-and-braces alongside the Cloudflare Service Binding (same
 * secret we use for the event-ingest route — see ADR 0004).
 *
 * `authSecretHash` column on `ocpp.ocpp_identities` is a lowercase hex
 * SHA-256 of the charger's Basic-Auth password. OCPP secrets are
 * high-entropy randoms we generate during onboarding, so SHA-256 is
 * adequate; bcrypt's slow hashing would burn CPU without gain.
 */

export const INGEST_HEADER = "x-straumvakt-ingest";

/**
 * Compute the lowercase-hex SHA-256 digest of an input. Used to hash
 * Basic-Auth passwords at onboarding AND at verification time.
 */
export async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return bufferToHex(digest);
}

function bufferToHex(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i].toString(16).padStart(2, "0");
  }
  return out;
}

/**
 * Constant-time compare of two lowercase-hex strings. Mismatched
 * lengths still consume full work — no length-leak side channel.
 */
export function hexEquals(a: string, b: string): boolean {
  const len = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < len; i++) {
    const ai = i < a.length ? a.charCodeAt(i) : 0;
    const bi = i < b.length ? b.charCodeAt(i) : 0;
    diff |= ai ^ bi;
  }
  return diff === 0;
}
