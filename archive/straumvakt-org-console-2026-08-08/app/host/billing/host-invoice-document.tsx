"use client";

// Straumvakt → Host service-fee invoice (þjónustureikningur) — presentational.
//
// This is the settlement invoice Straumvakt sends the charger host each
// month (ADR 0031). Here Straumvakt is the KRÖFUHAFI and the host is the
// greiðandi — the mirror of the driver invoice, where the host was
// kröfuhafi.
//
// Layout per operator request (2026-06-14):
//   1. SAMANTEKT (summary) FIRST — the contract fee lines (host
//      subscription + per-driver Þjónustugjald + % of energy revenue;
//      the live revenue model is still open in ADR 0031, so all bases are
//      shown side-by-side during dev), then ex-VAT subtotal / VSK /
//      Samtals = what the host owes Straumvakt.
//   2. SUNDURLIÐUN EFTIR ÖKUMÖNNUM — one row per driver invoice issued for
//      this host in the period, with the driver-side figures + the
//      service fee attributable to that driver, and a sums row.
//
// Pure component — reuses the driver invoice's visual primitives.

import { useState, type CSSProperties } from "react";
import {
  InvoiceDocument,
  type InvoiceModel,
  kr,
  monthLabel,
  fmtDate,
  Field,
  TotalRow,
  SectionTitle,
  INK,
  MUTE,
  LINE,
} from "../../driver/cost/invoice-document";

// ── Model ─────────────────────────────────────────────────────────────

/** One charge of the Straumvakt↔host contract. `basis` is informational
 *  (which fee model the line came from) so multiple bases can be shown
 *  together while the revenue model is still open in ADR 0031. */
export interface HostFeeLine {
  key: string;
  /** "Grunnáskrift", "Þjónustugjald ökumanna", "Hlutdeild í orkusölu". */
  label: string;
  /** Which open ADR-0031 basis this line represents. */
  basis: "subscription" | "per_driver" | "energy_pct";
  /** Unit price for display, e.g. "9.900 kr.", "490 kr.", "3,5%". */
  unitPriceLabel: string | null;
  /** Count / quantity for display, e.g. "1 rekstrarstaður", "5 ökumenn". */
  quantityLabel: string | null;
  amountExVatMinor: number;
}

export interface HostDriverRow {
  driverName: string;
  driverEmail: string | null;
  /** The driver invoice number this row corresponds to. */
  invoiceNo: string;
  sessions: number;
  energyKwh: number;
  /** Gross (inc-VAT) total billed to the driver — flows to the host. */
  driverTotalIncVatMinor: number;
  /** Straumvakt's service fee attributable to this driver (ex-VAT). */
  serviceFeeExVatMinor: number;
  /** The driver-facing invoice, so the host can drill into exactly what
   *  the driver was billed. Null hides the drill-in (name not clickable). */
  driverInvoice: InvoiceModel | null;
}

/** An installation covered by this invoice. A host can have several, so the
 *  summary names each one that contributed to the period. */
export interface HostInstallationLine {
  name: string;
  /** Optional context, e.g. "8 stöðvar · 3 ökumenn". */
  detail: string | null;
}

export interface HostInvoiceModel {
  invoiceNo: string;
  monthKey: string;
  issueDate: Date;
  dueDate: Date;
  finalDate: Date;
  claimNo: string;
  /** Greiðandi — the charger host (e.g. N1). */
  hostName: string;
  hostKennitala: string | null;
  /** Installations covered by this invoice (one line each in Samantekt). */
  installations: HostInstallationLine[];
  vatRatePct: number;
  /** Summary fee lines (what the host owes Straumvakt). */
  feeLines: HostFeeLine[];
  subtotalExVatMinor: number;
  vatMinor: number;
  totalIncVatMinor: number;
  /** Per-driver breakdown of the invoices issued for this host. */
  drivers: HostDriverRow[];
}

// Straumvakt's own identity — the kröfuhafi on this invoice.
const STRAUMVAKT_KT = "080487-3129";

// ── Document ──────────────────────────────────────────────────────────

