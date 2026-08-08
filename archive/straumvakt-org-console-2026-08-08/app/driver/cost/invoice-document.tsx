"use client";

// Invoice (Icelandic reikningur / greiðsluseðill) — presentational only.
//
// Layout per operator request (2026-06-14):
//   1. SAMANTEKT (summary) FIRST — the month total broken into one line
//      per cost factor as defined by the driver's contract with the host
//      (e.g. Dreifing/Veitur + Rafmagn/N1), then ex-VAT subtotal, VSK,
//      and the gross Samtals.
//   2. SUNDURLIÐUN (session breakdown) BELOW the summary.
//
// This component is pure: it renders whatever InvoiceModel it's given and
// does no data access. The real model is built from /api/driver/invoices
// (the cost-factor lines come from the same tariff-chain engine that
// prices each session — see apps/api/src/lib/tariff/*). The /invoice-preview
// route feeds it representative data for local visual iteration.

import type { CSSProperties } from "react";

// ── Money + date formatting ──────────────────────────────────────────

export const kr = (minor: number) =>
  `${(minor / 100).toLocaleString("is-IS", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} kr.`;

const MONTHS = [
  "janúar", "febrúar", "mars", "apríl", "maí", "júní",
  "júlí", "ágúst", "september", "október", "nóvember", "desember",
];
export function monthLabel(key: string): string {
  const [y, m] = key.split("-");
  return `${MONTHS[Number(m) - 1] ?? m} ${y}`;
}
function fmtDayDots(iso: string): string {
  return iso.slice(0, 10).split("-").reverse().join(".");
}

// ── Model ─────────────────────────────────────────────────────────────

/** One line in the summary as it applies to the driver. Two origins:
 *   • energy cost factors the tariff engine resolves (DSO distribution,
 *     retailer electricity) — paid to the HOST;
 *   • the monthly Þjónustugjald (Straumvakt service fee, terms from the
 *     Straumvakt↔host contract) — paid to STRAUMVAKT.
 *  Amounts are ex-VAT aurar (1/100 króna), summed across the period. */
export interface InvoiceFactorLine {
  /** Stable key for React + ordering: "dso" | "retailer" | "service" | "other". */
  key: string;
  /** Icelandic category label, e.g. "Dreifing", "Rafmagn", "Þjónustugjald". */
  label: string;
  /** The provider the driver ultimately pays for this line (Veitur, N1, Straumvakt). */
  supplier: string | null;
  /** Display quantity, e.g. "30,0 kWh" or "1 mánuður"; null → "—". */
  quantityLabel: string | null;
  /** Display unit price, e.g. "8,64 kr./kWh"; null → "—" (flat fees). */
  unitPriceLabel: string | null;
  /** Ex-VAT amount in aurar for the whole period. */
  amountExVatMinor: number;
  /** True for the Straumvakt service fee — recipient is Straumvakt, not
   *  the host. Drives the "(til Straumvakt)" hint so the split is explicit. */
  toStraumvakt?: boolean;
}

export interface InvoiceSessionRow {
  sessionId: string;
  startedAt: string;
  chargerName: string | null;
  siteName: string | null;
  energyKwh: number;
  /** Gross (inc-VAT) amount in aurar; null when never costed. */
  costIncVatMinor: number | null;
}

export interface InvoiceModel {
  invoiceNo: string;
  /** "YYYY-MM" — drives the period label + issue date. */
  monthKey: string;
  issueDate: Date;
  dueDate: Date;
  finalDate: Date;
  claimNo: string;
  /** Kröfuhafi — the charger HOST (e.g. N1). Per ADR 0031 the money flows
   *  driver → host directly; Straumvakt only issues/collects on the host's
   *  behalf as agent and bills the host separately for its service fee. */
  hostName: string;
  hostKennitala: string | null;
  payerName: string;
  payerEmail: string | null;
  /** Service location(s) — installation/site names, comma-joined. */
  servicePlace: string | null;
  vatRatePct: number;
  factors: InvoiceFactorLine[];
  subtotalExVatMinor: number;
  vatMinor: number;
  totalIncVatMinor: number;
  sessions: InvoiceSessionRow[];
}

// ── Theme ─────────────────────────────────────────────────────────────

export const INK = "#0b1220";
export const MUTE = "#5a6678";
export const LINE = "#e5e9f0";

export function fmtDate(d: Date): string {
  return `${String(d.getUTCDate()).padStart(2, "0")}.${String(d.getUTCMonth() + 1).padStart(2, "0")}.${d.getUTCFullYear()}`;
}

