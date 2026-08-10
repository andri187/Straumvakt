import { Thermometer, Activity, Lock } from "lucide-react";
import type { StateObservation } from "@/lib/zaptec";
import { StateId, num } from "@/lib/zaptec-state";
import { fmtUptimeMs } from "@/lib/zaptec-enums";

export function EnvironmentCard({ state }: { state: StateObservation[] }) {
  const sm = new Map(state.map((s) => [s.StateId, s]));
  const v = (id: number) => sm.get(id)?.ValueAsString;
  const n = (id: number) => num(v(id));

  const t5 = n(StateId.TemperatureInternal5);
  const t6 = n(StateId.TemperatureInternal6);
  const tLimit = n(203);
  const tMax = n(241);
  const tPower = n(205);
  const humidity = n(StateId.Humidity);
  const tamper = v(280);

  const uptimeVar = v(StateId.UptimeVariscite);
  const uptimeMcu = v(StateId.UptimeMCU);
  const cableLockOnConnect = v(StateId.LockCableWhenConnected);
  const permanentCableLock = v(151);
  const mcuResetSource = v(811);
  const mcuRxErrors = v(812);
  const mcuToVarPacketErrors = v(813);
  const varToMcuPacketErrors = v(814);
  const midFaultFlags = v(816);
  const relayWeldedFlags = v(817);

  return (
    <section className="rounded-lg border border-bg-border bg-bg-surface/70 p-5 shadow-card backdrop-blur">
      <header className="mb-3 flex items-center gap-2">
        <Thermometer className="h-4 w-4 text-sv-sky" />
        <h3 className="text-sm font-semibold text-ink-50">
          Environment, uptime &amp; cable
        </h3>
      </header>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <p className="mb-1 text-[10px] uppercase tracking-brand text-sv-sky">
            Environment
          </p>
          <dl className="space-y-0.5 text-[11px]">
            <Kv
              label="Internal temp 5 (201)"
              value={t5 != null ? `${t5.toFixed(1)} °C` : "—"}
            />
            <Kv
              label="Internal temp 6 (202)"
              value={t6 != null ? `${t6.toFixed(1)} °C` : "—"}
            />
            <Kv
              label="Power board temp (205)"
              value={tPower != null ? `${tPower.toFixed(1)} °C` : "—"}
            />
            <Kv
              label="Throttle limit (203)"
              value={tLimit != null ? `${tLimit.toFixed(0)} °C` : "—"}
            />
            <Kv
              label="Max limit (241)"
              value={tMax != null ? `${tMax.toFixed(0)} °C` : "—"}
            />
            <Kv
              label="Humidity (270)"
              value={humidity != null ? `${humidity.toFixed(0)}%` : "—"}
            />
            <Kv
              label="Tamper cover (280)"
              value={tamper === "1" ? "tampered" : tamper === "0" ? "intact" : "—"}
            />
          </dl>
        </div>
        <div>
          <p className="mb-1 text-[10px] uppercase tracking-brand text-sv-sky">
            Uptime &amp; cable
          </p>
          <dl className="space-y-0.5 text-[11px]">
            <Kv label="Variscite uptime (820)" value={fmtUptimeMs(uptimeVar)} />
            <Kv label="MCU uptime (821)" value={fmtUptimeMs(uptimeMcu)} />
            <Kv
              label="Lock cable when connected (154)"
              value={
                cableLockOnConnect === "1"
                  ? "yes"
                  : cableLockOnConnect === "0"
                    ? "no"
                    : "—"
              }
            />
            <Kv
              label="Permanent cable lock (151)"
              value={
                permanentCableLock === "1"
                  ? "yes"
                  : permanentCableLock === "0"
                    ? "no"
                    : "—"
              }
              icon={Lock}
            />
            <Kv
              label="Cable type (714)"
              value={v(StateId.CableType) ? `${v(StateId.CableType)} A` : "—"}
            />
          </dl>

          <p className="mt-3 mb-1 text-[10px] uppercase tracking-brand text-sv-sky">
            MCU diagnostics
          </p>
          <dl className="space-y-0.5 text-[11px]">
            <Kv label="Reset source (811)" value={mcuResetSource ?? "—"} mono />
            <Kv label="Rx errors (812)" value={mcuRxErrors ?? "—"} mono />
            <Kv
              label="MCU→Var packet errors (813)"
              value={mcuToVarPacketErrors ?? "—"}
              mono
            />
            <Kv
              label="Var→MCU packet errors (814)"
              value={varToMcuPacketErrors ?? "—"}
              mono
            />
            <Kv
              label="MID fault flags (816)"
              value={midFaultFlags ?? "—"}
              mono
              alarm={midFaultFlags != null && midFaultFlags !== "0"}
            />
            <Kv
              label="Relay welded flags (817)"
              value={relayWeldedFlags ?? "—"}
              mono
              alarm={relayWeldedFlags != null && relayWeldedFlags !== "0"}
            />
          </dl>
        </div>
      </div>
    </section>
  );
}

function Kv({
  label,
  value,
  mono,
  alarm,
  icon: Icon,
}: {
  label: string;
  value: string;
  mono?: boolean;
  alarm?: boolean;
  icon?: typeof Activity;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-bg-border/30 pb-1 last:border-0">
      <dt className="text-ink-500">{label}</dt>
      <dd
        className={
          alarm
            ? "inline-flex items-center gap-1 font-semibold text-red-300"
            : mono
              ? "inline-flex items-center gap-1 font-mono text-ink-200"
              : "inline-flex items-center gap-1 text-ink-200"
        }
      >
        {Icon ? <Icon className="h-3 w-3 text-ink-400" /> : null}
        {value}
      </dd>
    </div>
  );
}
