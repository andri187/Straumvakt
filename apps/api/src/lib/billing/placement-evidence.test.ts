// Decision 5 — billing counts OVERLAP, and every way that goes wrong.
//
// The suite is arranged so the fool test has somewhere to land: several tests
// below pass under a current-row read and one does not, which is what makes
// reverting the join a detectable regression rather than a silent one.

import { describe, expect, it } from "vitest";
import { closed, openEnded } from "@straumvakt/shared/domain/effective-dating";
import {
  connectorSharesForPeriod,
  overlapDays,
  periodDays,
  type PeriodWindow,
  type PlacementRow,
} from "./placement-evidence";
import type { VendorConfigObservation } from "../vendor-config/sink-port";

const at = (iso: string) => new Date(iso);
/** March 2026 — 31 days, `[Mar 1, Apr 1)`. */
const MARCH: PeriodWindow = { start: at("2026-03-01T00:00:00Z"), end: at("2026-04-01T00:00:00Z") };

const HOST_A = "org-host-a";
const HOST_B = "org-host-b";
const DEVICE = "device-1";

function place(o: Partial<PlacementRow> & { id: string; period: PlacementRow["period"] }): PlacementRow {
  return {
    publicId: `pub-${o.id}`,
    deviceId: DEVICE,
    orgId: HOST_A,
    installationId: "inst-a",
    connectorIds: ["conn-1"],
    ...o,
  };
}

/** An active vendor-config log for a device, observed before March. */
function activeLog(deviceId = DEVICE, chargerActive: boolean | null = true): [string, VendorConfigObservation[]] {
  return [
    deviceId,
    [
      {
        deviceId,
        observedAt: at("2026-02-01T00:00:00Z"),
        chargerActive,
        authenticationType: 2,
        isAuthorizationRequired: false,
        ocppDefaultIdTag: "zaptec-default-token",
      },
    ],
  ];
}

const ACTIVE = new Map([activeLog()]);

describe("overlap arithmetic", () => {
  it("March is 31 days", () => {
    expect(periodDays(MARCH)).toBe(31);
  });

  it("a placement spanning the whole month overlaps every day", () => {
    expect(overlapDays(openEnded(at("2026-01-01T00:00:00Z")), MARCH)).toBe(31);
  });

  it("a placement ending mid-month overlaps only its own days", () => {
    expect(overlapDays(closed(at("2026-01-01T00:00:00Z"), at("2026-03-12T00:00:00Z")), MARCH)).toBe(11);
  });

  it("a placement entirely outside the month overlaps nothing", () => {
    expect(overlapDays(closed(at("2026-01-01T00:00:00Z"), at("2026-02-01T00:00:00Z")), MARCH)).toBe(0);
    expect(overlapDays(openEnded(at("2026-05-01T00:00:00Z")), MARCH)).toBe(0);
  });
});

