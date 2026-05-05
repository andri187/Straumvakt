// Claim-check trigger client. When an AMQP message arrives, the
// listener calls triggerSync(chargerId) — we POST to the API
// Worker's /api/internal/zaptec-trigger-sync, which fetches the
// authoritative session payload via REST + DetailLevel=1 and runs
// the existing writeback.
//
// Per-charger debounce: many AMQP messages may arrive for the same
// charger within seconds (state updates, meter ticks, session-end
// signals). Re-triggering for each is wasteful — the chargehistory
// fetch is the same. We coalesce repeated triggers within a 30s
// window per charger.
//
// Failures are logged but not retried in Phase 2. Polling backstop
// (the */5 cron on the API Worker) catches anything we drop.

import { log } from "./logger.js";

const COOLDOWN_MS = 30 * 1000;

const lastTriggeredAt = new Map<string, number>();
const inflight = new Map<string, Promise<void>>();

export interface TriggerSyncOptions {
  apiBaseUrl: string;
  ingestSecret: string;
  /** ISO timestamp; defaults to 1h ago at the API side. */
  fromHint?: string;
}

export async function triggerSync(
  chargerId: string,
  options: TriggerSyncOptions,
): Promise<void> {
  // Debounce: skip if we've triggered for this charger within the
  // cooldown window. The pending fetch will catch the latest state
  // anyway since chargehistory returns whatever's complete at
  // fetch time.
  const last = lastTriggeredAt.get(chargerId);
  if (last !== undefined && Date.now() - last < COOLDOWN_MS) {
    return;
  }

  // Coalesce concurrent triggers — if a fetch is already in flight
  // for this charger, await it instead of starting another.
  const existing = inflight.get(chargerId);
  if (existing) return existing;

  const promise = doTrigger(chargerId, options).finally(() => {
    inflight.delete(chargerId);
    lastTriggeredAt.set(chargerId, Date.now());
  });
  inflight.set(chargerId, promise);
  return promise;
}

async function doTrigger(
  chargerId: string,
  options: TriggerSyncOptions,
): Promise<void> {
  const url = `${options.apiBaseUrl.replace(/\/+$/, "")}/api/internal/zaptec-trigger-sync`;
  const body = JSON.stringify({
    chargerId,
    ...(options.fromHint ? { fromHint: options.fromHint } : {}),
  });

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-straumvakt-ingest": options.ingestSecret,
      },
      body,
    });
  } catch (err) {
    log.warn("trigger_sync_network_error", {
      chargerId,
      error: err instanceof Error ? err.message : String(err),
    });
    return;
  }

  let json: unknown;
  try {
    json = await res.json();
  } catch {
    json = await res.text().catch(() => "");
  }

  if (res.status !== 200) {
    log.warn("trigger_sync_non_200", {
      chargerId,
      status: res.status,
      body: json,
    });
    return;
  }

  const result = json as {
    zaptecCount?: number;
    importedCount?: number;
    skippedCount?: number;
    errorCount?: number;
  };
  if ((result.importedCount ?? 0) > 0 || (result.errorCount ?? 0) > 0) {
    log.info("trigger_sync_outcome", {
      chargerId,
      zaptecCount: result.zaptecCount,
      imported: result.importedCount,
      skipped: result.skippedCount,
      errors: result.errorCount,
    });
  }
}
