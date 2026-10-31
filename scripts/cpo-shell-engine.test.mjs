// Local harness for the shell Worker's engine entrypoint. `cloudflare:workers` is
// stubbed, so this proves the class wiring, the unconfigured/failed paths and
// that the public edge cannot reach the engine. It is NOT evidence about the
// Cloudflare runtime's entrypoint/RPC behaviour, which remains to be verified.
import { describe, expect, it, vi } from 'vitest';

vi.mock('cloudflare:workers', () => ({
  WorkerEntrypoint: class {
    constructor(ctx, env) {
      this.ctx = ctx;
      this.env = env;
    }
  },
}));

const { EngineEntrypoint } = await import('../workers/cpo-shell-engine.mjs');
const { createShellEdge, API_PATHS, PAGE_PATHS } = await import('../workers/cpo-shell-edge.mjs');

const KEY = 'abcdefghijk1';

describe('EngineEntrypoint (local harness)', () => {
  it('without DATABASE_URL, admission is `unavailable` and never admits', async () => {
    const e = new EngineEntrypoint({}, {});
    expect(await e.admit({ host: 'cpoa.straumvakt.org', pathname: '/CP-1', authorization: null })).toEqual({ kind: 'unavailable' });
  });

  it('without DATABASE_URL, calls are `unavailable` (retryable), not accepted', async () => {
    const e = new EngineEntrypoint({}, {});
    const ctx = { orgId: 'o', installationId: 'i', chargePointId: 'CP-1', identityString: 'o/CP-1', deviceId: 'd', placementId: 'p', credentialMode: 'none', credentialEpoch: 'e' };
    expect(await e.call({ ctx, messageId: 'm', action: 'Authorize', payload: { idTag: 'T' }, receivedAt: new Date().toISOString() })).toEqual({ kind: 'unavailable' });
  });

  it('refuses malformed admission input before any database is considered', async () => {
    const e = new EngineEntrypoint({}, { DATABASE_URL: 'postgres://never-opened.invalid/db' });
    expect(await e.admit({ host: 'evil.example.com', pathname: '/CP-1' })).toEqual({ kind: 'deny' });
    expect(await e.call({ ctx: {}, messageId: 'm', action: 'Authorize', payload: {}, receivedAt: 'x' })).toEqual({ kind: 'rejected', status: 400 });
  });
});

describe('costing service method (local harness)', () => {
  it('without DATABASE_URL it does nothing and reports so, rather than failing or pretending', async () => {
    const e = new EngineEntrypoint({ waitUntil() {} }, {});
    expect(await e.costPending({ limit: 5 })).toEqual({ processed: 0, costed: 0, unresolved: {}, failed: 0 });
    expect(await e.costPending({ limit: 'many' })).toEqual({ processed: 0, costed: 0, unresolved: {}, failed: 0 });
  });
});

describe('the public edge cannot reach the engine', () => {
  const app = { fetch: vi.fn(async () => new Response('app')) };
  const edge = createShellEdge(app);
  it('has no internal path in any allow-list', () => {
    for (const p of [...API_PATHS, ...PAGE_PATHS]) expect(p).not.toMatch(/ocpp|internal|engine/);
  });
  it('answers 404 for engine-shaped paths without touching the application', async () => {
    for (const path of ['/api/internal/ocpp-admit', '/api/internal/ocpp-call', '/internal/engine', '/rpc/admit']) {
      const res = await edge(new Request(`https://www.straumvakt.org${path}`, { method: 'POST' }), {}, {});
      expect(res.status).toBe(404);
    }
    expect(app.fetch).not.toHaveBeenCalled();
  });
});
