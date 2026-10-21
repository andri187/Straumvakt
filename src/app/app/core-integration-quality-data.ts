import type { Tone, VisualScreen } from "../visual/visual-data";
import type { PostLoginRouteId } from "./post-login-types";

export type IntegrationBillingState =
  | "Final statement" | "CDR pending" | "CDR mismatch" | "Provenance unlabelled"
  | "Corrected" | "Manual review" | "Period locked" | "Delivery logged"
  | "Delivery failed" | "Draft estimate";

export type IntegrationBillingFixture = {
  id: string;
  driver: string;
  state: IntegrationBillingState;
  sessions: number;
  energyKwh: number | null;
  kwhSource: "Meter delta" | "Per-session evidence held" | "Unlabelled";
  rateVersion: string;
  cdrStatus: "Verified" | "Pending" | "Mismatch" | "Unlabelled" | "Corrected";
  plugTimeGraceMinutes: number;
  adjustmentIsk: number;
  accessBillingStatus: "Counted once" | "Inactive" | "Decision pending";
  deliveryStatus: "Not ready" | "Ready" | "Logged" | "Failed";
};

const states: IntegrationBillingState[] = [
  "Final statement", "CDR pending", "CDR mismatch", "Provenance unlabelled", "Corrected",
  "Manual review", "Period locked", "Delivery logged", "Delivery failed", "Draft estimate",
];

export const integrationBillingVariants: IntegrationBillingFixture[] = Array.from({ length: 80 }, (_, index) => {
  const state = states[index % states.length];
  const held = state === "Manual review";
  const unlabelled = state === "Provenance unlabelled";
  return {
    id: `DEMO-INTEGRATION-${String(index + 1).padStart(2, "0")}`,
    driver: `demo-integration-${String(index + 1).padStart(2, "0")}@north.test`,
    state,
    sessions: 1 + (index % 16),
    energyKwh: held || unlabelled ? null : 14 + ((index * 5) % 91),
    kwhSource: unlabelled ? "Unlabelled" : held ? "Per-session evidence held" : "Meter delta",
    rateVersion: `ISK-2026.${String(7 + (index % 3)).padStart(2, "0")}-${String.fromCharCode(65 + (index % 4))}`,
    cdrStatus: state === "CDR pending" ? "Pending" : state === "CDR mismatch" ? "Mismatch" : unlabelled ? "Unlabelled" : state === "Corrected" ? "Corrected" : "Verified",
    plugTimeGraceMinutes: [0, 180, 240][index % 3],
    adjustmentIsk: state === "Corrected" ? -100 - index : 0,
    accessBillingStatus: index % 11 === 0 ? "Decision pending" : index % 7 === 0 ? "Inactive" : "Counted once",
    deliveryStatus: state === "Delivery logged" ? "Logged" : state === "Delivery failed" ? "Failed" : state === "Final statement" || state === "Period locked" ? "Ready" : "Not ready",
  };
});

type MetricSeed = [string, string, string, Tone?];
type Seed = {
  id: string; label: string; eyebrow: string; title: string; summary: string;
  state: string; tone: Tone; metrics: MetricSeed[]; notice: string; action?: string;
};

const q = (title: string, detail: string, tone: Tone) => ({ title, detail, tone });
const reviewQueue = [
  q("Label CDR provenance", "Mismatch and unlabelled price sources remain held", "bad"),
  q("Verify deployment evidence", "Source implementation is not runtime proof", "warn"),
  q("Keep Driver copy precise", "Estimate, statement and invoice stay separate", "info"),
];

function screen(seed: Seed): VisualScreen {
  return {
    id: seed.id, label: seed.label, eyebrow: seed.eyebrow, title: seed.title, summary: seed.summary,
    state: seed.state, stateTone: seed.tone,
    metrics: seed.metrics.map(([label, value, detail, tone]) => ({ label, value, detail, tone })),
    columns: ["Signal", "Evidence", "Authority", "State", "Next"],
    rows: [
      ["Meter energy", "Per-session delta", "Billing engine + session", "Review", "Preserve source"],
      ["CDR price", "Source label", "CDR calculation", seed.id.includes("cdr") ? "Held" : "Review", "Resolve mismatch"],
      ["Delivery", "Attempt record", "Organisation", seed.id.includes("delivery") ? "Review" : "Not ready", "Verify outcome"],
    ],
    queue: reviewQueue,
    journeyStep: seed.label,
    maturity: seed.action ? "blocked" : "preview",
    tableTitle: `${seed.label} evidence`,
    queueTitle: "Integration checks",
    action: seed.action,
    actionDisabled: Boolean(seed.action),
    notice: seed.notice,
    review: {
      intent: seed.summary,
      real: "The integrated read hierarchy, terminology and disabled-state behavior are reviewable.",
      demo: "All integration, billing, queue, access and delivery values are local demo fixtures.",
      blocked: seed.notice,
      decision: "Approve the contract and runtime evidence before enabling an action or final claim.",
    },
  } as VisualScreen;
}

