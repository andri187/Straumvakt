/**
 * POST /api/ocpp/events — OCPP event ingest from the gateway worker.
 *
 * Sprint 1.1 scope: accept a validated `IngestEvent` envelope, write
 * event-log-first with idempotency, dispatch projections. Transport is
 * Cloudflare Service Binding (ADR 0004) — the gateway (Sprint 1.4)
 * calls `env.MAIN_APP.fetch(...)` with the `x-straumvakt-ingest`
 * header. Until the gateway lands, this route rejects everything
 * without that header, which is the closed-by-default posture.
 *
 * The route deliberately returns terse responses — no echoing of
 * validation details to anyone who isn't the gateway (our own code).
 * Unauthorized → 401. Malformed → 400 with a short reason (safe to
 * reveal since only the gateway can reach this code path). Replay →
 * 202 with `recorded: false`. Fresh → 202 with `recorded: true`.
 */
import { NextResponse } from "next/server";
import { verifyIngest } from "@/lib/ocpp/ingest-auth";
import { parseIngestEvent } from "@/lib/ocpp/event-envelope";
import { ingestEvent } from "@/lib/repositories/events";
// Side-effect import — registers projection handlers on first module load.
import "@/lib/ocpp/bootstrap";

export async function POST(req: Request) {
  const authFail = verifyIngest(req);
  if (authFail) return authFail;

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "malformed json" }, { status: 400 });
  }

  const parsed = parseIngestEvent(raw);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  try {
    const result = await ingestEvent(parsed.event);
    return NextResponse.json(result, { status: 202 });
  } catch (err) {
    // Return 500 without leaking details. The gateway will retry;
    // DO-side backoff handles the storm. Structured logging picks up
    // the exception via the worker runtime.
    // eslint-disable-next-line no-console
    console.error("[ocpp.ingest] transaction failed", err);
    return NextResponse.json({ error: "ingest failed" }, { status: 500 });
  }
}
