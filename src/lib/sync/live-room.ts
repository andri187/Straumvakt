import { LIVE_MAX_DEVICES, newerLive, validLiveDevice, type LiveDevice } from "../ocpp-engine/live-projection";
import type { HubStorage } from "./hub";

type Room = { installationId: string; orgId: string };
type Storage = HubStorage & { list<T>(options: { prefix: string; limit: number }): Promise<Map<string, T>> };
/** One bounded latest-value projection per installation, inside the EXISTING VersionHub class.
 * No SQL dependency. Durable financial evidence stays on the independent ingestion path.
 */
export class LiveRoom {
  constructor(private readonly storage: Storage) {}
  async snapshot(installationId: string): Promise<LiveDevice[]> {
    const room = await this.storage.get<Room>("live-room");
    return room?.installationId === installationId ? [...(await this.storage.list<LiveDevice>({ prefix: "live-device:", limit: LIVE_MAX_DEVICES })).values()] : [];
  }
  async publish(value: unknown): Promise<{ ok: boolean; changed: boolean }> {
    if (!validLiveDevice(value)) return { ok: false, changed: false };
    const room = await this.storage.get<Room>("live-room");
    if (room && (room.installationId !== value.installationId || room.orgId !== value.orgId)) return { ok: false, changed: false };
    const key = `live-device:${value.deviceId}`;
    const held = await this.storage.get<LiveDevice>(key);
    if (held && !newerLive(value, held)) return { ok: true, changed: false };
    if (!held && (await this.storage.list({ prefix: "live-device:", limit: LIVE_MAX_DEVICES })).size >= LIVE_MAX_DEVICES) return { ok: false, changed: false };
    if (!room) await this.storage.put("live-room", { installationId: value.installationId, orgId: value.orgId } satisfies Room);
    await this.storage.put(key, value);
    return { ok: true, changed: true };
  }
}
