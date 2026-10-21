import { describe, expect, it } from "vitest";

import {
  FixtureAgreementStore,
  FixtureSettledPeriod,
  UnavailableSettledPeriod,
  period,
} from "./fixture-store";
import { AgreementWriter } from "./writer";
import type { StoredAgreement } from "./writer";
import {
  OPERATION_PROVENANCE,
  WRITE_OPERATIONS,
  WriteRefused,
  coversInstant,
  periodsOverlap,
} from "./write-ops";

const ORG = "org-a";
const OTHER = "org-b";
const AT = "2026-08-01T00:00:00Z";
const FACTORS = ["per_connector", "per_driver", "per_kwh"];

function setup(watermark: string | null = null) {
  const store = new FixtureAgreementStore();
  const writer = new AgreementWriter({
    store,
    settled: new FixtureSettledPeriod(watermark),
    knownFactorCodes: FACTORS,
  });
  return { store, writer };
}

async function anAgreement(
  writer: AgreementWriter,
  key = "k-agr",
  from = "2026-01-01T00:00:00Z",
): Promise<StoredAgreement> {
  const r = await writer.createAgreement({
    orgScope: ORG,
    idempotencyKey: key,
    at: AT,
    agreementType: "installation",
    displayName: "Flat fee",
    counterpartyOrgId: "host-1",
    installationId: "inst-1",
    period: period(from),
  });
  return r.value;
}

// ── 1. create ───────────────────────────────────────────────────────────

describe("agreement create", () => {
  it("creates an agreement and emits a receipt", async () => {
    const { writer, store } = setup();
    const r = await writer.createAgreement({
      orgScope: ORG,
      idempotencyKey: "k1",
      at: AT,
      agreementType: "installation",
      displayName: "Flat fee",
      counterpartyOrgId: "host-1",
      installationId: "inst-1",
      period: period("2026-01-01T00:00:00Z"),
    });
    expect(r.value.id).toBeTruthy();
    expect(r.receipt.operation).toBe("agreement.create");
    expect(r.receipt.replayed).toBe(false);
    expect(store.allReceipts()).toHaveLength(1);
  });

  it("REFUSES without an idempotency key — one is never generated", async () => {
    const { writer } = setup();
    await expect(
      writer.createAgreement({
        orgScope: ORG,
        idempotencyKey: "",
        at: AT,
        agreementType: "installation",
        displayName: "x",
        counterpartyOrgId: "host-1",
        installationId: null,
        period: period("2026-01-01T00:00:00Z"),
      }),
    ).rejects.toMatchObject({ reason: "idempotency_key_required" });
  });

  it("refuses a reversed period", async () => {
    const { writer } = setup();
    await expect(
      writer.createAgreement({
        orgScope: ORG,
        idempotencyKey: "k",
        at: AT,
        agreementType: "installation",
        displayName: "x",
        counterpartyOrgId: "host-1",
        installationId: null,
        period: { from: "2026-06-01T00:00:00Z", until: "2026-01-01T00:00:00Z" },
      }),
    ).rejects.toMatchObject({ reason: "period_reversed" });
  });
});

// ── 2. create twice with the same key ───────────────────────────────────

describe("idempotency", () => {
  it("the same key replays and writes nothing new", async () => {
    const { writer, store } = setup();
    const first = await anAgreement(writer, "same-key");
    const second = await writer.createAgreement({
      orgScope: ORG,
      idempotencyKey: "same-key",
      at: AT,
      agreementType: "installation",
      displayName: "DIFFERENT NAME",
      counterpartyOrgId: "host-1",
      installationId: "inst-1",
      period: period("2026-01-01T00:00:00Z"),
    });
    expect(second.receipt.replayed).toBe(true);
    expect(second.value.id).toBe(first.id);
    expect(second.value.displayName).toBe("Flat fee");
    expect(store.agreements.size).toBe(1);
  });

  it("every mutating operation emits exactly one receipt", async () => {
    const { writer, store } = setup();
    const a = await anAgreement(writer, "k-a");
    await writer.addClause({
      orgScope: ORG, idempotencyKey: "k-c", at: AT, agreementId: a.id,
      factorCode: "per_connector", bearerType: "org", rateRefCode: "R1",
      period: period("2026-01-01T00:00:00Z"),
    });
    const g = await writer.createGroup({
      orgScope: ORG, idempotencyKey: "k-g", at: AT, agreementId: a.id,
      displayName: "Dwellers", ownerOrgId: "host-1",
    });
    await writer.addMembership({
      orgScope: ORG, idempotencyKey: "k-m", at: AT, groupId: g.value.id,
      userId: "user-1", period: period("2026-01-01T00:00:00Z"),
    });
    expect(store.allReceipts()).toHaveLength(4);
    expect(store.allReceipts().every((r) => r.orgScope === ORG)).toBe(true);
  });
});

