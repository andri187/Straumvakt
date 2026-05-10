"use client";
import { useState } from "react";
import { apiFetch } from "@/lib/api-client";
import {
  signalIconClass as signalIconClassShared,
  formatSignal as formatSignalShared,
} from "@/lib/signal-quality";
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
import type {
  ChargerTechnicalRead,
  LocalAuthRoster,
  LocalAuthRosterEntry,
} from "@straumvakt/shared/domain/charger-technical-read";

const DASH = "—";

function fmtNum(v: number | null, suffix = "", digits = 0): string {
  if (v == null) return DASH;
  return `${v.toFixed(digits)}${suffix}`;
}
function fmtBool(v: boolean | null, on = "yes", off = "no"): string {
  if (v == null) return DASH;
  return v ? on : off;
}
// 9.8.2 — signal helpers moved to @/lib/signal-quality (Cisco-aligned
// thresholds: ≥-67 dBm green / -67 to -75 yellow / -75 to -85 orange /
// <-85 red — and matching cellular percentage scale). Imported as
// signalIconClassShared / formatSignalShared at the top of this file.

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

  // OCPP pill mirrors the /sites tree OCPP emblem: config state, not
  // runtime "is the socket currently open". Goes through the same
  // truth table — auth mode + auth-required toggle.
  const ocppState = computeOcppState(read);

  return (
    <section className="mb-4 grid grid-cols-3 gap-2 rounded-lg border border-bg-border bg-bg-base/30 p-3 sm:grid-cols-6">
      <Pill
        icon={Signal}
        label="Signal"
        value={formatSignalShared(read?.signalDbm ?? null, read?.communicationMode ?? null)}
        iconClass={signalIconClassShared(read?.signalDbm ?? null, read?.communicationMode ?? null)}
      />
      <Pill icon={Radio} label="Comm" value={read?.communicationMode ?? DASH} />
      <Pill
        icon={ShieldCheck}
        label="OCPP"
        value={ocppState.value}
        tone={ocppState.tone}
      />
      <Pill icon={Cpu} label="Firmware" value={firmware ?? DASH} mono />
      <Pill icon={Zap} label="Grid" value={read?.networkType ?? DASH} />
      <Pill icon={Thermometer} label="Temp" value={fmtNum(read?.internalTemperatureC ?? null, "°C", 1)} />
      {stale && (
        <p className="col-span-full -mt-1 text-[10px] italic text-amber-400/80">
          {read?.cachedAt
            ? `Vendor data unreachable — showing cached values from ${formatRelative(read.cachedAt)}.`
            : "Vendor data unreachable — no cached values yet."}
        </p>
      )}
    </section>
  );
}

/** "5m ago", "2h ago", "yesterday", or full timestamp for older. */
function formatRelative(iso: string): string {
  const t = new Date(iso).getTime();
  const ageMs = Date.now() - t;
  if (!Number.isFinite(ageMs) || ageMs < 0) return new Date(iso).toLocaleString();
  const ageMin = Math.floor(ageMs / 60_000);
  if (ageMin < 1) return "moments ago";
  if (ageMin < 60) return `${ageMin}m ago`;
  const ageHr = Math.floor(ageMin / 60);
  if (ageHr < 24) return `${ageHr}h ago`;
  const ageDays = Math.floor(ageHr / 24);
  if (ageDays === 1) return "yesterday";
  if (ageDays < 30) return `${ageDays}d ago`;
  return new Date(iso).toLocaleDateString();
}

/**
 * Truth table mirrors the sites-tree OCPP emblem:
 *   ready          — AuthenticationType OCPP (2/3) AND auth required
 *   "auth off"     — AuthenticationType OCPP but PropertyAuthenticationDisabled
 *   "not OCPP"     — AuthenticationType is Zaptec/Vendor (0/1)
 *   —              — Zaptec data unavailable
 */
function computeOcppState(read: ChargerTechnicalRead | null): {
  value: string;
  tone: "ok" | "warn" | undefined;
} {
  if (!read) return { value: DASH, tone: undefined };
  const t = read.authenticationType;
  if (t == null) return { value: DASH, tone: undefined };
  const isOcppMode = t === 2 || t === 3;
  if (!isOcppMode) {
    return { value: "not OCPP", tone: "warn" };
  }
  // OCPP mode is set; tone hinges on auth-required.
  if (read.propertyAuthenticationDisabled === true) {
    return { value: "auth off", tone: "warn" };
  }
  return { value: "ready", tone: "ok" };
}

