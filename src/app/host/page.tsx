"use client";

// Host dashboard — client-fetched KPIs for the host's own org, via the
// org-scoped /api/admin/orgs/:id/* endpoints (membership-validated, so a
// host_admin can read them). Client navigation + client fetch = instant
// nav with a loading state, rather than a server round-trip per visit.

import { useEffect, useState } from "react";
import { apiFetchJson } from "@/lib/api-client";
import { useHostOrg } from "./host-shell";

type Charger = { chargingStationId: string; online?: boolean; status?: string | null };
type Counts = { chargers: number; chargersOnline: number; sites: number; installations: number };

export default function HostDashboard() {
  const org = useHostOrg();
  const [counts, setCounts] = useState<Counts | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!org) return;
    let cancelled = false;
    (async () => {
      try {
        const [ch, si, inst] = await Promise.all([
          apiFetchJson<{ chargers: Charger[] }>(`/api/admin/orgs/${org.orgId}/chargers`),
          apiFetchJson<{ sites: unknown[] }>(`/api/admin/orgs/${org.orgId}/sites`),
          apiFetchJson<{ installations: unknown[] }>(`/api/admin/orgs/${org.orgId}/installations`),
        ]);
        if (cancelled) return;
        setCounts({
          chargers: ch.chargers.length,
          chargersOnline: ch.chargers.filter((c) => c.online).length,
          sites: si.sites.length,
          installations: inst.installations.length,
        });
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
      <h1 className="text-2xl font-bold tracking-tight">Mælaborð</h1>
      <p className="mt-1 text-sm text-ink-300">
        Yfirlit yfir hleðslunet {org?.displayName ?? ""}.
      </p>

      {error && (
        <div className="mt-5 rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      )}

      <div className="mt-6 grid grid-cols-2 gap-4 md:grid-cols-4">
        <Kpi label="Stöðvar" value={counts?.chargers} />
        <Kpi label="Nettengdar" value={counts?.chargersOnline} />
        <Kpi label="Svæði" value={counts?.sites} />
        <Kpi label="Uppsetningar" value={counts?.installations} />
      </div>
    </div>
  );
}

function Kpi({ label, value }: { label: string; value: number | undefined }) {
  return (
    <div className="rounded-xl border border-bg-border bg-bg-surface/70 px-4 py-4 shadow-card">
      <div className="text-[11px] uppercase tracking-wider text-ink-400">{label}</div>
      <div className="mt-2 text-3xl font-extrabold tabular-nums">
        {value === undefined ? <span className="text-ink-500">—</span> : value}
      </div>
    </div>
  );
}
