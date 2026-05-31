// Sprint 9 / ENRICH-4 — Enrichment-status admin route.
//
// GET /api/admin/billing/enrichment
//   ?status=pending|complete|mismatch|stale|all  (default: all)
//   ?days=30                                      (default: 30)
//   ?limit=100                                    (default: 100)
//
// Returns a summary tile row (counts per status bucket) + a session list
// annotated with per-source energy figures and OCMF blob presence.
//
// Pure read — no mutations. Mounted by billing.ts.

import { Hono } from "hono";
import { makePrisma } from "../../lib/prisma";
import { requirePermission } from "../../lib/auth/require-permission";
import {
  listEnrichmentSessions,
  type EnrichmentStatusFilter,
} from "../../repositories/billing-enrichment";
import type { Env } from "../../bindings";
import type { AuthVars } from "../../lib/auth-middleware";

export const enrichmentRouter = new Hono<{
  Bindings: Env;
  Variables: AuthVars;
}>(); // requireAdmin is already applied by the parent adminBilling router.

const VALID_STATUSES = new Set<EnrichmentStatusFilter>([
  "pending",
  "complete",
  "mismatch",
  "stale",
  "all",
]);

function parseStatus(raw: string | undefined): EnrichmentStatusFilter {
  if (!raw) return "all";
  return VALID_STATUSES.has(raw as EnrichmentStatusFilter)
    ? (raw as EnrichmentStatusFilter)
    : "all";
}

function intParam(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

enrichmentRouter.get(
  "/",
  requirePermission("billing.read"),
  async (c) => {
    const status = parseStatus(c.req.query("status"));
    const days = intParam(c.req.query("days"), 30);
    const limit = intParam(c.req.query("limit"), 100);

    const db = makePrisma(c.env);
    const { summary, sessions } = await listEnrichmentSessions(db, {
      status,
      days,
      limit,
    });

    return c.json({
      summary,
      sessions: sessions.map((s) => ({
        sessionId: s.sessionId,
        startedAt: s.startedAt.toISOString(),
        stoppedAt: s.stoppedAt?.toISOString() ?? null,
        chargerDisplayName: s.chargerDisplayName,
        siteDisplayName: s.siteDisplayName,
        energyKwh: s.energyKwh,
        costIskMinor: s.costIskMinor?.toString() ?? null,
        verifiedSource: s.verifiedSource,
        enrichmentStatus: s.enrichmentStatus,
        ocppEnergyKwh: s.ocppEnergyKwh,
        cdrEnergyKwh: s.cdrEnergyKwh,
        energyDeltaKwh: s.energyDeltaKwh,
        hasOcmfBlob: s.hasOcmfBlob,
      })),
    });
  },
);
