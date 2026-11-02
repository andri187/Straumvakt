import { describe, expect, it, vi } from 'vitest';
import { realtimeUpgrade } from '../workers/cpo-shell-realtime.mjs';
import { createShellSession, SHELL_COOKIE_NAME } from '../src/lib/cpo-shell-session.ts';
import { HUB_INSTANCE } from '../src/lib/sync/live.ts';
import { mintDriverToken } from '../apps/api/src/lib/driver-session.ts';

const config = { username: 'local-test', password: 'local-only-fixture', secret: 'not-a-real-secret-local-test-fixture-12345' };
const id = '00000000-0000-4000-8000-000000000001';
const OTHER = '00000000-0000-4000-8000-000000000002';
const DEVICE = 'dddddddd-0000-4000-8000-000000000001';
const USER = 'eeeeeeee-0000-4000-8000-000000000001';
const DRIVER_SECRET = 'local-test-driver-secret-0123456789abcdef';
const ORIGIN = 'https://www.straumvakt.org';

/** A hub whose room stub records what it was asked and whose shell stub answers gate/read like the real one. */
function hubWith({ ids = [id], gateAllow = true } = {}) {
  const room = vi.fn(async () => new Response('fixture'));
  const shell = { read: async () => ({ ids, versions: {}, ageMs: 10 }), gate: vi.fn(async () => ({ allow: gateAllow, retryAfterMs: 30_000, ageMs: 0 })) };
  const named = [];
  const VERSION_HUB = { idFromName: (n) => { named.push(n); return n; }, get: (n) => (n === HUB_INSTANCE ? shell : { fetch: room }) };
  return { VERSION_HUB, room, shell, named };
}
const baseEnv = (hub, extra = {}) => ({ ...hub, CPO_SHELL_REALTIME_ENABLED: 'true', CPO_SHELL_USERNAME: config.username, CPO_SHELL_PASSWORD: config.password, CPO_SHELL_SESSION_SECRET: config.secret, ...extra });
const opReq = async (now, installation = id, headers = {}) => new Request(`${ORIGIN}/api/cpo/sync?installation=${installation}`, { headers: { upgrade: 'websocket', origin: ORIGIN, cookie: `${SHELL_COOKIE_NAME}=${await createShellSession(config, Math.floor(now / 1000))}`, ...headers } });

describe('realtime operator access', () => {
  it('uses the hub instance name the rest of the code uses', () => {
    expect(HUB_INSTANCE).toBe('shell');
  });

  it('denies disabled, unauthenticated and cross-origin attempts before any room is reached', async () => {
    const h = hubWith();
    const env = baseEnv(h.VERSION_HUB ? h : h);
    const request = new Request(`${ORIGIN}/api/cpo/sync?installation=${id}`, { headers: { upgrade: 'websocket', origin: ORIGIN } });
    expect((await realtimeUpgrade(request, { ...env, CPO_SHELL_REALTIME_ENABLED: 'false' })).status).toBe(503);
    expect((await realtimeUpgrade(request, env)).status).toBe(401);
    const foreign = new Request(request, { headers: { upgrade: 'websocket', origin: 'https://other.example' } });
    expect((await realtimeUpgrade(foreign, env)).status).toBe(403);
    expect(h.room).not.toHaveBeenCalled();
  });

  it('passes only a bounded scope lease and role, never a cookie or password; expired credentials cannot renew', async () => {
    const now = Date.now();
    const h = hubWith();
    const env = baseEnv(h);
    const req = await opReq(now);
    expect((await realtimeUpgrade(req, env, now)).status).toBe(200);
    const forwarded = h.room.mock.calls[0][0];
    expect(forwarded.headers.get('cookie')).toBeNull();
    expect(forwarded.headers.get('x-role')).toBe('operator');
    expect(forwarded.headers.get('x-driver-devices')).toBeNull();
    const until = Number(forwarded.headers.get('x-lease-until'));
    expect(until).toBeGreaterThan(now + 55000);
    expect(until).toBeLessThanOrEqual(now + 60000);
    expect(forwarded.headers.get('x-installation')).toBe(id);
    expect((await realtimeUpgrade(req, env, now + 9 * 3600000)).status).toBe(401);
    expect(h.room).toHaveBeenCalledTimes(1);
  });

  it('refuses an installation that does not exist, so a guessed id cannot create a room; the hub list answers without a database read', async () => {
    const now = Date.now();
    const h = hubWith({ ids: [id] });
    const env = baseEnv(h);
    const unknown = vi.fn(async () => false);
    expect((await realtimeUpgrade(await opReq(now, OTHER), env, now, { operatorVisible: unknown })).status).toBe(404);
    expect(unknown).toHaveBeenCalledTimes(1);
    expect(h.room).not.toHaveBeenCalled();
    // A listed installation is accepted by the default check from the hub list alone (no DATABASE_URL here, so a database read would fail).
    expect((await realtimeUpgrade(await opReq(now), env, now)).status).toBe(200);
  });

  it('is bounded per subject across isolates: the shared gate can refuse before a room is touched', async () => {
    const now = Date.now();
    const h = hubWith({ gateAllow: false });
    const res = await realtimeUpgrade(await opReq(now), baseEnv(h), now);
    expect(res.status).toBe(429);
    expect(res.headers.get('retry-after')).toBe('30');
    expect(h.room).not.toHaveBeenCalled();
  });
});

