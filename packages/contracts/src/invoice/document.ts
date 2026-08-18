// The invoice document model — serialisation-independent.
//
// ── WHY THIS EXISTS SEPARATELY FROM A RENDERER ──────────────────────────
//
// TASKS.md task 8 asks which delivery format to use. The answer (see
// docs/notes/2026-08-18-invoice-delivery-decision.md) is that the format is
// the REVERSIBLE half of the decision and the document is the permanent half.
// So the document is built to the stricter standard — PEPPOL/EN 16931
// semantics — and rendered as a PDF today. Swapping the renderer later must
// not touch anything in this file.
//
// ── THE ONE INVARIANT THIS FILE EXISTS TO ENFORCE ───────────────────────
//
// FOCUS.md rule 3: money Straumvakt PRESENTS carries obligations money it
// EARNS does not. A document may carry exactly ONE posture. Mixing them
// produces an invoice whose header is legally wrong for at least one of its
// lines, and the header is the legal artefact.
//
// The rejection happens at CONSTRUCTION, not at render. A malformed document
// that exists is a malformed document that will eventually be rendered by
// some code path nobody audited.
//
// ── WHY THE DRAFT / DOCUMENT SPLIT ──────────────────────────────────────
//
// `InvoiceDraft` is what a generator produces and what the validator inspects
// — it is allowed to be wrong. `InvoiceDocument` is what construction returns
// and is correct by existence. Code that holds an `InvoiceDocument` never has
// to re-check anything in `validate.ts`.

import type { MoneyLineKind, MoneyPosture, PartyRef } from "../money/lines";
import { MONEY_LINES } from "../money/lines";

// ── party identity ──────────────────────────────────────────────────────

/**
 * A party as it must appear on a legal invoice.
 *
 * Icelandic requirement, verbatim: a sales invoice — including an electronic
 * one — must carry "Útgáfudagur. Nafn, kennitala og skráningarnúmer
 * seljanda." (Skatturinn, Skráning tekna.) So name and registered id are not
 * optional, and `vatNumber` is separate from `registeredId` because they are
 * separate fields in the source requirement.
 *
 * `registeredId` HOLDS a kennitala at runtime. It is never logged, never
 * printed to a console, and no real value appears in any fixture in this
 * repository — see fixtures.ts for why the fixture values are deliberately
 * not kennitala-shaped.
 */
export interface PartyIdentity {
  /** Legal name, exactly as it must appear on the document. */
  legalName: string;
  /** Kennitala / registration number. Required. Never inferred, never logged. */
  registeredId: string;
  /** VSK number, or null when the party is not VAT-registered. */
  vatNumber: string | null;
  /** Postal address lines. Required for a claim; a claim to nowhere is not a claim. */
  addressLines: readonly string[];
  /** ISO 3166-1 alpha-2. */
  countryCode: string;
  /** Which party this is, in platform terms. Ties the document back to tenancy. */
  ref: PartyRef;
}

// ── VAT ─────────────────────────────────────────────────────────────────

/**
 * How VAT is treated on a line.
 *
 * `not_registered` is a distinct case and not a zero rate. A claim presented
 * for a host who holds no VSK registration is a DIFFERENT document from one
 * with 0% VAT, and rendering it as "0%" asserts something untrue about the
 * host's tax status. (Delivery packet §2.)
 */
export type VatTreatment =
  | { kind: "standard"; ratePercent: number }
  | { kind: "reduced"; ratePercent: number }
  | { kind: "exempt"; reason: string }
  | { kind: "outside_scope"; reason: string }
  | { kind: "not_registered" };

/** Stable bucket key for grouping totals. VAT must be stated per rate. */
export function vatBucketKey(v: VatTreatment): string {
  switch (v.kind) {
    case "standard":
    case "reduced":
      return `${v.kind}:${v.ratePercent}`;
    default:
      return v.kind;
  }
}

function vatRateOf(v: VatTreatment): number {
  return v.kind === "standard" || v.kind === "reduced" ? v.ratePercent : 0;
}

// ── lines ───────────────────────────────────────────────────────────────

/**
 * What a quantity is counted in.
 *
 * Mirrors `RATE_BASES` in @straumvakt/commercial rather than reusing it: this
 * package is types-only and must not depend on the commercial module (rule 6,
 * vendors and logic stay out of the vocabulary). `connector_month` is the
 * market line's unit — the flat fee is per connector per month, and calling it
 * anything else misstates the unit permanently to whoever reads the invoice.
 */
export const INVOICE_UNITS = [
  "connector_month",
  "driver_month",
  "kwh",
  "minute",
  "session",
  "day",
] as const;
export type InvoiceUnit = (typeof INVOICE_UNITS)[number];