const adminSeeds: Seed[] = [
  {
    id: "integration-tenant-billing", label: "Tenant billing gate", eyebrow: "Platform read authority", title: "Cross-tenant billing access",
    summary: "Review platform billing visibility while tenant filters, permission and audit remain explicit gates.",
    state: "Read authority pending", tone: "warn",
    metrics: [["Tenant filter", "Required", "Every read"], ["Platform permission", "Unapproved", "Security", "bad"], ["Mutation", "Absent", "Correct"], ["Audit", "Required", "Actor + tenant"]],
    notice: "Cross-tenant reads exist, but this local view does not prove production permission or audit enforcement.",
  },
  {
    id: "integration-heartbeat", label: "Heartbeat fast path", eyebrow: "Cost readiness", title: "Heartbeat fast-path evidence",
    summary: "Credit the source implementation while separating incomplete gateway tests and deployment proof.",
    state: "Source implemented", tone: "warn",
    metrics: [["Fast path", "Exists", "Source", "good"], ["Gateway suite", "Incomplete", "Toolchain", "warn"], ["Deployment", "Unverified", "Runtime", "bad"], ["Queue effect", "Unproven", "Evidence needed"]],
    notice: "Source code is positive evidence, but gateway-suite/toolchain and deployed queue behavior remain unverified.",
  },
  {
    id: "integration-queue-deployment", label: "Queue deployment", eyebrow: "Runtime evidence", title: "Queue deployment evidence",
    summary: "Show the absence of deployment evidence without describing the queue as missing or healthy.",
    state: "Evidence missing", tone: "bad",
    metrics: [["Configuration", "Source present", "Read only"], ["Deployment", "Unverified", "Control plane", "bad"], ["Traffic", "Unknown", "No claim"], ["Cost effect", "Unknown", "Measure later"]],
    notice: "No control-plane or runtime evidence was gathered; queue deployment state remains unknown.",
  },
  {
    id: "integration-offline-sweep", label: "Offline sweep", eyebrow: "Fleet recovery", title: "Offline connector sweep",
    summary: "Represent the missing reconciliation sweep as an operational gap, not a manual UI command.",
    state: "Not built", tone: "bad",
    metrics: [["Scheduled sweep", "Missing", "Backend", "bad"], ["Offline age", "Observable", "Read model"], ["Recovery", "Manual", "Current"], ["UI toggle", "None", "Correct boundary"]],
    notice: "The offline reconciliation sweep is not built; this screen cannot compensate with a client-side action.",
  },
  {
    id: "integration-frame-risk", label: "Frame protection", eyebrow: "Connector isolation", title: "Per-connector frame protection",
    summary: "Keep the absent frame cap visible alongside reconnect and queue risk without inventing protection.",
    state: "Decision pending", tone: "warn",
    metrics: [["Frame cap", "Missing", "Per connector", "bad"], ["Overflow rule", "Undecided", "Protocol"], ["Reconnect", "Load-test", "Required"], ["UI control", "None", "Correct"]],
    notice: "Per-connector frame limits and overflow behavior require backend design and load evidence.",
  },
];

