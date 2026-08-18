import { describe, expect, it } from "vitest";

import {
  computeTotals,
  createInvoiceDocument,
  InvoiceConstructionError,
  isIssuable,
  posturesOf,
  validateDraft,
  vatBucketKey,
} from "./document";
import type { InvoiceDraft } from "./document";
import {
  DOCUMENT_FIXTURES,
  FIXTURE_COUNT,
  HOST_A,
  STRAUMVAKT,
  agentEnergyLine,
  connectorLine,
  driverLine,
} from "./fixtures";

describe("fixture corpus", () => {
  it("meets the ≥40 floor", () => {
    expect(FIXTURE_COUNT).toBeGreaterThanOrEqual(40);
  });

  it.each(DOCUMENT_FIXTURES.map((f) => [f.name, f] as const))(
    "%s",
    (_name, f) => {
      const problems = validateDraft(f.draft);
      const codes = problems.map((p) => p.code);
      if (f.expect.issuable) {
        expect(codes).toEqual([]);
        expect(() => createInvoiceDocument(f.draft)).not.toThrow();
      } else {
        for (const expected of f.expect.codes) expect(codes).toContain(expected);
        expect(() => createInvoiceDocument(f.draft)).toThrow(InvoiceConstructionError);
      }
    },
  );
});

describe("mixed posture is rejected AT CONSTRUCTION, not at render", () => {
  const mixed: InvoiceDraft = {
    ...DOCUMENT_FIXTURES[0].draft,
    claimHolder: HOST_A,
    presenter: STRAUMVAKT,
    lines: [connectorLine(1), agentEnergyLine(10)],
  };

  it("posturesOf sees both postures", () => {
    expect([...posturesOf(mixed.lines)].sort()).toEqual(["agent", "principal"]);
  });

  it("throws rather than returning a document", () => {
    expect(() => createInvoiceDocument(mixed)).toThrow(InvoiceConstructionError);
  });

  it("names mixed_posture among the reasons", () => {
    try {
      createInvoiceDocument(mixed);
      expect.unreachable("construction should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(InvoiceConstructionError);
      expect((e as InvoiceConstructionError).problems.map((p) => p.code)).toContain(
        "mixed_posture",
      );
    }
  });

  it("no mixed-posture document object can exist to be rendered", () => {
    // The point of construction-time rejection: there is no value of type
    // InvoiceDocument carrying two postures, so no downstream code has to
    // remember to check.
    let escaped: unknown = null;
    try {
      escaped = createInvoiceDocument(mixed);
    } catch {
      /* expected */
    }
    expect(escaped).toBeNull();
  });
});

describe("the kröfuhafi is never inferred", () => {
  it("a draft with no claimHolder identity is refused, not defaulted", () => {
    const d = {
      ...DOCUMENT_FIXTURES[0].draft,
      claimHolder: { ...STRAUMVAKT, registeredId: "" },
    };
    expect(validateDraft(d).map((p) => p.code)).toContain("claimHolder_registered_id_missing");
  });

  it("construction does not substitute the platform party", () => {
    const d = {
      ...DOCUMENT_FIXTURES[0].draft,
      claimHolder: { ...STRAUMVAKT, legalName: "" },
    };
    expect(() => createInvoiceDocument(d)).toThrow(InvoiceConstructionError);
  });
});

describe("totals", () => {
  it("states VAT separately per rate", () => {
    const totals = computeTotals([
      connectorLine(2), // 400 @ 24%
      { ...driverLine(3), vat: { kind: "reduced", ratePercent: 11 } }, // 150 @ 11%
    ]);
    expect(totals.byVatRate).toHaveLength(2);
    expect(totals.net).toBe(550);
    expect(totals.vat).toBe(96 + 17); // 400*.24=96, 150*.11=16.5 -> 17
    expect(totals.gross).toBe(550 + 113);
  });

  it("rounds VAT once per bucket, not per line", () => {
    // Three lines at 33 each: per-line rounding of 24% gives 8+8+8 = 24.
    // Bucket rounding of 99 gives 24 as well here, but the sum is computed
    // from the bucket so the two can never drift apart by construction.
    const totals = computeTotals([
      connectorLine(1, 33),
      connectorLine(1, 33),
      connectorLine(1, 33),
    ]);
    expect(totals.net).toBe(99);
    expect(totals.vat).toBe(Math.round((99 * 24) / 100));
  });

  it("groups by rate, not by line order", () => {
    const a = computeTotals([connectorLine(1), driverLine(1)]);
    const b = computeTotals([driverLine(1), connectorLine(1)]);
    expect(a).toEqual(b);
  });

  it("vatBucketKey separates not_registered from a zero rate", () => {
    expect(vatBucketKey({ kind: "not_registered" })).not.toBe(
      vatBucketKey({ kind: "standard", ratePercent: 0 }),
    );
  });
});

describe("constructed documents are frozen", () => {
  it("cannot be mutated after construction", () => {
    const doc = createInvoiceDocument(DOCUMENT_FIXTURES[0].draft);
    expect(Object.isFrozen(doc)).toBe(true);
    expect(Object.isFrozen(doc.lines)).toBe(true);
  });

  it("carries the derived posture", () => {
    const doc = createInvoiceDocument(DOCUMENT_FIXTURES[0].draft);
    expect(doc.posture).toBe("principal");
  });

  it("isIssuable agrees with createInvoiceDocument", () => {
    for (const f of DOCUMENT_FIXTURES) {
      expect(isIssuable(f.draft)).toBe(f.expect.issuable === true);
    }
  });
});
