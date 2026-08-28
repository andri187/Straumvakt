// An in-memory `DevicesPort`.
//
// Runs the same `checkRegister` the Drizzle adapter runs, and models the one
// thing about the schema that a naive fixture would get wrong: **Postgres
// treats NULLs as distinct in a unique index**, so two devices with no serial
// do not collide and cannot be deduplicated. A `Map` keyed on
// `${vendor}:${serial}` would silently make `null:null` a single key and hide
// exactly the case `checkRegister` exists to report.

import {
  checkRegister,
  type DeviceRecord,
  type DevicesPort,
  type RegisterDeviceInput,
  type RegisterOutcome,
} from "./devices";

export interface FixtureDeviceState {
  rows: DeviceRecord[];
  writes: string[];
}

let seq = 0;

export function makeFixtureDevices(): { port: DevicesPort; state: FixtureDeviceState } {
  const state: FixtureDeviceState = { rows: [], writes: [] };

  return {
    state,
    port: {
      async register(input: RegisterDeviceInput): Promise<RegisterOutcome> {
        const check = checkRegister(input);
        if (!check.ok) return { kind: "refused", reason: check.reason };

        if (check.dedupable) {
          const existing = state.rows.find(
            (d) => d.vendor === input.vendor && d.serialNumber === input.serialNumber,
          );
          if (existing) return { kind: "already_known", device: existing };
        }
        // NOT dedupable: an unserialised device gets a NEW row every time, and
        // that is what the database does too. Modelling it any other way would
        // make the fixture kinder than production.
        const device: DeviceRecord = {
          id: `device-${String(++seq).padStart(4, "0")}`,
          vendor: input.vendor,
          model: input.model ?? null,
          serialNumber: input.serialNumber,
          firmwareVersion: input.firmwareVersion ?? null,
          firmwareObservedAt: input.firmwareObservedAt ?? null,
          warrantyExpires: input.warrantyExpires ?? null,
          retiredAt: null,
        };
        state.rows.push(device);
        state.writes.push(device.id);
        return { kind: "registered", device };
      },

      async byId(id) {
        return state.rows.find((d) => d.id === id) ?? null;
      },

      async byVendorSerial(vendor, serialNumber) {
        return state.rows.find((d) => d.vendor === vendor && d.serialNumber === serialNumber) ?? null;
      },

      async retire(id, at, reason) {
        const d = state.rows.find((x) => x.id === id);
        if (!d) return { kind: "not_found" };
        if (d.retiredAt) return { kind: "already_retired" };
        d.retiredAt = at;
        void reason;
        return { kind: "retired" };
      },
    },
  };
}
