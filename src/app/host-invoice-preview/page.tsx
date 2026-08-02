"use client";

// ⚠️ DEV-ONLY VISUAL CANVAS — NOT a production data path.
//
// Renders <HostInvoiceDocument> (Straumvakt → Host service-fee invoice)
// with representative data so its visual structure can be iterated on
// locally via `next dev`. All three ADR-0031 fee bases are shown together
// on purpose ("all of the above while we dev") — in production the
// Straumvakt↔host contract selects which apply.
//
// Remove or gate before pushing to straumvakt.org (Rule 6).

import {
  HostInvoiceDocument,
  type HostInvoiceModel,
  type HostDriverRow,
} from "../host/billing/host-invoice-document";
import type {
  InvoiceModel,
  InvoiceSessionRow,
} from "../driver/cost/invoice-document";

const ENERGY_RATE_EX_VAT = 1747; // aurar/kWh (Veitur 8,64 + N1 8,83)
const SERVICE_FEE_EX_VAT = 49000; // 490,00 kr/mán per driver — PLACEHOLDER

// Synthesize the driver's individual sessions splitting the period energy
// (deterministic — no Math.random, so SSR and client agree).
function buildSessions(invoiceNo: string, count: number, energyKwh: number): InvoiceSessionRow[] {
  const rows: InvoiceSessionRow[] = [];
  let remaining = Math.round(energyKwh * 10);
  for (let i = 0; i < count; i++) {
    const e =
      i === count - 1 ? remaining / 10 : Math.round((energyKwh / count) * 10) / 10;
    remaining = Math.round(remaining - e * 10);
    const day = String(Math.min(28, 2 + i)).padStart(2, "0");
    rows.push({
      sessionId: `${invoiceNo}-s${i + 1}`,
      startedAt: `2026-05-${day}T18:00:00Z`,
      chargerName: "ZPR074002",
      siteName: "Dalvegur",
      energyKwh: e,
      costIncVatMinor: Math.round(e * ENERGY_RATE_EX_VAT * 1.24),
    });
  }
  return rows;
}

// The driver-facing invoice for one driver (what the host drills into).
function buildDriverInvoice(
  name: string,
  email: string,
  invoiceNo: string,
  sessions: number,
  energyKwh: number,
): InvoiceModel {
  const dso = Math.round(energyKwh * 864);
  const retailer = Math.round(energyKwh * 883);
  const subtotal = dso + retailer + SERVICE_FEE_EX_VAT;
  const vat = Math.round(subtotal * 0.24);
  const kwhLabel = `${energyKwh.toLocaleString("is-IS")} kWh`;
  return {
    invoiceNo,
    monthKey: "2026-05",
    issueDate: new Date(Date.UTC(2026, 5, 1)),
    dueDate: new Date(Date.UTC(2026, 5, 15)),
    finalDate: new Date(Date.UTC(2026, 5, 29)),
    claimNo: `05${invoiceNo.replace(/[^0-9]/g, "").slice(-4)}`,
    hostName: "N1 hf",
    hostKennitala: "490169-1219",
    payerName: name,
    payerEmail: email,
    servicePlace: "Dalvegur 10 - 14",
    vatRatePct: 24,
    factors: [
      {
        key: "service",
        label: "Þjónustugjald",
        supplier: "N1",
        quantityLabel: "1 mánuður",
        unitPriceLabel: null,
        amountExVatMinor: SERVICE_FEE_EX_VAT,
        toStraumvakt: true,
      },
      {
        key: "dso",
        label: "Dreifing",
        supplier: "Veitur",
        quantityLabel: kwhLabel,
        unitPriceLabel: "8,64 kr./kWh",
        amountExVatMinor: dso,
      },
      {
        key: "retailer",
        label: "Rafmagn",
        supplier: "N1",
        quantityLabel: kwhLabel,
        unitPriceLabel: "8,83 kr./kWh",
        amountExVatMinor: retailer,
      },
    ],
    subtotalExVatMinor: subtotal,
    vatMinor: vat,
    totalIncVatMinor: subtotal + vat,
    sessions: buildSessions(invoiceNo, sessions, energyKwh),
  };
}

