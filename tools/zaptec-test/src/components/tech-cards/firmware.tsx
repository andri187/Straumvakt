import { Download, CheckCircle2, AlertCircle } from "lucide-react";
import type { ChargerFirmwareEntry } from "@/lib/zaptec";
import { cn } from "@/lib/cn";

export function FirmwareCard({
  entries,
  currentChargerId,
}: {
  entries: ChargerFirmwareEntry[];
  currentChargerId: string;
}) {
  const upToDate = entries.filter((e) => e.IsUpToDate).length;
  const total = entries.length;
  const me = entries.find((e) => e.ChargerId === currentChargerId);

  // Group by current version
  const versionCounts = new Map<string, number>();
  for (const e of entries) {
    const v = e.CurrentVersion ?? "unknown";
    versionCounts.set(v, (versionCounts.get(v) ?? 0) + 1);
  }
  const versions = Array.from(versionCounts.entries()).sort();

  return (
    <section className="rounded-lg border border-bg-border bg-bg-surface/70 p-5 shadow-card backdrop-blur">
      <header className="mb-3 flex items-center gap-2">
        <Download className="h-4 w-4 text-sv-sky" />
        <h3 className="text-sm font-semibold text-ink-50">Firmware</h3>
        <span className="ml-auto text-[10px] uppercase tracking-brand text-ink-500">
          /api/chargerFirmware/installation
        </span>
      </header>

      {/* This charger */}
      {me ? (
        <div className="mb-4 rounded-md border border-bg-border bg-bg-inset/50 p-3">
          <p className="text-[10px] uppercase tracking-brand text-ink-500">
            This charger
          </p>
          <div className="mt-1 flex items-center gap-3">
            {me.IsUpToDate ? (
              <CheckCircle2 className="h-4 w-4 text-sv-green" />
            ) : (
              <AlertCircle className="h-4 w-4 text-yellow-300" />
            )}
            <div className="min-w-0 flex-1">
              <p
                className={cn(
                  "text-sm font-semibold",
                  me.IsUpToDate ? "text-sv-green" : "text-yellow-100",
                )}
              >
                {me.IsUpToDate ? "Up to date" : "Update available"}
              </p>
              <p className="text-[11px] text-ink-400">
                Running{" "}
                <span className="font-mono text-ink-200">
                  {me.CurrentVersion ?? "—"}
                </span>{" "}
                · available{" "}
                <span className="font-mono text-ink-200">
                  {me.AvailableVersion ?? "—"}
                </span>
              </p>
            </div>
          </div>
        </div>
      ) : null}

      {/* Fleet summary */}
      <div className="mb-3 flex items-baseline gap-3 text-xs">
        <span className="text-ink-400">Installation fleet:</span>
        <span
          className={cn(
            "font-semibold tabular-nums",
            upToDate === total ? "text-sv-green" : "text-yellow-200",
          )}
        >
          {upToDate} / {total} up to date
        </span>
      </div>

      <ul className="space-y-1 text-xs">
        {versions.map(([version, count]) => (
          <li
            key={version}
            className="flex items-center justify-between rounded bg-bg-inset/40 px-3 py-1.5"
          >
            <span className="font-mono text-ink-200">{version}</span>
            <span className="text-ink-400">
              {count} charger{count === 1 ? "" : "s"}
            </span>
          </li>
        ))}
      </ul>

      {/* Outdated chargers list */}
      {upToDate < total ? (
        <details className="mt-3 text-xs">
          <summary className="cursor-pointer text-sv-sky">
            Show {total - upToDate} outdated charger
            {total - upToDate === 1 ? "" : "s"}
          </summary>
          <ul className="mt-2 divide-y divide-bg-border rounded border border-bg-border">
            {entries
              .filter((e) => !e.IsUpToDate)
              .map((e) => (
                <li
                  key={e.ChargerId}
                  className="flex items-center justify-between px-3 py-1.5"
                >
                  <span className="font-mono text-ink-200">{e.DeviceId}</span>
                  <span className="text-ink-400">
                    {e.CurrentVersion} → {e.AvailableVersion}
                  </span>
                </li>
              ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}
