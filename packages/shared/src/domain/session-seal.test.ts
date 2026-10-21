// ADR 0054 decision 6 — a session is sealed, and what that has to survive.
//
// The columns are in migration 0008 and no database in this lane has them, so
// what is testable is the CLAIM: that a sealed session keeps answering
// correctly after the world underneath it changes. Each test below changes the
// world and asserts the session did not move.
//
// The seal is modelled as the row shape the schema stores. If the columns are
// later dropped or made non-nullable, `check:schema-consistency` is what
// catches it; this file catches the reasoning.

import { describe, expect, it } from "vitest";
import {
  checkTemporalKey,
  closed,
  containsInstant,
  openEnded,
  overlaps,
  rowsOverlappingPeriod,
  type DatedRow,
  type Tstzrange,
} from "./effective-dating";

const at = (iso: string) => new Date(iso);
const JAN1 = at("2026-01-01T00:00:00Z");
const FEB1 = at("2026-02-01T00:00:00Z");
const MAR1 = at("2026-03-01T00:00:00Z");
const FEBRUARY = closed(FEB1, MAR1);

/** The three columns migration 0008 adds, plus what was already there. */
interface SealedSession {
  id: string;
  orgId: string;
  siteId: string;
  chargingStationId: string;
  evseId: string;
  startedAt: Date;
  placementId: string | null;
  tariffSnapshotJson: {
    code: string;
    basis: string;
    priceMinor: string;
    currency: string;
    vatRatePct: string;
    supplierOrgId: string | null;
  } | null;
  tariffSnapshotAt: Date | null;
}

interface Placement extends DatedRow {
  deviceId: string;
  orgId: string;
  installationId: string;
}

const placement = (o: Partial<Placement> & { id: string; period: Tstzrange }): Placement => ({
  deviceId: "device-1",
  orgId: "org-site-a",
  installationId: "inst-a",
  ...o,
});

function sessionOn(p: Placement, startedAt: Date, over: Partial<SealedSession> = {}): SealedSession {
  return {
    id: `sess-${startedAt.toISOString()}`,
    orgId: p.orgId,
    siteId: "site-a",
    chargingStationId: "station-1",
    evseId: "evse-1",
    startedAt,
    placementId: p.id,
    tariffSnapshotJson: {
      code: "ISK-KWH-STD",
      basis: "per_kwh",
      priceMinor: "4500",
      currency: "ISK",
      vatRatePct: "24.00",
      supplierOrgId: "supplier-1",
    },
    tariffSnapshotAt: startedAt,
    ...over,
  };
}

describe("a session already carried its own context, and that was checked first", () => {
  it("holds org, site, station and evse without resolving anything at read time", () => {
    // All four are NOT NULL on charging.sessions today. Migration 0008 adds to
    // that rather than fixing it — a session already survives a device moving
    // tenant, because nothing about it is looked up through the charger row.
    const p = placement({ id: "p1", period: openEnded(JAN1) });
    const s = sessionOn(p, at("2026-02-10T09:00:00Z"));
    for (const v of [s.orgId, s.siteId, s.chargingStationId, s.evseId]) {
      expect(typeof v).toBe("string");
      expect(v).not.toBe("");
    }
  });
});

describe("a session sealed with a placement that later CLOSES", () => {
  const p = placement({ id: "p-open", period: openEnded(JAN1) });
  const session = sessionOn(p, at("2026-02-10T09:00:00Z"));

  it("keeps pointing at the same placement after the placement is closed", () => {
    // The device is removed on 20 Feb. The placement row does not go away and
    // does not change identity — only its period's upper bound is set.
    const closedPlacement: Placement = { ...p, period: closed(JAN1, at("2026-02-20T00:00:00Z")) };
    expect(session.placementId).toBe(closedPlacement.id);
    // And the session's start is still inside the placement's interval, so the
    // attribution is still correct rather than merely unchanged.
    expect(containsInstant(closedPlacement.period, session.startedAt)).toBe(true);
  });

  it("is still attributed to the ORIGINAL host after the device moves on", () => {
    // 20 Feb: closed at site A, opened at site B under a different org. The
    // session ran on 10 Feb and belongs to site A, permanently.
    const moveDay = at("2026-02-20T00:00:00Z");
    const oldHost: Placement = { ...p, period: closed(JAN1, moveDay) };
    const newHost = placement({
      id: "p-b",
      orgId: "org-site-b",
      installationId: "inst-b",
      period: openEnded(moveDay),
    });

    expect(checkTemporalKey([oldHost], newHost, (r) => r.deviceId === "device-1")).toEqual({
      ok: true,
    });
    expect(session.placementId).toBe(oldHost.id);
    expect(session.orgId).toBe("org-site-a");

    // The re-attribution decision 6 forbids: resolving the session's host by
    // asking where the device is NOW returns site B, and would be wrong.
    const hostNow = [oldHost, newHost].find((x) => x.period.until === null)!;
    expect(hostNow.orgId).toBe("org-site-b");
    expect(hostNow.orgId).not.toBe(session.orgId);
  });

  it("a session started after the move belongs to the new host", () => {
    const moveDay = at("2026-02-20T00:00:00Z");
    const newHost = placement({ id: "p-b", orgId: "org-site-b", period: openEnded(moveDay) });
    const later = sessionOn(newHost, at("2026-02-25T09:00:00Z"));
    expect(later.orgId).toBe("org-site-b");
    expect(containsInstant(newHost.period, later.startedAt)).toBe(true);
  });
});