const orgSeeds: Seed[] = [
  {
    id: "integration-driver-management", label: "Driver management", eyebrow: "Organisation authority", title: "Manual driver management gate",
    summary: "Separate roster visibility from add, deactivate and invite authority.",
    state: "Mutations blocked", tone: "bad",
    metrics: [["Roster", "Visible / demo", "Read"], ["Add", "Blocked", "Permission", "bad"], ["Deactivate", "Blocked", "Billing date"], ["Invite", "Blocked", "Identity", "warn"]],
    action: "Add driver manually", notice: "Manual driver-management authority remains unresolved; no request is sent.",
  },
  {
    id: "integration-export-research", label: "Export research", eyebrow: "Icelandic formats", title: "Bank and accounting export research",
    summary: "Distinguish internal statement readiness from researched and validated Icelandic formats.",
    state: "Research pending", tone: "warn",
    metrics: [["Internal material", "Ready / demo", "Statement"], ["Bank format", "Unknown", "Research", "bad"], ["Accounting", "Unknown", "Research"], ["Export", "Blocked", "Safe"]],
    action: "Export bundle", notice: "No Icelandic bank or accounting format is claimed until researched, implemented and validated.",
  },
  {
    id: "integration-cdr-mismatch", label: "CDR mismatches", eyebrow: "Price provenance", title: "CDR mismatch review",
    summary: "Group mismatched and unlabelled price provenance without changing source records.",
    state: "Manual review", tone: "bad",
    metrics: [["Verified", "126", "Demo"], ["Mismatch", "4", "Held", "bad"], ["Unlabelled", "3", "Held", "warn"], ["Corrections", "2", "Additive"]],
    action: "Lock period", notice: "Period lock remains unavailable while CDR price authority is mismatched or unlabelled.",
  },
  {
    id: "integration-period-lock", label: "Period lock", eyebrow: "Billing completeness", title: "Period lock readiness",
    summary: "Explain readiness across meter evidence, CDR authority, corrections and delivery preparation.",
    state: "Blocked by evidence", tone: "warn",
    metrics: [["Meter sessions", "Complete", "Engine delta", "good"], ["CDR mismatches", "4", "Blocker", "bad"], ["Corrections", "2", "Open"], ["Delivery", "Not ready", "After lock"]],
    action: "Lock period", notice: "Lock is blocked until every mismatch, unlabelled row and open correction is resolved.",
  },
  {
    id: "integration-delivery-recovery", label: "Delivery recovery", eyebrow: "Organisation handoff", title: "Delivery failure and recovery",
    summary: "Preserve failed attempt evidence while retry remains idempotency- and provider-gated.",
    state: "Retry blocked", tone: "bad",
    metrics: [["Material", "Retained", "Hash"], ["Attempt", "Failed", "Demo", "bad"], ["Recipient", "Configured / demo", "Not proof"], ["Retry", "Blocked", "Idempotency"]],
    action: "Retry delivery", notice: "Retry remains disabled until provider outcome, recipient and idempotency contracts are implemented.",
  },
];

