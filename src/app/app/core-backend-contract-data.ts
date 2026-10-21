import type { Tone, VisualScreen } from "../visual/visual-data";
import type { PostLoginRouteId } from "./post-login-types";

export type BillingTrustState =
  | "Statement final" | "Statement draft" | "Meter verification held"
  | "CDR authority pending" | "CDR corrected" | "Adjustment present"
  | "Export ready" | "Export blocked" | "Delivery logged" | "Delivery failed";

export type BillingTrustFixture = {
  id: string;
  driver: string;
  sessions: number;
  energyKwh: number | null;
  meterStart: number | null;
  meterStop: number | null;
  energyAuthority: "Verified meter delta" | "Verification held" | "Unavailable";
  cdrAuthority: "Verified CDR" | "Pending source check" | "Corrected CDR";
  state: BillingTrustState;
  rateVersion: string;
  adjustmentIsk: number;
};

const trustStates: BillingTrustState[] = [
  "Statement final", "Statement draft", "Meter verification held", "CDR authority pending", "CDR corrected",
  "Adjustment present", "Export ready", "Export blocked", "Delivery logged", "Delivery failed",
];

export const billingTrustStatementVariants: BillingTrustFixture[] = Array.from({ length: 50 }, (_, index) => {
  const state = trustStates[index % trustStates.length];
  const meterStart = 1200 + index * 37;
  const delta = 12 + (index % 31);
  const held = state === "Meter verification held";
  const unavailable = index % 17 === 0;
  return {
    id: `DEMO-TRUST-${String(index + 1).padStart(2, "0")}`,
    driver: `demo-trust-${String(index + 1).padStart(2, "0")}@north.test`,
    sessions: 1 + (index % 14),
    energyKwh: unavailable || held ? null : delta,
    meterStart: unavailable ? null : meterStart,
    meterStop: unavailable ? null : meterStart + delta,
    energyAuthority: unavailable ? "Unavailable" : held ? "Verification held" : "Verified meter delta",
    cdrAuthority: state === "CDR authority pending" ? "Pending source check" : state === "CDR corrected" ? "Corrected CDR" : "Verified CDR",
    state,
    rateVersion: `ISK-2026.${String(7 + (index % 3)).padStart(2, "0")}-${String.fromCharCode(65 + (index % 4))}`,
    adjustmentIsk: state === "Adjustment present" || state === "CDR corrected" ? -150 - index : 0,
  };
});

type MetricSeed = [label: string, value: string, detail: string, tone?: Tone];
type ScreenSeed = {
  id: string; label: string; eyebrow: string; title: string; summary: string;
  state: string; tone: Tone; metrics: MetricSeed[]; notice: string;
  action?: string;
};

const q = (title: string, detail: string, tone: Tone) => ({ title, detail, tone });
const queue = [
  q("Verify session meter evidence", "The engine uses meter delta; hold only sessions with incomplete or anomalous evidence", "warn"),
  q("Confirm CDR authority", "Do not label OCPP-derived price as CDR authority", "bad"),
  q("Keep corrections additive", "Preserve original evidence and show the adjustment", "info"),
];

function makeScreen(seed: ScreenSeed): VisualScreen {
  return {
    id: seed.id, label: seed.label, eyebrow: seed.eyebrow, title: seed.title, summary: seed.summary,
    state: seed.state, stateTone: seed.tone,
    metrics: seed.metrics.map(([label, value, detail, tone]) => ({ label, value, detail, tone })),
    columns: ["Evidence", "Source", "Authority", "State", "Next"],
    rows: [
      ["Energy", "Meter readings", "Delta explicit", seed.id.includes("meter") ? "Held" : "Review", "Verify semantics"],
      ["Price", "CDR or OCPP", "Source explicit", seed.id.includes("cdr") ? "Pending" : "Review", "Confirm provenance"],
      ["Correction", "Additive note", "Original retained", "Review", "Approve contract"],
    ],
    queue,
    journeyStep: seed.label,
    maturity: seed.action ? "blocked" : "preview",
    tableTitle: `${seed.label} evidence`,
    queueTitle: "Trust checks",
    action: seed.action,
    actionDisabled: Boolean(seed.action),
    notice: seed.notice,
    review: {
      intent: seed.summary,
      real: "The visual state, evidence hierarchy and blocked-state language are reviewable.",
      demo: "All meter, CDR, statement, export and delivery values are local demo fixtures.",
      blocked: seed.notice,
      decision: "Approve the evidence contract before enabling mutation or final-state claims.",
    },
  } as VisualScreen;
}

