import type { StateObservation } from "@/lib/zaptec";
import { StateId } from "@/lib/zaptec-state";
import { decodeWarnings } from "@/lib/zaptec-enums";
import { TechSection } from "@/components/tech-section";
import { cn } from "@/lib/cn";

// Map ChargerOperationMode (StateId 710) → OCPP 1.6J § 4.9 ConnectorStatus.
// This is approximate — Zaptec lumps several OCPP states into "Connected_*"
// codes. The map below uses the closest one-to-one correspondence.
function deriveConnectorStatus(
  opMode: string | undefined,
  isEnabled: boolean,
  faulted: boolean,
): {
  status: string;
  desc: string;
  tone: "green" | "blue" | "amber" | "red" | "grey";
} {
  if (faulted) {
    return {
      status: "Faulted",
      desc: "Charger reports an error condition",
      tone: "red",
    };
  }
  if (!isEnabled) {
    return {
      status: "Unavailable",
      desc: "Operator marked the connector Inoperative",
      tone: "grey",
    };
  }
  switch (opMode) {
    case "1":
      return {
        status: "Available",
        desc: "Idle, ready to charge (Zaptec OperationMode = Disconnected)",
        tone: "green",
      };
    case "2":
      return {
        status: "Preparing",
        desc: "Cable plugged, waiting for auth or for EV (Zaptec Connected_Requesting)",
        tone: "blue",
      };
    case "3":
      return {
        status: "Charging",
        desc: "Energy is flowing (Zaptec Connected_Charging)",
        tone: "green",
      };
    case "5":
      return {
        status: "Finishing",
        desc: "Session ended, cable still locked (Zaptec Connected_Finished)",
        tone: "amber",
      };
    case "6":
      return {
        status: "SuspendedEVSE",
        desc: "Charger paused — DLB throttling (Zaptec Connected_RequestingLimited)",
        tone: "amber",
      };
    default:
      return {
        status: "Unavailable",
        desc: "OperationMode unknown",
        tone: "grey",
      };
  }
}

const ALL_STATUSES = [
  { key: "Available", desc: "Idle, ready to charge", tone: "green" as const },
  { key: "Preparing", desc: "Cable plugged, waiting for auth or for EV", tone: "blue" as const },
  { key: "Charging", desc: "Energy is flowing", tone: "green" as const },
  { key: "SuspendedEVSE", desc: "Charger paused (e.g. DLB throttling to zero)", tone: "amber" as const },
  { key: "SuspendedEV", desc: "EV asked to stop drawing", tone: "amber" as const },
  { key: "Finishing", desc: "Session ended, cable still locked", tone: "amber" as const },
  { key: "Reserved", desc: "Connector reserved via ReserveNow", tone: "blue" as const },
  { key: "Unavailable", desc: "Operator marked Inoperative", tone: "grey" as const },
  { key: "Faulted", desc: "Fault reported via errorCode", tone: "red" as const },
] as const;

const TONE_TEXT = {
  green: "text-sv-green",
  blue: "text-sv-sky",
  amber: "text-yellow-300",
  red: "text-red-300",
  grey: "text-ink-400",
};

