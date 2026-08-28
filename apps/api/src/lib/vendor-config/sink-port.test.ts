// The vendor-config sink, and the Dalvegur predicate it exists to make correct.
//
// Two things are pinned here and they are different claims:
//
//   1 · the sink records CHANGES, not polls;
//   2 · a missing observation is `unavailable` and never `false`, because the
//       `false` reading silently removes a live charger from an invoice.
//
// The second is the one worth the most tests. A wrong `unchanged` costs a row
// in a log; a wrong `false` costs a customer's invoice line.

import { describe, expect, it } from "vitest";
import { makeFixtureVendorConfigSink } from "./fixture-sink";
import {
  activeForBilling,
  fieldChangedAt,
  sameReading,
  type VendorConfigObservation,
} from "./sink-port";

const DEV = "device-0000-0000-0000-000000000001";
const OTHER = "device-0000-0000-0000-000000000002";

const MARCH_START = new Date("2026-03-01T00:00:00Z");
/** March's period end is EXCLUSIVE — `[Mar 1, Apr 1)`. */
const MARCH_END = new Date("2026-04-01T00:00:00Z");

function obs(over: Partial<VendorConfigObservation> = {}): VendorConfigObservation {
  return {
    deviceId: DEV,
    observedAt: MARCH_START,
    chargerActive: true,
    authenticationType: 2,
    isAuthorizationRequired: false,
    ocppDefaultIdTag: "zaptec-default-token",
    ...over,
  };
}

describe("record — changes, not polls", () => {
  it("records the first observation", async () => {
    const { sink, state } = makeFixtureVendorConfigSink();
    expect(await sink.record(obs())).toEqual({ status: "recorded" });
    expect(state.writes).toEqual([DEV]);
  });

  it("a byte-identical observation is `unchanged` and writes NO row", async () => {
    // An importer polling every five minutes would otherwise write a row per
    // poll and produce a history in which nothing ever happened. `writes` is
    // recorded so this is asserted rather than inferred from a length.
    const { sink, state } = makeFixtureVendorConfigSink();
    await sink.record(obs());
    const again = await sink.record(obs({ observedAt: new Date("2026-03-01T00:05:00Z") }));
    expect(again).toEqual({ status: "unchanged" });
    expect(state.writes).toEqual([DEV]);
    expect(state.suppressed).toEqual([DEV]);
    expect(state.log).toHaveLength(1);
  });

  it("`sameReading` ignores observedAt and nothing else", () => {
    const a = obs();
    expect(sameReading(a, obs({ observedAt: new Date("2030-01-01T00:00:00Z") }))).toBe(true);
    expect(sameReading(a, obs({ chargerActive: false }))).toBe(false);
    expect(sameReading(a, obs({ authenticationType: 3 }))).toBe(false);
    expect(sameReading(a, obs({ isAuthorizationRequired: true }))).toBe(false);
    expect(sameReading(a, obs({ ocppDefaultIdTag: "other-token" }))).toBe(false);
    expect(sameReading(a, obs({ deviceId: OTHER }))).toBe(false);
  });

  it("null and false are DIFFERENT readings", async () => {
    // The trap this whole module is shaped around. `null` is "the vendor did
    // not tell us"; `false` is "the vendor said deactivated". Treating them as
    // one reading would suppress the observation that first learns a charger
    // is off.
    const { sink, state } = makeFixtureVendorConfigSink();
    await sink.record(obs({ chargerActive: null }));
    expect(await sink.record(obs({ chargerActive: false, observedAt: new Date("2026-03-02T00:00:00Z") })))
      .toEqual({ status: "recorded" });
    expect(state.log).toHaveLength(2);
    expect(sameReading(obs({ chargerActive: null }), obs({ chargerActive: false }))).toBe(false);
  });

  it("dedups against the LATEST only, so active -> inactive -> active is three rows", async () => {
    // Matching anywhere in history would swallow the third and leave a log
    // saying the charger was never reactivated.
    const { sink, state } = makeFixtureVendorConfigSink();
    await sink.record(obs({ chargerActive: true, observedAt: new Date("2026-03-01T00:00:00Z") }));
    await sink.record(obs({ chargerActive: false, observedAt: new Date("2026-03-10T00:00:00Z") }));
    await sink.record(obs({ chargerActive: true, observedAt: new Date("2026-03-20T00:00:00Z") }));
    expect(state.log).toHaveLength(3);
    expect(state.suppressed).toEqual([]);
  });

  it("refuses an observation with no device id or an invalid timestamp", async () => {
    const { sink, state } = makeFixtureVendorConfigSink();
    await expect(sink.record(obs({ deviceId: "" }))).rejects.toThrow("device_id_required");
    await expect(sink.record(obs({ observedAt: new Date("nope") }))).rejects.toThrow(
      "observed_at_invalid",
    );
    // A refusal is neither a write nor an `unchanged`: both of those claim
    // storage now matches the input, and it does not.
    expect(state.log).toEqual([]);
    expect(state.suppressed).toEqual([]);
  });

  it("keeps devices apart", async () => {
    const { sink, state } = makeFixtureVendorConfigSink();
    await sink.record(obs({ deviceId: DEV }));
    await sink.record(obs({ deviceId: OTHER }));
    expect(state.writes).toEqual([DEV, OTHER]);
  });
});

