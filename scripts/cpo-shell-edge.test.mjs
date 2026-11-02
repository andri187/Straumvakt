import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createShellEdge, PAGE_PATHS, PUBLIC_ASSET_PATHS, APP_PUBLIC_PATHS, API_PATHS } from '../workers/cpo-shell-edge.mjs';
import { pruneGeneratedAssets } from './prepare-cpo-shell-assets.mjs';
import { SHELL_PUBLIC_ASSETS, SHELL_DATA_APIS } from '../src/lib/cpo-shell-policy';
import { WORKSPACE_PATHS } from '../src/app/cpo/sections';

function setup(success = true) {
  const app = { fetch: vi.fn(async () => new Response('shell')) };
  const env = {
    ASSETS: { fetch: vi.fn(async () => new Response('asset')) },
    SHELL_LOGIN_LIMITER: { limit: vi.fn(async () => ({ success })) },
  };
  return { app, env, fetch: createShellEdge(app) };
}
describe('public shell deployment boundary', () => {
  it.each(['/', '/cpo/people?tab=invitations', '/signin'])('redirects bare-domain %s to canonical www without invoking the application', async pathname => {
    const s = setup();
    const response = await s.fetch(new Request(`https://straumvakt.org${pathname}`), s.env, {});
    expect(response.status).toBe(308);
    expect(response.headers.get('location')).toBe(`https://www.straumvakt.org${pathname}`);
    expect(s.app.fetch).not.toHaveBeenCalled();
    expect(s.env.ASSETS.fetch).not.toHaveBeenCalled();
  });
  it.each(['/concepts/admin.html', '/dso-lookup.html', '/data-model.svg', '/staff', '/api/admin/me', '/app/host', '/_next/image'])('blocks %s before app and asset lookup', async path => {
    const s = setup();
    expect((await s.fetch(new Request(`https://www.straumvakt.org${path}`), s.env, {})).status).toBe(404);
    expect(s.app.fetch).not.toHaveBeenCalled();
    expect(s.env.ASSETS.fetch).not.toHaveBeenCalled();
  });
  it.each(['/landing/straumvakt-car.png', '/landing/straumvakt-logo-full.png', '/landing/', '/landing/other.avif', '/landing/straumvakt-car.avif/extra', '/cpo/organisations/x', '/cpo/unknown'])('blocks %s', async p => {
    const s = setup();
    expect((await s.fetch(new Request(`https://www.straumvakt.org${p}`), s.env, {})).status).toBe(404);
    expect(s.app.fetch).not.toHaveBeenCalled();
    expect(s.env.ASSETS.fetch).not.toHaveBeenCalled();
  });
  it.each(['/landing/straumvakt-car.avif', '/landing/straumvakt-car.webp', '/landing/straumvakt-logo-icon.png'])('serves exact public asset %s from the asset binding', async p => {
    const s = setup();
    expect(await (await s.fetch(new Request(`https://www.straumvakt.org${p}`), s.env, {})).text()).toBe('asset');
    expect(s.app.fetch).not.toHaveBeenCalled();
  });
  it('serves the generated icon through the application, not the asset binding', async () => {
    const s = setup();
    expect(await (await s.fetch(new Request('https://www.straumvakt.org/icon.svg'), s.env, {})).text()).toBe('shell');
    expect(s.env.ASSETS.fetch).not.toHaveBeenCalled();
  });
  it('does not expose a favicon file that is not shipped', async () => {
    const s = setup();
    expect((await s.fetch(new Request('https://www.straumvakt.org/favicon.ico'), s.env, {})).status).toBe(404);
  });
  it.each(['/', '/signin', '/cpo', '/cpo/people', '/cpo/installations', '/cpo/chargers', '/cpo/sessions', '/cpo/costs', '/cpo/agreements', '/cpo/settings', '/cpo/organisations'])('passes page %s to the application', async p => {
    const s = setup();
    expect(await (await s.fetch(new Request(`https://www.straumvakt.org${p}`), s.env, {})).text()).toBe('shell');
    expect(s.env.ASSETS.fetch).not.toHaveBeenCalled();
  });
  it('passes a tab query to the application', async () => {
    const s = setup();
    expect(await (await s.fetch(new Request('https://www.straumvakt.org/cpo/people?tab=invitations'), s.env, {})).text()).toBe('shell');
  });
  it('serves only permitted assets through the asset binding', async () => {
    const s = setup();
    const response = await s.fetch(new Request('https://www.straumvakt.org/_next/static/chunk.js'), s.env, {});
    expect(await response.text()).toBe('asset');
    expect(s.app.fetch).not.toHaveBeenCalled();
  });
  it('passes pages to the authenticated application', async () => {
    const s = setup();
    const response = await s.fetch(new Request('https://www.straumvakt.org/cpo'), s.env, {});
    expect(await response.text()).toBe('shell');
    expect(response.headers.get('x-robots-tag')).toBe('noindex, nofollow');
  });
  it('throttles before attempting authentication', async () => {
    const s = setup(false);
    const response = await s.fetch(new Request('https://www.straumvakt.org/api/shell/login', { method: 'POST', headers: { 'cf-connecting-ip': '192.0.2.1', 'x-forwarded-for': 'spoofed' } }), s.env, {});
    expect(response.status).toBe(429);
    expect(s.env.SHELL_LOGIN_LIMITER.limit).toHaveBeenCalledWith({ key: 'shell-login:192.0.2.1' });
    expect(s.app.fetch).not.toHaveBeenCalled();
  });
  it('fails closed without the deployment limiter', async () => {
    const s = setup();
    delete s.env.SHELL_LOGIN_LIMITER;
    expect((await s.fetch(new Request('https://www.straumvakt.org/api/shell/login', { method: 'POST' }), s.env, {})).status).toBe(503);
  });
  it('keeps the edge allow lists identical to the application policy', () => {
    expect([...PUBLIC_ASSET_PATHS, ...APP_PUBLIC_PATHS].sort()).toEqual([...SHELL_PUBLIC_ASSETS].sort());
    expect([...PAGE_PATHS].sort()).toEqual(['/', '/signin', '/cpo/organisations', ...WORKSPACE_PATHS].sort());
    expect([...API_PATHS].sort()).toEqual(['/api/cpo/directory', '/api/cpo/installations', '/api/cpo/lifecycle', '/api/cpo/sync', '/api/shell/login', '/api/shell/logout']);
    expect(API_PATHS.every(p => p.startsWith('/api/shell/') || SHELL_DATA_APIS.includes(p))).toBe(true);
  });
  it('prunes generated assets to the exact public files and hashed static output', () => {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'cpo-assets-')));
    try {
      const put = rel => {
        fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
        fs.writeFileSync(path.join(root, rel), 'x');
      };
      for (const a of PUBLIC_ASSET_PATHS) put(a.slice(1));
      for (const extra of ['_next/static/a.js', 'landing/straumvakt-car.png', 'landing/straumvakt-logo-full.png', 'concepts/admin.html', 'data-model.svg']) put(extra);
      const result = pruneGeneratedAssets(root);
      expect(result).toEqual({ removed: 4, kept: PUBLIC_ASSET_PATHS.length });
      expect(fs.existsSync(path.join(root, 'landing/straumvakt-car.png'))).toBe(false);
      expect(fs.existsSync(path.join(root, 'landing/straumvakt-car.avif'))).toBe(true);
      expect(fs.existsSync(path.join(root, '_next/static/a.js'))).toBe(true);
      fs.unlinkSync(path.join(root, 'landing/straumvakt-car.webp'));
      expect(() => pruneGeneratedAssets(root)).toThrow(/missing required files/);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
  it('passes an allowed login to the server-side handler', async () => {
    const s = setup();
    expect((await s.fetch(new Request('https://www.straumvakt.org/api/shell/login', { method: 'POST', headers: { 'cf-connecting-ip': '192.0.2.1' } }), s.env, {})).status).toBe(200);
    expect(s.app.fetch).toHaveBeenCalledOnce();
  });
});