const driverSeeds: ScreenSeed[] = [
  {
    id: "statement-final", label: "Statement final", eyebrow: "Evidence complete", title: "Final statement material",
    summary: "Show final only when meter delta, CDR authority, rate version and corrections are verified.",
    state: "Final / demo", tone: "good",
    metrics: [["Meter", "Delta verified", "Stop minus start", "good"], ["CDR", "Authoritative", "Source confirmed", "good"], ["Rate", "ISK-2026.08-A", "Preserved"], ["Document", "Statement final", "Not payment", "info"]],
    notice: "Final means statement evidence is complete; it does not mean an invoice was issued or paid.",
  },
  {
    id: "statement-draft", label: "Statement draft", eyebrow: "Open period", title: "Draft statement material",
    summary: "Keep open-period energy and cost visibly provisional while evidence may still change.",
    state: "Draft", tone: "warn",
    metrics: [["Sessions", "12", "Period open"], ["Energy", "Pending close", "May change", "warn"], ["Cost", "Estimate", "Not final", "warn"], ["Delivery", "Not available", "Period open"]],
    notice: "Draft values can change and are not invoice or payment truth.",
  },
  {
    id: "meter-verification-held", label: "Meter verification", eyebrow: "Session evidence held", title: "Per-session meter evidence needs review",
    summary: "The billing engine uses meter stop minus meter start; hold only this session while its readings or units remain anomalous.",
    state: "Session held", tone: "warn",
    metrics: [["Meter start", "1.842 kWh", "Demo register"], ["Meter stop", "1.866 kWh", "Demo register"], ["Expected delta", "24 kWh", "Not authoritative", "warn"], ["Billed energy", "Unavailable", "Held safely", "bad"]],
    action: "Download statement", notice: "Export is blocked for this session until its meter evidence is complete; the engine-level delta fix already exists.",
  },
  {
    id: "cdr-authority-pending", label: "CDR authority", eyebrow: "Provenance pending", title: "Charge record authority is pending",
    summary: "Distinguish a real CDR amount from an OCPP-derived price carried on a CDR-shaped row.",
    state: "Source check", tone: "warn",
    metrics: [["Record", "CDR-shaped", "Shape is not authority"], ["Price source", "Pending", "Must be explicit", "warn"], ["Rate version", "ISK-2026.08-A", "Candidate"], ["Statement", "Held", "No final claim", "bad"]],
    action: "Download statement", notice: "A CDR label alone does not prove authoritative CDR calculation.",
  },
  {
    id: "cdr-corrected", label: "CDR corrected", eyebrow: "Additive correction", title: "Corrected charge record",
    summary: "Show original record, correction reason and replacement authority without rewriting history.",
    state: "Corrected", tone: "info",
    metrics: [["Original", "497 kr", "Retained"], ["Adjustment", "-150 kr", "ADJ-04", "warn"], ["Corrected", "347 kr", "Demo total", "good"], ["Authority", "Corrected CDR", "Reason recorded"]],
    notice: "Corrections are additive and never delete the original evidence.",
  },
  {
    id: "adjustment-detail", label: "Adjustment detail", eyebrow: "Reason and actor", title: "Statement adjustment",
    summary: "Explain amount, reason, source statement and actor while the original line remains visible.",
    state: "Reviewable", tone: "info",
    metrics: [["Adjustment", "-150 kr", "Demo"], ["Reason", "Meter correction", "Structured"], ["Original", "DEMO-CDR-04", "Retained"], ["Actor", "Billing admin", "Attribution required"]],
    notice: "An adjustment changes the visible total but never replaces source evidence.",
  },
  {
    id: "export-ready", label: "Export ready", eyebrow: "Evidence complete", title: "Statement export ready",
    summary: "Represent internal readiness without claiming a supported bank or accounting integration.",
    state: "Ready / local", tone: "good",
    metrics: [["Meter", "Verified", "Delta"], ["CDR", "Verified", "Authority"], ["Format", "Internal statement", "Not bank format"], ["Download", "Still gated", "Contract pending", "warn"]],
    action: "Download statement", notice: "Evidence is ready, but download remains disabled until document and retention contracts exist.",
  },
  {
    id: "export-blocked", label: "Export blocked", eyebrow: "Unsafe to export", title: "Statement export blocked",
    summary: "Show exact missing evidence instead of offering a file with misleading totals.",
    state: "Blocked", tone: "bad",
    metrics: [["Meter", "Unverified", "Semantics", "bad"], ["CDR", "Pending", "Authority", "warn"], ["Adjustment", "Open", "Review"], ["Export", "Unavailable", "Safe hold", "bad"]],
    action: "Download statement", notice: "Export is blocked because statement authority is incomplete.",
  },
  {
    id: "delivery-logged", label: "Delivery logged", eyebrow: "Organisation delivery", title: "Report delivered by the organisation",
    summary: "Record organisation delivery without implying recipient receipt or payment.",
    state: "Delivery logged", tone: "good",
    metrics: [["Material", "Statement", "Demo hash"], ["Delivered by", "Demo North", "Organisation"], ["Channel", "Email fixture", "Provider not wired"], ["Payment", "Not tracked", "Separate contract"]],
    notice: "Logged delivery is not proof that the recipient opened, accepted or paid anything.",
  },
  {
    id: "delivery-failed", label: "Delivery failed", eyebrow: "Organisation delivery", title: "Report delivery failed",
    summary: "Explain a failed handoff while preserving the statement and avoiding automatic resend claims.",
    state: "Failed / demo", tone: "bad",
    metrics: [["Statement", "Available", "Evidence retained"], ["Delivery", "Failed", "Demo provider", "bad"], ["Retry", "Unavailable", "Idempotency needed"], ["Payment", "Not tracked", "No inference"]],
    action: "Retry delivery", notice: "Retry is disabled until recipient, provider-outcome and idempotency contracts exist.",
  },
];