describe("a session whose TARIFF changed after it started", () => {
  it("keeps the price it was sealed with, not the current one", () => {
    // Rate references are effective-dated and superseded. Re-resolving "what
    // did this cost" against today's rows is the re-derivation FOCUS rule 4
    // forbids, and it is silent — the number simply comes out different.
    const p = placement({ id: "p1", period: openEnded(JAN1) });
    const session = sessionOn(p, at("2026-02-10T09:00:00Z"));

    const currentRate = {
      code: "ISK-KWH-STD",
      priceMinor: "5200",
      effectiveFrom: at("2026-02-15T00:00:00Z"),
    };
    expect(session.tariffSnapshotJson?.priceMinor).toBe("4500");
    expect(session.tariffSnapshotJson?.priceMinor).not.toBe(currentRate.priceMinor);
    // The snapshot predates the change, which is what makes it the right one.
    expect(session.tariffSnapshotAt!.getTime()).toBeLessThan(currentRate.effectiveFrom.getTime());
  });

  it("carries the whole applied rate, not just a code", () => {
    // A code alone is a reference by another name: resolving it still means
    // reading a table whose rows have moved on. Basis, price, currency, VAT
    // and the supplying party are all sealed.
    const p = placement({ id: "p1", period: openEnded(JAN1) });
    const t = sessionOn(p, at("2026-02-10T09:00:00Z")).tariffSnapshotJson!;
    expect(Object.keys(t).sort()).toEqual([
      "basis",
      "code",
      "currency",
      "priceMinor",
      "supplierOrgId",
      "vatRatePct",
    ]);
  });

  it("a session that predates the seal is `unavailable`, not zero-priced", () => {
    // Nulls on every legacy row, and deliberately not backfilled: inventing a
    // placement means deciding where a device was during a period nothing
    // recorded, and inventing a tariff means running today's resolver over
    // yesterday's sessions — the exact thing the column exists to prevent.
    const legacy = sessionOn(placement({ id: "p1", period: openEnded(JAN1) }), FEB1, {
      placementId: null,
      tariffSnapshotJson: null,
      tariffSnapshotAt: null,
    });
    expect(legacy.placementId).toBeNull();
    expect(legacy.tariffSnapshotJson).toBeNull();
    // The distinction that matters: null is not a zero price.
    expect(legacy.tariffSnapshotJson?.priceMinor).toBeUndefined();
  });

  it("the snapshot is taken at START, and a stop-time snapshot would be wrong", () => {
    // A session straddling a 14:00 rate change: started 13:30, stopped 14:30.
    // Sealing at stop time prices the whole session at the new rate.
    const p = placement({ id: "p1", period: openEnded(JAN1) });
    const startedAt = at("2026-02-15T13:30:00Z");
    const stoppedAt = at("2026-02-15T14:30:00Z");
    const rateChangeAt = at("2026-02-15T14:00:00Z");
    const s = sessionOn(p, startedAt);

    expect(s.tariffSnapshotAt!.getTime()).toBe(startedAt.getTime());
    expect(s.tariffSnapshotAt!.getTime()).toBeLessThan(rateChangeAt.getTime());
    expect(stoppedAt.getTime()).toBeGreaterThan(rateChangeAt.getTime());
    // Stored separately from started_at precisely so a divergence is visible
    // rather than assumed away.
    expect(s.tariffSnapshotAt!.getTime()).not.toBe(stoppedAt.getTime());
  });
});

describe("the mid-month move, end to end", () => {
  it("splits February's sessions between two hosts by their seal, not by a query", () => {
    const moveDay = at("2026-02-12T00:00:00Z");
    const oldHost = placement({ id: "m1", orgId: "org-site-a", period: closed(JAN1, moveDay) });
    const newHost = placement({ id: "m2", orgId: "org-site-b", period: openEnded(moveDay) });

    const sessions = [
      sessionOn(oldHost, at("2026-02-03T08:00:00Z")),
      sessionOn(oldHost, at("2026-02-11T23:00:00Z")),
      sessionOn(newHost, at("2026-02-12T00:30:00Z")),
      sessionOn(newHost, at("2026-02-27T08:00:00Z")),
    ];

    const byHost = (orgId: string) => sessions.filter((s) => s.orgId === orgId);
    expect(byHost("org-site-a")).toHaveLength(2);
    expect(byHost("org-site-b")).toHaveLength(2);

    // Both placements are billable for February (decision 5), and neither
    // overlaps the other (decision 3) — the pair the constraint permits.
    expect(rowsOverlappingPeriod([oldHost, newHost], FEBRUARY)).toHaveLength(2);
    expect(overlaps(oldHost.period, newHost.period)).toBe(false);

    // Every session's start falls inside the placement it was sealed with.
    for (const s of sessions) {
      const p = [oldHost, newHost].find((x) => x.id === s.placementId)!;
      expect(containsInstant(p.period, s.startedAt)).toBe(true);
    }
  });

  it("the session at 00:30 on move day belongs to the NEW host, by half-open bounds", () => {
    // The boundary case, and the reason the interval is `[from, until)`: the
    // old placement ends AT midnight and does not contain it; the new one
    // starts at midnight and does. There is no instant both claim and no
    // instant neither claims.
    const moveDay = at("2026-02-12T00:00:00Z");
    const oldHost = placement({ id: "m1", orgId: "org-site-a", period: closed(JAN1, moveDay) });
    const newHost = placement({ id: "m2", orgId: "org-site-b", period: openEnded(moveDay) });

    expect(containsInstant(oldHost.period, moveDay)).toBe(false);
    expect(containsInstant(newHost.period, moveDay)).toBe(true);

    const s = sessionOn(newHost, moveDay);
    expect(s.orgId).toBe("org-site-b");
    expect(MAR1.getTime()).toBeGreaterThan(moveDay.getTime());
  });
});
