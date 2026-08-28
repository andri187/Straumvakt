import { Cable, Activity } from "lucide-react";
import type { Installation, StateObservation } from "@/lib/zaptec";
import { StateId, num } from "@/lib/zaptec-state";
import { decodePhases } from "@/lib/zaptec-enums";
import { cn } from "@/lib/cn";

export function DlbCard({
  state,
  installation,
}: {
  state: StateObservation[];
  installation: Installation | null;
}) {
  const sm = new Map(state.map((s) => [s.StateId, s]));
  const v = (id: number) => sm.get(id)?.ValueAsString;
  const n = (id: number) => num(v(id));

  const setA = n(StateId.ChargeCurrentSet); // 708 — what's allocated
  const maxA = n(StateId.ChargerMaxCurrent); // 510
  const minA = n(StateId.ChargerMinCurrent); // 511
  const activePhases = decodePhases(v(StateId.ActivePhases)); // 512
  const setPhases = decodePhases(v(StateId.SetPhases)); // 519
  const maxPhases = decodePhases(v(StateId.MaxPhases)); // 520
  const powerFactor = n(StateId.PowerFactor); // 518

  // Per-phase available current from installation
  const aPh1 = (installation as { AvailableCurrentPhase1?: number })
    ?.AvailableCurrentPhase1;
  const aPh2 = (installation as { AvailableCurrentPhase2?: number })
    ?.AvailableCurrentPhase2;
  const aPh3 = (installation as { AvailableCurrentPhase3?: number })
    ?.AvailableCurrentPhase3;
  const switchTo1Phase = (installation as { ThreeToOnePhaseSwitchCurrent?: number })
    ?.ThreeToOnePhaseSwitchCurrent;
  const defaultSwitchTo1 = (installation as { DefaultThreeToOneSwitchCurrent?: number })
    ?.DefaultThreeToOneSwitchCurrent;
  const availableCurrentMode = (installation as { AvailableCurrentMode?: number })
    ?.AvailableCurrentMode;
  const weekendActive = (installation as { AvailableCurrentScheduleWeekendActive?: boolean })
    ?.AvailableCurrentScheduleWeekendActive;

  // RCD residual current (mA)
  const rcd = n(StateId.RcdCurrent);

  // % of max
  const pct = setA && maxA ? Math.round((setA / maxA) * 100) : null;
  const throttled = setA != null && maxA != null && setA < maxA;

  return (
    <section className="rounded-lg border border-bg-border bg-bg-surface/70 p-5 shadow-card backdrop-blur">
      <header className="mb-3 flex items-center gap-2">
        <Cable className="h-4 w-4 text-sv-sky" />
        <h3 className="text-sm font-semibold text-ink-50">
          Load balancing &amp; phases
        </h3>
        <span className="ml-auto text-[10px] uppercase tracking-brand text-ink-500">
          DLB · APM
        </span>
      </header>

      {/* Allocation bar */}
      <div className="mb-4">
        <div className="flex items-baseline justify-between">
          <p className="text-[10px] uppercase tracking-brand text-ink-500">
            Current allocation
          </p>
          {throttled ? (
            <span className="rounded bg-yellow-500/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-brand text-yellow-200">
              Throttled
            </span>
          ) : null}
        </div>
        <p className="mt-1 text-2xl font-semibold tabular-nums text-ink-100">
          {setA ?? "—"} <span className="text-base text-ink-400">A</span>
          <span className="ml-2 text-sm text-ink-400">
            of {maxA ?? "—"} A max
          </span>
        </p>
        {pct != null ? (
          <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-bg-inset">
            <div
              className={cn(
                "h-full rounded-full",
                pct >= 90
                  ? "bg-sv-green"
                  : pct >= 50
                    ? "bg-sv-sky"
                    : "bg-yellow-400",
              )}
              style={{ width: `${pct}%` }}
            />
          </div>
        ) : null}
        <p className="mt-1 text-[11px] text-ink-500">
          Min {minA ?? "—"} A · 708 ChargeCurrentSet vs 510 ChargerMaxCurrent
        </p>
      </div>

      {/* Phases */}
      <div className="mb-4 grid grid-cols-3 gap-3">
        <PhaseBox label="Active" phases={activePhases} stateId={512} />
        <PhaseBox label="Set" phases={setPhases} stateId={519} />
        <PhaseBox label="Max" phases={maxPhases} stateId={520} />
      </div>

      {/* Per-phase available */}
      {aPh1 != null || aPh2 != null || aPh3 != null ? (
        <div className="mb-4 rounded-md border border-bg-border bg-bg-inset/40 p-3">
          <p className="mb-2 text-[10px] uppercase tracking-brand text-ink-500">
            Installation available current per phase
          </p>
          <div className="grid grid-cols-3 gap-3 text-center">
            {[
              { l: "L1", a: aPh1 },
              { l: "L2", a: aPh2 },
              { l: "L3", a: aPh3 },
            ].map((p) => (
              <div key={p.l}>
                <p className="text-[10px] font-semibold uppercase tracking-brand text-sv-sky">
                  {p.l}
                </p>
                <p className="text-sm font-semibold tabular-nums text-ink-100">
                  {p.a != null ? `${p.a} A` : "—"}
                </p>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {/* Misc */}
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px]">
        <Kv label="Power factor (518)" value={powerFactor != null ? powerFactor.toFixed(3) : "—"} />
        <Kv label="RCD current (515)" value={rcd != null ? `${rcd.toFixed(1)} mA` : "—"} />
        <Kv
          label="3→1 ph switch threshold"
          value={switchTo1Phase != null ? `${switchTo1Phase} A` : "—"}
        />
        <Kv
          label="Default 3→1 switch"
          value={defaultSwitchTo1 != null ? `${defaultSwitchTo1} A` : "—"}
        />
        <Kv
          label="Schedule mode"
          value={
            availableCurrentMode != null
              ? availableCurrentMode === 0
                ? "static"
                : "scheduled"
              : "—"
          }
        />
        <Kv
          label="Weekend schedule"
          value={
            weekendActive == null ? "—" : weekendActive ? "active" : "inactive"
          }
        />
      </dl>
    </section>
  );
}

function PhaseBox({
  label,
  phases,
  stateId,
}: {
  label: string;
  phases: string[];
  stateId: number;
}) {
  const allowed = new Set(phases);
  return (
    <div className="rounded-md border border-bg-border bg-bg-inset/40 p-3 text-center">
      <p className="text-[10px] uppercase tracking-brand text-ink-500">
        {label} phases
      </p>
      <div className="mt-1 inline-flex items-center justify-center gap-1">
        {["L1", "L2", "L3"].map((p) => (
          <span
            key={p}
            className={cn(
              "rounded px-1.5 py-0.5 text-[10px] font-semibold",
              allowed.has(p)
                ? "bg-sv-green/15 text-sv-green ring-1 ring-inset ring-sv-green/30"
                : "bg-ink-700/30 text-ink-500 ring-1 ring-inset ring-bg-border",
            )}
          >
            {p}
          </span>
        ))}
      </div>
      <p className="mt-1 font-mono text-[10px] text-ink-500">{stateId}</p>
    </div>
  );
}

function Kv({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2 border-b border-bg-border/30 pb-1 last:border-0">
      <dt className="text-ink-500">{label}</dt>
      <dd className="tabular-nums text-ink-200">{value}</dd>
    </div>
  );
}
