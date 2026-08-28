import { Wifi, WifiOff } from "lucide-react";
import type {
  Charger,
  Installation,
  StateObservation,
} from "@/lib/zaptec";
import { StateId } from "@/lib/zaptec-state";
import { authenticationTypeLabel, fmtUptimeHours } from "@/lib/zaptec-enums";
import { TechSection } from "@/components/tech-section";

// OCPP connection card. The charger talks OCPP to the CSMS at the URL given
// by the installation's OcppCloudUrl + the charger's OcppDeviceId tail. The
// raw OCPP frames live inside the CSMS worker, but the connection metadata
// is mirrored back through the Zaptec REST API so we can render most of it
// live here.

export function OcppConnectionCard({
  charger,
  installation,
  state,
}: {
  charger: Charger;
  installation: Installation | null;
  state: StateObservation[];
}) {
  const sm = new Map(state.map((s) => [s.StateId, s]));
  const v = (id: number) => sm.get(id)?.ValueAsString;

  const ocppConnected = v(StateId.IsOcppConnected) === "1";
  const isOnline = v(StateId.IsOnline) === "1";

  const inst = installation as
    | (Installation & {
        OcppCloudUrl?: string;
        OcppCloudUrlVersion?: number;
        AuthenticationType?: number;
        MessagingEnabled?: boolean;
        RoutingId?: string;
      })
    | null;
  const c = charger as Charger & {
    PropertyOcppUrl?: string;
    DeviceId?: string;
  };

  // Resolved CSMS URL — installation template with charge-box id appended.
  // The Zaptec URL form ends in /ocpp/<chargeBoxId>; extract the suffix.
  const url = inst?.OcppCloudUrl ?? c.PropertyOcppUrl ?? "";
  const chargeBoxId = (() => {
    const m = url.match(/\/ocpp\/([^/?#]+)/);
    if (m) return m[1];
    // Fall back to the last path segment
    const tail = url.split("/").pop();
    return tail ?? "";
  })();
  const csmsHost = (() => {
    if (!url) return "";
    try {
      return new URL(url.replace(/^wss:/, "https:")).host;
    } catch {
      return "";
    }
  })();

  // Firmware comes from the charger detail or state observations
  const fw =
    v(StateId.SmartComputerSwApp) ??
    String((charger as { firmwareVersion?: string }).firmwareVersion ?? "");
  const fwBoot = v(StateId.SmartComputerSwBoot);
  const hwVer = v(StateId.SmartComputerHwVersion);

  // BootNotification-equivalent fields — synthesized from API responses
  const vendor = v(StateId.ProductName) ?? "ZAPTEC PRO";
  const productCode = v(StateId.ProductCode);
  const serial = c.DeviceId ?? charger.SerialNo ?? "";

  // Last activity — pick the most recent timestamp from any observation
  const lastObs = state
    .map((s) => (s.Timestamp ? new Date(s.Timestamp).getTime() : 0))
    .filter((t) => t > 0)
    .sort((a, b) => b - a)[0];
  const lastObsAt = lastObs ? new Date(lastObs) : null;
  const ageMin = lastObsAt
    ? Math.round((Date.now() - lastObsAt.getTime()) / 60000)
    : null;

  return (
    <TechSection
      title="OCPP connection"
      source="ocpp"
      state={
        ocppConnected
          ? { kind: "connected" }
          : { kind: "disconnected", reason: "IsOcppConnected = 0" }
      }
      hint="Mirror via Zaptec REST · raw frames in CSMS worker"
    >
      {/* Status header */}
      <div className="mb-3 flex items-center gap-3 rounded-md border border-bg-border bg-bg-inset/40 p-3">
        <span
          className={
            ocppConnected
              ? "flex h-9 w-9 items-center justify-center rounded-md bg-sv-green/15 text-sv-green ring-1 ring-inset ring-sv-green/30 shadow-[0_0_8px_rgba(62,233,167,0.45)]"
              : "flex h-9 w-9 items-center justify-center rounded-md bg-red-500/10 text-red-300 ring-1 ring-inset ring-red-500/30"
          }
        >
          {ocppConnected ? <Wifi className="h-4 w-4" /> : <WifiOff className="h-4 w-4" />}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-ink-50">
            {ocppConnected ? "Connected to CSMS" : "Disconnected from CSMS"}
          </p>
          <p className="text-[11px] text-ink-400">
            {isOnline ? "Charger reachable" : "Charger offline"} ·{" "}
            {ageMin != null
              ? `last observation ${ageMin < 60 ? `${ageMin}m` : `${Math.round(ageMin / 60)}h`} ago`
              : "no recent observations"}
          </p>
        </div>
      </div>

      <div className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
        <Kv label="OCPP version" value="1.6J" hint="Zaptec default for AC chargers" />
        <Kv
          label="CSMS endpoint"
          value={url || "—"}
          mono
          truncate
          hint="From installation.OcppCloudUrl (Zaptec REST)"
        />
        <Kv label="CSMS host" value={csmsHost || "—"} mono />
        <Kv
          label="Charge-box Id"
          value={chargeBoxId || "—"}
          mono
          hint="OCPP CP identifier (path tail)"
        />
        <Kv
          label="Auth path"
          value={authenticationTypeLabel(inst?.AuthenticationType)}
          hint="installation.AuthenticationType"
        />
        <Kv
          label="Messaging enabled"
          value={
            inst?.MessagingEnabled === true
              ? "yes (Service Bus)"
              : inst?.MessagingEnabled === false
                ? "no"
                : "—"
          }
        />
        <Kv label="Routing Id" value={inst?.RoutingId ?? "—"} mono />
        <Kv
          label="OCPP URL version"
          value={
            inst?.OcppCloudUrlVersion != null
              ? String(inst.OcppCloudUrlVersion)
              : "—"
          }
        />
      </div>

      <div className="mt-4 border-t border-bg-border pt-3">
        <p className="mb-2 text-[10px] uppercase tracking-brand text-sv-sky">
          BootNotification-equivalent fields
        </p>
        <p className="mb-3 text-[11px] text-ink-500">
          The charger sends these on every OCPP boot. Values mirrored from the
          Zaptec REST charger detail and state observations.
        </p>
        <div className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
          <Kv label="chargePointVendor" value={vendor} mono />
          <Kv label="chargePointModel" value={productCode ?? "—"} mono />
          <Kv label="chargePointSerial" value={serial} mono />
          <Kv label="firmwareVersion" value={fw || "—"} mono />
          <Kv label="bootloader" value={fwBoot ?? "—"} mono />
          <Kv label="hardware" value={hwVer?.split(",")[0] ?? "—"} mono truncate />
          <Kv label="meterSerial" value={serial} mono hint="Same as chargePointSerial on Zaptec Pro" />
          <Kv
            label="iccid / imsi"
            value="(absent — PLC charger has no SIM)"
            hint="Only populated on cellular chargers"
          />
        </div>
      </div>

      <div className="mt-4 border-t border-bg-border pt-3">
        <p className="mb-2 text-[10px] uppercase tracking-brand text-sv-sky">
          Heartbeat &amp; uptime
        </p>
        <div className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
          <Kv
            label="Variscite uptime (820)"
            value={fmtUptimeHours(v(StateId.UptimeVariscite))}
          />
          <Kv
            label="MCU uptime (821)"
            value={fmtUptimeHours(v(StateId.UptimeMCU))}
          />
          <Kv
            label="Last observation timestamp"
            value={lastObsAt ? lastObsAt.toISOString().replace("T", " ").slice(0, 19) + " UTC" : "—"}
            mono
          />
          <Kv
            label="OCPP gateway"
            value={
              csmsHost.includes("straumvakt") ? "Straumvakt OCPP worker" : csmsHost
            }
          />
        </div>
      </div>
    </TechSection>
  );
}

function Kv({
  label,
  value,
  mono,
  truncate,
  hint,
}: {
  label: string;
  value: string;
  mono?: boolean;
  truncate?: boolean;
  hint?: string;
}) {
  return (
    <div
      className="flex items-baseline justify-between gap-3 border-b border-bg-border/30 py-1 last:border-0"
      title={hint}
    >
      <dt className="shrink-0 text-[11px] text-ink-500">{label}</dt>
      <dd
        className={
          (mono ? "font-mono " : "") +
          (truncate ? "max-w-[60%] truncate " : "") +
          "text-[11px] text-ink-200"
        }
      >
        {value}
      </dd>
    </div>
  );
}
