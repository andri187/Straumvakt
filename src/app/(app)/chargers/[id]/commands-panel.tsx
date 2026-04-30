"use client";

import { useState } from "react";
import { apiFetch } from "@/lib/api-client";

/**
 * Operator command surface for an active charger. Each button POSTs to
 * the API Worker's outbound-command enqueue route which writes to the
 * outbox + publishes to the queue. The queue handler dispatches via
 * the OCPP_GATEWAY service binding; the gateway DO sends the OCPP
 * CALL on the open WebSocket and the projection in events.ts updates
 * the outbox row when the charger replies (see commit fb0c1c5).
 *
 * Layout: per-connector row at the top with live status pill +
 * inline Start/Stop. Configuration get/set sits in a collapsed
 * <details> since it's rare and noisy.
 */

interface ConnectorOption {
  id: string;
  connectorIndex: number;
  type: string;
  status: string;
  errorCode: string | null;
  vendorErrorCode: string | null;
  statusUpdatedAt: string | null;
}

interface CommandLogEntry {
  at: string;
  action: string;
  commandId: string;
  status: string;
}

export function ChargerCommandsPanel({
  ocppIdentityId,
  connectors,
}: {
  ocppIdentityId: string;
  connectors: ConnectorOption[];
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [log, setLog] = useState<CommandLogEntry[]>([]);

  // Per-connector idTag override + transactionId for Stop.
  const [idTagByConnector, setIdTagByConnector] = useState<Record<string, string>>({});
  const [stopTxIdByConnector, setStopTxIdByConnector] = useState<Record<string, string>>({});

  // Config state.
  const [getConfigKey, setGetConfigKey] = useState("");
  const [changeConfigKey, setChangeConfigKey] = useState("");
  const [changeConfigValue, setChangeConfigValue] = useState("");

  async function fire(action: string, body: Record<string, unknown>, busyKey: string): Promise<void> {
    setError(null);
    setBusy(busyKey);
    try {
      const res = await apiFetch(
        `/api/admin/chargers/${ocppIdentityId}/${action}`,
        { method: "POST", body: JSON.stringify(body) },
      );
      const json = (await res.json().catch(() => null)) as
        | { commandId?: string; status?: string; error?: string; issues?: { path: (string | number)[]; message: string }[] }
        | null;
      if (!res.ok) {
        const msg =
          json?.issues?.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") ||
          json?.error ||
          `HTTP ${res.status}`;
        setError(`${action}: ${msg}`);
        return;
      }
      if (json?.commandId && json.status) {
        setLog((prev) =>
          [
            { at: new Date().toLocaleTimeString(), action, commandId: json.commandId!, status: json.status! },
            ...prev,
          ].slice(0, 5),
        );
      }
    } catch (err) {
      setError(`${action}: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="rounded-lg border border-bg-border bg-bg-base/30 p-3">
      <header className="mb-2 flex items-baseline justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-brand text-ink-300">
          Connectors &amp; commands
        </h2>
        <span className="text-[10px] text-ink-500">
          live status · per-connector actions
        </span>
      </header>

      {connectors.length === 0 ? (
        <p className="rounded border border-dashed border-bg-border/40 bg-bg-base/20 px-3 py-2 text-[11px] italic text-ink-500">
          No connectors on this charger.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {connectors.map((c) => {
            const startKey = `start:${c.id}`;
            const stopKey = `stop:${c.id}`;
            const isCharging = /charg/i.test(c.status);
            const idTag = idTagByConnector[c.id] ?? "";
            const stopTxId = stopTxIdByConnector[c.id] ?? "";
            return (
              <li
                key={c.id}
                className="rounded border border-bg-border/40 bg-bg-base/40 p-2"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-[10px] text-ink-400">
                    #{c.connectorIndex}
                  </span>
                  <span className="text-[11px] text-ink-300">{c.type}</span>
                  <ConnectorStatusPill status={c.status} />
                  {c.errorCode && (
                    <span className="rounded border border-rose-700/40 bg-rose-950/30 px-1 py-0 text-[10px] font-medium text-rose-200">
                      {c.errorCode}
                      {c.vendorErrorCode && (
                        <span className="ml-1 text-rose-300/70">[{c.vendorErrorCode}]</span>
                      )}
                    </span>
                  )}
                  {c.statusUpdatedAt && (
                    <span className="ml-auto text-[10px] text-ink-500">
                      updated {new Date(c.statusUpdatedAt).toLocaleTimeString()}
                    </span>
                  )}
                </div>
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                  <input
                    type="text"
                    value={idTag}
                    onChange={(e) => setIdTagByConnector((p) => ({ ...p, [c.id]: e.target.value }))}
                    placeholder="idTag (optional)"
                    maxLength={20}
                    className="min-w-0 flex-1 rounded border border-bg-border bg-bg-inset px-2 py-1 font-mono text-[11px] text-ink-50"
                  />
                  <button
                    type="button"
                    onClick={() =>
                      fire("remote-start", { connectorId: c.id, idTag: idTag || undefined }, startKey)
                    }
                    disabled={busy !== null}
                    className="rounded-md bg-sv-green/20 px-2 py-1 text-[11px] font-medium text-sv-green ring-1 ring-sv-green/30 hover:bg-sv-green/30 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {busy === startKey ? "…" : "Start"}
                  </button>
                  <input
                    type="number"
                    value={stopTxId}
                    onChange={(e) =>
                      setStopTxIdByConnector((p) => ({ ...p, [c.id]: e.target.value }))
                    }
                    placeholder="txId"
                    className="w-20 rounded border border-bg-border bg-bg-inset px-2 py-1 font-mono text-[11px] text-ink-50"
                  />
                  <button
                    type="button"
                    onClick={() => fire("remote-stop", { transactionId: Number(stopTxId) }, stopKey)}
                    disabled={!stopTxId || busy !== null}
                    className={
                      "rounded-md px-2 py-1 text-[11px] font-medium ring-1 disabled:cursor-not-allowed disabled:opacity-40 " +
                      (isCharging
                        ? "bg-rose-500/20 text-rose-200 ring-rose-500/40 hover:bg-rose-500/30"
                        : "bg-rose-500/10 text-rose-300 ring-rose-500/30 hover:bg-rose-500/20")
                    }
                  >
                    {busy === stopKey ? "…" : "Stop"}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <details className="mt-3 rounded border border-bg-border/40 bg-bg-base/30">
        <summary className="cursor-pointer px-2 py-1 text-[10px] font-semibold uppercase tracking-brand text-ink-400 hover:text-ink-200">
          Configuration · GetConfiguration / ChangeConfiguration
        </summary>
        <div className="grid gap-2 border-t border-bg-border/40 p-2 sm:grid-cols-2">
          <div>
            <label className="block text-[9px] uppercase tracking-brand text-ink-500">
              Read key (blank = all)
            </label>
            <div className="mt-1 flex gap-1">
              <input
                type="text"
                value={getConfigKey}
                onChange={(e) => setGetConfigKey(e.target.value)}
                placeholder="HeartbeatInterval"
                maxLength={50}
                className="min-w-0 flex-1 rounded border border-bg-border bg-bg-inset px-2 py-1 font-mono text-[11px] text-ink-50"
              />
              <button
                type="button"
                onClick={() =>
                  fire("get-configuration", getConfigKey ? { key: [getConfigKey] } : {}, "get-configuration")
                }
                disabled={busy !== null}
                className="rounded-md bg-sv-sky/20 px-2 py-1 text-[11px] font-medium text-sv-sky ring-1 ring-sv-sky/30 hover:bg-sv-sky/30 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {busy === "get-configuration" ? "…" : "Read"}
              </button>
            </div>
          </div>
          <div>
            <label className="block text-[9px] uppercase tracking-brand text-ink-500">
              Write key + value
            </label>
            <div className="mt-1 grid grid-cols-[1fr_1fr_auto] gap-1">
              <input
                type="text"
                value={changeConfigKey}
                onChange={(e) => setChangeConfigKey(e.target.value)}
                placeholder="key"
                maxLength={50}
                className="min-w-0 rounded border border-bg-border bg-bg-inset px-2 py-1 font-mono text-[11px] text-ink-50"
              />
              <input
                type="text"
                value={changeConfigValue}
                onChange={(e) => setChangeConfigValue(e.target.value)}
                placeholder="value"
                maxLength={500}
                className="min-w-0 rounded border border-bg-border bg-bg-inset px-2 py-1 font-mono text-[11px] text-ink-50"
              />
              <button
                type="button"
                onClick={() =>
                  fire(
                    "change-configuration",
                    { key: changeConfigKey, value: changeConfigValue },
                    "change-configuration",
                  )
                }
                disabled={!changeConfigKey || busy !== null}
                className="rounded-md bg-sv-sky/20 px-2 py-1 text-[11px] font-medium text-sv-sky ring-1 ring-sv-sky/30 hover:bg-sv-sky/30 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {busy === "change-configuration" ? "…" : "Write"}
              </button>
            </div>
          </div>
        </div>
      </details>

      {error && (
        <p className="mt-2 rounded border border-rose-700/40 bg-rose-950/30 px-2 py-1 text-[11px] text-rose-200">
          {error}
        </p>
      )}

      {log.length > 0 && (
        <ul className="mt-2 space-y-0.5 text-[10px] font-mono">
          {log.map((e, i) => (
            <li key={i} className="flex items-baseline gap-2 text-ink-400">
              <span className="text-ink-500">{e.at}</span>
              <span className="text-sv-green">{e.action}</span>
              <span>→ {e.status}</span>
              <span className="text-ink-500">{e.commandId.slice(0, 8)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function ConnectorStatusPill({ status }: { status: string }) {
  const tone =
    status === "Available" || status === "available"
      ? "bg-emerald-950/40 text-emerald-300 border-emerald-700/40"
      : status === "Charging" || status === "charging"
        ? "bg-sv-sky/20 text-sv-sky border-sv-sky/40"
        : status === "Faulted" || status === "faulted"
          ? "bg-rose-950/40 text-rose-300 border-rose-700/40"
          : status === "Unavailable" || status === "unavailable"
            ? "bg-amber-950/40 text-amber-300 border-amber-700/40"
            : "bg-slate-800/60 text-slate-300 border-slate-700/40";
  return (
    <span
      className={
        "inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-medium uppercase " +
        tone
      }
    >
      {status || "—"}
    </span>
  );
}
