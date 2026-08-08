// Sprint 9 / ADR 0019 — agreement resolver tests.
//
// Hand-computed expected values throughout — no toBeCloseTo, no
// floating-point compare. ISK with 2-decimal aurar precision; half-up
// rounding for VAT and percentage operations matching resolve.ts.

import { describe, expect, it } from "vitest";
import {
  buildLadder,
  computeBillingLines,
  pickActiveRate,
  resolveBillingLines,
  resolveFactor,
} from "./resolve";
import { RATE_BASES } from "./types";
import type {
  Allocation,
  ClauseInput,
  RateRefInput,
  RuleInput,
  SessionContext,
} from "./types";

// ── Fixtures ──────────────────────────────────────────────────────────

const AGREEMENT_ID = "00000000-0000-0000-0000-000000000001";
const CPO_ORG_ID =   "00000000-0000-0000-0000-000000000010";
const SITE_ID =      "00000000-0000-0000-0000-000000000020";
const INST_ID =      "00000000-0000-0000-0000-000000000030";
const CIRCUIT_ID =   "00000000-0000-0000-0000-000000000040";
const CHARGER_ID =   "00000000-0000-0000-0000-000000000050";
const ANOTHER_CHARGER = "00000000-0000-0000-0000-000000000051";
const USER_ID =      "00000000-0000-0000-0000-000000000060";
const ANOTHER_USER = "00000000-0000-0000-0000-000000000061";
const GROUP_ID =     "00000000-0000-0000-0000-000000000070";
const SJOVA_ORG_ID = "00000000-0000-0000-0000-000000000080";
const VEITUR_ORG_ID = "00000000-0000-0000-0000-000000000090";

const FACTOR_DSO = "00000000-0000-0000-0000-0000000000d0";
const FACTOR_ELE = "00000000-0000-0000-0000-0000000000d1";
const FACTOR_TRF = "00000000-0000-0000-0000-0000000000d2";
const FACTOR_MTR = "00000000-0000-0000-0000-0000000000d3";

const FROM = new Date("2026-04-01T00:00:00Z");
const SESSION_START = new Date("2026-05-01T08:00:00Z");
const SESSION_END = new Date("2026-05-01T09:00:00Z");

const RATE_DSO_Q2: RateRefInput = {
  id: "00000000-0000-0000-0000-0000000000a1",
  code: "veitur-dso-c",
  costFactorId: FACTOR_DSO,
  basis: "per_kwh",
  priceMinor: 850n,        // 8.50 kr/kWh ex-VAT
  vatRatePct: 24,
  currency: "ISK",
  supplierOrgId: VEITUR_ORG_ID,
  effectiveFrom: new Date("2026-04-01T00:00:00Z"),
  effectiveUntil: new Date("2026-07-01T00:00:00Z"),
};

const RATE_DSO_Q3: RateRefInput = {
  id: "00000000-0000-0000-0000-0000000000a2",
  code: "veitur-dso-c",
  costFactorId: FACTOR_DSO,
  basis: "per_kwh",
  priceMinor: 920n,        // 9.20 kr/kWh ex-VAT — Q3 hike
  vatRatePct: 24,
  currency: "ISK",
  supplierOrgId: VEITUR_ORG_ID,
  effectiveFrom: new Date("2026-07-01T00:00:00Z"),
  effectiveUntil: null,
};

const RATE_ELE: RateRefInput = {
  id: "00000000-0000-0000-0000-0000000000a3",
  code: "n1-retail-ele",
  costFactorId: FACTOR_ELE,
  basis: "per_kwh",
  priceMinor: 1450n,       // 14.50 kr/kWh ex-VAT
  vatRatePct: 24,
  currency: "ISK",
  supplierOrgId: null,
  effectiveFrom: FROM,
  effectiveUntil: null,
};

const fullTo = (bearer: "org" | "usr" | "wrk" | "trd"): Allocation => ({
  passthrough: { splits: [{ bearer_type: bearer, share_pct: 100 }] },
  markup: null,
});

