// CDR provenance invariant — the contract.
//
// The four fixture shapes below are the four population groups actually
// measured on the fleet on 2026-08-10, with their real counts. The
// invariant has to agree with reality on the 1,145 rows that are fine and
// catch exactly the 5 that are not.

import { describe, expect, it } from "vitest";
import {
  checkLedgerProvenance,
  resolveProvenanceViolation,
  DEFAULT_PROVENANCE_TOLERANCE_KWH,
} from "./cdr-provenance";

describe("the four measured population groups", () => {
  it("cdr / complete, energy matches — 1,136 rows — is valid", () => {
    const r = checkLedgerProvenance({
      verifiedSource: "cdr",
      ledgerEnergyKwh: 12.345,
      cdrEnergyKwh: 12.345,
    });
    expect(r.ok).toBe(true);
    expect(r.entitledSource).toBe("cdr");
  });

  it("cdr / mismatch, energy differs — 5 rows — VIOLATES the invariant", () => {
    // The measured worst case: 12.105 kWh apart.
    const r = checkLedgerProvenance({
      verifiedSource: "cdr",
      ledgerEnergyKwh: 30.0,
      cdrEnergyKwh: 17.895,
    });
    expect(r.ok).toBe(false);
    expect(r.violation).toBe("claims_cdr_but_energy_differs");
    expect(r.deltaKwh).toBeCloseTo(12.105, 3);
    expect(r.entitledSource).toBe("ocpp");
  });

  it("ocpp / pending — 9 rows — makes no CDR claim and is fine", () => {
    const r = checkLedgerProvenance({ verifiedSource: "ocpp", ledgerEnergyKwh: 8.2 });
    expect(r.ok).toBe(true);
  });

  it("null source with no CDR — 492 rows — makes no claim and is fine", () => {
    const r = checkLedgerProvenance({ verifiedSource: null, ledgerEnergyKwh: 8.2 });
    expect(r.ok).toBe(true);
    expect(r.entitledSource).toBe("unverified");
  });
});

describe("the invariant itself", () => {
  it("rejects a CDR claim with no CDR to back it", () => {
    const r = checkLedgerProvenance({ verifiedSource: "cdr", ledgerEnergyKwh: 10 });
    expect(r.violation).toBe("claims_cdr_without_cdr_energy");
    expect(r.entitledSource).toBe("unverified");
  });

  it("flags an unlabelled row that already bills the CDR figure", () => {
    const r = checkLedgerProvenance({
      verifiedSource: null,
      ledgerEnergyKwh: 10,
      cdrEnergyKwh: 10,
    });
    expect(r.violation).toBe("unverified_but_has_cdr_energy");
    expect(r.entitledSource).toBe("cdr");
  });

  it("tolerates decimal noise at 1 Wh", () => {
    const r = checkLedgerProvenance({
      verifiedSource: "cdr",
      ledgerEnergyKwh: 10.0005,
      cdrEnergyKwh: 10.0,
    });
    expect(r.ok).toBe(true);
  });

  it("rejects a difference above tolerance", () => {
    const r = checkLedgerProvenance({
      verifiedSource: "cdr",
      ledgerEnergyKwh: 10.002,
      cdrEnergyKwh: 10.0,
    });
    expect(r.ok).toBe(false);
  });

  it("tolerance is configurable and defaults to 1 Wh", () => {
    expect(DEFAULT_PROVENANCE_TOLERANCE_KWH).toBe(0.001);
    const r = checkLedgerProvenance({
      verifiedSource: "cdr",
      ledgerEnergyKwh: 10.5,
      cdrEnergyKwh: 10.0,
      toleranceKwh: 1,
    });
    expect(r.ok).toBe(true);
  });

  it("is symmetric — direction of the difference does not matter", () => {
    const under = checkLedgerProvenance({ verifiedSource: "cdr", ledgerEnergyKwh: 5, cdrEnergyKwh: 10 });
    const over = checkLedgerProvenance({ verifiedSource: "cdr", ledgerEnergyKwh: 10, cdrEnergyKwh: 5 });
    expect(under.ok).toBe(false);
    expect(over.ok).toBe(false);
    expect(under.deltaKwh).toBe(over.deltaKwh);
  });

  it("treats a non-finite CDR figure as absent", () => {
    const r = checkLedgerProvenance({
      verifiedSource: "cdr",
      ledgerEnergyKwh: 10,
      cdrEnergyKwh: NaN,
    });
    expect(r.violation).toBe("claims_cdr_without_cdr_energy");
  });

  it("every violation carries an explanation naming both figures", () => {
    const r = checkLedgerProvenance({ verifiedSource: "cdr", ledgerEnergyKwh: 30, cdrEnergyKwh: 17.895 });
    expect(r.explanation).toContain("30");
    expect(r.explanation).toContain("17.895");
  });
});

describe("resolution — the two honest options", () => {
  const bad = { verifiedSource: "cdr" as const, ledgerEnergyKwh: 30, cdrEnergyKwh: 17.895 };

  it("prefers overlaying the authoritative figure by default", () => {
    const r = resolveProvenanceViolation(bad);
    expect(r).toEqual({ action: "overlay_cdr_figure", energyKwh: 17.895, verifiedSource: "cdr" });
  });

  it("can instead downgrade the label to the truth", () => {
    const r = resolveProvenanceViolation(bad, "honest_label");
    expect(r).toEqual({ action: "downgrade_label", verifiedSource: "ocpp" });
  });

  it("downgrades a CDR claim with no CDR to unverified", () => {
    const r = resolveProvenanceViolation({ verifiedSource: "cdr", ledgerEnergyKwh: 10 });
    expect(r).toEqual({ action: "downgrade_label", verifiedSource: "unverified" });
  });

  it("promotes an unlabelled row that already bills the CDR figure", () => {
    const r = resolveProvenanceViolation({
      verifiedSource: null,
      ledgerEnergyKwh: 10,
      cdrEnergyKwh: 10,
    });
    expect(r).toEqual({ action: "promote_label", verifiedSource: "cdr" });
  });

  it("does nothing to a valid row", () => {
    const r = resolveProvenanceViolation({
      verifiedSource: "cdr",
      ledgerEnergyKwh: 10,
      cdrEnergyKwh: 10,
    });
    expect(r).toEqual({ action: "none" });
  });

  // Neither resolution is silent. Keeping the label AND the wrong number is
  // the one outcome the type system will not produce.
  it("never returns an action that keeps both the label and the wrong figure", () => {
    for (const prefer of ["authoritative_figure", "honest_label"] as const) {
      const r = resolveProvenanceViolation(bad, prefer);
      expect(r.action).not.toBe("none");
    }
  });
});
