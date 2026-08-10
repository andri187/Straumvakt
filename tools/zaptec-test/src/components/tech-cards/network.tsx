import { Wifi, Smartphone, Network } from "lucide-react";
import type { StateObservation } from "@/lib/zaptec";
import { StateId } from "@/lib/zaptec-state";
import {
  communicationModeLabel,
  cloudConnectionStatusLabel,
} from "@/lib/zaptec-enums";

function dBmFromRaw(raw: string | undefined): { value: number; bars: number } | null {
  if (!raw) return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  // Zaptec reports signal in dBm — typical range -113 to -50
  // Bars: -50+ excellent, -65+ good, -85+ ok, below -100 poor
  let bars = 0;
  if (n >= -65) bars = 4;
  else if (n >= -75) bars = 3;
  else if (n >= -85) bars = 2;
  else if (n >= -100) bars = 1;
  else bars = 0;
  return { value: n, bars };
}

function StateRow({
  label,
  value,
  mono,
}: {
  label: string;
  value: string | null | undefined;
  mono?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-bg-border/40 py-1 last:border-0">
      <dt className="text-[11px] text-ink-500">{label}</dt>
      <dd
        className={
          mono ? "font-mono text-[11px] text-ink-200" : "text-xs text-ink-200"
        }
      >
        {value ?? "—"}
      </dd>
    </div>
  );
}

export function NetworkCard({ state }: { state: StateObservation[] }) {
  const sm = new Map(state.map((s) => [s.StateId, s]));
  const v = (id: number) => sm.get(id)?.ValueAsString;

  const commMode = communicationModeLabel(v(StateId.CommunicationMode));
  const cloud = cloudConnectionStatusLabel(v(StateId.CloudConnectionStatus));
  const ocppConn = v(StateId.IsOcppConnected) === "1";
  const online = v(StateId.IsOnline) === "1";
  const sig = dBmFromRaw(v(StateId.CommunicationSignalStrength));
  const macMain = v(StateId.MacMain);
  const macWifi = v(StateId.MacWiFi);
  const macPlcGrid = v(951); // MacPlcModuleGrid
  const macPlcEv = v(953); // MacPlcModuleEv
  const lteImei = v(StateId.LteImei);
  const lteIccid = v(StateId.LteIccid);
  const lteImsi = v(960);
  const lteVersion = v(964);
  const lteRoamingDisabled = v(753) === "1";

  return (
    <section className="rounded-lg border border-bg-border bg-bg-surface/70 p-5 shadow-card backdrop-blur">
      <header className="mb-3 flex items-center gap-2">
        <Network className="h-4 w-4 text-sv-sky" />
        <h3 className="text-sm font-semibold text-ink-50">Network identity</h3>
      </header>

      {/* Quick status row */}
      <div className="mb-4 grid grid-cols-3 gap-3 rounded-md bg-bg-inset/40 p-3">
        <div>
          <p className="text-[10px] uppercase tracking-brand text-ink-500">
            Comm
          </p>
          <p className="mt-0.5 inline-flex items-center gap-1 text-sm font-semibold text-ink-100">
            {commMode === "Wi-Fi" ? (
              <Wifi className="h-3 w-3 text-sv-sky" />
            ) : commMode === "Cellular (LTE)" ? (
              <Smartphone className="h-3 w-3 text-sv-sky" />
            ) : null}
            {commMode}
          </p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-brand text-ink-500">
            Cloud
          </p>
          <p
            className={
              online && ocppConn
                ? "mt-0.5 text-sm font-semibold text-sv-green"
                : "mt-0.5 text-sm font-semibold text-yellow-200"
            }
          >
            {cloud}
            {ocppConn ? " · OCPP" : ""}
          </p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-brand text-ink-500">
            Signal
          </p>
          {sig ? (
            <p className="mt-0.5 inline-flex items-center gap-1 text-sm font-semibold text-ink-100">
              <SignalBars bars={sig.bars} />
              <span className="font-mono text-xs text-ink-300">
                {sig.value} dBm
              </span>
            </p>
          ) : (
            <p className="mt-0.5 text-sm font-semibold text-ink-500">—</p>
          )}
        </div>
      </div>

      {/* MAC + LTE identifiers */}
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <p className="mb-1 text-[10px] uppercase tracking-brand text-sv-sky">
            MAC addresses
          </p>
          <dl className="space-y-0.5">
            <StateRow label="Main" value={macMain} mono />
            <StateRow label="Wi-Fi" value={macWifi} mono />
            <StateRow label="PLC grid module" value={macPlcGrid} mono />
            <StateRow label="PLC EV module" value={macPlcEv} mono />
          </dl>
        </div>
        <div>
          <p className="mb-1 text-[10px] uppercase tracking-brand text-sv-sky">
            LTE / cellular
          </p>
          <dl className="space-y-0.5">
            <StateRow label="IMEI" value={lteImei} mono />
            <StateRow label="ICCID" value={lteIccid} mono />
            <StateRow label="IMSI" value={lteImsi} mono />
            <StateRow label="Modem version" value={lteVersion} mono />
            <StateRow
              label="Roaming"
              value={lteRoamingDisabled ? "disabled" : "enabled"}
            />
          </dl>
        </div>
      </div>
    </section>
  );
}

function SignalBars({ bars }: { bars: number }) {
  return (
    <span className="inline-flex items-end gap-px h-3.5">
      {[1, 2, 3, 4].map((i) => (
        <span
          key={i}
          className={
            i <= bars ? "w-1 bg-sv-green rounded-sm" : "w-1 bg-ink-700 rounded-sm"
          }
          style={{ height: `${i * 25}%` }}
        />
      ))}
    </span>
  );
}
