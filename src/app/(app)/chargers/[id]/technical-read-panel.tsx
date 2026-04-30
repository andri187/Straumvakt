// Two presentational components that render the
// /api/admin/chargers/:id/technical-read payload:
//
//   <TechnicalReadPills>  — compact 6-metric ribbon. Goes above the
//                           operator command panel. Hides on null
//                           read but keeps the row even when most
//                           values are missing.
//   <TechnicalReadDetail> — full-width set of cards (live dashboard,
//                           hardware identity, environment, network).
//                           Goes below the Edit panel.
//
// Every value renders an em-dash on null so the layout stays
// consistent regardless of which subset of fields Zaptec returned.

import { Signal, Radio, ShieldCheck, Thermometer, Zap, Cpu } from "lucide-react";
import type { ChargerTechnicalRead } from "@straumvakt/shared/domain/charger-technical-read";

const DASH = "—";

function fmtNum(v: number | null, suffix = "", digits = 0): string {
  if (v == null) return DASH;
  return `${v.toFixed(digits)}${suffix}`;
}
function fmtBool(v: boolean | null, on = "yes", off = "no"): string {
  if (v == null) return DASH;
  return v ? on : off;
}
function fmtSignal(dbm: number | null): string {
  if (dbm == null) return DASH;
  return `${dbm} dBm`;
}

export function TechnicalReadPills({
  read,
  firmwareFromBoot,
}: {
  read: ChargerTechnicalRead | null;
  /** ChargingStation.firmwareVersion from the BootNotification mirror — used as fallback when Zaptec is unreachable. */
  firmwareFromBoot: string | null;
}) {
  const firmware = read?.firmwareVersion ?? firmwareFromBoot ?? null;
  const stale = read?.fresh === false;

  return (
    <section className="mb-4 grid grid-cols-3 gap-2 rounded-lg border border-bg-border bg-bg-base/30 p-3 sm:grid-cols-6">
      <Pill icon={Signal} label="Signal" value={fmtSignal(read?.signalDbm ?? null)} />
      <Pill icon={Radio} label="Comm" value={read?.communicationMode ?? DASH} />
      <Pill
        icon={ShieldCheck}
        label="OCPP"
        value={read?.ocppConnected == null ? DASH : read.ocppConnected ? "online" : "offline"}
        tone={read?.ocppConnected ? "ok" : read?.ocppConnected === false ? "warn" : undefined}
      />
      <Pill icon={Cpu} label="Firmware" value={firmware ?? DASH} mono />
      <Pill icon={Zap} label="Grid" value={read?.networkType ?? DASH} />
      <Pill icon={Thermometer} label="Temp" value={fmtNum(read?.internalTemperatureC ?? null, "°C", 1)} />
      {stale && (
        <p className="col-span-full -mt-1 text-[10px] italic text-amber-400/80">
          Vendor data unreachable — fields above fall back to last-known DB values where possible.
        </p>
      )}
    </section>
  );
}

function Pill({
  icon: Icon,
  label,
  value,
  mono = false,
  tone,
}: {
  icon: typeof Signal;
  label: string;
  value: string;
  mono?: boolean;
  tone?: "ok" | "warn";
}) {
  const valueClass = [
    mono ? "font-mono" : "",
    tone === "ok" ? "text-sv-green" : tone === "warn" ? "text-amber-300" : "text-ink-100",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <div className="flex items-center gap-2 min-w-0">
      <Icon className="h-3.5 w-3.5 shrink-0 text-ink-500" />
      <div className="flex flex-col min-w-0">
        <span className="text-[9px] font-medium uppercase tracking-brand text-ink-500">{label}</span>
        <span className={`text-xs truncate ${valueClass}`}>{value}</span>
      </div>
    </div>
  );
}

