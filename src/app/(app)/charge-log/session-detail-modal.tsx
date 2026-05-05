"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api-client";

interface PowerInterval {
  timestamp: string;
  durationSec: number;
  avgPowerKw: number;
  cumulativeKwh: number;
  charging: boolean;
}

interface SessionDetail {
  sessionId: string;
  orgId: string;
  orgDisplayName: string | null;
  siteId: string | null;
  siteDisplayName: string | null;
  chargingStationId: string | null;
  chargerDisplayName: string | null;
  chargerSerial: string | null;
  chargerFirmware: string | null;
  driverIdTag: string | null;
  driverUserId: string | null;
  startedAt: string;
  endedAt: string | null;
  durationSec: number | null;
  energyKwh: string;
  costIskMinor: string | null;
  costFormatted: string | null;
  stopReason: string | null;
  timeSeriesSource: "ocmf" | "energyDetails" | null;
  intervals: PowerInterval[];
  driverAvailable: boolean;
}

function formatDuration(sec: number | null): string {
  if (sec === null) return "—";
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function formatTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString();
}

function formatHHmm(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}

export function SessionDetailModal({
  sessionId,
  onClose,
}: {
  sessionId: string;
  onClose: () => void;
}) {
  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    apiFetch(`/api/admin/billing/sessions/${sessionId}`)
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const body = (await r.json()) as { session: SessionDetail };
        if (!cancelled) setDetail(body.session);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="my-8 w-full max-w-3xl rounded-lg border border-bg-border bg-bg-base p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-ink-50">Session details</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-bg-border px-2 py-1 text-xs text-ink-300 hover:bg-bg-base/50"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {loading && (
          <p className="text-sm text-ink-400">Loading session…</p>
        )}
        {error && (
          <p className="rounded border border-rose-700/40 bg-rose-950/30 p-3 text-sm text-rose-200">
            {error}
          </p>
        )}

        {detail && (
          <>
            <dl className="mb-6 grid grid-cols-[8rem_1fr] gap-x-4 gap-y-1.5 text-xs">
              <dt className="text-ink-500">ID</dt>
              <dd className="font-mono text-ink-200">{detail.sessionId}</dd>

              <dt className="text-ink-500">Charger</dt>
              <dd className="text-ink-100">
                {detail.chargerDisplayName ?? "—"}
                {detail.chargerSerial && (
                  <span className="ml-2 font-mono text-[10px] text-ink-500">
                    / {detail.chargerSerial}
                  </span>
                )}
                {detail.chargerFirmware && (
                  <span className="ml-2 text-[10px] text-ink-500">
                    fw {detail.chargerFirmware}
                  </span>
                )}
              </dd>

              <dt className="text-ink-500">Site / Org</dt>
              <dd className="text-ink-200">
                {detail.siteDisplayName ?? "—"}
                {detail.orgDisplayName && (
                  <span className="ml-2 text-[10px] text-ink-500">
                    {detail.orgDisplayName}
                  </span>
                )}
              </dd>

              <dt className="text-ink-500">Started</dt>
              <dd className="text-ink-200">{formatTime(detail.startedAt)}</dd>

              <dt className="text-ink-500">Ended</dt>
              <dd className="text-ink-200">{formatTime(detail.endedAt)}</dd>

              <dt className="text-ink-500">Duration</dt>
              <dd className="text-ink-200">
                {formatDuration(detail.durationSec)}
              </dd>

              <dt className="text-ink-500">Energy</dt>
              <dd className="text-ink-100">
                {Number(detail.energyKwh).toFixed(3)} kWh
              </dd>

              <dt className="text-ink-500">Cost</dt>
              <dd className="font-mono text-ink-100">
                {detail.costFormatted ?? "—"}
              </dd>

              <dt className="text-ink-500">Driver</dt>
              <dd className="text-ink-200">
                {detail.driverIdTag ?? (
                  <span className="text-ink-500">
                    (anonymous — Native auth)
                  </span>
                )}
              </dd>

              <dt className="text-ink-500">Stop reason</dt>
              <dd>
                <span
                  className={
                    "rounded px-1.5 py-0.5 text-[10px] " +
                    (detail.stopReason === "Completed" ||
                    detail.stopReason === "Local" ||
                    detail.stopReason === "EVDisconnected"
                      ? "bg-emerald-950/40 text-emerald-300"
                      : "bg-amber-950/30 text-amber-300")
                  }
                >
                  {detail.stopReason ?? "—"}
                </span>
              </dd>
            </dl>

            <ChargeChart intervals={detail.intervals} source={detail.timeSeriesSource} />
          </>
        )}
      </div>
    </div>
  );
}

/**
 * Simple SVG chart: power bars (avg kW per interval) + cumulative
 * kWh line. Mirrors the Zaptec portal style. SOC line not shown
 * because Zaptec REST/AMQP don't expose battery SOC for Native-auth
 * installations — would require OCPP MeterValues with the SoC
 * measurand.
 */
