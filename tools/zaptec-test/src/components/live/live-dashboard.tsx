"use client";

import { Zap, Gauge, Wifi, WifiOff, AlertCircle } from "lucide-react";
import type { StateObservation } from "@/lib/zaptec";
import {
  StateId,
  operationModeFriendly,
  num,
} from "@/lib/zaptec-state";
import { usePolledState } from "./use-polled-state";
import { Sparkline } from "./sparkline";
import { cn } from "@/lib/cn";

function fmtPower(watts: number | null): string {
  if (watts == null) return "—";
  if (watts >= 1000) return `${(watts / 1000).toFixed(2)} kW`;
  return `${Math.round(watts)} W`;
}

export function LiveDashboard({
  chargerId,
  initial,
  compact = false,
}: {
  chargerId: string;
  initial: StateObservation[];
  compact?: boolean;
}) {
  const polled = usePolledState(chargerId, initial, 5000);

  const opMode = polled.current.get(StateId.ChargerOperationMode)?.ValueAsString;
  const friendly = operationModeFriendly(opMode);
  const power = num(polled.current.get(StateId.TotalChargePower)?.ValueAsString);
  const sessionKwh = num(
    polled.current.get(StateId.TotalChargePowerSession)?.ValueAsString,
  );
  const setA = num(polled.current.get(StateId.ChargeCurrentSet)?.ValueAsString);
  const maxA = num(polled.current.get(StateId.ChargerMaxCurrent)?.ValueAsString);
  const isOnline = polled.current.get(StateId.IsOnline)?.ValueAsString === "1";

  const i1 = num(polled.current.get(StateId.CurrentPhase1)?.ValueAsString);
  const i2 = num(polled.current.get(StateId.CurrentPhase2)?.ValueAsString);
  const i3 = num(polled.current.get(StateId.CurrentPhase3)?.ValueAsString);
  const v1 = num(polled.current.get(StateId.VoltagePhase1)?.ValueAsString);
  const v2 = num(polled.current.get(StateId.VoltagePhase2)?.ValueAsString);
  const v3 = num(polled.current.get(StateId.VoltagePhase3)?.ValueAsString);

  const powerSeries = polled.series.get(StateId.TotalChargePower) ?? [];
  const i1Series = polled.series.get(StateId.CurrentPhase1) ?? [];
  const i2Series = polled.series.get(StateId.CurrentPhase2) ?? [];
  const i3Series = polled.series.get(StateId.CurrentPhase3) ?? [];

  const lastUpdateAgo = polled.lastUpdate
    ? Math.max(0, Math.round((Date.now() - polled.lastUpdate) / 1000))
    : null;

  const toneRing = {
    green: "ring-sv-green/30 bg-sv-green/5",
    blue: "ring-brand-500/30 bg-brand-500/5",
    amber: "ring-yellow-500/30 bg-yellow-500/5",
    grey: "ring-ink-500/30 bg-ink-600/10",
  }[friendly.tone];
  const toneText = {
    green: "text-sv-green",
    blue: "text-sv-sky",
    amber: "text-yellow-300",
    grey: "text-ink-300",
  }[friendly.tone];

  return (
    <div className="space-y-4">
      {/* Status + live power hero */}
      <div
        className={cn(
          "overflow-hidden rounded-xl ring-1 ring-inset",
          toneRing,
        )}
      >
        <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              {isOnline ? (
                <Wifi className="h-4 w-4 text-sv-green" />
              ) : (
                <WifiOff className="h-4 w-4 text-red-300" />
              )}
              <span
                className={cn(
                  "rounded-full px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-brand ring-1 ring-inset",
                  toneText,
                  friendly.tone === "green"
                    ? "ring-sv-green/30 bg-sv-green/10"
                    : friendly.tone === "blue"
                      ? "ring-brand-500/30 bg-brand-500/10"
                      : friendly.tone === "amber"
                        ? "ring-yellow-500/30 bg-yellow-500/10"
                        : "ring-ink-500/30 bg-ink-600/20",
                )}
              >
                {friendly.short}
              </span>
              {lastUpdateAgo != null ? (
                <span className="text-[11px] text-ink-500">
                  updated {lastUpdateAgo}s ago
                </span>
              ) : null}
              {polled.error ? (
                <span className="inline-flex items-center gap-1 text-[11px] text-yellow-300">
                  <AlertCircle className="h-3 w-3" />
                  {polled.error}
                </span>
              ) : null}
            </div>
            <p className={cn("mt-2 text-lg font-semibold", toneText)}>
              {friendly.headline}
            </p>
            {sessionKwh != null && sessionKwh > 0 ? (
              <p className="mt-1 text-xs text-ink-400">
                <Gauge className="mr-1 inline h-3 w-3" />
                {sessionKwh.toFixed(2)} kWh delivered this session
              </p>
            ) : null}
          </div>

          {!compact ? (
            <div className="flex items-end gap-4">
              <div className="text-right">
                <div className="flex items-center justify-end gap-1 text-xs uppercase tracking-brand text-sv-sky">
                  <Zap className="h-3.5 w-3.5" />
                  Live power
                </div>
                <div
                  className={cn(
                    "mt-1 font-semibold tabular-nums",
                    power && power > 0 ? "text-sv-green text-3xl" : "text-ink-300 text-2xl",
                  )}
                >
                  {fmtPower(power)}
                </div>
                {setA != null && maxA != null ? (
                  <div className="mt-0.5 text-[11px] text-ink-500">
                    allocated {setA} A of {maxA} A max
                  </div>
                ) : null}
              </div>
              <Sparkline
                series={powerSeries}
                width={140}
                height={40}
                color={power && power > 0 ? "#3EE9A7" : "#6B7791"}
              />
            </div>
          ) : null}
        </div>
      </div>

      {/* Phase strip — only in non-compact */}
      {!compact ? (
        <div className="rounded-lg border border-bg-border bg-bg-surface/70 p-4 shadow-card backdrop-blur">
          <div className="mb-3 flex items-center justify-between">
            <h4 className="text-[11px] font-semibold uppercase tracking-brand text-sv-sky">
              Live phase electrical
            </h4>
            <span className="text-[10px] text-ink-500">
              polling every 5s · {powerSeries.length} samples
            </span>
          </div>
          <ul className="space-y-1">
            <PhaseRow label="L1" i={i1} v={v1} series={i1Series} />
            <PhaseRow label="L2" i={i2} v={v2} series={i2Series} />
            <PhaseRow label="L3" i={i3} v={v3} series={i3Series} />
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function PhaseRow({
  label,
  i,
  v,
  series,
}: {
  label: string;
  i: number | null;
  v: number | null;
  series: Array<{ t: number; v: number }>;
}) {
  const flowing = i != null && i > 0.1;
  return (
    <li
      className={cn(
        "grid grid-cols-[32px_64px_64px_1fr] items-center gap-3 rounded-md px-2 py-1.5",
        flowing ? "bg-sv-green/5" : "bg-transparent",
      )}
    >
      <span
        className={cn(
          "text-xs font-semibold uppercase tracking-brand",
          flowing ? "text-sv-green" : "text-ink-500",
        )}
      >
        {label}
      </span>
      <span
        className={cn(
          "font-mono text-sm tabular-nums",
          flowing ? "text-sv-green" : "text-ink-400",
        )}
      >
        {i != null ? `${i.toFixed(1)} A` : "—"}
      </span>
      <span className="font-mono text-xs tabular-nums text-ink-400">
        {v != null ? `${v.toFixed(0)} V` : "—"}
      </span>
      <Sparkline
        series={series}
        width={200}
        height={20}
        color={flowing ? "#3EE9A7" : "#4B566D"}
        showDot={flowing}
      />
    </li>
  );
}
