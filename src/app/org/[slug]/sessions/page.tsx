"use client";

import { useEffect, useState } from "react";
import { apiFetchJson } from "@/lib/api-client";
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

  useEffect(() => {
    let cancelled = false;
    apiFetchJson<{ summary: Summary }>(`/api/admin/orgs/${org.id}/sessions`)
      .then((body) => {
        if (!cancelled) setSummary(body.summary);
      })
      .catch((caught) => {
        if (!cancelled)
          setError(caught instanceof Error ? caught.message : String(caught));
      });
    return () => {
      cancelled = true;
    };
  }, [org.id]);

  return (
    <>
      <section className="org-page-head">
        <div>
          <div className="org-eyebrow">Operations</div>
          <h1>Sessions</h1>
          <p>Recent charging activity and source-reported energy.</p>
        </div>
      </section>
      {error ? <div className="org-error">{error}</div> : null}
      <div className="org-grid g4" style={{ marginBottom: 14 }}>
        <SessionMetric
          label="This month"
          value={summary ? String(summary.monthCount) : null}
        />
        <SessionMetric
          label="Energy this month"
          value={
            summary
              ? `${summary.monthEnergyKwh.toLocaleString("en-GB")} kWh`
              : null
          }
          accent
        />
        <SessionMetric
          label="All sessions"
          value={summary ? String(summary.totalCount) : null}
        />
        <SessionMetric
          label="Lifetime energy"
          value={
            summary
              ? `${summary.totalEnergyKwh.toLocaleString("en-GB")} kWh`
              : null
          }
        />
      </div>
      <section className="org-card">
        <div className="org-card-h">
          Recent sessions <span className="sub">latest 10</span>
        </div>
        <div className="org-table-wrap">
          <table>
            <thead>
              <tr>
                <th>Station</th>
                <th>Started</th>
                <th>Energy</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {!summary ? (
                <tr>
                  <td className="empty" colSpan={4}>
                    Loading...
                  </td>
                </tr>
              ) : summary.recent.length === 0 ? (
                <tr>
                  <td className="empty" colSpan={4}>
                    No sessions recorded.
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
                      {session.energyKwh == null
                        ? "Not reported"
                        : `${session.energyKwh.toLocaleString("en-GB")} kWh`}
                    </td>
                    <td>
                      <span className="org-badge mut">
                        <span className="dot" />
                        {session.status.replaceAll("_", " ")}
                      </span>
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

function SessionMetric({
  label,
  value,
  accent = false,
}: {
  label: string;
  value: string | null;
  accent?: boolean;
}) {
  return (
    <div className="org-card org-kpi">
      <div className="lbl">{label}</div>
      <div className={`val${accent ? " accent" : ""}`}>{value ?? "-"}</div>
    </div>
  );
}
