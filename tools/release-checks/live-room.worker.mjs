// Test wrapper for tools/release-checks/live-room.mjs: exports the SAME Durable Object class the shell Worker exports, plus a
// fetch handler that hands the room the internal headers the edge would. Never deployed.
export { VersionHub } from '../../workers/cpo-shell-hub.mjs';

const stub = (env, name) => env.VERSION_HUB.get(env.VERSION_HUB.idFromName(name));

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/connect') {
      const room = stub(env, 'live:' + (url.searchParams.get('installation') ?? ''));
      // Forward only what the edge forwards (never the client's handshake headers).
      const headers = { upgrade: 'websocket' };
      for (const k of ['x-installation', 'x-role', 'x-lease-until', 'x-driver-devices']) if (request.headers.get(k)) headers[k] = request.headers.get(k);
      return room.fetch(new Request('https://hub.internal/live', { headers }));
    }
    if (url.pathname === '/connect-server-lease') {
      // The lease is computed INSIDE the Worker (as the real edge does), not taken from the test client's clock.
      const room = stub(env, 'live:' + (url.searchParams.get('installation') ?? ''));
      const headers = { upgrade: 'websocket', 'x-installation': url.searchParams.get('installation'), 'x-role': url.searchParams.get('role') ?? 'operator', 'x-lease-until': String(Date.now() + Number(url.searchParams.get('lease') ?? 60000)) };
      if (url.searchParams.get('devices')) headers['x-driver-devices'] = url.searchParams.get('devices');
      return room.fetch(new Request('https://hub.internal/live', { headers }));
    }
    if (url.pathname === '/rpc') {
      const { target, method, args } = await request.json();
      return Response.json((await stub(env, target)[method](...args)) ?? null);
    }
    return new Response('not found', { status: 404 });
  },
};