describe('shared live socket route', () => {
  it('routes a websocket upgrade and a driver bearer GET of /api/cpo/sync to the realtime module, never to the application', async () => {
    const s = setup();
    const off = await s.fetch(new Request('https://www.straumvakt.org/api/cpo/sync?installation=x', { headers: { upgrade: 'websocket' } }), s.env, {});
    expect(off.status).toBe(404); // not enabled: indistinguishable from an absent route
    const offBearer = await s.fetch(new Request('https://www.straumvakt.org/api/cpo/sync', { headers: { authorization: 'Bearer abc' } }), s.env, {});
    expect(offBearer.status).toBe(404);
    expect(s.app.fetch).not.toHaveBeenCalled();
    const enabled = { ...s.env, CPO_SHELL_REALTIME_ENABLED: 'true', VERSION_HUB: { idFromName: (n) => n, get: () => ({ fetch: vi.fn() }) } };
    const bad = await s.fetch(new Request('https://www.straumvakt.org/api/cpo/sync', { headers: { authorization: 'Bearer abc' } }), enabled, {});
    expect(bad.status).toBe(503); // enabled but no driver secret configured: the driver path is off, still not the application
    expect(s.app.fetch).not.toHaveBeenCalled();
  });
  it('an ordinary cookie GET (snapshot, check, status) still reaches the application', async () => {
    const s = setup();
    await s.fetch(new Request('https://www.straumvakt.org/api/cpo/sync?check=1', { headers: { cookie: 'straumvakt_cpo_shell=x' } }), s.env, {});
    expect(s.app.fetch).toHaveBeenCalledTimes(1);
  });
});