const driverSeeds: Seed[] = [
  {
    id: "integration-statement-final", label: "Statement vs invoice", eyebrow: "Billing material", title: "Final statement, not invoice",
    summary: "Show verified statement material while explicitly withholding invoice and payment claims.",
    state: "Statement final / demo", tone: "good",
    metrics: [["Energy", "84 kWh", "Meter delta"], ["Rate", "ISK-2026.08-A", "Preserved"], ["Statement", "Final", "Evidence complete", "good"], ["Invoice", "Not issued", "Separate contract"]],
    notice: "Final statement material is not an issued invoice, payment request or paid status.",
  },
  {
    id: "integration-cdr-pending", label: "CDR pending", eyebrow: "Price source", title: "CDR calculation pending",
    summary: "Keep energy visible while authoritative price calculation is pending.",
    state: "Price pending", tone: "warn",
    metrics: [["Energy", "24 kWh", "Meter delta", "good"], ["CDR", "Pending", "Calculation", "warn"], ["Rate", "ISK-2026.08-A", "Candidate"], ["Cost", "Unavailable", "No zero", "bad"]],
    notice: "Energy evidence is available, but cost remains unavailable until the CDR calculation is authoritative.",
  },
  {
    id: "integration-cdr-mismatch-driver", label: "CDR mismatch", eyebrow: "Manual review", title: "Statement line needs review",
    summary: "Explain that two price sources disagree without asking the driver to choose one.",
    state: "Mismatch held", tone: "bad",
    metrics: [["Energy", "31 kWh", "Meter delta"], ["CDR amount", "842 kr", "Candidate"], ["Imported amount", "901 kr", "Mismatch", "bad"], ["Statement", "Held", "Manual review"]],
    notice: "The organisation is reviewing a price mismatch; no final amount or payment is requested.",
  },
  {
    id: "integration-provenance-unlabelled", label: "Source unlabelled", eyebrow: "Authority unknown", title: "Price source is not labelled",
    summary: "Represent a missing provenance label as unavailable authority, not a CDR.",
    state: "Unlabelled", tone: "bad",
    metrics: [["Energy", "18 kWh", "Meter delta"], ["Price", "497 kr", "Demo value"], ["Source", "Unlabelled", "Not CDR authority", "bad"], ["Statement", "Held", "Safe"]],
    notice: "A price without provenance is not labelled CDR-ready and cannot make the statement final.",
  },
  {
    id: "integration-correction", label: "Correction line", eyebrow: "Additive history", title: "Statement correction line",
    summary: "Keep original, correction and revised total visible with reason and actor.",
    state: "Corrected", tone: "info",
    metrics: [["Original", "901 kr", "Retained"], ["Correction", "-59 kr", "ADJ-17", "warn"], ["Revised", "842 kr", "Demo", "good"], ["Reason", "CDR mismatch", "Recorded"]],
    notice: "The correction is additive; original evidence remains visible.",
  },
  {
    id: "integration-manual-review", label: "Manual review", eyebrow: "Session held", title: "Session awaiting manual review",
    summary: "Hold only the affected session while the engine-level meter-delta fix remains credited.",
    state: "Session held", tone: "warn",
    metrics: [["Engine", "Delta fixed", "Current code", "good"], ["Session unit", "Unknown", "Evidence", "warn"], ["Billed kWh", "Unavailable", "No zero", "bad"], ["Other sessions", "Unaffected", "Continue"]],
    notice: "This per-session evidence hold coexists with the current meter-delta billing fix.",
  },
  {
    id: "integration-period-locked", label: "Period locked", eyebrow: "Immutable material", title: "Locked statement period",
    summary: "Show the immutable period and preserved rate version while delivery remains separate.",
    state: "Locked / demo", tone: "good",
    metrics: [["Period", "August 2026", "UTC+0"], ["Rate", "ISK-2026.08-A", "Preserved"], ["Corrections", "Closed", "Additive history"], ["Delivery", "Not yet", "Separate state"]],
    notice: "Locked means statement material is immutable; it does not mean delivered, invoiced or paid.",
  },
  {
    id: "integration-delivery-logged", label: "Delivery logged", eyebrow: "Organisation report", title: "Statement delivery logged",
    summary: "Show delivery on behalf of the organisation without implying receipt or payment.",
    state: "Logged / demo", tone: "good",
    metrics: [["Material", "August statement", "Demo"], ["Delivered by", "Demo North", "Organisation"], ["Outcome", "Provider accepted", "Not receipt"], ["Payment", "Not tracked", "Separate"]],
    notice: "Provider acceptance is not proof that the driver opened, accepted or paid anything.",
  },
  {
    id: "integration-delivery-failed", label: "Delivery failed", eyebrow: "Organisation report", title: "Statement delivery failed",
    summary: "Keep statement access and failure explanation separate from retry behavior.",
    state: "Failed / demo", tone: "bad",
    metrics: [["Statement", "Available", "In app"], ["Delivery", "Failed", "Demo", "bad"], ["Retry", "Organisation action", "Blocked"], ["Payment", "Not tracked", "No inference"]],
    notice: "The statement remains available; delivery retry is an organisation workflow and is not automatic.",
  },
  {
    id: "integration-access-denied", label: "Access denied", eyebrow: "Charging access", title: "Charging access denied",
    summary: "Explain a denied scope without exposing another tenant or suggesting a billing failure.",
    state: "Denied", tone: "bad",
    metrics: [["Identity", "Recognised", "Driver"], ["Organisation", "Not disclosed", "Privacy"], ["Access", "Denied", "Scope", "bad"], ["Billing count", "Not counted", "No enabled access"]],
    notice: "Access denial is separate from statement history and does not reveal another organisation's data.",
  },
  {
    id: "integration-access-offline", label: "Access offline", eyebrow: "Connectivity", title: "Access check unavailable offline",
    summary: "Preserve the last verified access state without promising offline authorisation.",
    state: "Offline", tone: "warn",
    metrics: [["Last verified", "08:42 UTC", "Demo"], ["Current check", "Unavailable", "Offline", "warn"], ["Cached access", "Read only", "Not authorisation"], ["Support", "Available", "Manual path"]],
    notice: "Cached information is not a new authorisation decision; retry when connectivity returns.",
  },
  {
    id: "integration-manual-support", label: "Manual support", eyebrow: "Human assistance", title: "Manual support path",
    summary: "Offer attributed support guidance while driver-management authority remains unresolved.",
    state: "Support available", tone: "info",
    metrics: [["Case", "DEMO-104", "Local"], ["Actor", "Straumvakt staff", "No impersonation"], ["Organisation", "Context only", "Attributed"], ["Mutation", "Unavailable", "Authority blocked"]],
    notice: "Support can explain and coordinate; it cannot silently add, deactivate or impersonate a driver.",
  },
];

export const integrationScreensByPersona: Record<PostLoginRouteId, VisualScreen[]> = {
  admin: adminSeeds.map(screen),
  org: orgSeeds.map(screen),
  driver: driverSeeds.map(screen),
};
