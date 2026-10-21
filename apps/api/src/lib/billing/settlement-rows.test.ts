// The translation layer, tested against real snapshots.
//
// Every fixture here comes from buildSettlementSnapshot / buildDriverStatement
// rather than being hand-written. A hand-written snapshot tests my idea of what
// the pure module produces; a real one tests what it actually produces, and has
// already caught three wrong assumptions in this lane about API shape.
//
// The negative cases are the point. Each one is a way a wrong number could
// reach a customer while looking deliberate.

import { describe, expect, it } from "vitest";
import {
  buildDriverStatement,
  buildSettlementSnapshot,
  repriceExVat,
  roundAurarToIsk,
  roundingDriftIsk,
  snapshotIsImmutableUnder,
  sumRoundedLinesIsk,
  type RateComponentInput,
  type SettlementInput,
  type SettlementSnapshot,
} from "@straumvakt/commercial";
import {
  buildSettlementRows,
  buildStatementRows,
  MappingError,
  settlementsBlockingClose,
} from "./settlement-rows";

const AT = (s: string) => new Date(s);

const ORG = "3f8a1c2e-4b5d-4e6f-8a9b-0c1d2e3f4a5b";
const OTHER_ORG = "9e8d7c6b-5a4f-4e3d-8c2b-1a0f9e8d7c6b";
const PERIOD = "7a6b5c4d-3e2f-4a1b-8c9d-0e1f2a3b4c5d";
const DRIVER = "11111111-2222-4333-8444-555555555555";
const CONNECTOR = "22222222-3333-4444-8555-666666666666";
const SESSION = "33333333-4444-4555-8666-777777777777";
const STMT = "44444444-5555-4666-8777-888888888888";

const DSO: RateComponentInput = {
  kind: "dso",
  rateVersionId: "0a1b2c3d-4e5f-4061-8273-849506172839",
  pricePerKwhMinor: 864n,
  effectiveFrom: AT("2026-01-01T00:00:00Z"),
  effectiveUntil: null,
};

const RETAILER: RateComponentInput = {
  kind: "retailer",
  rateVersionId: "1b2c3d4e-5f60-4718-9384-0a5b6c7d8e9f",
  pricePerKwhMinor: 1_047n,
  effectiveFrom: AT("2026-01-01T00:00:00Z"),
  effectiveUntil: null,
};

function input(over: Partial<SettlementInput> = {}): SettlementInput {
  return {
    orgId: ORG,
    sessionId: SESSION,
    connectorId: CONNECTOR,
    driverId: DRIVER,
    startedAt: AT("2026-07-14T18:00:00Z"),
    stoppedAt: AT("2026-07-14T21:30:00Z"),
    meterStartWh: 1_000_000,
    meterStopWh: 1_034_000,
    components: [DSO, RETAILER],
    vatRatePct: 24,
    provenance: "ocpp",
    pricedAt: AT("2026-08-01T00:00:00Z"),
    ...over,
  };
}

const snap = (over: Partial<SettlementInput> = {}) => buildSettlementSnapshot(input(over));

const rows = (s: SettlementSnapshot, orgId = ORG) =>
  buildSettlementRows({ snapshot: s, periodId: PERIOD, orgId });

// ─────────────────────────────────────────────────────────────────────────────
// Cross-tenant
// ─────────────────────────────────────────────────────────────────────────────

