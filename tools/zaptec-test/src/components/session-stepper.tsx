import { Plug, Key, Zap, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/cn";
import type { SessionPhase } from "@/lib/zaptec-state";

const STEPS: Array<{
  phase: SessionPhase;
  label: string;
  icon: typeof Plug;
}> = [
  { phase: "plug", label: "Plug in", icon: Plug },
  { phase: "auth", label: "Authorize", icon: Key },
  { phase: "charge", label: "Charging", icon: Zap },
  { phase: "finish", label: "Complete", icon: CheckCircle2 },
];

export function SessionStepper({
  phase,
  lastSessionKwh,
  lastSessionAt,
}: {
  phase: SessionPhase | null;
  lastSessionKwh?: number | null;
  lastSessionAt?: string | null;
}) {
  if (phase == null) {
    return (
      <div className="rounded-lg border border-bg-border bg-bg-inset/40 p-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs uppercase tracking-brand text-ink-400">
              Session
            </p>
            <p className="mt-0.5 text-sm text-ink-200">No active session</p>
          </div>
          {lastSessionKwh != null ? (
            <div className="text-right">
              <p className="text-xs uppercase tracking-brand text-ink-400">
                Last session
              </p>
              <p className="mt-0.5 text-sm font-semibold text-ink-100 tabular-nums">
                {lastSessionKwh.toFixed(2)} kWh
              </p>
              {lastSessionAt ? (
                <p className="text-[10px] text-ink-500">
                  {new Date(lastSessionAt).toLocaleString(undefined, {
                    hour: "2-digit",
                    minute: "2-digit",
                    day: "2-digit",
                    month: "short",
                  })}
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    );
  }

  const idx = STEPS.findIndex((s) => s.phase === phase);

  return (
    <div className="rounded-lg border border-bg-border bg-bg-inset/40 p-4">
      <p className="mb-3 text-xs uppercase tracking-brand text-ink-400">
        Session in progress
      </p>
      <ol className="flex items-center">
        {STEPS.map((s, i) => {
          const done = i < idx;
          const active = i === idx;
          const Icon = s.icon;
          return (
            <li key={s.phase} className="flex flex-1 items-center">
              <div className="flex flex-col items-center">
                <span
                  className={cn(
                    "flex h-9 w-9 items-center justify-center rounded-full ring-1 ring-inset transition-colors",
                    done
                      ? "bg-sv-green/15 text-sv-green ring-sv-green/40"
                      : active
                        ? "bg-sv-green/20 text-sv-green ring-sv-green/60 shadow-glow"
                        : "bg-bg-raised text-ink-500 ring-bg-border",
                  )}
                >
                  <Icon className={cn("h-4 w-4", active && "animate-pulse")} />
                </span>
                <span
                  className={cn(
                    "mt-1.5 text-[11px] font-medium",
                    active
                      ? "text-sv-green"
                      : done
                        ? "text-ink-200"
                        : "text-ink-500",
                  )}
                >
                  {s.label}
                </span>
              </div>
              {i < STEPS.length - 1 ? (
                <div
                  className={cn(
                    "mx-2 h-px flex-1 transition-colors",
                    i < idx ? "bg-sv-green/40" : "bg-bg-border",
                  )}
                />
              ) : null}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
