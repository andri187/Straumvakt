import { ArrowDownLeft, ArrowUpRight } from "lucide-react";
import { TechSection } from "@/components/tech-section";

// Three small OCPP-side cards that share a layout language.

const TYPICAL_MESSAGES: Array<{
  dir: "in" | "out";
  action: string;
  note: string;
}> = [
  { dir: "in", action: "BootNotification", note: "vendor/model/serial/firmware on boot or reconnect" },
  { dir: "in", action: "Heartbeat", note: "every HeartbeatInterval s when no other traffic" },
  { dir: "in", action: "StatusNotification", note: "on connector state change" },
  { dir: "in", action: "MeterValues", note: "every MeterValueSampleInterval s" },
  { dir: "in", action: "StartTransaction", note: "session begin" },
  { dir: "in", action: "StopTransaction", note: "session end + transactionData" },
  { dir: "in", action: "Authorize", note: "before starting offline / locally" },
  { dir: "in", action: "DiagnosticsStatusNotification", note: "log upload status" },
  { dir: "in", action: "FirmwareStatusNotification", note: "firmware download/install status" },
  { dir: "in", action: "DataTransfer", note: "vendor-specific" },
  { dir: "out", action: "RemoteStartTransaction", note: "from CSMS to start a session" },
  { dir: "out", action: "RemoteStopTransaction", note: "from CSMS to end a session" },
  { dir: "out", action: "ChangeAvailability", note: "operative / inoperative" },
  { dir: "out", action: "Reset", note: "Hard / Soft" },
  { dir: "out", action: "TriggerMessage", note: "ask CP to re-send a message" },
  { dir: "out", action: "GetConfiguration", note: "read config keys" },
  { dir: "out", action: "ChangeConfiguration", note: "write a config key" },
  { dir: "out", action: "ClearCache", note: "clear locally cached idTags" },
  { dir: "out", action: "ReserveNow", note: "reserve a connector for an idTag" },
  { dir: "out", action: "CancelReservation", note: "release a reservation" },
  { dir: "out", action: "UnlockConnector", note: "release the cable lock" },
  { dir: "out", action: "SetChargingProfile", note: "smart-charging schedule" },
  { dir: "out", action: "ClearChargingProfile", note: "drop a profile" },
  { dir: "out", action: "GetCompositeSchedule", note: "compute resulting schedule" },
  { dir: "out", action: "SendLocalList", note: "push idTag whitelist/blacklist" },
  { dir: "out", action: "GetLocalListVersion", note: "current LAL version" },
  { dir: "out", action: "UpdateFirmware", note: "schedule firmware download" },
  { dir: "out", action: "GetDiagnostics", note: "request log upload" },
];

export function OcppRecentMessagesCard({
  ocppConnected,
}: {
  ocppConnected: boolean;
}) {
  return (
    <TechSection
      title="OCPP recent messages"
      source="ocpp"
      state={ocppConnected ? { kind: "connected" } : { kind: "disconnected" }}
      hint="Last N CP↔CS messages"
    >
      <p className="mb-3 text-[11px] text-ink-400">
        OCPP 1.6J defines 28 message types over WebSocket. Each is a
        4-element JSON-RPC array: <span className="font-mono text-ink-300">[2, callId, action, payload]</span>{" "}
        for requests and <span className="font-mono text-ink-300">[3, callId, payload]</span> for responses.
        Live tail would render here when connected — example shape below.
      </p>
      <div className="overflow-hidden rounded-md border border-bg-border/70">
        <table className="w-full text-xs">
          <thead className="bg-bg-inset/40 text-left text-[10px] uppercase tracking-brand text-ink-500">
            <tr>
              <th className="px-3 py-1.5 font-medium w-12">Dir</th>
              <th className="px-3 py-1.5 font-medium">Action</th>
              <th className="px-3 py-1.5 font-medium">When it appears</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-bg-border/60">
            {TYPICAL_MESSAGES.map((m) => (
              <tr key={`${m.dir}-${m.action}`}>
                <td className="px-3 py-1.5">
                  {m.dir === "in" ? (
                    <span className="inline-flex items-center gap-1 text-sv-green">
                      <ArrowDownLeft className="h-3 w-3" />
                      <span className="text-[10px] uppercase tracking-brand">CP→CS</span>
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-sv-sky">
                      <ArrowUpRight className="h-3 w-3" />
                      <span className="text-[10px] uppercase tracking-brand">CS→CP</span>
                    </span>
                  )}
                </td>
                <td className="px-3 py-1.5 font-mono text-[11px] text-ink-200">{m.action}</td>
                <td className="px-3 py-1.5 text-[11px] text-ink-400">{m.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </TechSection>
  );
}

export function OcppAuthorizationLogCard({
  ocppConnected,
}: {
  ocppConnected: boolean;
}) {
  return (
    <TechSection
      title="OCPP authorization log"
      source="ocpp"
      state={ocppConnected ? { kind: "connected" } : { kind: "disconnected" }}
      hint="Authorize message · idTagInfo"
    >
      <p className="mb-3 text-[11px] text-ink-400">
        Every RFID/app authorization triggers an{" "}
        <span className="font-mono text-ink-300">Authorize</span> message; the CSMS
        replies with an <span className="font-mono text-ink-300">idTagInfo</span> object
        whose status is one of:
      </p>
      <ul className="mb-3 grid grid-cols-2 gap-1 sm:grid-cols-3">
        {(["Accepted", "Blocked", "Expired", "Invalid", "ConcurrentTx"] as const).map((s) => (
          <li
            key={s}
            className="rounded bg-bg-inset/50 px-2 py-1 font-mono text-[11px] text-ink-300"
          >
            {s}
          </li>
        ))}
      </ul>
      <div className="rounded-md border border-bg-border/70 bg-bg-inset/30 px-3 py-3">
        <p className="text-[11px] italic text-ink-500">
          Live authorization tail with idTag · status · timestamp · expiry would render here.
        </p>
      </div>
    </TechSection>
  );
}

export function OcppChargingProfileCard({
  ocppConnected,
}: {
  ocppConnected: boolean;
}) {
  return (
    <TechSection
      title="OCPP charging profiles"
      source="ocpp"
      state={ocppConnected ? { kind: "connected" } : { kind: "disconnected" }}
      hint="SetChargingProfile · GetCompositeSchedule"
    >
      <p className="mb-3 text-[11px] text-ink-400">
        Smart Charging stacks profiles at three purposes —{" "}
        <span className="font-mono text-ink-300">ChargePointMaxProfile</span> (operator),{" "}
        <span className="font-mono text-ink-300">TxDefaultProfile</span> (default
        per-tx), <span className="font-mono text-ink-300">TxProfile</span> (active tx
        only). Higher stackLevel wins; the CSMS computes the composite via{" "}
        <span className="font-mono text-ink-300">GetCompositeSchedule</span>.
      </p>
      <div className="grid gap-2 sm:grid-cols-3">
        {(["ChargePointMaxProfile", "TxDefaultProfile", "TxProfile"] as const).map((p) => (
          <div
            key={p}
            className="rounded-md border border-bg-border/70 bg-bg-inset/30 p-3"
          >
            <p className="font-mono text-[11px] font-semibold text-sv-sky">{p}</p>
            <p className="mt-1 text-[10px] italic text-ink-500">
              Active profile, periods, validFrom/validTo render here.
            </p>
          </div>
        ))}
      </div>
    </TechSection>
  );
}
