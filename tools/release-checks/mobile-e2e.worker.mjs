// Test wrapper for tools/release-checks/mobile-e2e.mjs. Runs the REAL edge module (workers/cpo-shell-realtime.mjs: driver bearer token
// verification, grant -> room headers, per-subject gate) in front of the REAL Durable Object class, with ONLY the identity-data
// read replaced by a fixture (a map of user -> grants), because there is no database here. Never deployed.
import { mintDriverToken } from '../../apps/api/src/lib/driver-session.ts';
import { realtimeUpgrade } from '../../workers/cpo-shell-realtime.mjs';
export { VersionHub } from '../../workers/cpo-shell-hub.mjs';

const INST = '22222222-2222-4222-8222-222222222222';
const DEV = '33333333-3333-4333-8333-333333333333';
const USER_WITH_SESSION = 'eeeeeeee-0000-4000-8000-000000000001';
const USER_WITHOUT = 'eeeeeeee-0000-4000-8000-000000000002';
const grants = new Map([[USER_WITH_SESSION, [{ installationId: INST, devices: { [DEV]: [1] } }]]]);

const room = (env) => env.VERSION_HUB.get(env.VERSION_HUB.idFromName('live:' + INST));
const device = (revision, powerW, extra = {}) => ({
  schema: 1, orgId: '11111111-1111-4111-8111-111111111111', installationId: INST, deviceId: DEV, placementId: '44444444-4444-4444-8444-444444444444', generation: 1, revision,
  observedAt: Date.now(), online: true, onlineUntil: Date.now() + 90000, connectors: { '1': { status: 'Charging', errorCode: 'NoError', powerW, energyWh: 4100 } }, ...extra,
});

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/cpo/sync') {
      return realtimeUpgrade(request, env, Date.now(), { driverStore: async () => ({ grants: async (userId) => grants.get(userId) ?? [] }) });
    }
    if (url.pathname === '/__token') {
      const userId = url.searchParams.get('user') === 'none' ? USER_WITHOUT : USER_WITH_SESSION;
      return Response.json(await mintDriverToken(env.DRIVER_AUTH_SECRET, { userId, email: 'driver@example.test', kind: 'access' }));
    }
    if (url.pathname === '/__publish') {
      const { revision, powerW } = await request.json();
      return Response.json(await room(env).publishLive(device(revision, powerW)));
    }
    if (url.pathname === '/__remove') return Response.json(await room(env).reconcileLive(INST, []));
    return new Response('not found', { status: 404 });
  },
};
