#!/usr/bin/env tsx
/**
 * shadow-compare-resolvers.ts — Sprint 9 cutover step CO-3.
 *
 * SHADOW comparator harness. Walks the last N days of priced sessions
 * in reports.session_ledger and runs BOTH resolvers side-by-side:
 *
 *   • legacy   = apps/api/src/lib/tariff/* (the canonical path; what's
 *                in cost_isk_minor today)
 *   • new      = apps/api/src/lib/agreement/* (ADR 0019 model)
 *
 * For each session, produces a ShadowComparisonResult and tallies a
 * histogram. Optionally writes a transient comparison report under
 * docs/notes/ so the operator can review.
 *
 * READ-ONLY. This script writes NOTHING to reports.session_ledger,
 * agreements.billing_lines, agreements.agreements, or any other
 * domain table. The only writes it performs are to a local markdown
 * file under docs/notes/ (and only when --write-report is passed).
 *
 * Usage:
 *   tsx apps/api/scripts/shadow-compare-resolvers.ts
 *   tsx apps/api/scripts/shadow-compare-resolvers.ts --days=7
 *   tsx apps/api/scripts/shadow-compare-resolvers.ts --show-mismatches=20
 *   tsx apps/api/scripts/shadow-compare-resolvers.ts --write-report
 *   tsx apps/api/scripts/shadow-compare-resolvers.ts --limit=500
 *
 * NB: Operator runs this. The agent that built this harness does NOT
 * run it — Rule 5 ledger-shape safety.
 */

import { Client } from "pg";
import { config as dotenv } from "dotenv";
import { resolve as resolvePath } from "node:path";
import { writeFileSync } from "node:fs";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient as NodePrismaClient } from "../../../prisma/generated/node-client/client";
import type { PrismaClient as EdgePrismaClient } from "../src/generated/prisma/client";
import {
  loadAgreementContext,
} from "../src/lib/agreement/persist";
import { resolveBillingLines } from "../src/lib/agreement/resolve";
import { resolveTariffChainForSession } from "../src/lib/tariff/resolve-tariff-chain";
import { computeSessionCost } from "../src/lib/tariff/compute-session-cost";

// The two Prisma client generations (Edge for the Worker runtime, Node
// for tsx scripts) are structurally identical for the queries this
// script touches but TypeScript treats them as nominally distinct.
// We construct the Node client at runtime (only one that works under
// node-pg in tsx) and bridge it to the Edge-typed entrypoints in
// src/lib/agreement/* and src/lib/tariff/* via a single boundary cast.
// This cast is the ONLY place we lie about the type; downstream code
// stays fully typed.
type PrismaForResolvers = EdgePrismaClient;
import {
  emptyHistogram,
  shadowCompare,
  tallyResult,
  type ShadowComparisonResult,
  type ShadowHistogram,
} from "../src/lib/billing-shadow/shadow-compare";

dotenv({ path: resolvePath(process.cwd(), "../../.env.local") });

// ── CLI args ──────────────────────────────────────────────────────────

function parseFlag(name: string, fallback: number): number {
  const arg = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (!arg) return fallback;
  const n = Number(arg.split("=")[1]);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`invalid --${name} value`);
  }
  return n;
}

const DAYS = parseFlag("days", 30);
const SHOW_MISMATCHES = parseFlag("show-mismatches", 10);
const ROW_LIMIT = parseFlag("limit", 1000);
const WRITE_REPORT = process.argv.includes("--write-report");

// ── DB row shape (raw pg pull) ────────────────────────────────────────

type LedgerInputRow = {
  session_id: string;
  org_id: string;
  site_id: string | null;
  charging_station_id: string | null;
  user_id: string | null;
  started_at: Date;
  ended_at: Date | null;
  energy_wh: string; // numeric → string from node-pg
  cost_isk_minor: string; // bigint → string from node-pg
};

// ── Main ──────────────────────────────────────────────────────────────