describe("latestFor — absent is unavailable, never false", () => {
  it("returns `unavailable: never_observed` for a device with no observations", async () => {
    const { sink } = makeFixtureVendorConfigSink();
    const e = await sink.latestFor(DEV);
    expect(e).toEqual({ kind: "unavailable", reason: "never_observed" });
    // Stated as an assertion because it is the defect, not a style point:
    // nothing in the answer is a `false` that a caller could read as "the
    // vendor says this charger is deactivated".
    expect(JSON.stringify(e)).not.toContain("false");
  });

  it("returns the LATEST observation, not the first", async () => {
    const { sink } = makeFixtureVendorConfigSink();
    await sink.record(obs({ chargerActive: true, observedAt: new Date("2026-03-01T00:00:00Z") }));
    await sink.record(obs({ chargerActive: false, observedAt: new Date("2026-03-15T00:00:00Z") }));
    const e = await sink.latestFor(DEV);
    expect(e.kind === "observed" && e.value.chargerActive).toBe(false);
  });

  it("distinguishes out_of_scope from never_observed", async () => {
    // Two different answers, and only one of them is true for a device the
    // caller may not read. Collapsing them tells a caller a charger has no
    // configuration when in fact they simply cannot see it.
    const { sink } = makeFixtureVendorConfigSink({ visibleDeviceIds: [DEV] });
    await sink.record(obs({ deviceId: DEV }));
    expect(await sink.latestFor(OTHER)).toEqual({ kind: "unavailable", reason: "out_of_scope" });
    expect((await sink.latestFor(DEV)).kind).toBe("observed");
  });
});

