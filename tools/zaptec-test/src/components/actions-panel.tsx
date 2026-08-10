"use client";

import { useState } from "react";
import {
  Power,
  PauseCircle,
  PlayCircle,
  ShieldOff,
  RotateCcw,
  Download,
  Activity,
  Zap,
  Lock,
  Settings,
  AlertTriangle,
  Loader2,
  CheckCircle2,
  XCircle,
} from "lucide-react";
import { buildActionCatalog, type CommandAction, type Transport } from "@/lib/ocpp";
import { cn } from "@/lib/cn";

type SendState =
  | { kind: "idle" }
  | { kind: "sending"; key: string }
  | { kind: "ok"; key: string; transport: Transport }
  | { kind: "error"; key: string; transport: Transport; body: string };

const ICONS: Record<string, typeof Power> = {
  "start-session": PlayCircle,
  "stop-session": PauseCircle,
  "resume-session": PlayCircle,
  deauthorize: ShieldOff,
  reboot: RotateCcw,
  "soft-reset": RotateCcw,
  "take-offline": Power,
  "bring-online": Activity,
  "unlock-connector": Lock,
  "trigger-status": Zap,
  "trigger-meter": Zap,
  "get-config": Settings,
  "clear-cache": Settings,
  "firmware-upgrade": Download,
  "set-charging-profile": Activity,
};

const CATEGORY_ORDER: Array<CommandAction["category"]> = [
  "Session",
  "Power",
  "Diagnostics",
  "Configuration",
];