// ── 3 & 4. amend on an open period, and on a settled one ────────────────

describe("clause amendment and the settled-period rule", () => {
  it("amends a clause whose period is open", async () => {
    const { writer } = setup(null);
    const a = await anAgreement(writer, "k-a");
    const c = await writer.addClause({
      orgScope: ORG, idempotencyKey: "k-c", at: AT, agreementId: a.id,
      factorCode: "per_connector", bearerType: "org", rateRefCode: "R1",
      period: period("2026-06-01T00:00:00Z"),
    });
    const amended = await writer.amendClause({
      orgScope: ORG, idempotencyKey: "k-am", at: AT,
      clauseId: c.value.id, rateRefCode: "R2",
    });
    expect(amended.value.rateRefCode).toBe("R2");
  });

  it("REFUSES an amendment that would change a settled period, with a named reason", async () => {
    // Settled through July. The clause starts in June, so amending it would
    // change what a settled month cost.
    const { writer } = setup("2026-07-31T23:59:59Z");
    const a = await anAgreement(writer, "k-a");
    const c = await writer.addClause({
      orgScope: ORG, idempotencyKey: "k-c", at: AT, agreementId: a.id,
      factorCode: "per_connector", bearerType: "org", rateRefCode: "R1",
      period: period("2026-06-01T00:00:00Z"),
    });
    await expect(
      writer.amendClause({
        orgScope: ORG, idempotencyKey: "k-am", at: AT,
        clauseId: c.value.id, rateRefCode: "R2",
      }),
    ).rejects.toMatchObject({ reason: "amend_would_change_settled_period" });
  });

  it("an UNAVAILABLE watermark refuses too — absence is not permission", async () => {
    const store = new FixtureAgreementStore();
    const writer = new AgreementWriter({
      store,
      settled: new UnavailableSettledPeriod(),
      knownFactorCodes: FACTORS,
    });
    const a = await anAgreement(writer, "k-a");
    const c = await writer.addClause({
      orgScope: ORG, idempotencyKey: "k-c", at: AT, agreementId: a.id,
      factorCode: "per_connector", bearerType: "org", rateRefCode: "R1",
      period: period("2026-06-01T00:00:00Z"),
    });
    await expect(
      writer.amendClause({
        orgScope: ORG, idempotencyKey: "k-am", at: AT, clauseId: c.value.id, rateRefCode: "R2",
      }),
    ).rejects.toMatchObject({ reason: "amend_would_change_settled_period" });
  });

  it("the remedy is end-and-add, and it works", async () => {
    const { writer } = setup("2026-07-31T23:59:59Z");
    const a = await anAgreement(writer, "k-a");
    const c = await writer.addClause({
      orgScope: ORG, idempotencyKey: "k-c", at: AT, agreementId: a.id,
      factorCode: "per_connector", bearerType: "org", rateRefCode: "R1",
      period: period("2026-06-01T00:00:00Z"),
    });
    await writer.endClause({
      orgScope: ORG, idempotencyKey: "k-e", at: AT,
      clauseId: c.value.id, until: "2026-08-01T00:00:00Z",
    });
    const next = await writer.addClause({
      orgScope: ORG, idempotencyKey: "k-c2", at: AT, agreementId: a.id,
      factorCode: "per_connector", bearerType: "org", rateRefCode: "R2",
      period: period("2026-08-01T00:00:00Z"),
    });
    expect(next.value.rateRefCode).toBe("R2");
    expect(next.value.period.from).toBe("2026-08-01T00:00:00Z");
  });
});

// ── 5 & 6. terminate, and terminate twice ───────────────────────────────

