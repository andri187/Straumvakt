// Core billing route contracts — the contract of the contract.
//
// These routes cannot be implemented until the tables exist. What CAN be
// tested now is that the contract encodes the rules the handler must not have
// to rediscover: a tenant is always named, money never crosses as a JS number,
// mutations always carry an idempotency key, and a hold cannot be resolved
// without a recorded reason.

import { describe, expect, it } from "vitest";
import {
  billingPeriodSchema,
  classifyRateWrite,
  commitSettlementRequestSchema,
  CORE_BILLING_ROUTE_CONTRACTS,
  deliverStatementRequestSchema,
  exportStatementRequestSchema,
  idempotencyKeySchema,
  iskStringSchema,
  listDriverStatementsRequestSchema,
  myBillingMaterialRequestSchema,
  rateBookUpdateRequestSchema,
  resolveHoldRequestSchema,
  settlementPreviewResponseSchema,
  signedAurarStringSchema,
} from "./statement-zod";

const ORG = "3f8a1c2e-4b5d-4e6f-8a9b-0c1d2e3f4a5b";
const SESSION = "11111111-2222-4333-8444-555555555555";
const KEY = "idem-0123456789";

describe("a billing request always names its tenant", () => {
  it("accepts a well-formed period", () => {
    const r = billingPeriodSchema.safeParse({ orgId: ORG, year: 2026, month: 7 });
    expect(r.success).toBe(true);
  });

  it("REJECTS a period with no orgId", () => {
    expect(billingPeriodSchema.safeParse({ year: 2026, month: 7 }).success).toBe(false);
  });

  it("rejects an orgId that is not a UUID", () => {
    expect(billingPeriodSchema.safeParse({ orgId: "org_alpha", year: 2026, month: 7 }).success)
      .toBe(false);
  });

  it("rejects an impossible month", () => {
    for (const month of [0, 13, 1.5]) {
      expect(billingPeriodSchema.safeParse({ orgId: ORG, year: 2026, month }).success, `${month}`)
        .toBe(false);
    }
  });

  it("rejects a free date range — Core bills whole calendar months", () => {
    const r = billingPeriodSchema.safeParse({
      orgId: ORG, from: "2026-07-05", to: "2026-08-04",
    });
    expect(r.success).toBe(false);
  });

  it("every admin route contract names an orgIdParam", () => {
    const admin = CORE_BILLING_ROUTE_CONTRACTS.filter((r) => r.path.startsWith("/api/admin"));
    expect(admin.length).toBeGreaterThan(0);
    for (const r of admin) expect(r.orgIdParam, r.path).toBe("orgId");
  });

  it("the DRIVER route deliberately takes no orgId", () => {
    // Letting a driver name an org would be a cross-tenant hole dressed as a
    // filter. Identity comes from the bearer token.
    const driver = CORE_BILLING_ROUTE_CONTRACTS.find((r) => r.path.startsWith("/api/driver"));
    expect(driver?.orgIdParam).toBeNull();
    expect(Object.keys(myBillingMaterialRequestSchema.shape)).not.toContain("orgId");
  });

  it("every mutating route is declared idempotent", () => {
    for (const r of CORE_BILLING_ROUTE_CONTRACTS.filter((x) => x.mutates)) {
      expect(r.idempotent, r.path).toBe(true);
    }
  });
});

describe("money never crosses the wire as a JS number", () => {
  it("takes aurar as a signed integer string", () => {
    expect(signedAurarStringSchema.safeParse("64988").success).toBe(true);
    expect(signedAurarStringSchema.safeParse("-5000").success).toBe(true);
  });

  it("rejects a float or a JS number", () => {
    expect(signedAurarStringSchema.safeParse("649.88").success).toBe(false);
    expect(signedAurarStringSchema.safeParse(64988).success).toBe(false);
  });

  it("keeps whole-ISK line amounts separate from aurar", () => {
    expect(iskStringSchema.safeParse("650").success).toBe(true);
    expect(iskStringSchema.safeParse("-75").success).toBe(true);
    expect(iskStringSchema.safeParse("649.88").success).toBe(false);
  });

  it("survives a value beyond 2^53, which a JSON number would not", () => {
    const big = "9007199254740993";
    expect(signedAurarStringSchema.safeParse(big).success).toBe(true);
    expect(BigInt(big).toString()).toBe(big);
  });
});

