// Scheduled entry of the CPO shell Worker: the bounded independent recovery pass.
//
// Not a route and not part of the public `fetch` surface. It runs only when Cloudflare invokes `scheduled`, which needs a
// cron trigger in the Worker config; the shipped config has NO cron, and the pass is additionally gated by the variable
// CPO_SHELL_RECOVERY_ENABLED ("true" enables it). Disabled means no database work at all.
//
// Kept in its own module so it can be tested without loading the generated OpenNext worker.
import { runScheduledRecovery } from '../src/lib/ocpp-engine/recovery-live.ts';

/** @param {(env: object) => Promise<object>} [run] injectable for tests */
export function createScheduledHandler(run = runScheduledRecovery) {
  return async function scheduled(_controller, env) {
    let report;
    try {
      report = await run(env);
    } catch {
      report = { status: 'unavailable', reason: 'database_error' };
    }
    // One aggregate line per pass: counts and timings only (no identifiers, payloads or errors).
    console.log(JSON.stringify({ recovery: report }));
    return report;
  };
}