const splitTwo = (
  a: "org" | "usr" | "wrk" | "trd", aPct: number,
  b: "org" | "usr" | "wrk" | "trd", bPct: number,
): Allocation => ({
  passthrough: { splits: [{ bearer_type: a, share_pct: aPct }, { bearer_type: b, share_pct: bPct }] },
  markup: null,
});

function makeContext(overrides: Partial<SessionContext> = {}): SessionContext {
  return {
    agreementId: AGREEMENT_ID,
    cpoOrgId: CPO_ORG_ID,
    user: { id: USER_ID },
    driverGroup: { id: GROUP_ID, ownerOrgId: SJOVA_ORG_ID },
    chargerId: CHARGER_ID,
    circuitId: CIRCUIT_ID,
    installationId: INST_ID,
    siteId: SITE_ID,
    startedAt: SESSION_START,
    endedAt: SESSION_END,
    energyKwh: 10,
    durationMinutes: 60,
    durationDays: 0,
    clauses: [],
    rules: [],
    rateReferences: [RATE_DSO_Q2, RATE_DSO_Q3, RATE_ELE],
    ...overrides,
  };
}

const dsoClause: ClauseInput = {
  costFactorId: FACTOR_DSO,
  costFactorCode: "DSO",
  defaultBearerType: "usr",
  defaultBearerRef: null,
  defaultRateRefCode: "veitur-dso-c",
  allocation: fullTo("usr"),
};

const eleClause: ClauseInput = {
  costFactorId: FACTOR_ELE,
  costFactorCode: "ELE",
  defaultBearerType: "usr",
  defaultBearerRef: null,
  defaultRateRefCode: "n1-retail-ele",
  allocation: fullTo("usr"),
};

const mtrClause: ClauseInput = {
  costFactorId: FACTOR_MTR,
  costFactorCode: "MTR",
  defaultBearerType: "org",
  defaultBearerRef: null,
  defaultRateRefCode: null,        // intentionally unrated for these tests
  allocation: fullTo("org"),
};

// ── Allocation scenarios (the four from ADR 0019) ────────────────────

describe("resolveBillingLines — allocation scenarios", () => {
  it("scenario 1: full absorb — passthrough.splits=ORG 100%", () => {
    // 10 kWh × 8.50 kr/kWh = 85.00 → 8500 minor ex-VAT
    // VAT 24%: 8500 × 24 / 100 = 2040 minor
    // Inc-VAT: 10540
    const ctx = makeContext({
      clauses: [{ ...dsoClause, defaultBearerType: "org", allocation: fullTo("org") }],
    });
    const lines = resolveBillingLines(ctx);
    expect(lines).toHaveLength(1);
    const l = lines[0]!;
    expect(l.factorCode).toBe("DSO");
    expect(l.kind).toBe("passthrough");
    expect(l.bearerType).toBe("org");
    expect(l.amountExVatMinor).toBe(8500n);
    expect(l.vatAmountMinor).toBe(2040n);
    expect(l.amountIncVatMinor).toBe(10540n);
    expect(l.recipientOrgId).toBe(VEITUR_ORG_ID); // pass-through to supplier
  });

  it("scenario 2: full forward — passthrough.splits=USR 100%", () => {
    const ctx = makeContext({ clauses: [dsoClause] });
    const lines = resolveBillingLines(ctx);
    expect(lines).toHaveLength(1);
    expect(lines[0]!.bearerType).toBe("usr");
    expect(lines[0]!.amountExVatMinor).toBe(8500n);
  });

  it("scenario 3: partial — 50/50 ORG + USR", () => {
    // 8500 minor split 50/50 → 4250 each
    // VAT each: 4250 × 24 / 100 = 1020 minor
    const ctx = makeContext({
      clauses: [{ ...dsoClause, allocation: splitTwo("org", 50, "usr", 50) }],
    });
    const lines = resolveBillingLines(ctx);
    expect(lines).toHaveLength(2);
    expect(lines.map((l) => l.bearerType).sort()).toEqual(["org", "usr"]);
    for (const l of lines) {
      expect(l.amountExVatMinor).toBe(4250n);
      expect(l.vatAmountMinor).toBe(1020n);
      expect(l.amountIncVatMinor).toBe(5270n);
    }
  });

  it("scenario 4: markup — USR pays 100% + 20% markup to CPO", () => {
    // Passthrough: 8500 minor → USR; VAT 2040 → 10540 inc
    // Markup 20% of 8500 = 1700 minor → USR pays, ORG receives
    // Markup VAT: 1700 × 24 / 100 = 408 → inc 2108
    const ctx = makeContext({
      clauses: [{
        ...dsoClause,
        allocation: {
          passthrough: { splits: [{ bearer_type: "usr", share_pct: 100 }] },
          markup: {
            basis: "percent",
            value: 20,
            payer_type: "usr",
            recipient_type: "org",
          },
        },
      }],
    });
    const lines = resolveBillingLines(ctx);
    expect(lines).toHaveLength(2);
    const passthrough = lines.find((l) => l.kind === "passthrough")!;
    const markup = lines.find((l) => l.kind === "markup")!;
    expect(passthrough.amountExVatMinor).toBe(8500n);
    expect(passthrough.recipientOrgId).toBe(VEITUR_ORG_ID);
    expect(markup.bearerType).toBe("usr");
    expect(markup.amountExVatMinor).toBe(1700n);
    expect(markup.vatAmountMinor).toBe(408n);
    expect(markup.amountIncVatMinor).toBe(2108n);
    expect(markup.recipientOrgId).toBe(CPO_ORG_ID); // markup → CPO (revenue)
  });
});

