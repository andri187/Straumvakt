"use client";

// Kostnaður — this-month usage on top, then past months as a list; clicking a
// past month opens that month's invoice rendered like a real Icelandic
// reikningur / greiðsluseðill (as it appears in heimabanki). Real invoicing
// lands with the billing engine (P1); this is the per-month statement built
// from the driver's own session history.

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { driverFetch, type DriverProfile } from "../driver-auth";
import { useDriverMe } from "../layout";

type H = {
  sessionId: string;
  startedAt: string;
  energyKwh: number;
  costIsk: number | null;
  chargerName: string | null;
  siteName: string | null;
  billingHomeName: string | null;
};

const kr = (n: number) =>
  `${(n / 100).toLocaleString("is-IS", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} kr.`;

const MONTHS = [
  "janúar", "febrúar", "mars", "apríl", "maí", "júní",
  "júlí", "ágúst", "september", "október", "nóvember", "desember",
];
const monthKey = (iso: string) => iso.slice(0, 7);
function monthLabel(key: string): string {
  const [y, m] = key.split("-");
  return `${MONTHS[Number(m) - 1] ?? m} ${y}`;
}
function agg(list: H[]) {
  return {
    count: list.length,
    energy: Math.round(list.reduce((s, h) => s + (h.energyKwh || 0), 0) * 10) / 10,
    cost: list.reduce((s, h) => s + (h.costIsk || 0), 0),
  };
}

