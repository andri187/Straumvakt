"use client";

// Kostnaður — this-month usage on top, then past months as a list; clicking a
// past month opens that month's invoice (a statement of its charges). Real
// invoicing lands with the billing engine (P1); this is the per-month
// statement built from the driver's own session history.

import { useEffect, useMemo, useState } from "react";
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
const monthKey = (iso: string) => iso.slice(0, 7); // YYYY-MM
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
        const r = await driverFetch<{ sessions: H[] }>(
          "/api/driver/sessions/history?limit=100",
        );
        if (!cancelled) setRows(r.sessions);
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
            {rows === null && (
              <tr><td colSpan={5} className="empty">Hleð…</td></tr>
            )}
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
  const homes = [...new Set(sessions.map((s) => s.billingHomeName).filter(Boolean))].join(", ");
  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(2,6,16,.6)",
        backdropFilter: "blur(4px)",
        zIndex: 90,
        display: "grid",
        placeItems: "center",
        padding: 16,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="card"
        style={{ width: "min(640px,96vw)", maxHeight: "90vh", overflow: "auto" }}
      >
        <div className="card-h">
          Reikningur — {monthLabel(mk)}
          <button className="btn sm" type="button" onClick={onClose}>Loka</button>
        </div>
        <div style={{ padding: "14px 18px" }}>
          <div className="sub">
            {me?.displayName ?? ""}{me?.email ? ` · ${me.email}` : ""}
          </div>
          {homes && <div className="sub">Greitt til: {homes}</div>}

          <table className="rtable" style={{ marginTop: 14 }}>
            <thead>
              <tr>
                <th>Dagsetning</th>
                <th>Stöð</th>
                <th>Orka</th>
                <th>Kostnaður</th>
              </tr>
            </thead>
            <tbody>
              {sessions.map((h) => (
                <tr key={h.sessionId}>
                  <td className="sub" data-label="Dagsetning">{h.startedAt.slice(0, 10)}</td>
                  <td className="mono" data-label="Stöð">{h.chargerName ?? "—"}</td>
                  <td data-label="Orka">{h.energyKwh} kWh</td>
                  <td data-label="Kostnaður">{h.costIsk === null ? "—" : kr(h.costIsk)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginTop: 16, paddingTop: 12, borderTop: "1px solid var(--border)" }}>
            <span style={{ fontWeight: 700 }}>Samtals</span>
            <span style={{ fontWeight: 800, fontSize: 18 }}>{kr(a.cost)}</span>
          </div>
          <div className="sub" style={{ marginTop: 6 }}>
            {a.count} hleðslur · {a.energy.toLocaleString("is-IS")} kWh · VSK innifalinn.
          </div>
        </div>
      </div>
    </div>
  );
}
