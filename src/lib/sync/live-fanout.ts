// Who may receive which live value, as pure functions. The shared live room (workers/cpo-shell-hub.mjs) holds ONE normalized
// observation per device and applies this policy per socket, so a single publication serves every authorized viewer with no
// database read per viewer.
//
// Two roles, deliberately unequal:
//   operator  the full normalized observation for ONE installation (today: the signed platform-operator login).
//   driver    a MINIMAL projection of the devices - and only the connectors - the driver is charging at right now. No
//             organisation, installation, placement, generation or error detail ever leaves for a driver.
//
// A grant is created by the edge after it verified the credential and resolved access from the identity authority; it is
// stored with the socket and carries its own expiry, so access ends at the lease even if nothing else happens. This module
// never decides who gets a grant; it only enforces what a grant allows.

import type { LiveConnector, LiveDevice } from "../ocpp-engine/live-projection";

/** deviceId -> connector numbers the driver is charging on. */
export type DriverDevices = Record<string, number[]>;
export const MAX_DRIVER_DEVICES = 8;

export type Grant =
  | { role: "operator"; installationId: string; expiresAt: number }
  | { role: "driver"; installationId: string; expiresAt: number; devices: DriverDevices };

export type DriverLiveConnector = Pick<LiveConnector, "status" | "reportedAt" | "powerW" | "energyWh">;
export type DriverLiveDevice = {
  schema: 1;
  deviceId: string;
  /** Ordering only (newer wins); carries no identity. */
  generation: number;
  revision: number;
  observedAt: number;
  online: boolean;
  onlineUntil: number;
  connectors: Record<string, DriverLiveConnector>;
};

export type FanoutIn = { type: "device"; value: LiveDevice } | { type: "remove"; deviceId: string };
export type FanoutOut = { type: "device"; value: LiveDevice | DriverLiveDevice } | { type: "remove"; deviceId: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function toDriverProjection(d: LiveDevice, connectors: readonly number[]): DriverLiveDevice {
  const out: Record<string, DriverLiveConnector> = {};
  for (const n of connectors) {
    const c = d.connectors[String(n)];
    if (!c) continue;
    out[String(n)] = { ...(c.status !== undefined ? { status: c.status } : {}), ...(c.reportedAt !== undefined ? { reportedAt: c.reportedAt } : {}), ...(c.powerW !== undefined ? { powerW: c.powerW } : {}), ...(c.energyWh !== undefined ? { energyWh: c.energyWh } : {}) };
  }
  return { schema: 1, deviceId: d.deviceId, generation: d.generation, revision: d.revision, observedAt: d.observedAt, online: d.online, onlineUntil: d.onlineUntil, connectors: out };
}

/** What this socket may be told about `msg`, or null for nothing. Total: an unknown grant role receives nothing. */
export function deliver(grant: Grant, msg: FanoutIn): FanoutOut | null {
  if (msg.type === "remove") {
    if (grant.role === "operator") return msg;
    return msg.deviceId in grant.devices ? msg : null;
  }
  if (msg.value.installationId !== grant.installationId) return null;
  if (grant.role === "operator") return msg;
  if (grant.role !== "driver") return null;
  const connectors = grant.devices[msg.value.deviceId];
  return connectors ? { type: "device", value: toDriverProjection(msg.value, connectors) } : null;
}

export function snapshotFor(grant: Grant, devices: readonly LiveDevice[]): FanoutOut[] {
  return devices.flatMap((value) => deliver(grant, { type: "device", value }) ?? []);
}

/** The bounded devices map of a driver grant; null if malformed. */
export function parseDriverDevices(v: unknown): DriverDevices | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const entries = Object.entries(v as Record<string, unknown>);
  if (entries.length < 1 || entries.length > MAX_DRIVER_DEVICES) return null;
  const out: DriverDevices = {};
  for (const [id, list] of entries) {
    if (!UUID.test(id) || !Array.isArray(list) || list.length < 1 || list.length > 8 || !list.every((n) => Number.isInteger(n) && n >= 0 && n <= 65535)) return null;
    out[id] = [...new Set(list as number[])];
  }
  return out;
}

export function parseGrant(v: unknown): Grant | null {
  if (!v || typeof v !== "object") return null;
  const g = v as Record<string, unknown>;
  if (typeof g.installationId !== "string" || !UUID.test(g.installationId) || typeof g.expiresAt !== "number" || !Number.isFinite(g.expiresAt)) return null;
  if (g.role === "operator") return { role: "operator", installationId: g.installationId, expiresAt: g.expiresAt };
  if (g.role === "driver") {
    const devices = parseDriverDevices(g.devices);
    return devices ? { role: "driver", installationId: g.installationId, expiresAt: g.expiresAt, devices } : null;
  }
  return null;
}

/** The internal header contract between the edge and the room. Anything else is refused. */
export function grantFromHeaders(get: (name: string) => string | null, now: number, maxLeaseMs: number): Grant | null {
  const expiresAt = Number(get("x-lease-until"));
  if (!Number.isFinite(expiresAt) || expiresAt <= now || expiresAt > now + maxLeaseMs) return null;
  const role = get("x-role") ?? "operator";
  let devices: unknown;
  if (role === "driver") {
    try { devices = JSON.parse(get("x-driver-devices") ?? ""); } catch { return null; }
  }
  return parseGrant({ role, installationId: get("x-installation"), expiresAt, devices });
}
