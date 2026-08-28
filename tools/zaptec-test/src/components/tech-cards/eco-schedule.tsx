import { Sun, Moon, CalendarClock, Battery } from "lucide-react";
import type { Installation, StateObservation } from "@/lib/zaptec";
import { StateId } from "@/lib/zaptec-state";
import { decodeFeatures } from "@/lib/zaptec-enums";

export function EcoScheduleCard({
  installation,
  state,
}: {
  installation: Installation | null;
  state: StateObservation[];
}) {
  const sm = new Map(state.map((s) => [s.StateId, s]));
  const v = (id: number) => sm.get(id)?.ValueAsString;

  const inst = installation as
    | (Installation & {
        AvailableFeatures?: number;
        EnabledFeatures?: number;
        Feature_PowerManagement_EcoMode_DepartureTime?: number;
        Feature_PowerManagement_EcoMode_MinEnergy?: number;
        Feature_PowerManagement_EcoMode_DeliveryArea?: number;
        SurplusMode?: { Active?: boolean; [k: string]: unknown };
        AvailableCurrentMode?: number;
        AvailableCurrentScheduleWeekendActive?: boolean;
      })
    | null;

  // Decode features bitmask
  const enabled = decodeFeatures(inst?.EnabledFeatures ?? 0);
  const ecoEnabled = enabled.some((f) => f.code === "PowerManagement_EcoMode");
  const scheduleEnabled = enabled.some((f) => f.code === "PowerManagement_Schedule");
  const surplusEnabled = enabled.some(
    (f) => f.code === "PowerManagement_Apm_SurplusMode",
  );

  const departure = inst?.Feature_PowerManagement_EcoMode_DepartureTime;
  const minEnergy = inst?.Feature_PowerManagement_EcoMode_MinEnergy;

  // Charger-side schedule observations
  const tariffText = v(StateId.TariffText); // 720
  const nextSchedule = v(StateId.OcppNativeUrl); // wrong stateId — fix below
  const nextScheduleEvent = v(763);
  const maxStartDelay = v(764);
  const timeSchedule = v(762);

  return (
    <section className="rounded-lg border border-bg-border bg-bg-surface/70 p-5 shadow-card backdrop-blur">
      <header className="mb-3 flex items-center gap-2">
        <Moon className="h-4 w-4 text-sv-sky" />
        <h3 className="text-sm font-semibold text-ink-50">
          Eco mode &amp; scheduling
        </h3>
      </header>

      {/* Three feature blocks: Eco / Schedule / Surplus */}
      <div className="grid gap-3 sm:grid-cols-3">
        <FeatureBox
          icon={Moon}
          label="Eco Mode"
          enabled={ecoEnabled}
          rows={[
            [
              "Departure",
              departure != null
                ? `${Math.floor(departure / 60)}:${String(departure % 60).padStart(2, "0")}`
                : "—",
            ],
            ["Min energy", minEnergy != null ? `${minEnergy} kWh` : "—"],
          ]}
        />
        <FeatureBox
          icon={CalendarClock}
          label="Schedule"
          enabled={scheduleEnabled}
          rows={[
            [
              "Mode",
              inst?.AvailableCurrentMode === 0
                ? "static"
                : inst?.AvailableCurrentMode != null
                  ? "scheduled"
                  : "—",
            ],
            [
              "Weekend schedule",
              inst?.AvailableCurrentScheduleWeekendActive == null
                ? "—"
                : inst.AvailableCurrentScheduleWeekendActive
                  ? "active"
                  : "—",
            ],
          ]}
        />
        <FeatureBox
          icon={Sun}
          label="PV surplus"
          enabled={surplusEnabled}
          rows={[
            [
              "Active now",
              inst?.SurplusMode?.Active == null
                ? "—"
                : inst.SurplusMode.Active
                  ? "yes"
                  : "no",
            ],
          ]}
        />
      </div>

      {/* Charger-side scheduling state */}
      <div className="mt-4 rounded-md border border-bg-border bg-bg-inset/40 p-3">
        <p className="mb-2 text-[10px] uppercase tracking-brand text-sv-sky">
          Charger schedule state
        </p>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px]">
          <Kv label="Tariff text (720)" value={tariffText ?? "—"} mono />
          <Kv label="Next event (763)" value={nextScheduleEvent ?? "—"} mono />
          <Kv label="Time schedule (762)" value={timeSchedule ?? "—"} mono />
          <Kv label="Max start delay (764)" value={maxStartDelay ?? "—"} mono />
        </dl>
      </div>
    </section>
  );
}

function FeatureBox({
  icon: Icon,
  label,
  enabled,
  rows,
}: {
  icon: typeof Moon;
  label: string;
  enabled: boolean;
  rows: [string, string][];
}) {
  return (
    <div
      className={
        enabled
          ? "rounded-md border border-sv-green/30 bg-sv-green/5 p-3"
          : "rounded-md border border-bg-border bg-bg-inset/30 p-3 opacity-70"
      }
    >
      <div className="mb-1.5 flex items-center justify-between">
        <p className="inline-flex items-center gap-1.5 text-xs font-semibold text-ink-100">
          <Icon
            className={
              enabled ? "h-3.5 w-3.5 text-sv-green" : "h-3.5 w-3.5 text-ink-500"
            }
          />
          {label}
        </p>
        <span
          className={
            enabled
              ? "rounded-full bg-sv-green/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-brand text-sv-green ring-1 ring-inset ring-sv-green/30"
              : "rounded-full bg-ink-600/30 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-brand text-ink-400"
          }
        >
          {enabled ? "on" : "off"}
        </span>
      </div>
      <dl className="space-y-0.5 text-[10px]">
        {rows.map(([k, v]) => (
          <div key={k} className="flex items-baseline justify-between">
            <dt className="text-ink-500">{k}</dt>
            <dd className="text-ink-200">{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function Kv({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-bg-border/30 pb-1 last:border-0">
      <dt className="text-ink-500">{label}</dt>
      <dd className={mono ? "font-mono text-ink-200" : "text-ink-200"}>
        {value}
      </dd>
    </div>
  );
}