describe("terminate closes an interval and never deletes", () => {
  it("terminating sets the end and keeps the row", async () => {
    const { writer, store } = setup();
    const a = await anAgreement(writer, "k-a");
    const t = await writer.terminateAgreement({
      orgScope: ORG, idempotencyKey: "k-t", at: AT,
      agreementId: a.id, until: "2026-09-01T00:00:00Z",
    });
    expect(t.value.period.until).toBe("2026-09-01T00:00:00Z");
    expect(store.agreements.size).toBe(1);
  });

  it("terminating twice with a different key refuses", async () => {
    const { writer } = setup();
    const a = await anAgreement(writer, "k-a");
    await writer.terminateAgreement({
      orgScope: ORG, idempotencyKey: "k-t", at: AT, agreementId: a.id, until: "2026-09-01T00:00:00Z",
    });
    await expect(
      writer.terminateAgreement({
        orgScope: ORG, idempotencyKey: "k-t2", at: AT, agreementId: a.id, until: "2026-10-01T00:00:00Z",
      }),
    ).rejects.toMatchObject({ reason: "already_terminated" });
  });

  it("terminating twice with the SAME key replays rather than refusing", async () => {
    const { writer } = setup();
    const a = await anAgreement(writer, "k-a");
    const first = await writer.terminateAgreement({
      orgScope: ORG, idempotencyKey: "k-t", at: AT, agreementId: a.id, until: "2026-09-01T00:00:00Z",
    });
    const again = await writer.terminateAgreement({
      orgScope: ORG, idempotencyKey: "k-t", at: AT, agreementId: a.id, until: "2026-09-01T00:00:00Z",
    });
    expect(again.receipt.replayed).toBe(true);
    expect(again.value.period.until).toBe(first.value.period.until);
  });
});

// ── 7. a clause with no bearer ──────────────────────────────────────────

describe("a clause must name who bears the cost", () => {
  it("refuses an empty bearer", async () => {
    const { writer } = setup();
    const a = await anAgreement(writer, "k-a");
    await expect(
      writer.addClause({
        orgScope: ORG, idempotencyKey: "k-c", at: AT, agreementId: a.id,
        factorCode: "per_connector", bearerType: "", rateRefCode: null,
        period: period("2026-01-01T00:00:00Z"),
      }),
    ).rejects.toMatchObject({ reason: "clause_has_no_bearer" });
  });

  it("refuses a bearer type that is not a rung of the ladder", async () => {
    const { writer } = setup();
    const a = await anAgreement(writer, "k-a");
    await expect(
      writer.addClause({
        orgScope: ORG, idempotencyKey: "k-c", at: AT, agreementId: a.id,
        factorCode: "per_connector", bearerType: "the_moon", rateRefCode: null,
        period: period("2026-01-01T00:00:00Z"),
      }),
    ).rejects.toMatchObject({ reason: "unknown_bearer_type" });
  });

  it("refuses an unknown factor code", async () => {
    const { writer } = setup();
    const a = await anAgreement(writer, "k-a");
    await expect(
      writer.addClause({
        orgScope: ORG, idempotencyKey: "k-c", at: AT, agreementId: a.id,
        factorCode: "per_unicorn", bearerType: "org", rateRefCode: null,
        period: period("2026-01-01T00:00:00Z"),
      }),
    ).rejects.toMatchObject({ reason: "unknown_factor_code" });
  });
});

// ── 8. two clauses overlapping in time ──────────────────────────────────

