import Link from "next/link";
import { Network, Cable, Zap, Wifi, WifiOff } from "lucide-react";
import type { Hierarchy } from "@/lib/zaptec";
import { cn } from "@/lib/cn";

export function InstallationCircuits({
  hierarchy,
  currentChargerId,
}: {
  hierarchy: Hierarchy;
  currentChargerId: string;
}) {
  const circuits = hierarchy.Circuits ?? [];
  const totalChargers = circuits.reduce(
    (n, c) => n + (c.Chargers?.length ?? 0),
    0,
  );
  const totalCurrentCap = circuits.reduce(
    (n, c) => n + (c.MaxCurrent ?? 0),
    0,
  );

  return (
    <section className="rounded-lg border border-bg-border bg-bg-surface/70 p-5 shadow-card backdrop-blur">
      <header className="mb-3 flex items-center gap-2">
        <Network className="h-4 w-4 text-sv-sky" />
        <h3 className="text-sm font-semibold text-ink-50">
          Installation → Circuit → SiteAsset
        </h3>
        <span className="ml-auto text-xs text-ink-400">
          {circuits.length} circuits · {totalChargers} site-assets · {totalCurrentCap} A
        </span>
      </header>
      <p className="mb-3 text-[11px] text-ink-500">
        Live from Zaptec. The circuit tier is not a first-class V3 entity yet —
        it is surfaced here as a load-balancing sub-grouping inside the
        installation.
      </p>

      <div className="space-y-3">
        {circuits.map((c) => {
          const containsCurrent = (c.Chargers ?? []).some(
            (ch) => ch.Id === currentChargerId,
          );
          return (
            <div
              key={c.Id}
              className={cn(
                "rounded-md border bg-bg-inset/50 p-3",
                containsCurrent
                  ? "border-sv-green/40 ring-1 ring-inset ring-sv-green/20"
                  : "border-bg-border",
              )}
            >
              <header className="mb-2 flex items-center gap-2">
                <Cable className="h-3.5 w-3.5 text-sv-sky" />
                <span className="text-sm font-semibold text-ink-50">
                  {c.Name ?? c.Id.slice(0, 8)}
                </span>
                {!c.IsActive ? (
                  <span className="rounded bg-ink-600/20 px-1.5 py-0.5 text-[10px] uppercase tracking-brand text-ink-400">
                    Inactive
                  </span>
                ) : null}
                <span className="ml-auto inline-flex items-center gap-1 text-xs text-ink-300">
                  <Zap className="h-3 w-3 text-sv-sky" />
                  {c.MaxCurrent ?? "—"} A
                </span>
              </header>
              <ul className="grid gap-1 sm:grid-cols-2">
                {(c.Chargers ?? []).map((ch) => {
                  const isCurrent = ch.Id === currentChargerId;
                  return (
                    <li key={ch.Id}>
                      <Link
                        href={`/technician?installation=${hierarchy.Id}&charger=${ch.Id}`}
                        className={cn(
                          "flex items-center gap-2 rounded px-2 py-1 text-xs transition-colors",
                          isCurrent
                            ? "bg-sv-green/10 text-sv-green ring-1 ring-inset ring-sv-green/30"
                            : "text-ink-200 hover:bg-bg-raised",
                        )}
                      >
                        {ch.Active === false ? (
                          <WifiOff className="h-3 w-3 shrink-0 text-ink-500" />
                        ) : (
                          <Wifi className="h-3 w-3 shrink-0 text-sv-green/70" />
                        )}
                        <span className="truncate font-medium">{ch.Name}</span>
                        <span className="ml-auto truncate font-mono text-[10px] text-ink-400">
                          {ch.DeviceId ?? ch.SerialNo ?? ""}
                        </span>
                      </Link>
                    </li>
                  );
                })}
                {(c.Chargers?.length ?? 0) === 0 ? (
                  <li className="px-2 py-1 text-xs text-ink-500">
                    No chargers on this circuit.
                  </li>
                ) : null}
              </ul>
            </div>
          );
        })}
        {circuits.length === 0 ? (
          <p className="text-sm text-ink-400">No circuits returned.</p>
        ) : null}
      </div>
    </section>
  );
}
