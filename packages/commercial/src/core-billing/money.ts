// The money contract for Core billing.
//
// WHY THIS EXISTS
//
// The engine computes in aurar (1/100 króna) and always has — see
// compute-session-cost.ts, which explains that per-kWh rates carry two
// decimals so the arithmetic needs the precision. But a customer is billed in
// whole krónur, and until now nothing in the tree performed that conversion.
// `formatIskMinor` renders "649.88 kr." for display; there was no function
// that decided what a LINE actually charges.
//
// That gap is the direct cause of the worst live defect in the billing
// surface: driver-sessions.ts:95 returns the aurar figure unchanged on the
// premise that "ISK has no minor unit", so the driver app shows every session
// 100× too large. driver-invoices.ts:69 repeats it. Two endpoints emit a field
// called `costIsk` with contradictory unit contracts because there was no
// single place that owned the answer.
//
// ── The locked rules ─────────────────────────────────────────────────────
//
//   1. Internally everything is aurar, as BigInt. No floats, ever.
//   2. A LINE is rounded to whole ISK, half-up.
//   3. A STATEMENT TOTAL is the sum of the ROUNDED lines — never the rounded
//      sum of unrounded lines.
//
// Rule 3 is the one that looks like a nicety and is not. Round the sum
// instead, and the total stops equalling what a customer gets when they add
// the lines up themselves. On a three-line statement of 649.88 + 216.63 +
// 21.66 kr that difference is exactly 1 kr — small enough to survive review,
// large enough to lose an argument with an accountant.

/** Aurar per króna. ISK has a formally defined subunit even though no aurar coins circulate. */
export const AURAR_PER_ISK = 100n;

/** A whole-króna amount. Distinct from aurar at the type level is not possible
 *  in TypeScript without a branded type; the naming carries it instead, and
 *  every function here says which unit it takes and returns. */
export type Aurar = bigint;
export type Isk = bigint;

function assertBigInt(value: unknown, name: string): asserts value is bigint {
  if (typeof value !== "bigint") {
    throw new Error(`${name}_must_be_bigint`);
  }
}

/**
 * Round aurar to whole ISK, half-up, symmetric about zero.
 *
 * Half-up on the magnitude rather than toward positive infinity: a credit of
 * −250 aurar must round to −3 kr, not −2 kr, or a correction and the line it
 * corrects disagree by 1 kr in opposite directions.
 */
export function roundAurarToIsk(amountAurar: Aurar): Isk {
  assertBigInt(amountAurar, "amountAurar");
  const negative = amountAurar < 0n;
  const abs = negative ? -amountAurar : amountAurar;
  const whole = (abs + AURAR_PER_ISK / 2n) / AURAR_PER_ISK;
  return negative ? -whole : whole;
}

/** Whole ISK back to aurar. Exact; no rounding can occur. */
export function iskToAurar(amountIsk: Isk): Aurar {
  assertBigInt(amountIsk, "amountIsk");
  return amountIsk * AURAR_PER_ISK;
}

/**
 * The statement total: sum of already-rounded lines.
 *
 * Takes the ROUNDED ISK line amounts, not aurar, so it is structurally
 * impossible to call it with unrounded values and get the forbidden answer.
 */
export function sumRoundedLinesIsk(lineAmountsIsk: readonly Isk[]): Isk {
  let total = 0n;
  for (const amount of lineAmountsIsk) {
    assertBigInt(amount, "lineAmountIsk");
    total += amount;
  }
  return total;
}

/**
 * How far the correct total sits from the forbidden one.
 *
 * Exposed because it is the cheapest possible regression test for rule 3: a
 * fixture whose drift is non-zero proves the two methods differ, so a test
 * asserting the correct total cannot pass by accident on a fixture where both
 * happen to agree.
 */
export function roundingDriftIsk(lineAmountsAurar: readonly Aurar[]): Isk {
  const correct = sumRoundedLinesIsk(lineAmountsAurar.map(roundAurarToIsk));
  let rawSum = 0n;
  for (const a of lineAmountsAurar) {
    assertBigInt(a, "lineAmountAurar");
    rawSum += a;
  }
  return correct - roundAurarToIsk(rawSum);
}

/** Display only. Renders aurar as "X.XX kr." — never use for a billed amount. */
export function formatAurar(amountAurar: Aurar): string {
  assertBigInt(amountAurar, "amountAurar");
  const negative = amountAurar < 0n;
  const abs = negative ? -amountAurar : amountAurar;
  const whole = abs / AURAR_PER_ISK;
  const frac = abs % AURAR_PER_ISK;
  return `${negative ? "-" : ""}${whole}.${frac < 10n ? "0" : ""}${frac} kr.`;
}

/** Display of a billed line: whole krónur. */
export function formatIsk(amountIsk: Isk): string {
  assertBigInt(amountIsk, "amountIsk");
  return `${amountIsk} kr.`;
}

/**
 * Apportion an amount across weights without losing or inventing aurar.
 *
 * Needed wherever one figure is split between bearers — a session shared
 * between the driver and the organisation, or VAT allocated across components.
 * Largest-remainder: floor every share, then hand the leftover aurar to the
 * largest remainders in order. The result always sums to the input exactly,
 * which naive per-share rounding does not.
 */
export function apportionAurar(totalAurar: Aurar, weights: readonly bigint[]): Aurar[] {
  assertBigInt(totalAurar, "totalAurar");
  if (weights.length === 0) return [];
  let weightSum = 0n;
  for (const w of weights) {
    assertBigInt(w, "weight");
    if (w < 0n) throw new Error("weight_must_be_non_negative");
    weightSum += w;
  }
  if (weightSum === 0n) throw new Error("weights_must_not_all_be_zero");

  const negative = totalAurar < 0n;
  const abs = negative ? -totalAurar : totalAurar;

  const floors: bigint[] = [];
  const remainders: { index: number; remainder: bigint }[] = [];
  let allocated = 0n;
  for (let i = 0; i < weights.length; i++) {
    const exact = abs * weights[i]!;
    const share = exact / weightSum;
    floors.push(share);
    remainders.push({ index: i, remainder: exact % weightSum });
    allocated += share;
  }

  let leftover = abs - allocated;
  remainders.sort((a, b) => (b.remainder === a.remainder ? a.index - b.index : b.remainder > a.remainder ? 1 : -1));
  for (let k = 0; k < remainders.length && leftover > 0n; k++) {
    floors[remainders[k]!.index]! += 1n;
    leftover -= 1n;
  }

  return negative ? floors.map((f) => -f) : floors;
}

/** VAT on an ex-VAT amount, half-up, in aurar. */
export function vatOnAurar(exVatAurar: Aurar, vatRatePct: number): Aurar {
  assertBigInt(exVatAurar, "exVatAurar");
  if (!Number.isFinite(vatRatePct) || vatRatePct < 0) {
    throw new Error("vat_rate_must_be_non_negative_finite");
  }
  // Rate carried as basis points so the multiplication stays in BigInt.
  const bp = BigInt(Math.round(vatRatePct * 100));
  const negative = exVatAurar < 0n;
  const abs = negative ? -exVatAurar : exVatAurar;
  const vat = (abs * bp + 5_000n) / 10_000n;
  return negative ? -vat : vat;
}