describe("mutations carry an idempotency key", () => {
  it("accepts a reasonable key", () => {
    expect(idempotencyKeySchema.safeParse(KEY).success).toBe(true);
  });

  it("rejects a key too short to be unique", () => {
    expect(idempotencyKeySchema.safeParse("abc").success).toBe(false);
  });

  it("requires one on commit", () => {
    const base = { orgId: ORG, year: 2026, month: 7, expectedBlockerCount: 0 };
    expect(commitSettlementRequestSchema.safeParse(base).success).toBe(false);
    expect(commitSettlementRequestSchema.safeParse({ ...base, idempotencyKey: KEY }).success)
      .toBe(true);
  });

  it("requires one on delivery", () => {
    const base = { orgId: ORG, statementId: "stmt_1" };
    expect(deliverStatementRequestSchema.safeParse(base).success).toBe(false);
    expect(deliverStatementRequestSchema.safeParse({ ...base, idempotencyKey: KEY }).success)
      .toBe(true);
  });

  it("requires one on a rate write", () => {
    const base = {
      orgId: ORG, kind: "dso", code: "AD1", pricePerKwhMinor: "864",
      effectiveFrom: "2027-01-01T00:00:00Z",
    };
    expect(rateBookUpdateRequestSchema.safeParse(base).success).toBe(false);
  });

  it("carries the operator's expected blocker count, so a moved period is refused", () => {
    const r = commitSettlementRequestSchema.safeParse({
      orgId: ORG, year: 2026, month: 7, idempotencyKey: KEY, expectedBlockerCount: 3,
    });
    expect(r.success).toBe(true);
  });

  it("defaults a delivery to email and to not-a-resend", () => {
    const r = deliverStatementRequestSchema.parse({
      orgId: ORG, statementId: "stmt_1", idempotencyKey: KEY,
    });
    expect(r.channel).toBe("email");
    expect(r.resend).toBe(false);
  });
});

describe("resolving a hold is a recorded human decision", () => {
  const base = { orgId: ORG, sessionId: SESSION, idempotencyKey: KEY, resolution: "accept_cdr" };

  it("accepts a resolution with a note", () => {
    expect(resolveHoldRequestSchema.safeParse({ ...base, note: "CDR verified against meter" }).success)
      .toBe(true);
  });

  it("REJECTS a resolution with no note", () => {
    expect(resolveHoldRequestSchema.safeParse(base).success).toBe(false);
  });

  it("rejects a whitespace-only note", () => {
    expect(resolveHoldRequestSchema.safeParse({ ...base, note: "   " }).success).toBe(false);
  });

  it("only allows the four defined resolutions", () => {
    expect(resolveHoldRequestSchema.safeParse({ ...base, note: "ok", resolution: "just_bill_it" }).success)
      .toBe(false);
  });
});

describe("rate writes: backdating is possible but never accidental", () => {
  const NOW = new Date("2026-08-11T00:00:00Z");

  it("allows a future effective date with no reason", () => {
    const r = classifyRateWrite(new Date("2026-09-01T00:00:00Z"), NOW, undefined);
    expect(r.backdated).toBe(false);
    expect(r.allowed).toBe(true);
  });

  it("REFUSES a backdate with no reason", () => {
    const r = classifyRateWrite(new Date("2026-07-01T00:00:00Z"), NOW, undefined);
    expect(r.backdated).toBe(true);
    expect(r.allowed).toBe(false);
    expect(r.reason).toMatch(/restates history/);
  });

  it("allows a backdate with an audited reason", () => {
    const r = classifyRateWrite(new Date("2026-07-01T00:00:00Z"), NOW, "DSO published a correction");
    expect(r.allowed).toBe(true);
  });

  it("rejects an overlapping effective window at the schema level", () => {
    const r = rateBookUpdateRequestSchema.safeParse({
      orgId: ORG, kind: "dso", code: "AD1", pricePerKwhMinor: "864",
      effectiveFrom: "2026-09-01T00:00:00Z",
      effectiveUntil: "2026-08-01T00:00:00Z",
      idempotencyKey: KEY,
    });
    expect(r.success).toBe(false);
  });

  it("rejects a negative price", () => {
    expect(rateBookUpdateRequestSchema.safeParse({
      orgId: ORG, kind: "dso", code: "AD1", pricePerKwhMinor: "-864",
      effectiveFrom: "2027-01-01T00:00:00Z", idempotencyKey: KEY,
    }).success).toBe(false);
  });
});