// ── Cascade + sticky behavior ────────────────────────────────────────

describe("resolveFactor — per-attribute cascade", () => {
  it("parent cascade: rule overrides only allocation; bearer + rate inherit from agreement default", () => {
    const rule: RuleInput = {
      id: "rule-alloc-only",
      costFactorId: FACTOR_DSO,
      scopeType: null,
      scopeId: null,
      audienceType: "driver_group",
      audienceId: GROUP_ID,
      bearerType: null,             // inherit
      bearerRef: null,
      rateRefCode: null,            // inherit
      allocation: fullTo("wrk"),    // override only allocation
      effectiveFrom: FROM,
      effectiveUntil: null,
    };
    const ctx = makeContext({ clauses: [dsoClause], rules: [rule] });
    const resolved = resolveFactor(ctx, dsoClause);
    expect(resolved.bearerType).toBe("usr");                    // from clause default
    expect(resolved.rateRef?.code).toBe("veitur-dso-c");        // from clause default
    expect(resolved.allocation.passthrough.splits[0]!.bearer_type).toBe("wrk"); // from rule
    expect(resolved.cascadeSource.bearer).toBe(null);           // cascaded → no winning rule
    expect(resolved.cascadeSource.rate).toBe(null);
    expect(resolved.cascadeSource.allocation).toBe("rule-alloc-only");
  });

  it("sticky child: rule overrides bearer; subsequent reads use the override", () => {
    const rule: RuleInput = {
      id: "rule-bearer-override",
      costFactorId: FACTOR_DSO,
      scopeType: null,
      scopeId: null,
      audienceType: "driver_group",
      audienceId: GROUP_ID,
      bearerType: "wrk",            // explicit bearer override
      bearerRef: null,
      rateRefCode: null,
      allocation: null,
      effectiveFrom: FROM,
      effectiveUntil: null,
    };
    const ctx = makeContext({ clauses: [dsoClause], rules: [rule] });
    const resolved = resolveFactor(ctx, dsoClause);
    expect(resolved.bearerType).toBe("wrk");
    expect(resolved.cascadeSource.bearer).toBe("rule-bearer-override");
    // allocation still falls through to clause default (USR 100%) — bearer
    // override doesn't auto-rewrite splits. The UI normalises when authoring.
    expect(resolved.allocation.passthrough.splits[0]!.bearer_type).toBe("usr");
  });
});

// ── Rate versioning ──────────────────────────────────────────────────

