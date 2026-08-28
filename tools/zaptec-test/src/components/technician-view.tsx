import {
  MapPin,
  ShieldCheck,
  Clock,
  Radio,
  Signal,
  Thermometer,
} from "lucide-react";
import type {
  Charger,
  Installation,
  Hierarchy,
  StateObservation,
  ChargeHistoryEntry,
  ChargerFirmwareEntry,
  MessagingConnectionDetails,
} from "@/lib/zaptec";
import {
  StateId,
  stateMap,
  num,
  networkTypeLabel,
  sessionPhaseFromOpMode,
} from "@/lib/zaptec-state";
import { LiveDashboard } from "@/components/live/live-dashboard";
import { SessionStepper } from "@/components/session-stepper";
import { CompletedSessionCard } from "@/components/completed-session-card";
import { InstallationCircuits } from "@/components/installation-circuits";
import { DiagnosticsDrawer } from "@/components/diagnostics-drawer";
import { SvHierarchy, type TierRow } from "@/components/sv-hierarchy";
import { ActionsPanel } from "@/components/actions-panel";
import { SourceBadge } from "@/components/tech-section";
import { OcppConnectionCard } from "@/components/ocpp-cards/connection";
import { OcppConnectorStatusCard } from "@/components/ocpp-cards/connector-status";
import { OcppMeterValuesCard } from "@/components/ocpp-cards/meter-values";
import { OcppConfigurationCard } from "@/components/ocpp-cards/configuration";
import {
  OcppRecentMessagesCard,
  OcppAuthorizationLogCard,
  OcppChargingProfileCard,
} from "@/components/ocpp-cards/messages-auth-profiles";
import {
  SvIdentityBadges,
  HostSupportInfo,
} from "@/components/sv-identity-badges";
import { WarrantyEmblem } from "@/components/warranty-emblem";
import { InfoCard, fmtDate } from "@/components/profile-bits";
import { AlarmsCard } from "@/components/tech-cards/alarms";
import { ChargeHistoryCard } from "@/components/tech-cards/charge-history";
import { FirmwareCard } from "@/components/tech-cards/firmware";
import { NetworkCard } from "@/components/tech-cards/network";
import { DlbCard } from "@/components/tech-cards/dlb";
import { AuthCard } from "@/components/tech-cards/auth";
import { EcoScheduleCard } from "@/components/tech-cards/eco-schedule";
import { HardwareIdentityCard } from "@/components/tech-cards/hardware-identity";
import { InstallationFeaturesCard } from "@/components/tech-cards/installation-features";
import { EnvironmentCard } from "@/components/tech-cards/environment";
import { MessagingCard } from "@/components/tech-cards/messaging";

