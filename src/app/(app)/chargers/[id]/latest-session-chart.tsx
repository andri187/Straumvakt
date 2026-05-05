// Sprint 8.4.2 — latest-session timeline panel on the charger
// detail page. Pulls the most recent session for this charger and
// renders the same SVG chart used by /charge-log's session-detail
// modal. Sits between the technical-read pills and the
// Connectors & commands panel.
//
// Server component: fetches via /api/admin/billing/sessions
// (filtered to chargingStationId=...&limit=1) to find the latest,
// then /api/admin/billing/sessions/:id to get the parsed time
// series (intervals derived from EnergyDetails or OCMF).

import Link from "next/link";
import { apiFetchServer } from "@/lib/api-client-server";
import { ChargeChart, type PowerInterval } from "@/app/(app)/charge-log/charge-chart";

interface LatestList {
  sessions: Array<{
    sessionId: string;
    startedAt: string;
    stoppedAt: string | null;
    energyKwh: string;
    costFormatted: string | null;
  }>;
}

interface SessionDetail {
  sessionId: string;
  startedAt: string;
  endedAt: string | null;
  durationSec: number | null;
  energyKwh: string;
  costFormatted: string | null;
  stopReason: string | null;
  driverIdTag: string | null;
  timeSeriesSource: "ocmf" | "energyDetails" | null;
  intervals: PowerInterval[];
}

function formatDuration(sec: number | null): string {
  if (sec === null) return "—";
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m`;
  return `${sec}s`;
}

export async function LatestSessionChart({
  chargingStationId,
}: {
  chargingStationId: string;
}) {
  const listRes = await apiFetchServer(
    `/api/admin/billing/sessions?chargingStationId=${encodeURIComponent(chargingStationId)}&limit=1`,
  );
  if (!listRes.ok) {
    // Gracefully degrade — the rest of the page still renders.
    return null;
  }
  const list = (await listRes.json()) as LatestList;
  const latest = list.sessions[0];
  if (!latest) {
    return (
      <section className="mb-6 rounded-lg border border-bg-border bg-bg-base/30 p-4">
        <h2 className="mb-1 text-sm font-semibold text-ink-50">
          Latest charging session
        </h2>
        <p className="text-xs text-ink-500">
          No closed sessions yet for this charger. Sessions appear once
          their <span className="font-mono">EndDateTime</span> is stamped on
          Zaptec&apos;s side and our 5-min cron picks them up — or sub-second
          via the AMQP consumer once it&apos;s deployed.
        </p>
      </section>
    );
  }

  const detailRes = await apiFetchServer(
    `/api/admin/billing/sessions/${latest.sessionId}`,
  );
  if (!detailRes.ok) return null;
  const { session } = (await detailRes.json()) as { session: SessionDetail };

  return (
    <section className="mb-6 rounded-lg border border-bg-border bg-bg-base/30 p-4">
      <header className="mb-3 flex items-baseline justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-ink-50">
            Latest charging session
          </h2>
          <p className="mt-0.5 text-[11px] text-ink-500">
            {new Date(session.startedAt).toLocaleString()}
            {session.endedAt && (
              <> → {new Date(session.endedAt).toLocaleString()}</>
            )}
            {" · "}
            {formatDuration(session.durationSec)}
            {" · "}
            {Number(session.energyKwh).toFixed(2)} kWh
            {session.costFormatted && (
              <>
                {" · "}
                <span className="font-mono text-ink-300">
                  {session.costFormatted}
                </span>
              </>
            )}
            {session.driverIdTag && (
              <>
                {" · "}
                {session.driverIdTag}
              </>
            )}
          </p>
        </div>
        <Link
          href={"/charge-log" as Parameters<typeof Link>[0]["href"]}
          className="text-[11px] text-sv-sky hover:underline"
        >
          All sessions →
        </Link>
      </header>

      <ChargeChart
        intervals={session.intervals}
        source={session.timeSeriesSource}
        compact
      />
    </section>
  );
}
