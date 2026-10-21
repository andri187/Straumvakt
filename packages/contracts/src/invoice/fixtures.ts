// Fixtures for the invoice rail.
//
// ── ON THE ABSENCE OF REALISTIC IDENTIFIERS ─────────────────────────────
//
// `registeredId` holds a kennitala at runtime. NO FIXTURE IN THIS FILE USES A
// KENNITALA-SHAPED VALUE, deliberately: a checksum-valid 10-digit string
// committed to a repository is indistinguishable from a real person's national
// id, and the operating rules forbid committing one. The values below are
// obviously synthetic, which also means the module cannot accidentally grow a
// kennitala-format validator that these fixtures appear to satisfy.
//
// If a format check is wanted later it belongs behind an injectable validator
// with its own tests, not inline here.
//
// ── ON THE VAT RATE ─────────────────────────────────────────────────────
//
// 24 appears below as the standard-rate number. It is a FIXTURE value, not a
// constant the production path should read from here — a tax rate is data with
// an effective date, and hardcoding one in a types package is how a rate change
// becomes a code change. The document model carries the rate per line for
// exactly this reason.

import type {
  InvoiceDraft,
  InvoiceLine,
  PartyIdentity,
  VatTreatment,
} from "./document";
import type { DeliveryLogEntry, DeliveryState } from "./delivery";
import type { ReconcileInput, SettlementState } from "./reconciliation";

// ── identities ──────────────────────────────────────────────────────────

export const STRAUMVAKT: PartyIdentity = {
  legalName: "Straumvakt",
  registeredId: "FIXTURE-ID-STRAUMVAKT",
  vatNumber: "FIXTURE-VSK-SV",
  addressLines: ["Fixture Street 1", "101 Reykjavík"],
  countryCode: "IS",
  ref: { kind: "platform" },
};

export const HOST_A: PartyIdentity = {
  legalName: "Hýsill A ehf.",
  registeredId: "FIXTURE-ID-HOST-A",
  vatNumber: "FIXTURE-VSK-A",
  addressLines: ["Fixture Road 12", "200 Kópavogur"],
  countryCode: "IS",
  ref: { kind: "org", orgId: "org-a" },
};

export const HOST_B_NO_VAT: PartyIdentity = {
  legalName: "Hýsill B ehf.",
  registeredId: "FIXTURE-ID-HOST-B",
  vatNumber: null,
  addressLines: ["Fixture Lane 3", "600 Akureyri"],
  countryCode: "IS",
  ref: { kind: "org", orgId: "org-b" },
};

export const HOST_C_NO_IDENTITY: PartyIdentity = {
  legalName: "Hýsill C ehf.",
  registeredId: "",
  vatNumber: null,
  addressLines: ["Fixture Way 9", "800 Selfoss"],
  countryCode: "IS",
  ref: { kind: "org", orgId: "org-c" },
};

export const DRIVER: PartyIdentity = {
  legalName: "Ökumaður D",
  registeredId: "FIXTURE-ID-DRIVER-D",
  vatNumber: null,
  addressLines: ["Fixture Path 4", "105 Reykjavík"],
  countryCode: "IS",
  ref: { kind: "user", userId: "usr-d" },
};

// ── line helpers ────────────────────────────────────────────────────────

const VAT_STANDARD: VatTreatment = { kind: "standard", ratePercent: 24 };
const VAT_NOT_REGISTERED: VatTreatment = { kind: "not_registered" };

/** The market line: 200 kr / active connector / month. */
export function connectorLine(qty: number, unitPrice = 200): InvoiceLine {
  return {
    description: `Tengipunktar, ${qty} stk.`,
    unit: "connector_month",
    quantity: qty,
    unitPrice,
    basis: "per_connector",
    vat: VAT_STANDARD,
    moneyLineKind: "platform_to_host",
    settlementRef: null,
  };
}