export interface InvoiceLine {
  /** Human-readable description. Appears on the document. */
  description: string;
  unit: InvoiceUnit;
  /** Non-negative. May be fractional for metered units. */
  quantity: number;
  /** Integer minor units of the document currency. May be negative on a credit note. */
  unitPrice: number;
  /**
   * The cost factor / rate reference that produced this line. Free-form, but
   * required: an amount whose basis cannot be named is an amount nobody can
   * defend when a host queries it.
   */
  basis: string;
  vat: VatTreatment;
  /**
   * The money-line tag. Determines the line's posture. Every line on a
   * document must agree on posture — that is the invariant.
   */
  moneyLineKind: MoneyLineKind;
  /** The settlement/ledger row this line was derived from, when there is one. */
  settlementRef: string | null;
}

// ── totals ──────────────────────────────────────────────────────────────

export interface VatBucket {
  key: string;
  ratePercent: number;
  net: number;
  vat: number;
}

export interface InvoiceTotals {
  /** VAT stated separately per rate — a legal requirement, not a nicety. */
  byVatRate: readonly VatBucket[];
  net: number;
  vat: number;
  gross: number;
}

// ── the document ────────────────────────────────────────────────────────

export interface BillingPeriod {
  /** ISO 8601 date, inclusive. */
  from: string;
  /** ISO 8601 date, inclusive. */
  to: string;
}

export type DocumentKind = "invoice" | "credit_note";

export interface InvoiceDraft {
  /** Tenant scope. FOCUS.md rule 5 — org_id on the row and in the query. */
  orgId: string;
  kind: DocumentKind;
  /** Allocated by number.ts. Required at construction: a document without a number is not issuable. */
  documentNumber: string;
  /**
   * The kröfuhafi — who holds the claim and whose revenue this is.
   *
   * EXPLICIT, ALWAYS. There is deliberately no code path anywhere in this
   * package that infers it from posture, from the org, or from a default.
   * `claimHolder(line)` in money/lines.ts derives the party REF; who that
   * party legally IS still has to be supplied, because the platform cannot
   * know a host's registered name and kennitala without being told.
   */
  claimHolder: PartyIdentity;
  /**
   * The party presenting the claim, when that is not the kröfuhafi.
   *
   * On the market line this is null (Straumvakt is both). On an agent line it
   * is Straumvakt, and it maps to EN 16931 BG-10 Payee (BT-59/BT-60) — the
   * field the standard provides for payment going to a party that is not the
   * seller.
   */
  presenter: PartyIdentity | null;
  /** Who is being billed. */
  recipient: PartyIdentity;
  period: BillingPeriod;
  currency: string;
  lines: readonly InvoiceLine[];
  /** ISO 8601 date. */
  issueDate: string;
  /** ISO 8601 date. Must not precede issueDate. */
  dueDate: string;
  /** Ledger rows this document was derived from. */
  settlementRefs: readonly string[];
  /** Set only on a credit note: the document number being corrected. */
  correctsDocumentNumber?: string | null;
}

export interface InvoiceDocument extends InvoiceDraft {
  readonly posture: MoneyPosture;
  readonly totals: InvoiceTotals;
  /** Brand: only construction produces this. */
  readonly __constructed: true;
}

// ── construction ────────────────────────────────────────────────────────

export interface IssuabilityProblem {
  /** Stable machine code. The validator's exit surface. */
  code: string;
  /** One line, for a human reading a CLI or a log. */
  message: string;
  /** Dotted path into the draft, when the problem is field-local. */
  path?: string;
}

export class InvoiceConstructionError extends Error {
  readonly problems: readonly IssuabilityProblem[];
  constructor(problems: readonly IssuabilityProblem[]) {
    super(
      `invoice document is not issuable: ${problems.map((p) => p.code).join(", ")}`,
    );
    this.name = "InvoiceConstructionError";
    this.problems = problems;
  }
}

const POSTURE_BY_KIND = new Map<MoneyLineKind, MoneyPosture>(
  MONEY_LINES.map((d) => [d.kind, d.posture]),
);

/** The posture a set of lines implies, or `null` when they disagree. */
export function posturesOf(lines: readonly InvoiceLine[]): Set<MoneyPosture> {
  const out = new Set<MoneyPosture>();
  for (const l of lines) {
    const p = POSTURE_BY_KIND.get(l.moneyLineKind);
    if (p) out.add(p);
  }
  return out;
}

