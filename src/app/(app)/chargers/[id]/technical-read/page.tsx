// Per-charger Technical Read.
//
// Mirrors the structural skeleton at /technical-read but every card
// is populated with real data for THIS charger. Source tagging on
// each section follows the same convention as the documentation
// view: "API" = vendor REST (Zaptec live), "OCPP" = our gateway
// projections, "BOTH" = field exists on both sides and we merge
// them here.
//
// Sections that haven't been wired yet render their original
// placeholders — clearly marked so the operator knows it's pending
// rather than empty/broken.

import Link from "next/link";
import { notFound } from "next/navigation";
import { cookies } from "next/headers";
import {
  MapPin,
  ShieldCheck,
  Radio,
  Signal,
  Thermometer,
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
import type { ChargerDetail } from "@straumvakt/shared/domain/chargers";
import type { ChargerTechnicalRead } from "@straumvakt/shared/domain/charger-technical-read";

export const dynamic = "force-dynamic";
export const metadata = { title: "Technical Read · charger" };

const DASH = "—";

function fmt(v: unknown, suffix = ""): string {
  if (v == null) return DASH;
  if (typeof v === "number") return Number.isFinite(v) ? `${v}${suffix}` : DASH;
  if (typeof v === "boolean") return v ? "yes" : "no";
  if (typeof v === "string") return v.length > 0 ? `${v}${suffix}` : DASH;
  return DASH;
}
function fmtKWh(v: number | null): string {
  if (v == null) return DASH;
  return `${v.toFixed(3)} kWh`;
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

  // Fan out the same two fetches the profile page does — server-side,
  // parallel, so the only added latency over the profile is the
  // technical-read Zaptec call (which the profile already pays for).
  const detailRes = await apiFetchServer(`/api/admin/chargers/${id}`);
  if (detailRes.status === 404) notFound();
  if (!detailRes.ok) throw new Error(`HTTP ${detailRes.status}`);
  const { charger } = (await detailRes.json()) as { charger: ChargerDetail };

  const technicalRead = await apiFetchServer(`/api/admin/chargers/${id}/technical-read`)
    .then(async (r) =>
      r.ok ? ((await r.json()) as { technicalRead: ChargerTechnicalRead }).technicalRead : null,
    )
    .catch(() => null);

  const evse = charger.evses[0];
  const connector = evse?.connectors[0];
  const identity = charger.ocppIdentities[0];

  const fresh = technicalRead?.fresh === true;
  const t = technicalRead;

  return (
    <>
      <Topbar title={`Technical Read · ${identity?.identityString ?? charger.serialNumber ?? id.slice(0, 8)}`} email={session?.email} />
      <PageShell
        title={`Technical Read — ${identity?.identityString ?? charger.serialNumber ?? id.slice(0, 8)}`}
        description={`Live diagnostics for the charger. Vendor data fetched from Zaptec each page load; OCPP data populated by gateway projections. ${
          fresh ? "Vendor reachable." : "Vendor data unreachable — fields fall back where possible."
        }`}
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
            <Badge text={`Org: ${charger.orgDisplayName}`} />
            {charger.installationDisplayName && <Badge text={`Installation: ${charger.installationDisplayName}`} />}
            {charger.warrantyExpires && (
              <Badge text={`Warranty: ${new Date(charger.warrantyExpires).getTime() > Date.now() ? "in" : "out"} (${charger.warrantyExpires})`} />
            )}
            {charger.serialNumber && <Badge text={`Serial: ${charger.serialNumber}`} mono />}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-ink-400">
            <span>
              <MapPin className="mr-1 inline h-3 w-3" />
              <span className="text-ink-300">{charger.siteDisplayName}</span>
              {charger.circuitDisplayName && <> · <span className="text-ink-300">{charger.circuitDisplayName}</span></>}
            </span>
            <span className="font-mono text-[10px] text-ink-500">{charger.chargingStationId}</span>
          </div>
        </div>

        <SectionDivider source="api" hint="Vendor REST API · Zaptec live" />

        {/* Active alarms — from warningsBitmask */}
        <TechSection title="Active alarms" source="api" hint="StateId 803/804">
          {t?.warningsBitmask == null ? (
            <PlaceholderRow label="Vendor data unreachable" trailing="—" />
          ) : t.warningsBitmask === 0 ? (
            <InfoRow label="Notifications + Warnings bitmask" info="0 (none)" mono />
          ) : (
            <InfoRow label="Active warnings bitmask" info={`0x${t.warningsBitmask.toString(16)}`} mono />
          )}
        </TechSection>

        {/* Live dashboard */}
        <TechSection title="Live dashboard" source="api" hint="kW · operation mode · phases" className="mt-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <DashboardCell icon={Zap} label="Charging power" value={fmtKW(t?.totalChargePowerW ?? null)} />
            <DashboardCell icon={ShieldCheck} label="Operation mode" value={t?.chargerOperationMode ?? DASH} />
            <DashboardCell icon={Radio} label="Connector type" value={connector?.type ?? DASH} />
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-3 text-[11px] font-mono">
            {t?.phases.map((p, i) => (
              <div key={i} className="rounded border border-bg-border/40 bg-bg-base/30 p-2">
                <p className="text-[10px] uppercase tracking-brand text-ink-500">L{i + 1}</p>
                <p className="text-ink-200">
                  {p.voltageV != null ? `${p.voltageV.toFixed(0)} V` : DASH}
                  {" · "}
                  {p.currentA != null ? `${p.currentA.toFixed(1)} A` : DASH}
                </p>
              </div>
            )) ?? <PlaceholderRow label="phase data unavailable" trailing="—" />}
          </div>
        </TechSection>

        {/* Tech summary ribbon */}
        <section className="mt-4 grid grid-cols-2 gap-3 rounded-lg border border-bg-border bg-bg-surface/50 p-4 sm:grid-cols-4 lg:grid-cols-6">
          <Metric icon={Signal} label="Signal" value={t?.signalDbm != null ? `${t.signalDbm} dBm` : DASH} />
          <Metric icon={Radio} label="Comm" value={t?.communicationMode ?? DASH} />
          <Metric icon={ShieldCheck} label="OCPP" value={
            t?.authenticationType == null
              ? DASH
              : t.authenticationType === 2 || t.authenticationType === 3
                ? (t.propertyAuthenticationDisabled ? "auth off" : "ready")
                : "not OCPP"
          } />
          <Metric icon={ShieldCheck} label="Firmware" value={t?.firmwareVersion ?? charger.firmwareVersion ?? DASH} mono />
          <Metric icon={ShieldCheck} label="Grid" value={t?.networkType ?? DASH} />
          <Metric icon={Thermometer} label="Temp" value={t?.internalTemperatureC != null ? `${t.internalTemperatureC.toFixed(1)} °C` : DASH} />
        </section>

        {/* Charge history + Firmware */}
        <div className="mt-5 grid gap-5 lg:grid-cols-2">
          <TechSection title="Charge history" source="api" hint="last N sessions">
            <PlaceholderRow label="Session list" trailing="not yet wired — Zaptec /api/chargehistory" />
          </TechSection>
          <TechSection title="Firmware" source="api" hint="StateId 908/909/911/912">
            <InfoRow label="Computer SW (911)" info={t?.firmwareVersion ?? charger.firmwareVersion ?? DASH} mono />
            <PlaceholderRow label="Mainboard SW (908)" trailing="not yet surfaced" />
            <PlaceholderRow label="Smart bootloader (912)" trailing="not yet surfaced" />
          </TechSection>
        </div>

        {/* DLB + Authentication */}
        <div className="mt-5 grid gap-5 lg:grid-cols-2">
          <TechSection title="Dynamic load balancing" source="api" hint="installation-level">
            <PlaceholderRow label="UseLoadBalancing / MaxCurrent / AvailableCurrent" trailing="installation fetch not wired here yet" />
          </TechSection>
          <TechSection title="Authentication" source="api" hint="charger + installation">
            <InfoRow label="Auth mode" info={t?.authenticationTypeLabel ?? DASH} />
            <InfoRow label="Basic-Auth required" info={
              t?.propertyAuthenticationDisabled == null
                ? DASH
                : t.propertyAuthenticationDisabled
                  ? "no — disabled"
                  : "yes"
            } />
            <InfoRow label="Default idTag" info={t?.ocppDefaultIdTag ?? DASH} mono />
            <InfoRow label="Local auth list version (751)" info={t?.authListVersion != null ? String(t.authListVersion) : DASH} mono />
          </TechSection>
        </div>

        {/* Network + Hardware identity */}
        <div className="mt-5 grid gap-5 lg:grid-cols-2">
          <TechSection title="Network" source="api" hint="StateId 150 / 715 / 809 / 820">
            <InfoRow label="NetworkType (715)" info={t?.networkType ?? DASH} />
            <InfoRow label="Communication mode (150)" info={t?.communicationMode ?? DASH} />
            <InfoRow label="Signal strength (809)" info={t?.signalDbm != null ? `${t.signalDbm} dBm` : DASH} />
            <InfoRow label="Uptime (820)" info={t?.uptimeHours != null ? `${t.uptimeHours.toFixed(1)} h` : DASH} />
          </TechSection>
          <TechSection title="Hardware identity" source="both" hint="OCPP boot mirror + vendor live">
            <InfoRow label="DeviceId" info={t?.deviceId ?? DASH} mono />
            <InfoRow label="Charge box serial" info={charger.chargeBoxSerialNumber ?? t?.deviceId ?? DASH} mono />
            <InfoRow label="MID" info={t?.mid ?? charger.meterSerialNumber ?? DASH} mono />
            <InfoRow label="MAC (main / Wi-Fi)" info={`${t?.macMain ?? DASH} / ${t?.macWifi ?? DASH}`} mono />
            <InfoRow label="LTE ICCID / IMSI" info={`${t?.lteIccid ?? charger.iccid ?? DASH} / ${t?.lteImsi ?? charger.imsi ?? DASH}`} mono />
          </TechSection>
        </div>

        {/* Environment + Eco/Schedule */}
        <div className="mt-5 grid gap-5 lg:grid-cols-2">
          <TechSection title="Environment" source="api" hint="StateId 201/202/270">
            <InfoRow label="Internal temperature" info={t?.internalTemperatureC != null ? `${t.internalTemperatureC.toFixed(1)} °C` : DASH} />
            <PlaceholderRow label="Humidity (270)" trailing="not yet surfaced" />
          </TechSection>
          <TechSection title="Eco / Schedule" source="api" hint="installation-level rules">
            <PlaceholderRow label="Schedule active / Window / Override" trailing="not yet wired" />
          </TechSection>
        </div>

        {/* Installation features + Real-time messaging */}
        <div className="mt-5 grid gap-5 lg:grid-cols-2">
          <TechSection title="Installation features" source="api">
            <InfoRow label="Routing ID (801)" info={t?.routingId ?? DASH} mono />
            <InfoRow label="Installation ID (800)" info={t?.installationId ?? charger.installationId ?? DASH} mono />
          </TechSection>
          <TechSection title="Real-time messaging" source="api" hint="Zaptec Service Bus push">
            <PlaceholderRow label="Connection details" trailing="server-side only — not surfaced here" />
          </TechSection>
        </div>

        <SectionDivider source="ocpp" hint="OCPP 1.6J · Straumvakt gateway" className="mt-8" />

        <div className="mt-4 grid gap-5 lg:grid-cols-2">
          <TechSection title="OCPP connection" source="ocpp" hint="WebSocket handshake state">
            <InfoRow label="WS URL (vendor configured)" info={t?.propertyOcppUrl ?? DASH} mono />
            <InfoRow label="OcppIdentity status" info={identity ? "provisioned" : "—"} />
            <InfoRow label="Last seen by gateway" info={
              identity == null
                ? DASH
                : "from OcppIdentity.last_seen_at — wire up later"
            } />
          </TechSection>
          <TechSection title="Connector status" source="ocpp" hint="connector.status_updated projection">
            {evse?.connectors.length ? (
              evse.connectors.map((c) => (
                <InfoRow
                  key={c.id}
                  label={`Connector #${c.connectorIndex} (${c.type})`}
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
          </TechSection>
        </div>

        <div className="mt-5 grid gap-5 lg:grid-cols-2">
          <TechSection title="Meter values" source="ocpp" hint="MeterValues sampling">
            <InfoRow label="Lifetime energy (vendor)" info={fmtKWh(null)} />
            <InfoRow label="Power.Active.Import" info={fmtKW(t?.totalChargePowerW ?? null)} />
            <InfoRow
              label="Voltage / Current per phase"
              info={t?.phases ? t.phases.map((p, i) => `L${i + 1}: ${p.voltageV != null ? `${p.voltageV.toFixed(0)}V` : "—"}/${p.currentA != null ? `${p.currentA.toFixed(1)}A` : "—"}`).join(" · ") : DASH}
              mono
            />
          </TechSection>
          <TechSection title="Authorization log" source="ocpp" hint="Authorize requests">
            <PlaceholderRow label="Last token / decision / source" trailing="auth log not yet wired" />
          </TechSection>
        </div>

        <TechSection title="OCPP configuration" source="ocpp" hint="GetConfiguration round-trip · ADR 0010" className="mt-5">
          <PlaceholderRow label="Standard keys" trailing="will populate when GetConfiguration command lands and the projection captures the response" />
        </TechSection>

        <div className="mt-5 grid gap-5 lg:grid-cols-2">
          <TechSection title="Recent messages" source="ocpp" hint="last 50 envelopes either direction">
            <PlaceholderRow label="message log" trailing="not yet wired" />
          </TechSection>
          <TechSection title="Charging profile" source="ocpp" hint="SetChargingProfile state">
            <PlaceholderRow label="Active profile" trailing="not yet wired" />
          </TechSection>
        </div>

        {/* Metadata footer */}
        <div className="mt-5 grid gap-5 lg:grid-cols-2">
          <TechSection title="Installation metadata" source="api">
            <InfoRow label="Installation" info={charger.installationDisplayName ?? DASH} />
            <InfoRow label="Site" info={charger.siteDisplayName} />
            <InfoRow label="Org" info={charger.orgDisplayName} />
          </TechSection>
          <TechSection title="Charger metadata" source="both">
            <InfoRow label="Vendor / model" info={`${charger.vendor ?? DASH} / ${charger.model ?? DASH}`} />
            <InfoRow label="Serial number" info={charger.serialNumber ?? DASH} mono />
            <InfoRow label="Warranty expires" info={fmt(charger.warrantyExpires)} />
            <InfoRow label="Property OCPP URL override" info={t?.propertyOcppUrl ?? DASH} mono />
          </TechSection>
        </div>
      </PageShell>
    </>
  );
}

function Badge({ text, mono }: { text: string; mono?: boolean }) {
  return (
    <span
      className={
        "inline-flex items-center rounded border border-bg-border/60 bg-bg-base/40 px-2 py-0.5 text-[10px] uppercase tracking-brand text-ink-300 " +
        (mono ? "font-mono" : "")
      }
    >
      {text}
    </span>
  );
}

function Metric({
  icon: Icon,
  label,
  value,
  mono,
}: {
  icon: typeof Signal;
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-center gap-2 min-w-0">
      <Icon className="h-4 w-4 shrink-0 text-ink-500" />
      <div className="flex flex-col min-w-0">
        <span className="text-[10px] uppercase tracking-brand text-ink-500">{label}</span>
        <span className={`text-xs text-ink-100 truncate ${mono ? "font-mono" : ""}`}>{value}</span>
      </div>
    </div>
  );
}

function DashboardCell({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Zap;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded border border-bg-border/40 bg-bg-base/30 p-3">
      <div className="flex items-center gap-2 text-[11px] text-ink-300">
        <Icon className="h-3.5 w-3.5" />
        <span className="font-medium">{label}</span>
      </div>
      <p className="mt-1 text-sm text-ink-100">{value}</p>
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