/** The market line: 50 kr / active driver / month. */
export function driverLine(qty: number, unitPrice = 50): InvoiceLine {
  return {
    description: `Virkir ökumenn, ${qty} stk.`,
    unit: "driver_month",
    quantity: qty,
    unitPrice,
    basis: "per_driver",
    vat: VAT_STANDARD,
    moneyLineKind: "platform_to_host",
    settlementRef: null,
  };
}

/** An agent-posture line: the host's energy revenue, presented by Straumvakt. */
export function agentEnergyLine(kwh: number, unitPrice = 30, vat = VAT_STANDARD): InvoiceLine {
  return {
    description: `Hleðsla, ${kwh} kWh`,
    unit: "kwh",
    quantity: kwh,
    unitPrice,
    basis: "per_kwh",
    vat,
    moneyLineKind: "host_to_driver",
    settlementRef: "cdr-fixture-1",
  };
}

function baseDraft(over: Partial<InvoiceDraft> = {}): InvoiceDraft {
  return {
    orgId: "org-a",
    kind: "invoice",
    documentNumber: "SV-2026-000001",
    claimHolder: STRAUMVAKT,
    presenter: null,
    recipient: HOST_A,
    period: { from: "2026-07-01", to: "2026-07-31" },
    currency: "ISK",
    lines: [connectorLine(1)],
    issueDate: "2026-08-01",
    dueDate: "2026-08-15",
    settlementRefs: ["settle-1"],
    correctsDocumentNumber: null,
    ...over,
  };
}

// ── document fixtures ───────────────────────────────────────────────────

export interface DocumentFixture {
  name: string;
  scenario: string;
  draft: InvoiceDraft;
  expect: { issuable: true } | { issuable: false; codes: readonly string[] };
}

