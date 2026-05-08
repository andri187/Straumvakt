"use client";

// Sprint 9 / 2026-05-08 — live active-session block for /chargers/[id].
// Polls /api/admin/chargers/:id/active-session every 5s while the tab
// is visible and renders:
//   - mode badge (Charging / Plugged / Disconnected) + driver pill
//   - plug duration / charge duration / non-charge duration
//   - live power + energy
//   - sparkline of recent power samples (from live_session_samples)
//
// Empty / no-active-session state collapses to a one-liner so the page
// height stays stable.

import { useEffect, useState, useRef } from "react";
import { apiFetch } from "@/lib/api-client";

type Sample = {
  observedAt: string;
  powerW: number | null;
  energyWh: number | null;
  stateId: number;
};

type Driver = {
  id: string;
  label: string;
  email: string;
};

type ActiveSessionResponse = {
  activeSession: null | {
    startedAt: string;
    connectedAt: string | null;
    chargingStartedAt: string | null;
    lastObservedAt: string;
    lastOperationMode: number | null;
    lastPowerW: number | null;
    lastSessionEnergyWh: number | null;
    vendorResourceId: string;
    chargingSeconds: number;
    nonChargingSeconds: number;
    plugSeconds: number;
    driver: Driver | null;
    samples: Sample[];
  };
};

// Zaptec OperationMode enum
const MODE_DISCONNECTED = 1;
const MODE_REQUESTING = 2;
const MODE_CHARGING = 3;
const MODE_FINISHED = 5;
const MODE_SUSPENDED = 6;

function modeLabel(m: number | null): string {
  switch (m) {
    case MODE_DISCONNECTED: return "Disconnected";
    case MODE_REQUESTING: return "Requesting";
    case MODE_CHARGING: return "Charging";
    case MODE_FINISHED: return "Finished";
    case MODE_SUSPENDED: return "Suspended";
    case null:
    case undefined: return "Unknown";
    default: return `Mode ${m}`;
  }
}

