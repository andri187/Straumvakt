import { describe, expect, it, vi } from 'vitest';
import { realtimeUpgrade } from '../workers/cpo-shell-realtime.mjs';
import { createShellSession, SHELL_COOKIE_NAME } from '../src/lib/cpo-shell-session.ts';
const config = { username: 'local-test', password: 'local-only-fixture', secret: 'not-a-real-secret-local-test-fixture-12345' };
const id = '00000000-0000-4000-8000-000000000001';
describe('realtime operator access', () => {
  it('denies disabled, unauthenticated and cross-origin attempts before the hub is reached', async () => {
    const get = vi.fn();
    const env = { VERSION_HUB: { get }, CPO_SHELL_REALTIME_ENABLED: 'true', CPO_SHELL_USERNAME: config.username, CPO_SHELL_PASSWORD: config.password, CPO_SHELL_SESSION_SECRET: config.secret };
    const request = new Request(`https://www.straumvakt.org/api/cpo/sync?installation=${id}`, { headers: { upgrade: 'websocket', origin: 'https://www.straumvakt.org' } });
    expect((await realtimeUpgrade(request, { ...env, CPO_SHELL_REALTIME_ENABLED: 'false' })).status).toBe(503);
    expect((await realtimeUpgrade(request, env)).status).toBe(401);
    const foreign = new Request(request, { headers: { upgrade: 'websocket', origin: 'https://other.example' } });
    expect((await realtimeUpgrade(foreign, env)).status).toBe(403);
    expect(get).not.toHaveBeenCalled();
  });
  it('passes only a bounded scope lease, never a cookie or password; expired credentials cannot renew', async () => {
    const now = Date.now();
    const token = await createShellSession(config, Math.floor(now / 1000));
    const fetch = vi.fn(async () => new Response('fixture'));
    const get = vi.fn(() => ({ fetch }));
    const env = { VERSION_HUB: { get, idFromName: n => n }, CPO_SHELL_REALTIME_ENABLED: 'true', CPO_SHELL_USERNAME: config.username, CPO_SHELL_PASSWORD: config.password, CPO_SHELL_SESSION_SECRET: config.secret };
    const req = new Request(`https://www.straumvakt.org/api/cpo/sync?installation=${id}`, { headers: { upgrade: 'websocket', origin: 'https://www.straumvakt.org', cookie: `${SHELL_COOKIE_NAME}=${token}` } });
    await realtimeUpgrade(req, env, now);
    const forwarded = fetch.mock.calls[0][0];
    expect(forwarded.headers.get('cookie')).toBeNull();
    const until = Number(forwarded.headers.get('x-lease-until'));
    expect(until).toBeGreaterThan(now + 55000);
    expect(until).toBeLessThanOrEqual(now + 60000);
    expect(forwarded.headers.get('x-installation')).toBe(id);
    expect((await realtimeUpgrade(req, env, now + 9 * 3600000)).status).toBe(401);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
