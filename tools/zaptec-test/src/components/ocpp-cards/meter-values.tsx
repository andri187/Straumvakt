import type { StateObservation } from "@/lib/zaptec";
import { StateId, num } from "@/lib/zaptec-state";
import { TechSection } from "@/components/tech-section";
import type { Measurand } from "@/lib/ocpp";
import { cn } from "@/lib/cn";

// All 20 OCPP measurands defined in 1.6J § 5.1.5. For each, we attempt to
// resolve a live value from the Zaptec REST state observations (since
// Zaptec mirrors many MeterValues fields back through the API). When no
// API mirror exists, the row is dimmed with "via OCPP only".

type MeasurandRow = {
  m: Measurand;
  unit: string;
  note?: string;
  // Phase tag (when applicable)
  phase?: "L1" | "L2" | "L3";
  // Live value from API mirror (null = not available via API)
  value: number | null;
  // Where the value came from
  source: "api-mirror" | "ocpp-only";
};

function buildRows(state: StateObservation[]): MeasurandRow[] {
  const sm = new Map(state.map((s) => [s.StateId, s]));
  const v = (id: number) => num(sm.get(id)?.ValueAsString);

  const i1 = v(StateId.CurrentPhase1);
  const i2 = v(StateId.CurrentPhase2);
  const i3 = v(StateId.CurrentPhase3);
  const v1 = v(StateId.VoltagePhase1);
  const v2 = v(StateId.VoltagePhase2);
  const v3 = v(StateId.VoltagePhase3);
  const power = v(StateId.TotalChargePower);
  const sessionEnergyKwh = v(StateId.TotalChargePowerSession);
  const lifetimeKwh = (() => {
    // Parse the OCMF blob to get the latest cumulative reading
    const raw = sm.get(StateId.SignedMeterValue)?.ValueAsString;
    if (!raw) return null;
    const pipe = raw.indexOf("|");
    if (pipe < 0) return null;
    const json = raw.slice(pipe + 1).split("|")[0];
    try {
      const parsed = JSON.parse(json) as {
        RD?: Array<{ RV?: string }>;
      };
      const last = parsed.RD?.[parsed.RD.length - 1]?.RV;
      return last != null ? Number(last) : null;
    } catch {
      return null;
    }
  })();
  const pf = v(StateId.PowerFactor);
  const t1 = v(StateId.TemperatureInternal5);
  const t2 = v(StateId.TemperatureInternal6);
  const setA = v(StateId.ChargeCurrentSet);

  const rows: MeasurandRow[] = [
    {
      m: "Energy.Active.Import.Register",
      unit: "Wh",
      note: "Cumulative energy from grid (OCMF signed)",
      value: lifetimeKwh != null ? lifetimeKwh * 1000 : null,
      source: "api-mirror",
    },
    {
      m: "Energy.Active.Export.Register",
      unit: "Wh",
      note: "V2G — Zaptec Pro doesn't support",
      value: null,
      source: "ocpp-only",
    },
    {
      m: "Energy.Reactive.Import.Register",
      unit: "varh",
      value: null,
      source: "ocpp-only",
    },
    {
      m: "Energy.Reactive.Export.Register",
      unit: "varh",
      value: null,
      source: "ocpp-only",
    },
    {
      m: "Energy.Active.Import.Interval",
      unit: "Wh",
      note: "Per-interval delta (TotalChargePowerSession)",
      value: sessionEnergyKwh != null ? sessionEnergyKwh * 1000 : null,
      source: "api-mirror",
    },
    {
      m: "Energy.Active.Export.Interval",
      unit: "Wh",
      value: null,
      source: "ocpp-only",
    },
    {
      m: "Power.Active.Import",
      unit: "W",
      note: "Live import power",
      value: power,
      source: "api-mirror",
    },
    {
      m: "Power.Active.Export",
      unit: "W",
      value: null,
      source: "ocpp-only",
    },
    {
      m: "Power.Reactive.Import",
      unit: "var",
      value: null,
      source: "ocpp-only",
    },
    {
      m: "Power.Reactive.Export",
      unit: "var",
      value: null,
      source: "ocpp-only",
    },
    {
      m: "Power.Offered",
      unit: "W",
      note: "Charger offer = ChargeCurrentSet × nominal V × phases",
      value:
        setA != null && (v1 ?? 230) != null
          ? setA * (v1 ?? 230) * 3
          : null,
      source: "api-mirror",
    },
    {
      m: "Power.Factor",
      unit: "",
      value: pf,
      source: "api-mirror",
    },
    {
      m: "Current.Import",
      unit: "A",
      phase: "L1",
      value: i1,
      source: "api-mirror",
    },
    {
      m: "Current.Import",
      unit: "A",
      phase: "L2",
      value: i2,
      source: "api-mirror",
    },
    {
      m: "Current.Import",
      unit: "A",
      phase: "L3",
      value: i3,
      source: "api-mirror",
    },
    {
      m: "Current.Export",
      unit: "A",
      value: null,
      source: "ocpp-only",
    },
    {
      m: "Current.Offered",
      unit: "A",
      note: "ChargeCurrentSet (allocated by DLB)",
      value: setA,
      source: "api-mirror",
    },
    {
      m: "Voltage",
      unit: "V",
      phase: "L1",
      value: v1,
      source: "api-mirror",
    },
    {
      m: "Voltage",
      unit: "V",
      phase: "L2",
      value: v2,
      source: "api-mirror",
    },
    {
      m: "Voltage",
      unit: "V",
      phase: "L3",
      value: v3,
      source: "api-mirror",
    },
    {
      m: "Frequency",
      unit: "Hz",
      value: null,
      source: "ocpp-only",
    },
    {
      m: "Temperature",
      unit: "°C",
      note: "Internal sensor 5",
      value: t1,
      source: "api-mirror",
    },
    {
      m: "Temperature",
      unit: "°C",
      note: "Internal sensor 6",
      value: t2,
      source: "api-mirror",
    },
    {
      m: "SoC",
      unit: "%",
      note: "Only if EV reports state-of-charge — rare on AC",
      value: null,
      source: "ocpp-only",
    },
    {
      m: "RPM",
      unit: "RPM",
      note: "Cooling fans — rare",
      value: null,
      source: "ocpp-only",
    },
  ];

  return rows;
}