function modeBadgeClass(m: number | null): string {
  if (m === MODE_CHARGING) return "bg-emerald-400/15 text-emerald-300 ring-emerald-400/30";
  if (m === MODE_REQUESTING || m === MODE_SUSPENDED) return "bg-amber-400/15 text-amber-300 ring-amber-400/30";
  if (m === MODE_FINISHED) return "bg-sv-sky/15 text-sv-sky ring-sv-sky/30";
  return "bg-bg-raised/60 text-ink-300 ring-bg-border";
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m ${s}s`;
}

function formatKwh(wh: number | null): string {
  if (wh === null) return "—";
  return (wh / 1000).toFixed(2) + " kWh";
}

function formatPowerKw(w: number | null): string {
  if (w === null) return "—";
  return (w / 1000).toFixed(2) + " kW";
}

export function ActiveSessionBlock({
  chargingStationId,
}: {
  chargingStationId: string;
}) {
  const [data, setData] = useState<ActiveSessionResponse["activeSession"] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const tickRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function fetchOnce() {
      try {
        const res = await apiFetch(`/api/admin/chargers/${chargingStationId}/active-session`);
        if (!res.ok) {
          if (!cancelled) setError(`HTTP ${res.status}`);
          return;
        }
        const body = (await res.json()) as ActiveSessionResponse;
        if (!cancelled) {
          setData(body.activeSession);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      }
    }

    fetchOnce();

    function start() {
      if (tickRef.current) return;
      tickRef.current = setInterval(fetchOnce, 5000);
    }
    function stop() {
      if (tickRef.current) {
        clearInterval(tickRef.current);
        tickRef.current = null;
      }
    }

    function onVisibility() {
      if (document.hidden) stop();
      else { fetchOnce(); start(); }
    }

    start();
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelled = true;
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [chargingStationId]);

  if (!data) {
    return (
      <section className="mb-6 rounded-lg border border-bg-border bg-bg-base/30 p-4">
        <h2 className="text-sm font-semibold text-ink-50">Active session</h2>
        <p className="mt-1 text-xs text-ink-500">
          {error
            ? `Could not load active session: ${error}`
            : "No active session — charger is disconnected or hasn't reported recent state events."}
        </p>
      </section>
    );
  }

  return (
    <section className="mb-6 rounded-lg border border-emerald-400/30 bg-emerald-400/5 p-4">
      <header className="mb-3 flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-semibold text-ink-50">Active session</h2>
        <span
          className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${modeBadgeClass(data.lastOperationMode)}`}
        >
          {modeLabel(data.lastOperationMode)}
        </span>
        {data.driver ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-sv-sky/15 px-2 py-0.5 text-xs font-medium text-sv-sky ring-1 ring-inset ring-sv-sky/30">
            <span className="font-mono text-[10px] uppercase tracking-wide opacity-70">driver</span>
            {data.driver.label}
          </span>
        ) : null}
        <span className="text-xs text-ink-500">
          last observed {new Date(data.lastObservedAt).toLocaleTimeString()}
        </span>
      </header>

      <dl className="grid grid-cols-2 gap-x-6 gap-y-2 md:grid-cols-4">
        <Stat label="Plug time" value={formatDuration(data.plugSeconds)} hint="connected → now" />
        <Stat
          label="Charging"
          value={formatDuration(data.chargingSeconds)}
          hint={data.chargingStartedAt
            ? `since ${new Date(data.chargingStartedAt).toLocaleTimeString()}`
            : "not yet started"}
          accent="emerald"
        />
        <Stat
          label="Non-charging"
          value={formatDuration(data.nonChargingSeconds)}
          hint="plugged but idle"
          accent="amber"
        />
        <Stat
          label="Energy this session"
          value={formatKwh(data.lastSessionEnergyWh)}
          hint={`live ${formatPowerKw(data.lastPowerW)}`}
        />
      </dl>

      {data.samples.length > 1 ? (
        <div className="mt-4">
          <PowerSparkline samples={data.samples} />
        </div>
      ) : null}
    </section>
  );
}

function Stat({
  label,
  value,
  hint,
  accent,
}: {
  label: string;
  value: string;
  hint?: string;
  accent?: "emerald" | "amber";
}) {
  const valueClass =
    accent === "emerald" ? "text-emerald-300" :
    accent === "amber" ? "text-amber-300" :
    "text-ink-50";
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-ink-500">{label}</dt>
      <dd className={`mt-0.5 font-mono text-base font-semibold ${valueClass}`}>{value}</dd>
      {hint ? <dd className="text-xs text-ink-500">{hint}</dd> : null}
    </div>
  );
}

// Lightweight inline SVG sparkline of power-over-time. Only points with
// powerW set are plotted; energy-only samples (StateId 553) are skipped.
function PowerSparkline({ samples }: { samples: Sample[] }) {
  const pts = samples.filter((s): s is Sample & { powerW: number } => s.powerW != null);
  if (pts.length < 2) return null;

  const w = 600;
  const h = 60;
  const t0 = new Date(pts[0]!.observedAt).getTime();
  const tN = new Date(pts[pts.length - 1]!.observedAt).getTime();
  const dt = Math.max(1, tN - t0);
  const maxP = Math.max(...pts.map((p) => p.powerW), 1);

  const path = pts
    .map((p, i) => {
      const x = ((new Date(p.observedAt).getTime() - t0) / dt) * w;
      const y = h - (p.powerW / maxP) * (h - 4) - 2;
      return `${i === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");

  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-xs text-ink-500">
        <span>Power · last {pts.length} samples</span>
        <span className="font-mono">peak {formatPowerKw(maxP)}</span>
      </div>
      <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="h-12 w-full">
        <path d={path} fill="none" stroke="#34d399" strokeWidth="1.5" />
      </svg>
    </div>
  );
}
