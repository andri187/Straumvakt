// Sprint 8.2 — pure-function tariff engine tests.
//
// Ten hand-computed scenarios. Every expected value is derived
// outside this file (calculator + comments) before being typed in;
// the test harness asserts exact match. No floating-point compares,
// no toBeCloseTo. ISK with 2-decimal aurar precision (1 minor =
// 1/100 króna). Half-up rounding throughout.
//
// Canonical Iceland production case (scenario 1):
//   DSO Veitur AD1                       8.64 kr/kWh ex-VAT
//   Retailer N1 N1_RAFMAGN-REPF-01       8.83 kr/kWh ex-VAT
//   ──────────────────────────────────────
//   Subtotal ex-VAT                     17.47 kr/kWh
//   24% VAT                              4.19 kr/kWh (rounded)
//   ──────────────────────────────────────
//   Gross customer-facing total         21.66 kr/kWh
//   (operator-stated as ~21.7)

import { describe, expect, it } from "vitest";
import {
  computeSessionCost,
  formatIskMinor,
  type TariffChain,
} from "./compute-session-cost";

const VAT_PCT = 24;

// Canonical components, used across most scenarios.
const DSO_VEITUR_AD1 = {
  kind: "dso" as const,
  code: "AD1",
  displayName: "Veitur AD1",
  pricePerKwhMinor: 864n,   // 8.64 kr/kWh ex-VAT
  vatRatePct: VAT_PCT,
};

const RETAILER_N1 = {
  kind: "retailer" as const,
  code: "N1_RAFMAGN-REPF-01",
  displayName: "N1 — almenn raforka",
  pricePerKwhMinor: 883n,   // 8.83 kr/kWh ex-VAT (10.95 / 1.24)
  vatRatePct: VAT_PCT,
};

const VEITUR_PLUS_N1: TariffChain = {
  currency: "ISK",
  components: [DSO_VEITUR_AD1, RETAILER_N1],
};