export const DOCUMENT_FIXTURES: readonly DocumentFixture[] = [
  {
    name: "clean single-connector org",
    scenario: "clean",
    draft: baseDraft(),
    expect: { issuable: true },
  },
  {
    name: "clean single-connector org with one driver",
    scenario: "clean",
    draft: baseDraft({ lines: [connectorLine(1), driverLine(1)] }),
    expect: { issuable: true },
  },
  {
    name: "multi-site org — several connector lines on one document",
    scenario: "multi-site",
    draft: baseDraft({
      lines: [
        { ...connectorLine(4), description: "Tengipunktar — Síða Vesturbær, 4 stk." },
        { ...connectorLine(7), description: "Tengipunktar — Síða Árbær, 7 stk." },
        driverLine(12),
      ],
    }),
    expect: { issuable: true },
  },
  {
    name: "multi-site org — sites differ but posture does not",
    scenario: "multi-site",
    draft: baseDraft({
      lines: [connectorLine(2), connectorLine(3), connectorLine(5), driverLine(9)],
    }),
    expect: { issuable: true },
  },
  {
    name: "mid-period activation — fractional connector-month",
    scenario: "mid-period-activation",
    draft: baseDraft({ lines: [connectorLine(0.5)] }),
    expect: { issuable: true },
  },
  {
    name: "mid-period activation — connector active 12 of 31 days",
    scenario: "mid-period-activation",
    draft: baseDraft({
      lines: [{ ...connectorLine(12 / 31), description: "Tengipunktur, virkur 12 af 31 degi" }],
    }),
    expect: { issuable: true },
  },
  {
    name: "mid-period activation — driver joins mid-month",
    scenario: "mid-period-activation",
    draft: baseDraft({ lines: [connectorLine(1), driverLine(0.5)] }),
    expect: { issuable: true },
  },
  {
    name: "zero-connector org — nothing to bill",
    scenario: "zero-connector",
    draft: baseDraft({ lines: [] }),
    expect: { issuable: false, codes: ["no_lines"] },
  },
  {
    name: "zero-connector org — zero quantity is still nothing to bill",
    scenario: "zero-connector",
    draft: baseDraft({ lines: [connectorLine(0)] }),
    expect: { issuable: false, codes: ["non_positive_total"] },
  },
  {
    name: "cap boundary — exactly at 450 kr per connector",
    scenario: "cap-boundary",
    // 1 connector @200 + 5 drivers @50 = 450 = the cap, exactly.
    draft: baseDraft({ lines: [connectorLine(1), driverLine(5)] }),
    expect: { issuable: true },
  },
  {
    name: "cap boundary — capped line replaces the uncapped pair",
    scenario: "cap-boundary",
    draft: baseDraft({
      lines: [
        {
          ...connectorLine(1, 450),
          description: "Tengipunktur — þak 450 kr./tengipunkt/mán.",
          basis: "per_connector_capped",
        },
      ],
    }),
    expect: { issuable: true },
  },
  {
    name: "cap boundary — cap applied per connector across many connectors",
    scenario: "cap-boundary",
    draft: baseDraft({ lines: [connectorLine(10, 450)] }),
    expect: { issuable: true },
  },
  {
    name: "credit note — full reversal of an issued invoice",
    scenario: "credit-note",
    draft: baseDraft({
      kind: "credit_note",
      documentNumber: "SV-2026-000002",
      correctsDocumentNumber: "SV-2026-000001",
      lines: [connectorLine(1, -200)],
    }),
    expect: { issuable: true },
  },
  {
    name: "credit note — must name the document it corrects",
    scenario: "credit-note",
    draft: baseDraft({
      kind: "credit_note",
      correctsDocumentNumber: null,
      lines: [connectorLine(1, -200)],
    }),
    expect: { issuable: false, codes: ["credit_note_target_missing"] },
  },
  {
    name: "credit note — a positive total is not a credit note",
    scenario: "credit-note",
    draft: baseDraft({
      kind: "credit_note",
      correctsDocumentNumber: "SV-2026-000001",
      lines: [connectorLine(1, 200)],
    }),
    expect: { issuable: false, codes: ["credit_note_not_negative"] },
  },
  {
    name: "correction after issue — an invoice may not correct another document",
    scenario: "correction-after-issue",
    draft: baseDraft({ correctsDocumentNumber: "SV-2026-000001" }),
    expect: { issuable: false, codes: ["invoice_corrects_set"] },
  },
  {
    name: "correction after issue — partial credit for one over-billed line",
    scenario: "correction-after-issue",
    draft: baseDraft({
      kind: "credit_note",
      documentNumber: "SV-2026-000003",
      correctsDocumentNumber: "SV-2026-000001",
      lines: [{ ...connectorLine(2, -200), description: "Leiðrétting: 2 tengipunktar oftaldir" }],
    }),
    expect: { issuable: true },
  },
  {
    name: "correction after issue — replacement invoice takes a NEW number",
    scenario: "correction-after-issue",
    draft: baseDraft({ documentNumber: "SV-2026-000004", lines: [connectorLine(3)] }),
    expect: { issuable: true },
  },
  {
    name: "disputed line — the document itself remains well-formed",
    scenario: "disputed",
    draft: baseDraft({ lines: [connectorLine(3), driverLine(4)] }),
    expect: { issuable: true },
  },
  {
    name: "agent-posture claim — host is kröfuhafi, Straumvakt presents",
    scenario: "agent-posture",
    draft: baseDraft({
      orgId: "org-a",
      documentNumber: "SV-2026-000010",
      claimHolder: HOST_A,
      presenter: STRAUMVAKT,
      recipient: DRIVER,
      lines: [agentEnergyLine(40)],
    }),
    expect: { issuable: true },
  },
  {
    name: "agent-posture claim MUST NOT share a document with a principal line",
    scenario: "agent-posture",
    draft: baseDraft({
      claimHolder: HOST_A,
      presenter: STRAUMVAKT,
      recipient: DRIVER,
      lines: [agentEnergyLine(40), connectorLine(1)],
    }),
    expect: { issuable: false, codes: ["mixed_posture"] },
  },
  {
    name: "agent posture without a presenter is refused",
    scenario: "agent-posture",
    draft: baseDraft({
      claimHolder: HOST_A,
      presenter: null,
      recipient: DRIVER,
      lines: [agentEnergyLine(40)],
    }),
    expect: { issuable: false, codes: ["agent_presenter_missing"] },
  },
  {
    name: "agent posture where presenter equals kröfuhafi is refused",
    scenario: "agent-posture",
    draft: baseDraft({
      claimHolder: HOST_A,
      presenter: HOST_A,
      recipient: DRIVER,
      lines: [agentEnergyLine(40)],
    }),
    expect: { issuable: false, codes: ["agent_presenter_equals_claim_holder"] },
  },
  {
    name: "agent posture for a non-VAT-registered kröfuhafi asserting VAT is refused",
    scenario: "agent-posture",
    draft: baseDraft({
      claimHolder: HOST_B_NO_VAT,
      presenter: STRAUMVAKT,
      recipient: DRIVER,
      lines: [agentEnergyLine(40)],
    }),
    expect: { issuable: false, codes: ["vat_asserted_for_unregistered_claim_holder"] },
  },
  {
    name: "agent posture for a non-VAT-registered kröfuhafi, stated correctly",
    scenario: "agent-posture",
    draft: baseDraft({
      claimHolder: HOST_B_NO_VAT,
      presenter: STRAUMVAKT,
      recipient: DRIVER,
      lines: [agentEnergyLine(40, 30, VAT_NOT_REGISTERED)],
    }),
    expect: { issuable: true },
  },
  {
    name: "principal posture must not name a different presenter",
    scenario: "posture-guard",
    draft: baseDraft({ presenter: HOST_A }),
    expect: { issuable: false, codes: ["principal_presenter_differs"] },
  },
  {
    name: "kröfuhafi with no registered identity is refused, not blanked",
    scenario: "identity",
    draft: baseDraft({ claimHolder: HOST_C_NO_IDENTITY, lines: [connectorLine(1)] }),
    expect: { issuable: false, codes: ["claimHolder_registered_id_missing"] },
  },
  {
    name: "recipient with no registered identity is refused",
    scenario: "identity",
    draft: baseDraft({ recipient: HOST_C_NO_IDENTITY }),
    expect: { issuable: false, codes: ["recipient_registered_id_missing"] },
  },
  {
    name: "missing document number is refused",
    scenario: "numbering",
    draft: baseDraft({ documentNumber: "" }),
    expect: { issuable: false, codes: ["document_number_missing"] },
  },
  {
    name: "missing tenant scope is refused",
    scenario: "tenancy",
    draft: baseDraft({ orgId: "" }),
    expect: { issuable: false, codes: ["org_scope_missing"] },
  },
  {
    name: "due date before issue date is refused",
    scenario: "dates",
    draft: baseDraft({ issueDate: "2026-08-10", dueDate: "2026-08-01" }),
    expect: { issuable: false, codes: ["due_before_issue"] },
  },
  {
    name: "reversed period is refused",
    scenario: "dates",
    draft: baseDraft({ period: { from: "2026-07-31", to: "2026-07-01" } }),
    expect: { issuable: false, codes: ["period_reversed"] },
  },
  {
    name: "fractional unit price is refused — rounding must not be invented per line",
    scenario: "money",
    draft: baseDraft({ lines: [connectorLine(1, 200.5)] }),
    expect: { issuable: false, codes: ["line_unit_price_not_integer"] },
  },
  {
    name: "settlement hold — period with no lines released is not issuable",
    scenario: "settlement-hold",
    draft: baseDraft({ lines: [], settlementRefs: [] }),
    expect: { issuable: false, codes: ["no_lines"] },
  },
  {
    name: "settlement hold — released lines carry their settlement refs",
    scenario: "settlement-hold",
    draft: baseDraft({
      lines: [{ ...connectorLine(2), settlementRef: "settle-held-1" }],
      settlementRefs: ["settle-held-1"],
    }),
    expect: { issuable: true },
  },
] as const;

