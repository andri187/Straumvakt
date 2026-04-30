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

  // Compact 4-column grid: Start / Stop / Get / Set fit in one row on
  // wide screens, stack on narrow. Each column has a tiny header,
  // inline inputs, and a single action button.
  const inputCls =
    "w-full min-w-0 rounded border border-bg-border bg-bg-inset px-2 py-1 font-mono text-[11px] text-ink-50 disabled:opacity-50";
  const labelCls = "block text-[9px] uppercase tracking-brand text-ink-500";

  return (
    <section className="rounded-lg border border-bg-border bg-bg-base/30 p-3">
      <header className="mb-2 flex items-baseline justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-brand text-ink-300">
          Charger commands
        </h2>
        <span className="text-[10px] text-ink-500">enqueued → outbox → gateway</span>
      </header>

      <div className="grid gap-2 lg:grid-cols-4">
        {/* Remote Start */}
        <div className="rounded border border-bg-border/40 bg-bg-base/40 p-2">
          <div className="mb-1 flex items-baseline justify-between">
            <span className="text-[10px] font-semibold uppercase tracking-brand text-sv-green">Start</span>
            <span className="text-[9px] text-ink-500">RemoteStart</span>
          </div>
          <div className="space-y-1">
            <label>
              <span className={labelCls}>Connector</span>
              <select
                value={startConnectorId}
                onChange={(e) => setStartConnectorId(e.target.value)}
                disabled={connectors.length === 0}
                className={inputCls}
              >
                {connectors.length === 0 && <option>—</option>}
                {connectors.map((c) => (
                  <option key={c.id} value={c.id}>
                    #{c.connectorIndex} ({c.type})
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span className={labelCls}>idTag (optional)</span>
              <input
                type="text"
                value={idTag}
                onChange={(e) => setIdTag(e.target.value)}
                placeholder="ABC123"
                maxLength={20}
                className={inputCls}
              />
            </label>
            <button
              type="button"
              onClick={() => fire("remote-start", { connectorId: startConnectorId, idTag: idTag || undefined })}
              disabled={!startConnectorId || busy !== null}
              className="w-full rounded-md bg-sv-green/20 px-2 py-1 text-[11px] font-medium text-sv-green ring-1 ring-sv-green/30 hover:bg-sv-green/30 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {busy === "remote-start" ? "…" : "Start"}
            </button>
          </div>
        </div>

        {/* Remote Stop */}
        <div className="rounded border border-bg-border/40 bg-bg-base/40 p-2">
          <div className="mb-1 flex items-baseline justify-between">
            <span className="text-[10px] font-semibold uppercase tracking-brand text-rose-300">Stop</span>
            <span className="text-[9px] text-ink-500">RemoteStop</span>
          </div>
          <div className="space-y-1">
            <label>
              <span className={labelCls}>Transaction ID</span>
              <input
                type="number"
                value={transactionId}
                onChange={(e) => setTransactionId(e.target.value)}
                placeholder="active txId"
                className={inputCls}
              />
            </label>
            <button
              type="button"
              onClick={() => fire("remote-stop", { transactionId: Number(transactionId) })}
              disabled={!transactionId || busy !== null}
              className="w-full rounded-md bg-rose-500/10 px-2 py-1 text-[11px] font-medium text-rose-300 ring-1 ring-rose-500/30 hover:bg-rose-500/20 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {busy === "remote-stop" ? "…" : "Stop"}
            </button>
          </div>
        </div>

        {/* Get Configuration */}
        <div className="rounded border border-bg-border/40 bg-bg-base/40 p-2">
          <div className="mb-1 flex items-baseline justify-between">
            <span className="text-[10px] font-semibold uppercase tracking-brand text-sv-sky">Read cfg</span>
            <span className="text-[9px] text-ink-500">GetConfig</span>
          </div>
          <div className="space-y-1">
            <label>
              <span className={labelCls}>Key (blank = all)</span>
              <input
                type="text"
                value={getConfigKey}
                onChange={(e) => setGetConfigKey(e.target.value)}
                placeholder="HeartbeatInterval"
                maxLength={50}
                className={inputCls}
              />
            </label>
            <button
              type="button"
              onClick={() => fire("get-configuration", getConfigKey ? { key: [getConfigKey] } : {})}
              disabled={busy !== null}
              className="w-full rounded-md bg-sv-sky/20 px-2 py-1 text-[11px] font-medium text-sv-sky ring-1 ring-sv-sky/30 hover:bg-sv-sky/30 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {busy === "get-configuration" ? "…" : "Read"}
            </button>
          </div>
        </div>

        {/* Change Configuration */}
        <div className="rounded border border-bg-border/40 bg-bg-base/40 p-2">
          <div className="mb-1 flex items-baseline justify-between">
            <span className="text-[10px] font-semibold uppercase tracking-brand text-sv-sky">Write cfg</span>
            <span className="text-[9px] text-ink-500">ChangeConfig</span>
          </div>
          <div className="space-y-1">
            <label>
              <span className={labelCls}>Key</span>
              <input
                type="text"
                value={changeConfigKey}
                onChange={(e) => setChangeConfigKey(e.target.value)}
                placeholder="HeartbeatInterval"
                maxLength={50}
                className={inputCls}
              />
            </label>
            <label>
              <span className={labelCls}>Value</span>
              <input
                type="text"
                value={changeConfigValue}
                onChange={(e) => setChangeConfigValue(e.target.value)}
                placeholder="60"
                maxLength={500}
                className={inputCls}
              />
            </label>
            <button
              type="button"
              onClick={() =>
                fire("change-configuration", { key: changeConfigKey, value: changeConfigValue })
              }
              disabled={!changeConfigKey || busy !== null}
              className="w-full rounded-md bg-sv-sky/20 px-2 py-1 text-[11px] font-medium text-sv-sky ring-1 ring-sv-sky/30 hover:bg-sv-sky/30 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {busy === "change-configuration" ? "…" : "Write"}
            </button>
          </div>
        </div>
      </div>

      {error && (
        <p className="mt-2 rounded border border-rose-700/40 bg-rose-950/30 px-2 py-1 text-[11px] text-rose-200">
          {error}
        </p>
      )}

      {log.length > 0 && (
        <ul className="mt-2 space-y-0.5 text-[10px] font-mono">
          {log.slice(0, 5).map((e, i) => (
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
