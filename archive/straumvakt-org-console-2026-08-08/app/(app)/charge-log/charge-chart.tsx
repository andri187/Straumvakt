// Shared SVG chart for a charging session's time-series. Power bars
// (sky-blue charging, slate-grey idle) plus cumulative-kWh polyline
// (amber). Mirrors the Zaptec portal session-detail style. SOC line
// not drawn — needs OCPP MeterValues with the SoC measurand, which
// Native-auth installations don't expose.
//
// Used by:
//   • /charge-log session-detail modal (every row)
//   • /chargers/[id] latest-session panel (most recent session
//     for this charger, between Signal/Comm/OCPP pills and the
//     Connectors & commands surface)

export interface PowerInterval {
  timestamp: string;
  durationSec: number;
  avgPowerKw: number;
  cumulativeKwh: number;
  charging: boolean;
}

function formatHHmm(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}

export function ChargeChart({
  intervals,
  source,
  /** Render at compact height (e.g. inside a side panel). Defaults to full. */
  compact = false,
}: {
  intervals: PowerInterval[];
  source: "ocmf" | "energyDetails" | null;
  compact?: boolean;
}) {
  if (intervals.length === 0) {
    return (
      <p className="rounded border border-dashed border-bg-border p-4 text-center text-xs text-ink-500">
        No time-series data for this session.
      </p>
    );
  }

  const W = 700;
  const H = compact ? 200 : 280;
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

  const startMs =
    new Date(intervals[0]!.timestamp).getTime() - intervals[0]!.durationSec * 1000;
  const endMs = new Date(intervals[intervals.length - 1]!.timestamp).getTime();
  const totalMs = Math.max(1, endMs - startMs);
  const xForTime = (t: number): number =>
    PAD_L + (innerW * (t - startMs)) / totalMs;
  const ticks: { x: number; label: string }[] = [];
  for (let t = Math.ceil(startMs / 3600000) * 3600000; t <= endMs; t += 3600000) {
    ticks.push({ x: xForTime(t), label: formatHHmm(new Date(t).toISOString()) });
  }

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
          {intervals.length} intervals ·{" "}
          {source === "ocmf"
            ? "OCMF-derived"
            : source === "energyDetails"
              ? "EnergyDetails"
              : "—"}
        </span>
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full max-w-full text-ink-300"
        role="img"
        aria-label="Charging session timeline"
      >
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
                {formatHHmm(new Date(tStart).toISOString())}–
                {formatHHmm(it.timestamp)}: {it.avgPowerKw.toFixed(2)} kW · cum{" "}
                {it.cumulativeKwh.toFixed(2)} kWh
              </title>
            </rect>
          );
        })}

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
      </div>
    </section>
  );
}
