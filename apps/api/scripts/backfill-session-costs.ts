#!/usr/bin/env tsx
/**
 * backfill-session-costs.ts — P1 billing engine, step 2.
 *
 * Re-prices a driver's charge sessions from the SOURCE OF TRUTH
 * (charging.sessions.energy_wh × resolved tariff) and reconciles
 * reports.session_ledger to match. Runs the EXACT production cost path:
 *
 *   • resolveTariffChainWithIdsForSession  (Site→DSO + Installation→retailer)
 *   • computeSessionCost                    (BigInt aurar + VAT, pure)
 *
 * No new billing math — same engine the session.stopped projection uses.
 * This catches two classes of bad ledger state on pilot/imported data:
 *   1. sessions never costed (no ledger row)            → create
 *   2. sessions costed with a STALE/duplicated amount    → fix
 *      (e.g. a 1.1 kWh session carrying another session's 6.6 kWh cost)
 *
 * Per-session action:
 *   SAME   ledger already matches the engine        → no write
 *   FIX    ledger cost ≠ engine cost                 → upsert (--commit)
 *   CREATE no ledger row, energy > 0                 → upsert (--commit)
 *   skip-0 no ledger row, 0 kWh (not a real charge)  → no write
 *   SKIP   tariff unconfigured / missing location    → no write (logged)
 *
 * DRY-RUN BY DEFAULT — prints the plan, writes NOTHING. --commit applies.
 *
 * Rule 3 — --commit writes to whatever DATABASE_URL points at
 * (../../.env.local → staging Neon). The host is printed at startup; the
 * operator takes a Neon backup branch before committing.
 *
 * Usage:
 *   tsx apps/api/scripts/backfill-session-costs.ts                 # dry-run, driver@n1.is
 *   tsx apps/api/scripts/backfill-session-costs.ts --driver=foo@x  # dry-run, another driver
 *   tsx apps/api/scripts/backfill-session-costs.ts --commit        # WRITE reconciled rows
 */

import { config as dotenv } from "dotenv";
import { resolve as resolvePath } from "node:path";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient as NodePrismaClient } from "../prisma/generated/node-client/client";
import type { PrismaClient as EdgePrismaClient } from "../src/generated/prisma/client";
import {
  resolveTariffChainWithIdsForSession,
  TariffResolutionError,
} from "../src/lib/tariff/resolve-tariff-chain";
import {
  computeSessionCost,
  formatIskMinor,
} from "../src/lib/tariff/compute-session-cost";

dotenv({ path: resolvePath(process.cwd(), "../../.env.local") });

const DRIVER_EMAIL =
  process.argv.find((a) => a.startsWith("--driver="))?.split("=")[1] ?? "driver@n1.is";
const COMMIT = process.argv.includes("--commit");

function hostOf(url: string | undefined): string {
  if (!url) return "(unset)";
  try {
    return new URL(url).host;
  } catch {
    return "(unparseable)";
  }
}