describe("overlap", () => {
  it("refuses two clauses for one factor overlapping in time", async () => {
    const { writer } = setup();
    const a = await anAgreement(writer, "k-a");
    await writer.addClause({
      orgScope: ORG, idempotencyKey: "k-c1", at: AT, agreementId: a.id,
      factorCode: "per_connector", bearerType: "org", rateRefCode: "R1",
      period: period("2026-01-01T00:00:00Z"),
    });
    await expect(
      writer.addClause({
        orgScope: ORG, idempotencyKey: "k-c2", at: AT, agreementId: a.id,
        factorCode: "per_connector", bearerType: "org", rateRefCode: "R2",
        period: period("2026-06-01T00:00:00Z"),
      }),
    ).rejects.toMatchObject({ reason: "period_overlaps_existing" });
  });

  it("allows two clauses for DIFFERENT factors over the same interval", async () => {
    const { writer } = setup();
    const a = await anAgreement(writer, "k-a");
    await writer.addClause({
      orgScope: ORG, idempotencyKey: "k-c1", at: AT, agreementId: a.id,
      factorCode: "per_connector", bearerType: "org", rateRefCode: "R1",
      period: period("2026-01-01T00:00:00Z"),
    });
    const second = await writer.addClause({
      orgScope: ORG, idempotencyKey: "k-c2", at: AT, agreementId: a.id,
      factorCode: "per_driver", bearerType: "org", rateRefCode: "R2",
      period: period("2026-01-01T00:00:00Z"),
    });
    expect(second.value.id).toBeTruthy();
  });

  it("allows the same factor again once the first clause has closed", async () => {
    const { writer } = setup();
    const a = await anAgreement(writer, "k-a");
    const c = await writer.addClause({
      orgScope: ORG, idempotencyKey: "k-c1", at: AT, agreementId: a.id,
      factorCode: "per_connector", bearerType: "org", rateRefCode: "R1",
      period: period("2026-01-01T00:00:00Z"),
    });
    await writer.endClause({
      orgScope: ORG, idempotencyKey: "k-e", at: AT, clauseId: c.value.id, until: "2026-06-01T00:00:00Z",
    });
    const next = await writer.addClause({
      orgScope: ORG, idempotencyKey: "k-c2", at: AT, agreementId: a.id,
      factorCode: "per_connector", bearerType: "org", rateRefCode: "R2",
      period: period("2026-06-01T00:00:00Z"),
    });
    expect(next.value.id).toBeTruthy();
  });

  it("refuses a clause reaching beyond the agreement interval", async () => {
    const { writer } = setup();
    const r = await writer.createAgreement({
      orgScope: ORG, idempotencyKey: "k-a", at: AT,
      agreementType: "installation", displayName: "x",
      counterpartyOrgId: "host-1", installationId: null,
      period: { from: "2026-01-01T00:00:00Z", until: "2026-06-01T00:00:00Z" },
    });
    await expect(
      writer.addClause({
        orgScope: ORG, idempotencyKey: "k-c", at: AT, agreementId: r.value.id,
        factorCode: "per_connector", bearerType: "org", rateRefCode: null,
        period: period("2026-01-01T00:00:00Z"),
      }),
    ).rejects.toMatchObject({ reason: "agreement_period_does_not_cover_clause" });
  });
});

// ── 9, 10, 11. memberships and the default idTag ────────────────────────

describe("memberships are intervals, not existence", () => {
  async function aGroup(writer: AgreementWriter) {
    const a = await anAgreement(writer, "k-a");
    const g = await writer.createGroup({
      orgScope: ORG, idempotencyKey: "k-g", at: AT,
      agreementId: a.id, displayName: "Dwellers", ownerOrgId: "host-1",
    });
    return g.value;
  }

  it("adds a membership mid-period", async () => {
    const { writer } = setup();
    const g = await aGroup(writer);
    const m = await writer.addMembership({
      orgScope: ORG, idempotencyKey: "k-m", at: AT,
      groupId: g.id, userId: "user-1", period: period("2026-07-15T00:00:00Z"),
    });
    expect(m.value.period.from).toBe("2026-07-15T00:00:00Z");
    expect(m.value.period.until).toBeNull();
  });

  it("removes a membership mid-period by CLOSING it, never deleting", async () => {
    const { writer, store } = setup();
    const g = await aGroup(writer);
    const m = await writer.addMembership({
      orgScope: ORG, idempotencyKey: "k-m", at: AT,
      groupId: g.id, userId: "user-1", period: period("2026-01-01T00:00:00Z"),
    });
    const removed = await writer.removeMembership({
      orgScope: ORG, idempotencyKey: "k-r", at: AT,
      membershipId: m.value.id, until: "2026-07-15T00:00:00Z",
    });
    expect(removed.value.period.until).toBe("2026-07-15T00:00:00Z");
    expect(store.memberships.size).toBe(1);
  });

  it("move-out then move-in is expressible — the uniqueness is on the interval", async () => {
    const { writer, store } = setup();
    const g = await aGroup(writer);
    const first = await writer.addMembership({
      orgScope: ORG, idempotencyKey: "k-m1", at: AT,
      groupId: g.id, userId: "user-1", period: period("2026-01-01T00:00:00Z"),
    });
    await writer.removeMembership({
      orgScope: ORG, idempotencyKey: "k-r", at: AT,
      membershipId: first.value.id, until: "2026-04-01T00:00:00Z",
    });
    const second = await writer.addMembership({
      orgScope: ORG, idempotencyKey: "k-m2", at: AT,
      groupId: g.id, userId: "user-1", period: period("2026-09-01T00:00:00Z"),
    });
    expect(second.value.id).not.toBe(first.value.id);
    expect(store.membershipsOf(g.id, "user-1")).toHaveLength(2);
  });

  it("refuses an overlapping membership for the same user", async () => {
    const { writer } = setup();
    const g = await aGroup(writer);
    await writer.addMembership({
      orgScope: ORG, idempotencyKey: "k-m1", at: AT,
      groupId: g.id, userId: "user-1", period: period("2026-01-01T00:00:00Z"),
    });
    await expect(
      writer.addMembership({
        orgScope: ORG, idempotencyKey: "k-m2", at: AT,
        groupId: g.id, userId: "user-1", period: period("2026-06-01T00:00:00Z"),
      }),
    ).rejects.toMatchObject({ reason: "membership_overlaps_existing" });
  });

  it("THE DEFAULT idTag IS AN ORDINARY MEMBER — no branch, no nullable userId", async () => {
    const { writer } = setup();
    const a = await anAgreement(writer, "k-a");
    const g = await writer.createGroup({
      orgScope: ORG, idempotencyKey: "k-g", at: AT,
      agreementId: a.id, displayName: "Installation default", ownerOrgId: "host-1",
    });
    // The token is registered as a user like any other and joins the group
    // like any other. The clause's bearer is `org`, which is what makes the
    // installation rather than a person pay for it.
    const m = await writer.addMembership({
      orgScope: ORG, idempotencyKey: "k-m", at: AT,
      groupId: g.value.id, userId: "user-default-token", period: period("2026-01-01T00:00:00Z"),
    });
    const clause = await writer.addClause({
      orgScope: ORG, idempotencyKey: "k-c", at: AT, agreementId: a.id,
      factorCode: "per_driver", bearerType: "org", rateRefCode: "R1",
      period: period("2026-01-01T00:00:00Z"),
    });
    expect(m.value.userId).toBe("user-default-token");
    expect(m.value.userId).not.toBeNull();
    expect(clause.value.bearerType).toBe("org");
  });
});

