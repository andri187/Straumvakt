"use client";

// Driver Mælaborð — active session + recent charges + usage KPIs, from the
// live /api/driver/* endpoints (same as the mobile app). Management view;
// starting a charge stays in the app (ADR 0033).

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { Route } from "next";
import { driverFetch, type DriverProfile } from "./driver-auth";
import { useDriverMe } from "./layout";

type Active = {
  sessionId: string;
  chargerName: string;
  status: string;
  startedAt: string;
  powerKw: number;
  energyKwh: number;
  costIsk: number;
};
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
  const [active, setActive] = useState<Active[] | null>(null);
  const [history, setHistory] = useState<History[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [cur, hist] = await Promise.all([
          driverFetch<{ sessions: Active[] }>("/api/driver/sessions/current"),
          driverFetch<{ sessions: History[] }>(
            "/api/driver/sessions/history?limit=50",
          ),
        ]);
        if (cancelled) return;
        setActive(cur.sessions);
        setHistory(hist.sessions);
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
  const recent = history?.slice(0, 10) ?? [];

  return (
    <>
      <div className="head">
        <div>
          <h1>Mælaborð</h1>
          <p>Hæ {me?.displayName ?? ""} — yfirlit yfir hleðslurnar þínar.</p>
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

      {active && active.length > 0 && (
        <div
          className="card"
          style={{ marginBottom: 16, borderColor: "rgba(43,182,232,.4)" }}
        >
          <div className="card-h">
            Í hleðslu núna
            <span className="badge2 s-live">
              <span className="dot bg-live" />
              Virk
            </span>
          </div>
          {active.map((a) => (
            <div
              key={a.sessionId}
              style={{
                display: "flex",
                gap: 28,
                flexWrap: "wrap",
                padding: "14px 18px",
              }}
            >
              <Stat lbl="Stöð" val={a.chargerName} />
              <Stat lbl="Afl" val={`${a.powerKw} kW`} />
              <Stat lbl="Orka" val={`${a.energyKwh} kWh`} />
              <Stat lbl="Kostnaður" val={kr(a.costIsk)} />
              <Stat lbl="Hófst" val={a.startedAt.slice(11, 16)} />
            </div>
          ))}
        </div>
      )}

      <div className="grid g4" style={{ marginBottom: 16 }}>
        <Kpi
          lbl="Orka (50 síðustu)"
          val={history ? `${energy.toLocaleString("is-IS")} kWh` : undefined}
          grad
        />
        <Kpi lbl="Hleðslur" val={history ? String(count) : undefined} />
        <Kpi lbl="Kostnaður" val={history ? kr(cost) : undefined} />
        <Kpi lbl="Í hleðslu" val={active ? String(active.length) : undefined} />
      </div>

      <div className="card">
        <div className="card-h">
          Nýlegar hleðslur <span className="sub">síðustu 10</span>
        </div>
        <table>
          <thead>
            <tr>
              <th>Stöð</th>
              <th>Svæði</th>
              <th>Greiðsluheimili</th>
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
                onClick={() =>
                  router.push(`/driver/history/${h.sessionId}` as Route)
                }
              >
                <td className="mono">{h.chargerName ?? "—"}</td>
                <td className="sub">{h.siteName ?? "—"}</td>
                <td className="sub">{h.billingHomeName ?? "—"}</td>
                <td>{h.energyKwh} kWh</td>
                <td>{kr(h.costIsk)}</td>
                <td className="sub">
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

function Kpi({
  lbl,
  val,
  grad,
}: {
  lbl: string;
  val: string | undefined;
  grad?: boolean;
}) {
  return (
    <div className="card kpi">
      <div className="lbl">{lbl}</div>
      <div className={"val" + (grad ? " grad" : "")}>
        {val === undefined ? "—" : val}
      </div>
    </div>
  );
}

function Stat({ lbl, val }: { lbl: string; val: string }) {
  return (
    <div>
      <div
        style={{
          fontSize: 10,
          letterSpacing: ".12em",
          textTransform: "uppercase",
          color: "var(--muted)",
        }}
      >
        {lbl}
      </div>
      <div style={{ fontWeight: 700, marginTop: 2 }}>{val}</div>
    </div>
  );
}