describe("preview reports every blocker, and names what a human must fix", () => {
  it("accepts a full preview response", () => {
    const r = settlementPreviewResponseSchema.safeParse({
      period: { orgId: ORG, year: 2026, month: 7 },
      periodStart: "2026-07-01T00:00:00.000Z",
      periodEnd: "2026-08-01T00:00:00.000Z",
      state: "open",
      canClose: false,
      blockers: ["sessions_held_for_review", "sessions_still_estimated"],
      explanation: "Blocked by 2 conditions",
      counts: { billable: 120, estimated: 2, awaitingReconciliation: 0, heldForReview: 1 },
      heldSessionIds: [SESSION],
      activeConnectors: 20,
      activeDrivers: 146,
      subscriptionSubtotalMinor: "1080000",
      currency: "ISK",
    });
    expect(r.success).toBe(true);
  });

  it("rejects an unknown blocker rather than passing it through", () => {
    const r = settlementPreviewResponseSchema.safeParse({
      period: { orgId: ORG, year: 2026, month: 7 },
      periodStart: "2026-07-01T00:00:00.000Z", periodEnd: "2026-08-01T00:00:00.000Z",
      state: "open", canClose: false, blockers: ["something_new"], explanation: "x",
      counts: { billable: 0, estimated: 0, awaitingReconciliation: 0, heldForReview: 0 },
      heldSessionIds: [], activeConnectors: 0, activeDrivers: 0,
      subscriptionSubtotalMinor: "0", currency: "ISK",
    });
    expect(r.success).toBe(false);
  });

  it("only supports ISK, per the locked Iceland framing", () => {
    const r = settlementPreviewResponseSchema.safeParse({
      period: { orgId: ORG, year: 2026, month: 7 },
      periodStart: "2026-07-01T00:00:00.000Z", periodEnd: "2026-08-01T00:00:00.000Z",
      state: "open", canClose: true, blockers: [], explanation: "x",
      counts: { billable: 0, estimated: 0, awaitingReconciliation: 0, heldForReview: 0 },
      heldSessionIds: [], activeConnectors: 0, activeDrivers: 0,
      subscriptionSubtotalMinor: "0", currency: "EUR",
    });
    expect(r.success).toBe(false);
  });
});

describe("listing and export", () => {
  it("caps a driver-statement page so a list cannot be used as a bulk export", () => {
    expect(listDriverStatementsRequestSchema.safeParse({ orgId: ORG, limit: 500 }).success)
      .toBe(false);
    expect(listDriverStatementsRequestSchema.parse({ orgId: ORG }).limit).toBe(50);
  });

  it("caps the driver's own history too", () => {
    expect(myBillingMaterialRequestSchema.safeParse({ limit: 500 }).success).toBe(false);
    expect(myBillingMaterialRequestSchema.parse({}).limit).toBe(12);
  });

  it("defaults export to CSV, the format decided for launch", () => {
    const r = exportStatementRequestSchema.parse({ orgId: ORG, year: 2026, month: 7 });
    expect(r.format).toBe("csv");
  });

  it("refuses an export format nobody has specified", () => {
    expect(exportStatementRequestSchema.safeParse({
      orgId: ORG, year: 2026, month: 7, format: "pdf",
    }).success).toBe(false);
  });

  it("gates export behind billing.export — its first real call site", () => {
    const exp = CORE_BILLING_ROUTE_CONTRACTS.find((r) => r.path.endsWith("/export"));
    expect(exp?.permission).toBe("billing.export");
  });

  it("gates rate authoring behind tariff.write — also its first", () => {
    const rate = CORE_BILLING_ROUTE_CONTRACTS.find((r) => r.method === "PUT");
    expect(rate?.permission).toBe("tariff.write");
  });
});
