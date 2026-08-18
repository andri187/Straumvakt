// Kennitala — the Icelandic registration identifier.
//
// ── WHY THIS LIVES IN THE INVOICE MODULE ────────────────────────────────
//
// It is not invoice-specific, but the requirement is. `PartyIdentity` in
// document.ts makes `registeredId` mandatory and refuses to render a header
// without it, because an Icelandic sales invoice must carry "Nafn, kennitala
// og skráningarnúmer seljanda" (Skatturinn, Skráning tekna). The collection
// packet then found that a krafa is addressed to a payer BY kennitala.
//
// So the invoice rail is what makes an absent kennitala fatal, and the 14:15
// run's finding stands: this is the only remaining zero-dependency task whose
// cost RISES with every org onboarded without it, because it cannot be added
// retroactively without going back and asking.
//
// HANDOVER TARGET: `packages/contracts/src/inputs/orgs.ts` — the org input
// schema should adopt `kennitalaProblems` as a field validator, and the org
// record should carry the normalised value. Same pattern as the delivery-log
// contract: this module owns the rule, the consuming schema owns the field.
//
// ── SENSITIVITY, AND THE HARD RULE ──────────────────────────────────────
//
// A kennitala is a personal identifier. The operating rules forbid printing,
// echoing, logging, exporting or committing one. Therefore:
//
//   • Nothing in this file logs. There is no console call and no throw that
//     embeds the value — `kennitalaProblems` returns codes, never the input.
//   • `maskKennitala` exists so that anything which must show a kennitala to
//     a human shows six of ten digits and never the rest.
//   • NO TEST IN THIS REPOSITORY CONTAINS A REAL-LOOKING KENNITALA. The tests
//     build checksum-valid values from IMPOSSIBLE DATES (day 88, month 99),
//     which exercise every branch while being unmistakably synthetic.
//
// ── WHAT VALIDATION IS AND IS NOT ───────────────────────────────────────
//
// This checks FORMAT. A checksum-valid kennitala is not proof that the entity
// exists, is registered for VAT, or is the party you think it is. Treating a
// format check as an identity check is the failure mode worth naming here,
// because it is the one that produces an invoice addressed to nobody.

/** Problem codes. Deliberately never carry the offending value. */
export type KennitalaProblem =
  | "empty"
  | "wrong_length"
  | "non_digit"
  | "checksum_failed"
  | "implausible_date";

/** Person or legal entity. Companies are encoded by adding 40 to the day. */
export type KennitalaKind = "person" | "company" | "unknown";

/**
 * Strip formatting. Accepts "DDMMYY-NNCX" and "DDMMYYNNCX".
 *
 * Returns digits only. Does not validate — normalising and validating are
 * separate so a caller can normalise once and validate once.
 */
export function normalizeKennitala(input: string): string {
  return (input ?? "").replace(/[\s-]/g, "");
}

/**
 * The mod-11 check digit weights, positions 1..8.
 *
 * The 9th digit is the check digit; the 10th is the century marker and takes
 * no part in the checksum.
 */
const WEIGHTS = [3, 2, 7, 6, 5, 4, 3, 2] as const;

/** The check digit a kennitala's first eight digits imply, or null if none is valid. */
export function checkDigitFor(firstEight: string): number | null {
  if (!/^\d{8}$/.test(firstEight)) return null;
  let sum = 0;
  for (let i = 0; i < 8; i++) sum += Number(firstEight[i]) * WEIGHTS[i];
  const remainder = sum % 11;
  if (remainder === 0) return 0;
  const digit = 11 - remainder;
  // A remainder of 1 implies a check digit of 10, which cannot be written in
  // one position — such a number is never issued rather than being rounded.
  return digit === 10 ? null : digit;
}

/**
 * Every reason this value is not a well-formed kennitala. Empty means well-formed.
 *
 * Returns codes only — never the input — so a caller that logs the result
 * cannot accidentally log a kennitala.
 */
export function kennitalaProblems(input: string): KennitalaProblem[] {
  const v = normalizeKennitala(input);
  const problems: KennitalaProblem[] = [];

  if (v === "") return ["empty"];
  if (!/^\d+$/.test(v)) problems.push("non_digit");
  if (v.length !== 10) problems.push("wrong_length");
  // Everything below needs ten digits to be meaningful.
  if (problems.length > 0) return problems;

  const day = Number(v.slice(0, 2));
  const month = Number(v.slice(2, 4));
  // Companies add 40 to the day; that is the only legal way past 31.
  const calendarDay = day > 40 ? day - 40 : day;
  if (calendarDay < 1 || calendarDay > 31 || month < 1 || month > 12) {
    problems.push("implausible_date");
  }

  const expected = checkDigitFor(v.slice(0, 8));
  if (expected === null || expected !== Number(v[8])) problems.push("checksum_failed");

  return problems;
}

export function isValidKennitala(input: string): boolean {
  return kennitalaProblems(input).length === 0;
}

/** Person or company, by the day-plus-40 convention. `unknown` when malformed. */
export function kennitalaKind(input: string): KennitalaKind {
  const v = normalizeKennitala(input);
  if (!/^\d{10}$/.test(v)) return "unknown";
  const day = Number(v.slice(0, 2));
  if (day >= 41 && day <= 71) return "company";
  if (day >= 1 && day <= 31) return "person";
  return "unknown";
}

/**
 * Display form: `DDMMYY-****`.
 *
 * The first six digits are a birth or registration date and are the part a
 * human uses to recognise a record; the last four are the identifying part
 * and are masked. Anything that shows a kennitala in a UI, a log line, an
 * error message or a support tool should show this.
 */
export function maskKennitala(input: string): string {
  const v = normalizeKennitala(input);
  if (v.length !== 10) return "**********";
  return `${v.slice(0, 6)}-****`;
}

/**
 * The storage contract, as data so it can be asserted rather than described.
 *
 * Recorded here because "how is this field stored" is a question that gets
 * answered three different ways by three callers otherwise.
 */
export const KENNITALA_STORAGE_CONTRACT = {
  /** Store the 10 digits with no dash. One canonical form, always. */
  normalised: true,
  /** Never null on an org that can be invoiced or issued a claim. */
  requiredForInvoicing: true,
  /** Nullable at org creation ONLY if the org cannot yet be billed. */
  nullableBeforeBilling: true,
  /** Never written to a log, an error message, an analytics dimension or a metric. */
  neverLogged: true,
  /** Shown to humans only via maskKennitala. */
  maskedInUi: true,
  /** Unique per org within a tenant — two orgs cannot share one. */
  uniquePerTenant: true,
} as const;

/**
 * What must refuse when a kennitala is absent.
 *
 * A list rather than prose so the consuming code can be checked against it.
 * Each of these already refuses in this package or is specified to.
 */
export const REFUSES_WITHOUT_KENNITALA = [
  "invoice document construction (claimHolder.registeredId)",
  "invoice document construction (recipient.registeredId)",
  "invoice header render — refuse rather than render a partial header",
  "bank claim creation — a krafa is addressed to a payer by kennitala",
  "marking an org billable",
] as const;