function Pill({
  icon: Icon,
  label,
  value,
  mono = false,
  tone,
  iconClass,
}: {
  icon: typeof Signal;
  label: string;
  value: string;
  mono?: boolean;
  tone?: "ok" | "warn";
  /** Override the icon's text color — used by the Signal pill to render
   *  green/yellow/orange/red bars based on dBm magnitude. */
  iconClass?: string;
}) {
  const valueClass = [
    mono ? "font-mono" : "",
    tone === "ok" ? "text-sv-green" : tone === "warn" ? "text-amber-300" : "text-ink-100",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <div className="flex items-center gap-2 min-w-0">
      <Icon className={`h-3.5 w-3.5 shrink-0 ${iconClass ?? "text-ink-500"}`} />
      <div className="flex flex-col min-w-0">
        <span className="text-[9px] font-medium uppercase tracking-brand text-ink-500">{label}</span>
        <span className={`text-xs truncate ${valueClass}`}>{value}</span>
      </div>
    </div>
  );
}

export function TechnicalReadDetail({
  read,
  ocppIdentityId,
}: {
  read: ChargerTechnicalRead | null;
  /** OCPP identity uuid — the SendLocalList push endpoint is keyed
   *  off this. Null when the charger has no OCPP identity attached
   *  yet, in which case the push button renders disabled. */
  ocppIdentityId: string | null;
}) {
  if (!read) return null;

  const phasesActive = read.phases.some(
    (p) => (p.voltageV != null && p.voltageV > 0) || (p.currentA != null && p.currentA > 0),
  );
  // 8.13.4 — when Zaptec reports the charger offline, the residual
  // power / voltage / current values it echoes are last-known snapshots,
  // not live readings. Showing "0.00 kW" or "L1 6V/0.0A" implies activity
  // that isn't happening. Render "offline" for those fields and skip
  // the phases card entirely.
  const isOffline = read.isOnline === false;
  const offlineOr = (s: string) => (isOffline ? "offline" : s);

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
          <Row label="Operation mode" value={isOffline ? "offline" : (read.chargerOperationMode ?? DASH)} />
          <Row label="Online" value={fmtBool(read.isOnline, "yes", "no")} />
          <Row label="Enabled" value={fmtBool(read.isEnabled, "yes", "no")} />
          <Row
            label="Power"
            value={offlineOr(
              fmtNum(read.totalChargePowerW != null ? read.totalChargePowerW / 1000 : null, " kW", 2),
            )}
          />
          <Row
            label="Session energy"
            value={offlineOr(fmtNum(read.totalChargeEnergySessionKWh, " kWh", 3))}
          />
          <Row label="Max current" value={offlineOr(fmtNum(read.chargerMaxCurrentA, " A"))} />
          <Row label="Allocated (DLB)" value={offlineOr(fmtNum(read.chargeCurrentSetA, " A"))} />
        </Card>

        {phasesActive && !isOffline && (
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
          <Row label="Signal" value={formatSignalShared(read.signalDbm, read.communicationMode)} />
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

        <Card title="OCPP config" hint="auth mode + URL + identity tag + list version">
          <Row
            label="Auth mode"
            value={read.authenticationTypeLabel ?? DASH}
            tone={
              read.authenticationType === 2 || read.authenticationType === 3
                ? "ok"
                : read.authenticationType != null
                  ? "warn"
                  : undefined
            }
          />
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
          <Row label="Default idTag" value={read.ocppDefaultIdTag ?? DASH} mono />
          <Row
            label="Auth list version"
            value={
              read.authListVersion == null
                ? DASH
                : read.authListVersion === 0
                  ? "0 (none synced)"
                  : String(read.authListVersion)
            }
            mono
          />
          <Row label="Current user UUID" value={read.currentUserUuid ?? DASH} mono />
          <Row label="Last rejected UUID" value={read.lastRejectedUserUuid ?? DASH} mono />
          <Row label="Enabled NFC tech" value={read.enabledNfcTechnologies ?? DASH} mono />
          <Row label="Routing ID" value={read.routingId ?? DASH} mono />
        </Card>

        <LocalAuthRosterCard
          roster={read.localAuthRoster}
          ocppIdentityId={ocppIdentityId}
        />
      </div>
    </section>
  );
}

function LocalAuthRosterCard({
  roster,
  ocppIdentityId,
}: {
  roster: LocalAuthRoster | null;
  ocppIdentityId: string | null;
}) {
  if (!roster) return null;
  const hint =
    `${roster.count} entries · ${roster.effectiveCount} would authorize` +
    (roster.chargerListVersion != null
      ? ` · charger v${roster.chargerListVersion}`
      : "");

  return (
    <div className="rounded-lg border border-bg-border bg-bg-base/30 p-3 lg:col-span-2">
      <header className="mb-2 flex items-baseline justify-between">
        <h3 className="text-xs font-semibold text-ink-100">Local auth list (CSMS roster)</h3>
        <span className="text-[10px] text-ink-500">{hint}</span>
      </header>
      {roster.note === "no_installation" ? (
        <p className="text-[11px] italic text-ink-500">
          Charger not linked to a Straumvakt Installation row.
        </p>
      ) : roster.note === "native_zaptec_managed" ? (
        <p className="text-[11px] italic text-ink-500">
          Installation is on{" "}
          <span className="font-mono">AuthenticationType=0</span> (Native) —
          Zaptec Portal owns the auth list. CSMS roster does not apply.
        </p>
      ) : roster.entries.length === 0 ? (
        <p className="text-[11px] italic text-ink-500">
          No IdTokens scoped to this installation (or globally) yet.
        </p>
      ) : (
        <>
          <p className="mb-2 text-[10px] text-ink-500">
            CSMS-side view. Use{" "}
            <span className="font-mono">Push</span> to send a single
            entry via OCPP <span className="font-mono">SendLocalList</span>{" "}
            (Differential). Pushes propagate to this charger only —
            other chargers in the same installation will drift until
            you push to them too.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-[11px]">
              <thead className="text-[10px] uppercase tracking-brand text-ink-500">
                <tr>
                  <th className="py-1 text-left font-medium">User</th>
                  <th className="py-1 text-left font-medium">idTag</th>
                  <th className="py-1 text-left font-medium">Kind</th>
                  <th className="py-1 text-left font-medium">Scope</th>
                  <th className="py-1 text-left font-medium">Verdict</th>
                  <th className="py-1 text-right font-medium">Action</th>
                </tr>
              </thead>
              <tbody>
                {roster.entries.map((e) => (
                  <RosterRowCompact
                    key={e.id}
                    entry={e}
                    ocppIdentityId={ocppIdentityId}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

function RosterRowCompact({
  entry,
  ocppIdentityId,
}: {
  entry: LocalAuthRosterEntry;
  ocppIdentityId: string | null;
}) {
  const verdictText =
    entry.effectiveVerdict === "would_authorize"
      ? "would authorize"
      : entry.effectiveVerdict === "blocked_revoked"
        ? "blocked (revoked)"
        : entry.effectiveVerdict === "blocked_suspended"
          ? "blocked (suspended)"
          : entry.effectiveVerdict === "blocked_no_contract"
            ? "blocked (no contract)"
            : "expired";
  const verdictTone =
    entry.effectiveVerdict === "would_authorize"
      ? "text-sv-green"
      : "text-ink-500";

  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [feedbackTone, setFeedbackTone] = useState<"ok" | "warn" | null>(null);

  // Refuse to push revoked tokens client-side (the API enforces too,
  // but this avoids a round-trip and matches Rule 5's "don't surprise-
  // re-authorize at the charger" hygiene).
  const pushable =
    !!ocppIdentityId &&
    entry.effectiveVerdict !== "blocked_revoked" &&
    entry.status !== "revoked";

  async function onPush() {
    if (!ocppIdentityId || busy) return;
    setBusy(true);
    setFeedback(null);
    setFeedbackTone(null);
    try {
      const res = await apiFetch(
        `/api/admin/chargers/${ocppIdentityId}/local-auth-list/push`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ idTokenId: entry.id }),
        },
      );
      if (res.status === 202) {
        const body = (await res.json()) as { listVersion: number };
        setFeedback(`queued · v${body.listVersion}`);
        setFeedbackTone("ok");
      } else {
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
          message?: string;
        };
        setFeedback(body.message ?? body.error ?? `HTTP ${res.status}`);
        setFeedbackTone("warn");
      }
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : String(err));
      setFeedbackTone("warn");
    } finally {
      setBusy(false);
    }
  }

  return (
    <tr className="border-t border-bg-border/30">
      <td className="py-1 text-ink-100">{entry.userDisplay}</td>
      <td className="py-1 font-mono text-ink-100">{entry.value}</td>
      <td className="py-1 text-ink-300">{entry.kind}</td>
      <td className="py-1 text-ink-300">{entry.scope}</td>
      <td className={"py-1 " + verdictTone}>{verdictText}</td>
      <td className="py-1 text-right">
        {feedback ? (
          <span
            className={
              "text-[10px] " +
              (feedbackTone === "ok" ? "text-sv-green" : "text-amber-300")
            }
          >
            {feedback}
          </span>
        ) : (
          <button
            type="button"
            onClick={onPush}
            disabled={!pushable || busy}
            className={
              "rounded border px-2 py-0.5 text-[10px] font-medium " +
              (pushable
                ? "border-bg-border bg-bg-base/40 text-ink-100 hover:border-sv-sky hover:text-sv-sky"
                : "border-bg-border/30 bg-bg-base/20 text-ink-600 cursor-not-allowed")
            }
            title={
              !ocppIdentityId
                ? "Charger has no OCPP identity yet"
                : !pushable
                  ? "Cannot push a revoked token"
                  : "Send via OCPP SendLocalList (Differential)"
            }
          >
            {busy ? "…" : "Push"}
          </button>
        )}
      </td>
    </tr>
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