// ── 12. cross-tenant on every write ─────────────────────────────────────

describe("cross-tenant refusal on every mutating operation", () => {
  it("refuses a write from another tenant on every operation that targets a row", async () => {
    const { writer } = setup();
    const a = await anAgreement(writer, "k-a");
    const c = await writer.addClause({
      orgScope: ORG, idempotencyKey: "k-c", at: AT, agreementId: a.id,
      factorCode: "per_connector", bearerType: "org", rateRefCode: "R1",
      period: period("2026-01-01T00:00:00Z"),
    });
    const g = await writer.createGroup({
      orgScope: ORG, idempotencyKey: "k-g", at: AT,
      agreementId: a.id, displayName: "D", ownerOrgId: "host-1",
    });
    const m = await writer.addMembership({
      orgScope: ORG, idempotencyKey: "k-m", at: AT,
      groupId: g.value.id, userId: "u1", period: period("2026-01-01T00:00:00Z"),
    });
    const b = await writer.setBearerRule({
      orgScope: ORG, idempotencyKey: "k-b", at: AT, agreementId: a.id,
      factorCode: "per_connector", scopeType: null, scopeId: null,
      audienceType: null, audienceId: null, bearerType: "org", rateRefCode: "R1",
      period: period("2026-01-01T00:00:00Z"),
    });

    const attempts: Array<Promise<unknown>> = [
      writer.amendAgreement({ orgScope: OTHER, idempotencyKey: "x1", at: AT, agreementId: a.id, displayName: "hi" }),
      writer.terminateAgreement({ orgScope: OTHER, idempotencyKey: "x2", at: AT, agreementId: a.id, until: "2026-09-01T00:00:00Z" }),
      writer.addClause({ orgScope: OTHER, idempotencyKey: "x3", at: AT, agreementId: a.id, factorCode: "per_kwh", bearerType: "org", rateRefCode: null, period: period("2026-01-01T00:00:00Z") }),
      writer.amendClause({ orgScope: OTHER, idempotencyKey: "x4", at: AT, clauseId: c.value.id, rateRefCode: "R9" }),
      writer.endClause({ orgScope: OTHER, idempotencyKey: "x5", at: AT, clauseId: c.value.id, until: "2026-09-01T00:00:00Z" }),
      writer.createGroup({ orgScope: OTHER, idempotencyKey: "x6", at: AT, agreementId: a.id, displayName: "G", ownerOrgId: "host-2" }),
      writer.renameGroup({ orgScope: OTHER, idempotencyKey: "x7", at: AT, groupId: g.value.id, displayName: "G2" }),
      writer.closeGroup({ orgScope: OTHER, idempotencyKey: "x8", at: AT, groupId: g.value.id, until: "2026-09-01T00:00:00Z" }),
      writer.addMembership({ orgScope: OTHER, idempotencyKey: "x9", at: AT, groupId: g.value.id, userId: "u2", period: period("2026-02-01T00:00:00Z") }),
      writer.removeMembership({ orgScope: OTHER, idempotencyKey: "x10", at: AT, membershipId: m.value.id, until: "2026-09-01T00:00:00Z" }),
      writer.setBearerRule({ orgScope: OTHER, idempotencyKey: "x11", at: AT, agreementId: a.id, factorCode: "per_kwh", scopeType: null, scopeId: null, audienceType: null, audienceId: null, bearerType: "org", rateRefCode: null, period: period("2026-01-01T00:00:00Z") }),
      writer.changeBearerRule({ orgScope: OTHER, idempotencyKey: "x12", at: AT, bearerRuleId: b.value.id, bearerType: "user", supersedeFrom: "2026-09-01T00:00:00Z" }),
    ];
    const results = await Promise.allSettled(attempts);
    expect(results).toHaveLength(12);
    for (const r of results) {
      expect(r.status).toBe("rejected");
      expect((r as PromiseRejectedResult).reason).toBeInstanceOf(WriteRefused);
      expect((r as PromiseRejectedResult).reason.reason).toBe("cross_tenant_write");
    }
  });
});