export function computeTotals(
  lines: readonly InvoiceLine[],
): InvoiceTotals {
  const buckets = new Map<string, VatBucket>();
  for (const l of lines) {
    const key = vatBucketKey(l.vat);
    const net = Math.round(l.quantity * l.unitPrice);
    const rate = vatRateOf(l.vat);
    const b = buckets.get(key) ?? { key, ratePercent: rate, net: 0, vat: 0 };
    b.net += net;
    buckets.set(key, b);
  }
  // VAT is rounded once per rate bucket, not per line. Rounding per line and
  // summing produces a total that disagrees with the same invoice recomputed
  // by the recipient's accounting system, by a few krónur, unpredictably.
  let net = 0;
  let vat = 0;
  const byVatRate: VatBucket[] = [];
  for (const b of buckets.values()) {
    b.vat = Math.round((b.net * b.ratePercent) / 100);
    net += b.net;
    vat += b.vat;
    byVatRate.push(b);
  }
  byVatRate.sort((a, b) => a.key.localeCompare(b.key));
  return { byVatRate, net, vat, gross: net + vat };
}

/**
 * Build a document, or throw with every reason it could not be built.
 *
 * Throwing rather than returning a union is deliberate: a caller that ignores
 * a returned error still ends up holding something invoice-shaped. A caller
 * that ignores a throw ends up holding nothing.
 */
export function createInvoiceDocument(draft: InvoiceDraft): InvoiceDocument {
  const problems = validateDraft(draft);
  if (problems.length > 0) throw new InvoiceConstructionError(problems);

  const postures = posturesOf(draft.lines);
  const posture = [...postures][0] as MoneyPosture;

  return Object.freeze({
    ...draft,
    lines: Object.freeze([...draft.lines]),
    settlementRefs: Object.freeze([...draft.settlementRefs]),
    posture,
    totals: computeTotals(draft.lines),
    __constructed: true as const,
  });
}

// ── validation ──────────────────────────────────────────────────────────

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function identityProblems(
  who: string,
  id: PartyIdentity | null | undefined,
  required: boolean,
): IssuabilityProblem[] {
  const out: IssuabilityProblem[] = [];
  if (!id) {
    if (required) {
      out.push({
        code: `${who}_missing`,
        message: `${who} is required and was not supplied`,
        path: who,
      });
    }
    return out;
  }
  if (!id.legalName?.trim()) {
    out.push({
      code: `${who}_legal_name_missing`,
      message: `${who} has no legal name; a partial header must never be rendered`,
      path: `${who}.legalName`,
    });
  }
  if (!id.registeredId?.trim()) {
    // The single most likely real-world failure: a host onboarded before the
    // org record captured a kennitala. Collection packet §6 item 8.
    out.push({
      code: `${who}_registered_id_missing`,
      message: `${who} has no registered identity; refuse rather than render a blank`,
      path: `${who}.registeredId`,
    });
  }
  if (!id.addressLines || id.addressLines.length === 0) {
    out.push({
      code: `${who}_address_missing`,
      message: `${who} has no address`,
      path: `${who}.addressLines`,
    });
  }
  if (!id.countryCode?.trim()) {
    out.push({
      code: `${who}_country_missing`,
      message: `${who} has no country code`,
      path: `${who}.countryCode`,
    });
  }
  return out;
}

/**
 * Every reason this draft is not issuable. Empty array means issuable.
 *
 * Pure, offline, no I/O. This is the function the CLI validator wraps.
 */