// ── delivery fixtures ───────────────────────────────────────────────────

export interface DeliveryFixture {
  name: string;
  scenario: string;
  entries: readonly DeliveryLogEntry[];
  expect: {
    documentState: DeliveryState;
    delivered: boolean;
    requiresOperator: boolean;
    mayRetry: boolean;
  };
}

function entry(
  state: DeliveryState,
  attempts: number,
  channel: DeliveryLogEntry["channel"] = "email_pdf",
): DeliveryLogEntry {
  return {
    orgId: "org-a",
    documentNumber: "SV-2026-000001",
    channel,
    state,
    attempts: Array.from({ length: attempts }, (_, i) => ({
      attempt: i + 1,
      state,
      at: `2026-08-0${Math.min(i + 1, 9)}T00:00:00Z`,
    })),
    deliveredAt: state === "delivered" ? "2026-08-01T00:00:00Z" : null,
  };
}

export const DELIVERY_FIXTURES: readonly DeliveryFixture[] = [
  {
    name: "delivered on the first attempt",
    scenario: "clean",
    entries: [entry("delivered", 1)],
    expect: { documentState: "delivered", delivered: true, requiresOperator: false, mayRetry: false },
  },
  {
    name: "duplicate delivery attempt — a delivered entry is never retried",
    scenario: "duplicate-delivery",
    entries: [entry("delivered", 2)],
    expect: { documentState: "delivered", delivered: true, requiresOperator: false, mayRetry: false },
  },
  {
    name: "bounced email — permanent failure, no retry",
    scenario: "bounced-email",
    entries: [entry("failed_permanent", 1)],
    expect: {
      documentState: "failed_permanent",
      delivered: false,
      requiresOperator: true,
      mayRetry: false,
    },
  },
  {
    name: "transient failure — retryable within budget",
    scenario: "retry",
    entries: [entry("failed_retryable", 2)],
    expect: {
      documentState: "failed_retryable",
      delivered: false,
      requiresOperator: false,
      mayRetry: true,
    },
  },
  {
    name: "retry budget exhausted — abandoned, operator required",
    scenario: "retry",
    entries: [entry("failed_retryable", 5)],
    expect: {
      documentState: "failed_retryable",
      delivered: false,
      requiresOperator: false,
      mayRetry: false,
    },
  },
  {
    name: "unknown-delivery timeout — NOT delivered, NOT retried",
    scenario: "unknown-timeout",
    entries: [entry("unknown", 1)],
    expect: { documentState: "unknown", delivered: false, requiresOperator: true, mayRetry: false },
  },
  {
    name: "unknown with attempts left is still not retried",
    scenario: "unknown-timeout",
    entries: [entry("unknown", 1)],
    expect: { documentState: "unknown", delivered: false, requiresOperator: true, mayRetry: false },
  },
  {
    name: "no delivery attempted at all rolls up to unknown, never delivered",
    scenario: "fail-closed",
    entries: [],
    expect: { documentState: "unknown", delivered: false, requiresOperator: true, mayRetry: false },
  },
  {
    name: "two channels, one delivered — document counts as delivered",
    scenario: "multi-channel",
    entries: [entry("failed_permanent", 1, "email_pdf"), entry("delivered", 1, "bank_claim")],
    expect: { documentState: "delivered", delivered: true, requiresOperator: false, mayRetry: false },
  },
  {
    name: "two channels, one unknown — document is unknown, not delivered",
    scenario: "multi-channel",
    entries: [entry("failed_permanent", 1, "email_pdf"), entry("unknown", 1, "bank_claim")],
    expect: { documentState: "unknown", delivered: false, requiresOperator: true, mayRetry: false },
  },
  {
    name: "still pending — no attempt yet",
    scenario: "clean",
    entries: [entry("pending", 0)],
    expect: { documentState: "pending", delivered: false, requiresOperator: false, mayRetry: true },
  },
] as const;

