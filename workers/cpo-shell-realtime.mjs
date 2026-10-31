import { readShellConfig, verifyShellSession } from '../src/lib/cpo-shell-session.ts';
import { readShellCookie } from '../src/lib/cpo-shell-policy.ts';
import { LIVE_LEASE_MS } from '../src/lib/ocpp-engine/live-projection.ts';

// Reuse GET /api/cpo/sync; no new public route. Only today's verified platform-operator login is supported.
// Driver/CPO tenancy grants must be implemented and tested before enabling this for those accounts.
export async function realtimeUpgrade(request, env, now = Date.now()) {
  if (env.CPO_SHELL_REALTIME_ENABLED !== 'true' || !env.VERSION_HUB) return new Response('Live updates unavailable', { status: 503 });
  const url = new URL(request.url);
  if (request.method !== 'GET' || request.headers.get('upgrade')?.toLowerCase() !== 'websocket') return new Response('Upgrade required', { status: 426 });
  if (request.headers.get('origin') !== url.origin) return new Response('Forbidden', { status: 403 });
  const installationId = url.searchParams.get('installation');
  if (!installationId || !/^[0-9a-f-]{36}$/i.test(installationId)) return new Response('Bad scope', { status: 400 });
  const config = readShellConfig(env);
  const session = config && await verifyShellSession(readShellCookie(request.headers.get('cookie')), config, Math.floor(now / 1000));
  if (!session) return new Response('Unauthorized', { status: 401 });
  // Share expiry wakes in five-second buckets instead of one distinct alarm deadline per viewer.
  const expiresAt = Math.min(Math.floor((now + LIVE_LEASE_MS) / 5000) * 5000, session.exp * 1000);
  const stub = env.VERSION_HUB.get(env.VERSION_HUB.idFromName(`live:${installationId}`));
  return stub.fetch(new Request('https://hub.internal/live', { headers: { upgrade: 'websocket', 'x-installation': installationId, 'x-lease-until': String(expiresAt) } }));
}
