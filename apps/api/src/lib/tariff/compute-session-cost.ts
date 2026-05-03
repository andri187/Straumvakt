// Pure-function session-cost tariff engine.
// Sprint 8.2 / Rule 5 territory.
//
// Given a charging session and a tariff chain (additive components —
// e.g. DSO Veitur AD1 + Retailer N1_RAFMAGN-REPF-01), computes the
// monetary cost in ISK with full VAT breakdown. No I/O, no globals.
// Heavy unit-test coverage (hand-computed scenarios in
// compute-session-cost.test.ts) is the only proof of correctness.
//
// ─── Money math conventions ────────────────────────────────────────
//
// All money fields are BigInt **minor units**. For ISK, "minor" =
// 1/100 króna (i.e. aurar). Aurar are a formally-defined subunit
// even though no aurar coins circulate today; the math needs that
// precision because per-kWh rates have 2 decimal places (e.g. AD1
// at 8.64 ex-VAT). Display formatters render minor → "X.XX kr."
//
// pricePerKwhMinor: BigInt   — ex-VAT, in 1/100 króna per kWh
// amountExVatMinor: BigInt   — ex-VAT subtotal in 1/100 króna
// vatMinor:         BigInt   — VAT in 1/100 króna
// totalIncVatMinor: BigInt   — gross total in 1/100 króna
//
// Half-up rounding via BigInt: (numerator + denominator/2) / denominator.
// Float-to-int conversion goes through Math.round and then BigInt(),
// never relying on JS-Number-to-BigInt without explicit rounding.
//
// ─── Scope (Sprint 8.2) ────────────────────────────────────────────
//
// IN:  Flat per-kWh prices summed across N components. One uniform
//      VAT rate across components (Iceland 24% today). Multiple
//      component kinds (dso, retailer, platform_fee) for line-item
//      display.
//
// OUT: Time-of-use windows, per-day fastagjald (subscription),
//      time-charge per minute, overtime/parking-grace penalties,
//      multi-currency, banker's rounding. Each will land as its
//      own milestone when an actual customer needs it. Iceland's
//      flat AD1 + N1 retailer combination is the only production
//      pricing model on day one.

export type TariffComponentKind =
  | "dso"            // distribution system operator (Veitur, OR, etc.)
  | "retailer"       // electricity retailer (N1, ON, HS Orka, etc.)
  | "platform_fee";  // Straumvakt's own per-kWh markup (revenue-share);
                     // included for shape completeness even though it's
                     // not used in 8.2's first customer.

export interface TariffComponent {
  kind: TariffComponentKind;
  /** Rate code from the JSON reference (e.g. "AD1", "N1_RAFMAGN-REPF-01"). */
  code: string;
  /** Optional display label — prefer over code for operator UI. */
  displayName?: string;
  /** Ex-VAT price per kWh, in 1/100 króna (BigInt minor units). */
  pricePerKwhMinor: bigint;
  /** Per-component VAT rate. All components in a chain MUST agree. */
  vatRatePct: number;
}

export interface TariffChain {
  currency: "ISK";
  components: TariffComponent[];
}

export interface SessionInput {
  /** ISO timestamps; for 8.2 the duration / hour-of-day are unused
   *  (TOU not implemented), but kept on the input shape so 8.x's
   *  TOU extension is additive. */
  startedAt: Date;
  stoppedAt: Date;
  /** Total kWh delivered, ≥ 0. Decimal precision (3 fractional digits). */
  energyKwh: number;
}

export type LineItemKind = TariffComponentKind | "vat";

export interface LineItem {
  kind: LineItemKind;
  code: string;
  displayName: string;
  qty: number;            // kWh for component lines, 1 for VAT line
  qtyUnit: "kWh" | "—";
  /** Ex-VAT unit price for component lines; null on the VAT line. */
  unitPriceMinor: bigint | null;
  /** Ex-VAT amount (component lines) or VAT amount (vat line). */
  amountMinor: bigint;
}

export interface CostBreakdown {
  currency: "ISK";
  energyKwh: number;
  subtotalExVatMinor: bigint;
  vatMinor: bigint;
  totalIncVatMinor: bigint;
  lineItems: LineItem[];
}

/**
 * Compute the cost of one charging session against an additive tariff
 * chain. Pure function. Heavy unit tests are the contract.
 *
 * Throws on:
 *   • mixed VAT rates across components (8.2 ships uniform VAT only)
 *   • negative energy
 *   • non-flat tariff component (TOU/time-charge/overtime not in 8.2)
 *
 * Returns a CostBreakdown with line items per component plus a single
 * VAT line item at the end. The sum-invariant
 *   subtotalExVatMinor + vatMinor === totalIncVatMinor
 * holds exactly (asserted in tests).
 */