const adminSeeds: ScreenSeed[] = [
  {
    id: "billing-trust", label: "Billing trust", eyebrow: "Cross-tenant evidence", title: "Billing statement trust overview",
    summary: "Review held, pending, corrected and final material across demo tenants without enabling mutation.",
    state: "Verification holds", tone: "warn",
    metrics: [["Final", "21", "Demo"], ["Meter holds", "7", "Semantics", "bad"], ["CDR pending", "5", "Authority", "warn"], ["Corrected", "3", "Additive"]],
    notice: "Cross-tenant reads require explicit platform authority; this view is a local fixture only.",
  },
  {
    id: "ocpp-cost-gate", label: "Cost gate", eyebrow: "Fleet cost control", title: "Routine message fast path",
    summary: "Show that routine heartbeat filtering exists while gateway-suite and deployment evidence remain incomplete.",
    state: "Implemented / unverified", tone: "warn",
    metrics: [["Fast path", "Implemented", "Source evidence", "good"], ["Gateway suite", "Incomplete", "Toolchain", "warn"], ["Deployment", "Unverified", "Runtime evidence", "bad"], ["UI control", "None", "Correct boundary"]],
    notice: "The heartbeat fast path exists in source; gateway-suite/toolchain completion and deployed queue evidence are still unverified.",
  },
  {
    id: "connector-frame-cap", label: "Frame cap", eyebrow: "Connection protection", title: "Connector message protection",
    summary: "Represent connection protection readiness without claiming a per-connector frame cap exists.",
    state: "Cap missing", tone: "bad",
    metrics: [["Per connector", "No frame cap", "Backend gap", "bad"], ["Global limit", "Unknown", "Do not infer"], ["UI control", "None", "Correct boundary"], ["Launch", "Decision needed", "Scale risk", "warn"]],
    notice: "No per-connector frame cap is evidenced, and this UI cannot create one.",
  },
  {
    id: "tenant-read-boundary", label: "Tenant reads", eyebrow: "Platform authority", title: "Cross-tenant billing read boundary",
    summary: "Make platform read authority explicit and separate it from tenant mutation or impersonation.",
    state: "Authority required", tone: "warn",
    metrics: [["Platform read", "Contract needed", "Explicit permission"], ["Tenant filter", "Mandatory", "Every query", "warn"], ["Mutation", "Absent", "This lane"], ["Audit", "Required", "Actor and tenant"]],
    notice: "The local Admin view does not prove production cross-tenant authorization.",
  },
];

