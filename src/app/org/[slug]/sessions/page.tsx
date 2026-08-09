"use client";

import { useCallback, useEffect, useState } from "react";
import {
  MetricValue,
  ProductEmpty,
  ProductError,
  ProductLoading,
  StatusBadge,
} from "@/components/product-state";
import { apiFetchJson } from "@/lib/api-client";
import {
  formatEnergyKwh,
  normalizeStatus,
  statusTone,
} from "@/lib/product-ui-guards";
import { useOrg } from "../org-shell";

type Session = {
  id: string;
  startedAt: string;
  station: string;
  energyKwh: number | null;
  status: string;
};

type Summary = {
  totalCount: number;
  totalEnergyKwh: number;
  monthCount: number;
  monthEnergyKwh: number;
  recent: Session[];
};

export default function OrgSessionsPage() {
  const { org } = useOrg();
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const body = await apiFetchJson<{ summary: Summary }>(
        `/api/admin/orgs/${org.id}/sessions`,
      );
      setSummary(body.summary);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setLoading(false);
    }
  }, [org.id]);

  useEffect(() => {
    let cancelled = false;
    if (!cancelled) void load();
    return () => {
      cancelled = true;
    };
  }, [load]);

  return (
    <>
      <section className="org-page-head">
        <div>
          <div className="org-eyebrow">Operations</div>
          <h1>Sessions</h1>
          <p>Recent charging activity and source-reported energy.</p>
        </div>
      </section>
      {error ? <ProductError message={error} onRetry={load} /> : null}
      <div className="org-grid g4" style={{ marginBottom: 14 }}>
        <MetricValue
          label="This month"
          value={summary?.monthCount ?? 0}
          loading={loading}
        />
        <MetricValue
          label="Energy this month"
          value={formatEnergyKwh(summary?.monthEnergyKwh ?? null)}
          loading={loading}
          tone="accent"
        />
        <MetricValue
          label="All sessions"
          value={summary?.totalCount ?? 0}
          loading={loading}
        />
        <MetricValue
          label="Lifetime energy"
          value={formatEnergyKwh(summary?.totalEnergyKwh ?? null)}
          loading={loading}
        />
      </div>
      <section className="org-card">
        <div className="org-card-h">
          Recent sessions <span className="sub">latest 10</span>
        </div>
        <div className="org-table-wrap">
          <table>
            <caption className="org-sr-only">
              Recent charging sessions for {org.displayName}
            </caption>
            <thead>
              <tr>
                <th scope="col">Station</th>
                <th scope="col">Started</th>
                <th scope="col">Energy</th>
                <th scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td className="empty" colSpan={4}>
                    <ProductLoading label="Loading recent sessions" />
                  </td>
                </tr>
              ) : !summary ? (
                <tr>
                  <td className="empty" colSpan={4}>
                    <ProductEmpty
                      title="Session summary unavailable"
                      detail="Use Try again above to reload this read-only view."
                    />
                  </td>
                </tr>
              ) : summary.recent.length === 0 ? (
                <tr>
                  <td className="empty" colSpan={4}>
                    <ProductEmpty
                      title="No sessions recorded"
                      detail="Completed and active sessions will appear here."
                    />
                  </td>
                </tr>
              ) : (
                summary.recent.map((session) => (
                  <tr key={session.id}>
                    <td className="mono">{session.station}</td>
                    <td>
                      {new Date(session.startedAt).toLocaleString("en-GB")}
                    </td>
                    <td>
                      {formatEnergyKwh(session.energyKwh)}
                    </td>
                    <td>
                      <StatusBadge
                        label={normalizeStatus(session.status)}
                        tone={statusTone(session.status)}
                      />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
