import type { Tone, VisualScreen } from "../visual/visual-data";
import type { PostLoginRouteId } from "./post-login-data";
import { backendContractScreensByPersona } from "./core-backend-contract-data";
import { integrationScreensByPersona } from "./core-integration-quality-data";

export const CORE_CONNECTOR_RATE_ISK = 200;
export const CORE_ACTIVE_DRIVER_RATE_ISK = 50;
export const CORE_CAP_PER_CONNECTOR_ISK = 450;
export const CORE_MARKET = "Iceland only / UTC+0";
export const ACTIVE_CONNECTOR_DEFINITION = "Proposed billing rule: a non-demo connector enabled for operations during the month. Exact day-boundary semantics are backend-gated.";
export const ACTIVE_DRIVER_DEFINITION = "Proposed billing rule: a unique driver with enabled access or at least one CDR in the month, counted once per organisation. Exact close semantics are backend-gated.";

export type CorePrice = {
  connectorChargeIsk: number;
  driverChargeIsk: number;
  uncappedIsk: number;
  capIsk: number;
  totalIsk: number;
  capApplied: boolean;
};

export function calculateCoreMonthlyPrice(activeConnectors: number, activeDrivers: number): CorePrice {
  if (!Number.isInteger(activeConnectors) || !Number.isInteger(activeDrivers) || activeConnectors < 0 || activeDrivers < 0) {
    throw new Error("Core pricing counts must be non-negative integers");
  }
  const connectorChargeIsk = activeConnectors * CORE_CONNECTOR_RATE_ISK;
  const driverChargeIsk = activeDrivers * CORE_ACTIVE_DRIVER_RATE_ISK;
  const uncappedIsk = connectorChargeIsk + driverChargeIsk;
  const capIsk = activeConnectors * CORE_CAP_PER_CONNECTOR_ISK;
  const totalIsk = Math.min(uncappedIsk, capIsk);
  return { connectorChargeIsk, driverChargeIsk, uncappedIsk, capIsk, totalIsk, capApplied: totalIsk < uncappedIsk };
}

export function formatIsk(value: number): string {
  return `${String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ".")} kr`;
}

export type CoreOrganisationFixture = {
  id: string;
  name: string;
  activeConnectors: number;
  activeDrivers: number;
  rateVersion: string;
  billingState: "Open" | "Review" | "Ready" | "Locked";
};

export const coreOrganisations: CoreOrganisationFixture[] = [
  ["CORE-ORG-01", "Demo North Energy", 24, 146, "ISK-2026.08-A", "Review"],
  ["CORE-ORG-02", "Demo Harbour Housing", 18, 52, "ISK-2026.08-B", "Open"],
  ["CORE-ORG-03", "Demo Valley Offices", 32, 88, "ISK-2026.07-C", "Ready"],
  ["CORE-ORG-04", "Demo West MDU", 12, 93, "ISK-2026.08-A", "Review"],
  ["CORE-ORG-05", "Demo Airport Workplaces", 48, 121, "ISK-2026.08-D", "Open"],
  ["CORE-ORG-06", "Demo East Cooperative", 20, 41, "ISK-2026.08-B", "Locked"],
  ["CORE-ORG-07", "Demo Capital Garage", 64, 204, "ISK-2026.08-A", "Ready"],
  ["CORE-ORG-08", "Demo Fjord Homes", 10, 67, "ISK-2026.07-C", "Review"],
  ["CORE-ORG-09", "Demo Campus South", 36, 109, "ISK-2026.08-D", "Open"],
  ["CORE-ORG-10", "Demo Library Quarter", 8, 14, "ISK-2026.08-A", "Locked"],
  ["CORE-ORG-11", "Demo Industrial Park", 42, 74, "ISK-2026.08-B", "Ready"],
  ["CORE-ORG-12", "Demo Coast Apartments", 16, 119, "ISK-2026.07-C", "Review"],
  ["CORE-ORG-13", "Demo Civic Offices", 28, 39, "ISK-2026.08-A", "Open"],
  ["CORE-ORG-14", "Demo Ridge Housing", 14, 58, "ISK-2026.08-D", "Ready"],
  ["CORE-ORG-15", "Demo Logistics North", 52, 97, "ISK-2026.08-B", "Open"],
  ["CORE-ORG-16", "Demo Town Centre", 22, 83, "ISK-2026.08-A", "Locked"],
].map(([id, name, activeConnectors, activeDrivers, rateVersion, billingState]) => ({
  id: String(id), name: String(name), activeConnectors: Number(activeConnectors), activeDrivers: Number(activeDrivers),
  rateVersion: String(rateVersion), billingState: billingState as CoreOrganisationFixture["billingState"],
}));