export default function DriverCost() {
  const me = useDriverMe();
  const [rows, setRows] = useState<H[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [invoiceMonth, setInvoiceMonth] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await driverFetch<{ sessions: H[] }>("/api/driver/invoices");
        // Kostnaður is the billing view — list only billable charges
        // (energy delivered > 0). Zero-kWh plug-ins (aborted / no charge)
        // stay in Hleðslusaga as activity, but don't belong on an invoice.
        if (!cancelled) setRows(r.sessions.filter((s) => s.energyKwh > 0));
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const groups = useMemo(() => {
    const m = new Map<string, H[]>();
    for (const h of rows ?? []) {
      const k = monthKey(h.startedAt);
      const list = m.get(k) ?? [];
      list.push(h);
      m.set(k, list);
    }
    return m;
  }, [rows]);

  const currentKey = new Date().toISOString().slice(0, 7);
  const thisMonth = groups.get(currentKey) ?? [];
  const pastKeys = [...groups.keys()].filter((k) => k !== currentKey).sort().reverse();
  const tm = agg(thisMonth);

  return (
    <>
      <div className="head" style={{ marginBottom: 14 }}>
        <div>
          <h1>Kostnaður</h1>
          <p>Þessi mánuður efst — smelltu á fyrri mánuð til að opna reikning.</p>
        </div>
      </div>

      {err && (
        <div
          className="card"
          style={{ padding: "12px 16px", marginBottom: 14, borderColor: "rgba(255,107,107,.4)", color: "var(--red)" }}
        >
          {err}
        </div>
      )}

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-h">
          Þessi mánuður <span className="sub">{monthLabel(currentKey)}</span>
        </div>
        <div style={{ display: "flex", gap: 32, flexWrap: "wrap", padding: "14px 18px" }}>
          <Stat lbl="Kostnaður" val={rows ? kr(tm.cost) : "—"} grad />
          <Stat lbl="Orka" val={rows ? `${tm.energy.toLocaleString("is-IS")} kWh` : "—"} />
          <Stat lbl="Hleðslur" val={rows ? String(tm.count) : "—"} />
        </div>
      </div>

      <div className="card">
        <div className="card-h">
          Fyrri mánuðir <span className="sub">smelltu til að opna reikning</span>
        </div>
        <table className="rtable">
          <thead>
            <tr>
              <th>Mánuður</th>
              <th>Hleðslur</th>
              <th>Orka</th>
              <th>Kostnaður</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows === null && <tr><td colSpan={5} className="empty">Hleð…</td></tr>}
            {rows && pastKeys.length === 0 && (
              <tr><td colSpan={5} className="empty">Engir fyrri mánuðir.</td></tr>
            )}
            {pastKeys.map((k) => {
              const a = agg(groups.get(k) ?? []);
              return (
                <tr key={k} style={{ cursor: "pointer" }} onClick={() => setInvoiceMonth(k)}>
                  <td data-label="Mánuður"><strong>{monthLabel(k)}</strong></td>
                  <td data-label="Hleðslur">{a.count}</td>
                  <td data-label="Orka">{a.energy} kWh</td>
                  <td data-label="Kostnaður">{kr(a.cost)}</td>
                  <td className="right" data-label="">
                    <span className="badge2 s-live">Reikningur →</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {invoiceMonth && (
        <InvoiceModal
          monthKey={invoiceMonth}
          sessions={groups.get(invoiceMonth) ?? []}
          me={me}
          onClose={() => setInvoiceMonth(null)}
        />
      )}
    </>
  );
}

function Stat({ lbl, val, grad }: { lbl: string; val: string; grad?: boolean }) {
  return (
    <div>
      <div style={{ fontSize: 10, letterSpacing: ".12em", textTransform: "uppercase", color: "var(--muted)" }}>
        {lbl}
      </div>
      <div className={"val" + (grad ? " grad" : "")} style={{ fontWeight: 800, fontSize: 22, marginTop: 3 }}>
        {val}
      </div>
    </div>
  );
}

// ── Invoice (Icelandic reikningur / greiðsluseðill) ───────────────────────
const INK = "#0b1220";
const MUTE = "#5a6678";
const LINE = "#e5e9f0";

function fmtDate(d: Date): string {
  return `${String(d.getUTCDate()).padStart(2, "0")}.${String(d.getUTCMonth() + 1).padStart(2, "0")}.${d.getUTCFullYear()}`;
}
function fmtDayDots(iso: string): string {
  return iso.slice(0, 10).split("-").reverse().join(".");
}

function Field({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <div style={{ fontSize: 10, letterSpacing: ".08em", textTransform: "uppercase", color: MUTE }}>{k}</div>
      <div style={{ fontWeight: 600, marginTop: 2 }}>{v}</div>
    </div>
  );
}
function TotalRow({ k, v, strong }: { k: string; v: string; strong?: boolean }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "3px 0", fontWeight: strong ? 800 : 500, fontSize: strong ? 16 : 13 }}>
      <span style={{ color: strong ? INK : MUTE }}>{k}</span>
      <span>{v}</span>
    </div>
  );
}

function InvoiceModal({
  monthKey: mk,
  sessions,
  me,
  onClose,
}: {
  monthKey: string;
  sessions: H[];
  me: DriverProfile | null;
  onClose: () => void;
}) {
  const a = agg(sessions);
  const total = a.cost; // aurar, VAT-inclusive
  const exVat = Math.round(total / 1.24);
  const vsk = total - exVat;

  const [yy, mm] = mk.split("-").map(Number);
  const issue = new Date(Date.UTC(yy, mm, 1)); // first day of the month after the period
  const due = new Date(issue.getTime() + 14 * 86400000);
  const fin = new Date(issue.getTime() + 28 * 86400000);
  const ref = (me?.id ?? "0000").replace(/[^0-9]/g, "").padEnd(4, "0").slice(0, 4);
  const invoiceNo = `STR-${yy}${String(mm).padStart(2, "0")}-${ref}`;
  const claimNo = `${String(mm).padStart(2, "0")}${String(yy).slice(2)}${ref}`;
  const homes = [...new Set(sessions.map((s) => s.billingHomeName).filter(Boolean))].join(", ");

  const th: CSSProperties = { textAlign: "left", padding: "7px 8px", fontSize: 10, letterSpacing: ".06em", textTransform: "uppercase", color: MUTE, borderBottom: `2px solid ${INK}` };
  const thr: CSSProperties = { ...th, textAlign: "right" };
  const td: CSSProperties = { padding: "8px", borderBottom: `1px solid ${LINE}` };
  const tdr: CSSProperties = { ...td, textAlign: "right", whiteSpace: "nowrap" };

  return (
    <div
      onClick={onClose}
      style={{ position: "fixed", inset: 0, background: "rgba(2,6,16,.66)", backdropFilter: "blur(4px)", zIndex: 90, display: "grid", placeItems: "center", padding: 16 }}
    >
      <div onClick={(e) => e.stopPropagation()} style={{ width: "min(680px,96vw)", maxHeight: "92vh", overflow: "auto" }}>
        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8 }}>
          <button className="btn sm" type="button" onClick={onClose}>Loka</button>
        </div>

        {/* The invoice "paper" — light document, as it appears in the bank. */}
        <div style={{ background: "#fff", color: INK, borderRadius: 12, overflow: "hidden", boxShadow: "0 30px 80px rgba(0,0,0,.5)", fontSize: 13, lineHeight: 1.5 }}>
          <div style={{ height: 6, background: "linear-gradient(135deg,#3ee9a7,#2bd3c9 55%,#2bb6e8)" }} />
          <div style={{ padding: "22px 26px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16 }}>
              <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                <div style={{ width: 36, height: 36, borderRadius: 9, background: "linear-gradient(135deg,#3ee9a7,#2bd3c9 55%,#2bb6e8)", display: "grid", placeItems: "center", color: "#04121b", fontWeight: 900 }}>S</div>
                <div>
                  <div style={{ fontWeight: 800, fontSize: 17 }}>Straumvakt ehf</div>
                  <div style={{ color: MUTE, fontSize: 11 }}>Hleðsluþjónusta</div>
                </div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontWeight: 800, fontSize: 17, letterSpacing: ".04em" }}>REIKNINGUR</div>
                <div style={{ color: MUTE, fontSize: 12 }}>Nr. {invoiceNo}</div>
              </div>
            </div>

            <div style={{ display: "flex", gap: 24, flexWrap: "wrap", marginTop: 18 }}>
              <div style={{ flex: "1 1 220px" }}>
                <Field k="Kröfuhafi" v="Straumvakt ehf" />
                <div style={{ color: MUTE, fontSize: 12 }}>kt. 080487-3129</div>
              </div>
              <div style={{ flex: "1 1 220px" }}>
                <Field k="Greiðandi" v={me?.displayName ?? "—"} />
                <div style={{ color: MUTE, fontSize: 12 }}>{me?.email ?? ""}</div>
                <div style={{ color: MUTE, fontSize: 12 }}>kt. —</div>
              </div>
            </div>

            <div style={{ display: "flex", gap: 24, flexWrap: "wrap", marginTop: 16, paddingTop: 14, borderTop: `1px solid ${LINE}` }}>
              <Field k="Tímabil" v={monthLabel(mk)} />
              <Field k="Útgáfudagur" v={fmtDate(issue)} />
              <Field k="Gjalddagi" v={fmtDate(due)} />
              <Field k="Eindagi" v={fmtDate(fin)} />
              {homes && <Field k="Þjónustustaður" v={homes} />}
            </div>

            <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 18 }}>
              <thead>
                <tr>
                  <th style={th}>Dagsetning</th>
                  <th style={th}>Hleðslustöð</th>
                  <th style={thr}>Orka</th>
                  <th style={thr}>Upphæð</th>
                </tr>
              </thead>
              <tbody>
                {sessions.map((h) => (
                  <tr key={h.sessionId}>
                    <td style={td}>{fmtDayDots(h.startedAt)}</td>
                    <td style={td}>{h.chargerName ?? "—"}{h.siteName ? <span style={{ color: MUTE }}> · {h.siteName}</span> : null}</td>
                    <td style={tdr}>{h.energyKwh} kWh</td>
                    <td style={tdr}>{h.costIsk === null ? "—" : kr(h.costIsk)}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div style={{ marginLeft: "auto", marginTop: 16, width: "min(300px,100%)" }}>
              <TotalRow k="Orka samtals" v={`${a.energy.toLocaleString("is-IS")} kWh`} />
              <TotalRow k="Upphæð án VSK" v={kr(exVat)} />
              <TotalRow k="VSK (24%)" v={kr(vsk)} />
              <div style={{ borderTop: `2px solid ${INK}`, marginTop: 6, paddingTop: 6 }}>
                <TotalRow k="Samtals" v={kr(total)} strong />
              </div>
            </div>

            <div style={{ marginTop: 22, background: "#f3f6fb", border: `1px solid ${LINE}`, borderRadius: 10, padding: "14px 16px" }}>
              <div style={{ fontWeight: 700, marginBottom: 10 }}>Greiðsluupplýsingar</div>
              <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
                <Field k="Kröfuhafi kt." v="080487-3129" />
                <Field k="Kröfunúmer" v={claimNo} />
                <Field k="Gjalddagi" v={fmtDate(due)} />
                <Field k="Til greiðslu" v={kr(total)} />
              </div>
              <div style={{ color: MUTE, fontSize: 11, marginTop: 10 }}>
                Greiðsluseðill birtist í heimabanka þínum undir kröfuhafanum Straumvakt ehf. VSK er innifalinn.
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
