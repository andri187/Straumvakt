import { AlertTriangle, ShieldCheck, Bell } from "lucide-react";
import type { StateObservation } from "@/lib/zaptec";
import { StateId } from "@/lib/zaptec-state";
import { decodeWarnings, type DecodedWarning } from "@/lib/zaptec-enums";
import { cn } from "@/lib/cn";

export function AlarmsCard({ state }: { state: StateObservation[] }) {
  const sm = new Map(state.map((s) => [s.StateId, s]));
  const notifRaw = sm.get(StateId.Notifications)?.ValueAsString;
  const warnRaw = sm.get(StateId.Warnings)?.ValueAsString;

  // Both 803 and 804 are bitmasks decoded against SmartWarnings + VarisciteWarnings
  const merged: DecodedWarning[] = [
    ...decodeWarnings(notifRaw),
    ...decodeWarnings(warnRaw),
  ];
  // Dedupe by code
  const seen = new Set<string>();
  const unique = merged.filter((w) =>
    seen.has(w.code) ? false : (seen.add(w.code), true),
  );

  const high = unique.filter((w) => w.severity === "high").length;
  const medium = unique.filter((w) => w.severity === "medium").length;
  const allClear = unique.length === 0;

  return (
    <section
      className={cn(
        "rounded-xl p-5 ring-1 ring-inset shadow-card",
        allClear
          ? "bg-sv-green/5 ring-sv-green/30"
          : high > 0
            ? "bg-red-500/5 ring-red-500/40"
            : "bg-yellow-500/5 ring-yellow-500/30",
      )}
    >
      <header className="mb-3 flex items-center gap-2">
        {allClear ? (
          <ShieldCheck className="h-4 w-4 text-sv-green" />
        ) : high > 0 ? (
          <AlertTriangle className="h-4 w-4 text-red-300" />
        ) : (
          <Bell className="h-4 w-4 text-yellow-300" />
        )}
        <h3 className="text-sm font-semibold text-ink-50">
          {allClear
            ? "No active alarms"
            : `${unique.length} active alarm${unique.length === 1 ? "" : "s"}`}
        </h3>
        <span className="ml-auto text-[10px] uppercase tracking-brand text-ink-500">
          StateId 803 + 804 · decoded vs SmartWarnings/VarisciteWarnings
        </span>
      </header>

      {allClear ? (
        <p className="text-xs text-ink-400">
          Notifications (StateId 803) and Warnings (StateId 804) are both 0.
          Charger reports no fault flags raised.
        </p>
      ) : (
        <ul className="space-y-2">
          {unique.map((w) => (
            <li
              key={w.code}
              className={cn(
                "flex items-start gap-3 rounded-md p-3 ring-1 ring-inset",
                w.severity === "high"
                  ? "bg-red-500/10 ring-red-500/30"
                  : w.severity === "medium"
                    ? "bg-yellow-500/10 ring-yellow-500/30"
                    : "bg-bg-inset/60 ring-bg-border",
              )}
            >
              <AlertTriangle
                className={cn(
                  "h-4 w-4 mt-0.5 shrink-0",
                  w.severity === "high"
                    ? "text-red-300"
                    : w.severity === "medium"
                      ? "text-yellow-300"
                      : "text-ink-300",
                )}
              />
              <div className="min-w-0 flex-1">
                <p
                  className={cn(
                    "text-sm font-semibold",
                    w.severity === "high"
                      ? "text-red-100"
                      : w.severity === "medium"
                        ? "text-yellow-100"
                        : "text-ink-100",
                  )}
                >
                  {w.label}
                </p>
                <p className="text-[11px] font-mono text-ink-400">
                  {w.code} · bit 0x{w.bit.toString(16)}
                </p>
              </div>
              <span
                className={cn(
                  "rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-brand",
                  w.severity === "high"
                    ? "bg-red-500/20 text-red-100"
                    : w.severity === "medium"
                      ? "bg-yellow-500/20 text-yellow-100"
                      : "bg-ink-600/30 text-ink-200",
                )}
              >
                {w.severity}
              </span>
            </li>
          ))}
        </ul>
      )}

      {!allClear ? (
        <p className="mt-3 text-[11px] text-ink-400">
          {high > 0
            ? `${high} high-severity flag${high === 1 ? "" : "s"}`
            : `${medium} flag${medium === 1 ? "" : "s"} to review`}
          . Use the Diagnostics drawer for raw 803/804 values.
        </p>
      ) : null}
    </section>
  );
}