export type CoreRateFixture = {
  version: string;
  effectiveFrom: string;
  networkRate: string;
  retailerRate: string;
  cpoMargin: string;
  plugTimeFee: string;
  gracePeriod: string;
  state: "Draft" | "Scheduled" | "Effective" | "Superseded";
};

export const coreRateConfigurations: CoreRateFixture[] = [
  ["ISK-2026.08-A", "2026-08-01 00:00 UTC", "8,42 kr/kWh", "17,80 kr/kWh", "2,50 kr/kWh", "1 kr/min", "4 h", "Effective"],
  ["ISK-2026.08-B", "2026-08-01 00:00 UTC", "9,10 kr/kWh", "18,20 kr/kWh", "1,80 kr/kWh", "2 kr/min", "3 h", "Effective"],
  ["ISK-2026.08-C", "2026-08-15 00:00 UTC", "8,42 kr/kWh", "16,95 kr/kWh", "3,00 kr/kWh", "1 kr/min", "4 h", "Scheduled"],
  ["ISK-2026.08-D", "2026-08-01 00:00 UTC", "7,95 kr/kWh", "19,30 kr/kWh", "2,20 kr/kWh", "0 kr/min", "No fee", "Effective"],
  ["ISK-2026.09-A", "2026-09-01 00:00 UTC", "Pending", "Pending", "2,50 kr/kWh", "1 kr/min", "4 h", "Draft"],
  ["ISK-2026.07-A", "2026-07-01 00:00 UTC", "8,05 kr/kWh", "17,25 kr/kWh", "2,50 kr/kWh", "1 kr/min", "4 h", "Superseded"],
  ["ISK-2026.07-B", "2026-07-01 00:00 UTC", "8,60 kr/kWh", "18,00 kr/kWh", "2,00 kr/kWh", "2 kr/min", "3 h", "Superseded"],
  ["ISK-2026.07-C", "2026-07-01 00:00 UTC", "7,80 kr/kWh", "18,70 kr/kWh", "2,20 kr/kWh", "0 kr/min", "No fee", "Superseded"],
].map(([version, effectiveFrom, networkRate, retailerRate, cpoMargin, plugTimeFee, gracePeriod, state]) => ({
  version, effectiveFrom, networkRate, retailerRate, cpoMargin, plugTimeFee, gracePeriod, state,
})) as CoreRateFixture[];

export type CoreBillingPeriodFixture = {
  id: string;
  label: string;
  state: "Open" | "Review" | "Locked" | "Delivered";
  cdrCount: number;
  driverStatements: number;
  totalIsk: number;
  delivery: string;
};

export const coreBillingPeriods: CoreBillingPeriodFixture[] = [
  ["BP-2026-08", "August 2026", "Open", 1842, 146, 684220, "Not sent"],
  ["BP-2026-07", "July 2026", "Delivered", 3918, 139, 1284750, "Delivered 03 Aug"],
  ["BP-2026-06", "June 2026", "Delivered", 3651, 134, 1198420, "Delivered 03 Jul"],
  ["BP-2026-05", "May 2026", "Locked", 3440, 128, 1104960, "Export pending"],
  ["BP-2026-04", "April 2026", "Delivered", 3212, 121, 1038750, "Delivered 02 May"],
  ["BP-2026-03", "March 2026", "Review", 2987, 116, 986340, "Correction open"],
  ["BP-2026-02", "February 2026", "Delivered", 2610, 109, 842180, "Delivered 02 Mar"],
  ["BP-2026-01", "January 2026", "Delivered", 2488, 104, 801920, "Delivered 02 Feb"],
].map(([id, label, state, cdrCount, driverStatements, totalIsk, delivery]) => ({
  id: String(id), label: String(label), state: state as CoreBillingPeriodFixture["state"], cdrCount: Number(cdrCount),
  driverStatements: Number(driverStatements), totalIsk: Number(totalIsk), delivery: String(delivery),
}));

export type DriverStatementVariant = {
  id: string;
  driver: string;
  sessions: number;
  energyKwh: number;
  energyIsk: number;
  plugTimeIsk: number;
  adjustmentIsk: number;
  state: "Draft" | "Ready" | "Corrected" | "Delivered";
};