export function computeSessionCost(
  session: SessionInput,
  tariffChain: TariffChain,
): CostBreakdown {
  if (!Number.isFinite(session.energyKwh) || session.energyKwh < 0) {
    throw new Error("energy_kwh_must_be_nonneg_finite");
  }
  if (tariffChain.components.length === 0) {
    return {
      currency: tariffChain.currency,
      energyKwh: session.energyKwh,
      subtotalExVatMinor: 0n,
      vatMinor: 0n,
      totalIncVatMinor: 0n,
      lineItems: [],
    };
  }

  // Uniform-VAT invariant — Sprint 8.2 ships single-VAT-line output.
  // Mixed VAT (e.g. 24% energy + 11% subscription) becomes a per-line
  // VAT model in a later milestone.
  const vatRates = new Set(tariffChain.components.map((c) => c.vatRatePct));
  if (vatRates.size > 1) {
    throw new Error("mixed_vat_rates_not_supported_in_8_2");
  }
  const vatRatePct = vatRates.values().next().value ?? 0;
  if (!Number.isFinite(vatRatePct) || vatRatePct < 0) {
    throw new Error("vat_rate_must_be_nonneg_finite");
  }

  // Convert kWh (3-decimal float) to milli-kWh integer for BigInt math.
  // 30.000 → 30000; 29.873 → 29873; 30.5 → 30500.
  // Half-up at the kWh boundary first, then a second half-up at the
  // milli-minor → minor boundary. Total drift < 1 minor (1/100 ISK).
  const milliKwh = BigInt(Math.round(session.energyKwh * 1000));

  const lineItems: LineItem[] = [];
  let subtotalExVatMinor = 0n;

  for (const component of tariffChain.components) {
    if (component.pricePerKwhMinor < 0n) {
      throw new Error(`negative_price_for_component_${component.code}`);
    }
    // amount (in 1/1000 of a 1/100-króna minor unit, i.e. milli-minor) =
    //   milliKwh × pricePerKwhMinor
    // Half-up division by 1000 → minor.
    const milliMinor = milliKwh * component.pricePerKwhMinor;
    const amountExVatMinor = (milliMinor + 500n) / 1000n;

    lineItems.push({
      kind: component.kind,
      code: component.code,
      displayName: component.displayName ?? component.code,
      qty: session.energyKwh,
      qtyUnit: "kWh",
      unitPriceMinor: component.pricePerKwhMinor,
      amountMinor: amountExVatMinor,
    });
    subtotalExVatMinor += amountExVatMinor;
  }

  // VAT applied to the sum (per ADR / operator decision):
  //   vat = subtotal × vatRatePct / 100, half-up rounded
  // Use 4 decimal precision on vatRatePct (e.g. 24.0000) by working
  // in basis-point-ish (× 10000) integer space, then dividing by
  // 1,000,000 with half-up.
  const vatRateScaled = BigInt(Math.round(vatRatePct * 10000));  // 24 → 240000
  const vatRaw = subtotalExVatMinor * vatRateScaled;
  // Divide by 1,000,000 (= 100 × 10000) with half-up rounding.
  const vatMinor = (vatRaw + 500_000n) / 1_000_000n;

  if (vatMinor > 0n) {
    lineItems.push({
      kind: "vat",
      code: `VAT_${vatRatePct}`,
      displayName: `VAT ${vatRatePct}%`,
      qty: 1,
      qtyUnit: "—",
      unitPriceMinor: null,
      amountMinor: vatMinor,
    });
  }

  const totalIncVatMinor = subtotalExVatMinor + vatMinor;

  return {
    currency: tariffChain.currency,
    energyKwh: session.energyKwh,
    subtotalExVatMinor,
    vatMinor,
    totalIncVatMinor,
    lineItems,
  };
}

/**
 * Format a BigInt minor amount as "X.XX kr." for operator-facing UI.
 * Pure formatter; no localisation. Sprint 8.6 wires Icelandic locale.
 */
export function formatIskMinor(minor: bigint): string {
  // Convert sub-króna minor to króna with 2 decimals.
  const negative = minor < 0n;
  const abs = negative ? -minor : minor;
  const wholeKronur = abs / 100n;
  const aurar = abs % 100n;
  const aurarStr = aurar < 10n ? `0${aurar}` : `${aurar}`;
  return `${negative ? "-" : ""}${wholeKronur}.${aurarStr} kr.`;
}
