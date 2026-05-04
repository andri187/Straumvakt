// Cron orchestration for Sprint 8.7 — walks every active Zaptec
// VendorCredential and runs the API-only writeback against a rolling
// window. Idempotency at imported_cdr_refs lets us re-walk the
// recent past on every tick; the unique index drops duplicates.
//
// Steady-state cadence: the API Worker's */5 cron fires this. The
// 26h window catches sessions that finalised after the previous tick
// plus a 2h buffer for late-arriving Zaptec rows (their UI sometimes
// stamps EndDateTime well after the physical session ends).
//
// Cost concerns: each credential = one Zaptec OAuth grant + one
// ChargeHistory page (capped at 500 rows). At pilot scale (single-
// digit credentials) this fits comfortably in the cron handler's
// budget. If the pilot grows enough to push the cron past 30s we
// move this onto a dedicated queue + per-credential message.

import type { PrismaClient } from "../generated/prisma/client";
import { unsealAndAuth } from "../repositories/credential-management";
import { syncZaptecSessions } from "../repositories/zaptec-session-sync";

const ROLLING_WINDOW_MS = 26 * 60 * 60 * 1000; // 26h — see header.

export interface CredentialSyncOutcome {
  credentialId: string;
  ownerOrgId: string;
  zaptecCount: number;
  importedCount: number;
  skippedCount: number;
  errorCount: number;
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
}

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

  const outcomes: CredentialSyncOutcome[] = [];
  const failures: CredentialSyncFailure[] = [];

  for (const cred of credentials) {
    const startedAt = Date.now();
    try {
      const auth = await unsealAndAuth(db, kek, cred.id);
      const result = await syncZaptecSessions(db, {
        accessToken: auth.accessToken,
        from: fromIso,
        to: toIso,
      });
      outcomes.push({
        credentialId: cred.id,
        ownerOrgId: auth.ownerOrgId,
        zaptecCount: result.zaptecCount,
        importedCount: result.imported.length,
        skippedCount: result.skipped.length,
        errorCount: result.errors.length,
        durationMs: Date.now() - startedAt,
      });
      if (result.errors.length > 0) {
        console.warn("[zaptec-sync-cron] partial errors", {
          credentialId: cred.id,
          errors: result.errors.slice(0, 5),
        });
      }
    } catch (err) {
      failures.push({
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
    outcomes,
    failures,
  };
}
