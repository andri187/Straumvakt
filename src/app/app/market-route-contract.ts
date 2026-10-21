import type { VisualScreen } from "../visual/visual-data";
import type { PostLoginRouteId } from "./post-login-types";

export type MarketClassification = "core" | "readiness" | "evidence" | "future";
export type MarketHonestyRisk =
  | "money"
  | "telemetry"
  | "identity-access"
  | "delivery"
  | "runtime-proof"
  | "general";

export type MarketRouteContract = {
  route: string;
  persona: PostLoginRouteId;
  workflow: string;
  classification: MarketClassification;
  classificationLabel: string;
  dataTruth: "local-fixture";
  dataTruthLabel: "Local fixture";
  interaction: "read-only" | "visual-action-disabled";
  interactionLabel: "Read only" | "Action unavailable";
  backendDependency: string;
  honestyRisk: MarketHonestyRisk;
  honestyRiskLabel: string;
  honestyNote: string;
};

const futureIds = new Set(["compliance-later", "installation"]);
const readinessIds = new Set([
  "support",
  "risks",
  "activity",
  "readiness",
  "core-readiness",
  "billing-trust",
  "pricing-readiness",
  "driver-authority",
  "export-readiness",
]);

const classificationLabels: Record<MarketClassification, string> = {
  core: "Core",
  readiness: "Core readiness",
  evidence: "Review evidence",
  future: "Future decision",
};

const riskCopy: Record<MarketHonestyRisk, { label: string; note: string }> = {
  money: {
    label: "Money is illustrative",
    note: "Do not read fixture amounts, statements or rates as final charges, invoices or payment status.",
  },
  telemetry: {
    label: "Measurement provenance",
    note: "Do not read unavailable, stale or fixture telemetry as a live charger measurement.",
  },
  "identity-access": {
    label: "Authority is not proven",
    note: "Visible people, groups and access states do not prove a safe identity-bound mutation path.",
  },
  delivery: {
    label: "Delivery is not settlement",
    note: "A fixture delivery state does not prove receipt, invoice issue, bank export or payment.",
  },
  "runtime-proof": {
    label: "Source is not runtime proof",
    note: "A source-shaped evidence screen does not prove deployment, capacity or control-plane state.",
  },
  general: {
    label: "Fixture boundary",
    note: "Review the information hierarchy only; no live tenant state or successful mutation is claimed.",
  },
};

function classify(screen: VisualScreen): MarketClassification {
  if (screen.id.startsWith("integration-")) return "evidence";
  if (futureIds.has(screen.id)) return "future";
  if (readinessIds.has(screen.id)) return "readiness";
  return "core";
}

function riskFor(
  screen: VisualScreen,
  classification: MarketClassification,
): MarketHonestyRisk {
  if (classification === "evidence") return "runtime-proof";
  const text = JSON.stringify(screen);
  if (/delivery|export|invoice|payment|bank|accounting/i.test(text))
    return "delivery";
  if (/driver|invite|access|identity|membership|group|onboarding/i.test(text))
    return "identity-access";
  if (/\bkr\b|cost|price|pricing|rate|tariff|billing|statement/i.test(text))
    return "money";
  if (/telemetry|power|heartbeat|online|offline|charging|session/i.test(text))
    return "telemetry";
  return "general";
}

export function getMarketRouteContract(
  persona: PostLoginRouteId,
  screen: VisualScreen,
  workflow: string,
): MarketRouteContract {
  const classification = classify(screen);
  const honestyRisk = riskFor(screen, classification);
  const risk = riskCopy[honestyRisk];
  const hasVisualAction = Boolean(screen.action);

  return {
    route: `/app/${persona}/${screen.id}`,
    persona,
    workflow,
    classification,
    classificationLabel: classificationLabels[classification],
    dataTruth: "local-fixture",
    dataTruthLabel: "Local fixture",
    interaction: hasVisualAction ? "visual-action-disabled" : "read-only",
    interactionLabel: hasVisualAction ? "Action unavailable" : "Read only",
    backendDependency: hasVisualAction
      ? "Permission, validation, persistence, audit and failure contracts"
      : classification === "evidence"
        ? "Runtime evidence before any readiness claim"
        : "Read model contract before live data",
    honestyRisk,
    honestyRiskLabel: risk.label,
    honestyNote: risk.note,
  };
}
