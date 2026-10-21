"use client";

// Driver Mælaborð — compact overview: usage stats + recent charges. Live
// charging/ongoing-session lives in the mobile app (ADR 0033), not here.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { Route } from "next";
import { driverFetch, type DriverProfile } from "./driver-auth";
import { useDriverMe } from "./layout";

type History = {
  sessionId: string;
  startedAt: string;
  energyKwh: number;
  costIsk: number | null;
  chargerName: string | null;
  siteName: string | null;
  billingHomeName: string | null;
};

// costIsk values from the API are in aurar (1/100 króna). Divide for display
// and show 2 decimals with the Icelandic comma, matching the mobile app.
const kr = (n: number | null | undefined) =>
  n === null || n === undefined
    ? "—"
    : `${(n / 100).toLocaleString("is-IS", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} kr.`;

export default function DriverDashboard() {
  const router = useRouter();
  const me: DriverProfile | null = useDriverMe();
  const [history, setHistory] = useState<History[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const hist = await driverFetch<{ sessions: History[] }>("/api/driver/invoices");
        if (!cancelled) setHistory(hist.sessions);
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const count = history?.length ?? 0;
  const energy = history
    ? Math.round(history.reduce((s, h) => s + (h.energyKwh || 0), 0) * 10) / 10
    : 0;
  const cost = history ? history.reduce((s, h) => s + (h.costIsk || 0), 0) : 0;
  const recent = history?.slice(0, 8) ?? [];

  return (
    <>
      <div className="head" style={{ marginBottom: 14 }}>
        <div>
          <h1>Mælaborð</h1>
          <p>Hæ {me?.displayName ?? ""} — yfirlit yfir hleðslurnar þínar.</p>
        </div>
      </div>

      {err && (
        <div
          className="card"
          style={{
            padding: "12px 16px",
            marginBottom: 14,
            borderColor: "rgba(255,107,107,.4)",
            color: "var(--red)",
          }}
        >
          {err}
        </div>
      )}

      <div
        className="card"
        style={{
          marginBottom: 14,
          padding: "14px 18px",
          display: "flex",
          gap: 32,
          flexWrap: "wrap",
        }}
      >
        <Stat lbl="Orka" val={history ? `${energy.toLocaleString("is-IS")} kWh` : "—"} />
        <Stat lbl="Hleðslur" val={history ? String(count) : "—"} />
        <Stat lbl="Kostnaður" val={history ? kr(cost) : "—"} />
      </div>

      <div className="card">
        <div className="card-h">
          Nýlegar hleðslur <span className="sub">síðustu 8</span>
        </div>
        <table className="rtable">
          <thead>
            <tr>
              <th>Stöð</th>
              <th>Svæði</th>
              <th>Kostnaðarstaður</th>
              <th>Orka</th>
              <th>Kostnaður</th>
              <th>Tími</th>
            </tr>
          </thead>
          <tbody>
            {history === null && (
              <tr>
                <td colSpan={6} className="empty">
                  Hleð…
                </td>
              </tr>
            )}
            {history?.length === 0 && (
              <tr>
                <td colSpan={6} className="empty">
                  Engar hleðslur enn.
                </td>
              </tr>
            )}
            {recent.map((h) => (
              <tr
                key={h.sessionId}
                style={{ cursor: "pointer" }}
                onClick={() => router.push(`/driver/history/${h.sessionId}` as Route)}
              >
                <td className="mono" data-label="Stöð">{h.chargerName ?? "—"}</td>
                <td className="sub" data-label="Svæði">{h.siteName ?? "—"}</td>
                <td className="sub" data-label="Kostnaðarstaður">{h.billingHomeName ?? "—"}</td>
                <td data-label="Orka">{h.energyKwh} kWh</td>
                <td data-label="Kostnaður">{kr(h.costIsk)}</td>
                <td className="sub" data-label="Tími">
                  {h.startedAt.slice(0, 16).replace("T", " ")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function Stat({ lbl, val }: { lbl: string; val: string }) {
  return (
    <div>
      <div style={{ fontSize: 10, letterSpacing: ".12em", textTransform: "uppercase", color: "var(--muted)" }}>
        {lbl}
      </div>
      <div style={{ fontWeight: 800, fontSize: 20, marginTop: 3 }}>{val}</div>
    </div>
  );
}
