// The device repository — ADR 0054 decision 1.
//
// A device is IMMORTAL. There is no delete on this port and there will not be
// one: a device row is what a placement, a session and a lifetime counter all
// point at, and removing it would orphan every one of them. Retirement is a
// STATE — `retired_at` and `retired_reason` — for the same reason closing a
// placement is a state rather than a delete.
//
// ── WRITTEN, AND NEVER EXECUTED ─────────────────────────────────────────
//
// `assets.devices` is created by migration 0005, unapplied. The decisions live
// in `deviceIdentityFor` and `checkRegister` below, which the fixture runs
// unchanged.

import { and, eq, isNull } from "drizzle-orm";
import { devices } from "@straumvakt/shared/db/assets";
import type { Db } from "../lib/drizzle";

export interface DeviceRecord {
  id: string;
  vendor: string | null;
  model: string | null;
  serialNumber: string | null;
  firmwareVersion: string | null;
  firmwareObservedAt: Date | null;
  warrantyExpires: Date | null;
  retiredAt: Date | null;
}

export interface RegisterDeviceInput {
  vendor: string | null;
  serialNumber: string | null;
  model?: string | null;
  firmwareVersion?: string | null;
  /** From `BootNotification`, never invented at import time. */
  firmwareObservedAt?: Date | null;
  /**
   * The real warranty date, or null.
   *
   * NULL IS A BETTER ANSWER THAN AN INVENTED ONE. `zaptec-import.ts` computes
   * `installDate + 5 years` and stores it in a column whose name asserts it
   * came from somewhere; that is the difference between "we do not know" and a
   * wrong date a claim gets denied against.
   */
  warrantyExpires?: Date | null;
  idempotencyKey: string;
}

export type RegisterOutcome =
  | { kind: "registered"; device: DeviceRecord }
  /** `(vendor, serial)` already known. Idempotent — a re-import of the same
   *  fleet must not create a second row for one physical unit. */
  | { kind: "already_known"; device: DeviceRecord }
  | { kind: "refused"; reason: "idempotency_key_required" | "vendor_required_with_serial" };

export interface DevicesPort {
  register(input: RegisterDeviceInput): Promise<RegisterOutcome>;
  byId(id: string): Promise<DeviceRecord | null>;
  /** `null` serial matches nothing — see `checkRegister`. */
  byVendorSerial(vendor: string, serialNumber: string): Promise<DeviceRecord | null>;
  retire(id: string, at: Date, reason: string): Promise<{ kind: "retired" | "not_found" | "already_retired" }>;
}

export type RegisterCheck =
  | { ok: true; dedupable: boolean }
  | { ok: false; reason: "idempotency_key_required" | "vendor_required_with_serial" };

/**
 * The decisions both adapters share.
 *
 * `dedupable` is the one worth reading. `(vendor, serial_number)` is UNIQUE
 * and both columns are NULLABLE, because OCPP 2.0.1 makes `serialNumber`
 * optional and 1.6 offers three competing serial fields. **Postgres treats
 * NULLs as distinct in a unique index**, so two devices with no serial do not
 * collide — which is correct — but it also means a device with no serial
 * CANNOT be deduplicated. Registering the same unserialised unit twice makes
 * two rows, and no constraint can prevent it.
 *
 * That is not a defect to hide behind a generated key. It is stated here and
 * returned to the caller, so an importer can decide to refuse, to ask, or to
 * accept the duplicate knowingly. What it must not do is pretend the second
 * row is the first.
 */
export function checkRegister(input: RegisterDeviceInput): RegisterCheck {
  if (typeof input.idempotencyKey !== "string" || input.idempotencyKey.trim() === "") {
    return { ok: false, reason: "idempotency_key_required" };
  }
  const hasSerial = typeof input.serialNumber === "string" && input.serialNumber.trim() !== "";
  const hasVendor = typeof input.vendor === "string" && input.vendor.trim() !== "";
  if (hasSerial && !hasVendor) {
    // A serial without a vendor is not a key: serials are vendor-scoped, and
    // two vendors' units can share a string. Storing it would make the unique
    // index meaningless for that row without saying so.
    return { ok: false, reason: "vendor_required_with_serial" };
  }
  return { ok: true, dedupable: hasSerial && hasVendor };
}

export function makeDrizzleDevices(db: Db): DevicesPort {
  const toRecord = (r: typeof devices.$inferSelect): DeviceRecord => ({
    id: r.id,
    vendor: r.vendor,
    model: r.model,
    serialNumber: r.serialNumber,
    firmwareVersion: r.firmwareVersion,
    firmwareObservedAt: r.firmwareObservedAt,
    warrantyExpires: r.warrantyExpires,
    retiredAt: r.retiredAt,
  });

  return {
    async register(input) {
      const check = checkRegister(input);
      if (!check.ok) return { kind: "refused", reason: check.reason };

      if (check.dedupable) {
        const [existing] = await db
          .select()
          .from(devices)
          .where(and(eq(devices.vendor, input.vendor!), eq(devices.serialNumber, input.serialNumber!)))
          .limit(1);
        if (existing) return { kind: "already_known", device: toRecord(existing) };
      }

      const [row] = await db
        .insert(devices)
        .values({
          vendor: input.vendor,
          model: input.model ?? null,
          serialNumber: input.serialNumber,
          firmwareVersion: input.firmwareVersion ?? null,
          firmwareObservedAt: input.firmwareObservedAt ?? null,
          // Never install + 5 years. See the note on the input type.
          warrantyExpires: input.warrantyExpires ?? null,
        })
        .returning();
      return { kind: "registered", device: toRecord(row!) };
    },

    async byId(id) {
      const [row] = await db.select().from(devices).where(eq(devices.id, id)).limit(1);
      return row ? toRecord(row) : null;
    },

    async byVendorSerial(vendor, serialNumber) {
      const [row] = await db
        .select()
        .from(devices)
        .where(and(eq(devices.vendor, vendor), eq(devices.serialNumber, serialNumber)))
        .limit(1);
      return row ? toRecord(row) : null;
    },

    async retire(id, at, reason) {
      // A STATE, not a delete. A retired device is still what every placement,
      // session and lifetime counter points at; deleting it orphans all three.
      // Bounded to `retired_at IS NULL`, so retiring twice does not move the
      // date that was already recorded.
      const rows = await db
        .update(devices)
        .set({ retiredAt: at, retiredReason: reason })
        .where(and(eq(devices.id, id), isNull(devices.retiredAt)))
        .returning({ id: devices.id });
      if (rows.length > 0) return { kind: "retired" };
      const [exists] = await db
        .select({ retiredAt: devices.retiredAt })
        .from(devices)
        .where(eq(devices.id, id))
        .limit(1);
      return { kind: exists ? "already_retired" : "not_found" };
    },
  };
}