// ── the bearer ladder ───────────────────────────────────────────────────

describe("the bearer ladder is expressible in full and no wider", () => {
  it("expresses every rung BearerRuleRow reads", async () => {
    const { writer } = setup();
    const a = await anAgreement(writer, "k-a");
    const r = await writer.setBearerRule({
      orgScope: ORG, idempotencyKey: "k-b", at: AT, agreementId: a.id,
      factorCode: "per_kwh", scopeType: "installation", scopeId: "inst-1",
      audienceType: "driver_group", audienceId: "grp-1",
      bearerType: "driver_group", rateRefCode: "R7",
      period: period("2026-01-01T00:00:00Z"),
    });
    expect(r.value).toMatchObject({
      factorCode: "per_kwh", scopeType: "installation", scopeId: "inst-1",
      audienceType: "driver_group", audienceId: "grp-1",
      bearerType: "driver_group", rateRefCode: "R7",
    });
  });

  it("changing a rung supersedes it — the old row is closed, not rewritten", async () => {
    const { writer, store } = setup();
    const a = await anAgreement(writer, "k-a");
    const first = await writer.setBearerRule({
      orgScope: ORG, idempotencyKey: "k-b", at: AT, agreementId: a.id,
      factorCode: "per_kwh", scopeType: null, scopeId: null,
      audienceType: null, audienceId: null, bearerType: "org", rateRefCode: "R1",
      period: period("2026-01-01T00:00:00Z"),
    });
    const changed = await writer.changeBearerRule({
      orgScope: ORG, idempotencyKey: "k-bc", at: AT,
      bearerRuleId: first.value.id, bearerType: "user", supersedeFrom: "2026-06-01T00:00:00Z",
    });
    expect(store.bearerRulesOf(a.id)).toHaveLength(2);
    expect(store.getBearerRule(first.value.id)!.period.until).toBe("2026-06-01T00:00:00Z");
    expect(changed.value.bearerType).toBe("user");
    expect(changed.value.period.from).toBe("2026-06-01T00:00:00Z");
  });
});

// ── provenance and interval semantics ───────────────────────────────────

describe("provenance", () => {
  it("every operation names the read interface it was derived from", () => {
    for (const op of WRITE_OPERATIONS) {
      expect(OPERATION_PROVENANCE[op]).toBeTruthy();
    }
    expect(Object.keys(OPERATION_PROVENANCE).sort()).toEqual([...WRITE_OPERATIONS].sort());
  });
});