const orgSeeds: ScreenSeed[] = [
  {
    id: "pricing-readiness", label: "Pricing readiness", eyebrow: "Organisation billing", title: "Pricing and statement readiness",
    summary: "Separate configured rates from verified meter and CDR authority before final status.",
    state: "Evidence pending", tone: "warn",
    metrics: [["Rate version", "Configured", "ISK-2026.08-A"], ["Meter engine", "Delta fixed", "Verify per session", "good"], ["CDR authority", "Pending", "Source", "warn"], ["Statement", "Held", "Safe state"]],
    notice: "The meter-delta engine fix exists; configured rates still do not prove each session's readings or CDR price authority.",
  },
  {
    id: "driver-authority", label: "Driver authority", eyebrow: "Manual management", title: "Manual driver management readiness",
    summary: "Show the requested driver action and missing authority without presenting a working mutation.",
    state: "Authority blocked", tone: "bad",
    metrics: [["Roster read", "Reviewable", "Local fixture"], ["Add driver", "Blocked", "Permission contract", "bad"], ["Deactivate", "Blocked", "Billing effect"], ["Invite link", "Blocked", "Identity binding", "warn"]],
    action: "Add driver manually", notice: "Manual driver management authority is not proven; no request is sent.",
  },
  {
    id: "export-readiness", label: "Export readiness", eyebrow: "Billing material", title: "Export and delivery readiness",
    summary: "Separate internal statement readiness from researched Icelandic export formats.",
    state: "Format research", tone: "warn",
    metrics: [["Statement", "Internally ready", "Demo"], ["Bank format", "Unknown", "Research", "bad"], ["Accounting", "Unknown", "Research", "warn"], ["Export", "Blocked", "No false claim"]],
    action: "Export bundle", notice: "No Icelandic bank or accounting format is supported until researched and validated.",
  },
  {
    id: "compliance-later", label: "Legal and SLA", eyebrow: "Later decision", title: "Legal, SLA and DPA readiness",
    summary: "Keep future legal and service commitments visible as decisions, not implied Core capabilities.",
    state: "Later / unapproved", tone: "warn",
    metrics: [["DPA", "Not approved", "Later"], ["SLA", "Not approved", "Later"], ["Retention", "Undecided", "Legal input"], ["Core UI", "No claim", "Correct"]],
    notice: "This screen records unresolved commitments and does not create legal or service terms.",
  },
];

export const backendContractScreensByPersona: Record<PostLoginRouteId, VisualScreen[]> = {
  admin: adminSeeds.map(makeScreen),
  org: orgSeeds.map(makeScreen),
  driver: driverSeeds.map(makeScreen),
};
