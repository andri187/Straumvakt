// Local harness for the shell Worker's scheduled recovery entry. It proves the adapter's gating and its failure
// handling with an injected runner and with NO database. It is NOT evidence about Cloudflare cron delivery.
import { describe, expect, it, vi } from 'vitest';
import { createScheduledHandler } from '../workers/cpo-shell-recovery.mjs';
import { createShellEdge, API_PATHS, PAGE_PATHS } from '../workers/cpo-shell-edge.mjs';

describe('scheduled recovery adapter (local harness)', () => {
  it('with the default runner and no enable variable it does nothing: disabled, no database touched', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const scheduled = createScheduledHandler();
    const report = await scheduled({}, { DATABASE_URL: 'postgres://never-opened.invalid/db' });
    expect(report).toMatchObject({ status: 'disabled', reason: 'not_enabled' });
    log.mockRestore();
  });

  it('enabled but without DATABASE_URL it reports unavailable rather than a successful empty pass', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const report = await createScheduledHandler()({}, { CPO_SHELL_RECOVERY_ENABLED: 'true' });
    expect(report).toMatchObject({ status: 'unavailable', reason: 'database_not_configured' });
    log.mockRestore();
  });

  it('calls the injected bounded function with the environment, once, and logs one aggregate line without identifiers', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const run = vi.fn(async () => ({ status: 'ran', costing: { attempted: 2 }, lifecycle: { attempted: 1 } }));
    const env = { CPO_SHELL_RECOVERY_ENABLED: 'true' };
    await createScheduledHandler(run)({ cron: '0 * * * *' }, env);
    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith(env);
    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0][0]).toBe(JSON.stringify({ recovery: { status: 'ran', costing: { attempted: 2 }, lifecycle: { attempted: 1 } } }));
    log.mockRestore();
  });

  it('never throws out of the scheduled handler, and does not log the error text', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const run = vi.fn(async () => { throw new Error('postgres://secret@host/db exploded'); });
    const report = await createScheduledHandler(run)({}, {});
    expect(report).toEqual({ status: 'unavailable', reason: 'database_error' });
    expect(String(log.mock.calls[0][0])).not.toContain('secret');
    log.mockRestore();
  });
});

describe('the public edge is unchanged by the scheduled entry', () => {
  const app = { fetch: vi.fn(async () => new Response('app')) };
  const edge = createShellEdge(app);
  it('has no recovery path in any allow-list and answers 404 for recovery-shaped paths without touching the application', async () => {
    for (const p of [...API_PATHS, ...PAGE_PATHS]) expect(p).not.toMatch(/recover|scheduled|cron/);
    for (const path of ['/api/internal/recovery', '/__scheduled', '/cdn-cgi/handler/scheduled']) {
      const res = await edge(new Request(`https://www.straumvakt.org${path}`, { method: 'POST' }), {}, {});
      expect(res.status).toBe(404);
    }
    expect(app.fetch).not.toHaveBeenCalled();
  });
});
