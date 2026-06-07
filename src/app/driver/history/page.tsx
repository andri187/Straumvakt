"use client";

// Hleðslusaga — the driver's billed sessions, newest first. Live via
// /api/driver/sessions/history.

import { useEffect, useState } from "react";
import { driverFetch } from "../driver-auth";

type H = {
  sessionId: string;
  startedAt: string;
  stoppedAt: string | null;
  durationSec: number | null;
  energyKwh: number;
  costIsk: number | null;
  chargerName: string | null;
  siteName: string | null;
  billingHomeName: string | null;
};

// costIsk is aurar (1/100 króna); ÷100 + 2 decimals (is-IS), matching mobile.
const kr = (n: number | null) =>
  n === null ? "—" : `${(n / 100).toLocaleString("is-IS", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} kr.`;

export default function DriverHistory() {
  const [rows, setRows] = useState<H[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await driverFetch<{ sessions: H[] }>("/api/driver/sessions/history?limit=100");
        if (!cancelled) setRows(r.sessions);
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <>
      <div className="head">
        <div>
          <h1>Hleðslusaga</h1>
          <p>Allar hleðslurnar þínar, nýjastar efst.</p>
        </div>
      </div>

      {err && (
        <div className="card" style={{ padding: "14px 18px", marginBottom: 16, borderColor: "rgba(255,107,107,.4)", color: "var(--red)" }}>
          {err}
        </div>
      )}

      <div className="card">
        <div className="card-h">Hleðslur <span className="sub">{rows ? `${rows.length}` : ""}</span></div>
        <table>
          <thead>
            <tr><th>Dagsetning</th><th>Stöð</th><th>Svæði</th><th>Greiðsluheimili</th><th>Orka</th><th>Kostnaður</th></tr>
          </thead>
          <tbody>
            {rows === null && <tr><td colSpan={6} className="empty">Hleð…</td></tr>}
            {rows?.length === 0 && <tr><td colSpan={6} className="empty">Engar hleðslur enn.</td></tr>}
            {rows?.map((h) => (
              <tr key={h.sessionId}>
                <td className="sub">{h.startedAt.slice(0, 16).replace("T", " ")}</td>
                <td className="mono">{h.chargerName ?? "—"}</td>
                <td className="sub">{h.siteName ?? "—"}</td>
                <td className="sub">{h.billingHomeName ?? "—"}</td>
                <td>{h.energyKwh} kWh</td>
                <td>{kr(h.costIsk)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