export function TechnicianView({
  charger,
  installation,
  hierarchy,
  state,
  history,
  firmware,
  messaging,
  tierRows,
}: {
  charger: Charger;
  installation: Installation | null;
  hierarchy: Hierarchy | null;
  state: StateObservation[];
  history: { Pages: number; Data: ChargeHistoryEntry[] } | null;
  firmware: ChargerFirmwareEntry[] | null;
  messaging: MessagingConnectionDetails | null;
  tierRows: TierRow[];
}) {
  const sm = stateMap(state);
  const opModeRaw = sm.get(StateId.ChargerOperationMode)?.ValueAsString;
  const phase = sessionPhaseFromOpMode(opModeRaw);

  // Read completed-session kWh + timestamp from the parsed blob
  let lastSessionKwh: number | null = null;
  let lastSessionAt: string | null = null;
  const compRaw = sm.get(StateId.CompletedSession)?.ValueAsString;
  if (compRaw) {
    try {
      const parsed = JSON.parse(compRaw) as {
        Energy?: string;
        EndDateTime?: string;
      };
      if (parsed.Energy) lastSessionKwh = Number(parsed.Energy);
      if (parsed.EndDateTime) lastSessionAt = parsed.EndDateTime;
    } catch {
      // ignore
    }
  }

  const chargerObj = charger as Charger & {
    PropertyOcppUrl?: string;
    SignedMeterValueKwh?: number;
  };

  // Tech-relevant summary values
  const fwComputer = sm.get(StateId.SmartComputerSwApp)?.ValueAsString;
  const fwMainboard = sm.get(StateId.SmartMainboardSwApp)?.ValueAsString;
  const netType = networkTypeLabel(sm.get(StateId.NetworkType)?.ValueAsString);
  const temp5 = num(sm.get(StateId.TemperatureInternal5)?.ValueAsString);
  const temp6 = num(sm.get(StateId.TemperatureInternal6)?.ValueAsString);
  const humidity = num(sm.get(StateId.Humidity)?.ValueAsString);
  const signal = num(sm.get(StateId.CommunicationSignalStrength)?.ValueAsString);
  const commMode = sm.get(StateId.CommunicationMode)?.ValueAsString;
  const ocppConn = sm.get(StateId.IsOcppConnected)?.ValueAsString === "1";
  const ocppNativeUrl = sm.get(StateId.OcppNativeUrl)?.ValueAsString;

  return (
    <>
      {/* Identity row — CPO, Owner, Warranty */}
      <div className="mb-4 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <SvIdentityBadges installationId={installation?.Id} demoTag />
          <WarrantyEmblem
            commissionIso={(charger.CreatedOnDate as string | undefined) ?? null}
          />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-ink-400">
          <span>
            <MapPin className="mr-1 inline h-3 w-3" />
            <span className="text-ink-200">
              {installation?.Name ?? "Unknown installation"}
            </span>
            {installation?.Address ? (
              <span className="ml-1">
                ·{" "}
                {[installation.Address, installation.City, installation.ZipCode]
                  .filter(Boolean)
                  .join(", ")}
              </span>
            ) : null}
          </span>
          <HostSupportInfo installationId={installation?.Id} />
        </div>
      </div>

      {/* Warranty detail card */}
      {charger.CreatedOnDate ? (
        <div className="mb-4">
          <WarrantyEmblem
            commissionIso={charger.CreatedOnDate as string}
            variant="card"
          />
        </div>
      ) : null}

      {/* Section divider — Vendor REST API */}
      <SectionDivider source="api" muted />

      {/* Active alarms — first priority */}
      <div className="mb-4">
        <AlarmsCard state={state} />
      </div>

      {/* Live dashboard — status, kW hero, phase strip */}
      <LiveDashboard chargerId={charger.Id} initial={state} />

      {/* Tech summary ribbon */}
      <div className="mt-4 grid grid-cols-2 gap-3 rounded-lg border border-bg-border bg-bg-surface/50 p-4 sm:grid-cols-4 lg:grid-cols-6">
        <Metric icon={Signal} label="Signal" value={signal != null ? `${signal}` : "—"} />
        <Metric icon={Radio} label="Comm" value={commLabel(commMode)} />
        <Metric
          icon={ShieldCheck}
          label="OCPP"
          value={ocppConn ? "connected" : "—"}
          tone={ocppConn ? "green" : "muted"}
        />
        <Metric icon={ShieldCheck} label="Firmware" value={fwComputer ?? "—"} />
        <Metric icon={ShieldCheck} label="Grid" value={netType} />
        <Metric
          icon={Thermometer}
          label="Temp"
          value={
            temp5 != null || temp6 != null
              ? `${Math.max(temp5 ?? -999, temp6 ?? -999).toFixed(0)}°C`
              : "—"
          }
        />
      </div>

      {/* Session timeline */}
      <div className="mt-5">
        <SessionStepper
          phase={phase}
          lastSessionKwh={lastSessionKwh}
          lastSessionAt={lastSessionAt}
        />
      </div>

      {/* Completed session with signed meter curve */}
      <div className="mt-5">
        <CompletedSessionCard state={state} />
      </div>

      {/* Charge history + Firmware */}
      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <ChargeHistoryCard
          entries={history?.Data ?? []}
          totalPages={history?.Pages}
        />
        <FirmwareCard
          entries={firmware ?? []}
          currentChargerId={charger.Id}
        />
      </div>

      {/* DLB + Authentication */}
      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <DlbCard state={state} installation={installation} />
        <AuthCard charger={charger} installation={installation} state={state} />
      </div>

      {/* Network + Eco/Schedule */}
      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <NetworkCard state={state} />
        <EcoScheduleCard installation={installation} state={state} />
      </div>

      {/* Hardware identity + Environment */}
      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <HardwareIdentityCard charger={charger} state={state} />
        <EnvironmentCard state={state} />
      </div>

      {/* Installation features */}
      <div className="mt-5">
        <InstallationFeaturesCard installation={installation} />
      </div>

      {/* Real-time messaging */}
      <div className="mt-5">
        <MessagingCard
          details={messaging}
          installationId={charger.InstallationId ?? ""}
        />
      </div>

      {/* ── OCPP protocol section ───────────────────────────────────────── */}
      <SectionDivider source="ocpp" muted className="mt-8" connected={ocppConn} />

      <div className="mt-4 grid gap-5 lg:grid-cols-2">
        <OcppConnectionCard
          charger={charger}
          installation={installation}
          state={state}
        />
        <OcppConnectorStatusCard state={state} />
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <OcppMeterValuesCard state={state} />
        <OcppAuthorizationLogCard ocppConnected={ocppConn} />
      </div>

      <div className="mt-5">
        <OcppConfigurationCard ocppConnected={ocppConn} />
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <OcppRecentMessagesCard ocppConnected={ocppConn} />
        <OcppChargingProfileCard ocppConnected={ocppConn} />
      </div>

      {/* Circuit + Actions */}
      <div className="mt-5 grid gap-5 lg:grid-cols-3">
        <div className="lg:col-span-2">
          {hierarchy ? (
            <InstallationCircuits
              hierarchy={hierarchy}
              currentChargerId={charger.Id}
            />
          ) : null}
        </div>
        <ActionsPanel
          chargerId={charger.Id}
          isCharging={opModeRaw === "3"}
          isPaused={opModeRaw === "5"}
          ocppConnected={false}
        />
      </div>

      {/* Metadata */}
      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <InfoCard
          icon={MapPin}
          title="Installation"
          rows={[
            ["Name", installation?.Name ?? "—"],
            [
              "Address",
              [installation?.Address, installation?.City, installation?.ZipCode]
                .filter(Boolean)
                .join(", ") || "—",
            ],
            ["Main fuse", installation?.MaxCurrent ? `${installation.MaxCurrent} A` : "—"],
            [
              "Available",
              installation?.AvailableCurrent
                ? `${installation.AvailableCurrent} A`
                : "—",
            ],
            [
              "Load balancing",
              installation?.UseLoadBalancing === true
                ? "on"
                : installation?.UseLoadBalancing === false
                  ? "off"
                  : "—",
            ],
            [
              "Auth required",
              installation?.IsRequiredAuthentication === true
                ? "yes"
                : installation?.IsRequiredAuthentication === false
                  ? "no"
                  : "—",
            ],
            ["Timezone", installation?.TimeZoneIanaName ?? "—"],
          ]}
        />
        <InfoCard
          icon={ShieldCheck}
          title="Charger"
          rows={[
            ["Name", charger.Name],
            ["Device Id", (chargerObj.DeviceId as string) ?? "—"],
            ["Firmware", fwComputer ?? "—"],
            ["Mainboard fw", fwMainboard ?? "—"],
            [
              "Lifetime kWh (signed)",
              chargerObj.SignedMeterValueKwh != null
                ? `${chargerObj.SignedMeterValueKwh.toFixed(2)}`
                : "—",
            ],
            ["Humidity", humidity != null ? `${humidity.toFixed(0)}%` : "—"],
            ["Created", fmtDate(charger.CreatedOnDate as string | undefined)],
          ]}
        />
      </div>

      {/* OCPP routing */}
      {chargerObj.PropertyOcppUrl || ocppNativeUrl ? (
        <section className="mt-5 rounded-lg border border-bg-border bg-bg-surface/70 p-5 shadow-card backdrop-blur">
          <header className="mb-3 flex items-center gap-2">
            <Clock className="h-4 w-4 text-sv-sky" />
            <h3 className="text-sm font-semibold text-ink-50">OCPP routing</h3>
          </header>
          <dl className="space-y-2 text-xs">
            {chargerObj.PropertyOcppUrl ? (
              <>
                <Dt
                  label="Vendor-managed URL (template)"
                  value={chargerObj.PropertyOcppUrl}
                  mono
                />
                <Dt
                  label="Resolved endpoint"
                  value={chargerObj.PropertyOcppUrl.replace(
                    "{deviceid}",
                    (chargerObj.DeviceId as string) ?? "",
                  )}
                  mono
                />
              </>
            ) : null}
            {ocppNativeUrl ? (
              <Dt
                label="Native OCPP URL (StateId 861)"
                value={ocppNativeUrl}
                mono
              />
            ) : null}
          </dl>
        </section>
      ) : null}

      {/* Diagnostics drawer */}
      <div className="mt-5">
        <DiagnosticsDrawer state={state} />
      </div>

      {/* V3 hierarchy reference */}
      <div className="mt-5">
        <SvHierarchy rows={tierRows} />
      </div>
    </>
  );
}

