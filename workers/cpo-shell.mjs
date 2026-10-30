import application from '../.open-next/worker.js';
import { createShellEdge } from './cpo-shell-edge.mjs';

// Public surface: the exact-allow-list edge. Unchanged.
export default { fetch: createShellEdge(application) };

// Internal surface: a NAMED entrypoint, reachable only by a service binding that
// names it (see cpo-shell-engine.mjs). Not a route; not in any allow-list.
export { EngineEntrypoint } from './cpo-shell-engine.mjs';

// Durable Object class for the cross-instance version hub (binding VERSION_HUB, optional).
export { VersionHub } from './cpo-shell-hub.mjs';