export const driverStatementVariants: DriverStatementVariant[] = Array.from({ length: 32 }, (_, index) => ({
  id: `DEMO-STMT-${String(index + 1).padStart(2, "0")}`,
  driver: `demo-driver-${String(index + 1).padStart(2, "0")}@north.test`,
  sessions: 2 + (index % 11),
  energyKwh: 18 + ((index * 7) % 86),
  energyIsk: 620 + ((index * 173) % 4100),
  plugTimeIsk: index % 4 === 0 ? 300 + index * 10 : 0,
  adjustmentIsk: index % 9 === 0 ? -150 : 0,
  state: (["Draft", "Ready", "Corrected", "Delivered"] as const)[index % 4],
}));

const q = (title: string, detail: string, tone: Tone) => ({ title, detail, tone });
const baseRows = [
  ["Core", "Iceland", "Local demo", "Read only", "Review"],
  ["Rates", "UTC+0", "Versioned", "Backend gated", "Define"],
  ["Billing", "Monthly", "CDR-backed", "Export unknown", "Verify"],
];
const baseQueue = [
  q("Confirm billing definitions", "Active connector and driver close semantics", "warn"),
  q("Verify Icelandic formats", "Bank and accounting exports remain unknown", "bad"),
  q("Keep Premium separate", "No custom integrations or service workflows", "info"),
];

function coreScreen(value: Partial<VisualScreen> & Pick<VisualScreen, "id" | "label" | "eyebrow" | "title" | "summary" | "state" | "stateTone" | "metrics" | "tableTitle" | "queueTitle">): VisualScreen {
  return {
    columns: ["Area", "Scope", "Source", "State", "Next"], rows: baseRows, queue: baseQueue,
    journeyStep: value.label, maturity: value.actionDisabled ? "blocked" : "preview",
    review: {
      intent: value.summary,
      real: "Layout, hierarchy, terminology and read-only product states are reviewable.",
      demo: "All pricing, rate, CDR, statement and delivery values are local demo fixtures.",
      blocked: value.notice ?? "Persistence, period close, delivery and export contracts are intentionally absent.",
      decision: "Decide whether this Core hierarchy is ready for backend contract design.",
    },
    ...value,
  } as VisualScreen;
}

const demoNorthPrice = calculateCoreMonthlyPrice(24, 146);