// ── settlement fixtures ─────────────────────────────────────────────────

export interface SettlementFixture {
  name: string;
  scenario: string;
  input: ReconcileInput;
  expect: { state: SettlementState; outstanding: number; overdue: boolean };
}

function ev(
  event: ReconcileInput["events"][number]["event"],
  amount = 0,
  at = "2026-08-10T00:00:00Z",
): ReconcileInput["events"][number] {
  return {
    orgId: "org-a",
    documentNumber: "SV-2026-000001",
    event,
    amount,
    at,
    railReference: null,
  };
}

export const SETTLEMENT_FIXTURES: readonly SettlementFixture[] = [
  {
    name: "issued, not yet presented",
    scenario: "clean",
    input: { total: 248, dueDate: "2026-08-15", asOf: "2026-08-01", events: [] },
    expect: { state: "issued", outstanding: 248, overdue: false },
  },
  {
    name: "presented — the rail accepted the claim, which is not payment",
    scenario: "clean",
    input: {
      total: 248,
      dueDate: "2026-08-15",
      asOf: "2026-08-02",
      events: [ev("claim_created")],
    },
    expect: { state: "presented", outstanding: 248, overdue: false },
  },
  {
    name: "presentation failed — correctable, must not read as delivered",
    scenario: "presentation-failure",
    input: {
      total: 248,
      dueDate: "2026-08-15",
      asOf: "2026-08-02",
      events: [ev("claim_rejected")],
    },
    expect: { state: "presentation_failed", outstanding: 248, overdue: false },
  },
  {
    name: "paid in full — settled exactly",
    scenario: "clean",
    input: {
      total: 248,
      dueDate: "2026-08-15",
      asOf: "2026-08-12",
      events: [ev("claim_created"), ev("payment_received", 248)],
    },
    expect: { state: "settled", outstanding: 0, overdue: false },
  },
  {
    name: "partial payment — dunning continues on the remainder only",
    scenario: "partial-payment",
    input: {
      total: 248,
      dueDate: "2026-08-15",
      asOf: "2026-08-12",
      events: [ev("claim_created"), ev("payment_received", 100)],
    },
    expect: { state: "part_settled", outstanding: 148, overdue: false },
  },
  {
    name: "partial payment past due — overdue on the remainder",
    scenario: "partial-payment",
    input: {
      total: 248,
      dueDate: "2026-08-15",
      asOf: "2026-08-20",
      events: [ev("claim_created"), ev("payment_received", 100)],
    },
    expect: { state: "part_settled", outstanding: 148, overdue: true },
  },
  {
    name: "two partial payments summing to the total settle it",
    scenario: "partial-payment",
    input: {
      total: 248,
      dueDate: "2026-08-15",
      asOf: "2026-08-14",
      events: [ev("payment_received", 100), ev("payment_received", 148)],
    },
    expect: { state: "settled", outstanding: 0, overdue: false },
  },
  {
    name: "overpayment is NOT settled — a refund is owed",
    scenario: "overpayment",
    input: {
      total: 248,
      dueDate: "2026-08-15",
      asOf: "2026-08-12",
      events: [ev("claim_created"), ev("payment_received", 300)],
    },
    expect: { state: "overpaid", outstanding: -52, overdue: false },
  },
  {
    name: "returned payment re-opens the balance",
    scenario: "returned",
    input: {
      total: 248,
      dueDate: "2026-08-15",
      asOf: "2026-08-20",
      events: [ev("payment_received", 248), ev("payment_returned", -248)],
    },
    expect: { state: "returned", outstanding: 248, overdue: true },
  },
  {
    name: "returned payment supplied with a positive amount still subtracts",
    scenario: "returned",
    input: {
      total: 248,
      dueDate: "2026-08-15",
      asOf: "2026-08-20",
      events: [ev("payment_received", 248), ev("payment_returned", 248)],
    },
    expect: { state: "returned", outstanding: 248, overdue: true },
  },
  {
    name: "disputed freezes — not overdue while disputed",
    scenario: "disputed",
    input: {
      total: 248,
      dueDate: "2026-08-15",
      asOf: "2026-08-25",
      events: [ev("claim_created"), ev("claim_disputed")],
    },
    expect: { state: "disputed", outstanding: 248, overdue: false },
  },
  {
    name: "dispute resolved returns it to the normal path",
    scenario: "disputed",
    input: {
      total: 248,
      dueDate: "2026-08-15",
      asOf: "2026-08-25",
      events: [ev("claim_created"), ev("claim_disputed"), ev("dispute_resolved")],
    },
    expect: { state: "presented", outstanding: 248, overdue: true },
  },
  {
    name: "cancelled claim — terminal, number stays spent",
    scenario: "cancelled",
    input: {
      total: 248,
      dueDate: "2026-08-15",
      asOf: "2026-08-20",
      events: [ev("claim_created"), ev("claim_cancelled")],
    },
    expect: { state: "cancelled", outstanding: 248, overdue: false },
  },
  {
    name: "payment crossing a cancellation is accepted, not rejected",
    scenario: "cancelled",
    input: {
      total: 248,
      dueDate: "2026-08-15",
      asOf: "2026-08-20",
      events: [ev("claim_cancelled"), ev("payment_received", 248)],
    },
    expect: { state: "settled", outstanding: 0, overdue: false },
  },
  {
    name: "escalated to framhaldsinnheimta",
    scenario: "escalation",
    input: {
      total: 248,
      dueDate: "2026-08-15",
      asOf: "2026-09-20",
      events: [ev("claim_created"), ev("claim_escalated")],
    },
    expect: { state: "in_collection", outstanding: 248, overdue: true },
  },
] as const;

