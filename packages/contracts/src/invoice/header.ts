// The invoice header — the legal artefact, as a tested contract.
//
// ── WHY THE HEADER GETS ITS OWN MODULE AND ITS OWN GOLDEN FILES ─────────
//
// FOCUS.md rule 3: "the invoice header is the legal artefact." An Icelandic
// claim names a kröfuhafi, and getting it wrong is not a cosmetic bug — it
// asserts that the wrong legal person is owed the money, on a document that
// has already reached the counterparty.
//
// Everything below is arranged so that the wrong header cannot be produced:
//
//  - The kröfuhafi is never inferred. There is no default, no fallback, and
//    no branch that fills it in from the org. `renderHeader` reads exactly one
//    field for it and refuses if that field is incomplete.
//  - A document mixing postures cannot be rendered. It also cannot be
//    constructed (document.ts), so this is defence in depth — the render guard
//    exists because "cannot be constructed" is a property of one code path and
//    a document can arrive from a database, a queue, or a test.
//  - A partial header is never rendered. Missing identity is a refusal, not a
//    blank line. A blank on a claim is worse than no claim.
//  - Golden files pin the output, so a change to header rendering shows up in
//    a diff during review rather than in a customer's inbox.

import type { InvoiceDocument } from "./document";
import { posturesOf } from "./document";

export class HeaderRenderError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "HeaderRenderError";
    this.code = code;
  }
}

export interface RenderedHeader {
  /**
   * The claim line — who the document says is owed the money.
   *
   * Principal: the kröfuhafi's own legal name.
   * Agent:     "<presenter> f.h. <kröfuhafi>" — for Straumvakt presenting on
   *            behalf of a host, exactly "Straumvakt f.h. <host>".
   */
  claimLine: string;
  /** The kröfuhafi's registered identity line. */
  claimHolderIdLine: string;
  /** VAT status line, per posture. */
  vatLine: string;
  /** Present only on an agent document. */
  presenterNote: string | null;
  recipientLines: readonly string[];
  documentLine: string;
  periodLine: string;
  datesLine: string;
}

function requireIdentity(who: string, id: { legalName?: string; registeredId?: string }): void {
  if (!id?.legalName?.trim()) {
    throw new HeaderRenderError(
      `${who}_legal_name_missing`,
      `refusing to render: ${who} has no legal name`,
    );
  }
  if (!id?.registeredId?.trim()) {
    // The host-not-yet-identified case. Collection packet §1.3.
    throw new HeaderRenderError(
      `${who}_registered_id_missing`,
      `refusing to render: ${who} has no registered identity — a partial header must never be rendered`,
    );
  }
}

/**
 * The "f.h." construction.
 *
 * Kept as its own exported function so the exact string is pinned in one
 * place and asserted directly by a test, rather than only being visible
 * inside a template somewhere.
 */
export function onBehalfOf(presenterName: string, claimHolderName: string): string {
  return `${presenterName} f.h. ${claimHolderName}`;
}

/**
 * End a sentence without doubling a full stop.
 *
 * Icelandic company names routinely end in "ehf." or "hf.", so appending "."
 * to a name produces "Hýsill A ehf..". Caught by the golden files on their
 * very first render — which is the argument for having them.
 */
function endSentence(s: string): string {
  return s.endsWith(".") ? s : `${s}.`;
}