export function Field({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <div style={{ fontSize: 10, letterSpacing: ".08em", textTransform: "uppercase", color: MUTE }}>{k}</div>
      <div style={{ fontWeight: 600, marginTop: 2 }}>{v}</div>
    </div>
  );
}

export function TotalRow({
  k,
  v,
  strong,
  muted,
}: {
  k: string;
  v: string;
  strong?: boolean;
  muted?: boolean;
}) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        padding: "3px 0",
        fontWeight: strong ? 800 : 500,
        fontSize: strong ? 16 : 13,
      }}
    >
      <span style={{ color: strong ? INK : muted ? MUTE : INK }}>{k}</span>
      <span style={{ color: strong ? INK : muted ? MUTE : INK }}>{v}</span>
    </div>
  );
}

// ── Document ──────────────────────────────────────────────────────────

export function InvoiceDocument({ model }: { model: InvoiceModel }) {
  const th: CSSProperties = {
    textAlign: "left",
    padding: "7px 8px",
    fontSize: 10,
    letterSpacing: ".06em",
    textTransform: "uppercase",
    color: MUTE,
    borderBottom: `2px solid ${INK}`,
  };
  const thr: CSSProperties = { ...th, textAlign: "right" };
  const td: CSSProperties = { padding: "8px", borderBottom: `1px solid ${LINE}` };
  const tdr: CSSProperties = { ...td, textAlign: "right", whiteSpace: "nowrap" };

  // The session breakdown is a detail of the ENERGY charges only — the
  // monthly Þjónustugjald is not a per-session cost, so its total row
  // sums the sessions themselves (not the grand total above).
  const sessionEnergyKwh = model.sessions.reduce((s, h) => s + h.energyKwh, 0);
  const sessionEnergyMinor = model.sessions.reduce((s, h) => s + (h.costIncVatMinor ?? 0), 0);

  return (
    <div
      style={{
        background: "#fff",
        color: INK,
        borderRadius: 12,
        overflow: "hidden",
        boxShadow: "0 30px 80px rgba(0,0,0,.5)",
        fontSize: 13,
        lineHeight: 1.5,
      }}
    >
      <div style={{ height: 6, background: "linear-gradient(135deg,#3ee9a7,#2bd3c9 55%,#2bb6e8)" }} />
      <div style={{ padding: "22px 26px" }}>
        {/* Header — the invoice is the HOST's; Straumvakt issues it as agent. */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16 }}>
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: 9,
                background: "linear-gradient(135deg,#3ee9a7,#2bd3c9 55%,#2bb6e8)",
                display: "grid",
                placeItems: "center",
                color: "#04121b",
                fontWeight: 900,
              }}
            >
              {model.hostName.slice(0, 1).toUpperCase()}
            </div>
            <div>
              <div style={{ fontWeight: 800, fontSize: 17 }}>{model.hostName}</div>
              <div style={{ color: MUTE, fontSize: 11 }}>Hleðslureikningur · í gegnum Straumvakt</div>
            </div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontWeight: 800, fontSize: 17, letterSpacing: ".04em" }}>REIKNINGUR</div>
            <div style={{ color: MUTE, fontSize: 12 }}>Nr. {model.invoiceNo}</div>
          </div>
        </div>

        {/* Parties — kröfuhafi is the host, greiðandi is the driver. */}
        <div style={{ display: "flex", gap: 24, flexWrap: "wrap", marginTop: 18 }}>
          <div style={{ flex: "1 1 220px" }}>
            <Field k="Kröfuhafi" v={model.hostName} />
            <div style={{ color: MUTE, fontSize: 12 }}>
              {model.hostKennitala ? `kt. ${model.hostKennitala}` : "kt. —"}
            </div>
          </div>
          <div style={{ flex: "1 1 220px" }}>
            <Field k="Greiðandi" v={model.payerName} />
            <div style={{ color: MUTE, fontSize: 12 }}>{model.payerEmail ?? ""}</div>
            <div style={{ color: MUTE, fontSize: 12 }}>kt. —</div>
          </div>
        </div>

        {/* Period meta */}
        <div style={{ display: "flex", gap: 24, flexWrap: "wrap", marginTop: 16, paddingTop: 14, borderTop: `1px solid ${LINE}` }}>
          <Field k="Tímabil" v={monthLabel(model.monthKey)} />
          <Field k="Útgáfudagur" v={fmtDate(model.issueDate)} />
          <Field k="Gjalddagi" v={fmtDate(model.dueDate)} />
          <Field k="Eindagi" v={fmtDate(model.finalDate)} />
          {model.servicePlace && <Field k="Þjónustustaður" v={model.servicePlace} />}
        </div>

        {/* ── 1. SAMANTEKT (summary, cost factors first) ── */}
        <SectionTitle>Samantekt</SectionTitle>
        <div style={{ color: MUTE, fontSize: 11, marginTop: -6, marginBottom: 8 }}>
          Sundurliðað eftir gjaldaliðum samkvæmt samningi þínum.
        </div>

        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={th}>Gjaldaliður</th>
              <th style={thr}>Magn</th>
              <th style={thr}>Einingaverð</th>
              <th style={thr}>Upphæð án VSK</th>
            </tr>
          </thead>
          <tbody>
            {model.factors.map((f) => (
              <tr key={f.key}>
                <td style={td}>
                  <strong>{f.label}</strong>
                  {f.supplier ? <span style={{ color: MUTE }}> · {f.supplier}</span> : null}
                </td>
                <td style={tdr}>{f.quantityLabel ?? "—"}</td>
                <td style={tdr}>{f.unitPriceLabel ?? "—"}</td>
                <td style={tdr}>{kr(f.amountExVatMinor)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Totals roll-up */}
        <div style={{ marginLeft: "auto", marginTop: 14, width: "min(320px,100%)" }}>
          <TotalRow k="Upphæð án VSK" v={kr(model.subtotalExVatMinor)} muted />
          <TotalRow k={`VSK (${model.vatRatePct}%)`} v={kr(model.vatMinor)} muted />
          <div style={{ borderTop: `2px solid ${INK}`, marginTop: 6, paddingTop: 6 }}>
            <TotalRow k="Samtals" v={kr(model.totalIncVatMinor)} strong />
          </div>
        </div>

        {/* ── 2. SUNDURLIÐUN HLEÐSLNA (session breakdown) ── */}
        <SectionTitle>Sundurliðun hleðslna</SectionTitle>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={th}>Dagsetning</th>
              <th style={th}>Hleðslustöð</th>
              <th style={thr}>Orka</th>
              <th style={thr}>Upphæð</th>
            </tr>
          </thead>
          <tbody>
            {model.sessions.map((h) => (
              <tr key={h.sessionId}>
                <td style={td}>{fmtDayDots(h.startedAt)}</td>
                <td style={td}>
                  {h.chargerName ?? "—"}
                  {h.siteName ? <span style={{ color: MUTE }}> · {h.siteName}</span> : null}
                </td>
                <td style={tdr}>{h.energyKwh.toLocaleString("is-IS")} kWh</td>
                <td style={tdr}>{h.costIncVatMinor === null ? "—" : kr(h.costIncVatMinor)}</td>
              </tr>
            ))}
            <tr>
              <td style={{ ...td, fontWeight: 700, borderBottom: "none" }}>Orka samtals</td>
              <td style={{ ...td, borderBottom: "none" }} />
              <td style={{ ...tdr, fontWeight: 700, borderBottom: "none" }}>
                {sessionEnergyKwh.toLocaleString("is-IS")} kWh
              </td>
              <td style={{ ...tdr, fontWeight: 700, borderBottom: "none" }}>{kr(sessionEnergyMinor)}</td>
            </tr>
          </tbody>
        </table>

        {/* Payment block — claim is the host's; Straumvakt collects on its behalf. */}
        <div style={{ marginTop: 22, background: "#f3f6fb", border: `1px solid ${LINE}`, borderRadius: 10, padding: "14px 16px" }}>
          <div style={{ fontWeight: 700, marginBottom: 10 }}>Greiðsluupplýsingar</div>
          <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
            <Field k="Kröfuhafi kt." v={model.hostKennitala ?? "—"} />
            <Field k="Kröfunúmer" v={model.claimNo} />
            <Field k="Gjalddagi" v={fmtDate(model.dueDate)} />
            <Field k="Til greiðslu" v={kr(model.totalIncVatMinor)} />
          </div>
          <div style={{ color: MUTE, fontSize: 11, marginTop: 10 }}>
            Greiðsluseðill birtist í heimabanka þínum undir kröfuhafanum {model.hostName}. Innheimt af
            Straumvakt ehf (kt. 080487-3129) fyrir hönd kröfuhafa. VSK er innifalinn.
          </div>
        </div>
      </div>
    </div>
  );
}

export function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        marginTop: 22,
        marginBottom: 10,
        fontSize: 11,
        fontWeight: 800,
        letterSpacing: ".1em",
        textTransform: "uppercase",
        color: INK,
        borderBottom: `1px solid ${LINE}`,
        paddingBottom: 6,
      }}
    >
      {children}
    </div>
  );
}