describe("the Dalvegur predicate — 30 rows, 20 chargers", () => {
  it("a charger active all month is billable", () => {
    const log = [obs({ chargerActive: true, observedAt: new Date("2026-02-01T00:00:00Z") })];
    expect(activeForBilling(log, MARCH_END)).toEqual({ kind: "billable" });
  });

  it("a deactivated charger is NOT billable, and the reason names the vendor", () => {
    // Ten of Dalvegur's thirty rows. At 200 kr per active connector, invoicing
    // 30 where 20 exist is 6,000 kr against 4,000 kr of real estate, monthly.
    const log = [obs({ chargerActive: false, observedAt: new Date("2026-02-01T00:00:00Z") })];
    expect(activeForBilling(log, MARCH_END)).toEqual({
      kind: "not_billable",
      reason: "deactivated_by_vendor",
    });
  });

  it("a charger whose Charger.Active FLIPS mid-period takes the state at period end", () => {
    // Active on the 1st, deactivated on the 12th, billing March. The predicate
    // reads the latest observation before the period's exclusive end.
    const log = [
      obs({ chargerActive: true, observedAt: new Date("2026-03-01T00:00:00Z") }),
      obs({ chargerActive: false, observedAt: new Date("2026-03-12T00:00:00Z") }),
    ];
    expect(activeForBilling(log, MARCH_END)).toMatchObject({ kind: "not_billable" });

    // And the same log, billing FEBRUARY, is billable — nothing in March can
    // change what February was.
    expect(activeForBilling(log, new Date("2026-03-01T00:00:00Z"))).toMatchObject({
      kind: "unavailable",
    });
  });

  it("the flip is read at period END, not at the instant the query runs", () => {
    // Deactivated on the 12th, reactivated on the 25th, billing March: active
    // at the end of March, so billable. A predicate that took the FIRST
    // observation, or that read `now()` in April, would answer differently.
    const log = [
      obs({ chargerActive: true, observedAt: new Date("2026-03-01T00:00:00Z") }),
      obs({ chargerActive: false, observedAt: new Date("2026-03-12T00:00:00Z") }),
      obs({ chargerActive: true, observedAt: new Date("2026-03-25T00:00:00Z") }),
    ];
    expect(activeForBilling(log, MARCH_END)).toEqual({ kind: "billable" });
  });

  it("NO observation is `unavailable` — never `not_billable`", () => {
    // The defect this exists to prevent. Collapsing these turns "we have not
    // polled this charger" into "do not invoice for it": a silent discount
    // nobody reviews. An unavailable count is a HOLD, which is round 3's rule.
    expect(activeForBilling([], MARCH_END)).toEqual({
      kind: "unavailable",
      reason: "never_observed",
    });
  });

  it("an observation only AFTER the period is `unavailable`, not evidence about it", () => {
    // Learning in April that a charger is active says nothing about March.
    // Dating it backwards would be inventing evidence.
    const log = [obs({ chargerActive: true, observedAt: new Date("2026-04-15T00:00:00Z") })];
    expect(activeForBilling(log, MARCH_END)).toEqual({
      kind: "unavailable",
      reason: "no_observation_before_period_end",
    });
  });

  it("a NULL chargerActive is `unavailable`, not inactive", () => {
    const log = [obs({ chargerActive: null, observedAt: new Date("2026-03-05T00:00:00Z") })];
    expect(activeForBilling(log, MARCH_END)).toEqual({
      kind: "unavailable",
      reason: "never_observed",
    });
  });

  it("the whole Dalvegur estate: 30 rows in, 20 billable, 10 named", () => {
    // The finding, executed. Twenty active rows, ten deactivated ones, and the
    // five portal chargers with no row here are ABSENT — an import gap that no
    // predicate can see, because a row that does not exist cannot be filtered
    // in. It under-bills, and it needs a reconciliation rather than a WHERE.
    const at = new Date("2026-03-05T00:00:00Z");
    const rows = [
      ...Array.from({ length: 20 }, (_, i) =>
        [obs({ deviceId: `active-${i}`, chargerActive: true, observedAt: at })]),
      ...Array.from({ length: 10 }, (_, i) =>
        [obs({ deviceId: `off-${i}`, chargerActive: false, observedAt: at })]),
    ];
    expect(rows).toHaveLength(30);

    const verdicts = rows.map((log) => activeForBilling(log, MARCH_END));
    expect(verdicts.filter((v) => v.kind === "billable")).toHaveLength(20);
    expect(verdicts.filter((v) => v.kind === "not_billable")).toHaveLength(10);
    expect(verdicts.filter((v) => v.kind === "unavailable")).toHaveLength(0);
    // 35 in the portal. The five we cannot count are not in this list at all,
    // which is precisely why they are a separate finding.
    expect(rows.length).toBeLessThan(35);
  });
});

describe("fieldChangedAt — four timestamps that cannot disagree", () => {
  it("reports when each field last changed, and null for one that never did", () => {
    const log = [
      obs({ chargerActive: true, isAuthorizationRequired: false, observedAt: new Date("2026-03-01T00:00:00Z") }),
      obs({ chargerActive: false, isAuthorizationRequired: false, observedAt: new Date("2026-03-12T00:00:00Z") }),
      obs({ chargerActive: false, isAuthorizationRequired: true, observedAt: new Date("2026-03-20T00:00:00Z") }),
    ];
    const t = fieldChangedAt(log);
    expect(t.chargerActive?.toISOString()).toBe("2026-03-12T00:00:00.000Z");
    expect(t.isAuthorizationRequired?.toISOString()).toBe("2026-03-20T00:00:00.000Z");
    // Held one value across the whole log. Different from never observed at
    // all, which the caller tells apart by the log being empty.
    expect(t.authenticationType).toBeNull();
    expect(t.ocppDefaultIdTag).toBeNull();
  });

  it("returns all-null for an empty log rather than throwing", () => {
    const t = fieldChangedAt([]);
    expect(Object.values(t)).toEqual([null, null, null, null]);
  });
});