export function ActionsPanel({
  chargerId,
  isCharging,
  isPaused,
  ocppConnected,
}: {
  chargerId: string;
  isCharging: boolean;
  isPaused: boolean;
  ocppConnected: boolean;
}) {
  const actions = buildActionCatalog({ isCharging, isPaused, ocppConnected });
  const [confirming, setConfirming] = useState<{
    action: CommandAction;
    transport: Transport;
  } | null>(null);
  const [send, setSend] = useState<SendState>({ kind: "idle" });

  const grouped = new Map<CommandAction["category"], CommandAction[]>();
  for (const a of actions) {
    const list = grouped.get(a.category) ?? [];
    list.push(a);
    grouped.set(a.category, list);
  }

  async function fire(action: CommandAction, transport: Transport) {
    setConfirming(null);
    setSend({ kind: "sending", key: action.key });
    if (transport === "ocpp") {
      // Stub: no real OCPP gateway. Demonstrate what would fire.
      setTimeout(() => {
        setSend({
          kind: "error",
          key: action.key,
          transport: "ocpp",
          body: `Would send via OCPP: ${
            action.transports.find((t) => t.kind === "ocpp")?.wire ?? action.label
          }`,
        });
      }, 400);
      return;
    }
    // API path — only wired for actions whose Zaptec command IDs are mapped
    const wire = action.transports.find((t) => t.kind === "api")?.wire ?? "";
    const m = wire.match(/sendCommand\/(\d+)/);
    if (!m) {
      setSend({
        kind: "error",
        key: action.key,
        transport: "api",
        body: "No Zaptec API command mapped for this action",
      });
      return;
    }
    const commandId = Number(m[1]);
    try {
      const res = await fetch(`/api/zaptec/chargers/${chargerId}/command`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ commandId }),
      });
      const data = (await res.json()) as { ok: boolean; body?: string };
      setSend(
        data.ok
          ? { kind: "ok", key: action.key, transport: "api" }
          : {
              kind: "error",
              key: action.key,
              transport: "api",
              body: data.body ?? "request failed",
            },
      );
    } catch (e) {
      setSend({
        kind: "error",
        key: action.key,
        transport: "api",
        body: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return (
    <section className="rounded-lg border border-bg-border bg-bg-surface/70 p-5 shadow-card backdrop-blur">
      <header className="mb-4 flex items-center gap-2">
        <Power className="h-4 w-4 text-sv-sky" />
        <h3 className="text-sm font-semibold text-ink-50">Actions</h3>
        <span className="ml-auto text-[10px] uppercase tracking-brand text-ink-500">
          grouped by outcome · transport tagged
        </span>
      </header>

      <p className="mb-4 text-[11px] text-ink-400">
        Each action lists every transport that can perform it. OCPP is the
        real-time path (preferred when connected) and the Zaptec REST API is
        the cloud fallback. Transports are listed in preference order; pick
        whichever your situation needs.
      </p>

      <div className="space-y-5">
        {CATEGORY_ORDER.map((category) => {
          const list = grouped.get(category);
          if (!list?.length) return null;
          return (
            <div key={category}>
              <h4 className="mb-2 text-[10px] font-semibold uppercase tracking-brand text-sv-sky">
                {category}
              </h4>
              <ul className="space-y-2">
                {list.map((a) => {
                  const anyAvailable = a.transports.some((t) => t.available);
                  const Icon = ICONS[a.key] ?? Power;
                  const isPending = confirming?.action.key === a.key;
                  const sendForThis = send.kind !== "idle" && send.key === a.key;

                  return (
                    <li
                      key={a.key}
                      className={cn(
                        "rounded-md border bg-bg-inset/40 p-3",
                        a.destructive
                          ? "border-yellow-500/20"
                          : "border-bg-border",
                      )}
                    >
                      <div className="flex items-start gap-3">
                        <span
                          className={cn(
                            "flex h-9 w-9 shrink-0 items-center justify-center rounded-md ring-1 ring-inset",
                            !anyAvailable
                              ? "bg-ink-600/20 text-ink-500 ring-ink-500/30"
                              : a.destructive
                                ? "bg-yellow-500/10 text-yellow-300 ring-yellow-500/30"
                                : "bg-brand-500/10 text-sv-sky ring-brand-500/30",
                          )}
                        >
                          <Icon className="h-4 w-4" />
                        </span>
                        <div className="min-w-0 flex-1">
                          <h5 className="text-sm font-semibold text-ink-50">
                            {a.label}
                            {a.destructive ? (
                              <span className="ml-2 inline-flex items-center gap-1 align-middle text-[10px] uppercase tracking-brand text-yellow-300">
                                <AlertTriangle className="h-3 w-3" />
                                destructive
                              </span>
                            ) : null}
                          </h5>
                          <p className="mt-0.5 text-xs text-ink-400">{a.helper}</p>
                        </div>
                      </div>

                      {/* Per-transport buttons */}
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        {a.transports.map((t) => (
                          <TransportButton
                            key={`${a.key}-${t.kind}`}
                            kind={t.kind}
                            wire={t.wire}
                            available={t.available}
                            unavailableReason={t.unavailableReason}
                            destructive={a.destructive}
                            onClick={() =>
                              setConfirming({ action: a, transport: t.kind })
                            }
                          />
                        ))}
                      </div>

                      {/* Confirm dialog inline */}
                      {isPending ? (
                        <div className="mt-3 rounded-md bg-bg-raised/70 p-3">
                          <p className="text-xs text-ink-100">
                            Send <strong>{a.label.toLowerCase()}</strong> via{" "}
                            <strong className="font-mono uppercase">
                              {confirming?.transport}
                            </strong>{" "}
                            to the live charger?
                          </p>
                          <p className="mt-1 font-mono text-[10px] text-ink-400 break-all">
                            {a.transports.find((t) => t.kind === confirming?.transport)?.wire}
                          </p>
                          <div className="mt-2 flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => setConfirming(null)}
                              className="rounded-md border border-bg-border px-3 py-1 text-xs text-ink-300 hover:bg-bg-inset"
                            >
                              Cancel
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                confirming &&
                                fire(confirming.action, confirming.transport)
                              }
                              className={cn(
                                "rounded-md px-3 py-1 text-xs font-semibold ring-1 ring-inset",
                                a.destructive
                                  ? "bg-yellow-500/20 text-yellow-100 ring-yellow-500/40 hover:bg-yellow-500/30"
                                  : "bg-brand-500/20 text-sv-sky ring-brand-500/40 hover:bg-brand-500/30",
                              )}
                            >
                              Confirm send
                            </button>
                          </div>
                        </div>
                      ) : null}

                      {/* Per-action send result */}
                      {sendForThis ? <SendStatus state={send} /> : null}
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function TransportButton({
  kind,
  wire,
  available,
  unavailableReason,
  destructive,
  onClick,
}: {
  kind: Transport;
  wire: string;
  available: boolean;
  unavailableReason?: string;
  destructive?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!available}
      className={cn(
        "inline-flex items-center gap-2 rounded-md px-2.5 py-1 text-xs font-semibold ring-1 ring-inset transition-colors",
        !available
          ? "bg-bg-inset/40 text-ink-500 ring-bg-border cursor-not-allowed"
          : kind === "ocpp"
            ? "bg-brand-500/10 text-sv-sky ring-brand-500/30 hover:bg-brand-500/20"
            : destructive
              ? "bg-yellow-500/10 text-yellow-200 ring-yellow-500/30 hover:bg-yellow-500/20"
              : "bg-sv-green/10 text-sv-green ring-sv-green/30 hover:bg-sv-green/20",
      )}
      title={available ? wire : unavailableReason}
    >
      <span className="font-mono text-[10px] uppercase tracking-brand">
        {kind}
      </span>
      <span className="opacity-90">Send</span>
    </button>
  );
}

function SendStatus({ state }: { state: SendState }) {
  if (state.kind === "idle") return null;
  return (
    <div
      className={cn(
        "mt-3 flex items-start gap-2 rounded-md p-2 text-xs ring-1 ring-inset",
        state.kind === "ok"
          ? "bg-sv-green/5 text-sv-green ring-sv-green/30"
          : state.kind === "error"
            ? "bg-yellow-500/5 text-yellow-200 ring-yellow-500/30"
            : "bg-bg-raised text-ink-300 ring-bg-border",
      )}
    >
      {state.kind === "sending" ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : state.kind === "ok" ? (
        <CheckCircle2 className="h-4 w-4" />
      ) : (
        <XCircle className="h-4 w-4" />
      )}
      <div>
        {state.kind === "sending" ? (
          <span>Sending…</span>
        ) : state.kind === "ok" ? (
          <span>Accepted via {state.transport.toUpperCase()}</span>
        ) : (
          <>
            <span>Failed via {state.transport.toUpperCase()}</span>
            {state.body ? (
              <p className="mt-1 font-mono text-[10px] text-ink-400 break-all">
                {state.body.slice(0, 200)}
              </p>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
