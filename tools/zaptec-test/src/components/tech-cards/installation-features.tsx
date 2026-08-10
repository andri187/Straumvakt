import { Settings2, CheckSquare, Square } from "lucide-react";
import type { Installation } from "@/lib/zaptec";
import {
  decodeFeatures,
  installationTypeLabel,
  installationCategoryLabel,
} from "@/lib/zaptec-enums";

export function InstallationFeaturesCard({
  installation,
}: {
  installation: Installation | null;
}) {
  if (!installation) return null;
  const inst = installation as Installation & {
    InstallationType?: number;
    InstallationCategory?: string;
    AvailableFeatures?: number;
    EnabledFeatures?: number;
    AvailableInternetAccessPLC?: boolean;
    AvailableInternetAccessWiFi?: boolean;
    MessagingEnabled?: boolean;
    RoutingId?: string;
    OcppCloudUrl?: string;
    OcppCloudUrlVersion?: number;
    PropertyMainFuseCurrent?: number;
    PropertyEnergySensorUniqueId?: string;
    PropertyEnergySensorRippleEnabled?: boolean;
    PropertyEnergySensorRippleNumBits?: number;
    PropertyFirmwareAutomaticUpdates?: boolean;
    PropertySessionMaxStopCount?: number;
  };

  const available = decodeFeatures(inst.AvailableFeatures ?? 0);
  const enabled = new Set(
    decodeFeatures(inst.EnabledFeatures ?? 0).map((f) => f.code),
  );

  return (
    <section className="rounded-lg border border-bg-border bg-bg-surface/70 p-5 shadow-card backdrop-blur">
      <header className="mb-3 flex items-center gap-2">
        <Settings2 className="h-4 w-4 text-sv-sky" />
        <h3 className="text-sm font-semibold text-ink-50">
          Installation configuration
        </h3>
      </header>

      <div className="grid gap-4 lg:grid-cols-2">
        <div>
          <p className="mb-1 text-[10px] uppercase tracking-brand text-sv-sky">
            Type &amp; category
          </p>
          <dl className="space-y-0.5 text-[11px]">
            <Kv label="Type" value={installationTypeLabel(inst.InstallationType)} />
            <Kv
              label="Category"
              value={installationCategoryLabel(inst.InstallationCategory)}
            />
            <Kv
              label="Main fuse"
              value={
                inst.PropertyMainFuseCurrent != null
                  ? `${inst.PropertyMainFuseCurrent} A`
                  : inst.MaxCurrent
                    ? `${inst.MaxCurrent} A`
                    : "—"
              }
            />
            <Kv
              label="Energy sensor"
              value={inst.PropertyEnergySensorUniqueId ?? "—"}
              mono
            />
            <Kv
              label="HAN ripple"
              value={
                inst.PropertyEnergySensorRippleEnabled == null
                  ? "—"
                  : inst.PropertyEnergySensorRippleEnabled
                    ? `enabled · ${inst.PropertyEnergySensorRippleNumBits ?? "?"} bits`
                    : "disabled"
              }
            />
            <Kv
              label="Auto firmware update"
              value={
                inst.PropertyFirmwareAutomaticUpdates == null
                  ? "—"
                  : inst.PropertyFirmwareAutomaticUpdates
                    ? "enabled"
                    : "disabled"
              }
            />
            <Kv
              label="Max session stop count"
              value={
                inst.PropertySessionMaxStopCount != null
                  ? String(inst.PropertySessionMaxStopCount)
                  : "—"
              }
            />
          </dl>
        </div>
        <div>
          <p className="mb-1 text-[10px] uppercase tracking-brand text-sv-sky">
            Connectivity &amp; routing
          </p>
          <dl className="space-y-0.5 text-[11px]">
            <Kv
              label="Internet via Wi-Fi"
              value={
                inst.AvailableInternetAccessWiFi == null
                  ? "—"
                  : inst.AvailableInternetAccessWiFi
                    ? "available"
                    : "no"
              }
            />
            <Kv
              label="Internet via PLC"
              value={
                inst.AvailableInternetAccessPLC == null
                  ? "—"
                  : inst.AvailableInternetAccessPLC
                    ? "available"
                    : "no"
              }
            />
            <Kv
              label="Real-time push (Service Bus)"
              value={
                inst.MessagingEnabled == null
                  ? "—"
                  : inst.MessagingEnabled
                    ? "enabled"
                    : "disabled"
              }
            />
            <Kv label="Routing Id" value={inst.RoutingId ?? "—"} mono />
            <Kv
              label="OCPP cloud URL"
              value={inst.OcppCloudUrl?.replace(/^wss:\/\//, "") ?? "—"}
              mono
              truncate
            />
            <Kv
              label="OCPP URL version"
              value={
                inst.OcppCloudUrlVersion != null
                  ? String(inst.OcppCloudUrlVersion)
                  : "—"
              }
            />
          </dl>
        </div>
      </div>

      {/* Feature flags */}
      <div className="mt-4 rounded-md border border-bg-border bg-bg-inset/40 p-3">
        <p className="mb-2 flex items-center gap-2 text-[10px] uppercase tracking-brand text-sv-sky">
          Feature flags
          <span className="text-ink-500">
            (decoded from AvailableFeatures · EnabledFeatures bitmasks)
          </span>
        </p>
        <ul className="grid gap-1 sm:grid-cols-2">
          {available.length === 0 ? (
            <li className="text-xs text-ink-400">No features advertised.</li>
          ) : (
            available.map((f) => {
              const on = enabled.has(f.code);
              return (
                <li
                  key={f.code}
                  className="flex items-center gap-2 rounded px-2 py-1"
                >
                  {on ? (
                    <CheckSquare className="h-3.5 w-3.5 text-sv-green" />
                  ) : (
                    <Square className="h-3.5 w-3.5 text-ink-500" />
                  )}
                  <span
                    className={
                      on ? "text-xs text-ink-100" : "text-xs text-ink-400"
                    }
                  >
                    {f.label}
                  </span>
                  <span className="ml-auto font-mono text-[10px] text-ink-500">
                    0x{f.bit.toString(16)}
                  </span>
                </li>
              );
            })
          )}
        </ul>
        <p className="mt-2 text-[10px] text-ink-500">
          Available bitmask:{" "}
          <span className="font-mono text-ink-300">
            {inst.AvailableFeatures ?? 0}
          </span>{" "}
          · Enabled:{" "}
          <span className="font-mono text-ink-300">
            {inst.EnabledFeatures ?? 0}
          </span>
        </p>
      </div>
    </section>
  );
}

function Kv({
  label,
  value,
  mono,
  truncate,
}: {
  label: string;
  value: string;
  mono?: boolean;
  truncate?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-bg-border/30 pb-1 last:border-0">
      <dt className="shrink-0 text-ink-500">{label}</dt>
      <dd
        className={
          (mono ? "font-mono " : "") +
          (truncate ? "max-w-[60%] truncate " : "") +
          "text-ink-200"
        }
      >
        {value}
      </dd>
    </div>
  );
}