export function HostInvoiceDocument({ model }: { model: HostInvoiceModel }) {
  // Drill-in: the driver invoice opened from a per-driver row.
  const [openInvoice, setOpenInvoice] = useState<InvoiceModel | null>(null);

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

  // Per-driver breakdown aggregates (informational sums row).
  const drvSessions = model.drivers.reduce((s, d) => s + d.sessions, 0);
  const drvEnergy = model.drivers.reduce((s, d) => s + d.energyKwh, 0);
  const drvGross = model.drivers.reduce((s, d) => s + d.driverTotalIncVatMinor, 0);
  const drvServiceFee = model.drivers.reduce((s, d) => s + d.serviceFeeExVatMinor, 0);

  return (
    <>
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
        {/* Header — Straumvakt is the issuer/kröfuhafi here. */}
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
              S
            </div>
            <div>
              <div style={{ fontWeight: 800, fontSize: 17 }}>Straumvakt ehf</div>
              <div style={{ color: MUTE, fontSize: 11 }}>Þjónustureikningur</div>
            </div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontWeight: 800, fontSize: 17, letterSpacing: ".04em" }}>REIKNINGUR</div>
            <div style={{ color: MUTE, fontSize: 12 }}>Nr. {model.invoiceNo}</div>
          </div>
        </div>

        {/* Parties — Straumvakt kröfuhafi, host greiðandi. */}
        <div style={{ display: "flex", gap: 24, flexWrap: "wrap", marginTop: 18 }}>
          <div style={{ flex: "1 1 220px" }}>
            <Field k="Kröfuhafi" v="Straumvakt ehf" />
            <div style={{ color: MUTE, fontSize: 12 }}>kt. {STRAUMVAKT_KT}</div>
          </div>
          <div style={{ flex: "1 1 220px" }}>
            <Field k="Greiðandi" v={model.hostName} />
            <div style={{ color: MUTE, fontSize: 12 }}>
              {model.hostKennitala ? `kt. ${model.hostKennitala}` : "kt. —"}
            </div>
          </div>
        </div>

        {/* Period meta */}
        <div style={{ display: "flex", gap: 24, flexWrap: "wrap", marginTop: 16, paddingTop: 14, borderTop: `1px solid ${LINE}` }}>
          <Field k="Tímabil" v={monthLabel(model.monthKey)} />
          <Field k="Útgáfudagur" v={fmtDate(model.issueDate)} />
          <Field k="Gjalddagi" v={fmtDate(model.dueDate)} />
          <Field k="Eindagi" v={fmtDate(model.finalDate)} />
        </div>

        {/* ── PAGE 1 · SAMANTEKT (summary / payment due) ── */}
        <SectionTitle>Samantekt</SectionTitle>

        {/* Installations this invoice covers — one line each. */}
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 10, letterSpacing: ".08em", textTransform: "uppercase", color: MUTE, marginBottom: 4 }}>
            Þjónustustaðir
          </div>
          {model.installations.map((inst) => (
            <div
              key={inst.name}
              style={{ display: "flex", justifyContent: "space-between", padding: "2px 0" }}
            >
              <span style={{ fontWeight: 600 }}>{inst.name}</span>
              {inst.detail ? <span style={{ color: MUTE }}>{inst.detail}</span> : null}
            </div>
          ))}
        </div>

        <div style={{ color: MUTE, fontSize: 11, marginBottom: 8 }}>
          Gjaldaliðir samkvæmt þjónustusamningi Straumvaktar og rekstraraðila.
        </div>

        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={th}>Gjaldaliður</th>
              <th style={thr}>Einingaverð</th>
              <th style={thr}>Fjöldi</th>
              <th style={thr}>Upphæð án VSK</th>
            </tr>
          </thead>
          <tbody>
            {model.feeLines.map((f) => (
              <tr key={f.key}>
                <td style={td}>
                  <strong>{f.label}</strong>
                </td>
                <td style={tdr}>{f.unitPriceLabel ?? "—"}</td>
                <td style={tdr}>{f.quantityLabel ?? "—"}</td>
                <td style={tdr}>{kr(f.amountExVatMinor)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div style={{ marginLeft: "auto", marginTop: 14, width: "min(320px,100%)" }}>
          <TotalRow k="Upphæð án VSK" v={kr(model.subtotalExVatMinor)} muted />
          <TotalRow k={`VSK (${model.vatRatePct}%)`} v={kr(model.vatMinor)} muted />
          <div style={{ borderTop: `2px solid ${INK}`, marginTop: 6, paddingTop: 6 }}>
            <TotalRow k="Samtals" v={kr(model.totalIncVatMinor)} strong />
          </div>
        </div>

        {/* Uppgjör (settlement) — under the summary. Driver detail is page 2. */}
        <div style={{ marginLeft: "auto", marginTop: 16, width: "min(380px,100%)" }}>
          <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: ".08em", textTransform: "uppercase", color: INK, marginBottom: 4 }}>
            Uppgjör
          </div>
          <SettleRow
            label="Reikningar til ökumanna"
            sub="innheimt beint hjá ökumönnum"
            minor={drvGross}
          />
          <SettleRow
            label="Þjónustugjald Straumvaktar"
            sub="greitt skv. „Til greiðslu“"
            minor={-model.totalIncVatMinor}
          />
          <div style={{ borderTop: `2px solid ${INK}`, marginTop: 6, paddingTop: 6 }}>
            <SettleRow label="Nettó staða rekstraraðila" minor={drvGross - model.totalIncVatMinor} strong />
          </div>
        </div>
        <div style={{ color: MUTE, fontSize: 11, marginTop: 10 }}>
          Ökumannareikningar (+) sem rekstraraðili innheimtir beint hjá ökumönnum, að frádregnu
          þjónustugjaldi Straumvaktar (−), gefa nettó stöðu rekstraraðila. Sundurliðun ökumanna er á
          næstu síðu. Greiðsla þessa reiknings til Straumvaktar er fjárhæðin undir „Til greiðslu“.
          Fjárhæðir með VSK.
        </div>

        {/* Payment block — bottom of page 1. Straumvakt is the claimant. */}
        <div style={{ marginTop: 22, background: "#f3f6fb", border: `1px solid ${LINE}`, borderRadius: 10, padding: "14px 16px" }}>
          <div style={{ fontWeight: 700, marginBottom: 10 }}>Greiðsluupplýsingar</div>
          <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
            <Field k="Kröfuhafi kt." v={STRAUMVAKT_KT} />
            <Field k="Kröfunúmer" v={model.claimNo} />
            <Field k="Gjalddagi" v={fmtDate(model.dueDate)} />
            <Field k="Til greiðslu" v={kr(model.totalIncVatMinor)} />
          </div>
          <div style={{ color: MUTE, fontSize: 11, marginTop: 10 }}>
            Greiðsluseðill birtist í heimabanka rekstraraðila undir kröfuhafanum Straumvakt ehf. VSK er
            innifalinn.
          </div>
        </div>
      </div>
    </div>

    {/* ── PAGE 2 (new page) · SUNDURLIÐUN EFTIR ÖKUMÖNNUM (clickable drivers) ── */}
    <div
      style={{
        background: "#fff",
        color: INK,
        borderRadius: 12,
        overflow: "hidden",
        boxShadow: "0 30px 80px rgba(0,0,0,.5)",
        fontSize: 13,
        lineHeight: 1.5,
        marginTop: 22,
        breakBefore: "page",
      }}
    >
      <div style={{ height: 6, background: "linear-gradient(135deg,#3ee9a7,#2bd3c9 55%,#2bb6e8)" }} />
      <div style={{ padding: "22px 26px" }}>
        {/* Page-2 running header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16, marginBottom: 6 }}>
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <div style={{ width: 28, height: 28, borderRadius: 7, background: "linear-gradient(135deg,#3ee9a7,#2bd3c9 55%,#2bb6e8)", display: "grid", placeItems: "center", color: "#04121b", fontWeight: 900, fontSize: 13 }}>S</div>
            <div style={{ fontWeight: 800 }}>Straumvakt ehf</div>
          </div>
          <div style={{ textAlign: "right", color: MUTE, fontSize: 12 }}>
            Nr. {model.invoiceNo} · {monthLabel(model.monthKey)} · {model.hostName}
          </div>
        </div>

        {/* ── SUNDURLIÐUN EFTIR ÖKUMÖNNUM (clickable drivers) ── */}
        <SectionTitle>Sundurliðun eftir ökumönnum</SectionTitle>
        <div style={{ color: MUTE, fontSize: 11, marginTop: -6, marginBottom: 8 }}>
          Reikningar sem gefnir voru út á ökumenn rekstraraðila á tímabilinu. Smelltu á nafn til að sjá
          reikning ökumanns.
        </div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 560 }}>
            <thead>
              <tr>
                <th style={th}>Ökumaður</th>
                <th style={th}>Reikn.nr</th>
                <th style={thr}>Hleðslur</th>
                <th style={thr}>Orka</th>
                <th style={thr}>Reikningur</th>
                <th style={thr}>Þjónustugjald</th>
              </tr>
            </thead>
            <tbody>
              {model.drivers.map((d) => (
                <tr key={d.invoiceNo}>
                  <td style={td}>
                    {d.driverInvoice ? (
                      <button
                        type="button"
                        onClick={() => setOpenInvoice(d.driverInvoice)}
                        title="Skoða reikning ökumanns"
                        style={{
                          background: "none",
                          border: "none",
                          padding: 0,
                          font: "inherit",
                          fontWeight: 700,
                          color: "#1f8fb0",
                          textDecoration: "underline",
                          cursor: "pointer",
                        }}
                      >
                        {d.driverName}
                      </button>
                    ) : (
                      <strong>{d.driverName}</strong>
                    )}
                    {d.driverEmail ? (
                      <div style={{ color: MUTE, fontSize: 11 }}>{d.driverEmail}</div>
                    ) : null}
                  </td>
                  <td style={{ ...td, color: MUTE }}>{d.invoiceNo}</td>
                  <td style={tdr}>{d.sessions}</td>
                  <td style={tdr}>{d.energyKwh.toLocaleString("is-IS")} kWh</td>
                  <td style={tdr}>{kr(d.driverTotalIncVatMinor)}</td>
                  <td style={tdr}>{kr(d.serviceFeeExVatMinor)}</td>
                </tr>
              ))}
              <tr>
                <td style={{ ...td, fontWeight: 700, borderBottom: "none" }}>
                  Samtals · {model.drivers.length} ökumenn
                </td>
                <td style={{ ...td, borderBottom: "none" }} />
                <td style={{ ...tdr, fontWeight: 700, borderBottom: "none" }}>{drvSessions}</td>
                <td style={{ ...tdr, fontWeight: 700, borderBottom: "none" }}>
                  {drvEnergy.toLocaleString("is-IS")} kWh
                </td>
                <td style={{ ...tdr, fontWeight: 700, borderBottom: "none" }}>{kr(drvGross)}</td>
                <td style={{ ...tdr, fontWeight: 700, borderBottom: "none" }}>{kr(drvServiceFee)}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div style={{ color: MUTE, fontSize: 11, marginTop: 10 }}>
          Dálkurinn „Reikningur“ er heildarfjárhæð sem ökumaður greiðir rekstraraðila; „Þjónustugjald“ er
          hlutur Straumvaktar (sjá samantekt á síðu 1).
        </div>
      </div>
    </div>

    {/* Drill-in: the selected driver's invoice exactly as the driver saw it. */}
    {openInvoice && (
      <div
        onClick={() => setOpenInvoice(null)}
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(2,6,16,.66)",
          backdropFilter: "blur(4px)",
          zIndex: 90,
          display: "grid",
          placeItems: "start center",
          padding: 16,
          overflow: "auto",
        }}
      >
        <div onClick={(e) => e.stopPropagation()} style={{ width: "min(680px,96vw)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <div style={{ color: "#cfe8ff", fontSize: 12, fontWeight: 700 }}>
              Reikningur ökumanns · {openInvoice.payerName}
            </div>
            <button
              type="button"
              onClick={() => setOpenInvoice(null)}
              style={{
                background: "rgba(255,255,255,.12)",
                border: "1px solid rgba(255,255,255,.25)",
                color: "#fff",
                borderRadius: 8,
                padding: "6px 14px",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Loka
            </button>
          </div>
          <InvoiceDocument model={openInvoice} />
        </div>
      </div>
    )}
    </>
  );
}

// A settlement line: positive = money in to the host (green, +),
// negative = money out to Straumvakt (red, −). The net row is strong/ink.
function SettleRow({
  label,
  sub,
  minor,
  strong,
}: {
  label: string;
  sub?: string;
  minor: number;
  strong?: boolean;
}) {
  const positive = minor >= 0;
  const color = strong ? INK : positive ? "#1a7f5a" : "#b4453a";
  const sign = positive ? "+" : "−";
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", padding: "3px 0" }}>
      <span style={{ color: strong ? INK : INK, fontWeight: strong ? 800 : 500 }}>
        {label}
        {sub ? <span style={{ color: MUTE, fontSize: 11 }}> · {sub}</span> : null}
      </span>
      <span style={{ fontWeight: strong ? 800 : 600, color, whiteSpace: "nowrap" }}>
        {sign} {kr(Math.abs(minor))}
      </span>
    </div>
  );
}
