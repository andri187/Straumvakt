// The Drizzle-backed `VendorConfigSinkPort`.
//
// ── WRITTEN, AND NEVER EXECUTED ─────────────────────────────────────────
//
// Migration 0007 has not been applied to any database, so
// `assets.vendor_config_observations` does not exist and every statement below
// has never run. Same shape as the rest of this lane: the decisions are proven
// against `makeFixtureVendorConfigSink`, which runs the SAME `checkObservation`
// and `sameReading` in the same order. Swapping the adapter is the change when
// 0007 applies — not rewriting the caller.
//
// The one thing this file must therefore get right is the SHAPE, because
// nothing here will fail a test until a database exists.

import { desc, eq } from "drizzle-orm";
import { vendorConfigObservations } from "@straumvakt/shared/db/assets";
import type { Db } from "../drizzle";
import {
  checkObservation,
  sameReading,
  type Evidence,
  type VendorConfigObservation,
  type VendorConfigSinkPort,
} from "./sink-port";

/** Rows come back with `Date` columns and nullable fields; this is the one
 *  place the row shape is turned into the port's shape, so the two cannot
 *  drift apart in three call sites. */
function toObservation(r: typeof vendorConfigObservations.$inferSelect): VendorConfigObservation {
  return {
    deviceId: r.deviceId,
    observedAt: r.observedAt,
    chargerActive: r.chargerActive,
    authenticationType: r.authenticationType,
    isAuthorizationRequired: r.isAuthorizationRequired,
    ocppDefaultIdTag: r.ocppDefaultIdTag,
  };
}

export function makeDrizzleVendorConfigSink(
  db: Db,
  access: { restrictToDeviceIds: string[] | null } = { restrictToDeviceIds: null },
): VendorConfigSinkPort {
  return {
    async record(o) {
      const check = checkObservation(o);
      if (!check.ok) throw new Error(check.reason);

      // Read the latest, compare, append. Deliberately NOT an upsert: there is
      // no unique key to conflict on, because the table is a log and two
      // genuinely different observations of one device at different times are
      // both correct. `ON CONFLICT` would need a key that says otherwise.
      const [prior] = await db
        .select()
        .from(vendorConfigObservations)
        .where(eq(vendorConfigObservations.deviceId, o.deviceId))
        .orderBy(desc(vendorConfigObservations.observedAt))
        .limit(1);

      // Dedup against the LATEST only, never against the whole log. A charger
      // that goes active -> inactive -> active must record three observations;
      // matching anywhere in history would swallow the third.
      if (prior && sameReading(toObservation(prior), o)) {
        return { status: "unchanged" };
      }

      // A concurrent poll can land between the SELECT and the INSERT and write
      // an identical row. The cost of that race is one duplicate row in a log
      // whose readers take the latest — it is not a double-count and not a
      // lost change. Serialising the whole log to prevent a redundant row
      // would be the wrong trade, and it is recorded here rather than left for
      // someone to rediscover as a bug.
      await db.insert(vendorConfigObservations).values({
        deviceId: o.deviceId,
        observedAt: o.observedAt,
        chargerActive: o.chargerActive,
        authenticationType: o.authenticationType,
        isAuthorizationRequired: o.isAuthorizationRequired,
        ocppDefaultIdTag: o.ocppDefaultIdTag,
      });
      return { status: "recorded" };
    },

    async latestFor(deviceId): Promise<Evidence<VendorConfigObservation>> {
      if (access.restrictToDeviceIds && !access.restrictToDeviceIds.includes(deviceId)) {
        return { kind: "unavailable", reason: "out_of_scope" };
      }
      const [row] = await db
        .select()
        .from(vendorConfigObservations)
        // Scope is enforced above, by refusing rather than by filtering: a
        // caller asking about a device outside its scope gets `out_of_scope`,
        // not `never_observed`. Those are different answers and only one of
        // them is true.
        .where(eq(vendorConfigObservations.deviceId, deviceId))
        .orderBy(desc(vendorConfigObservations.observedAt))
        .limit(1);
      // No row is `unavailable`, never a synthesised observation with `false`
      // in it. This is the whole reason the port returns `Evidence`.
      return row
        ? { kind: "observed", value: toObservation(row) }
        : { kind: "unavailable", reason: "never_observed" };
    },
  };
}
