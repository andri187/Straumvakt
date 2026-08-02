"use client";

// ⚠️ DEV-ONLY VISUAL CANVAS — NOT a production data path.
//
// Renders <InvoiceDocument> with representative data so the invoice's
// visual structure can be iterated on locally via `next dev` without
// login or the driver API. The numbers below are illustrative only
// (Dalvegur / N1 pilot shape: Veitur distribution + N1 electricity).
//
// Remove or gate this route before pushing to straumvakt.org — the real
// invoice is rendered by /driver/cost from /api/driver/invoices (Rule 6:
// no mock data in production paths). This file exists purely as a design
// scaffold while the API binding is built out.

import {
  InvoiceDocument,
  type InvoiceModel,
} from "../driver/cost/invoice-document";

// Representative period: maí 2026. Two per-kWh energy factors (paid to the
// host) + a flat monthly Þjónustugjald (Straumvakt service fee, terms from
// the Straumvakt↔host contract). Amounts are ex-VAT aurar.
const ENERGY_KWH = 30.0;
const DSO_EX_VAT = Math.round(ENERGY_KWH * 864); // Veitur AD1, 8.64 kr/kWh
const RETAILER_EX_VAT = Math.round(ENERGY_KWH * 883); // N1 REPF, 8.83 kr/kWh
const SERVICE_EX_VAT = 49000; // 490,00 kr/mán — PLACEHOLDER monthly Þjónustugjald
const SUBTOTAL = DSO_EX_VAT + RETAILER_EX_VAT + SERVICE_EX_VAT;
const VAT = Math.round(SUBTOTAL * 0.24);
const TOTAL = SUBTOTAL + VAT;

const PREVIEW_MODEL: InvoiceModel = {
  invoiceNo: "STR-202605-0042",
  monthKey: "2026-05",
  issueDate: new Date(Date.UTC(2026, 5, 1)),
  dueDate: new Date(Date.UTC(2026, 5, 15)),
  finalDate: new Date(Date.UTC(2026, 5, 29)),
  claimNo: "05260042",
  // Kröfuhafi = the charger host (N1), NOT Straumvakt. Straumvakt only
  // collects on the host's behalf (ADR 0031 — direct driver→host flow).
  hostName: "N1 hf",
  hostKennitala: "490169-1219",
  payerName: "Ökumaður N1",
  payerEmail: "driver@n1.is",
  servicePlace: "Dalvegur 10–14",
  vatRatePct: 24,
  factors: [
    {
      // Driver-facing: the host is the provider of record (kröfuhafi). The
      // fact that this fee settles to Straumvakt (toStraumvakt) is internal
      // — the driver never sees Straumvakt on the line.
      key: "service",
      label: "Þjónustugjald",
      supplier: "N1",
      quantityLabel: "1 mánuður",
      unitPriceLabel: null,
      amountExVatMinor: SERVICE_EX_VAT,
      toStraumvakt: true,
    },
    {
      key: "dso",
      label: "Dreifing",
      supplier: "Veitur",
      quantityLabel: "30,0 kWh",
      unitPriceLabel: "8,64 kr./kWh",
      amountExVatMinor: DSO_EX_VAT,
    },
    {
      key: "retailer",
      label: "Rafmagn",
      supplier: "N1",
      quantityLabel: "30,0 kWh",
      unitPriceLabel: "8,83 kr./kWh",
      amountExVatMinor: RETAILER_EX_VAT,
    },
  ],
  subtotalExVatMinor: SUBTOTAL,
  vatMinor: VAT,
  totalIncVatMinor: TOTAL,
  sessions: [
    {
      sessionId: "s1",
      startedAt: "2026-05-03T18:22:00Z",
      chargerName: "ZPR074002",
      siteName: "Dalvegur",
      energyKwh: 12.4,
      costIncVatMinor: Math.round(12.4 * 1747 * 1.24),
    },
    {
      sessionId: "s2",
      startedAt: "2026-05-11T07:05:00Z",
      chargerName: "ZPR074002",
      siteName: "Dalvegur",
      energyKwh: 9.1,
      costIncVatMinor: Math.round(9.1 * 1747 * 1.24),
    },
    {
      sessionId: "s3",
      startedAt: "2026-05-24T21:40:00Z",
      chargerName: "ZPR074002",
      siteName: "Dalvegur",
      energyKwh: 8.5,
      costIncVatMinor: Math.round(8.5 * 1747 * 1.24),
    },
  ],
};

export default function InvoicePreview() {
  return (
    <div
      style={{
        minHeight: "100vh",
        background: "rgba(2,6,16,.92)",
        padding: 24,
        display: "grid",
        placeItems: "start center",
      }}
    >
      <div style={{ width: "min(680px,96vw)" }}>
        <div style={{ color: "#7fe9c8", fontSize: 12, marginBottom: 10, fontWeight: 700 }}>
          DEV PREVIEW · /invoice-preview · representative data only
        </div>
        <InvoiceDocument model={PREVIEW_MODEL} />
      </div>
    </div>
  );
}