// ── helpers ────────────────────────────────────────────────────────────────

function SectionDivider({
  source,
  muted = false,
  connected,
  className = "",
}: {
  source: "api" | "ocpp";
  muted?: boolean;
  /** OCPP connectivity state. Ignored for source="api". */
  connected?: boolean;
  className?: string;
}) {
  const title =
    source === "api"
      ? "Vendor REST API · Zaptec"
      : "OCPP protocol · CSMS path";
  const subtitle =
    source === "api"
      ? "Everything below in this block is sourced from the Zaptec REST API."
      : connected
        ? "Charger is OCPP-connected to the CSMS. Cards below render data the Zaptec REST API mirrors back; the rest needs the CSMS worker's own endpoints."
        : "No OCPP gateway connected — sections render as skeletons showing what would be live when wired.";
  return (
    <div className={`mb-5 flex items-center gap-3 ${className}`}>
      <div
        className={`h-px flex-1 ${muted ? "bg-bg-border/50" : "bg-bg-border"}`}
      />
      <div className="flex flex-col items-center gap-1 px-3">
        <SourceBadge source={source} />
        <p className="text-[11px] text-ink-300 text-center max-w-md">{title}</p>
        <p className="text-[10px] text-ink-500 text-center max-w-md leading-tight">
          {subtitle}
        </p>
      </div>
      <div
        className={`h-px flex-1 ${muted ? "bg-bg-border/50" : "bg-bg-border"}`}
      />
    </div>
  );
}

function commLabel(v: string | undefined): string {
  switch (v) {
    case "0":
      return "Wi-Fi";
    case "1":
      return "LTE";
    case "2":
      return "PLC";
    default:
      return "—";
  }
}

function Metric({
  icon: Icon,
  label,
  value,
  tone = "muted",
}: {
  icon: typeof ShieldCheck;
  label: string;
  value: string;
  tone?: "green" | "muted";
}) {
  return (
    <div>
      <div className="flex items-center gap-1 text-[10px] uppercase tracking-brand text-ink-500">
        <Icon className="h-3 w-3" />
        {label}
      </div>
      <div
        className={
          tone === "green"
            ? "mt-0.5 text-sm font-semibold text-sv-green"
            : "mt-0.5 text-sm font-semibold text-ink-100"
        }
      >
        {value}
      </div>
    </div>
  );
}

function Dt({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-bg-border/40 pb-1 last:border-0">
      <dt className="text-ink-400">{label}</dt>
      <dd
        className={
          mono
            ? "truncate text-right font-mono text-[11px] text-ink-200"
            : "truncate text-right text-ink-200"
        }
      >
        {value}
      </dd>
    </div>
  );
}