describe("computeSessionCost", () => {
  // ─── Scenario 1: canonical Iceland production case ────────────
  it("scenario 1 — 30 kWh × (Veitur AD1 + N1 retailer)", () => {
    // Hand-computed:
    //   DSO ex-VAT:      30 × 8.64 = 259.20  → 25920 minor
    //   Retailer ex-VAT: 30 × 8.83 = 264.90  → 26490 minor
    //   Subtotal ex-VAT:           = 524.10  → 52410 minor
    //   VAT 24%:    52410 × 24 / 100 = 12578.4 → 12578 minor (half-up
    //                                            rounds .4 down)
    //   Total inc-VAT:             = 64988 minor (= 649.88 kr.)
    const out = computeSessionCost(
      { startedAt: new Date("2026-05-04T08:00:00Z"), stoppedAt: new Date("2026-05-04T09:00:00Z"), energyKwh: 30 },
      VEITUR_PLUS_N1,
    );
    expect(out.currency).toBe("ISK");
    expect(out.energyKwh).toBe(30);
    expect(out.subtotalExVatMinor).toBe(52410n);
    expect(out.vatMinor).toBe(12578n);
    expect(out.totalIncVatMinor).toBe(64988n);
    // Sum invariant
    expect(out.subtotalExVatMinor + out.vatMinor).toBe(out.totalIncVatMinor);
    // Line items: DSO + retailer + VAT
    expect(out.lineItems).toHaveLength(3);
    expect(out.lineItems[0].code).toBe("AD1");
    expect(out.lineItems[0].amountMinor).toBe(25920n);
    expect(out.lineItems[1].code).toBe("N1_RAFMAGN-REPF-01");
    expect(out.lineItems[1].amountMinor).toBe(26490n);
    expect(out.lineItems[2].kind).toBe("vat");
    expect(out.lineItems[2].amountMinor).toBe(12578n);
  });

  // ─── Scenario 2: empty session ────────────────────────────────
  it("scenario 2 — 0 kWh session yields zero cost, no VAT line", () => {
    const out = computeSessionCost(
      { startedAt: new Date("2026-05-04T08:00:00Z"), stoppedAt: new Date("2026-05-04T08:00:00Z"), energyKwh: 0 },
      VEITUR_PLUS_N1,
    );
    expect(out.subtotalExVatMinor).toBe(0n);
    expect(out.vatMinor).toBe(0n);
    expect(out.totalIncVatMinor).toBe(0n);
    // Line items are component lines only when amounts are > 0;
    // we still emit them to make the breakdown visible (qty=0 →
    // amount=0). VAT line is suppressed when vatMinor=0.
    expect(out.lineItems).toHaveLength(2); // DSO + retailer; no VAT line
    expect(out.lineItems.every((l) => l.amountMinor === 0n)).toBe(true);
  });

  // ─── Scenario 3: single-component (DSO only) ──────────────────
  it("scenario 3 — DSO-only chain (Veitur AD1) at 50 kWh", () => {
    // 50 × 8.64 = 432.00  → 43200 minor
    // VAT 24%: 43200 × 24 / 100 = 10368.0 → 10368 minor
    // Total: 53568 minor (= 535.68 kr.)
    const out = computeSessionCost(
      { startedAt: new Date(), stoppedAt: new Date(), energyKwh: 50 },
      { currency: "ISK", components: [DSO_VEITUR_AD1] },
    );
    expect(out.subtotalExVatMinor).toBe(43200n);
    expect(out.vatMinor).toBe(10368n);
    expect(out.totalIncVatMinor).toBe(53568n);
    expect(out.lineItems).toHaveLength(2); // DSO + VAT
  });

  // ─── Scenario 4: three components (DSO + retailer + platform) ──
  it("scenario 4 — DSO + retailer + Straumvakt platform fee", () => {
    // Platform fee 1.50 kr/kWh ex-VAT (150 minor).
    // 10 kWh × (8.64 + 8.83 + 1.50) = 10 × 18.97 = 189.70 → 18970 minor
    // VAT: 18970 × 24 / 100 = 4552.8 → 4553 minor (half-up rounds .8 up)
    // Total: 23523 minor (= 235.23 kr.)
    const out = computeSessionCost(
      { startedAt: new Date(), stoppedAt: new Date(), energyKwh: 10 },
      {
        currency: "ISK",
        components: [
          DSO_VEITUR_AD1,
          RETAILER_N1,
          {
            kind: "platform_fee",
            code: "STRAUMVAKT_001",
            displayName: "Straumvakt platform fee",
            pricePerKwhMinor: 150n,
            vatRatePct: VAT_PCT,
          },
        ],
      },
    );
    expect(out.subtotalExVatMinor).toBe(18970n);
    expect(out.vatMinor).toBe(4553n);
    expect(out.totalIncVatMinor).toBe(23523n);
    expect(out.lineItems).toHaveLength(4); // 3 components + VAT
    expect(out.lineItems[2].kind).toBe("platform_fee");
    expect(out.lineItems[2].amountMinor).toBe(1500n); // 10 × 1.50 = 15.00
  });

  // ─── Scenario 5: decimal kWh precision ────────────────────────
  it("scenario 5 — 29.873 kWh × Veitur AD1 ex-VAT", () => {
    // milliKwh = 29873
    // amount_milliMinor = 29873 × 864 = 25,810,272
    // amount_minor (half-up): (25810272 + 500) / 1000 = 25810
    // (25,810 = 258.10 kr. ex-VAT)
    // VAT: 25810 × 24 / 100 = 6194.4 → 6194 minor
    // Total: 32004 minor (= 320.04 kr.)
    const out = computeSessionCost(
      { startedAt: new Date(), stoppedAt: new Date(), energyKwh: 29.873 },
      { currency: "ISK", components: [DSO_VEITUR_AD1] },
    );
    expect(out.subtotalExVatMinor).toBe(25810n);
    expect(out.vatMinor).toBe(6194n);
    expect(out.totalIncVatMinor).toBe(32004n);
  });

  // ─── Scenario 6: half-up rounding boundary ────────────────────
  it("scenario 6 — quantity-rounding crosses the half boundary", () => {
    // 0.5 kWh × Veitur AD1 (864 ex-VAT)
    // milliKwh = 500
    // amount_milliMinor = 500 × 864 = 432,000
    // amount_minor: (432000 + 500) / 1000 = 432 minor (= 4.32 kr.)
    // VAT: 432 × 24 / 100 = 103.68 → 104 minor (half-up rounds .68 up)
    // Total: 536 minor (= 5.36 kr.)
    const out = computeSessionCost(
      { startedAt: new Date(), stoppedAt: new Date(), energyKwh: 0.5 },
      { currency: "ISK", components: [DSO_VEITUR_AD1] },
    );
    expect(out.subtotalExVatMinor).toBe(432n);
    expect(out.vatMinor).toBe(104n);
    expect(out.totalIncVatMinor).toBe(536n);
  });

  // ─── Scenario 7: large session ────────────────────────────────
  it("scenario 7 — 1000 kWh fleet session (Veitur + N1)", () => {
    // 1000 × 17.47 = 17470.00 → 1747000 minor
    // VAT: 1747000 × 24 / 100 = 419280 minor
    // Total: 2166280 minor (= 21,662.80 kr.)
    const out = computeSessionCost(
      { startedAt: new Date(), stoppedAt: new Date(), energyKwh: 1000 },
      VEITUR_PLUS_N1,
    );
    expect(out.subtotalExVatMinor).toBe(1_747_000n);
    expect(out.vatMinor).toBe(419_280n);
    expect(out.totalIncVatMinor).toBe(2_166_280n);
  });

  // ─── Scenario 8: zero-VAT chain (e.g. tax-exempt host) ────────
  it("scenario 8 — vatRatePct=0 yields no VAT line", () => {
    const out = computeSessionCost(
      { startedAt: new Date(), stoppedAt: new Date(), energyKwh: 30 },
      {
        currency: "ISK",
        components: [{ ...DSO_VEITUR_AD1, vatRatePct: 0 }],
      },
    );
    // 30 × 8.64 = 259.20 → 25920 minor
    expect(out.subtotalExVatMinor).toBe(25920n);
    expect(out.vatMinor).toBe(0n);
    expect(out.totalIncVatMinor).toBe(25920n);
    expect(out.lineItems).toHaveLength(1); // No VAT line at 0%
  });

  // ─── Scenario 9: empty chain ──────────────────────────────────
  it("scenario 9 — empty component list yields zero, no items, no throw", () => {
    const out = computeSessionCost(
      { startedAt: new Date(), stoppedAt: new Date(), energyKwh: 30 },
      { currency: "ISK", components: [] },
    );
    expect(out.subtotalExVatMinor).toBe(0n);
    expect(out.vatMinor).toBe(0n);
    expect(out.totalIncVatMinor).toBe(0n);
    expect(out.lineItems).toHaveLength(0);
  });

  // ─── Scenario 10: sum invariant across many sessions ──────────
  it("scenario 10 — invariant subtotal + vat = total holds across 100 random kWh values", () => {
    // Stress-test the half-up rounding chain. Random kWh from 0.001
    // to 999.999 (3-decimal). For each, verify the invariant.
    let invariantHits = 0;
    for (let i = 0; i < 100; i++) {
      const kWh = Math.round((Math.random() * 999.999 + 0.001) * 1000) / 1000;
      const out = computeSessionCost(
        { startedAt: new Date(), stoppedAt: new Date(), energyKwh: kWh },
        VEITUR_PLUS_N1,
      );
      expect(out.subtotalExVatMinor + out.vatMinor).toBe(out.totalIncVatMinor);
      invariantHits++;
    }
    expect(invariantHits).toBe(100);
  });
});

