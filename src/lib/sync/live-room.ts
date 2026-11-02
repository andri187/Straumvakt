import { LIVE_MAX_DEVICES, newerLive, validLiveDevice, type LiveDevice } from "../ocpp-engine/live-projection";
import type { HubStorage } from "./hub";

type Room = { installationId: string; orgId: string };
/** A device whose lease lapsed this long ago is obsolete (removed, moved, retired): it will not publish again, and its entry is disposed
 * when the room needs the space. Nothing is deleted while the room has room, so a briefly silent charger keeps its last value. */
export const LIVE_RETAIN_MS = 24 * 60 * 60 * 1000;
/** A removed placement is remembered this long (bounded by LIVE_MAX_TOMBSTONES), so its still-open old socket cannot republish it. */
export const LIVE_TOMBSTONE_MS = 7 * 24 * 60 * 60 * 1000;
export const LIVE_MAX_TOMBSTONES = 200;
type Tomb = { placementId: string; at: number };
type Storage = HubStorage & { list<T>(options: { prefix: string; limit: number }): Promise<Map<string, T>> };
/** One bounded latest-value projection per installation, inside the EXISTING VersionHub class.
 * No SQL dependency. Durable financial evidence stays on the independent ingestion path.
 */
export class LiveRoom {
  constructor(private readonly storage: Storage, private readonly now: () => number = Date.now) {}
  async snapshot(installationId: string): Promise<LiveDevice[]> {
    const room = await this.storage.get<Room>("live-room");
    return room?.installationId === installationId ? [...(await this.storage.list<LiveDevice>({ prefix: "live-device:", limit: LIVE_MAX_DEVICES })).values()] : [];
  }
  /** Deletes entries whose lease lapsed more than LIVE_RETAIN_MS ago. Returns how many remain. */
  private async disposeObsolete(existing: Map<string, LiveDevice>): Promise<number> {
    let remaining = existing.size;
    for (const [key, device] of existing) {
      if (device.onlineUntil + LIVE_RETAIN_MS < this.now()) {
        await this.storage.delete(key);
        remaining -= 1;
      }
    }
    return remaining;
  }

  private async entomb(deviceId: string, placementId: string): Promise<void> {
    await this.storage.put(`live-tomb:${deviceId}`, { placementId, at: this.now() } satisfies Tomb);
    const tombs = await this.storage.list<Tomb>({ prefix: "live-tomb:", limit: LIVE_MAX_TOMBSTONES + 1 });
    if (tombs.size <= LIVE_MAX_TOMBSTONES) return;
    // Over the bound: expired ones first, then the oldest, so the store never grows past the cap.
    const ordered = [...tombs].sort((a, b) => a[1].at - b[1].at);
    for (const [key, t] of ordered) {
      if (tombs.size <= LIVE_MAX_TOMBSTONES && t.at + LIVE_TOMBSTONE_MS >= this.now()) break;
      await this.storage.delete(key);
      tombs.delete(key);
    }
  }

  /**
   * A device left this installation (placement closed, charger detached): drop its value and refuse its old placement, so a
   * socket that is still open under that placement cannot bring it back. A device that returns under a NEW placement has a
   * different placement id and is accepted again. `placementId` may be supplied when the room never held the device.
   */
  async remove(installationId: string, deviceId: string, placementId?: string): Promise<boolean> {
    const room = await this.storage.get<Room>("live-room");
    if (room && room.installationId !== installationId) return false;
    const key = `live-device:${deviceId}`;
    const held = await this.storage.get<LiveDevice>(key);
    const placement = placementId ?? held?.placementId;
    if (held) await this.storage.delete(key);
    if (placement) await this.entomb(deviceId, placement);
    return !!held;
  }

  /** The authoritative device set of the installation after a structure commit: anything else held is obsolete NOW. Returns the removed ids. */
  async reconcile(installationId: string, keep: readonly string[]): Promise<string[]> {
    const room = await this.storage.get<Room>("live-room");
    if (!room || room.installationId !== installationId) return [];
    const keepSet = new Set(keep);
    const removed: string[] = [];
    for (const [key, device] of await this.storage.list<LiveDevice>({ prefix: "live-device:", limit: LIVE_MAX_DEVICES })) {
      if (keepSet.has(device.deviceId)) continue;
      await this.storage.delete(key);
      await this.entomb(device.deviceId, device.placementId);
      removed.push(device.deviceId);
    }
    return removed;
  }

  async publish(value: unknown): Promise<{ ok: boolean; changed: boolean; removed?: boolean }> {
    if (!validLiveDevice(value)) return { ok: false, changed: false };
    const room = await this.storage.get<Room>("live-room");
    if (room && (room.installationId !== value.installationId || room.orgId !== value.orgId)) return { ok: false, changed: false };
    const key = `live-device:${value.deviceId}`;
    const held = await this.storage.get<LiveDevice>(key);
    if (held && !newerLive(value, held)) return { ok: true, changed: false };
    if (!held) {
      const tombKey = `live-tomb:${value.deviceId}`;
      const tomb = await this.storage.get<Tomb>(tombKey);
      // Accepted-as-obsolete (ok): the publisher must not retry a value that can never be shown. A NEW placement clears the tombstone.
      if (tomb?.placementId === value.placementId) return { ok: true, changed: false, removed: true };
      if (tomb) await this.storage.delete(tombKey);
      const existing = await this.storage.list<LiveDevice>({ prefix: "live-device:", limit: LIVE_MAX_DEVICES });
      // At capacity: dispose of obsolete devices first. Fresh ones are never evicted, so the bound still holds and nothing live is lost.
      if (existing.size >= LIVE_MAX_DEVICES && (await this.disposeObsolete(existing)) >= LIVE_MAX_DEVICES) return { ok: false, changed: false };
    }
    if (!room) await this.storage.put("live-room", { installationId: value.installationId, orgId: value.orgId } satisfies Room);
    await this.storage.put(key, value);
    return { ok: true, changed: true };
  }
}
