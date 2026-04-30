// Helpers for the gateway → API Worker internal call: hexEquals (used
// to compare the SHA-256 hash of the provided OCPP password against
// the stored authSecretHash without leaking timing info), and
// verifyIngest (validates the x-straumvakt-ingest header against the
// configured OCPP_INGEST_SECRET — same shared-secret pattern the
// event-ingest path uses, ADR 0004).
//
// Lives in apps/api/src/lib/ to mirror the UI Worker's
// src/lib/ocpp/{internal-auth,ingest-auth}.ts split.

const INGEST_HEADER = "x-straumvakt-ingest";

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

/**
 * XOR-accumulate all bytes and compare both length + content in one
 * pass. If lengths differ, we keep comparing against zero-padding so
 * the total work is equal across inputs — prevents length-based
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

/**
 * Returns null when the request carries a valid ingest header, an
 * opaque 401 Response otherwise. Closed by default if the secret isn't
 * configured — better that the deploy fails loudly than that an
 * unauthenticated path slips through.
 */
export function verifyIngest(req: Request, expected: string | undefined): Response | null {
  if (!expected || expected.length === 0) return unauthorized();
  const provided = req.headers.get(INGEST_HEADER);
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
