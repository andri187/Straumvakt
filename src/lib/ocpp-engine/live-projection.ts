// Latest operational values only. No identity tokens, driver details, terms or financial effects.
// Shared wire contract for web/mobile adapters; a driver subscription still requires its own access grant.
export type LiveConnector = { status?: string; errorCode?: string; reportedAt?: string | null; powerW?: number | null; energyWh?: number | null };
export type LiveDevice = {
  schema: 1; orgId: string; installationId: string; deviceId: string; placementId: string;
  generation: number; revision: number; observedAt: number; online: boolean; onlineUntil: number;
  connectors: Record<string, LiveConnector>;
};
export const LIVE_MAX_DEVICES = 200;
export const LIVE_LEASE_MS = 60_000;
export function validLiveDevice(value: unknown): value is LiveDevice {
  if (!value || typeof value !== "object") return false;
  const v = value as LiveDevice;
  if (v.schema !== 1 || [v.orgId, v.installationId, v.deviceId, v.placementId].some(id => typeof id !== "string" || !/^[0-9a-f-]{36}$/i.test(id))) return false;
  if (![v.generation, v.revision, v.observedAt, v.onlineUntil].every(n => Number.isSafeInteger(n) && n >= 0) || typeof v.online !== "boolean") return false;
  if (!v.connectors || typeof v.connectors !== "object" || Array.isArray(v.connectors) || Object.keys(v.connectors).length > 64) return false;
  if (Object.keys(v).some(k => !["schema", "orgId", "installationId", "deviceId", "placementId", "generation", "revision", "observedAt", "online", "onlineUntil", "connectors"].includes(k))) return false;
  return Object.entries(v.connectors).every(([id, c]) => /^\d{1,5}$/.test(id) && c && typeof c === "object"
    && Object.keys(c).every(k => ["status", "errorCode", "reportedAt", "powerW", "energyWh"].includes(k))
    && [c.status, c.errorCode].every(s => s === undefined || typeof s === "string" && s.length <= 64)
    && (c.reportedAt === undefined || c.reportedAt === null || typeof c.reportedAt === "string" && c.reportedAt.length <= 40 && Number.isFinite(Date.parse(c.reportedAt)))
    && [c.powerW, c.energyWh].every(n => n === undefined || n === null || Number.isFinite(n)));
}
export function newerLive(a: LiveDevice, b: LiveDevice): boolean {
  return a.generation > b.generation || a.generation === b.generation && a.revision > b.revision;
}