describe("cross-tenant: the mapper compares the tenant, it does not read it", () => {
  it("refuses a snapshot belonging to another org", () => {
    const s = snap({ orgId: OTHER_ORG });
    expect(() => rows(s, ORG)).toThrow(MappingError);
  });

  it("names the refusal so a handler can distinguish it from a bug", () => {
    try {
      rows(snap({ orgId: OTHER_ORG }), ORG);
      expect.unreachable("should have refused");
    } catch (e) {
      expect((e as MappingError).refusal).toBe("cross_tenant_snapshot");
      expect((e as MappingError).message).toContain(OTHER_ORG);
    }
  });

  it("stamps the CALLER's org onto every child row, never the payload's", () => {
    const { settlement, components, holds } = rows(snap({ manualHold: true }));
    expect(settlement.orgId).toBe(ORG);
    for (const c of components) expect(c.orgId).toBe(ORG);
    for (const h of holds) expect(h.orgId).toBe(ORG);
  });

  it("refuses a statement built for another org", () => {
    const doc = buildDriverStatement({
      period: { orgId: OTHER_ORG, year: 2026, month: 7 },
      driverId: DRIVER,
      snapshots: [],
      generatedAt: AT("2026-08-01T00:00:00Z"),
    });
    expect(() =>
      buildStatementRows({
        document: doc,
        orgId: ORG,
        periodId: PERIOD,
        statementId: STMT,
        ownSessionIds: new Set(),
      }),
    ).toThrow(/org/);
  });

  it("refuses a foreign session id in the excluded list", () => {
    // buildDriverStatement already drops foreign snapshots. This guards the
    // case where a caller widens the list afterwards — a session id belonging
    // to another tenant printed on a customer's bill is the worst possible
    // place for the unscoped-read problem to surface.
    const held = snap({ manualHold: true });
    const doc = buildDriverStatement({
      period: { orgId: ORG, year: 2026, month: 7 },
      driverId: DRIVER,
      snapshots: [held],
      generatedAt: AT("2026-08-01T00:00:00Z"),
    });
    expect(doc.excludedSessionIds).toEqual([SESSION]);
    expect(() =>
      buildStatementRows({
        document: doc,
        orgId: ORG,
        periodId: PERIOD,
        statementId: STMT,
        ownSessionIds: new Set(), // caller cannot vouch for it
      }),
    ).toThrow(/not one of org/);
  });

  it("refuses a line referencing a session the caller cannot vouch for", () => {
    const doc = buildDriverStatement({
      period: { orgId: ORG, year: 2026, month: 7 },
      driverId: DRIVER,
      snapshots: [snap()],
      generatedAt: AT("2026-08-01T00:00:00Z"),
    });
    expect(() =>
      buildStatementRows({
        document: doc,
        orgId: ORG,
        periodId: PERIOD,
        statementId: STMT,
        ownSessionIds: new Set(["some-other-session"]),
      }),
    ).toThrow(/line references session/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Rate lock-in and rounding
// ─────────────────────────────────────────────────────────────────────────────

describe("rate lock-in: the price is a copy, not a join", () => {
  it("copies unit price and effective window onto each component row", () => {
    const { components } = rows(snap());
    const dso = components.find((c) => c.kind === "dso");
    expect(dso?.unitPriceMinor).toBe(864n);
    expect(dso?.rateVersionId).toBe(DSO.rateVersionId);
    expect(dso?.effectiveFrom).toEqual(AT("2026-01-01T00:00:00Z"));
    expect(dso?.effectiveUntil).toBeNull();
  });

  it("writes one component row per rate kind, so (session, kind) is unique", () => {
    const { components } = rows(snap());
    expect(components).toHaveLength(2);
    expect(new Set(components.map((c) => c.kind)).size).toBe(2);
  });

  it("a later rate edit does not move the stored figure", () => {
    const s = snap();
    const edited: RateComponentInput[] = [
      { ...DSO, pricePerKwhMinor: 9_999n },
      { ...RETAILER, pricePerKwhMinor: 9_999n },
    ];
    expect(snapshotIsImmutableUnder(s, edited)).toBe(true);
    expect(repriceExVat(s, edited)).not.toBe(s.amountExVatMinor);
  });

  it("REFUSES to call a snapshot immutable when its stored total disagrees with its own prices", () => {
    // The self-consistency half. A snapshot storing one price and billing
    // another is the exact failure the old vacuous implementation could not see.
    const s = snap();
    const tampered = { ...s, amountExVatMinor: s.amountExVatMinor + 1n };
    expect(snapshotIsImmutableUnder(tampered, [DSO, RETAILER])).toBe(false);
  });

  it("does not mistake a zero-energy session for a lock failure", () => {
    const s = snap({ meterStartWh: 1_000_000, meterStopWh: 1_000_000 });
    expect(s.energyWh).toBe(0);
    expect(snapshotIsImmutableUnder(s, [{ ...DSO, pricePerKwhMinor: 9_999n }])).toBe(true);
  });

  it("holds when NO rate window covers session start", () => {
    const late: RateComponentInput = { ...DSO, effectiveFrom: AT("2026-08-01T00:00:00Z") };
    const { settlement, holds } = rows(snap({ components: [late] }));
    expect(settlement.status).toBe("billing_review_required");
    expect(holds.map((h) => h.reason)).toContain("no_rate_at_session_start");
  });

  it("PINS A GAP: partial rate coverage settles silently on the components that remain", () => {
    // I expected this to hold and it does not. buildSettlementSnapshot raises
    // no_rate_at_session_start only when usable.length === 0
    // (settlement.ts:236), so a session whose DSO window has moved but whose
    // retailer window has not is priced on the retailer alone — settled, no
    // hold, no warning, and materially UNDER-billed.
    //
    // Pinned rather than fixed: changing the rule is a pricing decision, not a
    // bug fix, and it is listed as a decision needed in the readiness board.
    // Pinned rather than left untested, because the next reader will otherwise
    // assume "rate lock-in" covers this. It does not.
    const late: RateComponentInput = { ...DSO, effectiveFrom: AT("2026-08-01T00:00:00Z") };
    const partial = snap({ components: [late, RETAILER] });
    const full = snap();

    expect(partial.status).toBe("settled");
    expect(partial.components).toHaveLength(1);
    expect(partial.components[0].kind).toBe("retailer");
    expect(rows(partial).holds).toHaveLength(0);
    // …and the customer is charged less than they would have been:
    expect(partial.totalIsk).toBeLessThan(full.totalIsk);
  });

  it("an expired rate window is excluded even though its row still exists", () => {
    const expired: RateComponentInput = {
      ...DSO,
      effectiveUntil: AT("2026-07-01T00:00:00Z"),
    };
    const s = snap({ components: [expired] });
    expect(s.components).toHaveLength(0);
    expect(rows(s).components).toHaveLength(0);
  });

  it("a window ending exactly at session start does not cover it", () => {
    const boundary: RateComponentInput = {
      ...DSO,
      effectiveUntil: AT("2026-07-14T18:00:00Z"),
    };
    expect(snap({ components: [boundary] }).components).toHaveLength(0);
  });

  it("a window beginning exactly at session start does cover it", () => {
    const boundary: RateComponentInput = {
      ...DSO,
      effectiveFrom: AT("2026-07-14T18:00:00Z"),
    };
    expect(snap({ components: [boundary] }).components).toHaveLength(1);
  });
});

describe("rounding: both figures are stored, and they differ", () => {
  it("keeps aurar as bigint and never as a JS number", () => {
    const { settlement } = rows(snap());
    expect(typeof settlement.amountExVatMinor).toBe("bigint");
    expect(typeof settlement.vatMinor).toBe("bigint");
    expect(typeof settlement.totalIncVatMinor).toBe("bigint");
    expect(typeof settlement.totalIsk).toBe("bigint");
  });

  it("stores the billed ISK figure alongside the unrounded aurar", () => {
    const s = snap();
    const { settlement } = rows(s);
    expect(settlement.totalIsk).toBe(roundAurarToIsk(s.totalIncVatMinor));
    expect(settlement.totalIncVatMinor).not.toBe(settlement.totalIsk);
  });

  it("REFUSES a statement whose total is not the sum of its rounded lines", () => {
    const doc = buildDriverStatement({
      period: { orgId: ORG, year: 2026, month: 7 },
      driverId: DRIVER,
      snapshots: [snap()],
      generatedAt: AT("2026-08-01T00:00:00Z"),
    });
    const lying = { ...doc, totalIsk: doc.totalIsk + 1n };
    expect(() =>
      buildStatementRows({
        document: lying,
        orgId: ORG,
        periodId: PERIOD,
        statementId: STMT,
        ownSessionIds: new Set([SESSION]),
      }),
    ).toThrow(/sum of rounded lines/);
  });

  it("sum-of-rounded and rounding-of-sum genuinely disagree, so storing one is not enough", () => {
    // sumRoundedLinesIsk takes ALREADY-ROUNDED ISK, by design — it is
    // structurally impossible to call it with aurar and get the forbidden
    // answer. roundingDriftIsk is the one that takes aurar and reports the gap.
    const aurar = [250n, 250n, 250n];
    const correct = sumRoundedLinesIsk(aurar.map(roundAurarToIsk));
    const forbidden = roundAurarToIsk(aurar.reduce((a, b) => a + b, 0n));
    expect(correct).toBe(9n); // 2.50 kr → 3 kr, three times
    expect(forbidden).toBe(8n); // 7.50 kr → 8 kr, once
    expect(roundingDriftIsk(aurar)).toBe(1n);
    // A fixture with zero drift would let a wrong implementation pass, so the
    // non-zero drift above is the part that makes this test mean anything.
    expect(roundingDriftIsk([100n, 100n])).toBe(0n);
  });

  it("line amounts round half-up and sum to the header", () => {
    const doc = buildDriverStatement({
      period: { orgId: ORG, year: 2026, month: 7 },
      driverId: DRIVER,
      snapshots: [snap()],
      generatedAt: AT("2026-08-01T00:00:00Z"),
    });
    const { statement, lines } = buildStatementRows({
      document: doc,
      orgId: ORG,
      periodId: PERIOD,
      statementId: STMT,
      ownSessionIds: new Set([SESSION]),
    });
    expect(lines.reduce((a, l) => a + l.amountIsk, 0n)).toBe(statement.totalIsk);
    for (const l of lines) expect(l.amountIsk).toBe(roundAurarToIsk(l.amountMinor));
  });

  it("VAT is not recomputed at the storage boundary — the rate is copied as text", () => {
    const { settlement } = rows(snap());
    expect(settlement.vatRatePct).toBe("24.00");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// CDR / meter trust
// ─────────────────────────────────────────────────────────────────────────────

describe("CDR and meter trust: a doubtful figure is held, never quietly billed", () => {
  it("holds when the meter stop reading is missing", () => {
    const { settlement, holds } = rows(snap({ meterStopWh: null }));
    expect(settlement.status).toBe("billing_review_required");
    expect(holds.map((h) => h.reason)).toContain("meter_unresolvable");
    expect(settlement.energyWh).toBeNull();
  });

  it("holds when the meter runs backwards, and says so specifically", () => {
    // Not meter_unresolvable — that is "we could not read it". A stop reading
    // below the start reading is a different fact: we read it, and the answer
    // is impossible. An operator needs to be able to tell those apart.
    const { holds } = rows(snap({ meterStartWh: 1_034_000, meterStopWh: 1_000_000 }));
    expect(holds.map((h) => h.reason)).toContain("negative_or_impossible_energy");
    expect(holds.map((h) => h.reason)).not.toContain("meter_unresolvable");
  });

  it("holds when a CDR disagrees beyond tolerance", () => {
    const { settlement, holds } = rows(snap({ cdrEnergyKwh: 40 }));
    expect(settlement.status).toBe("billing_review_required");
    expect(holds.map((h) => h.reason)).toContain("cdr_mismatch_beyond_tolerance");
  });

  it("does NOT hold when a CDR agrees within tolerance", () => {
    const { settlement, holds } = rows(snap({ cdrEnergyKwh: 34.01 }));
    expect(settlement.status).toBe("settled");
    expect(holds).toHaveLength(0);
  });

  it("records the CDR figure alongside the meter figure, so a dispute has both", () => {
    const s = snap({ cdrEnergyKwh: 34.01 });
    const { settlement } = buildSettlementRows({
      snapshot: s,
      periodId: PERIOD,
      orgId: ORG,
      cdrEnergyKwh: 34.01,
    });
    expect(settlement.cdrEnergyKwh).toBe("34.010");
    expect(settlement.meterStartWh).toBe(1_000_000);
    expect(settlement.meterStopWh).toBe(1_034_000);
  });

  it("carries provenance and the lifecycle state as separate facts", () => {
    const { settlement } = rows(snap());
    expect(settlement.provenance).toBe("ocpp");
    expect(settlement.provenanceState).toBe("ocpp_derived");
  });

  it("a manual hold is recorded as its own reason, not folded into another", () => {
    const { holds } = rows(snap({ manualHold: true }));
    expect(holds.map((h) => h.reason)).toContain("manual_hold");
  });

  it("a held session still produces a settlement row — it is not dropped", () => {
    // Dropping it would make the session invisible rather than blocked, and an
    // invisible session cannot appear in a period's blocker list.
    const { settlement } = rows(snap({ meterStopWh: null }));
    expect(settlement.sessionId).toBe(SESSION);
    expect(settlement.status).toBe("billing_review_required");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Negative: the mapper refuses rather than guessing
// ─────────────────────────────────────────────────────────────────────────────

describe("negative: contradictions are refused, not normalised", () => {
  it("REFUSES a held snapshot carrying no reason", () => {
    const s = { ...snap(), status: "billing_review_required" as const, reviewReasons: [] };
    expect(() => rows(s)).toThrow(/held with no reason/);
  });

  it("REFUSES a settled snapshot carrying review reasons", () => {
    const s = { ...snap(), status: "settled" as const, reviewReasons: ["manual_hold" as const] };
    expect(() => rows(s)).toThrow(/carries 1 review reason/);
  });

  it("REFUSES money that arrived as a JS number", () => {
    const s = { ...snap(), totalIsk: 650 as unknown as bigint };
    expect(() => rows(s)).toThrow(/expected bigint aurar/);
  });

  it("REFUSES a number-typed ex-VAT amount", () => {
    const s = { ...snap(), amountExVatMinor: 52407 as unknown as bigint };
    expect(() => rows(s)).toThrow(/amountExVatMinor is number/);
  });

  it("every refusal is a MappingError with a machine-readable code", () => {
    const cases: [() => unknown, string][] = [
      [() => rows(snap({ orgId: OTHER_ORG })), "cross_tenant_snapshot"],
      [
        () => rows({ ...snap(), status: "billing_review_required" as const, reviewReasons: [] }),
        "held_without_reason",
      ],
      [
        () => rows({ ...snap(), status: "settled" as const, reviewReasons: ["manual_hold" as const] }),
        "settled_with_reasons",
      ],
      [() => rows({ ...snap(), vatMinor: 1 as unknown as bigint }), "non_bigint_money"],
    ];
    for (const [run, code] of cases) {
      try {
        run();
        expect.unreachable(`expected ${code}`);
      } catch (e) {
        expect(e).toBeInstanceOf(MappingError);
        expect((e as MappingError).refusal).toBe(code);
      }
    }
  });

  it("does not invent a committed_at — pricing is not committing", () => {
    expect(rows(snap()).settlement.committedAt).toBeNull();
  });

  it("does not invent a connector or driver where the session had none", () => {
    const s = snap({ driverId: null });
    expect(rows(s).settlement.driverUserId).toBeNull();
  });

  it("an unattributed session still settles — it just has nobody to bill", () => {
    const { settlement } = rows(snap({ driverId: null }));
    expect(settlement.status).toBe("settled");
    expect(settlement.totalIsk).toBeGreaterThan(0n);
  });

  it("REFUSES nothing when the snapshot is well-formed", () => {
    expect(() => rows(snap())).not.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Idempotency and retry
// ─────────────────────────────────────────────────────────────────────────────

describe("idempotency: the same inputs produce byte-identical rows", () => {
  it("mapping twice yields the same settlement row", () => {
    const s = snap();
    expect(rows(s).settlement).toEqual(rows(s).settlement);
  });

  it("mapping twice yields the same component rows in the same order", () => {
    const s = snap();
    const a = rows(s).components.map((c) => [c.kind, c.unitPriceMinor, c.amountExVatMinor]);
    const b = rows(s).components.map((c) => [c.kind, c.unitPriceMinor, c.amountExVatMinor]);
    expect(a).toEqual(b);
  });

  it("the settlement row's natural key is the session id alone", () => {
    // This is the whole no-double-billing story: a retried commit collides.
    expect(rows(snap()).settlement.sessionId).toBe(SESSION);
  });

  it("a component row's natural key is (session, kind), so a retry cannot duplicate", () => {
    const { components } = rows(snap());
    const keys = components.map((c) => `${c.sessionId}:${c.kind}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("a hold row's natural key is (session, reason), so re-raising is a no-op", () => {
    const { holds } = rows(snap({ meterStopWh: null, manualHold: true }));
    const keys = holds.map((h) => `${h.sessionId}:${h.reason}`);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys.length).toBeGreaterThan(1);
  });

  it("statement line numbers are stable and 1-based across a regenerate", () => {
    const doc = buildDriverStatement({
      period: { orgId: ORG, year: 2026, month: 7 },
      driverId: DRIVER,
      snapshots: [snap()],
      generatedAt: AT("2026-08-01T00:00:00Z"),
    });
    const build = () =>
      buildStatementRows({
        document: doc,
        orgId: ORG,
        periodId: PERIOD,
        statementId: STMT,
        ownSessionIds: new Set([SESSION]),
      }).lines.map((l) => l.lineNo);
    expect(build()).toEqual(build());
    expect(build()[0]).toBe(1);
  });

  it("the statement key is deterministic, so a retry is recognisably the same document", () => {
    const mk = () =>
      buildDriverStatement({
        period: { orgId: ORG, year: 2026, month: 7 },
        driverId: DRIVER,
        snapshots: [snap()],
        generatedAt: AT("2026-08-01T00:00:00Z"),
      }).statementId;
    expect(mk()).toBe(mk());
  });

  it("a DIFFERENT session set produces a different key — a silent overwrite is detectable", () => {
    const one = buildDriverStatement({
      period: { orgId: ORG, year: 2026, month: 7 },
      driverId: DRIVER,
      snapshots: [snap()],
      generatedAt: AT("2026-08-01T00:00:00Z"),
    }).statementId;
    const two = buildDriverStatement({
      period: { orgId: ORG, year: 2026, month: 7 },
      driverId: DRIVER,
      snapshots: [snap(), snap({ sessionId: "55555555-6666-4777-8888-999999999999" })],
      generatedAt: AT("2026-08-01T00:00:00Z"),
    }).statementId;
    expect(one).not.toBe(two);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Statement, export, delivery edges
// ─────────────────────────────────────────────────────────────────────────────

describe("statement edges", () => {
  it("a held session is excluded by id, not priced at zero", () => {
    const doc = buildDriverStatement({
      period: { orgId: ORG, year: 2026, month: 7 },
      driverId: DRIVER,
      snapshots: [snap({ manualHold: true })],
      generatedAt: AT("2026-08-01T00:00:00Z"),
    });
    const { statement, lines } = buildStatementRows({
      document: doc,
      orgId: ORG,
      periodId: PERIOD,
      statementId: STMT,
      ownSessionIds: new Set([SESSION]),
    });
    expect(lines).toHaveLength(0);
    expect(statement.totalIsk).toBe(0n);
    expect(statement.excludedSessionIds).toEqual([SESSION]);
  });

  it("an empty period produces a statement, not an absence", () => {
    const doc = buildDriverStatement({
      period: { orgId: ORG, year: 2026, month: 7 },
      driverId: DRIVER,
      snapshots: [],
      generatedAt: AT("2026-08-01T00:00:00Z"),
    });
    const { statement } = buildStatementRows({
      document: doc,
      orgId: ORG,
      periodId: PERIOD,
      statementId: STMT,
      ownSessionIds: new Set(),
    });
    expect(statement.totalIsk).toBe(0n);
    expect(statement.excludedSessionIds).toEqual([]);
  });

  it("the excluded list is stored as an array, not a count", () => {
    const doc = buildDriverStatement({
      period: { orgId: ORG, year: 2026, month: 7 },
      driverId: DRIVER,
      snapshots: [snap({ manualHold: true })],
      generatedAt: AT("2026-08-01T00:00:00Z"),
    });
    const { statement } = buildStatementRows({
      document: doc,
      orgId: ORG,
      periodId: PERIOD,
      statementId: STMT,
      ownSessionIds: new Set([SESSION]),
    });
    expect(Array.isArray(statement.excludedSessionIds)).toBe(true);
  });

  it("statement rows carry the deterministic key separately from the row id", () => {
    const doc = buildDriverStatement({
      period: { orgId: ORG, year: 2026, month: 7 },
      driverId: DRIVER,
      snapshots: [snap()],
      generatedAt: AT("2026-08-01T00:00:00Z"),
    });
    const { statement } = buildStatementRows({
      document: doc,
      orgId: ORG,
      periodId: PERIOD,
      statementId: STMT,
      ownSessionIds: new Set([SESSION]),
    });
    expect(statement.id).toBe(STMT);
    expect(statement.statementKey).toBe(doc.statementId);
    expect(statement.statementKey).toMatch(/^stmt_202607_driver_[0-9a-f]{8}$/);
  });

  it("a generated statement is never marked superseded on creation", () => {
    const doc = buildDriverStatement({
      period: { orgId: ORG, year: 2026, month: 7 },
      driverId: DRIVER,
      snapshots: [snap()],
      generatedAt: AT("2026-08-01T00:00:00Z"),
    });
    const { statement } = buildStatementRows({
      document: doc,
      orgId: ORG,
      periodId: PERIOD,
      statementId: STMT,
      ownSessionIds: new Set([SESSION]),
    });
    expect(statement.supersededByStatementId).toBeUndefined();
  });

  it("currency is ISK and is not defaulted away", () => {
    const doc = buildDriverStatement({
      period: { orgId: ORG, year: 2026, month: 7 },
      driverId: DRIVER,
      snapshots: [snap()],
      generatedAt: AT("2026-08-01T00:00:00Z"),
    });
    const { statement } = buildStatementRows({
      document: doc,
      orgId: ORG,
      periodId: PERIOD,
      statementId: STMT,
      ownSessionIds: new Set([SESSION]),
    });
    expect(statement.currency).toBe("ISK");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Period close
// ─────────────────────────────────────────────────────────────────────────────

describe("a period cannot close over an unfinished session", () => {
  it("a held settlement blocks", () => {
    expect(
      settlementsBlockingClose([{ sessionId: SESSION, status: "billing_review_required" }], []),
    ).toEqual([SESSION]);
  });

  it("an unresolved hold blocks even when the settlement reads settled", () => {
    // The two can disagree: an operator can raise a manual hold after pricing.
    expect(
      settlementsBlockingClose(
        [{ sessionId: SESSION, status: "settled" }],
        [{ sessionId: SESSION, resolvedAt: null }],
      ),
    ).toEqual([SESSION]);
  });

  it("a resolved hold does not block", () => {
    expect(
      settlementsBlockingClose(
        [{ sessionId: SESSION, status: "settled" }],
        [{ sessionId: SESSION, resolvedAt: AT("2026-08-02T00:00:00Z") }],
      ),
    ).toEqual([]);
  });

  it("a clean period closes", () => {
    expect(settlementsBlockingClose([{ sessionId: SESSION, status: "settled" }], [])).toEqual([]);
  });

  it("reports each blocked session once, sorted, however many reasons it has", () => {
    const out = settlementsBlockingClose(
      [
        { sessionId: "b", status: "billing_review_required" },
        { sessionId: "a", status: "settled" },
      ],
      [
        { sessionId: "b", resolvedAt: null },
        { sessionId: "a", resolvedAt: null },
      ],
    );
    expect(out).toEqual(["a", "b"]);
  });
});