export const coreScreensByPersona: Record<PostLoginRouteId, VisualScreen[]> = {
  admin: [
    coreScreen({ id: "core-product", label: "Core product", eyebrow: CORE_MARKET, title: "Core operating model", summary: "The locked AC charging product for Icelandic MDUs and workplaces, with Premium boundaries visible by absence.", state: "Locked frame", stateTone: "good", metrics: [
      { label: "Market", value: "Iceland", detail: "UTC+0", tone: "good" }, { label: "Connector", value: "200 kr", detail: "Active / month" },
      { label: "Driver", value: "50 kr", detail: "Active / month" }, { label: "Cap", value: "450 kr", detail: "Per connector / month", tone: "warn" },
    ], tableTitle: "Core scope", queueTitle: "Product boundaries", notice: "Premium features are intentionally not offered as Core." }),
    coreScreen({ id: "core-pricing", label: "Core pricing", eyebrow: "Platform commercial read", title: "Connector and driver pricing", summary: "Review monthly Core charges and cap exposure across demo organisations without creating invoices.", state: "Demo calculation", stateTone: "info", metrics: [
      { label: "Connector rate", value: "200 kr", detail: "Active connector" }, { label: "Driver rate", value: "50 kr", detail: "Active driver" },
      { label: "Cap", value: "450 kr", detail: "Per active connector", tone: "warn" }, { label: "Demo North", value: formatIsk(demoNorthPrice.totalIsk), detail: "Cap applied", tone: "info" },
    ], columns: ["Organisation", "Connectors", "Drivers", "Uncapped", "Core charge"], rows: coreOrganisations.slice(0, 8).map((org) => {
      const price = calculateCoreMonthlyPrice(org.activeConnectors, org.activeDrivers);
      return [org.name, String(org.activeConnectors), String(org.activeDrivers), formatIsk(price.uncappedIsk), `${formatIsk(price.totalIsk)}${price.capApplied ? " / capped" : ""}`];
    }), tableTitle: "Demo organisation envelope", queueTitle: "Pricing decisions", notice: `${ACTIVE_CONNECTOR_DEFINITION} ${ACTIVE_DRIVER_DEFINITION}` }),
    coreScreen({ id: "standard-telemetry", label: "Standard telemetry", eyebrow: "Core operations", title: "Standard telemetry status", summary: "Show connectivity, transaction freshness and unavailable measurements without promising faster Premium telemetry.", state: "Standard cadence", stateTone: "good", metrics: [
      { label: "Reporting", value: "97,8%", detail: "Demo fleet", tone: "good" }, { label: "Freshness", value: "Standard", detail: "No live-stream claim" },
      { label: "Unavailable", value: "71", detail: "Explicit unknown", tone: "warn" }, { label: "Raw retention", value: "Not Core", detail: "Long retention hidden" },
    ], tableTitle: "Telemetry contract", queueTitle: "Integrity signals", notice: "Faster telemetry, live operations and long raw protocol retention remain Premium/later." }),
    coreScreen({ id: "core-readiness", label: "Core readiness", eyebrow: "Release controls", title: "Core backend readiness", summary: "Separate reviewable product UI from pricing, billing, export and onboarding contracts that do not yet exist.", state: "Blocked contracts", stateTone: "warn", metrics: [
      { label: "UI", value: "Reviewable", detail: "Local fixtures", tone: "good" }, { label: "Pricing", value: "Formula locked", detail: "Counts pending", tone: "warn" },
      { label: "Billing", value: "Material only", detail: "No invoice issue" }, { label: "Export", value: "Unknown", detail: "Iceland research", tone: "bad" },
    ], tableTitle: "Core release gates", queueTitle: "Before wiring", action: "Approve Core release", actionDisabled: true, notice: "No production billing, payment, bank export or invite flow is implied by this screen." }),
    ...backendContractScreensByPersona.admin,
    ...integrationScreensByPersona.admin,
  ],
  org: [
    coreScreen({ id: "core-pricing", label: "Core subscription", eyebrow: CORE_MARKET, title: "Your Core monthly price", summary: "Understand active connector and driver charges, including the high-driver cap, before a billing period closes.", state: "Read only", stateTone: "info", metrics: [
      { label: "Active connectors", value: "24", detail: "Proposed definition" }, { label: "Active drivers", value: "146", detail: "Proposed definition" },
      { label: "Uncapped", value: formatIsk(demoNorthPrice.uncappedIsk), detail: "200 + 50 model" }, { label: "Core charge", value: formatIsk(demoNorthPrice.totalIsk), detail: "Cap applied", tone: "good" },
    ], columns: ["Line", "Quantity", "Rate", "Calculated", "Billing state"], rows: [
      ["Active connectors", "24", "200 kr/month", formatIsk(demoNorthPrice.connectorChargeIsk), "Proposed"],
      ["Active drivers", "146", "50 kr/month", formatIsk(demoNorthPrice.driverChargeIsk), "Proposed"],
      ["Connector cap", "24", "450 kr/month", formatIsk(demoNorthPrice.capIsk), "Applied"],
    ], tableTitle: "August Core calculation", queueTitle: "Count definitions", notice: `${ACTIVE_CONNECTOR_DEFINITION} ${ACTIVE_DRIVER_DEFINITION}` }),
    coreScreen({ id: "rates", label: "Energy rates", eyebrow: "Effective ISK configuration", title: "Rate stack and plug-time policy", summary: "Review DSO, retailer, CPO and plug-time components as one versioned effective rate without changing it.", state: "ISK-2026.08-A", stateTone: "good", metrics: [
      { label: "DSO / network", value: "8,42 kr/kWh", detail: "Demo rate" }, { label: "Retailer", value: "17,80 kr/kWh", detail: "Demo rate" },
      { label: "CPO add-on", value: "2,50 kr/kWh", detail: "Demo margin" }, { label: "Plug time", value: "1 kr/min", detail: "After 4 h", tone: "warn" },
    ], columns: ["Component", "Value", "Owner", "Effective", "Rule"], rows: [
      ["DSO / network", "8,42 kr/kWh", "Demo DSO", "01 Aug 00:00 UTC", "Metered energy"],
      ["Electricity retailer", "17,80 kr/kWh", "Demo Retailer", "01 Aug 00:00 UTC", "Metered energy"],
      ["CPO add-on", "2,50 kr/kWh", "Demo North", "01 Aug 00:00 UTC", "Metered energy"],
      ["Plug-time fee", "1 kr/min", "Demo North", "After 4 h", "Connected time"],
      ["Settlement rule", "Pending", "Contract needed", "Unknown", "Backend gated"],
    ], tableTitle: "Effective rate version", queueTitle: "Rate controls", action: "Create rate version", actionDisabled: true, notice: "Exact Icelandic rate sources, settlement rules and effective-date persistence require backend and market research." }),
    coreScreen({ id: "billing-material", label: "Billing material", eyebrow: "August 2026 / open", title: "Organisation billing bundle", summary: "Inspect CDR-backed statements, rate components and adjustments before a monthly period can be locked.", state: "Open period", stateTone: "warn", metrics: [
      { label: "CDRs", value: "1.842", detail: "Demo records" }, { label: "Driver statements", value: "146", detail: "32 variants sampled" },
      { label: "Bundle total", value: "684.220 kr", detail: "Demo / provisional", tone: "warn" }, { label: "Corrections", value: "1", detail: "Open note", tone: "bad" },
    ], columns: ["Line", "Source", "Amount", "State", "Owner"], rows: [
      ["DSO / network", "CDR energy", "184.640 kr", "Provisional", "Demo DSO"],
      ["Electricity retailer", "CDR energy", "390.110 kr", "Provisional", "Demo Retailer"],
      ["CPO add-on", "CDR energy", "54.790 kr", "Provisional", "Demo North"],
      ["Plug-time fees", "Connected time", "32.180 kr", "Provisional", "Demo North"],
      ["Correction ADJ-04", "Operator note", "-2.500 kr", "Review", "Billing admin"],
    ], tableTitle: "Bundle line items", queueTitle: "Period close", action: "Lock billing period", actionDisabled: true, notice: "This is billing material, not an issued invoice or payment instruction." }),
    coreScreen({ id: "delivery-log", label: "Delivery log", eyebrow: "Organisation handoff", title: "Billing delivery log", summary: "Track visual email/export outcomes and correction history without claiming a supported bank format.", state: "Demo log", stateTone: "info", metrics: [
      { label: "Delivered", value: "5", detail: "Demo periods", tone: "good" }, { label: "Pending", value: "1", detail: "Format unknown", tone: "warn" },
      { label: "Resends", value: "2", detail: "Decision placeholder" }, { label: "Bank format", value: "Unknown", detail: "Research gated", tone: "bad" },
    ], columns: ["Period", "Material", "Channel", "State", "When"], rows: coreBillingPeriods.slice(0, 6).map((period) => [period.label, `${period.driverStatements} statements`, "Email / export TBD", period.delivery, period.state]), tableTitle: "Delivery history", queueTitle: "Delivery decisions", action: "Resend bundle", actionDisabled: true, notice: "No bank integration, payment rail or supported Icelandic export format is claimed." }),
    coreScreen({ id: "monthly-reporting", label: "Monthly reporting", eyebrow: "Core reports", title: "Monthly operations report", summary: "Combine connectors, drivers, energy, sessions and billing-material status at standard Core cadence.", state: "Report ready", stateTone: "good", metrics: [
      { label: "Connectors", value: "24", detail: "Active / proposed" }, { label: "Drivers", value: "146", detail: "Active / proposed" },
      { label: "Energy", value: "21,9 MWh", detail: "CDR-backed" }, { label: "Billing", value: "Open", detail: "Not invoice" },
    ], tableTitle: "Monthly Core measures", queueTitle: "Report caveats", action: "Export report", actionDisabled: true, notice: "Supported Icelandic report and accounting formats remain unknown." }),
    coreScreen({ id: "access-groups", label: "Access groups", eyebrow: "Manual Core operations", title: "Drivers and access groups", summary: "Manage active and inactive driver concepts, group scope and safe invite-link gating without self-service onboarding.", state: "Manual workflow", stateTone: "info", metrics: [
      { label: "Active drivers", value: "146", detail: "Billing count" }, { label: "Inactive", value: "11", detail: "Not billed" },
      { label: "Access groups", value: "4", detail: "Organisation scope" }, { label: "Invite link", value: "Unavailable", detail: "Safety gate", tone: "warn" },
    ], columns: ["Group", "Drivers", "Installations", "State", "Invite"], rows: [
      ["Residents", "112 active / 8 inactive", "Housing A + B", "Operating", "Disabled"],
      ["Workplace", "26 active / 2 inactive", "Main office", "Operating", "Disabled"],
      ["Fleet", "8 active / 1 inactive", "Warehouse", "Operating", "Disabled"],
      ["Temporary", "0 active", "None", "Draft", "Disabled"],
    ], tableTitle: "Access-group register", queueTitle: "Driver actions", action: "Add driver manually", actionDisabled: true, notice: "Invite-by-link stays disabled until an identity-bound backend path is proven safe." }),
    ...backendContractScreensByPersona.org,
    ...integrationScreensByPersona.org,
  ],
  driver: [
    coreScreen({ id: "monthly-statement", label: "Monthly statement", eyebrow: "August 2026 / draft", title: "Your charging statement", summary: "Review CDR-backed sessions and cost ownership without presenting a payment or final invoice state.", state: "Draft material", stateTone: "warn", metrics: [
      { label: "Sessions", value: "12", detail: "CDR-backed" }, { label: "Energy", value: "184 kWh", detail: "Delivered" },
      { label: "Statement total", value: "5.842 kr", detail: "Demo / provisional", tone: "warn" }, { label: "Payment", value: "Not available", detail: "No live payment" },
    ], columns: ["Session", "Energy", "Energy cost", "Plug time", "State"], rows: [
      ["08 Aug / Main office 02", "18,4 kWh", "497 kr", "0 kr", "CDR ready"],
      ["07 Aug / Warehouse 01", "42,8 kWh", "2.184 kr", "300 kr", "CDR ready"],
      ["05 Aug / Main office 01", "12,1 kWh", "327 kr", "0 kr", "CDR ready"],
      ["Adjustment ADJ-04", "-", "-150 kr", "0 kr", "Correction note"],
    ], tableTitle: "Statement line items", queueTitle: "Statement trust", action: "Download statement", actionDisabled: true, notice: "This is report-ready billing material, not a bank claim, payment request or issued invoice." }),
    coreScreen({ id: "cost-trust", label: "Cost breakdown", eyebrow: "Rate version ISK-2026.08-A", title: "How your charging cost is built", summary: "Separate network, retailer, CPO and plug-time owners with the rate version used for each session.", state: "Read only", stateTone: "good", metrics: [
      { label: "DSO / network", value: "8,42 kr/kWh", detail: "Demo owner" }, { label: "Retailer", value: "17,80 kr/kWh", detail: "Demo owner" },
      { label: "CPO add-on", value: "2,50 kr/kWh", detail: "Demo North" }, { label: "Plug time", value: "After 4 h", detail: "1 kr/min", tone: "warn" },
    ], columns: ["Cost owner", "Rate", "Session amount", "Effective", "Evidence"], rows: [
      ["Demo DSO", "8,42 kr/kWh", "155 kr", "01 Aug UTC", "CDR energy"],
      ["Demo Retailer", "17,80 kr/kWh", "328 kr", "01 Aug UTC", "CDR energy"],
      ["Demo North", "2,50 kr/kWh", "46 kr", "01 Aug UTC", "CDR energy"],
      ["Demo North / plug time", "1 kr/min after 4 h", "0 kr", "01 Aug UTC", "Connected time"],
    ], tableTitle: "Session cost ownership", queueTitle: "Cost evidence", notice: "An active-session estimate can change; only closed CDR-backed material belongs in a monthly statement." }),
    coreScreen({ id: "report-ready", label: "Report-ready state", eyebrow: "Driver records", title: "Report and invoice distinction", summary: "Make draft, report-ready, corrected and delivered states understandable without fake payment or raw telemetry livestreams.", state: "Report ready", stateTone: "info", metrics: [
      { label: "Draft", value: "Estimate", detail: "Can change" }, { label: "Report ready", value: "CDR closed", detail: "Reviewable", tone: "good" },
      { label: "Invoice", value: "Not issued", detail: "No contract" }, { label: "Payment", value: "Unavailable", detail: "Not Core UI" },
    ], tableTitle: "Statement lifecycle", queueTitle: "Driver explanations", notice: "No raw telemetry livestream, card payment, bank payment or final invoice is represented." }),
    ...backendContractScreensByPersona.driver,
    ...integrationScreensByPersona.driver,
  ],
};

export type CoreDetail = { eyebrow: string; title: string; summary: string; items: { label: string; value: string; detail: string; tone?: Tone }[] };

export function getCoreDetail(routeId: PostLoginRouteId, screenId: string): CoreDetail | undefined {
  const screen = coreScreensByPersona[routeId].find((item) => item.id === screenId);
  if (!screen) return undefined;
  return {
    eyebrow: routeId === "driver" ? "Cost trust" : routeId === "org" ? "Core commercial model" : "Locked Core frame",
    title: screen.title,
    summary: screen.review.demo,
    items: screen.metrics.map((metric) => ({ label: metric.label, value: metric.value, detail: metric.detail, tone: metric.tone })),
  };
}
