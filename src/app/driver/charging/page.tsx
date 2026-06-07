"use client";

// Driver Hleðsla — live charging view (ADR 0033). Web only monitors and stops
// active sessions; starting a charge stays in the Straumvakt mobile app.
// Polls /api/driver/sessions/current every 5s and ticks a live clock each second.

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { Route } from "next";
import { driverFetch, driverPost, DriverAuthError } from "../driver-auth";

type ActiveSession = {
  sessionId: string;
  connectorId: string | null;
  chargerName: string;
  status: string;
  startedAt: string;
  powerKw: number;
  energyKwh: number;
  costIsk: number;
};

// costIsk is aurar (1/100 króna); ÷100 + 2 decimals (is-IS), matching mobile.
const kr = (n: number) =>
  `${(n / 100).toLocaleString("is-IS", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} kr.`;

function fmtDuration(startedAt: string, now: number): string {
  const start = new Date(startedAt).getTime();
  if (!Number.isFinite(start)) return "—";
  let secs = Math.max(0, Math.floor((now - start) / 1000));
  const h = Math.floor(secs / 3600);
  secs -= h * 3600;
  const m = Math.floor(secs / 60);
  const s = secs - m * 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  if (m > 0) return `${m}m ${String(s).padStart(2, "0")}s`;
  return `${s}s`;
}

export default function DriverCharging() {
  const router = useRouter();
  const [sessions, setSessions] = useState<ActiveSession[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [stopping, setStopping] = useState<string | null>(null);
  const [now, setNow] = useState<number>(() => Date.now());

  const onAuthError = useCallback(
    (e: unknown): boolean => {
      if (e instanceof DriverAuthError) {
        router.replace("/driver/login" as Route);
        return true;
      }
      return false;
    },
    [router],
  );

  const load = useCallback(
    async (signal?: { cancelled: boolean }) => {
      try {
        const cur = await driverFetch<{ sessions: ActiveSession[] }>("/api/driver/sessions/current");
        if (signal?.cancelled) return;
        setSessions(cur.sessions);
        setErr(null);
      } catch (e) {
        if (signal?.cancelled) return;
        if (onAuthError(e)) return;
        setErr(e instanceof Error ? e.message : String(e));
      }
    },
    [onAuthError],
  );

  // Poll current sessions on mount + every 5s.
  useEffect(() => {
    const signal = { cancelled: false };
    void load(signal);
    const id = setInterval(() => void load(signal), 5000);
    return () => {
      signal.cancelled = true;
      clearInterval(id);
    };
  }, [load]);

  // Live clock — ticks each second for duration display.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const stopRef = useRef(false);
  async function stopSession(sessionId: string) {
    if (stopRef.current) return;
    stopRef.current = true;
    setStopping(sessionId);
    setErr(null);
    try {
      await driverPost<unknown>("/api/driver/stop-session", { sessionId });
      await load();
    } catch (e) {
      if (!onAuthError(e)) setErr(e instanceof Error ? e.message : String(e));
    } finally {
      stopRef.current = false;
      setStopping(null);
    }
  }

  const active = sessions ?? [];

  return (
    <>
      <div className="head">
        <div>
          <h1>Hleðsla</h1>
          <p>Fylgstu með virkri hleðslu í rauntíma. Hleðsla er hafin í Straumvakt appinu.</p>
        </div>
      </div>

      {err && (
        <div
          className="card"
          style={{ padding: "14px 18px", marginBottom: 16, borderColor: "rgba(255,107,107,.4)", color: "var(--red)" }}
        >
          {err}
        </div>
      )}

      {sessions === null && (
        <div className="card" style={{ padding: "14px 18px" }}>
          <span className="sub">Hleð…</span>
        </div>
      )}

      {sessions !== null && active.length === 0 && (
        <div className="card empty" style={{ padding: "40px 18px", textAlign: "center" }}>
          Engin virk hleðsla. Notaðu Straumvakt appið til að hefja hleðslu.
        </div>
      )}

      {active.map((a) => {
        const busy = stopping === a.sessionId;
        return (
          <div key={a.sessionId} className="card" style={{ marginBottom: 16, borderColor: "rgba(43,182,232,.4)" }}>
            <div className="card-h">
              {a.chargerName}
              <span className="badge2 s-live">
                <span className="dot bg-live" />Í hleðslu
              </span>
            </div>

            <div className="grid g4" style={{ padding: "14px 18px" }}>
              <div className="kpi">
                <div className="lbl">Afl</div>
                <div className="val grad">{a.powerKw} kW</div>
              </div>
              <div className="kpi">
                <div className="lbl">Orka</div>
                <div className="val">{a.energyKwh} kWh</div>
              </div>
              <div className="kpi">
                <div className="lbl">Kostnaður</div>
                <div className="val">{kr(a.costIsk)}</div>
              </div>
              <div className="kpi">
                <div className="lbl">Tími</div>
                <div className="val mono">{fmtDuration(a.startedAt, now)}</div>
              </div>
            </div>

            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 16,
                flexWrap: "wrap",
                padding: "0 18px 16px",
              }}
            >
              <span className="sub">Hófst kl. {a.startedAt.slice(11, 16)}</span>
              <div style={{ flex: 1 }} />
              <button className="btn primary" disabled={busy} onClick={() => void stopSession(a.sessionId)}>
                {busy ? "Stöðva…" : "Stöðva hleðslu"}
              </button>
            </div>
          </div>
        );
      })}
    </>
  );
}
