/**
 * OCPP ingest auth — shared-secret header check.
 *
 * The gateway worker (Sprint 1.4) calls the main app via Cloudflare
 * Service Binding. Both paths resolve to the main app's HTTP handler,
 * so the main app closes the route to any request without a matching
 * secret header. Because the binding already prevents public callers
 * from reaching this path under normal CF routing, the secret's
 * purpose is belt-and-braces — a second line that survives if a
 * binding config regression ever exposes the endpoint.
 *
 * Design constraints:
 *   • Constant-time compare, mismatched-length safe (no early exit
 *     leaking length).
 *   • Never log or echo the expected secret — Rule 2.
 *   • 401 responses carry no detail — opaque to callers.
 *
 * See ADR 0004 for the full transport rationale.
 */

const HEADER = "x-straumvakt-ingest";

/**
 * Verifies the header against the configured secret. Returns an opaque
 * `Response` on failure (401 + JSON body with no hint about what went
 * wrong) or `null` when the request is authenticated.
 */
export function verifyIngest(request: Request): Response | null {
  const expected = process.env.OCPP_INGEST_SECRET;
  if (!expected || expected.length === 0) {
    // Closed by default — if the env var isn't configured we do not let
    // any request through. This makes "forgot to set the secret" a
    // deploy-time observable fault rather than a security hole.
    return unauthorized();
  }
  const provided = request.headers.get(HEADER);
  if (!provided) return unauthorized();
  if (!constantTimeEquals(provided, expected)) return unauthorized();
  return null;
}

function unauthorized(): Response {
  return new Response(JSON.stringify({ error: "unauthorized" }), {
    status: 401,
    headers: { "content-type": "application/json" },
  });
}

/**
 * XOR-accumulate all bytes and compare both length + content in one
 * pass. If lengths differ, we keep comparing against a dummy padding
 * so the total work is equal across inputs — prevents length-based
 * timing discrimination.
 */
export function constantTimeEquals(a: string, b: string): boolean {
  const aBytes = new TextEncoder().encode(a);
  const bBytes = new TextEncoder().encode(b);
  const len = Math.max(aBytes.length, bBytes.length);
  let diff = aBytes.length ^ bBytes.length;
  for (let i = 0; i < len; i++) {
    const ai = i < aBytes.length ? aBytes[i] : 0;
    const bi = i < bBytes.length ? bBytes[i] : 0;
    diff |= ai ^ bi;
  }
  return diff === 0;
}