describe("pickActiveRate", () => {
  it("picks Q2 rate when session falls in Q2", () => {
    const at = new Date("2026-05-15T12:00:00Z");
    const r = pickActiveRate([RATE_DSO_Q2, RATE_DSO_Q3], "veitur-dso-c", at);
    expect(r?.id).toBe(RATE_DSO_Q2.id);
    expect(r?.priceMinor).toBe(850n);
  });

  it("picks Q3 rate when session falls in Q3", () => {
    const at = new Date("2026-08-15T12:00:00Z");
    const r = pickActiveRate([RATE_DSO_Q2, RATE_DSO_Q3], "veitur-dso-c", at);
    expect(r?.id).toBe(RATE_DSO_Q3.id);
    expect(r?.priceMinor).toBe(920n);
  });

  it("returns null when no version is active at session_time", () => {
    const at = new Date("2025-01-01T00:00:00Z");
    const r = pickActiveRate([RATE_DSO_Q2, RATE_DSO_Q3], "veitur-dso-c", at);
    expect(r).toBeNull();
  });

  it("price change cascades through unaltered rules", () => {
    // Group rule overrides bearer to WRK but leaves rate_ref_code null.
    // Q2 session uses 850; Q3 session uses 920 — same rule.
    const rule: RuleInput = {
      id: "rule-bearer-only",
      costFactorId: FACTOR_DSO,
      scopeType: null,
      scopeId: null,
      audienceType: "driver_group",
      audienceId: GROUP_ID,
      bearerType: "wrk",
      bearerRef: null,
      rateRefCode: null,
      allocation: fullTo("wrk"),
      effectiveFrom: FROM,
      effectiveUntil: null,
    };

    const q2Ctx = makeContext({
      clauses: [dsoClause],
      rules: [rule],
      startedAt: new Date("2026-05-01T08:00:00Z"),
    });
    const q3Ctx = makeContext({
      clauses: [dsoClause],
      rules: [rule],
      startedAt: new Date("2026-08-01T08:00:00Z"),
    });
    const q2Lines = resolveBillingLines(q2Ctx);
    const q3Lines = resolveBillingLines(q3Ctx);
    expect(q2Lines[0]!.amountExVatMinor).toBe(8500n);  // 10 × 850
    expect(q3Lines[0]!.amountExVatMinor).toBe(9200n);  // 10 × 920
    expect(q2Lines[0]!.bearerType).toBe("wrk");
    expect(q3Lines[0]!.bearerType).toBe("wrk");
  });
});

// ── Audience + scope precedence ──────────────────────────────────────

describe("buildLadder — precedence", () => {
  function rule(id: string, audience: { type: "user" | "driver_group" | null; id: string | null }, scope: { type: "site" | "installation" | "circuit" | "charger" | null; id: string | null }, bearerType: "org" | "usr" | "wrk" | "trd"): RuleInput {
    return {
      id,
      costFactorId: FACTOR_DSO,
      scopeType: scope.type,
      scopeId: scope.id,
      audienceType: audience.type,
      audienceId: audience.id,
      bearerType,
      bearerRef: null,
      rateRefCode: null,
      allocation: null,
      effectiveFrom: FROM,
      effectiveUntil: null,
    };
  }

  it("user-specific rule beats group rule", () => {
    const rUser = rule("u1", { type: "user", id: USER_ID }, { type: null, id: null }, "trd");
    const rGroup = rule("g1", { type: "driver_group", id: GROUP_ID }, { type: null, id: null }, "wrk");
    const ctx = makeContext({ clauses: [dsoClause], rules: [rUser, rGroup] });
    const resolved = resolveFactor(ctx, dsoClause);
    expect(resolved.bearerType).toBe("trd");
    expect(resolved.cascadeSource.bearer).toBe("u1");
  });

  it("charger rule beats site rule (both group-scoped)", () => {
    const rCharger = rule("c1", { type: "driver_group", id: GROUP_ID }, { type: "charger", id: CHARGER_ID }, "wrk");
    const rSite = rule("s1", { type: "driver_group", id: GROUP_ID }, { type: "site", id: SITE_ID }, "usr");
    const ctx = makeContext({ clauses: [dsoClause], rules: [rCharger, rSite] });
    const resolved = resolveFactor(ctx, dsoClause);
    expect(resolved.bearerType).toBe("wrk");
    expect(resolved.cascadeSource.bearer).toBe("c1");
  });

  it("rule for another user is filtered out of the ladder", () => {
    const rOther = rule("u-other", { type: "user", id: ANOTHER_USER }, { type: null, id: null }, "trd");
    const ctx = makeContext({ clauses: [dsoClause], rules: [rOther] });
    const ladder = buildLadder(ctx, FACTOR_DSO);
    expect(ladder).toHaveLength(0);
  });

  it("rule scoped to another charger is filtered out", () => {
    const rOther = rule("c-other", { type: null, id: null }, { type: "charger", id: ANOTHER_CHARGER }, "wrk");
    const ctx = makeContext({ clauses: [dsoClause], rules: [rOther] });
    const ladder = buildLadder(ctx, FACTOR_DSO);
    expect(ladder).toHaveLength(0);
  });
});

