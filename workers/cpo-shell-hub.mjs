// Durable Object: the cross-instance version hub (src/lib/sync/hub.ts).
//
// Holds only non-secret counters and installation ids. Thin wrapper: every
// decision lives in VersionHubCore, which is what the unit tests exercise.
// Binding name VERSION_HUB; creating the binding and its migration is a
// deployment step and is NOT part of this source change.
import { DurableObject } from 'cloudflare:workers';
import { VersionHubCore } from '../src/lib/sync/hub.ts';
import { LiveRoom } from '../src/lib/sync/live-room.ts';
import { LIVE_LEASE_MS } from '../src/lib/ocpp-engine/live-projection.ts';

export class VersionHub extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.core = new VersionHubCore(ctx.storage);
    this.room = new LiveRoom(ctx.storage);
  }
  read() { return this.core.read(); }
  prime(ids, versions) { return this.core.prime(ids, versions); }
  bump(installationId, patch) { return this.core.bump(installationId, patch); }
  invalidate() { return this.core.invalidate(); }
  async publishLive(value) {
    const result = await this.room.publish(value);
    if (result.changed) this.broadcast({ type: 'device', value });
    return result;
  }
  broadcast(message) {
    for (const ws of this.ctx.getWebSockets()) {
      const grant = ws.deserializeAttachment();
      if (!grant || grant.expiresAt <= Date.now()) { ws.close(4001, 'Access lease expired'); continue; }
      if (message.type === 'device' && message.value.installationId !== grant.installationId) continue;
      try { ws.send(JSON.stringify(message)); } catch { ws.close(1011, 'Reconnect for snapshot'); }
    }
  }
  async fetch(request) {
    const installationId = request.headers.get('x-installation');
    const expiresAt = Number(request.headers.get('x-lease-until'));
    if (!installationId || !/^[0-9a-f-]{36}$/i.test(installationId) || !Number.isFinite(expiresAt) || expiresAt <= Date.now() || expiresAt > Date.now() + LIVE_LEASE_MS) return new Response('Forbidden', { status: 403 });
    if (this.ctx.getWebSockets().length >= 200) return new Response('Busy', { status: 503 });
    const devices = await this.room.snapshot(installationId);
    if (expiresAt <= Date.now()) return new Response('Unauthorized', { status: 401 });
    const pair = new WebSocketPair();
    pair[1].serializeAttachment({ installationId, expiresAt });
    this.ctx.acceptWebSocket(pair[1]);
    for (const value of devices) pair[1].send(JSON.stringify({ type: 'device', value }));
    pair[1].send(JSON.stringify({ type: 'ready', installationId, expiresAt }));
    const alarm = await this.ctx.storage.getAlarm();
    if (alarm === null || expiresAt < alarm) await this.ctx.storage.setAlarm(expiresAt);
    return new Response(null, { status: 101, webSocket: pair[0] });
  }
  webSocketMessage(ws) { ws.close(1008, 'Read-only subscription'); }
  webSocketClose(ws) { ws.close(); }
  webSocketError(ws) { ws.close(1011, 'Reconnect'); }
  async alarm() {
    let next = Infinity;
    for (const ws of this.ctx.getWebSockets()) {
      const grant = ws.deserializeAttachment();
      if (!grant || grant.expiresAt <= Date.now()) ws.close(4001, 'Access lease expired');
      else next = Math.min(next, grant.expiresAt);
    }
    if (Number.isFinite(next)) await this.ctx.storage.setAlarm(next);
  }
}
