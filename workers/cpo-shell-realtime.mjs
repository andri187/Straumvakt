import { readShellConfig, verifyShellSession } from '../src/lib/cpo-shell-session.ts';
import { readShellCookie } from '../src/lib/cpo-shell-policy.ts';
import { LIVE_LEASE_MS } from '../src/lib/ocpp-engine/live-projection.ts';
import { decideDriverAccess } from '../src/lib/sync/driver-live.ts';

// Reuse GET /api/cpo/sync; no new public route. Two kinds of subscriber, each authorized from its own credential:
//   operator  the signed platform-operator login cookie (browser; same-origin enforced, because a cookie is ambient).
//   driver    `Authorization: Bearer <driver access token>` (mobile app; no cookie, so no origin check applies). The driver gets
//             a MINIMAL projection of the device and connector of their own open session and nothing else (see live-fanout.ts).
// The lease is at most LIVE_LEASE_MS; the room closes the socket at the lease, so access never outlives the last verification.

const HUB_INSTANCE = 'shell'; // equals src/lib/sync/live.ts HUB_INSTANCE (asserted in the tests)
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const text = (body, status, extra = {}) => new Response(body, { status, headers: { 'cache-control': 'no-store', ...extra } });

/** Bounded attempts per subject per minute, shared by every isolate through the existing hub. A hub failure admits (the credential was verified). */
async function admitted(env, key) {
  try {
    const hub = env.VERSION_HUB.get(env.VERSION_HUB.idFromName(HUB_INSTANCE));
    return (await hub.gate(key, 60_000, 60)).allow !== false;
  } catch { return true; }
}

async function defaultOperatorVisible(env, installationId) {
  // The hub's installation list, whatever its age, answers membership without a database read; only an id it does not list
  // is checked against the database (one bounded query), so a guessed id can never create a room, and a brand-new
  // installation is still reachable before the list is refreshed.
  try {
    const reading = await env.VERSION_HUB.get(env.VERSION_HUB.idFromName(HUB_INSTANCE)).read();
    if (reading?.ids?.some((id) => id.toLowerCase() === installationId.toLowerCase())) return true;
  } catch { /* fall through to the authoritative read */ }
  const { withDb } = await import('../src/lib/installations/db.ts');
  const { loadRevisions } = await import('../src/lib/installations/drizzle-store.ts');
  const revisions = await withDb((db) => loadRevisions(db), env);
  return !!revisions && Object.keys(revisions).some((id) => id.toLowerCase() === installationId.toLowerCase());
}

async function defaultDriverStore(env) {
  const { openDb, readDatabaseUrl } = await import('../src/lib/installations/db.ts');
  const { drizzleDriverGrantStore } = await import('../src/lib/sync/driver-live.ts');
  const url = readDatabaseUrl(env);
  if (!url) return { grants: async () => null };
  return {
    async grants(userId, nowMs) {
      const { db, close } = openDb(url);
      try { return await drizzleDriverGrantStore(db).grants(userId, nowMs); } finally { await close(); }
    },
  };
}

function roomStub(env, installationId) {
  return env.VERSION_HUB.get(env.VERSION_HUB.idFromName(`live:${installationId.toLowerCase()}`));
}

async function openRoom(env, installationId, headers) {
  return roomStub(env, installationId).fetch(new Request('https://hub.internal/live', { headers: { upgrade: 'websocket', 'x-installation': installationId.toLowerCase(), ...headers } }));
}

/** @param {{operatorVisible?: Function, driverStore?: Function}} [deps] test seams; production uses the defaults above */
export async function realtimeUpgrade(request, env, now = Date.now(), deps = {}) {
  if (env.CPO_SHELL_REALTIME_ENABLED !== 'true' || !env.VERSION_HUB) return text('Live updates unavailable', 503);
  if (request.method !== 'GET') return text('Upgrade required', 426);
  const url = new URL(request.url);
  const isSocket = request.headers.get('upgrade')?.toLowerCase() === 'websocket';
  const bearer = /^Bearer\s+(\S{1,2048})$/i.exec(request.headers.get('authorization') ?? '')?.[1];
  const wanted = url.searchParams.get('installation');
  if (wanted !== null && !UUID.test(wanted)) return text('Bad scope', 400);

  if (bearer) {
    const secret = env.DRIVER_AUTH_SECRET;
    if (!secret) return text('Driver live updates unavailable', 503);
    const store = await (deps.driverStore ?? defaultDriverStore)(env);
    // Cheap pre-check on the token's own identity would need the same verification; the gate key is the token's hash prefix.
    const decision = await decideDriverAccess({ token: bearer, secret, wanted, nowMs: now, leaseMs: LIVE_LEASE_MS }, store);
    if (decision.kind === 'deny') return text(decision.status === 503 ? 'Live updates unavailable' : decision.status === 401 ? 'Unauthorized' : 'Forbidden', decision.status, decision.status === 503 ? { 'retry-after': '5' } : {});
    if (!(await admitted(env, `upgrade|driver|${decision.userId}`))) return text('Too many attempts', 429, { 'retry-after': '30' });
    if (decision.kind === 'grants') {
      return new Response(JSON.stringify({ installations: decision.grants.map((g) => ({ installationId: g.installationId })) }), { status: 200, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
    }
    if (!isSocket) return text('Upgrade required', 426);
    return openRoom(env, decision.grant.installationId, { 'x-role': 'driver', 'x-lease-until': String(decision.expiresAtMs), 'x-driver-devices': JSON.stringify(decision.grant.devices) });
  }

  if (!isSocket) return text('Upgrade required', 426);
  if (request.headers.get('origin') !== url.origin) return text('Forbidden', 403);
  if (!wanted) return text('Bad scope', 400);
  const config = readShellConfig(env);
  const session = config && await verifyShellSession(readShellCookie(request.headers.get('cookie')), config, Math.floor(now / 1000));
  if (!session) return text('Unauthorized', 401);
  if (!(await admitted(env, `upgrade|operator|${session.username ?? 'operator'}`))) return text('Too many attempts', 429, { 'retry-after': '30' });
  if (!(await (deps.operatorVisible ?? defaultOperatorVisible)(env, wanted))) return text('Not found', 404);
  // Share expiry wakes in five-second buckets instead of one distinct alarm deadline per viewer.
  const expiresAt = Math.min(Math.floor((now + LIVE_LEASE_MS) / 5000) * 5000, session.exp * 1000);
  return openRoom(env, wanted, { 'x-role': 'operator', 'x-lease-until': String(expiresAt) });
}