// ── Edge cases ───────────────────────────────────────────────────────

describe("computeBillingLines — edge cases", () => {
  it("clause with no rate ref emits no billing lines (passthrough cannot be computed without basis price)", () => {
    const ctx = makeContext({ clauses: [mtrClause] });
    const lines = resolveBillingLines(ctx);
    expect(lines).toHaveLength(0);
  });

  it("share_pct=0 splits are skipped silently", () => {
    const ctx = makeContext({
      clauses: [{ ...dsoClause, allocation: splitTwo("usr", 100, "wrk", 0) }],
    });
    const lines = resolveBillingLines(ctx);
    expect(lines).toHaveLength(1);
    expect(lines[0]!.bearerType).toBe("usr");
  });

  it("expired rule is filtered by effective_from/effective_until", () => {
    const expired: RuleInput = {
      id: "expired",
      costFactorId: FACTOR_DSO,
      scopeType: null,
      scopeId: null,
      audienceType: "driver_group",
      audienceId: GROUP_ID,
      bearerType: "wrk",
      bearerRef: null,
      rateRefCode: null,
      allocation: null,
      effectiveFrom: new Date("2026-01-01T00:00:00Z"),
      effectiveUntil: new Date("2026-04-01T00:00:00Z"),
    };
    const ctx = makeContext({
      clauses: [dsoClause],
      rules: [expired],
      startedAt: new Date("2026-05-15T08:00:00Z"),
    });
    const resolved = resolveFactor(ctx, dsoClause);
    expect(resolved.bearerType).toBe("usr"); // back to clause default
  });

  it("missing driverGroup means group-audience rules don't match", () => {
    const groupRule: RuleInput = {
      id: "g-only",
      costFactorId: FACTOR_DSO,
      scopeType: null,
      scopeId: null,
      audienceType: "driver_group",
      audienceId: GROUP_ID,
      bearerType: "wrk",
      bearerRef: null,
      rateRefCode: null,
      allocation: null,
      effectiveFrom: FROM,
      effectiveUntil: null,
    };
    const ctx = makeContext({
      clauses: [dsoClause],
      rules: [groupRule],
      driverGroup: null,
    });
    const resolved = resolveFactor(ctx, dsoClause);
    expect(resolved.bearerType).toBe("usr");
  });
});

// ── Allocation reaches multiple factors ──────────────────────────────

describe("resolveBillingLines — multi-factor", () => {
  it("two enlisted factors emit independent lines", () => {
    // DSO: 10 × 850 = 8500 minor → USR
    // ELE: 10 × 1450 = 14500 minor → USR
    const ctx = makeContext({ clauses: [dsoClause, eleClause] });
    const lines = resolveBillingLines(ctx);
    expect(lines).toHaveLength(2);
    const dso = lines.find((l) => l.factorCode === "DSO")!;
    const ele = lines.find((l) => l.factorCode === "ELE")!;
    expect(dso.amountExVatMinor).toBe(8500n);
    expect(ele.amountExVatMinor).toBe(14500n);
  });
});

