import application from '../.open-next/worker.js';
import { createShellEdge } from './cpo-shell-edge.mjs';
import { createScheduledHandler } from './cpo-shell-recovery.mjs';

// Public surface: the exact-allow-list edge. Unchanged. `scheduled` is not a route: it runs only if the Worker config has
// a cron trigger (none ships) and the bounded recovery pass is enabled by CPO_SHELL_RECOVERY_ENABLED.
export default { fetch: createShellEdge(application), scheduled: createScheduledHandler() };

// Internal surface: a NAMED entrypoint, reachable only by a service binding that
// names it (see cpo-shell-engine.mjs). Not a route; not in any allow-list.
export { EngineEntrypoint } from './cpo-shell-engine.mjs';

// Durable Object class for the cross-instance version hub (binding VERSION_HUB, optional).
export { VersionHub } from './cpo-shell-hub.mjs';
