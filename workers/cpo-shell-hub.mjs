// Durable Object: the cross-instance version hub (src/lib/sync/hub.ts) and, per installation, the shared live room.
//
// Holds only non-secret counters and installation ids (hub), and one bounded latest-value observation per device (room).
// Thin wrapper: every decision lives in VersionHubCore / LiveRoom / live-fanout, which is what the unit tests exercise.
// Binding name VERSION_HUB; creating the binding and its migration is a deployment step and is NOT part of this source change.
import { DurableObject } from 'cloudflare:workers';
import { VersionHubCore } from '../src/lib/sync/hub.ts';
import { LiveRoom } from '../src/lib/sync/live-room.ts';
import { deliver, grantFromHeaders, snapshotFor } from '../src/lib/sync/live-fanout.ts';
import { LIVE_LEASE_MS } from '../src/lib/ocpp-engine/live-projection.ts';

const MAX_SOCKETS = 200;

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
  gate(key, windowMs, limit) { return this.core.gate(key, windowMs, limit); }
  gateRecord(key, data) { return this.core.gateRecord(key, data); }
  claimRepair(leaseMs) { return this.core.claimRepair(leaseMs); }
  releaseRepair() { return this.core.releaseRepair(); }

  async publishLive(value) {
    const result = await this.room.publish(value);
    if (result.changed) this.broadcast({ type: 'device', value });
    return result;
  }
  /** After a structure commit: the authoritative device ids of this installation. Everything else held is removed now. */
  async reconcileLive(installationId, keepDeviceIds) {
    if (!Array.isArray(keepDeviceIds) || keepDeviceIds.length > 500) return { removed: 0 };
    const removed = await this.room.reconcile(installationId, keepDeviceIds);
    for (const deviceId of removed) this.broadcast({ type: 'remove', deviceId });
    return { removed: removed.length };
  }
  /** A placement closed (removal completed): drop the device and refuse its old placement. */
  async removeLive(installationId, deviceId, placementId) {
    const had = await this.room.remove(installationId, deviceId, placementId);
    if (had) this.broadcast({ type: 'remove', deviceId });
    return { removed: had };
  }

  /** Each socket receives what ITS grant allows (operator: full; driver: minimal projection of its own devices). */
  broadcast(message) {
    const now = Date.now();
    for (const ws of this.ctx.getWebSockets()) {
      const grant = ws.deserializeAttachment();
      if (!grant || typeof grant.expiresAt !== 'number' || grant.expiresAt <= now) { try { ws.close(4001, 'Access lease expired'); } catch {} continue; }
      const out = deliver(grant, message);
      if (!out) continue;
      try { ws.send(JSON.stringify(out)); } catch { try { ws.close(1011, 'Reconnect for snapshot'); } catch {} }
    }
  }

  async fetch(request) {
    const grant = grantFromHeaders((name) => request.headers.get(name), Date.now(), LIVE_LEASE_MS);
    if (!grant) return new Response('Forbidden', { status: 403 });
    if (this.ctx.getWebSockets().length >= MAX_SOCKETS) return new Response('Busy', { status: 503 });
    const devices = await this.room.snapshot(grant.installationId);
    if (grant.expiresAt <= Date.now()) return new Response('Unauthorized', { status: 401 });
    const pair = new WebSocketPair();
    pair[1].serializeAttachment(grant);
    this.ctx.acceptWebSocket(pair[1]);
    for (const out of snapshotFor(grant, devices)) pair[1].send(JSON.stringify(out));
    pair[1].send(JSON.stringify({ type: 'ready', installationId: grant.installationId, expiresAt: grant.expiresAt }));
    const alarm = await this.ctx.storage.getAlarm();
    if (alarm === null || grant.expiresAt < alarm) await this.ctx.storage.setAlarm(grant.expiresAt);
    return new Response(null, { status: 101, webSocket: pair[0] });
  }
  webSocketMessage(ws) { ws.close(1008, 'Read-only subscription'); }
  webSocketClose(ws) { ws.close(); }
  webSocketError(ws) { ws.close(1011, 'Reconnect'); }
  async alarm() {
    let next = Infinity;
    for (const ws of this.ctx.getWebSockets()) {
      const grant = ws.deserializeAttachment();
      if (!grant || grant.expiresAt <= Date.now()) { try { ws.close(4001, 'Access lease expired'); } catch {} }
      else next = Math.min(next, grant.expiresAt);
    }
    if (Number.isFinite(next)) await this.ctx.storage.setAlarm(next);
  }
}
