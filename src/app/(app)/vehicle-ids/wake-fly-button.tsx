"use client";

// Sprint 9.3 / 2026-05-09 — operator-side keepalive trigger for the
// Fly consumer. Clicking the button (a) wakes the machine if Fly's
// free-tier auto-suspended it AND (b) reports the current /health
// status so the operator can verify the consumer is awake before a
// plug-in test.

import { useState } from "react";
import { apiFetch } from "@/lib/api-client";

interface FlyHealth {
  ok: boolean;
  listeners: number;
  connected: number;
  installations?: Array<{
    installationId: string;
    installationName?: string;
    state: string;
    messagesReceived: number;
    errorsSeen: number;
    lastMessageAt: string | null;
    connectedAt: string | null;
  }>;
}

interface ProbeResponse {
  alive: boolean;
  health?: FlyHealth | null;
  elapsedMs?: number;
  error?: string;
  status?: number;
  detail?: string;
}

function formatRelative(iso: string | null | undefined): string {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 0) return "just now";
  if (ms < 60_000) return `${Math.round(ms / 1000)}s ago`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m ago`;
  return `${Math.round(ms / 3_600_000)}h ago`;
}

export function WakeFlyButton() {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ProbeResponse | null>(null);

  async function probe() {
    setBusy(true);
    setResult(null);
    try {
      const res = await apiFetch(`/api/admin/vehicles/fly-health`);
      const data = (await res.json().catch(() => null)) as ProbeResponse | null;
      setResult(data ?? { alive: false, error: "no_response" });
    } catch (err) {
      setResult({
        alive: false,
        error: "fetch_failed",
        detail: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <button
        type="button"
        onClick={probe}
        disabled={busy}
        className="rounded-md bg-sv-sky/15 px-3 py-1.5 text-xs font-medium text-sv-sky ring-1 ring-sv-sky/30 hover:bg-sv-sky/25 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {busy ? "Probing Fly… (cold start may take 15s)" : "Wake & check Fly consumer"}
      </button>

      {result && !busy && (
        <div className="flex flex-wrap items-center gap-2">
          {result.alive && result.health?.ok ? (
            <span className="rounded-full bg-emerald-500/15 px-3 py-1 text-xs font-semibold text-emerald-300 ring-1 ring-inset ring-emerald-500/30">
              ✓ alive
            </span>
          ) : (
            <span className="rounded-full bg-rose-500/15 px-3 py-1 text-xs font-semibold text-rose-300 ring-1 ring-inset ring-rose-500/30">
              ✗ {result.error ?? "down"}
            </span>
          )}

          {result.elapsedMs !== undefined && (
            <span className="text-[10px] text-ink-500">
              probe took {(result.elapsedMs / 1000).toFixed(1)}s
            </span>
          )}

          {result.health?.installations?.[0] && (
            <span className="text-[11px] text-ink-300">
              {result.health.installations[0].state} ·{" "}
              {result.health.installations[0].messagesReceived} msgs · last{" "}
              {formatRelative(result.health.installations[0].lastMessageAt)} · connected{" "}
              {formatRelative(result.health.installations[0].connectedAt)}
            </span>
          )}

          {result.health?.installations?.[0]?.errorsSeen !== undefined &&
            result.health.installations[0].errorsSeen > 0 && (
              <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-300 ring-1 ring-inset ring-amber-500/30">
                {result.health.installations[0].errorsSeen} errors
              </span>
            )}

          {result.detail && (
            <span className="text-[10px] text-rose-300/70" title={result.detail}>
              {result.detail.slice(0, 50)}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