(async () => {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL not set — check ../../.env.local");

  console.log("");
  console.log("══════════════════════════════════════════════════════════════════");
  console.log("  RECONCILE SESSION COSTS — P1 billing engine, step 2");
  console.log("══════════════════════════════════════════════════════════════════");
  console.log(`  mode:        ${COMMIT ? "COMMIT (writes ledger rows)" : "DRY-RUN (no writes)"}`);
  console.log(`  driver:      ${DRIVER_EMAIL}`);
  console.log(`  db host:     ${hostOf(connectionString)}`);
  console.log("");

  const adapter = new PrismaPg({ connectionString });
  const nodePrisma = new NodePrismaClient({ adapter });
  // Boundary cast — resolver entrypoints are typed against the Edge client;
  // the Node client is structurally identical for these queries.
  const prisma = nodePrisma as unknown as EdgePrismaClient;

  try {
    const user = await nodePrisma.user.findFirst({
      where: { email: DRIVER_EMAIL },
      select: { id: true, email: true },
    });
    if (!user) {
      console.log(`driver ${DRIVER_EMAIL} not found — nothing to do.`);
      return;
    }

    const sessions = await nodePrisma.chargeSession.findMany({
      where: { userId: user.id },
      orderBy: { startedAt: "asc" },
      select: {
        id: true,
        orgId: true,
        siteId: true,
        chargingStationId: true,
        userId: true,
        startedAt: true,
        endedAt: true,
        energyWh: true,
        ocppIdentity: { select: { identityString: true } },
        chargingStation: { select: { siteAsset: { select: { displayName: true } } } },
      },
    });

    const ledger = await nodePrisma.sessionLedger.findMany({
      where: { sessionId: { in: sessions.map((s) => s.id) } },
      select: { sessionId: true, costIskMinor: true },
    });
    const ledgerCost = new Map(ledger.map((l) => [l.sessionId, l.costIskMinor ?? null]));

    let storedTotal = 0n;
    let canonicalTotal = 0n;
    const counts = { SAME: 0, FIX: 0, CREATE: 0, "skip-0": 0, SKIP: 0 };

    for (const s of sessions) {
      const name = (s.chargingStation?.siteAsset?.displayName ?? "—").padEnd(9);
      const label = `${s.startedAt.toISOString().slice(5, 16).replace("T", " ")}  ${name}`;
      const energyKwh = s.energyWh != null ? Number(s.energyWh) / 1000 : 0;
      const hasRow = ledgerCost.has(s.id);
      const stored = ledgerCost.get(s.id) ?? null;
      if (stored != null) storedTotal += stored;

      // Re-price from source.
      if (!s.siteId || !s.chargingStationId) {
        counts.SKIP++;
        console.log(`  SKIP    ${label} ${energyKwh.toFixed(3)} kWh → missing_site_or_station`);
        continue;
      }
      let recomputed: bigint;
      let tariffId: string;
      try {
        const resolved = await resolveTariffChainWithIdsForSession(prisma, {
          siteId: s.siteId,
          chargingStationId: s.chargingStationId,
        });
        recomputed = computeSessionCost(
          { startedAt: s.startedAt, stoppedAt: s.endedAt ?? s.startedAt, energyKwh },
          resolved.chain,
        ).totalIncVatMinor;
        tariffId = resolved.dsoTariffDefinitionId;
      } catch (e) {
        if (e instanceof TariffResolutionError) {
          counts.SKIP++;
          console.log(`  SKIP    ${label} ${energyKwh.toFixed(3)} kWh → ${e.code}`);
          continue;
        }
        throw e;
      }
      canonicalTotal += recomputed;

      // Decide the action.
      let action: keyof typeof counts;
      if (!hasRow && recomputed === 0n) action = "skip-0";
      else if (!hasRow) action = "CREATE";
      else if (stored !== recomputed) action = "FIX";
      else action = "SAME";
      counts[action]++;

      const deltaNote =
        action === "FIX"
          ? `   (was ${formatIskMinor(stored ?? 0n)} → ${formatIskMinor(recomputed)})`
          : "";
      console.log(
        `  ${action.padEnd(7)} ${label} ${energyKwh.toFixed(3)} kWh → ${formatIskMinor(
          recomputed,
        ).padStart(11)}${deltaNote}`,
      );

      if (COMMIT && (action === "CREATE" || action === "FIX")) {
        const durationSec = s.endedAt
          ? Math.max(0, Math.round((s.endedAt.getTime() - s.startedAt.getTime()) / 1000))
          : null;
        const data = {
          orgId: s.orgId,
          siteId: s.siteId,
          chargingStationId: s.chargingStationId,
          driverUserId: s.userId,
          driverIdTag: s.ocppIdentity?.identityString ?? null,
          startedAt: s.startedAt,
          stoppedAt: s.endedAt,
          durationSec,
          energyKwh: energyKwh.toFixed(3),
          costIskMinor: recomputed,
          tariffDefinitionId: tariffId,
          verifiedSource: "reconciled",
          enrichmentStatus: "complete",
        };
        await nodePrisma.sessionLedger.upsert({
          where: { sessionId: s.id },
          create: { sessionId: s.id, ...data },
          update: data,
        });
      }
    }

    console.log("");
    console.log("──────────────────────────────────────────────────────────────────");
    console.log(
      `  ${sessions.length} session(s):  ${counts.SAME} same · ${counts.FIX} fix · ` +
        `${counts.CREATE} create · ${counts["skip-0"]} skip-0 · ${counts.SKIP} skip`,
    );
    console.log(`  stored ledger total:     ${formatIskMinor(storedTotal).padStart(12)}`);
    console.log(`  engine canonical total:  ${formatIskMinor(canonicalTotal).padStart(12)}`);
    const delta = canonicalTotal - storedTotal;
    console.log(
      `  delta:                   ${formatIskMinor(delta).padStart(12)}  ` +
        `(${delta < 0n ? "overcount removed" : delta > 0n ? "undercount added" : "no change"})`,
    );
    console.log(
      `  ${COMMIT ? "WROTE the FIX/CREATE rows above." : "DRY-RUN — nothing written. Re-run with --commit to apply."}`,
    );
    console.log("");
  } finally {
    await nodePrisma.$disconnect();
  }
})().catch((e) => {
  console.error("FAILED:", e);
  process.exit(1);
});
