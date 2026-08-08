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
import { TechSection, SourceBadge, PlaceholderRow } from "@/components/reference/tech-section";
import { adminSessionConfig, verifyAdminSession } from "@/lib/admin-session";

export const metadata = { title: "Technical Read" };

// Technical Read — structural skeleton.
//
// The original implementation iframed an external app (localhost:3100) that
// fetched live Zaptec API + OCPP gateway data per charger. That iframe does
// not survive the Cloudflare deploy. This page replaces it with a no-data
// version of the same layout — every section header and card frame is
// present so the operator can see what the page will hold once the
// component port + static fixture (or live data) lands.
//
// Cards mirror the zaptec-test technician view section-by-section so a
// future port lands in the same slots without a full redesign.

export default async function TechnicalReadPage() {
  const jar = await cookies();
  const token = jar.get(adminSessionConfig.SESSION_COOKIE_NAME)?.value;
  const session = await verifyAdminSession(token);

  return (
    <>
      <Topbar title="Technical Read" email={session?.email} />
      <PageShell
        title="Technical Read"
        description="Per-charger diagnostics — identity strip, alarms, live dashboard, session timeline, signed meter curve, charge history, firmware, DLB, authentication, network, eco-schedule, hardware identity, environment, installation features, messaging, OCPP cards, circuits, actions."
      >
        {/* Phase note */}
        <section className="mb-4 rounded-lg border border-amber-700/40 bg-amber-950/20 p-3 shadow-card backdrop-blur">
          <div className="flex flex-wrap items-start gap-3">
            <span className="inline-flex h-5 items-center rounded bg-amber-700/30 px-2 text-[10px] font-semibold uppercase tracking-brand text-amber-200">
              Skeleton
            </span>
            <span className="flex-1 text-xs text-ink-200">
              Layout-only view — no data wired in yet. The original technician
              page lived in an external app at{" "}
              <code className="rounded bg-bg-base/60 px-1.5 py-0.5 font-mono text-[11px]">
                localhost:3100
              </code>{" "}
              and did not survive the Cloudflare deploy. Cards below show
              every section that the live version renders; placeholder rows
              indicate which fields each card carries. A static-fixture port
              and the live Zaptec API + Straumvakt OCPP wiring land in
              follow-up sprints.
            </span>
          </div>
        </section>

        {/* Identity strip */}
        <div className="mb-4 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <Badge text="CPO: —" />
            <Badge text="Owner: —" />
            <Badge text="Warranty: —" />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-ink-400">
            <span>
              <MapPin className="mr-1 inline h-3 w-3" />
              <span className="text-ink-500 italic">installation name · address</span>
            </span>
            <span className="italic text-ink-500">host support contact</span>
          </div>
        </div>

        {/* API section divider */}
        <SectionDivider source="api" hint="Vendor REST API · Zaptec / Easee" />

        {/* Active alarms */}
        <TechSection title="Active alarms" source="api" hint="StateId 803/804">
          <PlaceholderRow label="active alarm bitmask" trailing="no alarms — empty when healthy" />
        </TechSection>

        {/* Live dashboard */}
        <TechSection title="Live dashboard" source="api" hint="kW hero + status + phase strip" className="mt-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <PlaceholderColumn icon={Zap} label="Charging power" trailing="kW + 60s sparkline" />
            <PlaceholderColumn icon={ShieldCheck} label="Operation mode" trailing="standby / connected / charging / paused" />
            <PlaceholderColumn icon={Radio} label="Phases" trailing="L1 / L2 / L3 currents + voltages" />
          </div>
        </TechSection>

        {/* Tech summary ribbon */}
        <section className="mt-4 grid grid-cols-2 gap-3 rounded-lg border border-bg-border bg-bg-surface/50 p-4 sm:grid-cols-4 lg:grid-cols-6">
          <Metric icon={Signal} label="Signal" />
          <Metric icon={Radio} label="Comm" />
          <Metric icon={ShieldCheck} label="OCPP" />
          <Metric icon={ShieldCheck} label="Firmware" />
          <Metric icon={ShieldCheck} label="Grid" />
          <Metric icon={Thermometer} label="Temp" />
        </section>

        {/* Session timeline */}
        <TechSection title="Session timeline" source="api" hint="standby → connected → charging → paused → completed" className="mt-5">
          <div className="flex items-center justify-between gap-2 text-[11px]">
            {["Standby", "Connected", "Charging", "Paused", "Completed"].map((step, i, a) => (
              <span key={step} className="flex flex-1 items-center">
                <span className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-bg-border/60 bg-bg-base/40 font-mono text-ink-500">{i + 1}</span>
                <span className="ml-2 text-ink-500 italic">{step}</span>
                {i < a.length - 1 ? <span className="mx-2 h-px flex-1 bg-bg-border/40" /> : null}
              </span>
            ))}
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-2 text-xs">
            <PlaceholderRow label="Last session kWh" trailing="from CompletedSession blob" />
            <PlaceholderRow label="Last session ended" trailing="ISO timestamp" />
          </div>
        </TechSection>

        {/* Completed session (signed meter curve) */}
        <TechSection title="Completed session — signed meter curve" source="api" hint="StateId 553/554/555 OCMF" className="mt-5">
          <PlaceholderRow label="kWh delivered" trailing="signed meter value" />
          <PlaceholderRow label="Curve" trailing="time-series sparkline" />
          <PlaceholderRow label="Signature" trailing="OCMF envelope · validated" />
          <PlaceholderRow label="MID" trailing="meter identification code" />
        </TechSection>

        {/* Charge history + Firmware */}
        <div className="mt-5 grid gap-5 lg:grid-cols-2">
          <TechSection title="Charge history" source="api" hint="last N sessions">
            <PlaceholderRow label="Session list" trailing="paginated · most-recent-first" />
            <PlaceholderRow label="Per row" trailing="start / end / kWh / kr / driver tag" />
          </TechSection>
          <TechSection title="Firmware" source="api" hint="installation rollout state">
            <PlaceholderRow label="Computer SW" trailing="StateId 908" />
            <PlaceholderRow label="Mainboard SW" trailing="StateId 909" />
            <PlaceholderRow label="Smart bootloader" trailing="StateId 911/912" />
            <PlaceholderRow label="Rollout cohort" trailing="installation-wide schedule" />
          </TechSection>
        </div>

        {/* DLB + Authentication */}
        <div className="mt-5 grid gap-5 lg:grid-cols-2">
          <TechSection title="Dynamic load balancing" source="api" hint="installation-level controller">
            <PlaceholderRow label="UseLoadBalancing" trailing="installation flag" />
            <PlaceholderRow label="MaxCurrent" trailing="installation cap (A)" />
            <PlaceholderRow label="AvailableCurrent" trailing="real-time headroom" />
            <PlaceholderRow label="Per-charger allocation" trailing="circuit-aware split" />
          </TechSection>
          <TechSection title="Authentication" source="api" hint="charger + installation">
            <PlaceholderRow label="IsRequiredAuthentication" trailing="installation flag" />
            <PlaceholderRow label="AuthType" trailing="StateId 750 — RFID / app / OCPP-native" />
            <PlaceholderRow label="Last auth attempt" trailing="StateId 752" />
            <PlaceholderRow label="Local auth list size" trailing="StateId 751" />
          </TechSection>
        </div>

        {/* Network + Eco/Schedule */}
        <div className="mt-5 grid gap-5 lg:grid-cols-2">
          <TechSection title="Network" source="api" hint="StateId 100 / 102 / 110 / 152 / 154">
            <PlaceholderRow label="NetworkType" trailing="IT / TN / TT" />
            <PlaceholderRow label="Communication mode" trailing="WiFi / 4G / Ethernet" />
            <PlaceholderRow label="Signal strength" trailing="dBm or %" />
            <PlaceholderRow label="LTE roaming" trailing="StateId 803" />
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
            <PlaceholderRow label="Serial number" trailing="from charger record" />
            <PlaceholderRow label="MID" trailing="meter identification" />
            <PlaceholderRow label="MAC address" trailing="StateId 950" />
            <PlaceholderRow label="LTE identifiers" trailing="StateId 951–953" />
          </TechSection>
          <TechSection title="Environment" source="api" hint="StateId 507 / 508 / 509 / 553">
            <PlaceholderRow label="Internal temp 5" trailing="°C" />
            <PlaceholderRow label="Internal temp 6" trailing="°C" />
            <PlaceholderRow label="Humidity" trailing="%RH" />
          </TechSection>
        </div>

        {/* Installation features */}
        <TechSection title="Installation features" source="api" hint="aggregate of installation-level toggles" className="mt-5">
          <div className="grid gap-2 sm:grid-cols-2">
            <PlaceholderRow label="UseLoadBalancing" />
            <PlaceholderRow label="IsRequiredAuthentication" />
            <PlaceholderRow label="OcppCloudUrl" />
            <PlaceholderRow label="TimeZoneIanaName" />
            <PlaceholderRow label="ActiveChargerCount" />
            <PlaceholderRow label="MaxCurrent / AvailableCurrent" />
          </div>
        </TechSection>

        {/* Real-time messaging */}
        <TechSection title="Real-time messaging" source="api" hint="installation messaging endpoint" className="mt-5">
          <PlaceholderRow label="Connection URL" trailing="vendor cloud URL" />
          <PlaceholderRow label="Status" trailing="connected / disconnected" />
          <PlaceholderRow label="Subscription topic" trailing="installation-id key" />
        </TechSection>

        {/* OCPP section divider */}
        <SectionDivider source="ocpp" hint="OCPP 1.6J · Straumvakt gateway" className="mt-8" />

        <div className="mt-4 grid gap-5 lg:grid-cols-2">
          <TechSection title="OCPP connection" source="ocpp" hint="WS handshake state">
            <PlaceholderRow label="WS URL" trailing="propertyOcppUrl override" />
            <PlaceholderRow label="Connected since" trailing="ts of last open" />
            <PlaceholderRow label="Heartbeat interval" trailing="config key" />
            <PlaceholderRow label="Disconnect count (24h)" trailing="from gateway log" />
          </TechSection>
          <TechSection title="Connector status" source="ocpp" hint="StatusNotification feed">
            <PlaceholderRow label="Connector 1" trailing="Available / Preparing / Charging / Finishing / Faulted" />
            <PlaceholderRow label="Error code" trailing="NoError when healthy" />
            <PlaceholderRow label="Vendor info" trailing="vendor-specific extension" />
          </TechSection>
        </div>

        <div className="mt-5 grid gap-5 lg:grid-cols-2">
          <TechSection title="Meter values" source="ocpp" hint="MeterValues sampling">
            <PlaceholderRow label="Energy.Active.Import.Register" trailing="kWh lifetime" />
            <PlaceholderRow label="Power.Active.Import" trailing="kW now" />
            <PlaceholderRow label="Voltage / Current per phase" trailing="L1 / L2 / L3" />
            <PlaceholderRow label="Sample interval" trailing="config key" />
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
            <PlaceholderRow label="Name" />
            <PlaceholderRow label="Address" />
            <PlaceholderRow label="Time zone" />
            <PlaceholderRow label="Active charger count" />
            <PlaceholderRow label="Created on" />
          </TechSection>
          <TechSection title="Charger metadata" source="api">
            <PlaceholderRow label="Name" />
            <PlaceholderRow label="Serial" />
            <PlaceholderRow label="Device type" />
            <PlaceholderRow label="Created on" />
            <PlaceholderRow label="Property OCPP URL override" />
          </TechSection>
        </div>
      </PageShell>
    </>
  );
}

