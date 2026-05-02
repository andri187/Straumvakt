// Gateway → API event ingest path.
//
// POST /api/ocpp/events — called by the OCPP gateway DO on every
// translated OCPP message. Service-binding only; gated by the
// OCPP_INGEST_SECRET shared-secret header (ADR 0004). The route
// validates the envelope, ingests it (idempotent, event-log-first,
// projections inside the same transaction), and returns 202.
//
// Sprint S1 (gbtNotes/2026-05-01-ocpp-ingest-current-state-and-gaps.md)
// ports the handler from src/lib/ocpp/* (UI Worker) into apps/api so
// the staging gateway — which binds to hlada-api-staging — stops
// 404'ing on every OCPP frame. The URL stays as /api/ocpp/events to
// match what the gateway already posts to. Sprint 4 renames the URL
// to /api/internal/ocpp-events for prefix consistency, atomically
// with the production binding flip + UI Worker route delete.
//
// Status codes:
//   202 — fresh event accepted (recorded: true) OR replay (recorded: false)
//   400 — malformed JSON or invalid envelope (terse reason; safe to
//         leak to the gateway since it's our own code)
//   401 — missing / wrong ingest secret
//   500 — transaction failed (gateway retries)

import { Hono } from "hono";
import { makePrisma } from "../../lib/prisma";
import { verifyIngest } from "../../lib/ocpp-internal-auth";
import { parseIngestEvent } from "../../lib/ocpp/event-envelope";
import { ingestEvent } from "../../lib/ocpp/events-repository";
// Side-effect import — registers projection handlers on first module load.
import "../../lib/ocpp/bootstrap";
import type { Env } from "../../bindings";

export const internalOcppEvents = new Hono<{ Bindings: Env }>();

internalOcppEvents.post("/", async (c) => {
  const fail = verifyIngest(c.req.raw, c.env.OCPP_INGEST_SECRET);
  if (fail) return fail;

  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    return c.json({ error: "malformed json" }, 400);
  }

  const parsed = parseIngestEvent(raw);
  if (!parsed.ok) {
    return c.json({ error: parsed.error }, 400);
  }

  try {
    const db = makePrisma(c.env);
    const result = await ingestEvent(db, parsed.event);
    return c.json(result, 202);
  } catch (err) {
    console.error("[ocpp-events] transaction failed", err);
    return c.json({ error: "ingest failed" }, 500);
  }
});
