// Per-charger Technical Read.
//
// Mirrors the /technical-read layout 1:1 (same section order, same
// titles, same hints, same grid layout). Each card's body is the
// original PlaceholderRow when the data isn't wired yet, OR an
// InfoRow with the real value for THIS charger when we have it.

import Link from "next/link";
import { notFound } from "next/navigation";
import { cookies } from "next/headers";
import {
  MapPin,
  ShieldCheck,
  Clock,
  Radio,
  Signal,
  Thermometer,
  AlertTriangle,
  Zap,
} from "lucide-react";
import { Topbar } from "@/components/topbar";
import { PageShell } from "@/components/page-shell";
import {
  TechSection,
  SourceBadge,
  InfoRow,
  PlaceholderRow,
} from "@/components/reference/tech-section";
import { adminSessionConfig, verifyAdminSession } from "@/lib/admin-session";
import { apiFetchServer } from "@/lib/api-client-server";
import {
  signalIconClass,
  formatSignal as fmtSignal,
} from "@/lib/signal-quality";
import type { ChargerDetail } from "@straumvakt/shared/domain/chargers";
import type { ChargerTechnicalRead } from "@straumvakt/shared/domain/charger-technical-read";

export const dynamic = "force-dynamic";
export const metadata = { title: "Technical Read · charger" };

const DASH = "—";

function fmtDate(v: string | null): string {
  if (!v) return DASH;
  const d = new Date(v);
  if (!Number.isFinite(d.getTime())) return DASH;
  return d.toLocaleString();
}
function fmtKW(w: number | null): string {
  if (w == null) return DASH;
  return `${(w / 1000).toFixed(2)} kW`;
}

