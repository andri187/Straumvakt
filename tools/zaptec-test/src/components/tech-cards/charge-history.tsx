import { History, ShieldCheck } from "lucide-react";
import type { ChargeHistoryEntry } from "@/lib/zaptec";
import { cn } from "@/lib/cn";

function fmtDuration(start: string, end?: string): string {
  if (!end) return "—";
  const ms = new Date(end).getTime() - new Date(start).getTime();
  if (!Number.isFinite(ms) || ms <= 0) return "—";
  const min = Math.round(ms / 60000);
  if (min < 60) return `${min}m`;
  return `${Math.floor(min / 60)}h ${min % 60}m`;
}

function fmtVersion(v?: ChargeHistoryEntry["ChargerFirmwareVersion"]): string {
  if (!v) return "—";
  return `${v.Major}.${v.Minor}.${v.Build}.${v.Revision}`;
}

export function ChargeHistoryCard({
  entries,
  totalPages,
}: {
  entries: ChargeHistoryEntry[];
  totalPages?: number;
}) {
  if (entries.length === 0) {
    return (
      <section className="rounded-lg border border-bg-border bg-bg-surface/70 p-5 shadow-card backdrop-blur">
        <header className="mb-3 flex items-center gap-2">
          <History className="h-4 w-4 text-sv-sky" />
          <h3 className="text-sm font-semibold text-ink-50">Charge history</h3>
        </header>
        <p className="text-xs text-ink-400">
          No completed sessions reported by Zaptec yet.
        </p>
      </section>
    );
  }

  const totalEnergy = entries.reduce((n, e) => n + (e.Energy || 0), 0);

  return (
    <section className="rounded-lg border border-bg-border bg-bg-surface/70 p-5 shadow-card backdrop-blur">
      <header className="mb-3 flex items-center gap-2">
        <History className="h-4 w-4 text-sv-sky" />
        <h3 className="text-sm font-semibold text-ink-50">
          Charge history · last {entries.length}
        </h3>
        <span className="ml-auto text-[10px] uppercase tracking-brand text-ink-500">
          /api/chargehistory
          {totalPages ? ` · ${totalPages} pages total` : null}
        </span>
      </header>

      <div className="mb-3 flex items-baseline gap-3 text-xs">
        <span className="text-ink-400">Sum of last {entries.length}:</span>
        <span className="font-semibold text-sv-green tabular-nums">
          {totalEnergy.toFixed(2)} kWh
        </span>
      </div>

      <div className="overflow-hidden rounded-md border border-bg-border">
        <table className="w-full text-xs">
          <thead className="bg-bg-inset/60 text-left text-[10px] uppercase tracking-brand text-ink-500">
            <tr>
              <th className="px-3 py-1.5 font-medium">Started</th>
              <th className="px-3 py-1.5 font-medium">Duration</th>
              <th className="px-3 py-1.5 font-medium text-right">Energy</th>
              <th className="px-3 py-1.5 font-medium">Firmware</th>
              <th className="px-3 py-1.5 font-medium">Signed</th>
              <th className="px-3 py-1.5 font-medium">External Id</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-bg-border">
            {entries.map((e) => (
              <tr key={e.Id} className="hover:bg-bg-raised/40">
                <td className="px-3 py-1.5 font-mono text-ink-200">
                  {new Date(e.StartDateTime).toLocaleString(undefined, {
                    year: "2-digit",
                    month: "short",
                    day: "2-digit",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </td>
                <td className="px-3 py-1.5 text-ink-300">
                  {fmtDuration(e.StartDateTime, e.EndDateTime)}
                </td>
                <td
                  className={cn(
                    "px-3 py-1.5 text-right font-semibold tabular-nums",
                    e.Energy > 0 ? "text-sv-green" : "text-ink-500",
                  )}
                >
                  {e.Energy.toFixed(3)} kWh
                </td>
                <td className="px-3 py-1.5 font-mono text-[11px] text-ink-300">
                  {fmtVersion(e.ChargerFirmwareVersion)}
                </td>
                <td className="px-3 py-1.5">
                  {e.SignedSession ? (
                    <span
                      className="inline-flex items-center gap-1 text-[11px] text-sv-green"
                      title="OCMF signed"
                    >
                      <ShieldCheck className="h-3 w-3" />
                      OCMF
                    </span>
                  ) : (
                    <span className="text-[11px] text-ink-500">—</span>
                  )}
                </td>
                <td className="px-3 py-1.5 font-mono text-[10px] text-ink-400">
                  {e.ExternalId ?? "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