export function OcppConnectorStatusCard({
  state,
}: {
  state: StateObservation[];
}) {
  const sm = new Map(state.map((s) => [s.StateId, s]));
  const v = (id: number) => sm.get(id)?.ValueAsString;

  const opMode = v(StateId.ChargerOperationMode);
  const isOcppConnected = v(StateId.IsOcppConnected) === "1";
  const isEnabled = v(StateId.IsEnabled) === "1";
  const warnings = decodeWarnings(v(StateId.Warnings));
  const notifications = decodeWarnings(v(StateId.Notifications));
  const faulted = warnings.length + notifications.length > 0;

  const current = deriveConnectorStatus(opMode, isEnabled, faulted);

  // Derive a likely OCPP errorCode from the active warning bits
  const errorCode = (() => {
    if (warnings.length === 0 && notifications.length === 0) return "NoError";
    const all = [...warnings, ...notifications];
    if (all.some((w) => w.code.includes("RCD"))) return "GroundFailure";
    if (all.some((w) => w.code.includes("RELAY_WELDED"))) return "PowerSwitchFailure";
    if (all.some((w) => w.code.includes("EMETER"))) return "PowerMeterFailure";
    if (all.some((w) => w.code.includes("TEMPERATURE"))) return "HighTemperature";
    if (all.some((w) => w.code.includes("OVERCURRENT"))) return "OverCurrentFailure";
    if (all.some((w) => w.code.includes("PILOT"))) return "EVCommunicationError";
    return "OtherError";
  })();

  return (
    <TechSection
      title="OCPP connector status"
      source="ocpp"
      state={
        isOcppConnected
          ? { kind: "connected" }
          : { kind: "disconnected", reason: "IsOcppConnected = 0" }
      }
      hint="Derived from ChargerOperationMode + warnings"
    >
      <p className="mb-3 text-[11px] text-ink-400">
        OCPP 1.6J § 4.9 — connector reports its state as one of nine values
        plus an errorCode. Zaptec doesn&apos;t expose StatusNotification messages
        directly through the REST API, so we derive the status from{" "}
        <span className="font-mono text-ink-300">ChargerOperationMode</span>{" "}
        (StateId 710), <span className="font-mono text-ink-300">IsEnabled</span>{" "}
        (711), and active warning bits (803/804). Mapping is approximate.
      </p>

      {/* Live status banner */}
      <div
        className={cn(
          "mb-3 rounded-md p-3 ring-1 ring-inset",
          current.tone === "green"
            ? "bg-sv-green/5 ring-sv-green/30"
            : current.tone === "blue"
              ? "bg-brand-500/5 ring-brand-500/30"
              : current.tone === "amber"
                ? "bg-yellow-500/5 ring-yellow-500/30"
                : current.tone === "red"
                  ? "bg-red-500/5 ring-red-500/30"
                  : "bg-bg-inset/50 ring-bg-border",
        )}
      >
        <div className="flex items-baseline justify-between gap-3">
          <div>
            <p className="text-[10px] uppercase tracking-brand text-ink-500">
              Connector 1
            </p>
            <p className={cn("font-mono text-base font-semibold", TONE_TEXT[current.tone])}>
              {current.status}
            </p>
            <p className="mt-0.5 text-[11px] text-ink-300">{current.desc}</p>
          </div>
          <div className="text-right">
            <p className="text-[10px] uppercase tracking-brand text-ink-500">
              errorCode
            </p>
            <p className={cn("font-mono text-sm", faulted ? "text-red-300" : "text-sv-green")}>
              {errorCode}
            </p>
          </div>
        </div>
      </div>

      {/* Reference table — full enum */}
      <div className="overflow-hidden rounded-md border border-bg-border/70">
        <table className="w-full text-xs">
          <thead className="bg-bg-inset/40 text-left text-[10px] uppercase tracking-brand text-ink-500">
            <tr>
              <th className="px-3 py-1.5 font-medium w-[120px]">Status</th>
              <th className="px-3 py-1.5 font-medium">Meaning</th>
              <th className="px-3 py-1.5 font-medium w-[80px] text-center">Active</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-bg-border/60">
            {ALL_STATUSES.map((s) => {
              const active = s.key === current.status;
              return (
                <tr
                  key={s.key}
                  className={active ? "bg-sv-green/5" : ""}
                >
                  <td
                    className={cn(
                      "px-3 py-1.5 font-mono",
                      TONE_TEXT[s.tone],
                      active && "font-semibold",
                    )}
                  >
                    {s.key}
                  </td>
                  <td className="px-3 py-1.5 text-ink-300">{s.desc}</td>
                  <td className="px-3 py-1.5 text-center">
                    {active ? (
                      <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-sv-green/20 text-sv-green text-[10px] font-bold">
                        ●
                      </span>
                    ) : (
                      <span className="text-ink-600">·</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="mt-3 text-[11px] text-ink-500">
        Live <span className="font-mono text-ink-400">errorCode</span> derived
        from active warning bits (when present). For raw OCPP{" "}
        <span className="font-mono text-ink-300">StatusNotification</span>{" "}
        messages, the CSMS worker would need to expose its own log endpoint.
      </p>
    </TechSection>
  );
}