(async () => {
  console.log("");
  console.log("══════════════════════════════════════════════════════════════════");
  console.log("  SHADOW RESOLVER COMPARISON — Sprint 9 CO-3");
  console.log("══════════════════════════════════════════════════════════════════");
  console.log(`  window:           last ${DAYS} day(s)`);
  console.log(`  row cap:          ${ROW_LIMIT}`);
  console.log(`  show mismatches:  top ${SHOW_MISMATCHES} by |delta|`);
  console.log(`  write report:     ${WRITE_REPORT ? "yes" : "no"}`);
  console.log("");

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL not set — check ../../.env.local");
  }

  const pg = new Client({ connectionString });
  await pg.connect();

  const adapter = new PrismaPg({ connectionString });
  const nodePrisma = new NodePrismaClient({ adapter });
  // Boundary cast — see note above the type definition.
  const prisma = nodePrisma as unknown as PrismaForResolvers;

  // 1. Pull last-N-days of priced sessions. We join charging.sessions
  // so we can get the userId (which session_ledger doesn't carry as a
  // raw column we can reliably trust — driverUserId in session_ledger
  // is denormalised at write time; the new resolver needs the
  // ChargeSession.userId from enrichment). We restrict to sessions
  // that have:
  //   • cost_isk_minor not null (already priced by legacy)
  //   • a userId (new resolver requires it)
  //   • ended_at not null and energy_wh not null (new resolver
  //     requires both)
  const sessionsQuery = `
    select
      sl.session_id,
      sl.org_id,
      sl.site_id,
      sl.charging_station_id,
      cs.user_id,
      cs.started_at,
      cs.ended_at,
      cs.energy_wh::text as energy_wh,
      sl.cost_isk_minor::text as cost_isk_minor
    from reports.session_ledger sl
    join charging.sessions cs on cs.id = sl.session_id
    where sl.cost_isk_minor is not null
      and cs.ended_at is not null
      and cs.energy_wh is not null
      and cs.user_id is not null
      and sl.started_at > now() - ($1::int * interval '1 day')
    order by sl.started_at desc
    limit $2::int
  `;

  const rowsRes = await pg.query<LedgerInputRow>(sessionsQuery, [DAYS, ROW_LIMIT]);
  const rows = rowsRes.rows;
  console.log(`fetched ${rows.length} priced session(s) for comparison`);

  if (rows.length === 0) {
    console.log("\nNo priced sessions in window — nothing to compare.");
    await pg.end();
    await nodePrisma.$disconnect();
    return;
  }

  // 2. Walk each session and run BOTH resolvers.
  let histogram: ShadowHistogram = emptyHistogram();
  const allResults: ShadowComparisonResult[] = [];
  const legacySanityFailures: Array<{
    sessionId: string;
    ledger: bigint;
    rerun: bigint | null;
    note: string;
  }> = [];

  for (const row of rows) {
    const sessionId = row.session_id;
    const legacyLedgerCost = BigInt(row.cost_isk_minor);

    // 2a. Sanity-check the legacy path (re-run vs ledger). If the
    // re-run fails (missing tariff, etc.), we still proceed — the
    // ledger figure IS the legacy resolver's output of record. We
    // just note the discrepancy for the operator.
    let legacyRerunCost: bigint | null = null;
    try {
      if (!row.site_id || !row.charging_station_id) {
        throw new Error("ledger row missing site_id or charging_station_id");
      }
      const chain = await resolveTariffChainForSession(prisma, {
        siteId: row.site_id,
        chargingStationId: row.charging_station_id,
      });
      const breakdown = computeSessionCost(
        {
          startedAt: row.started_at,
          stoppedAt: row.ended_at!,
          energyKwh: Number(row.energy_wh) / 1000,
        },
        chain,
      );
      legacyRerunCost = breakdown.totalIncVatMinor;
      if (legacyRerunCost !== legacyLedgerCost) {
        legacySanityFailures.push({
          sessionId,
          ledger: legacyLedgerCost,
          rerun: legacyRerunCost,
          note: "legacy rerun != ledger (tariff config drift?)",
        });
      }
    } catch (err) {
      legacySanityFailures.push({
        sessionId,
        ledger: legacyLedgerCost,
        rerun: null,
        note: err instanceof Error ? err.message : String(err),
      });
    }

    // 2b. Run the new resolver via the shadow comparator. We compute
    // BigInt totals from BillingLineDraft[] using amountIncVatMinor.
    const startedAt = row.started_at;
    const endedAt = row.ended_at!;
    const durationMs = Math.max(0, endedAt.getTime() - startedAt.getTime());
    const durationMinutes = durationMs / 60_000;
    const durationDays = durationMs / (1000 * 60 * 60 * 24);
    const energyKwh = Number(row.energy_wh) / 1000;

    const result = await shadowCompare({
      sessionId,
      legacyCostMinor: legacyLedgerCost,
      getNewCost: async () => {
        if (!row.user_id || !row.charging_station_id) return null;
        const ctxResult = await loadAgreementContext(prisma, {
          userId: row.user_id,
          chargingStationId: row.charging_station_id,
          at: startedAt,
          energyKwh,
          durationMinutes,
          durationDays,
        });
        if (!ctxResult.granted) {
          // New resolver did not price this session — null means
          // "new_resolver_failed" with reason carried via the throw
          // we generate, so the histogram surfaces it.
          throw new Error(`agreement_denied:${ctxResult.reason}`);
        }
        const lines = resolveBillingLines(ctxResult.ctx);
        if (lines.length === 0) {
          // Granted but no factor produced an output. Treat as null
          // so the histogram bucket is new_resolver_failed (the
          // comparator can't compare against an empty result).
          return null;
        }
        let total = 0n;
        for (const l of lines) total += l.amountIncVatMinor;
        return total;
      },
    });

    histogram = tallyResult(histogram, result);
    allResults.push(result);
  }

  // 3. Output histogram.
  console.log("");
  console.log("──────────────────────────────────────────────────────────────────");
  console.log("  HISTOGRAM");
  console.log("──────────────────────────────────────────────────────────────────");
  const pct = (n: number) => histogram.total > 0
    ? ((n / histogram.total) * 100).toFixed(1)
    : "0.0";
  console.log(`  match                  ${histogram.match.toString().padStart(6)}  ${pct(histogram.match).padStart(5)}%`);
  console.log(`  match_within_1_aurar   ${histogram.matchWithin1Aurar.toString().padStart(6)}  ${pct(histogram.matchWithin1Aurar).padStart(5)}%`);
  console.log(`  mismatch               ${histogram.mismatch.toString().padStart(6)}  ${pct(histogram.mismatch).padStart(5)}%`);
  console.log(`  new_resolver_failed    ${histogram.newResolverFailed.toString().padStart(6)}  ${pct(histogram.newResolverFailed).padStart(5)}%`);
  console.log(`  ─────────────────────────────────────`);
  console.log(`  TOTAL                  ${histogram.total.toString().padStart(6)}`);

  // 4. Worst mismatches by |delta|.
  const mismatches = allResults.filter(
    (r): r is Extract<ShadowComparisonResult, { kind: "mismatch" }> =>
      r.kind === "mismatch",
  );
  mismatches.sort((a, b) => {
    const da = a.delta < 0n ? -a.delta : a.delta;
    const db = b.delta < 0n ? -b.delta : b.delta;
    return db > da ? 1 : db < da ? -1 : 0;
  });

  if (mismatches.length > 0) {
    console.log("");
    console.log("──────────────────────────────────────────────────────────────────");
    console.log(`  TOP ${Math.min(SHOW_MISMATCHES, mismatches.length)} MISMATCHES (by |delta|)`);
    console.log("──────────────────────────────────────────────────────────────────");
    console.log("  sessionId                              legacy_kr     new_kr      delta_kr");
    for (const m of mismatches.slice(0, SHOW_MISMATCHES)) {
      const lkr = (Number(m.legacy) / 100).toFixed(2);
      const nkr = (Number(m.newCost) / 100).toFixed(2);
      const dkr = (Number(m.delta) / 100).toFixed(2);
      console.log(`  ${m.sessionId}  ${lkr.padStart(10)}  ${nkr.padStart(10)}  ${dkr.padStart(10)}`);
    }
  }

  // 5. New-resolver failure breakdown — group by error message.
  const failures = allResults.filter(
    (r): r is Extract<ShadowComparisonResult, { kind: "new_resolver_failed" }> =>
      r.kind === "new_resolver_failed",
  );
  if (failures.length > 0) {
    console.log("");
    console.log("──────────────────────────────────────────────────────────────────");
    console.log("  NEW RESOLVER FAILURES — by error");
    console.log("──────────────────────────────────────────────────────────────────");
    const byError = new Map<string, number>();
    for (const f of failures) {
      byError.set(f.error, (byError.get(f.error) ?? 0) + 1);
    }
    const sorted = Array.from(byError.entries()).sort((a, b) => b[1] - a[1]);
    for (const [err, n] of sorted) {
      console.log(`  ${n.toString().padStart(6)}  ${err}`);
    }
  }

  // 6. Legacy sanity check report.
  if (legacySanityFailures.length > 0) {
    console.log("");
    console.log("──────────────────────────────────────────────────────────────────");
    console.log("  LEGACY SANITY CHECK — re-run differs from ledger");
    console.log("──────────────────────────────────────────────────────────────────");
    console.log(`  ${legacySanityFailures.length} of ${rows.length} sessions failed sanity re-run.`);
    console.log("  (This means the legacy resolver TODAY would compute differently");
    console.log("   from what's already in the ledger — typically a tariff config");
    console.log("   change since the original write. Surfaces here for awareness;");
    console.log("   does not affect the shadow comparison verdict above.)");
    for (const f of legacySanityFailures.slice(0, 5)) {
      const lkr = (Number(f.ledger) / 100).toFixed(2);
      const rkr = f.rerun === null ? "—" : (Number(f.rerun) / 100).toFixed(2);
      console.log(`  ${f.sessionId}  ledger=${lkr} rerun=${rkr}  (${f.note})`);
    }
    if (legacySanityFailures.length > 5) {
      console.log(`  ...and ${legacySanityFailures.length - 5} more.`);
    }
  }

  // 7. Optional report file.
  if (WRITE_REPORT) {
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const reportPath = resolvePath(
      process.cwd(),
      `../../docs/notes/2026-05-31-shadow-comparison-${ts}.md`,
    );
    const lines: string[] = [];
    lines.push(`# Shadow Resolver Comparison — ${new Date().toISOString()}`);
    lines.push("");
    lines.push(`Window: last ${DAYS} day(s); row cap: ${ROW_LIMIT}; rows compared: ${histogram.total}`);
    lines.push("");
    lines.push("## Histogram");
    lines.push("");
    lines.push("| Bucket | Count | % |");
    lines.push("|---|---|---|");
    lines.push(`| match | ${histogram.match} | ${pct(histogram.match)}% |`);
    lines.push(`| match_within_1_aurar | ${histogram.matchWithin1Aurar} | ${pct(histogram.matchWithin1Aurar)}% |`);
    lines.push(`| mismatch | ${histogram.mismatch} | ${pct(histogram.mismatch)}% |`);
    lines.push(`| new_resolver_failed | ${histogram.newResolverFailed} | ${pct(histogram.newResolverFailed)}% |`);
    lines.push("");
    if (mismatches.length > 0) {
      lines.push(`## Top ${Math.min(SHOW_MISMATCHES, mismatches.length)} mismatches (by |delta|)`);
      lines.push("");
      lines.push("| sessionId | legacy (kr) | new (kr) | delta (kr) |");
      lines.push("|---|---|---|---|");
      for (const m of mismatches.slice(0, SHOW_MISMATCHES)) {
        const lkr = (Number(m.legacy) / 100).toFixed(2);
        const nkr = (Number(m.newCost) / 100).toFixed(2);
        const dkr = (Number(m.delta) / 100).toFixed(2);
        lines.push(`| ${m.sessionId} | ${lkr} | ${nkr} | ${dkr} |`);
      }
      lines.push("");
    }
    if (failures.length > 0) {
      lines.push("## New-resolver failure breakdown");
      lines.push("");
      const byError = new Map<string, number>();
      for (const f of failures) byError.set(f.error, (byError.get(f.error) ?? 0) + 1);
      lines.push("| count | error |");
      lines.push("|---|---|");
      for (const [err, n] of Array.from(byError.entries()).sort((a, b) => b[1] - a[1])) {
        lines.push(`| ${n} | \`${err}\` |`);
      }
      lines.push("");
    }
    lines.push("---");
    lines.push("");
    lines.push("Generated by `apps/api/scripts/shadow-compare-resolvers.ts` — READ-ONLY harness.");
    writeFileSync(reportPath, lines.join("\n"), "utf8");
    console.log("");
    console.log(`report written: ${reportPath}`);
  }

  await pg.end();
  await prisma.$disconnect();
  console.log("");
})().catch((e) => {
  console.error("SHADOW COMPARE FAILED:", e);
  process.exit(1);
});