export default async function ChargerTechnicalReadPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const jar = await cookies();
  const token = jar.get(adminSessionConfig.SESSION_COOKIE_NAME)?.value;
  const session = await verifyAdminSession(token);

  const detailRes = await apiFetchServer(`/api/admin/chargers/${id}`);
  if (detailRes.status === 404) notFound();
  if (!detailRes.ok) throw new Error(`HTTP ${detailRes.status}`);
  const { charger } = (await detailRes.json()) as { charger: ChargerDetail };

  const technicalRead = await apiFetchServer(`/api/admin/chargers/${id}/technical-read`)
    .then(async (r) =>
      r.ok ? ((await r.json()) as { technicalRead: ChargerTechnicalRead }).technicalRead : null,
    )
    .catch(() => null);

  // 8.4.8 — latest closed session for this charger (for the
  // "Last session kWh / ended" rows under Session timeline). Same
  // endpoint LatestSessionChart uses on the parent profile page.
  // 8.4.9 — fetch up to 20 sessions in the same call so the
  // Charge history section can render real rows.
  const sessionsList = await apiFetchServer(
    `/api/admin/billing/sessions?chargingStationId=${encodeURIComponent(id)}&limit=20`,
  )
    .then(async (r) => {
      if (!r.ok) return [];
      const j = (await r.json()) as {
        sessions: {
          sessionId: string;
          startedAt: string;
          stoppedAt: string | null;
          energyKwh: string;
          costFormatted: string | null;
          driverIdTag: string | null;
        }[];
      };
      return j.sessions;
    })
    .catch(() => [] as never[]);
  const latestSession = sessionsList[0]
    ? {
        sessionId: sessionsList[0].sessionId,
        energyKwh: Number(sessionsList[0].energyKwh),
        endedAt: sessionsList[0].stoppedAt,
      }
    : null;

  const evse = charger.evses[0];
  const identity = charger.ocppIdentities[0];
  const t = technicalRead;
  const fresh = t?.fresh === true;

  return (
    <>
      <Topbar
        title={`Technical Read — ${identity?.identityString ?? charger.serialNumber ?? id.slice(0, 8)}`}
        email={session?.email}
      />
      <PageShell
        title={`Technical Read — ${identity?.identityString ?? charger.serialNumber ?? id.slice(0, 8)}`}
        description={
          fresh
            ? "Per-charger diagnostics — vendor data live from Zaptec, OCPP data from gateway projections. Fields with a placeholder haven't been wired into the live pipeline yet."
            : "Per-charger diagnostics — Zaptec vendor data is currently unreachable; rows that need it render placeholders."
        }
      >
        <div className="mb-3 text-xs text-ink-400">
          <Link
            href={`/chargers/${charger.chargingStationId}` as Parameters<typeof Link>[0]["href"]}
            className="hover:text-ink-50"
          >
            ← Back to charger profile
          </Link>
        </div>

        {/* Identity strip */}
        <div className="mb-4 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <Badge text={`CPO: ${charger.orgDisplayName}`} />
            <Badge text={`Owner: ${charger.orgDisplayName}`} />
            <Badge text={`Warranty: ${fmtWarranty(charger.warrantyExpires)}`} />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-ink-400">
            <span>
              <MapPin className="mr-1 inline h-3 w-3" />
              <span className="text-ink-300">
                {charger.installationDisplayName ?? charger.siteDisplayName}
                {charger.circuitDisplayName ? ` · ${charger.circuitDisplayName}` : ""}
              </span>
            </span>
            <span className="font-mono text-[10px] text-ink-500">{charger.chargingStationId.slice(0, 8)}</span>
          </div>
        </div>

        {/* API section divider */}
        <SectionDivider source="api" hint="Vendor REST API · Zaptec / Easee" />

        {/* Active alarms */}
        <TechSection title="Active alarms" source="api" hint="StateId 803/804">
          {t?.warningsBitmask == null ? (
            <PlaceholderRow label="active alarm bitmask" trailing="vendor data unreachable" />
          ) : (
            <InfoRow
              label="active alarm bitmask"
              info={
                t.warningsBitmask === 0
                  ? "0 (none — empty when healthy)"
                  : `0x${t.warningsBitmask.toString(16)} (warnings active — see Zaptec docs §6.1 SmartWarnings)`
              }
              mono
            />
          )}
        </TechSection>

        {/* Live dashboard */}
        <TechSection title="Live dashboard" source="api" hint="kW hero + status + phase strip" className="mt-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <DashboardColumn
              icon={Zap}
              label="Charging power"
              trailing={t?.isOnline === false ? "offline" : fmtKW(t?.totalChargePowerW ?? null)}
            />
            <DashboardColumn
              icon={ShieldCheck}
              label="Operation mode"
              trailing={t?.isOnline === false ? "offline" : (t?.chargerOperationMode ?? DASH)}
            />
            <DashboardColumn
              icon={Radio}
              label="Phases"
              trailing={
                t?.isOnline === false
                  ? "offline"
                  : t?.phases
                    ? t.phases
                        .map(
                          (p, i) =>
                            `L${i + 1} ${p.voltageV != null ? `${p.voltageV.toFixed(0)}V` : "—"} / ${p.currentA != null ? `${p.currentA.toFixed(1)}A` : "—"}`,
                        )
                        .join(" · ")
                    : DASH
              }
            />
          </div>
        </TechSection>

        {/* Tech summary ribbon */}
        <section className="mt-4 grid grid-cols-2 gap-3 rounded-lg border border-bg-border bg-bg-surface/50 p-4 sm:grid-cols-4 lg:grid-cols-6">
          <Metric
            icon={Signal}
            label="Signal"
            value={fmtSignal(t?.signalDbm ?? null, t?.communicationMode ?? null)}
            iconClass={signalIconClass(t?.signalDbm ?? null, t?.communicationMode ?? null)}
          />
          <Metric icon={Radio} label="Comm" value={t?.communicationMode ?? DASH} />
          <Metric icon={ShieldCheck} label="OCPP" value={ocppPillValue(t)} />
          <Metric
            icon={ShieldCheck}
            label="Firmware"
            value={t?.firmwareVersion ?? charger.firmwareVersion ?? DASH}
            mono
          />
          <Metric icon={ShieldCheck} label="Grid" value={t?.networkType ?? DASH} />
          <Metric
            icon={Thermometer}
            label="Temp"
            value={t?.internalTemperatureC != null ? `${t.internalTemperatureC.toFixed(1)} °C` : DASH}
          />
        </section>

        {/* Session timeline */}
        <TechSection title="Session timeline" source="api" hint="standby → connected → charging → paused → completed" className="mt-5">
          <div className="flex items-center justify-between gap-2 text-[11px]">
            {["Standby", "Connected", "Charging", "Paused", "Completed"].map((step, i, a) => (
              <span key={step} className="flex flex-1 items-center">
                <span className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-bg-border/60 bg-bg-base/40 font-mono text-ink-500">
                  {i + 1}
                </span>
                <span className="ml-2 text-ink-500 italic">{step}</span>
                {i < a.length - 1 ? <span className="mx-2 h-px flex-1 bg-bg-border/40" /> : null}
              </span>
            ))}
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-2 text-xs">
            {latestSession ? (
              <>
                <InfoRow
                  label="Last session kWh"
                  info={
                    latestSession.energyKwh != null
                      ? `${latestSession.energyKwh.toFixed(3)} kWh`
                      : DASH
                  }
                />
                <InfoRow
                  label="Last session ended"
                  info={fmtDate(latestSession.endedAt)}
                  mono
                />
              </>
            ) : (
              <>
                <PlaceholderRow label="Last session kWh" trailing="no closed sessions yet" />
                <PlaceholderRow label="Last session ended" trailing="no closed sessions yet" />
              </>
            )}
          </div>
        </TechSection>

        {/* Completed session (signed meter curve) */}
        <TechSection title="Completed session — signed meter curve" source="api" hint="StateId 553/554/555 OCMF" className="mt-5">
          <PlaceholderRow label="kWh delivered" trailing="signed meter value" />
          <PlaceholderRow label="Curve" trailing="time-series sparkline" />
          <PlaceholderRow label="Signature" trailing="OCMF envelope · validated" />
          <InfoRow label="MID" info={t?.mid ?? DASH} mono />
        </TechSection>

        {/* Charge history + Firmware */}
        <div className="mt-5 grid gap-5 lg:grid-cols-2">
          <TechSection title="Charge history" source="api" hint={`last ${sessionsList.length} sessions`}>
            {sessionsList.length === 0 ? (
              <PlaceholderRow label="Session list" trailing="no closed sessions yet" />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-[11px]">
                  <thead className="text-[9px] uppercase tracking-brand text-ink-500">
                    <tr className="text-left">
                      <th className="py-1 pr-2 font-medium">Started</th>
                      <th className="py-1 pr-2 font-medium">Ended</th>
                      <th className="py-1 pr-2 text-right font-medium">kWh</th>
                      <th className="py-1 pr-2 text-right font-medium">Cost</th>
                      <th className="py-1 font-medium">Driver tag</th>
                    </tr>
                  </thead>
                  <tbody className="font-mono text-ink-200">
                    {sessionsList.map((s) => (
                      <tr key={s.sessionId} className="border-t border-bg-border/30">
                        <td className="py-1 pr-2">{fmtDate(s.startedAt)}</td>
                        <td className="py-1 pr-2 text-ink-400">{fmtDate(s.stoppedAt)}</td>
                        <td className="py-1 pr-2 text-right">{Number(s.energyKwh).toFixed(3)}</td>
                        <td className="py-1 pr-2 text-right text-ink-300">{s.costFormatted ?? DASH}</td>
                        <td className="py-1 truncate text-ink-400">{s.driverIdTag ?? DASH}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </TechSection>
          <TechSection title="Firmware" source="api" hint="installation rollout state">
            <InfoRow label="Computer SW (911)" info={t?.firmwareVersion ?? charger.firmwareVersion ?? DASH} mono />
            <InfoRow label="Mainboard SW (908)" info={t?.mainboardSwVersion ?? DASH} mono />
            <InfoRow label="Smart bootloader (912)" info={t?.smartBootloaderVersion ?? DASH} mono />
            <InfoRow label="Hardware (913)" info={t?.hardwareVersion ?? DASH} mono />
          </TechSection>
        </div>

        {/* DLB + Authentication */}
        <div className="mt-5 grid gap-5 lg:grid-cols-2">
          <TechSection title="Dynamic load balancing" source="api" hint="installation-level controller">
            <InfoRow
              label="UseLoadBalancing"
              info={t?.installation?.useLoadBalancing == null ? DASH : t.installation.useLoadBalancing ? "yes" : "no"}
            />
            <InfoRow
              label="MaxCurrent"
              info={t?.installation?.maxCurrent != null ? `${t.installation.maxCurrent} A` : DASH}
            />
            <InfoRow
              label="AvailableCurrent"
              info={t?.installation?.availableCurrent != null ? `${t.installation.availableCurrent} A` : DASH}
            />
            <InfoRow
              label="Per-charger allocation"
              info={t?.chargeCurrentSetA != null ? `${t.chargeCurrentSetA.toFixed(1)} A` : DASH}
            />
          </TechSection>
          <TechSection title="Authentication" source="api" hint="charger + installation">
            <InfoRow
              label="IsRequiredAuthentication (installation)"
              info={
                t?.installation?.isRequiredAuthentication == null
                  ? DASH
                  : t.installation.isRequiredAuthentication
                    ? "yes"
                    : "no"
              }
            />
            <InfoRow label="AuthType" info={t?.authenticationTypeLabel ?? DASH} />
            <InfoRow
              label="Last NewChargeCard (750)"
              info={t?.lastChargeCard ?? DASH}
              mono
            />
            <InfoRow
              label="Local auth list version (751)"
              info={t?.authListVersion != null ? String(t.authListVersion) : DASH}
              mono
            />
            <InfoRow
              label="Default idTag"
              info={t?.ocppDefaultIdTag ?? DASH}
              mono
            />
          </TechSection>
        </div>

        {/* Network + Eco/Schedule */}
        <div className="mt-5 grid gap-5 lg:grid-cols-2">
          <TechSection title="Network" source="api" hint="StateId 100 / 102 / 110 / 152 / 154">
            <InfoRow label="NetworkType" info={t?.networkType ?? DASH} />
            <InfoRow label="Communication mode" info={t?.communicationMode ?? DASH} />
            <InfoRow
              label="Signal strength"
              info={fmtSignal(t?.signalDbm ?? null, t?.communicationMode ?? null)}
            />
            <InfoRow
              label="LTE roaming disabled (753)"
              info={t?.lteRoamingDisabled == null ? DASH : t.lteRoamingDisabled ? "yes" : "no"}
            />
            <InfoRow label="Uptime (820)" info={t?.uptimeHours != null ? `${t.uptimeHours.toFixed(1)} h` : DASH} />
          </TechSection>
          <TechSection title="Eco / Schedule" source="api" hint="installation-level rules">
            <PlaceholderRow label="Schedule active" trailing="installation flag" />
            <PlaceholderRow label="Window" trailing="time-of-use start / end" />
            <PlaceholderRow label="Override" trailing="manual operator" />
          </TechSection>
        </div>

        {/* Hardware identity + Environment */}
        <div className="mt-5 grid gap-5 lg:grid-cols-2">
          <TechSection title="Hardware identity" source="api" hint="StateId 950 / 951 / 962 / 980">
            <InfoRow label="Serial number" info={charger.serialNumber ?? t?.serialNo ?? DASH} mono />
            <InfoRow label="DeviceId" info={t?.deviceId ?? DASH} mono />
            <InfoRow label="MID" info={t?.mid ?? DASH} mono />
            <InfoRow label="MAC main (950)" info={t?.macMain ?? DASH} mono />
            <InfoRow label="MAC PLC grid (951)" info={t?.macPlcGrid ?? DASH} mono />
            <InfoRow label="MAC Wi-Fi (952)" info={t?.macWifi ?? DASH} mono />
            <InfoRow
              label="LTE ICCID (962)"
              info={t?.lteIccid ?? charger.iccid ?? DASH}
              mono
            />
            <InfoRow
              label="LTE IMSI (960)"
              info={t?.lteImsi ?? charger.imsi ?? DASH}
              mono
            />
            <InfoRow label="LTE IMEI (963)" info={t?.lteImei ?? DASH} mono />
            <InfoRow label="LTE MSISDN (961)" info={t?.lteMsisdn ?? DASH} mono />
          </TechSection>
          <TechSection title="Environment" source="api" hint="StateId 201 / 202 / 270">
            <InfoRow
              label="Internal temp A (201)"
              info={t?.internalTemperatureC != null ? `${t.internalTemperatureC.toFixed(1)} °C` : DASH}
            />
            <InfoRow
              label="Internal temp B (202)"
              info={t?.internalTempBC != null ? `${t.internalTempBC.toFixed(1)} °C` : DASH}
            />
            <InfoRow
              label="Humidity (270)"
              info={t?.humidityPct != null ? `${t.humidityPct.toFixed(1)} %RH` : DASH}
            />
          </TechSection>
        </div>

        {/* Installation features */}
        <TechSection title="Installation features" source="api" hint="aggregate of installation-level toggles" className="mt-5">
          <div className="grid gap-2 sm:grid-cols-2">
            <InfoRow
              label="UseLoadBalancing"
              info={t?.installation?.useLoadBalancing == null ? DASH : t.installation.useLoadBalancing ? "yes" : "no"}
            />
            <InfoRow
              label="IsRequiredAuthentication"
              info={
                t?.installation?.isRequiredAuthentication == null
                  ? DASH
                  : t.installation.isRequiredAuthentication
                    ? "yes"
                    : "no"
              }
            />
            <InfoRow label="OcppCloudUrl" info={t?.installation?.ocppCloudUrl ?? t?.propertyOcppUrl ?? DASH} mono />
            <InfoRow label="TimeZoneIanaName" info={t?.installation?.timeZoneIanaName ?? DASH} mono />
            <InfoRow
              label="ActiveChargerCount"
              info={t?.installation?.activeChargerCount != null ? String(t.installation.activeChargerCount) : DASH}
            />
            <InfoRow
              label="MaxCurrent / AvailableCurrent"
              info={
                t?.installation?.maxCurrent != null
                  ? `${t.installation.maxCurrent} A / ${t.installation.availableCurrent ?? "—"} A`
                  : DASH
              }
            />
          </div>
        </TechSection>

        {/* Real-time messaging */}
        <TechSection title="Real-time messaging" source="api" hint="installation messaging endpoint" className="mt-5">
          <InfoRow
            label="Messaging enabled"
            info={t?.installation?.messagingEnabled == null ? DASH : t.installation.messagingEnabled ? "yes" : "no"}
          />
          <InfoRow
            label="Subscription topic"
            info={t?.installationId ?? t?.installation?.name ? `installation_${t?.installationId ?? "?"}` : DASH}
            mono
          />
          <PlaceholderRow label="SAS token" trailing="server-side only — fetched per session" />
        </TechSection>

        {/* OCPP section divider */}
        <SectionDivider source="ocpp" hint="OCPP 1.6J · Straumvakt gateway" className="mt-8" />

        <div className="mt-4 grid gap-5 lg:grid-cols-2">
          <TechSection title="OCPP connection" source="ocpp" hint="WS handshake state">
            <InfoRow label="WS URL" info={t?.propertyOcppUrl ?? DASH} mono />
            <PlaceholderRow label="Connected since" trailing="ts of last open" />
            <PlaceholderRow label="Heartbeat interval" trailing="config key" />
            <PlaceholderRow label="Disconnect count (24h)" trailing="from gateway log" />
          </TechSection>
          <TechSection title="Connector status" source="ocpp" hint="StatusNotification feed">
            {evse?.connectors.length ? (
              evse.connectors.map((c) => (
                <InfoRow
                  key={c.id}
                  label={`Connector #${c.connectorIndex}`}
                  info={
                    c.statusUpdatedAt
                      ? `${c.status} · updated ${new Date(c.statusUpdatedAt).toLocaleTimeString()}`
                      : `${c.status} · no OCPP traffic yet`
                  }
                />
              ))
            ) : (
              <PlaceholderRow label="No connectors" />
            )}
            <PlaceholderRow label="Error code" trailing="NoError when healthy" />
            <PlaceholderRow label="Vendor info" trailing="vendor-specific extension" />
          </TechSection>
        </div>

        <div className="mt-5 grid gap-5 lg:grid-cols-2">
          <TechSection title="Meter values" source="ocpp" hint="MeterValues sampling">
            <InfoRow
              label="Energy.Active.Import.Register"
              info={t?.lifetimeEnergyKWh != null ? `${t.lifetimeEnergyKWh.toFixed(3)} kWh lifetime` : DASH}
            />
            <InfoRow
              label="Power.Active.Import"
              info={t?.isOnline === false ? "offline" : fmtKW(t?.totalChargePowerW ?? null)}
            />
            <InfoRow
              label="Voltage / Current per phase"
              info={
                t?.isOnline === false
                  ? "offline"
                  : t?.phases
                    ? t.phases
                        .map(
                          (p, i) =>
                            `L${i + 1} ${p.voltageV != null ? `${p.voltageV.toFixed(0)}V` : "—"}/${p.currentA != null ? `${p.currentA.toFixed(1)}A` : "—"}`,
                        )
                        .join(" · ")
                    : DASH
              }
              mono
            />
            <PlaceholderRow label="Sample interval" trailing="needs GetConfiguration round-trip projection" />
          </TechSection>
          <TechSection title="Authorization log" source="ocpp" hint="Authorize requests">
            <PlaceholderRow label="Last token" trailing="hashed RFID / driver id" />
            <PlaceholderRow label="Decision" trailing="Accepted / Blocked / Expired" />
            <PlaceholderRow label="Source" trailing="local list / CSMS / cache" />
          </TechSection>
        </div>

        <TechSection title="OCPP configuration" source="ocpp" hint="GetConfiguration round-trip · ADR 0010" className="mt-5">
          <PlaceholderRow label="HeartbeatInterval" trailing="standard key" />
          <PlaceholderRow label="MeterValueSampleInterval" trailing="standard key" />
          <PlaceholderRow label="ConnectorPhaseRotation" trailing="standard key" />
          <PlaceholderRow label="AuthorizeRemoteTxRequests" trailing="standard key" />
          <PlaceholderRow label="LocalAuthListEnabled" trailing="standard key" />
          <PlaceholderRow label="… 33 more standard keys" trailing="see /reference/zaptec-api OCPP section" />
        </TechSection>

        <div className="mt-5 grid gap-5 lg:grid-cols-2">
          <TechSection title="Recent messages" source="ocpp" hint="last 50 envelopes either direction">
            <PlaceholderRow label="Direction · Action · ts" trailing="BootNotification / Heartbeat / StatusNotification / MeterValues / StartTransaction / StopTransaction" />
            <PlaceholderRow label="Latency" trailing="round-trip ms" />
          </TechSection>
          <TechSection title="Charging profile" source="ocpp" hint="SetChargingProfile state">
            <PlaceholderRow label="Active profile" trailing="purpose / kind / stack level" />
            <PlaceholderRow label="Schedule period" trailing="time + limit (A / W)" />
            <PlaceholderRow label="Source" trailing="DLB controller / operator / API" />
          </TechSection>
        </div>

        {/* Circuit + Actions */}
        <div className="mt-5 grid gap-5 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <TechSection title="Installation circuits" source="api" hint="this charger highlighted in tree">
              <PlaceholderRow label="Tree shape" trailing="Installation → Circuit → ChargingStation × N" />
              <PlaceholderRow label="Per circuit" trailing="ampereCeiling · phaseCount · vendorCircuitRef" />
              <PlaceholderRow label="Per station" trailing="online · operation mode · current draw" />
            </TechSection>
          </div>
          <TechSection title="Actions" source="both" hint="operator-facing">
            <PlaceholderRow label="Pause / Resume" trailing="commandIds 506/507" />
            <PlaceholderRow label="Stop session" trailing="commandId 102" />
            <PlaceholderRow label="Reboot" trailing="commandId 104 · destructive" />
            <PlaceholderRow label="Update firmware" trailing="commandId 200 · destructive" />
            <PlaceholderRow label="Clear local auth list" trailing="commandId 261" />
          </TechSection>
        </div>

        {/* Metadata footer */}
        <div className="mt-5 grid gap-5 lg:grid-cols-2">
          <TechSection title="Installation metadata" source="api">
            <InfoRow label="Name" info={t?.installation?.name ?? charger.installationDisplayName ?? DASH} />
            <InfoRow
              label="Address"
              info={
                t?.installation?.address || t?.installation?.city || t?.installation?.zipCode
                  ? `${t?.installation?.address ?? ""}, ${t?.installation?.zipCode ?? ""} ${t?.installation?.city ?? ""}`.trim()
                  : DASH
              }
            />
            <InfoRow label="Time zone" info={t?.installation?.timeZoneIanaName ?? DASH} mono />
            <InfoRow
              label="Active charger count"
              info={t?.installation?.activeChargerCount != null ? String(t.installation.activeChargerCount) : DASH}
            />
            <InfoRow label="Created on" info={fmtDate(t?.installation?.createdOnDate ?? null)} />
          </TechSection>
          <TechSection title="Charger metadata" source="api">
            <InfoRow label="Name" info={identity?.identityString ?? charger.serialNumber ?? DASH} />
            <InfoRow label="Serial" info={charger.serialNumber ?? DASH} mono />
            <InfoRow
              label="Device type"
              info={`${charger.vendor ?? DASH} / ${charger.model ?? t?.deviceTypeLabel ?? DASH}`}
            />
            <InfoRow label="Created on" info={fmtDate(charger.warrantyExpires)} />
            <InfoRow label="Property OCPP URL override" info={t?.propertyOcppUrl ?? DASH} mono />
          </TechSection>
        </div>
      </PageShell>
    </>
  );
}

function fmtWarranty(expires: string | null): string {
  if (!expires) return "—";
  const t = new Date(expires + "T00:00:00Z").getTime();
  if (!Number.isFinite(t)) return "—";
  return t > Date.now() ? `in (until ${expires})` : `out (expired ${expires})`;
}

function ocppPillValue(t: ChargerTechnicalRead | null): string {
  if (!t) return DASH;
  if (t.authenticationType == null) return DASH;
  const isOcpp = t.authenticationType === 2 || t.authenticationType === 3;
  if (!isOcpp) return "not OCPP";
  return t.propertyAuthenticationDisabled ? "auth off" : "ready";
}

function Badge({ text }: { text: string }) {
  return (
    <span className="inline-flex items-center rounded border border-bg-border/60 bg-bg-base/40 px-2 py-0.5 font-mono text-[10px] uppercase tracking-brand text-ink-500">
      {text}
    </span>
  );
}

function Metric({
  icon: Icon,
  label,
  value,
  mono,
  iconClass,
}: {
  icon: typeof Signal;
  label: string;
  value: string;
  mono?: boolean;
  /** Override the icon's text color — used by the Signal metric. */
  iconClass?: string;
}) {
  const empty = value === DASH;
  return (
    <div className="flex items-center gap-2">
      <Icon className={`h-4 w-4 ${iconClass ?? "text-ink-500"}`} />
      <div className="flex flex-col">
        <span className="text-[10px] uppercase tracking-brand text-ink-500">{label}</span>
        <span
          className={
            "text-xs " +
            (empty ? "italic text-ink-600" : "text-ink-100") +
            (mono ? " font-mono" : "")
          }
        >
          {value}
        </span>
      </div>
    </div>
  );
}

// 9.8.2 — signal helpers moved to @/lib/signal-quality.

function DashboardColumn({
  icon: Icon,
  label,
  trailing,
}: {
  icon: typeof Zap;
  label: string;
  trailing: string;
}) {
  const empty = trailing === DASH;
  return (
    <div className="rounded border border-bg-border/40 bg-bg-base/30 p-3">
      <div className="flex items-center gap-2 text-[11px] text-ink-300">
        <Icon className="h-3.5 w-3.5" />
        <span className="font-medium">{label}</span>
      </div>
      <p className={"mt-1 text-[11px] " + (empty ? "italic text-ink-500" : "text-ink-100")}>
        {trailing}
      </p>
    </div>
  );
}

function SectionDivider({
  source,
  hint,
  className,
}: {
  source: "api" | "ocpp";
  hint: string;
  className?: string;
}) {
  const Icon = source === "api" ? Zap : Radio;
  return (
    <div className={"flex items-center gap-3 " + (className ?? "")}>
      <div className="h-px flex-1 bg-bg-border/50" />
      <div className="flex flex-col items-center gap-1 px-3">
        <span className="inline-flex items-center gap-1.5">
          <SourceBadge source={source} />
          <Icon className="h-3 w-3 text-ink-400" />
        </span>
        <p className="max-w-md text-center text-[11px] text-ink-300">{hint}</p>
      </div>
      <div className="h-px flex-1 bg-bg-border/50" />
    </div>
  );
}

// silence unused-warnings on imports kept for future wiring
void AlertTriangle;
void Clock;