describe('realtime driver access', () => {
  const driverStore = (grants) => async () => ({ grants: async (userId) => (userId === USER ? grants : []) });
  const GRANT = [{ installationId: id, devices: { [DEVICE]: [1] } }];
  const token = async (over = {}) => (await mintDriverToken(DRIVER_SECRET, { userId: USER, email: 'd@example.test', kind: 'access', ...over })).token;
  const drvReq = async (installation, headers = {}) => new Request(`https://www.straumvakt.org/api/cpo/sync${installation ? `?installation=${installation}` : ''}`, { headers: { authorization: `Bearer ${await token()}`, ...(installation ? { upgrade: 'websocket' } : {}), ...headers } });

  it('is off without the driver secret, and a cookie-less bearer request never falls through to operator access', async () => {
    const h = hubWith();
    const res = await realtimeUpgrade(await drvReq(id), baseEnv(h), Date.now(), { driverStore: driverStore(GRANT) });
    expect(res.status).toBe(503);
    expect(h.room).not.toHaveBeenCalled();
  });

  it('401 for a forged, expired, wrong-kind or operator-signed token; the room is never reached', async () => {
    const h = hubWith();
    const env = baseEnv(h, { DRIVER_AUTH_SECRET: DRIVER_SECRET });
    const bad = [
      'x.y', `${(await token()).split('.')[0]}.AAAA`,
      (await mintDriverToken('another-secret-another-secret-123456', { userId: USER, email: 'd@e.t', kind: 'access' })).token,
      (await mintDriverToken(DRIVER_SECRET, { userId: USER, email: 'd@e.t', kind: 'refresh' })).token,
    ];
    for (const t of bad) {
      const r = new Request(`${ORIGIN}/api/cpo/sync?installation=${id}`, { headers: { authorization: `Bearer ${t}`, upgrade: 'websocket' } });
      expect((await realtimeUpgrade(r, env, Date.now(), { driverStore: driverStore(GRANT) })).status).toBe(401);
    }
    const expired = await drvReq(id);
    expect((await realtimeUpgrade(expired, env, Date.now() + 2 * 3600_000, { driverStore: driverStore(GRANT) })).status).toBe(401);
    expect(h.room).not.toHaveBeenCalled();
  });

  it('403 when the driver has no open session, or asks for an installation they have no session at', async () => {
    const h = hubWith();
    const env = baseEnv(h, { DRIVER_AUTH_SECRET: DRIVER_SECRET });
    expect((await realtimeUpgrade(await drvReq(id), env, Date.now(), { driverStore: driverStore([]) })).status).toBe(403);
    expect((await realtimeUpgrade(await drvReq(OTHER), env, Date.now(), { driverStore: driverStore(GRANT) })).status).toBe(403);
    expect(h.room).not.toHaveBeenCalled();
  });

  it('503 (not a guess) when identity data cannot be read', async () => {
    const h = hubWith();
    const env = baseEnv(h, { DRIVER_AUTH_SECRET: DRIVER_SECRET });
    expect((await realtimeUpgrade(await drvReq(id), env, Date.now(), { driverStore: driverStore(null) })).status).toBe(503);
  });

  it('lists only the installation ids the driver may follow, never devices or structure', async () => {
    const h = hubWith();
    const env = baseEnv(h, { DRIVER_AUTH_SECRET: DRIVER_SECRET });
    const res = await realtimeUpgrade(await drvReq(null), env, Date.now(), { driverStore: driverStore(GRANT) });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ installations: [{ installationId: id }] });
  });

  it('opens the room with a driver grant: own device and connector only, bounded lease, no bearer token forwarded', async () => {
    const now = Date.now();
    const h = hubWith();
    const env = baseEnv(h, { DRIVER_AUTH_SECRET: DRIVER_SECRET });
    // No Origin header: a native app has none, and a bearer token is not ambient so a same-origin rule would only break it.
    expect((await realtimeUpgrade(await drvReq(id), env, now, { driverStore: driverStore(GRANT) })).status).toBe(200);
    const forwarded = h.room.mock.calls[0][0];
    expect(forwarded.headers.get('authorization')).toBeNull();
    expect(forwarded.headers.get('x-role')).toBe('driver');
    expect(JSON.parse(forwarded.headers.get('x-driver-devices'))).toEqual({ [DEVICE]: [1] });
    const until = Number(forwarded.headers.get('x-lease-until'));
    expect(until).toBeLessThanOrEqual(now + 60000);
    expect(until).toBeGreaterThan(now);
  });

  it('a driver is bounded by the shared gate too', async () => {
    const h = hubWith({ gateAllow: false });
    const res = await realtimeUpgrade(await drvReq(id), baseEnv(h, { DRIVER_AUTH_SECRET: DRIVER_SECRET }), Date.now(), { driverStore: driverStore(GRANT) });
    expect(res.status).toBe(429);
    expect(h.room).not.toHaveBeenCalled();
  });
});
