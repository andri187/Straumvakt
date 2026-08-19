// Tests for the onboarding dry run.
//
// The script itself is the artifact an operator runs; this is what keeps it
// honest in CI, where nobody is reading the output.

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

  it.each(CASES.map((c) => [c.name, c] as const))("case %s behaves as expected", (_n, c) => {
    expect(runCase(c).ok).toBe(true);
  });
});

describe("the happy path reaches the invoice contract, not just the checklist", () => {
  const world = stepSetFlatFeeAgreement(
    stepAttachCharger(stepEnrolUser(stepCreateOrg(EMPTY, { kennitala: HOST_KENNITALA }))),
  );

  it("readiness reports invoiceable with no holds", () => {
    const r = assessOrgReadiness(factsOf(world));
    expect(r.invoiceable).toBe(true);
    expect(r.holds).toEqual([]);
  });

  it("and the invoice document actually constructs", () => {
    const proof = proveInvoiceAccepts(world);
    expect(proof.ok).toBe(true);
    expect(proof.header).toBeTruthy();
  });

  it("the rendered header names the org as payer", () => {
    expect(proveInvoiceAccepts(world).header).toContain("Dry Run Host ehf.");
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

  it("appears in no case output", () => {
    for (const c of CASES) {
      expect(runCase(c).lines.join("\n")).not.toContain(HOST_KENNITALA);
    }
  });
});

// ── fool-tests ──────────────────────────────────────────────────────────

describe("FOOL 5 — let readiness stand in for the invoice contract", () => {
  // The tempting shortcut: if the checklist passes, declare victory. It would
  // pass an org whose legal name is blank, because readiness checks presence
  // and the header checks renderability — related, not identical.
  const world = stepSetFlatFeeAgreement(
    stepAttachCharger(stepEnrolUser(stepCreateOrg(EMPTY, { kennitala: HOST_KENNITALA }))),
  );
  const blankLegalName = { ...world, org: { ...world.org!, legalName: "   " } };

  it("readiness alone would... also catch this one", () => {
    // Stated honestly: for a BLANK name the two agree, because readiness
    // trims. The point of the fool-test is the next assertion.
    expect(assessOrgReadiness(factsOf(blankLegalName)).invoiceable).toBe(false);
  });

  it("but readiness cannot know the invoice contract refuses a zero-connector document", () => {
    // Connectors present per the asset chain, but the org has none billable.
    const zeroConnectors = { ...world, connectorCount: 0 };
    // Readiness holds — good.
    expect(assessOrgReadiness(factsOf(zeroConnectors)).invoiceable).toBe(false);
    // And the invoice contract independently refuses, which is the belt the
    // dry run wears in addition to the braces.
    expect(proveInvoiceAccepts(zeroConnectors).ok).toBe(false);
  });
});

describe("FOOL 6 — accept the happy path without checking exit semantics", () => {
  // A runner that always returned ok:true would make every case pass.
  const runFooled = (_c: unknown) => ({ ok: true, lines: [] as string[] });

  it("the fooled runner passes a case that should fail", () => {
    const broken = CASES.find((c) => c.name === "no-agreement")!;
    expect(runFooled(broken).ok).toBe(true);
  });

  it("the real runner distinguishes expected-fail from unexpected-pass", () => {
    const broken = CASES.find((c) => c.name === "no-agreement")!;
    // It is "ok" in the sense that the case behaved as expected — and the
    // readiness inside it is NOT invoiceable, which is the real assertion.
    const world = broken.build();
    expect(assessOrgReadiness(factsOf(world)).invoiceable).toBe(false);
    expect(runCase(broken).ok).toBe(true);
  });
});
