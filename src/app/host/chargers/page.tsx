"use client";

// Host chargers — the host's own org's chargers, read-only (config/tariff
// stay operator-set per ADR 0027). Client-fetched via the org-scoped
// /api/admin/orgs/:id/chargers endpoint.

import { useEffect, useState } from "react";
import { apiFetchJson } from "@/lib/api-client";
import { useHostOrg } from "../host-shell";

type Charger = {
  chargingStationId: string;
  siteDisplayName?: string;
  installationDisplayName?: string | null;
  connectorType?: string;
  online?: boolean;
  status?: string | null;
};

export default function HostChargers() {
  const org = useHostOrg();
  const [rows, setRows] = useState<Charger[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!org) return;
    let cancelled = false;
    (async () => {
      try {
        const r = await apiFetchJson<{ chargers: Charger[] }>(
          `/api/admin/orgs/${org.orgId}/chargers`,
        );
        if (!cancelled) setRows(r.chargers);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [org]);

  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="text-2xl font-bold tracking-tight">Hleðslustöðvar</h1>
      <p className="mt-1 text-sm text-ink-300">
        Stöðvar á þínu neti. Uppsetning og verðskrá eru í höndum Straumvaktar.
      </p>

      {error && (
        <div className="mt-5 rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      )}

      <div className="mt-6 overflow-hidden rounded-lg border border-bg-border bg-bg-surface/70 shadow-card">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-bg-border text-[11px] uppercase tracking-wider text-ink-400">
              <th className="px-4 py-3">Stöð</th>
              <th className="px-4 py-3">Svæði</th>
              <th className="px-4 py-3">Tengi</th>
              <th className="px-4 py-3">Staða</th>
            </tr>
          </thead>
          <tbody>
            {rows === null && (
              <tr>
                <td className="px-4 py-6 text-ink-500" colSpan={4}>
                  Hleð…
                </td>
              </tr>
            )}
            {rows?.length === 0 && (
              <tr>
                <td className="px-4 py-6 text-ink-400" colSpan={4}>
                  Engar stöðvar.
                </td>
              </tr>
            )}
            {rows?.map((c) => (
              <tr key={c.chargingStationId} className="border-b border-bg-border/60 last:border-0">
                <td className="px-4 py-3 font-mono text-xs text-ink-100">{c.chargingStationId}</td>
                <td className="px-4 py-3 text-ink-300">{c.siteDisplayName ?? "—"}</td>
                <td className="px-4 py-3 text-ink-300">{c.connectorType ?? "—"}</td>
                <td className="px-4 py-3">
                  <span
                    className={
                      "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-bold " +
                      (c.online
                        ? "border-sv-green/35 bg-sv-green/10 text-sv-green"
                        : "border-ink-500/30 bg-ink-500/10 text-ink-400")
                    }
                  >
                    {c.online ? "Nettengd" : (c.status ?? "Óþekkt")}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
