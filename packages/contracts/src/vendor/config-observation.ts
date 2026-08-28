// The four vendor-config fields, persisted instead of discarded.
//
// ── ADR 0054 ITEM 12 ────────────────────────────────────────────────────
//
// `Charger.Active`, `AuthenticationType`, `IsAuthorizationRequired` and
// `PropertyOcppDefaultIdTag` are read from Zaptec today and thrown away.
// Each one changes what our own rows MEAN, which is the ADR's test for what
// belongs in the database:
//
//   • `Active` false and a charger still in our asset chain is a row that
//     should not be billed.
//   • `AuthenticationType` decides whether the charger authorises locally or
//     through us — it is the difference between our authorize verdict
//     mattering and being decoration.
//   • `IsAuthorizationRequired` false is why driver auth is off. **That is a
//     setting, not a fault** (framing correction 5) and recording it is how it
//     stops being rediscovered as an outage.
//   • `PropertyOcppDefaultIdTag` is the token every unauthenticated session
//     runs under. It is a TOKEN, never a person.
//
// ── EACH OBSERVATION IS DATED, AND THAT IS THE POINT ────────────────────
//
// These are observations of a remote system at an instant, not facts about
// ours. Storing the latest value alone would make "when did driver auth get
// turned off?" unanswerable — which is exactly the question the May–August gap
// raised, and exactly the one nobody could answer.

// Evidence has ONE definition, in resolution/validity.ts. This module is the
// third place it was about to be redeclared this round, and the typecheck
// caught each one — which is the duplication Phase 5 exists to end, arriving
// inside the round that is ending it.
import type { Evidence } from "../resolution/validity";
export type { Evidence } from "../resolution/validity";

/**
 * One observation of a device's vendor configuration.
 *
 * Every field is nullable because the vendor may not report it, and ledger
 * note 22 forbids expressing "not reported" as `false` or `0`. A null here
 * means the vendor did not say — it does not mean "off".
 */
export interface VendorConfigObservation {
  deviceId: string;
  observedAt: Date;
  chargerActive: boolean | null;
  authenticationType: number | null;
  isAuthorizationRequired: boolean | null;
  /** A token, never a person. */
  ocppDefaultIdTag: string | null;
}

export interface VendorConfigSinkPort {
  record(o: VendorConfigObservation): Promise<{ status: "recorded" | "unchanged" }>;
  latestFor(deviceId: string): Promise<Evidence<VendorConfigObservation>>;
}

/** Are two observations materially the same? Timestamps are ignored. */
export function sameConfig(a: VendorConfigObservation, b: VendorConfigObservation): boolean {
  return (
    a.chargerActive === b.chargerActive &&
    a.authenticationType === b.authenticationType &&
    a.isAuthorizationRequired === b.isAuthorizationRequired &&
    a.ocppDefaultIdTag === b.ocppDefaultIdTag
  );
}

/**
 * In-memory sink.
 *
 * `record` returns `unchanged` when nothing material moved, so a poll every
 * five minutes does not write 288 identical rows a day. The history is kept —
 * the question this exists to answer is *when* a setting changed.
 */
export class FixtureVendorConfigSink implements VendorConfigSinkPort {
  private readonly history = new Map<string, VendorConfigObservation[]>();

  async record(o: VendorConfigObservation): Promise<{ status: "recorded" | "unchanged" }> {
    const rows = this.history.get(o.deviceId) ?? [];
    const last = rows[rows.length - 1];
    if (last && sameConfig(last, o)) return { status: "unchanged" };
    rows.push(o);
    this.history.set(o.deviceId, rows);
    return { status: "recorded" };
  }

  async latestFor(deviceId: string): Promise<Evidence<VendorConfigObservation>> {
    const rows = this.history.get(deviceId);
    if (!rows || rows.length === 0) {
      // Never a default-shaped object. "We have never observed this device" and
      // "this device reports everything off" must not look the same.
      return { status: "unavailable", reason: "no observation recorded for this device" };
    }
    return { status: "available", value: rows[rows.length - 1]! };
  }

  /** Every observation, oldest first — the answer to "when did it change?". */
  historyFor(deviceId: string): VendorConfigObservation[] {
    return [...(this.history.get(deviceId) ?? [])];
  }
}

/** Zaptec's `AuthenticationType`. 2 is OCPP, which is the Dalvegur fleet. */
export const ZAPTEC_AUTH_TYPE = { Native: 1, Ocpp: 2 } as const;
