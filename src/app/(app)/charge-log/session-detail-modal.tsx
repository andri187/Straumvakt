"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api-client";
import { ChargeChart, type PowerInterval } from "./charge-chart";

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
  chargeTimeSec: number | null;
  idleTimeSec: number | null;
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

              <dt className="text-ink-500">Plug time</dt>
              <dd className="text-ink-200">
                {formatDuration(detail.durationSec)}
              </dd>

              {/* Sprint 9.2 — split plug time into charging vs idle.
                  Only render when we have per-interval data; otherwise
                  hide the rows so legacy sessions without OCMF /
                  EnergyDetails don't show "—". */}
              {detail.chargeTimeSec !== null && detail.idleTimeSec !== null && (
                <>
                  <dt className="text-ink-500">Charging</dt>
                  <dd className="text-emerald-300">
                    {formatDuration(detail.chargeTimeSec)}
                  </dd>

                  <dt className="text-ink-500">Idle (plugged-in)</dt>
                  <dd className="text-amber-300">
                    {formatDuration(detail.idleTimeSec)}
                  </dd>
                </>
              )}

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
