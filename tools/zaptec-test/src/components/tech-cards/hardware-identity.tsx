import { Cpu } from "lucide-react";
import type { Charger, StateObservation } from "@/lib/zaptec";
import { StateId } from "@/lib/zaptec-state";
import { fmtDeviceType } from "@/components/profile-bits";

export function HardwareIdentityCard({
  charger,
  state,
}: {
  charger: Charger;
  state: StateObservation[];
}) {
  const sm = new Map(state.map((s) => [s.StateId, s]));
  const v = (id: number) => sm.get(id)?.ValueAsString;

  const c = charger as Charger & {
    DeviceId?: string;
    MID?: string;
    SignedMeterValueKwh?: number;
  };

  return (
    <section className="rounded-lg border border-bg-border bg-bg-surface/70 p-5 shadow-card backdrop-blur">
      <header className="mb-3 flex items-center gap-2">
        <Cpu className="h-4 w-4 text-sv-sky" />
        <h3 className="text-sm font-semibold text-ink-50">Hardware identity</h3>
      </header>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <p className="mb-1 text-[10px] uppercase tracking-brand text-sv-sky">
            Identity
          </p>
          <dl className="space-y-0.5 text-[11px]">
            <Kv label="Product name" value={v(StateId.ProductName) ?? "—"} mono />
            <Kv label="Product code" value={v(StateId.ProductCode) ?? "—"} mono />
            <Kv label="Device type" value={fmtDeviceType(charger.DeviceType)} />
            <Kv label="Device ID" value={c.DeviceId ?? "—"} mono />
            <Kv label="Serial" value={charger.SerialNo ?? "—"} mono />
            <Kv label="MID" value={c.MID ?? "—"} mono />
            <Kv label="Zaptec UUID" value={charger.Id} mono />
          </dl>
        </div>
        <div>
          <p className="mb-1 text-[10px] uppercase tracking-brand text-sv-sky">
            Versions
          </p>
          <dl className="space-y-0.5 text-[11px]">
            <Kv
              label="Smart Computer SW (911)"
              value={v(StateId.SmartComputerSwApp) ?? "—"}
              mono
            />
            <Kv
              label="Smart Computer Boot (912)"
              value={v(StateId.SmartComputerSwBoot) ?? "—"}
              mono
            />
            <Kv
              label="Smart Mainboard SW (908)"
              value={v(StateId.SmartMainboardSwApp) ?? "—"}
              mono
            />
            <Kv
              label="Smart Mainboard Boot (909)"
              value={v(StateId.SmartMainboardSwBoot) ?? "—"}
              mono
            />
            <Kv
              label="Hardware version (913)"
              value={v(StateId.SmartComputerHwVersion) ?? "—"}
              mono
            />
            <Kv label="MID Calibration (980)" value={v(980) ?? "—"} mono />
            <Kv label="MID Software (914)" value={v(914) ?? "—"} mono />
          </dl>
        </div>
      </div>

      {/* MID public key + lifetime */}
      <div className="mt-4 rounded-md border border-bg-border bg-bg-inset/40 p-3">
        <p className="mb-2 text-[10px] uppercase tracking-brand text-sv-sky">
          Metering &amp; calibration
        </p>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px]">
          <Kv
            label="Lifetime kWh (signed)"
            value={
              c.SignedMeterValueKwh != null
                ? `${c.SignedMeterValueKwh.toFixed(2)} kWh`
                : "—"
            }
          />
          <Kv label="MID Calibration ID (982)" value={v(982) ?? "—"} mono />
          <Kv label="MID Public Key (981)" value={v(981) ? "set" : "—"} />
          <Kv label="HMI brightness (153)" value={v(StateId.HmiBrightness) ?? "—"} />
          <Kv
            label="MID blink enabled (170)"
            value={v(170) === "1" ? "yes" : v(170) === "0" ? "no" : "—"}
          />
          <Kv
            label="Tamper cover (280)"
            value={v(280) === "1" ? "tampered" : v(280) === "0" ? "intact" : "—"}
          />
        </dl>
      </div>
    </section>
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
