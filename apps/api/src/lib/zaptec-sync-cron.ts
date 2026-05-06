// Cron orchestration for Sprint 8.7/8.8 — walks every active Zaptec
// VendorCredential and runs both API-only writeback (sessions) and
// charger-status sync against the rolling 26h window. Idempotency at
// imported_cdr_refs lets us re-walk the recent past on every tick;
// the unique index drops duplicates.
//
// Steady-state cadence: the API Worker's */5 cron fires this. The
// 26h window catches sessions that finalised after the previous tick
// plus a 2h buffer for late-arriving Zaptec rows (their UI sometimes
// stamps EndDateTime well after the physical session ends).
//
// Sprint 8.14.1 — single OAuth grant per credential per tick.
// Earlier ticks ran sessions and status as two independent crons,
// each calling unsealAndAuth (which does its own OAuth password
// grant). Zaptec's /oauth/token endpoint blocks back-to-back grants
// from the same client (per integration memory), so whichever ran
// second got invalid_grant and its tick dropped. Now we acquire one
// access token per credential per tick and pass it to both syncs.
//
// Sprint 8.14.1 — per-installation chargehistory scoping.
// Zaptec's /api/chargehistory returns zero rows when called without
// an InstallationId or ChargerId filter (confirmed against staging
// 2026-05-05). The unfiltered call works for /api/chargers but not
// here. We now call listInstallations once and fan out one
// chargehistory call per installation. Each call is filtered by
// installationId, returning the actual session set for that
// installation.

import type { PrismaClient } from "../generated/prisma/client";
import { unsealAndAuth } from "../repositories/credential-management";
import { syncZaptecSessions } from "../repositories/zaptec-session-sync";
import { syncZaptecChargerStatus } from "../repositories/zaptec-charger-status-sync";
import { listInstallations } from "./zaptec";

const ROLLING_WINDOW_MS = 26 * 60 * 60 * 1000; // 26h — see header.

export interface CredentialSyncOutcome {
  credentialId: string;
  ownerOrgId: string;
  zaptecCount: number;
  importedCount: number;
  skippedCount: number;
  errorCount: number;
  installationsScanned: number;
  durationMs: number;
}

export interface CredentialSyncFailure {
  credentialId: string;
  error: string;
}

export interface CronSyncReport {
  ranAt: string;
  windowFromIso: string;
  windowToIso: string;
  credentials: number;
  outcomes: CredentialSyncOutcome[];
  failures: CredentialSyncFailure[];
  /** Sprint 8.14.1 — combined report includes the status cron's
   *  outcomes too, since both share an OAuth grant per credential. */
  status: {
    outcomes: ChargerStatusOutcome[];
    failures: CredentialSyncFailure[];
  };
}

export interface ChargerStatusOutcome {
  credentialId: string;
  zaptecCount: number;
  updatedCount: number;
  skippedCount: number;
  durationMs: number;
}

export interface ChargerStatusCronReport {
  ranAt: string;
  credentials: number;
  outcomes: ChargerStatusOutcome[];
  failures: CredentialSyncFailure[];
}

/**
 * Combined per-tick orchestrator. Runs both sessions writeback and
 * charger-status sync under a single OAuth grant per credential. The
 * old runZaptecChargerStatusCron is kept exported below for the
 * scheduled handler's backwards compatibility but now delegates to
 * a noop — the status work happens inside runZaptecCronSync.
 */