export function renderHeader(doc: InvoiceDocument): RenderedHeader {
  // ── guard 1: posture must be single, checked from the LINES, not from the
  // cached `doc.posture` field. Trusting the cached field would let a
  // hand-assembled object claim "principal" while carrying agent lines.
  const postures = posturesOf(doc.lines);
  if (postures.size > 1) {
    throw new HeaderRenderError(
      "mixed_posture",
      "refusing to render: document mixes agent and principal lines",
    );
  }
  if (postures.size === 0) {
    throw new HeaderRenderError(
      "posture_undeterminable",
      "refusing to render: no line carries a recognised money line",
    );
  }
  const posture = [...postures][0];
  if (doc.posture !== posture) {
    throw new HeaderRenderError(
      "posture_mismatch",
      `refusing to render: document declares ${doc.posture} but its lines are ${posture}`,
    );
  }

  // ── guard 2: identities must be complete.
  requireIdentity("claimHolder", doc.claimHolder);
  requireIdentity("recipient", doc.recipient);

  let claimLine: string;
  let presenterNote: string | null = null;

  if (posture === "agent") {
    if (!doc.presenter) {
      throw new HeaderRenderError(
        "agent_presenter_missing",
        "refusing to render: agent-posture document names no presenter",
      );
    }
    requireIdentity("presenter", doc.presenter);
    if (doc.presenter.registeredId === doc.claimHolder.registeredId) {
      throw new HeaderRenderError(
        "agent_presenter_equals_claim_holder",
        "refusing to render: presenter and kröfuhafi are the same party on an agent document",
      );
    }
    claimLine = onBehalfOf(doc.presenter.legalName, doc.claimHolder.legalName);
    presenterNote =
      `Krafan er sett fram af ${doc.presenter.legalName} fyrir hönd kröfuhafa. ` +
      `Kröfuhafi er ${endSentence(doc.claimHolder.legalName)}`;
  } else {
    if (doc.presenter && doc.presenter.registeredId !== doc.claimHolder.registeredId) {
      throw new HeaderRenderError(
        "principal_presenter_differs",
        "refusing to render: principal-posture document names a different presenter",
      );
    }
    claimLine = doc.claimHolder.legalName;
  }

  // ── VAT presentation, per posture.
  //
  // Principal: Straumvakt's own VSK number, because it is Straumvakt's sale.
  // Agent:     the KRÖFUHAFI's VSK number, because the sale is theirs — the
  //            Icelandic rule turns on who sells "í eigin nafni" (in his own
  //            name), and a presenter acting f.h. is explicitly not doing so.
  //            [src: Skatturinn, umboðssala; delivery packet §2]
  //            [confirm: accountant — for a non-VAT-registered kröfuhafi, is
  //            the wording below sufficient, and is anything else required?]
  const vatLine = doc.claimHolder.vatNumber
    ? `VSK-númer kröfuhafa: ${doc.claimHolder.vatNumber}`
    : "Kröfuhafi er ekki á virðisaukaskattsskrá.";

  const recipientLines = [
    doc.recipient.legalName,
    ...doc.recipient.addressLines,
    doc.recipient.countryCode,
  ];

  const kindLabel = doc.kind === "credit_note" ? "Kreditreikningur" : "Sölureikningur";
  const documentLine =
    doc.kind === "credit_note"
      ? `${kindLabel} nr. ${doc.documentNumber} (leiðréttir ${doc.correctsDocumentNumber})`
      : `${kindLabel} nr. ${doc.documentNumber}`;

  return {
    claimLine,
    claimHolderIdLine: `Kt. ${doc.claimHolder.registeredId}`,
    vatLine,
    presenterNote,
    recipientLines,
    documentLine,
    periodLine: `Tímabil: ${doc.period.from} – ${doc.period.to}`,
    datesLine: `Útgáfudagur: ${doc.issueDate}  ·  Gjalddagi: ${doc.dueDate}`,
  };
}

/**
 * Flat text rendering, for golden-file tests.
 *
 * Not the PDF. The PDF renderer is the reversible half of the delivery
 * decision and does not exist yet; this pins the SEMANTICS so that whatever
 * renders it later cannot quietly change what the document asserts.
 */
export function renderHeaderText(doc: InvoiceDocument): string {
  const h = renderHeader(doc);
  const out = [
    h.documentLine,
    "",
    "KRÖFUHAFI",
    h.claimLine,
    h.claimHolderIdLine,
    h.vatLine,
  ];
  if (h.presenterNote) out.push("", h.presenterNote);
  out.push("", "GREIÐANDI", ...h.recipientLines, "", h.periodLine, h.datesLine);
  return out.join("\n") + "\n";
}