// ── Recipient resolution ─────────────────────────────────────────────

describe("computeBillingLines — recipient routing", () => {
  it("WRK recipient on a markup line resolves to driverGroup.ownerOrgId", () => {
    const ctx = makeContext({
      clauses: [{
        ...dsoClause,
        allocation: {
          passthrough: { splits: [{ bearer_type: "usr", share_pct: 100 }] },
          markup: {
            basis: "percent",
            value: 10,
            payer_type: "usr",
            recipient_type: "wrk",
          },
        },
      }],
    });
    const lines = resolveBillingLines(ctx);
    const markup = lines.find((l) => l.kind === "markup")!;
    expect(markup.recipientOrgId).toBe(SJOVA_ORG_ID);
  });
});

// ── per_connector — added 2026-08-08 with the flat platform fee ────────
//
// This basis exists for the Straumvakt→host principal line, whose quantity is
// a COUNT OF CONNECTORS on an org, not anything a session knows. These tests
// pin that it is refused by the session path rather than silently guessed,
// and that adding it to the union changed nothing about the four bases that
// were already there.

describe("per_connector basis", () => {
  const RATE_PLATFORM_FEE: RateRefInput = {
    id: "00000000-0000-0000-0000-0000000000af",
    code: "straumvakt-platform-fee",
    costFactorId: FACTOR_DSO,
    basis: "per_connector",
    priceMinor: 150000n, // 1,500.00 kr per connector per month, ex-VAT
    vatRatePct: 24,
    currency: "ISK",
    supplierOrgId: null,
    effectiveFrom: new Date("2026-01-01T00:00:00Z"),
    effectiveUntil: null,
  };

  it("is a member of RATE_BASES", () => {
    // Guards the union against a careless edit — the DB enum does not carry
    // this value yet, so TypeScript is the only thing holding it right now.
    expect(RATE_BASES).toContain("per_connector");
    expect(RATE_BASES).toHaveLength(5);
  });

  it("throws rather than guessing when resolved through the session path", () => {
    // The two silent alternatives are billing every session as if it were one
    // connector, or billing zero. Both are wrong and both are invisible on an
    // invoice, so this must fail loudly.
    const ctx = makeContext({
      clauses: [
        {
          costFactorId: FACTOR_DSO,
          costFactorCode: "DSO",
          defaultBearerType: "org",
          defaultBearerRef: null,
          defaultRateRefCode: "straumvakt-platform-fee",
          allocation: fullTo("org"),
        },
      ],
      rateReferences: [RATE_PLATFORM_FEE],
    });

    expect(() => resolveBillingLines(ctx)).toThrow(/per_connector is not resolvable from a session/);
  });

  it("pickActiveRate still selects it by time window like any other basis", () => {
    // Selection is basis-agnostic; only quantity derivation is special. A
    // renewal rate must be selectable even though it is not session-resolvable.
    const picked = pickActiveRate(
      [RATE_PLATFORM_FEE],
      "straumvakt-platform-fee",
      new Date("2026-08-01T00:00:00Z"),
    );
    expect(picked?.id).toBe(RATE_PLATFORM_FEE.id);
    expect(picked?.basis).toBe("per_connector");
  });

  it("leaves the four session bases computing exactly as before", () => {
    // Regression guard on the enum widening. 10 kWh × 850 minor = 8500 ex-VAT;
    // VAT 8500 × 24 / 100 = 2040; inc = 10540. Hand-computed, half-up.
    const ctx = makeContext({ clauses: [dsoClause] });
    const lines = resolveBillingLines(ctx);
    expect(lines).toHaveLength(1);
    expect(lines[0]!.basisType).toBe("per_kwh");
    expect(lines[0]!.basisQuantity).toBe(10);
    expect(lines[0]!.amountExVatMinor).toBe(8500n);
    expect(lines[0]!.vatAmountMinor).toBe(2040n);
    expect(lines[0]!.amountIncVatMinor).toBe(10540n);
  });
});
