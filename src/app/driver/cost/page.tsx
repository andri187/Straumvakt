"use client";

// Kostnaður — cost overview aggregated from the driver's billed sessions,
// broken down by billing home (the org each session was billed under).

import { useEffect, useState } from "react";
import { driverFetch } from "../driver-auth";

type H = {
  sessionId: string;
  energyKwh: number;
  costIsk: number | null;
  billingHomeName: string | null;
};

// costIsk values are aurar (1/100 króna); aggregate raw, ÷100 + 2 decimals
// (is-IS) at display, matching the mobile app.
const kr = (n: number) =>
  `${(n / 100).toLocaleString("is-IS", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} kr.`;

export default function DriverCost() {
  const [rows, setRows] = useState<H[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

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

  const totalCost = rows ? rows.reduce((s, h) => s + (h.costIsk || 0), 0) : 0;
  const totalEnergy = rows
    ? Math.round(rows.reduce((s, h) => s + (h.energyKwh || 0), 0) * 10) / 10
    : 0;
  const count = rows?.length ?? 0;

  const byHome = new Map<
    string,
    { count: number; energy: number; cost: number }
  >();
  for (const h of rows ?? []) {
    const k = h.billingHomeName ?? "Óþekkt";
    const e = byHome.get(k) ?? { count: 0, energy: 0, cost: 0 };
    e.count += 1;
    e.energy += h.energyKwh || 0;
    e.cost += h.costIsk || 0;
    byHome.set(k, e);
  }
  const homes = [...byHome.entries()].sort((a, b) => b[1].cost - a[1].cost);

  return (
    <>
      <div className="head">
        <div>
          <h1>Kostnaður</h1>
          <p>
            Yfirlit yfir kostnað þinn (síðustu 100 hleðslur), skipt eftir
            greiðsluheimili.
          </p>
        </div>
      </div>

      {err && (
        <div
          className="card"
          style={{
            padding: "14px 18px",
            marginBottom: 16,
            borderColor: "rgba(255,107,107,.4)",
            color: "var(--red)",
          }}
        >
          {err}
        </div>
      )}

      <div className="grid g3" style={{ marginBottom: 16 }}>
        <div className="card kpi">
          <div className="lbl">Kostnaður alls</div>
          <div className="val grad">{rows ? kr(totalCost) : "—"}</div>
        </div>
        <div className="card kpi">
          <div className="lbl">Orka alls</div>
          <div className="val">
            {rows ? `${totalEnergy.toLocaleString("is-IS")} kWh` : "—"}
          </div>
        </div>
        <div className="card kpi">
          <div className="lbl">Hleðslur</div>
          <div className="val">{rows ? count : "—"}</div>
        </div>
      </div>

      <div className="card">
        <div className="card-h">Eftir greiðsluheimili</div>
        <table>
          <thead>
            <tr>
              <th>Greiðsluheimili</th>
              <th>Hleðslur</th>
              <th>Orka</th>
              <th>Kostnaður</th>
            </tr>
          </thead>
          <tbody>
            {rows === null && (
              <tr>
                <td colSpan={4} className="empty">
                  Hleð…
                </td>
              </tr>
            )}
            {rows?.length === 0 && (
              <tr>
                <td colSpan={4} className="empty">
                  Engar hleðslur enn.
                </td>
              </tr>
            )}
            {homes.map(([name, v]) => (
              <tr key={name}>
                <td>
                  <strong>{name}</strong>
                </td>
                <td>{v.count}</td>
                <td>{Math.round(v.energy * 10) / 10} kWh</td>
                <td>{kr(v.cost)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
