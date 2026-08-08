"use client";

// Sprint 9 / 2026-05-08 — power-vs-time chart from AMQP-derived
// live_session_samples (StateId 513 power + 553 energy observations).
// Denser than the OCMF intervals (which arrive at most every 15 min);
// these can be every 5-30s during active charging.

import { useMemo } from "react";

interface Sample {
  observedAt: string;
  powerW: number | null;
  energyWh: number | null;
  stateId: number;
}

export function SamplePowerChart({ samples }: { samples: Sample[] }) {
  // Filter to power samples only for the line; energy samples are
  // surfaced as small markers so the operator can see the cumulative
  // count points.
  const powerSamples = useMemo(
    () =>
      samples
        .filter(
          (s): s is Sample & { powerW: number } => s.powerW != null && s.powerW >= 0
        )
        .map((s) => ({ ...s, t: new Date(s.observedAt).getTime() })),
    [samples]
  );

  const energySamples = useMemo(
    () =>
      samples
        .filter(
          (s): s is Sample & { energyWh: number } =>
            s.energyWh != null && s.energyWh >= 0
        )
        .map((s) => ({ ...s, t: new Date(s.observedAt).getTime() })),
    [samples]
  );

  if (powerSamples.length < 2) {
    return (
      <p className="text-sm italic text-ink-500">
        Not enough power samples to draw a chart (need at least 2).
      </p>
    );
  }

  const W = 800;
  const H = 200;
  const PAD_L = 50;
  const PAD_R = 16;
  const PAD_T = 16;
  const PAD_B = 28;
  const innerW = W - PAD_L - PAD_R;
  const innerH = H - PAD_T - PAD_B;

  const t0 = powerSamples[0]!.t;
  const tN = powerSamples[powerSamples.length - 1]!.t;
  const dt = Math.max(1, tN - t0);
  const maxP = Math.max(...powerSamples.map((p) => p.powerW), 1);

  const x = (t: number) => PAD_L + ((t - t0) / dt) * innerW;
  const y = (p: number) => PAD_T + innerH - (p / maxP) * innerH;

  const path = powerSamples
    .map((p, i) => `${i === 0 ? "M" : "L"} ${x(p.t).toFixed(1)} ${y(p.powerW).toFixed(1)}`)
    .join(" ");

  const peak = Math.round(maxP);
  const startedAt = new Date(t0);
  const endedAt = new Date(tN);

  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-xs text-ink-500">
        <span>Power · {powerSamples.length} samples · {energySamples.length} energy markers</span>
        <span className="font-mono">peak {(peak / 1000).toFixed(2)} kW</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-48 w-full">
        {/* Y-axis grid + labels */}
        {[0, 0.25, 0.5, 0.75, 1].map((frac) => {
          const yVal = PAD_T + (1 - frac) * innerH;
          const labelKw = ((maxP * frac) / 1000).toFixed(1);
          return (
            <g key={frac}>
              <line
                x1={PAD_L}
                x2={W - PAD_R}
                y1={yVal}
                y2={yVal}
                stroke="#1e293b"
                strokeWidth="1"
              />
              <text
                x={PAD_L - 6}
                y={yVal + 3}
                fill="#64748b"
                fontSize="9"
                textAnchor="end"
                fontFamily="ui-monospace, Consolas, monospace"
              >
                {labelKw} kW
              </text>
            </g>
          );
        })}

        {/* X-axis labels */}
        <text
          x={PAD_L}
          y={H - 8}
          fill="#64748b"
          fontSize="9"
          fontFamily="ui-monospace, Consolas, monospace"
        >
          {startedAt.toLocaleTimeString()}
        </text>
        <text
          x={W - PAD_R}
          y={H - 8}
          fill="#64748b"
          fontSize="9"
          textAnchor="end"
          fontFamily="ui-monospace, Consolas, monospace"
        >
          {endedAt.toLocaleTimeString()}
        </text>

        {/* Power line */}
        <path d={path} fill="none" stroke="#34d399" strokeWidth="1.5" />

        {/* Power sample dots — small */}
        {powerSamples.map((p, i) => (
          <circle key={`p-${i}`} cx={x(p.t)} cy={y(p.powerW)} r="1.5" fill="#34d399" />
        ))}

        {/* Energy sample markers — purple, on the X-axis */}
        {energySamples.map((e, i) => (
          <line
            key={`e-${i}`}
            x1={x(e.t)}
            x2={x(e.t)}
            y1={H - PAD_B}
            y2={H - PAD_B + 4}
            stroke="#c084fc"
            strokeWidth="1"
          >
            <title>
              {new Date(e.observedAt).toLocaleTimeString()} · {(e.energyWh / 1000).toFixed(3)} kWh
            </title>
          </line>
        ))}
      </svg>

      <div className="mt-2 flex flex-wrap gap-3 text-[10px] text-ink-500">
        <span className="flex items-center gap-1">
          <span className="inline-block h-0.5 w-3 bg-emerald-400" />
          power (W) — StateId 513
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-2 w-px bg-purple-400" />
          energy reading marker — StateId 553
        </span>
      </div>
    </div>
  );
}