function ChargeChart({
  intervals,
  source,
}: {
  intervals: PowerInterval[];
  source: "ocmf" | "energyDetails" | null;
}) {
  if (intervals.length === 0) {
    return (
      <p className="rounded border border-dashed border-bg-border p-4 text-center text-xs text-ink-500">
        No time-series data for this session.
      </p>
    );
  }

  const W = 700;
  const H = 280;
  const PAD_L = 40;
  const PAD_R = 40;
  const PAD_T = 20;
  const PAD_B = 36;
  const innerW = W - PAD_L - PAD_R;
  const innerH = H - PAD_T - PAD_B;

  const peakKw = Math.max(1, ...intervals.map((i) => i.avgPowerKw));
  const totalKwh = Math.max(0.001, intervals[intervals.length - 1]!.cumulativeKwh);
  const yPowerScale = innerH / (peakKw * 1.15);
  const yKwhScale = innerH / (totalKwh * 1.05);
  const xStep = innerW / intervals.length;

  // Hourly tick labels for the X axis
  const startMs = new Date(intervals[0]!.timestamp).getTime() - intervals[0]!.durationSec * 1000;
  const endMs = new Date(intervals[intervals.length - 1]!.timestamp).getTime();
  const totalMs = endMs - startMs;
  const xForTime = (t: number): number =>
    PAD_L + (innerW * (t - startMs)) / totalMs;
  const ticks: { x: number; label: string }[] = [];
  // every 1h between start and end
  for (let t = Math.ceil(startMs / 3600000) * 3600000; t <= endMs; t += 3600000) {
    ticks.push({ x: xForTime(t), label: formatHHmm(new Date(t).toISOString()) });
  }

  // Cumulative kWh line points
  const linePoints = intervals
    .map(
      (it) =>
        `${xForTime(new Date(it.timestamp).getTime())},${PAD_T + innerH - it.cumulativeKwh * yKwhScale}`,
    )
    .join(" ");

  return (
    <section>
      <div className="mb-2 flex items-baseline justify-between">
        <h3 className="text-[11px] uppercase tracking-brand text-ink-400">
          Average power (kW) · cumulative kWh
        </h3>
        <span className="text-[10px] text-ink-500">
          {intervals.length} intervals · {source === "ocmf" ? "OCMF-derived" : source === "energyDetails" ? "EnergyDetails" : "—"}
        </span>
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full max-w-full text-ink-300"
        role="img"
        aria-label="Charging session timeline"
      >
        {/* Y axis labels — left (kW) */}
        {Array.from({ length: 5 }, (_, i) => i * Math.ceil(peakKw / 4)).map(
          (val, i) => (
            <g key={`yL${i}`}>
              <line
                x1={PAD_L}
                x2={W - PAD_R}
                y1={PAD_T + innerH - val * yPowerScale}
                y2={PAD_T + innerH - val * yPowerScale}
                stroke="currentColor"
                strokeOpacity="0.1"
                strokeWidth={1}
              />
              <text
                x={PAD_L - 6}
                y={PAD_T + innerH - val * yPowerScale + 3}
                fontSize="9"
                textAnchor="end"
                fill="currentColor"
                opacity="0.6"
              >
                {val}
              </text>
            </g>
          ),
        )}
        {/* Y axis labels — right (kWh) */}
        {[0, 0.25, 0.5, 0.75, 1].map((frac, i) => {
          const val = totalKwh * frac;
          return (
            <text
              key={`yR${i}`}
              x={W - PAD_R + 6}
              y={PAD_T + innerH - val * yKwhScale + 3}
              fontSize="9"
              textAnchor="start"
              fill="currentColor"
              opacity="0.5"
            >
              {val.toFixed(0)}
            </text>
          );
        })}

        {/* Power bars */}
        {intervals.map((it, i) => {
          const tEnd = new Date(it.timestamp).getTime();
          const tStart = tEnd - it.durationSec * 1000;
          const x = xForTime(tStart);
          const w = Math.max(1, xForTime(tEnd) - x - 1);
          const barH = it.avgPowerKw * yPowerScale;
          return (
            <rect
              key={i}
              x={x}
              y={PAD_T + innerH - barH}
              width={w}
              height={barH}
              fill={it.charging ? "#7dd3fc" : "#94a3b8"}
              opacity={it.charging ? 0.85 : 0.4}
            >
              <title>
                {formatHHmm(new Date(tStart).toISOString())}–{formatHHmm(it.timestamp)}: {it.avgPowerKw.toFixed(2)} kW · cum {it.cumulativeKwh.toFixed(2)} kWh
              </title>
            </rect>
          );
        })}

        {/* Cumulative kWh polyline */}
        <polyline
          fill="none"
          stroke="#facc15"
          strokeWidth={2}
          points={linePoints}
        />
        {intervals.map((it, i) => (
          <circle
            key={`p${i}`}
            cx={xForTime(new Date(it.timestamp).getTime())}
            cy={PAD_T + innerH - it.cumulativeKwh * yKwhScale}
            r={2}
            fill="#facc15"
          />
        ))}

        {/* X axis labels */}
        <line
          x1={PAD_L}
          x2={W - PAD_R}
          y1={PAD_T + innerH}
          y2={PAD_T + innerH}
          stroke="currentColor"
          strokeOpacity="0.3"
        />
        {ticks.map((t, i) => (
          <g key={`tk${i}`}>
            <line
              x1={t.x}
              x2={t.x}
              y1={PAD_T + innerH}
              y2={PAD_T + innerH + 4}
              stroke="currentColor"
              strokeOpacity="0.4"
            />
            <text
              x={t.x}
              y={PAD_T + innerH + 16}
              fontSize="10"
              textAnchor="middle"
              fill="currentColor"
              opacity="0.6"
            >
              {t.label}
            </text>
          </g>
        ))}
      </svg>

      <div className="mt-2 flex items-center gap-4 text-[10px] text-ink-500">
        <span className="flex items-center gap-1">
          <span className="inline-block h-2 w-2 rounded-sm bg-sky-400" /> kW (charging)
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-2 w-2 rounded-sm bg-slate-500/50" /> kW (idle)
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-0.5 w-3 bg-amber-400" /> cumulative kWh
        </span>
        <span className="ml-auto text-ink-500/70">
          SOC unavailable — needs OCPP MeterValues or vendor exposure
        </span>
      </div>
    </section>
  );
}