// ── numbering fixtures ──────────────────────────────────────────────────

export interface NumberingFixture {
  name: string;
  scenario: string;
  /** (idempotencyKey, year) pairs applied in order. */
  issues: readonly { key: string; year: number }[];
  expect: { numbers: readonly string[]; distinct: number };
}

export const NUMBERING_FIXTURES: readonly NumberingFixture[] = [
  {
    name: "sequential issue within a year",
    scenario: "numbering",
    issues: [
      { key: "a", year: 2026 },
      { key: "b", year: 2026 },
      { key: "c", year: 2026 },
    ],
    expect: {
      numbers: ["SV-2026-000001", "SV-2026-000002", "SV-2026-000003"],
      distinct: 3,
    },
  },
  {
    name: "retry with the same idempotency key reuses the number",
    scenario: "numbering-retry",
    issues: [
      { key: "a", year: 2026 },
      { key: "a", year: 2026 },
      { key: "a", year: 2026 },
    ],
    expect: { numbers: ["SV-2026-000001", "SV-2026-000001", "SV-2026-000001"], distinct: 1 },
  },
  {
    name: "year rollover restarts the series",
    scenario: "numbering-rollover",
    issues: [
      { key: "a", year: 2026 },
      { key: "b", year: 2026 },
      { key: "c", year: 2027 },
    ],
    expect: {
      numbers: ["SV-2026-000001", "SV-2026-000002", "SV-2027-000001"],
      distinct: 3,
    },
  },
  {
    name: "interleaved years keep separate sequences",
    scenario: "numbering-rollover",
    issues: [
      { key: "a", year: 2026 },
      { key: "b", year: 2027 },
      { key: "c", year: 2026 },
      { key: "d", year: 2027 },
    ],
    expect: {
      numbers: ["SV-2026-000001", "SV-2027-000001", "SV-2026-000002", "SV-2027-000002"],
      distinct: 4,
    },
  },
] as const;

// ── count ───────────────────────────────────────────────────────────────

/**
 * Total fixtures. Asserted by a test against the ≥40 floor so that deleting
 * fixtures to make a suite green fails loudly.
 */
export const FIXTURE_COUNT =
  DOCUMENT_FIXTURES.length +
  DELIVERY_FIXTURES.length +
  SETTLEMENT_FIXTURES.length +
  NUMBERING_FIXTURES.length;