export async function runZaptecCronSync(
  db: PrismaClient,
  kek: string,
): Promise<CronSyncReport> {
  const ranAt = new Date();
  const windowFrom = new Date(ranAt.getTime() - ROLLING_WINDOW_MS);
  const fromIso = windowFrom.toISOString();
  const toIso = ranAt.toISOString();

  const credentials = await db.vendorCredential.findMany({
    where: {
      status: "active",
      vendor: { slug: "zaptec" },
    },
    select: { id: true },
  });

  const sessionOutcomes: CredentialSyncOutcome[] = [];
  const sessionFailures: CredentialSyncFailure[] = [];
  const statusOutcomes: ChargerStatusOutcome[] = [];
  const statusFailures: CredentialSyncFailure[] = [];

  for (const cred of credentials) {
    const sessionStartedAt = Date.now();
    let auth: Awaited<ReturnType<typeof unsealAndAuth>>;
    try {
      auth = await unsealAndAuth(db, kek, cred.id);
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      sessionFailures.push({ credentialId: cred.id, error });
      statusFailures.push({ credentialId: cred.id, error });
      continue;
    }

    // ── Sessions sync, fanned out per installation ──────────────
    try {
      const installsResp = await listInstallations(auth.accessToken);
      let totalZaptec = 0;
      let totalImported = 0;
      let totalSkipped = 0;
      let totalErrors = 0;
      let installationsScanned = 0;
      const collectedErrors: Array<{
        zaptecId: string;
        code: string;
        detail: string;
      }> = [];

      if (!installsResp.ok) {
        throw new Error(
          `zaptec_installations_fetch_failed: ${JSON.stringify(installsResp.error)}`,
        );
      }

      for (const inst of installsResp.value) {
        if (!inst.Id) continue;
        const result = await syncZaptecSessions(db, {
          accessToken: auth.accessToken,
          installationId: inst.Id,
          from: fromIso,
          to: toIso,
        });
        installationsScanned++;
        totalZaptec += result.zaptecCount;
        totalImported += result.imported.length;
        totalSkipped += result.skipped.length;
        totalErrors += result.errors.length;
        if (result.errors.length > 0) {
          for (const e of result.errors.slice(0, 3)) collectedErrors.push(e);
        }
      }

      sessionOutcomes.push({
        credentialId: cred.id,
        ownerOrgId: auth.ownerOrgId,
        zaptecCount: totalZaptec,
        importedCount: totalImported,
        skippedCount: totalSkipped,
        errorCount: totalErrors,
        installationsScanned,
        durationMs: Date.now() - sessionStartedAt,
      });
      if (collectedErrors.length > 0) {
        console.warn("[zaptec-sync-cron] partial errors", {
          credentialId: cred.id,
          errors: collectedErrors.slice(0, 5),
        });
      }
    } catch (err) {
      sessionFailures.push({
        credentialId: cred.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    // ── Charger status, reusing the same access token ───────────
    const statusStartedAt = Date.now();
    try {
      const result = await syncZaptecChargerStatus(db, {
        accessToken: auth.accessToken,
      });
      statusOutcomes.push({
        credentialId: cred.id,
        zaptecCount: result.zaptecCount,
        updatedCount: result.updated.length,
        skippedCount: result.skipped.length,
        durationMs: Date.now() - statusStartedAt,
      });
    } catch (err) {
      statusFailures.push({
        credentialId: cred.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return {
    ranAt: ranAt.toISOString(),
    windowFromIso: fromIso,
    windowToIso: toIso,
    credentials: credentials.length,
    outcomes: sessionOutcomes,
    failures: sessionFailures,
    status: {
      outcomes: statusOutcomes,
      failures: statusFailures,
    },
  };
}

/**
 * Backwards-compatible no-op so the old scheduled() block still
 * compiles. The combined runZaptecCronSync now does both pieces;
 * this function reports a "skipped — folded into runZaptecCronSync"
 * outcome shape so any caller still wiring it up sees zero work
 * happening here. Remove after the index.ts cron block is updated
 * to call only runZaptecCronSync.
 */
export async function runZaptecChargerStatusCron(
  _db: PrismaClient,
  _kek: string,
): Promise<ChargerStatusCronReport> {
  return {
    ranAt: new Date().toISOString(),
    credentials: 0,
    outcomes: [],
    failures: [],
  };
}

/**
 * Sessions-only sync — Sprint 9.1. Runs every minute on the four
 * non-multiple-of-5 ticks per cycle (1, 2, 3, 4, 6, 7, ...); the full
 * runZaptecCronSync still fires at minute 0, 5, 10, ... and includes
 * sessions. Cost: 1 OAuth + N installations x /chargehistory per
 * credential per minute. Skips the per-charger /state sweep entirely
 * so we keep the API budget close to current.
 *
 * Why this exists: AMQP catches active-session signals within seconds
 * for chargers connected to Zaptec's Service Bus, but offline /
 * non-AMQP chargers only update via cron. Bumping sessions to once
 * per minute means /charge-log and the technical-read history block
 * reflect in-progress sessions roughly every minute regardless of
 * whether AMQP can reach the charger.
 */
export async function runZaptecSessionsOnlyCron(
  db: PrismaClient,
  kek: string,
): Promise<CronSyncReport> {
  const ranAt = new Date();
  const windowFrom = new Date(ranAt.getTime() - ROLLING_WINDOW_MS);
  const fromIso = windowFrom.toISOString();
  const toIso = ranAt.toISOString();

  const credentials = await db.vendorCredential.findMany({
    where: { status: "active", vendor: { slug: "zaptec" } },
    select: { id: true },
  });

  const sessionOutcomes: CredentialSyncOutcome[] = [];
  const sessionFailures: CredentialSyncFailure[] = [];

  for (const cred of credentials) {
    const sessionStartedAt = Date.now();
    let auth: Awaited<ReturnType<typeof unsealAndAuth>>;
    try {
      auth = await unsealAndAuth(db, kek, cred.id);
    } catch (err) {
      sessionFailures.push({
        credentialId: cred.id,
        error: err instanceof Error ? err.message : String(err),
      });
      continue;
    }

    try {
      const installsResp = await listInstallations(auth.accessToken);
      if (!installsResp.ok) {
        throw new Error(
          `zaptec_installations_fetch_failed: ${JSON.stringify(installsResp.error)}`,
        );
      }
      let totalZaptec = 0;
      let totalImported = 0;
      let totalSkipped = 0;
      let totalErrors = 0;
      let installationsScanned = 0;
      for (const inst of installsResp.value) {
        if (!inst.Id) continue;
        const result = await syncZaptecSessions(db, {
          accessToken: auth.accessToken,
          installationId: inst.Id,
          from: fromIso,
          to: toIso,
        });
        installationsScanned++;
        totalZaptec += result.zaptecCount;
        totalImported += result.imported.length;
        totalSkipped += result.skipped.length;
        totalErrors += result.errors.length;
      }
      sessionOutcomes.push({
        credentialId: cred.id,
        ownerOrgId: auth.ownerOrgId,
        zaptecCount: totalZaptec,
        importedCount: totalImported,
        skippedCount: totalSkipped,
        errorCount: totalErrors,
        installationsScanned,
        durationMs: Date.now() - sessionStartedAt,
      });
    } catch (err) {
      sessionFailures.push({
        credentialId: cred.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return {
    ranAt: ranAt.toISOString(),
    windowFromIso: fromIso,
    windowToIso: toIso,
    credentials: credentials.length,
    outcomes: sessionOutcomes,
    failures: sessionFailures,
    status: { outcomes: [], failures: [] },
  };
}