describe("half-open interval semantics", () => {
  it("the boundary instant belongs to the LATER interval", () => {
    const a = period("2026-01-01T00:00:00Z", "2026-06-01T00:00:00Z");
    const b = period("2026-06-01T00:00:00Z", null);
    expect(coversInstant(a, "2026-06-01T00:00:00Z")).toBe(false);
    expect(coversInstant(b, "2026-06-01T00:00:00Z")).toBe(true);
  });

  it("touching intervals do not overlap", () => {
    expect(
      periodsOverlap(
        period("2026-01-01T00:00:00Z", "2026-06-01T00:00:00Z"),
        period("2026-06-01T00:00:00Z", null),
      ),
    ).toBe(false);
  });

  it("an open-ended interval overlaps anything later", () => {
    expect(periodsOverlap(period("2026-01-01T00:00:00Z"), period("2030-01-01T00:00:00Z"))).toBe(true);
  });
});

// ── fool-tests ──────────────────────────────────────────────────────────

describe("FOOL A — generate an idempotency key when the caller omits one", () => {
  // The ergonomic "helpful" default. It defeats the mechanism completely: the
  // retry arrives with a fresh key and the agreement is created twice.
  const keyOrGenerate = (k: string) => (k && k.trim() !== "" ? k : `gen-${Math.floor(1)}`);

  it("the fooled version invents a key and would let a retry write twice", () => {
    expect(keyOrGenerate("")).toBe("gen-1");
    expect(keyOrGenerate("")).toBeTruthy();
  });

  it("the real writer refuses", async () => {
    const { writer } = setup();
    await expect(
      writer.createAgreement({
        orgScope: ORG, idempotencyKey: "", at: AT,
        agreementType: "installation", displayName: "x",
        counterpartyOrgId: "h", installationId: null,
        period: period("2026-01-01T00:00:00Z"),
      }),
    ).rejects.toMatchObject({ reason: "idempotency_key_required" });
  });
});

describe("FOOL B — treat an unavailable settled watermark as nothing-settled", () => {
  // The tempting read: no watermark came back, so nothing is settled, so the
  // amendment is safe. It is the exact opposite — an unreadable watermark is
  // the case where you have least reason to be confident.
  const fooledGuard = (watermark: string | null | "unavailable", instant: string) =>
    watermark === "unavailable" ? true : watermark === null ? true : instant > watermark;

  it("the fooled guard permits an amendment it cannot justify", () => {
    expect(fooledGuard("unavailable", "2026-01-01T00:00:00Z")).toBe(true);
  });

  it("the real writer refuses when the watermark cannot be read", async () => {
    const store = new FixtureAgreementStore();
    const writer = new AgreementWriter({
      store, settled: new UnavailableSettledPeriod("neon unreachable"), knownFactorCodes: FACTORS,
    });
    const a = await anAgreement(writer, "k-a");
    const c = await writer.addClause({
      orgScope: ORG, idempotencyKey: "k-c", at: AT, agreementId: a.id,
      factorCode: "per_connector", bearerType: "org", rateRefCode: "R1",
      period: period("2026-01-01T00:00:00Z"),
    });
    await expect(
      writer.amendClause({ orgScope: ORG, idempotencyKey: "k-am", at: AT, clauseId: c.value.id, rateRefCode: "R2" }),
    ).rejects.toMatchObject({ reason: "amend_would_change_settled_period" });
  });
});

describe("FOOL C — delete a membership instead of closing it", () => {
  it("the fooled removal loses the interval a dispute would read", async () => {
    const { writer, store } = setup();
    const a = await anAgreement(writer, "k-a");
    const g = await writer.createGroup({
      orgScope: ORG, idempotencyKey: "k-g", at: AT, agreementId: a.id, displayName: "D", ownerOrgId: "h",
    });
    const m = await writer.addMembership({
      orgScope: ORG, idempotencyKey: "k-m", at: AT, groupId: g.value.id, userId: "u1", period: period("2026-01-01T00:00:00Z"),
    });
    // The fooled version:
    const fooled = new Map(store.memberships);
    fooled.delete(m.value.id);
    expect(fooled.size).toBe(0);

    // The real one:
    await writer.removeMembership({
      orgScope: ORG, idempotencyKey: "k-r", at: AT, membershipId: m.value.id, until: "2026-07-01T00:00:00Z",
    });
    expect(store.memberships.size).toBe(1);
    expect(store.getMembership(m.value.id)!.period.until).toBe("2026-07-01T00:00:00Z");
  });
});