export function OcppMeterValuesCard({
  state,
}: {
  state: StateObservation[];
}) {
  const sm = new Map(state.map((s) => [s.StateId, s]));
  const ocppConnected = sm.get(StateId.IsOcppConnected)?.ValueAsString === "1";
  const rows = buildRows(state);
  const liveCount = rows.filter((r) => r.source === "api-mirror" && r.value != null).length;

  return (
    <TechSection
      title="OCPP MeterValues"
      source="ocpp"
      state={
        ocppConnected
          ? { kind: "connected" }
          : { kind: "disconnected", reason: "IsOcppConnected = 0" }
      }
      hint={`${liveCount} of ${rows.length} measurands mirrored via API`}
    >
      <p className="mb-3 text-[11px] text-ink-400">
        OCPP 1.6J § 5.1.5 — the charger samples measurands at{" "}
        <span className="font-mono text-ink-300">MeterValueSampleInterval</span>{" "}
        and forwards them to the CSMS. Many also flow back through the Zaptec
        REST API as state observations; those are shown live below. Rows
        marked <span className="font-mono text-yellow-200">via OCPP only</span> are
        not mirrored via REST and would require querying the CSMS worker
        directly.
      </p>
      <div className="overflow-hidden rounded-md border border-bg-border/70">
        <table className="w-full text-xs">
          <thead className="bg-bg-inset/40 text-left text-[10px] uppercase tracking-brand text-ink-500">
            <tr>
              <th className="px-3 py-1.5 font-medium">Measurand</th>
              <th className="px-3 py-1.5 font-medium w-12">Phase</th>
              <th className="px-3 py-1.5 font-medium w-16">Unit</th>
              <th className="px-3 py-1.5 font-medium text-right w-32">Live value</th>
              <th className="px-3 py-1.5 font-medium w-24">Source</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-bg-border/60">
            {rows.map((r, i) => {
              const isLive = r.source === "api-mirror" && r.value != null;
              return (
                <tr
                  key={`${r.m}-${r.phase ?? "n"}-${i}`}
                  className={isLive ? undefined : "opacity-70"}
                >
                  <td className="px-3 py-1.5">
                    <div className="font-mono text-[11px] text-ink-200">
                      {r.m}
                    </div>
                    {r.note ? (
                      <div className="text-[10px] text-ink-500">{r.note}</div>
                    ) : null}
                  </td>
                  <td className="px-3 py-1.5">
                    {r.phase ? (
                      <span className="rounded bg-bg-inset/60 px-1.5 py-0.5 text-[10px] font-semibold text-sv-sky">
                        {r.phase}
                      </span>
                    ) : (
                      <span className="text-ink-600">—</span>
                    )}
                  </td>
                  <td className="px-3 py-1.5 font-mono text-[10px] text-ink-400">
                    {r.unit}
                  </td>
                  <td className="px-3 py-1.5 text-right font-mono tabular-nums">
                    {isLive ? (
                      <span className="text-sv-green">
                        {fmtMeasurandValue(r.value!, r.m)}
                      </span>
                    ) : r.source === "api-mirror" ? (
                      <span className="text-ink-500">— (idle)</span>
                    ) : (
                      <span className="italic text-ink-600">—</span>
                    )}
                  </td>
                  <td className="px-3 py-1.5">
                    <span
                      className={cn(
                        "inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-brand ring-1 ring-inset",
                        r.source === "api-mirror"
                          ? "bg-sv-green/10 text-sv-green ring-sv-green/30"
                          : "bg-yellow-500/10 text-yellow-300 ring-yellow-500/30",
                      )}
                    >
                      {r.source === "api-mirror" ? "API mirror" : "OCPP only"}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </TechSection>
  );
}

function fmtMeasurandValue(v: number, m: string): string {
  // Compact formatting per measurand kind
  if (m.startsWith("Energy")) {
    if (v >= 1000_000) return `${(v / 1_000_000).toFixed(2)} M`;
    if (v >= 1000) return `${(v / 1000).toFixed(1)} k`;
    return v.toFixed(0);
  }
  if (m.startsWith("Power")) {
    if (m === "Power.Factor") return v.toFixed(3);
    if (Math.abs(v) >= 1000) return `${(v / 1000).toFixed(2)} k`;
    return v.toFixed(0);
  }
  if (m === "Voltage") return v.toFixed(0);
  if (m === "Current.Import" || m === "Current.Offered") return v.toFixed(1);
  if (m === "Temperature") return v.toFixed(1);
  return v.toString();
}
