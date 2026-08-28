// Tests for the onboarding dry run.
//
// The script itself is the artifact an operator runs; this is what keeps it
// honest in CI, where nobody is reading the output.
//
// Round 4: the agreement step became genuinely async, because it now drives
// the real AgreementWriter instead of fabricating a fact. Every helper that
// builds a world is awaited — an earlier draft assumed a fixture store
// settles synchronously, and the dry run caught that it does not.

import { describe, expect, it } from "vitest";

import {
  CASES,
  EMPTY,
  HOST_KENNITALA,
  factsOf,
  proveInvoiceAccepts,
  runCase,
  stepAttachCharger,
  stepCreateOrg,
  stepEnrolUser,
  stepSetFlatFeeAgreement,
} from "./dry-run-onboard-org.mts";
import { isValidKennitala } from "../packages/contracts/src/invoice/kennitala.ts";
import { assessOrgReadiness } from "../packages/contracts/src/onboarding/org-readiness.ts";

/** The fully onboarded world, built through the real write surface. */
const onboarded = () =>
  stepSetFlatFeeAgreement(
    stepAttachCharger(stepEnrolUser(stepCreateOrg(EMPTY, { kennitala: HOST_KENNITALA }))),
  );

describe("the case corpus", () => {
  it("has at least four cases", () => {
    expect(CASES.length).toBeGreaterThanOrEqual(4);
  });

  it("has exactly one happy path", () => {
    expect(CASES.filter((c) => c.expectInvoiceable)).toHaveLength(1);
  });

  it("every non-happy case names the hold it expects", () => {
    for (const c of CASES) {
      if (!c.expectInvoiceable) expect(c.expectHold).toBeTruthy();
    }
  });

  it.each(CASES.map((c) => [c.name, c] as const))("case %s behaves as expected", async (_n, c) => {
    expect((await runCase(c)).ok).toBe(true);
  });
});

describe("the happy path reaches the invoice contract, not just the checklist", () => {
  it("readiness reports invoiceable with no holds", async () => {
    const r = assessOrgReadiness(factsOf(await onboarded()));
    expect(r.invoiceable).toBe(true);
    expect(r.holds).toEqual([]);
  });

  it("and the invoice document actually constructs", async () => {
    const proof = proveInvoiceAccepts(await onboarded());
    expect(proof.ok).toBe(true);
    expect(proof.header).toBeTruthy();
  });

  it("the rendered header names the org as payer", async () => {
    expect(proveInvoiceAccepts(await onboarded()).header).toContain("Dry Run Host ehf.");
  });
});

describe("the agreement comes from the write surface, not from a fixture fact", () => {
  it("the store actually holds an agreement and two clauses", async () => {
    const w = await onboarded();
    expect(w.agreementWriteStore).toBeTruthy();
    const store = w.agreementWriteStore!;
    expect(store.agreements.size).toBe(1);
    const [agreement] = [...store.agreements.values()];
    expect(store.clausesOf(agreement.id)).toHaveLength(2);
  });

  it("one of those clauses is the per-connector rate readiness requires", async () => {
    const w = await onboarded();
    const store = w.agreementWriteStore!;
    const [agreement] = [...store.agreements.values()];
    expect(
      store.clausesOf(agreement.id).some((c) => c.factorCode === "per_connector"),
    ).toBe(true);
  });

  it("every write produced a mutation receipt", async () => {
    const w = await onboarded();
    // create + two clauses.
    expect(w.agreementWriteStore!.allReceipts()).toHaveLength(3);
  });
});

describe("the synthetic host identity", () => {
  it("is well-formed", () => {
    expect(isValidKennitala(HOST_KENNITALA)).toBe(true);
  });

  it("is dated in the future, so it cannot have been issued to anyone", () => {
    // DDMMYY = 311299, century marker 0 -> 2099-12-31.
    expect(HOST_KENNITALA.slice(0, 6)).toBe("311299");
    expect(HOST_KENNITALA[9]).toBe("0");
  });

  it("appears in no case output", async () => {
    for (const c of CASES) {
      expect((await runCase(c)).lines.join("\n")).not.toContain(HOST_KENNITALA);
    }
  });
});

// ── fool-tests ──────────────────────────────────────────────────────────

describe("FOOL 5 — let readiness stand in for the invoice contract", () => {
  it("readiness catches a blank legal name", async () => {
    const w = await onboarded();
    const blankLegalName = { ...w, org: { ...w.org!, legalName: "   " } };
    // Stated honestly: for a BLANK name the two agree, because readiness
    // trims. The point of the fool-test is the next assertion.
    expect(assessOrgReadiness(factsOf(blankLegalName)).invoiceable).toBe(false);
  });

  it("but the invoice contract is the one that refuses a zero-connector document", async () => {
    const w = await onboarded();
    const zeroConnectors = { ...w, connectorCount: 0 };
    expect(assessOrgReadiness(factsOf(zeroConnectors)).invoiceable).toBe(false);
    // And independently — the belt the dry run wears in addition to the braces.
    expect(proveInvoiceAccepts(zeroConnectors).ok).toBe(false);
  });
});

describe("FOOL 6 — accept the happy path without checking exit semantics", () => {
  const runFooled = (_c: unknown) => ({ ok: true, lines: [] as string[] });

  it("the fooled runner passes a case that should fail", () => {
    const broken = CASES.find((c) => c.name === "no-agreement")!;
    expect(runFooled(broken).ok).toBe(true);
  });

  it("the real runner distinguishes expected-fail from unexpected-pass", async () => {
    const broken = CASES.find((c) => c.name === "no-agreement")!;
    const world = await broken.build();
    expect(assessOrgReadiness(factsOf(world)).invoiceable).toBe(false);
    expect((await runCase(broken)).ok).toBe(true);
  });
});

describe("FOOL D — fire the agreement writes without awaiting them", () => {
  // The actual bug this round produced and the dry run caught: a floating
  // promise chain looks like it wrote the clauses, and readiness then reads a
  // store that has an agreement and no clauses yet.
  it("an un-awaited world has no clauses, and readiness correctly holds", async () => {
    const w = await onboarded();
    const store = w.agreementWriteStore!;
    const [agreement] = [...store.agreements.values()];
    // Simulate the un-awaited state by reading the store before clauses land.
    const emptyStoreWorld = {
      ...w,
      agreementWriteStore: Object.assign(Object.create(Object.getPrototypeOf(store)), store, {
        clauses: new Map(),
      }),
    };
    expect(assessOrgReadiness(factsOf(emptyStoreWorld)).holds.map((h) => h.reason)).toContain(
      "agreement_has_no_connector_rate",
    );
    // And the awaited one does not.
    expect(store.clausesOf(agreement.id).length).toBeGreaterThan(0);
    expect(assessOrgReadiness(factsOf(w)).invoiceable).toBe(true);
  });
});