describe("decision 5 — overlap, not currency", () => {
  it("bills a device placed on the 2nd and removed on the 28th", () => {
    // THE TEST THE FOOL TEST MUST BREAK. A current-row read run in April finds
    // this device placed nowhere and bills nobody for 26 days of hardware.
    const p = place({
      id: "p1",
      period: closed(at("2026-03-02T00:00:00Z"), at("2026-03-28T00:00:00Z")),
    });
    const out = connectorSharesForPeriod([p], MARCH, ACTIVE);
    expect(out.kind).toBe("counted");
    expect(out.kind === "counted" && out.shares).toHaveLength(1);
    expect(out.kind === "counted" && out.shares[0]!.orgId).toBe(HOST_A);
  });

  it("a device that moves mid-month produces ONE ROW PER HOST", () => {
    // The (org, year, month, connector) key on connector_activity_month was
    // already shaped for this before anyone knew why. Two placements, two
    // hosts, one device, one month.
    const moveDay = at("2026-03-12T00:00:00Z");
    const oldHost = place({ id: "p1", orgId: HOST_A, period: closed(at("2026-01-01T00:00:00Z"), moveDay) });
    const newHost = place({ id: "p2", orgId: HOST_B, period: openEnded(moveDay) });

    const out = connectorSharesForPeriod([oldHost, newHost], MARCH, ACTIVE);
    expect(out.kind).toBe("counted");
    const shares = out.kind === "counted" ? out.shares : [];
    expect(shares.map((s) => s.orgId).sort()).toEqual([HOST_A, HOST_B]);
    expect(shares.find((s) => s.orgId === HOST_A)!.overlapDays).toBe(11);
    expect(shares.find((s) => s.orgId === HOST_B)!.overlapDays).toBe(20);
    expect(11 + 20).toBe(periodDays(MARCH));
  });

  it("a device that moves on the LAST DAY still gives the new host a row", () => {
    // One day, and it is not nothing: under `whole_month_per_host` it is a
    // full fee, which is exactly the case that makes proration arguable.
    const moveDay = at("2026-03-31T00:00:00Z");
    const oldHost = place({ id: "p1", orgId: HOST_A, period: closed(at("2026-01-01T00:00:00Z"), moveDay) });
    const newHost = place({ id: "p2", orgId: HOST_B, period: openEnded(moveDay) });

    const out = connectorSharesForPeriod([oldHost, newHost], MARCH, ACTIVE);
    const shares = out.kind === "counted" ? out.shares : [];
    expect(shares).toHaveLength(2);
    expect(shares.find((s) => s.orgId === HOST_B)!.overlapDays).toBe(1);
    expect(shares.find((s) => s.orgId === HOST_A)!.overlapDays).toBe(30);
  });

  it("a device that moves TWICE gives three hosts three rows", () => {
    const d1 = at("2026-03-10T00:00:00Z");
    const d2 = at("2026-03-20T00:00:00Z");
    const out = connectorSharesForPeriod(
      [
        place({ id: "p1", orgId: HOST_A, period: closed(at("2026-01-01T00:00:00Z"), d1) }),
        place({ id: "p2", orgId: HOST_B, period: closed(d1, d2) }),
        place({ id: "p3", orgId: "org-host-c", period: openEnded(d2) }),
      ],
      MARCH,
      ACTIVE,
    );
    const shares = out.kind === "counted" ? out.shares : [];
    expect(shares).toHaveLength(3);
    expect(shares.map((s) => s.overlapDays)).toEqual([9, 10, 12]);
    expect(shares.reduce((a, s) => a + s.overlapDays, 0)).toBe(31);
  });

  it("a placement that opens and CLOSES INSIDE ONE DAY still counts", () => {
    // Installed at 09:00 and removed at 17:00 on the 15th. Zero whole days of
    // overlap, and it is emphatically not zero placements: the host had the
    // hardware, and a rule that drops it invites a fleet of one-day
    // installations that are never billed.
    const p = place({
      id: "p1",
      period: closed(at("2026-03-15T09:00:00Z"), at("2026-03-15T17:00:00Z")),
    });
    const out = connectorSharesForPeriod([p], MARCH, ACTIVE);
    expect(out.kind).toBe("counted");
    const shares = out.kind === "counted" ? out.shares : [];
    expect(shares).toHaveLength(1);
    // Rounded to 0 whole days — which under proration is a share of 0/31, and
    // is why `whole_month_per_host` is the default rather than a nuisance.
    expect(shares[0]!.overlapDays).toBe(0);
    expect(shares[0]!.shareNumerator).toBe(1);
  });

  it("a device placed only AFTER the period ends is not counted at all", () => {
    const p = place({ id: "p1", period: openEnded(at("2026-04-05T00:00:00Z")) });
    expect(connectorSharesForPeriod([p], MARCH, ACTIVE)).toEqual({
      kind: "unavailable",
      reason: "no_placements_for_period",
    });
  });

  it("a placement that ended before the period began is not counted", () => {
    const p = place({ id: "p1", period: closed(at("2026-01-01T00:00:00Z"), at("2026-03-01T00:00:00Z")) });
    expect(connectorSharesForPeriod([p], MARCH, ACTIVE)).toMatchObject({ kind: "unavailable" });
  });
});

describe("no placements is UNAVAILABLE, never zero", () => {
  it("an empty placement list holds rather than invoicing for nothing", () => {
    // Ledger note 22. "No placements overlapped this period" and "we have not
    // loaded any placements" are the same empty list, and only one of them is
    // a fact about the estate.
    expect(connectorSharesForPeriod([], MARCH, ACTIVE)).toEqual({
      kind: "unavailable",
      reason: "no_placements_for_period",
    });
  });

  it("a device with NO vendor-config log makes the whole period unavailable", () => {
    // Not "drop that one device": an invoice short by one connector looks
    // complete. Refusing the period is the visible failure.
    const p = place({ id: "p1", period: openEnded(at("2026-01-01T00:00:00Z")) });
    expect(connectorSharesForPeriod([p], MARCH, new Map())).toEqual({
      kind: "unavailable",
      reason: "vendor_config_unavailable",
    });
  });

  it("a NULL chargerActive is unavailable, not inactive", () => {
    const p = place({ id: "p1", period: openEnded(at("2026-01-01T00:00:00Z")) });
    const log = new Map([activeLog(DEVICE, null)]);
    expect(connectorSharesForPeriod([p], MARCH, log)).toMatchObject({
      kind: "unavailable",
      reason: "vendor_config_unavailable",
    });
  });

  it("a vendor-DEACTIVATED device is counted-and-empty, which is a measured zero", () => {
    // The one place an empty answer is NOT unavailable: we looked, we have the
    // evidence, and the answer is genuinely "none of these are billable".
    // Measured zero is legal; ASSUMED zero is not.
    const p = place({ id: "p1", period: openEnded(at("2026-01-01T00:00:00Z")) });
    const log = new Map([activeLog(DEVICE, false)]);
    expect(connectorSharesForPeriod([p], MARCH, log)).toEqual({ kind: "counted", shares: [] });
  });
});

