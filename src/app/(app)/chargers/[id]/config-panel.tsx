"use client";
// Sprint 9.4 — OCPP Configuration panel, extracted from
// commands-panel.tsx and placed below the LatestSessionChart so the
// operator command surface (per-connector actions) stays adjacent to
// the live-status pills above the chart and config-key admin lives
// in its own collapsed box below.
//
// Adds a "Get all" button (was previously only "Read <key>") that
// fires GetConfiguration with no key filter, polls
// /api/admin/chargers/commands/:commandId until the gateway projects
// the OCPP CALLRESULT, and renders the full key/value table.
//
// Native auth chargers won't return anything — the OCPP gateway
// never sees a session for them, so the command times out. The UI
// surfaces that as "no response from gateway" after the poll budget
// expires.

import { useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/api-client";

interface ConfigKey {
  key: string;
  value?: string | null;
  readonly?: boolean;
}

interface CommandResult {
  commandId: string;
  status: string;
  controlDomain: string;
  result: { configurationKey?: ConfigKey[]; unknownKey?: string[] } | null;
}

const POLL_INTERVAL_MS = 1500;
const POLL_BUDGET_MS = 30_000;

export function ChargerConfigPanel({
  ocppIdentityId,
}: {
  ocppIdentityId: string;
}) {
  const [getConfigKey, setGetConfigKey] = useState("");
  const [changeConfigKey, setChangeConfigKey] = useState("");
  const [changeConfigValue, setChangeConfigValue] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [keys, setKeys] = useState<ConfigKey[] | null>(null);
  const [unknownKeys, setUnknownKeys] = useState<string[]>([]);
  const [pollState, setPollState] = useState<"idle" | "polling" | "timeout" | "done">("idle");
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
    };
  }, []);

  async function fireConfigCommand(
    action: string,
    body: Record<string, unknown>,
    busyKey: string,
  ): Promise<string | null> {
    setError(null);
    setBusy(busyKey);
    try {
      const res = await apiFetch(
        `/api/admin/chargers/${ocppIdentityId}/${action}`,
        { method: "POST", body: JSON.stringify(body) },
      );
      const json = (await res.json().catch(() => null)) as
        | { commandId?: string; error?: string }
        | null;
      if (!res.ok) {
        setError(`${action}: ${json?.error ?? `HTTP ${res.status}`}`);
        return null;
      }
      return json?.commandId ?? null;
    } catch (err) {
      setError(`${action}: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    } finally {
      setBusy(null);
    }
  }

  function pollCommand(commandId: string, deadlineMs: number) {
    setPollState("polling");
    const tick = async () => {
      if (Date.now() > deadlineMs) {
        setPollState("timeout");
        return;
      }
      try {
        const res = await apiFetch(
          `/api/admin/chargers/commands/${commandId}`,
        );
        if (!res.ok) {
          pollTimerRef.current = setTimeout(tick, POLL_INTERVAL_MS);
          return;
        }
        const json = (await res.json()) as CommandResult;
        if (
          json.status === "completed" ||
          json.status === "succeeded" ||
          (json.result &&
            Array.isArray(json.result.configurationKey) &&
            json.result.configurationKey.length > 0)
        ) {
          setKeys(json.result?.configurationKey ?? []);
          setUnknownKeys(json.result?.unknownKey ?? []);
          setPollState("done");
          return;
        }
        if (
          json.status === "failed" ||
          json.status === "timed_out" ||
          json.status === "cancelled"
        ) {
          setError(`gateway returned status="${json.status}"`);
          setPollState("done");
          return;
        }
        pollTimerRef.current = setTimeout(tick, POLL_INTERVAL_MS);
      } catch (err) {
        setError(`poll: ${err instanceof Error ? err.message : String(err)}`);
        pollTimerRef.current = setTimeout(tick, POLL_INTERVAL_MS);
      }
    };
    tick();
  }

  async function handleGetAll() {
    setKeys(null);
    setUnknownKeys([]);
    const commandId = await fireConfigCommand(
      "get-configuration",
      {},
      "get-all",
    );
    if (commandId) pollCommand(commandId, Date.now() + POLL_BUDGET_MS);
  }

  async function handleReadOne() {
    setKeys(null);
    setUnknownKeys([]);
    const commandId = await fireConfigCommand(
      "get-configuration",
      getConfigKey ? { key: [getConfigKey] } : {},
      "get-one",
    );
    if (commandId) pollCommand(commandId, Date.now() + POLL_BUDGET_MS);
  }

  async function handleWrite() {
    await fireConfigCommand(
      "change-configuration",
      { key: changeConfigKey, value: changeConfigValue },
      "write",
    );
  }

  return (
    <section className="mb-6 rounded-lg border border-bg-border bg-bg-base/30 p-3">
      <details>
        <summary className="cursor-pointer list-none">
          <header className="flex items-baseline justify-between">
            <h2 className="text-xs font-semibold uppercase tracking-brand text-ink-300 hover:text-ink-100">
              ▸ Configuration · GetConfiguration / ChangeConfiguration
            </h2>
            <span className="text-[10px] text-ink-500">OCPP 1.6 §9.1 / §9.2</span>
          </header>
        </summary>

        <div className="mt-3 space-y-3 border-t border-bg-border/40 pt-3">
          {/* Get-all + read-one */}
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="block text-[9px] uppercase tracking-brand text-ink-500">
                All configuration keys
              </label>
              <button
                type="button"
                onClick={handleGetAll}
                disabled={busy !== null || pollState === "polling"}
                className="mt-1 w-full rounded-md bg-sv-sky/20 px-3 py-1.5 text-[11px] font-medium text-sv-sky ring-1 ring-sv-sky/30 hover:bg-sv-sky/30 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {busy === "get-all"
                  ? "queueing…"
                  : pollState === "polling"
                    ? "waiting for gateway…"
                    : "Get all"}
              </button>
            </div>
            <div>
              <label className="block text-[9px] uppercase tracking-brand text-ink-500">
                Read one key
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
                  onClick={handleReadOne}
                  disabled={!getConfigKey || busy !== null || pollState === "polling"}
                  className="rounded-md bg-sv-sky/20 px-2 py-1 text-[11px] font-medium text-sv-sky ring-1 ring-sv-sky/30 hover:bg-sv-sky/30 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {busy === "get-one" ? "…" : "Read"}
                </button>
              </div>
            </div>
          </div>

          {/* Write key + value */}
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
                onClick={handleWrite}
                disabled={!changeConfigKey || busy !== null}
                className="rounded-md bg-sv-sky/20 px-2 py-1 text-[11px] font-medium text-sv-sky ring-1 ring-sv-sky/30 hover:bg-sv-sky/30 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {busy === "write" ? "…" : "Write"}
              </button>
            </div>
          </div>

          {/* Status + result */}
          {error && (
            <p className="rounded border border-rose-700/40 bg-rose-950/30 px-2 py-1 text-[11px] text-rose-200">
              {error}
            </p>
          )}

          {pollState === "timeout" && (
            <p className="rounded border border-amber-700/40 bg-amber-950/30 px-2 py-1 text-[11px] text-amber-200">
              No response from gateway after 30s. The charger may be on
              Native auth (no OCPP session) or the gateway lost the
              WebSocket. Try again or check the OCPP connection.
            </p>
          )}

          {keys !== null && (
            <div className="rounded border border-bg-border/60 bg-bg-base/40">
              <div className="border-b border-bg-border/40 px-2 py-1.5 text-[10px] uppercase tracking-brand text-ink-400">
                {keys.length} key{keys.length === 1 ? "" : "s"}
                {unknownKeys.length > 0 && (
                  <span className="ml-2 text-amber-300">
                    · {unknownKeys.length} unknown
                  </span>
                )}
              </div>
              <table className="w-full text-[11px]">
                <thead className="text-[9px] uppercase tracking-brand text-ink-500">
                  <tr className="text-left">
                    <th className="px-2 py-1 font-medium">Key</th>
                    <th className="px-2 py-1 font-medium">Value</th>
                    <th className="px-2 py-1 text-center font-medium">Read-only</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-bg-border/30 font-mono text-ink-200">
                  {keys.length === 0 ? (
                    <tr>
                      <td className="px-2 py-2 italic text-ink-500" colSpan={3}>
                        No configuration keys returned.
                      </td>
                    </tr>
                  ) : (
                    keys.map((k) => (
                      <tr key={k.key} className="hover:bg-bg-base/30">
                        <td className="px-2 py-1 text-ink-300">{k.key}</td>
                        <td className="px-2 py-1 break-all text-ink-100">
                          {k.value ?? "—"}
                        </td>
                        <td className="px-2 py-1 text-center text-ink-500">
                          {k.readonly ? "yes" : ""}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
              {unknownKeys.length > 0 && (
                <div className="border-t border-bg-border/40 px-2 py-1.5 text-[10px] text-amber-300">
                  Unknown keys: {unknownKeys.join(", ")}
                </div>
              )}
            </div>
          )}
        </div>
      </details>
    </section>
  );
}