function Badge({ text }: { text: string }) {
  return (
    <span className="inline-flex items-center rounded border border-bg-border/60 bg-bg-base/40 px-2 py-0.5 font-mono text-[10px] uppercase tracking-brand text-ink-500">
      {text}
    </span>
  );
}

function Metric({ icon: Icon, label }: { icon: typeof Signal; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <Icon className="h-4 w-4 text-ink-500" />
      <div className="flex flex-col">
        <span className="text-[10px] uppercase tracking-brand text-ink-500">{label}</span>
        <span className="font-mono text-xs italic text-ink-600">—</span>
      </div>
    </div>
  );
}

function PlaceholderColumn({ icon: Icon, label, trailing }: { icon: typeof Zap; label: string; trailing: string }) {
  return (
    <div className="rounded border border-bg-border/40 bg-bg-base/30 p-3">
      <div className="flex items-center gap-2 text-[11px] text-ink-300">
        <Icon className="h-3.5 w-3.5" />
        <span className="font-medium">{label}</span>
      </div>
      <p className="mt-1 text-[10px] italic text-ink-500">{trailing}</p>
    </div>
  );
}

function SectionDivider({ source, hint, className }: { source: "api" | "ocpp"; hint: string; className?: string }) {
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

// silence unused-warnings on imports we keep for future wiring
void AlertTriangle;
void Clock;