describe("the proration fork", () => {
  const moveDay = at("2026-03-12T00:00:00Z");
  const twoHosts = [
    place({ id: "p1", orgId: HOST_A, period: closed(at("2026-01-01T00:00:00Z"), moveDay) }),
    place({ id: "p2", orgId: HOST_B, period: openEnded(moveDay) }),
  ];

  it("whole_month_per_host — the DEFAULT — gives each host a full share", () => {
    // Today's behaviour, unchanged. One device produces two full connector
    // months: 400 kr for 200 kr of hardware, with both hosts' consent.
    const out = connectorSharesForPeriod(twoHosts, MARCH, ACTIVE, "whole_month_per_host");
    const shares = out.kind === "counted" ? out.shares : [];
    expect(shares.map((s) => [s.shareNumerator, s.shareDenominator])).toEqual([[1, 1], [1, 1]]);
  });

  it("prorate_by_overlap_days — RECOMMENDED — splits one month between them", () => {
    const out = connectorSharesForPeriod(twoHosts, MARCH, ACTIVE, "prorate_by_overlap_days");
    const shares = out.kind === "counted" ? out.shares : [];
    expect(shares.map((s) => [s.shareNumerator, s.shareDenominator])).toEqual([[11, 31], [20, 31]]);
    // The property that makes the invoice explainable: the shares sum to
    // exactly one connector-month, however many hosts held the device.
    expect(shares.reduce((a, s) => a + s.shareNumerator, 0)).toBe(shares[0]!.shareDenominator);
  });

  it("the default is whole_month_per_host, so nothing changes without a decision", () => {
    // Asserted rather than assumed: changing what an invoice says must not be
    // a side effect of a schema change.
    const explicit = connectorSharesForPeriod(twoHosts, MARCH, ACTIVE, "whole_month_per_host");
    const implicit = connectorSharesForPeriod(twoHosts, MARCH, ACTIVE);
    expect(implicit).toEqual(explicit);
  });

  it("proration is a share, never a rounded money amount", () => {
    // The numerator and denominator are carried whole. A float here would put
    // a rounding decision in the wrong layer — the money engine works in
    // aurar as BigInt and owns every rounding rule.
    const out = connectorSharesForPeriod(twoHosts, MARCH, ACTIVE, "prorate_by_overlap_days");
    const shares = out.kind === "counted" ? out.shares : [];
    for (const s of shares) {
      expect(Number.isInteger(s.shareNumerator)).toBe(true);
      expect(Number.isInteger(s.shareDenominator)).toBe(true);
    }
  });
});

describe("a placement with NO connectors — found by fallback item 1", () => {
  it("holds the period rather than contributing a silent zero", () => {
    // A first onboarding with no BootNotification deliberately writes no EVSE
    // and no connector rather than inventing one at index 1. Before this, such
    // a placement contributed nothing to the shares — a MEASURED zero for a
    // device we have never heard from, which is ledger note 22's exact failure
    // reached from a direction nobody was watching.
    const p = place({ id: "p1", period: openEnded(at("2026-01-01T00:00:00Z")), connectorIds: [] });
    expect(connectorSharesForPeriod([p], MARCH, ACTIVE)).toEqual({
      kind: "unavailable",
      reason: "placement_without_connectors",
    });
  });

  it("holds even when OTHER placements in the same period are fine", () => {
    // Skipping just the connectorless one would produce an invoice that looks
    // complete and is short by one charger. The whole period holds.
    const good = place({ id: "p-good", period: openEnded(at("2026-01-01T00:00:00Z")) });
    const bare = place({
      id: "p-bare",
      deviceId: "device-2",
      period: openEnded(at("2026-01-01T00:00:00Z")),
      connectorIds: [],
    });
    const log = new Map([activeLog("device-1"), activeLog("device-2")]);
    expect(connectorSharesForPeriod([good, bare], MARCH, log)).toMatchObject({
      kind: "unavailable",
      reason: "placement_without_connectors",
    });
  });

  it("a vendor-DEACTIVATED connectorless placement is skipped before the check", () => {
    // Order matters: a deactivated device is not billable at all, so its
    // missing connectors are not a gap in anything. Holding on it would make a
    // decommissioned charger block a whole invoice.
    const bare = place({ id: "p1", period: openEnded(at("2026-01-01T00:00:00Z")), connectorIds: [] });
    const log = new Map([activeLog(DEVICE, false)]);
    expect(connectorSharesForPeriod([bare], MARCH, log)).toEqual({ kind: "counted", shares: [] });
  });
});