export function validateDraft(draft: InvoiceDraft): IssuabilityProblem[] {
  const problems: IssuabilityProblem[] = [];
  const push = (code: string, message: string, path?: string) =>
    problems.push({ code, message, path });

  if (!draft.orgId?.trim()) {
    push("org_scope_missing", "orgId is required — tenancy is not optional", "orgId");
  }
  if (!draft.documentNumber?.trim()) {
    push(
      "document_number_missing",
      "no document number; Icelandic invoices require an unbroken numbered sequence",
      "documentNumber",
    );
  }
  if (draft.kind !== "invoice" && draft.kind !== "credit_note") {
    push("document_kind_invalid", `unknown document kind ${String(draft.kind)}`, "kind");
  }
  if (draft.kind === "credit_note" && !draft.correctsDocumentNumber?.trim()) {
    push(
      "credit_note_target_missing",
      "a credit note must name the document number it corrects",
      "correctsDocumentNumber",
    );
  }
  if (draft.kind === "invoice" && draft.correctsDocumentNumber) {
    push(
      "invoice_corrects_set",
      "only a credit note may correct another document",
      "correctsDocumentNumber",
    );
  }

  problems.push(...identityProblems("claimHolder", draft.claimHolder, true));
  problems.push(...identityProblems("recipient", draft.recipient, true));
  if (draft.presenter) problems.push(...identityProblems("presenter", draft.presenter, false));

  if (!draft.currency?.trim()) {
    push("currency_missing", "currency is required", "currency");
  }
  if (!ISO_DATE.test(draft.issueDate ?? "")) {
    push("issue_date_invalid", "issueDate must be an ISO 8601 date", "issueDate");
  }
  if (!ISO_DATE.test(draft.dueDate ?? "")) {
    push("due_date_invalid", "dueDate must be an ISO 8601 date", "dueDate");
  }
  if (
    ISO_DATE.test(draft.issueDate ?? "") &&
    ISO_DATE.test(draft.dueDate ?? "") &&
    draft.dueDate < draft.issueDate
  ) {
    push("due_before_issue", "dueDate precedes issueDate", "dueDate");
  }
  if (!ISO_DATE.test(draft.period?.from ?? "") || !ISO_DATE.test(draft.period?.to ?? "")) {
    push("period_invalid", "period.from and period.to must be ISO 8601 dates", "period");
  } else if (draft.period.to < draft.period.from) {
    push("period_reversed", "period.to precedes period.from", "period");
  }

  // ── lines ──
  if (!draft.lines || draft.lines.length === 0) {
    // A zero-connector org produces no billable lines. That is a correct
    // outcome and it means DO NOT ISSUE — not "issue an empty invoice".
    push("no_lines", "document has no lines; a zero-total invoice must not be issued", "lines");
  } else {
    draft.lines.forEach((l, i) => {
      const at = `lines[${i}]`;
      if (!l.description?.trim()) push("line_description_missing", "line has no description", at);
      if (!INVOICE_UNITS.includes(l.unit)) push("line_unit_invalid", `unknown unit ${String(l.unit)}`, at);
      if (!Number.isFinite(l.quantity)) push("line_quantity_invalid", "quantity is not a number", at);
      if (!Number.isFinite(l.unitPrice)) push("line_unit_price_invalid", "unitPrice is not a number", at);
      if (!Number.isInteger(l.unitPrice)) {
        push(
          "line_unit_price_not_integer",
          "unitPrice must be an integer in minor units; floats accumulate rounding no accountant can reproduce",
          at,
        );
      }
      if (!l.basis?.trim()) push("line_basis_missing", "line has no basis", at);
      if (!POSTURE_BY_KIND.has(l.moneyLineKind)) {
        push("line_money_line_unknown", `unknown money line ${String(l.moneyLineKind)}`, at);
      }
      if (draft.kind === "invoice" && l.quantity < 0) {
        push("line_negative_quantity", "negative quantity on an invoice; use a credit note", at);
      }
    });

    const postures = posturesOf(draft.lines);
    if (postures.size > 1) {
      // THE invariant. FOCUS.md rule 3.
      push(
        "mixed_posture",
        "document mixes agent and principal lines; lines of different posture must never share an invoice",
        "lines",
      );
    } else if (postures.size === 0) {
      push("posture_undeterminable", "no line carries a recognised money line", "lines");
    } else {
      const posture = [...postures][0];
      // Agent posture: the presenter must be named, and must differ from the
      // kröfuhafi. Without this an agent document is indistinguishable from a
      // principal one at render time — which is exactly the header bug this
      // whole module exists to prevent.
      if (posture === "agent") {
        if (!draft.presenter) {
          push(
            "agent_presenter_missing",
            "agent-posture document must name the presenting party (EN 16931 BG-10 Payee)",
            "presenter",
          );
        } else if (draft.presenter.registeredId === draft.claimHolder.registeredId) {
          push(
            "agent_presenter_equals_claim_holder",
            "agent posture requires presenter and kröfuhafi to be different parties",
            "presenter",
          );
        }
        if (draft.claimHolder.vatNumber === null) {
          // Not fatal in itself — a non-VAT-registered host is a real case —
          // but every line must then say so, or the document asserts a VAT
          // status the host does not have.
          const asserting = draft.lines.filter((l) => l.vat.kind !== "not_registered");
          if (asserting.length > 0) {
            push(
              "vat_asserted_for_unregistered_claim_holder",
              "kröfuhafi has no VAT registration but lines assert a VAT treatment",
              "lines",
            );
          }
        }
      } else {
        // Principal: presenter is Straumvakt itself, so BG-10 is omitted.
        if (draft.presenter && draft.presenter.registeredId !== draft.claimHolder.registeredId) {
          push(
            "principal_presenter_differs",
            "principal-posture document must not name a presenter different from the kröfuhafi",
            "presenter",
          );
        }
      }
    }

    const totals = computeTotals(draft.lines);
    if (draft.kind === "invoice" && totals.gross <= 0) {
      push(
        "non_positive_total",
        "invoice total is not positive; issue nothing rather than a zero claim",
        "lines",
      );
    }
    if (draft.kind === "credit_note" && totals.gross >= 0) {
      push("credit_note_not_negative", "credit note total must be negative", "lines");
    }
  }

  return problems;
}

/** True when the draft can be issued. Convenience over `validateDraft(d).length === 0`. */
export function isIssuable(draft: InvoiceDraft): boolean {
  return validateDraft(draft).length === 0;
}