describe("computeSessionCost — error cases", () => {
  it("throws on mixed VAT rates", () => {
    expect(() =>
      computeSessionCost(
        { startedAt: new Date(), stoppedAt: new Date(), energyKwh: 30 },
        {
          currency: "ISK",
          components: [
            DSO_VEITUR_AD1,
            { ...RETAILER_N1, vatRatePct: 11 }, // mismatched
          ],
        },
      ),
    ).toThrow("mixed_vat_rates_not_supported_in_8_2");
  });

  it("throws on negative energy", () => {
    expect(() =>
      computeSessionCost(
        { startedAt: new Date(), stoppedAt: new Date(), energyKwh: -1 },
        VEITUR_PLUS_N1,
      ),
    ).toThrow("energy_kwh_must_be_nonneg_finite");
  });

  it("throws on NaN energy", () => {
    expect(() =>
      computeSessionCost(
        { startedAt: new Date(), stoppedAt: new Date(), energyKwh: NaN },
        VEITUR_PLUS_N1,
      ),
    ).toThrow("energy_kwh_must_be_nonneg_finite");
  });

  it("throws on negative price", () => {
    expect(() =>
      computeSessionCost(
        { startedAt: new Date(), stoppedAt: new Date(), energyKwh: 30 },
        {
          currency: "ISK",
          components: [{ ...DSO_VEITUR_AD1, pricePerKwhMinor: -100n }],
        },
      ),
    ).toThrow(/negative_price/);
  });
});

describe("formatIskMinor", () => {
  it("formats whole and fractional kronur correctly", () => {
    expect(formatIskMinor(0n)).toBe("0.00 kr.");
    expect(formatIskMinor(100n)).toBe("1.00 kr.");
    expect(formatIskMinor(64988n)).toBe("649.88 kr.");
    expect(formatIskMinor(5n)).toBe("0.05 kr.");
    expect(formatIskMinor(50n)).toBe("0.50 kr.");
  });

  it("handles negative amounts (refunds, credits)", () => {
    expect(formatIskMinor(-100n)).toBe("-1.00 kr.");
  });
});
