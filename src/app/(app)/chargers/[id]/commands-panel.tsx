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
 * Each successful enqueue returns { commandId, status: "pending" }.
 * The UI logs that into the local "Recent commands" list so the
 * operator can correlate with the outbox / event_log when debugging.
 */

interface ConnectorOption {
  id: string;
  connectorIndex: number;
  type: string;
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

  // Remote Start state.
  const [startConnectorId, setStartConnectorId] = useState(connectors[0]?.id ?? "");
  const [idTag, setIdTag] = useState("");

  // Remote Stop state.
  const [transactionId, setTransactionId] = useState("");

  // Configuration state.
  const [getConfigKey, setGetConfigKey] = useState("");
  const [changeConfigKey, setChangeConfigKey] = useState("");
  const [changeConfigValue, setChangeConfigValue] = useState("");

  async function fire(action: string, body: Record<string, unknown>): Promise<void> {
    setError(null);
    setBusy(action);
    try {
      const res = await apiFetch(
        `/api/admin/chargers/${ocppIdentityId}/${action}`,
        {
          method: "POST",
          body: JSON.stringify(body),
        },
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
          ].slice(0, 10),
        );
      }
    } catch (err) {
      setError(`${action}: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="rounded-lg border border-bg-border bg-bg-base/30 p-4">
      <header className="mb-3">
        <h2 className="text-sm font-semibold text-ink-50">Charger commands</h2>
        <p className="mt-0.5 text-[10px] text-ink-500">
          Each command is enqueued to{" "}
          <code className="font-mono">ocpp.outbound_commands</code> and dispatched
          via the gateway. Status moves to <code className="font-mono">acked</code> /{" "}
          <code className="font-mono">failed</code> when the charger responds.
        </p>
      </header>

      <div className="space-y-3">
        {/* Remote Start */}
        <div className="rounded border border-bg-border/60 bg-bg-base/40 p-3">
          <div className="mb-2 flex items-baseline justify-between">
            <h3 className="text-xs font-semibold text-sv-green">Remote Start</h3>
            <span className="text-[10px] text-ink-500">RemoteStartTransaction</span>
          </div>
          <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
            <label className="block">
              <span className="block text-[10px] uppercase tracking-brand text-ink-400">Connector</span>
              <select
                value={startConnectorId}
                onChange={(e) => setStartConnectorId(e.target.value)}
                disabled={connectors.length === 0}
                className="mt-1 w-full rounded border border-bg-border bg-bg-inset px-2 py-1.5 text-xs text-ink-50 disabled:opacity-50"
              >
                {connectors.length === 0 && <option>No connectors</option>}
                {connectors.map((c) => (
                  <option key={c.id} value={c.id}>
                    #{c.connectorIndex} ({c.type})
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="block text-[10px] uppercase tracking-brand text-ink-400">idTag (RFID, optional)</span>
              <input
                type="text"
                value={idTag}
                onChange={(e) => setIdTag(e.target.value)}
                placeholder="e.g. ABC123 (charger may auto-authorize)"
                maxLength={20}
                className="mt-1 w-full rounded border border-bg-border bg-bg-inset px-2 py-1.5 font-mono text-xs text-ink-50"
              />
            </label>
            <button
              type="button"
              onClick={() =>
                fire("remote-start", {
                  connectorId: startConnectorId,
                  idTag: idTag || undefined,
                })
              }
              disabled={!startConnectorId || busy !== null}
              className="self-end rounded-md bg-sv-green/20 px-3 py-1.5 text-xs font-medium text-sv-green ring-1 ring-sv-green/30 hover:bg-sv-green/30 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {busy === "remote-start" ? "Sending…" : "Start"}
            </button>
          </div>
        </div>

        {/* Remote Stop */}
        <div className="rounded border border-bg-border/60 bg-bg-base/40 p-3">
          <div className="mb-2 flex items-baseline justify-between">
            <h3 className="text-xs font-semibold text-rose-300">Remote Stop</h3>
            <span className="text-[10px] text-ink-500">RemoteStopTransaction</span>
          </div>
          <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
            <label className="block">
              <span className="block text-[10px] uppercase tracking-brand text-ink-400">Transaction ID</span>
              <input
                type="number"
                value={transactionId}
                onChange={(e) => setTransactionId(e.target.value)}
                placeholder="from the active ChargeSession"
                className="mt-1 w-full rounded border border-bg-border bg-bg-inset px-2 py-1.5 font-mono text-xs text-ink-50"
              />
            </label>
            <button
              type="button"
              onClick={() => fire("remote-stop", { transactionId: Number(transactionId) })}
              disabled={!transactionId || busy !== null}
              className="self-end rounded-md bg-rose-500/10 px-3 py-1.5 text-xs font-medium text-rose-300 ring-1 ring-rose-500/30 hover:bg-rose-500/20 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {busy === "remote-stop" ? "Sending…" : "Stop"}
            </button>
          </div>
        </div>

        {/* Get / Change configuration */}
        <div className="grid gap-2 sm:grid-cols-2">
          <div className="rounded border border-bg-border/60 bg-bg-base/40 p-3">
            <div className="mb-2 flex items-baseline justify-between">
              <h3 className="text-xs font-semibold text-sv-sky">Get Configuration</h3>
              <span className="text-[10px] text-ink-500">GetConfiguration</span>
            </div>
            <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
              <input
                type="text"
                value={getConfigKey}
                onChange={(e) => setGetConfigKey(e.target.value)}
                placeholder="key (blank → all keys)"
                maxLength={50}
                className="rounded border border-bg-border bg-bg-inset px-2 py-1.5 font-mono text-xs text-ink-50"
              />
              <button
                type="button"
                onClick={() =>
                  fire(
                    "get-configuration",
                    getConfigKey ? { key: [getConfigKey] } : {},
                  )
                }
                disabled={busy !== null}
                className="rounded-md bg-sv-sky/20 px-3 py-1.5 text-xs font-medium text-sv-sky ring-1 ring-sv-sky/30 hover:bg-sv-sky/30 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {busy === "get-configuration" ? "…" : "Read"}
              </button>
            </div>
          </div>

          <div className="rounded border border-bg-border/60 bg-bg-base/40 p-3">
            <div className="mb-2 flex items-baseline justify-between">
              <h3 className="text-xs font-semibold text-sv-sky">Change Configuration</h3>
              <span className="text-[10px] text-ink-500">ChangeConfiguration</span>
            </div>
            <div className="grid gap-2">
              <div className="grid gap-2 sm:grid-cols-2">
                <input
                  type="text"
                  value={changeConfigKey}
                  onChange={(e) => setChangeConfigKey(e.target.value)}
                  placeholder="key"
                  maxLength={50}
                  className="rounded border border-bg-border bg-bg-inset px-2 py-1.5 font-mono text-xs text-ink-50"
                />
                <input
                  type="text"
                  value={changeConfigValue}
                  onChange={(e) => setChangeConfigValue(e.target.value)}
                  placeholder="value"
                  maxLength={500}
                  className="rounded border border-bg-border bg-bg-inset px-2 py-1.5 font-mono text-xs text-ink-50"
                />
              </div>
              <button
                type="button"
                onClick={() =>
                  fire("change-configuration", {
                    key: changeConfigKey,
                    value: changeConfigValue,
                  })
                }
                disabled={!changeConfigKey || busy !== null}
                className="rounded-md bg-sv-sky/20 px-3 py-1.5 text-xs font-medium text-sv-sky ring-1 ring-sv-sky/30 hover:bg-sv-sky/30 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {busy === "change-configuration" ? "Sending…" : "Write"}
              </button>
            </div>
          </div>
        </div>
      </div>

      {error && (
        <p className="mt-3 rounded border border-rose-700/40 bg-rose-950/30 px-2 py-1.5 text-xs text-rose-200">
          {error}
        </p>
      )}

      {log.length > 0 && (
        <div className="mt-3 rounded border border-bg-border/40 bg-bg-base/40 p-2">
          <p className="mb-1 text-[10px] uppercase tracking-brand text-ink-400">Recent</p>
          <ul className="space-y-0.5 text-[11px]">
            {log.map((e, i) => (
              <li key={i} className="flex items-baseline gap-2 font-mono text-ink-300">
                <span className="text-ink-500">{e.at}</span>
                <span className="text-sv-green">{e.action}</span>
                <span className="text-ink-400">→ {e.status}</span>
                <span className="text-ink-500">{e.commandId.slice(0, 8)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