export function TechnicalReadDetail({ read }: { read: ChargerTechnicalRead | null }) {
  if (!read) return null;

  const phasesActive = read.phases.some(
    (p) => (p.voltageV != null && p.voltageV > 0) || (p.currentA != null && p.currentA > 0),
  );

  return (
    <section className="mt-6 space-y-3">
      <header className="flex items-baseline justify-between border-b border-bg-border/40 pb-1">
        <h2 className="text-xs font-semibold uppercase tracking-brand text-ink-300">
          Technical read
        </h2>
        <span className="text-[10px] text-ink-500">
          {read.fresh ? "Live · Zaptec API" : "Stale · vendor unreachable"} ·{" "}
          {new Date(read.fetchedAt).toLocaleTimeString()}
        </span>
      </header>

      <div className="grid gap-3 lg:grid-cols-2">
        <Card title="Live dashboard" hint="StateId 710 / 513 / 553 / 501–509">
          <Row label="Operation mode" value={read.chargerOperationMode ?? DASH} />
          <Row label="Online" value={fmtBool(read.isOnline, "yes", "no")} />
          <Row label="Enabled" value={fmtBool(read.isEnabled, "yes", "no")} />
          <Row
            label="Power"
            value={fmtNum(read.totalChargePowerW != null ? read.totalChargePowerW / 1000 : null, " kW", 2)}
          />
          <Row
            label="Session energy"
            value={fmtNum(read.totalChargeEnergySessionKWh, " kWh", 3)}
          />
          <Row label="Max current" value={fmtNum(read.chargerMaxCurrentA, " A")} />
          <Row label="Allocated (DLB)" value={fmtNum(read.chargeCurrentSetA, " A")} />
        </Card>

        {phasesActive && (
          <Card title="Phases" hint="Voltage 501/502/503 · Current 507/508/509">
            <table className="w-full text-[11px]">
              <thead className="text-[10px] uppercase tracking-brand text-ink-500">
                <tr>
                  <th className="py-1 text-left font-medium">Phase</th>
                  <th className="py-1 text-right font-medium">Voltage</th>
                  <th className="py-1 text-right font-medium">Current</th>
                </tr>
              </thead>
              <tbody className="font-mono text-ink-200">
                {read.phases.map((p, i) => (
                  <tr key={i} className="border-t border-bg-border/30">
                    <td className="py-1">L{i + 1}</td>
                    <td className="py-1 text-right">{fmtNum(p.voltageV, " V", 0)}</td>
                    <td className="py-1 text-right">{fmtNum(p.currentA, " A", 1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}

        <Card title="Hardware identity" hint="StateId 950 / 952 / 962 / 982">
          <Row label="Device ID" value={read.deviceId ?? DASH} mono />
          <Row label="Serial number" value={read.serialNo ?? DASH} mono />
          <Row label="MID calibration" value={read.mid ?? DASH} mono />
          <Row label="MAC (main)" value={read.macMain ?? DASH} mono />
          <Row label="MAC (Wi-Fi)" value={read.macWifi ?? DASH} mono />
          <Row label="LTE ICCID" value={read.lteIccid ?? DASH} mono />
          <Row label="LTE IMSI" value={read.lteImsi ?? DASH} mono />
        </Card>

        <Card title="Network &amp; uptime" hint="StateId 150 / 715 / 809 / 820">
          <Row label="Comm mode" value={read.communicationMode ?? DASH} />
          <Row label="Grid (network type)" value={read.networkType ?? DASH} />
          <Row label="Signal" value={fmtSignal(read.signalDbm)} />
          <Row label="Uptime" value={fmtNum(read.uptimeHours, " h", 1)} />
          <Row label="Internal temp" value={fmtNum(read.internalTemperatureC, " °C", 1)} />
          <Row
            label="Warnings bitmask"
            value={
              read.warningsBitmask == null
                ? DASH
                : read.warningsBitmask === 0
                  ? "0 (none)"
                  : `0x${read.warningsBitmask.toString(16)}`
            }
            mono
            tone={read.warningsBitmask && read.warningsBitmask > 0 ? "warn" : undefined}
          />
        </Card>

        <Card title="Vendor / portal config" hint="From Zaptec /api/chargers/:id">
          <Row label="OCPP URL" value={read.propertyOcppUrl ?? DASH} mono />
          <Row
            label="Auth required"
            value={fmtBool(
              read.propertyAuthenticationDisabled == null ? null : !read.propertyAuthenticationDisabled,
              "yes",
              "no — disabled",
            )}
            tone={read.propertyAuthenticationDisabled ? "warn" : undefined}
          />
          <Row label="Authorization required" value={fmtBool(read.isAuthorizationRequired)} />
        </Card>
      </div>
    </section>
  );
}

function Card({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-bg-border bg-bg-base/30 p-3">
      <header className="mb-2 flex items-baseline justify-between">
        <h3 className="text-xs font-semibold text-ink-100">{title}</h3>
        {hint && <span className="text-[10px] text-ink-500">{hint}</span>}
      </header>
      <dl className="space-y-0.5">{children}</dl>
    </div>
  );
}

function Row({
  label,
  value,
  mono = false,
  tone,
}: {
  label: string;
  value: string;
  mono?: boolean;
  tone?: "ok" | "warn";
}) {
  const valueClass = [
    mono ? "font-mono" : "",
    tone === "ok" ? "text-sv-green" : tone === "warn" ? "text-amber-300" : "text-ink-200",
    "truncate",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <div className="flex items-baseline justify-between gap-3 text-[11px]">
      <dt className="shrink-0 text-ink-500">{label}</dt>
      <dd className={valueClass}>{value}</dd>
    </div>
  );
}