function drv(
  driverName: string,
  driverEmail: string,
  invoiceNo: string,
  sessions: number,
  energyKwh: number,
): HostDriverRow {
  const driverTotalIncVatMinor = Math.round(
    (energyKwh * ENERGY_RATE_EX_VAT + SERVICE_FEE_EX_VAT) * 1.24,
  );
  return {
    driverName,
    driverEmail,
    invoiceNo,
    sessions,
    energyKwh,
    driverTotalIncVatMinor,
    serviceFeeExVatMinor: SERVICE_FEE_EX_VAT,
    driverInvoice: buildDriverInvoice(driverName, driverEmail, invoiceNo, sessions, energyKwh),
  };
}

const DRIVERS = [
  drv("N1 Drivers", "driver@n1.is", "STR-202605-0042", 5, 19.3),
  drv("Jón Jónsson", "jon@example.is", "STR-202605-0043", 8, 142.0),
  drv("Anna Sóley", "anna@example.is", "STR-202605-0044", 12, 220.5),
  drv("Bílaleiga Ø ehf", "fleet@example.is", "STR-202605-0045", 30, 610.2),
  drv("Guðrún Ósk", "gudrun@example.is", "STR-202605-0046", 4, 51.8),
];

const TOTAL_ENERGY_KWH = DRIVERS.reduce((s, d) => s + d.energyKwh, 0);
const ENERGY_REVENUE_EX_VAT = Math.round(TOTAL_ENERGY_KWH * ENERGY_RATE_EX_VAT);
const PER_DRIVER_TOTAL = DRIVERS.length * SERVICE_FEE_EX_VAT;
const SUBSCRIPTION = 990000; // 9.900 kr/mán — PLACEHOLDER
const ENERGY_PCT = 0.035; // 3,5% — PLACEHOLDER
const ENERGY_PCT_AMOUNT = Math.round(ENERGY_REVENUE_EX_VAT * ENERGY_PCT);

const SUBTOTAL = SUBSCRIPTION + PER_DRIVER_TOTAL + ENERGY_PCT_AMOUNT;
const VAT = Math.round(SUBTOTAL * 0.24);
const TOTAL = SUBTOTAL + VAT;

const PREVIEW_MODEL: HostInvoiceModel = {
  invoiceNo: "STR-H-202605-0007",
  monthKey: "2026-05",
  issueDate: new Date(Date.UTC(2026, 5, 1)),
  dueDate: new Date(Date.UTC(2026, 5, 15)),
  finalDate: new Date(Date.UTC(2026, 5, 29)),
  claimNo: "H05260007",
  hostName: "N1 hf",
  hostKennitala: "490169-1219",
  // A host can have several installations — name each covered by this invoice.
  installations: [
    { name: "Dalvegur 10 - 14", detail: "4 ökumenn" },
    { name: "Klettagarðar 19", detail: "1 ökumaður" },
  ],
  vatRatePct: 24,
  feeLines: [
    {
      key: "subscription",
      label: "Grunnáskrift",
      basis: "subscription",
      unitPriceLabel: "9.900 kr.",
      quantityLabel: "1 stk",
      amountExVatMinor: SUBSCRIPTION,
    },
    {
      key: "per_driver",
      label: "Þjónustugjald ökumanna",
      basis: "per_driver",
      unitPriceLabel: "490 kr.",
      quantityLabel: `${DRIVERS.length} stk`,
      amountExVatMinor: PER_DRIVER_TOTAL,
    },
    {
      key: "energy_pct",
      label: "Hlutdeild í orkusölu",
      basis: "energy_pct",
      unitPriceLabel: "3,5%",
      quantityLabel: `${(ENERGY_REVENUE_EX_VAT / 100).toLocaleString("is-IS")} kr.`,
      amountExVatMinor: ENERGY_PCT_AMOUNT,
    },
  ],
  subtotalExVatMinor: SUBTOTAL,
  vatMinor: VAT,
  totalIncVatMinor: TOTAL,
  drivers: DRIVERS,
};

export default function HostInvoicePreview() {
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
      <div style={{ width: "min(760px,96vw)" }}>
        <div style={{ color: "#7fe9c8", fontSize: 12, marginBottom: 10, fontWeight: 700 }}>
          DEV PREVIEW · /host-invoice-preview · Straumvakt → Host · representative data only
        </div>
        <HostInvoiceDocument model={PREVIEW_MODEL} />
      </div>
    </div>
  );
}
