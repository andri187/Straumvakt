"use client";
// Sprint 9.5 — Configuration panel reads/writes via Zaptec REST, NOT
// OCPP. Native auth at Dalvegur means we are not the CSMS for these
// chargers, so OCPP GetConfiguration is unreachable. Zaptec exposes
// the real surface:
//   • GET /api/chargers/{id}/state       — ~70 StateId observations
//   • GET /api/chargers/{id} (detail)    — Property* + AuthenticationType
//   • PUT /api/chargers/{id}             — write Property* (POST /update no-ops)
//
// The API Worker fronts these as
//   GET /api/admin/chargers/:id/zaptec-state
//   POST /api/admin/chargers/:id/zaptec-state
//
// Operator workflow:
//   1. Click the box (collapsed by default)
//   2. "Get all" -> single round trip, renders observations + properties
//   3. Filter the table client-side via the search box
//   4. Write a Property* field with the Write form (PUT round-trip)

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api-client";

interface ZaptecStateEntry {
  StateId: number;
  ValueAsString?: string | null;
  Timestamp?: string;
}

interface Snapshot {
  observations: ZaptecStateEntry[];
  properties: Record<string, unknown>;
  fetchedAt: string;
  vendorReachable: boolean;
}

// Curated subset of the most operator-relevant StateIds with names.
// The rest fall through with their numeric ID — the operator can
// look up unfamiliar IDs in docs/reference/integrations/zaptec.md.
const STATE_NAMES: Record<number, string> = {
  [-2]: "IsOnline",
  [-3]: "IsOcppConnected",
  [-100]: "AuthorizationCache",
  100: "ChargerType",
  102: "NetworkType",
  110: "CommunicationMode",
  120: "AuthenticationRequired",
  150: "Comm Mode",
  201: "Internal Temp A (°C)",
  202: "Internal Temp B (°C)",
  270: "Humidity (%RH)",
  501: "Voltage L1",
  502: "Voltage L2",
  503: "Voltage L3",
  507: "Current L1",
  508: "Current L2",
  509: "Current L3",
  510: "ChargerMaxCurrent",
  513: "TotalChargePower",
  553: "TotalChargeEnergySession",
  708: "ChargeCurrentSet",
  710: "ChargerOperationMode",
  711: "IsEnabled",
  715: "NetworkType",
  750: "NewChargeCard",
  751: "AuthenticationListVersion",
  753: "LteRoamingDisabled",
  800: "InstallationId",
  801: "RoutingId",
  803: "Notifications",
  804: "Warnings",
  809: "CommunicationSignalStrength",
  820: "Uptime (h)",
  908: "MainboardSwVersion",
  911: "SmartComputerSwVersion",
  912: "SmartBootloaderVersion",
  913: "HardwareVersion",
  950: "MAC main",
  951: "MAC PLC grid",
  952: "MAC Wi-Fi",
  960: "LTE IMSI",
  961: "LTE MSISDN",
  962: "LTE ICCID",
  963: "LTE IMEI",
  982: "MID Calibration",
};

function fmtRelative(iso: string | undefined | null): string {
  if (!iso) return "";
  const t = new Date(iso).getTime();
  const ageMs = Date.now() - t;
  if (!Number.isFinite(ageMs) || ageMs < 0) return new Date(iso).toLocaleString();
  const ageMin = Math.floor(ageMs / 60_000);
  if (ageMin < 1) return "just now";
  if (ageMin < 60) return `${ageMin}m ago`;
  const ageHr = Math.floor(ageMin / 60);
  if (ageHr < 24) return `${ageHr}h ago`;
  return new Date(iso).toLocaleDateString();
}

export function ChargerConfigPanel({
  chargingStationId,
}: {
  chargingStationId: string;
}) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [writeKey, setWriteKey] = useState("");
  const [writeValue, setWriteValue] = useState("");
  const [writing, setWriting] = useState(false);
  const [writeFlash, setWriteFlash] = useState<string | null>(null);

  // Auto-fetch when the box is opened the first time (saves a click).
  const [hasFetched, setHasFetched] = useState(false);
  useEffect(() => {
    if (hasFetched) return;
    // No-op until the user opens the <details>; we attach the trigger
    // via onToggle below.
  }, [hasFetched]);

  async function fetchAll() {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch(
        `/api/admin/chargers/${chargingStationId}/zaptec-state`,
      );
      if (!res.ok) {
        const j = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(j?.error ?? `HTTP ${res.status}`);
        return;
      }
      setSnapshot((await res.json()) as Snapshot);
      setHasFetched(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  async function handleWrite() {
    if (!writeKey) return;
    setWriting(true);
    setWriteFlash(null);
    setError(null);
    try {
      const body: Record<string, string | number | boolean> = {};
      // Auto-coerce: "true"/"false" -> boolean, numeric -> number,
      // anything else stays a string. Operator can wrap in quotes by
      // putting backticks if they really want literal "true" string —
      // unlikely needed for Property* values.
      const v = writeValue;
      if (v === "true") body[writeKey] = true;
      else if (v === "false") body[writeKey] = false;
      else if (v !== "" && !Number.isNaN(Number(v)) && /^-?\d+(\.\d+)?$/.test(v))
        body[writeKey] = Number(v);
      else body[writeKey] = v;
      const res = await apiFetch(
        `/api/admin/chargers/${chargingStationId}/zaptec-state`,
        { method: "POST", body: JSON.stringify(body) },
      );
      if (!res.ok) {
        const j = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(`write: ${j?.error ?? `HTTP ${res.status}`}`);
        return;
      }
      setWriteFlash(`Wrote ${writeKey} = ${JSON.stringify(body[writeKey])}`);
      // Refresh after a short pause so the new value lands.
      setTimeout(fetchAll, 800);
    } catch (err) {
      setError(`write: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setWriting(false);
    }
  }

  const observations = snapshot?.observations ?? [];
  const properties = snapshot?.properties ?? {};
  const propertyEntries = Object.entries(properties).filter(
    ([k]) => k.startsWith("Property") || k === "AuthenticationType" || k === "IsAuthorizationRequired" || k === "DeviceId" || k === "SerialNo" || k === "Name" || k === "Active",
  );
  const filterLc = filter.trim().toLowerCase();
  const filteredObs = filterLc
    ? observations.filter((o) => {
        const name = STATE_NAMES[o.StateId] ?? "";
        const val = o.ValueAsString ?? "";
        return (
          String(o.StateId).includes(filterLc) ||
          name.toLowerCase().includes(filterLc) ||
          val.toLowerCase().includes(filterLc)
        );
      })
    : observations;
  const filteredProps = filterLc
    ? propertyEntries.filter(
        ([k, v]) =>
          k.toLowerCase().includes(filterLc) ||
          String(v).toLowerCase().includes(filterLc),
      )
    : propertyEntries;

  return (
    <section className="mb-6 rounded-lg border border-bg-border bg-bg-base/30 p-3">
      <details
        onToggle={(e) => {
          if ((e.target as HTMLDetailsElement).open && !hasFetched && !loading) {
            void fetchAll();
          }
        }}
      >
        <summary className="cursor-pointer list-none">
          <header className="flex items-baseline justify-between">
            <h2 className="text-xs font-semibold uppercase tracking-brand text-ink-300 hover:text-ink-100">
              ▸ Configuration · Zaptec REST
            </h2>
            <span className="text-[10px] text-ink-500">
              GET /state + detail · PUT /api/chargers/&lbrace;id&rbrace;
            </span>
          </header>
        </summary>

        <div className="mt-3 space-y-3 border-t border-bg-border/40 pt-3">
          {/* Toolbar */}
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={fetchAll}
              disabled={loading}
              className="rounded-md bg-sv-sky/20 px-3 py-1.5 text-[11px] font-medium text-sv-sky ring-1 ring-sv-sky/30 hover:bg-sv-sky/30 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {loading ? "loading…" : snapshot ? "Refresh" : "Get all"}
            </button>
            {snapshot && (
              <span className="text-[10px] text-ink-500">
                fetched {fmtRelative(snapshot.fetchedAt)}
                {!snapshot.vendorReachable && (
                  <span className="ml-2 text-amber-300">
                    · vendor unreachable
                  </span>
                )}
              </span>
            )}
            <input
              type="search"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="filter by name / id / value"
              className="ml-auto min-w-0 flex-1 max-w-xs rounded border border-bg-border bg-bg-inset px-2 py-1 text-[11px] text-ink-100 placeholder:text-ink-600"
            />
          </div>

          {/* Write form */}
          <div className="rounded border border-bg-border/60 bg-bg-base/40 p-2">
            <div className="grid grid-cols-[1fr_1fr_auto] gap-1">
              <input
                type="text"
                value={writeKey}
                onChange={(e) => setWriteKey(e.target.value)}
                placeholder="Property* key (e.g. PropertyAuthenticationDisabled)"
                maxLength={80}
                className="min-w-0 rounded border border-bg-border bg-bg-inset px-2 py-1 font-mono text-[11px] text-ink-50"
              />
              <input
                type="text"
                value={writeValue}
                onChange={(e) => setWriteValue(e.target.value)}
                placeholder="value (true/false, number, or string)"
                maxLength={500}
                className="min-w-0 rounded border border-bg-border bg-bg-inset px-2 py-1 font-mono text-[11px] text-ink-50"
              />
              <button
                type="button"
                onClick={handleWrite}
                disabled={!writeKey || writing}
                className="rounded-md bg-amber-900/30 px-3 py-1 text-[11px] font-medium text-amber-200 ring-1 ring-amber-700/40 hover:bg-amber-900/50 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {writing ? "…" : "Write"}
              </button>
            </div>
            <p className="mt-1 text-[9px] text-ink-500">
              Writes go via PUT /api/chargers/&lbrace;id&rbrace;. Property* fields
              persist; non-Property keys may silently no-op (Zaptec quirk).
            </p>
            {writeFlash && (
              <p className="mt-1 text-[10px] text-emerald-300">{writeFlash}</p>
            )}
          </div>

          {error && (
            <p className="rounded border border-rose-700/40 bg-rose-950/30 px-2 py-1 text-[11px] text-rose-200">
              {error}
            </p>
          )}

          {/* Properties (from /api/chargers/{id} detail) */}
          {snapshot && filteredProps.length > 0 && (
            <div className="rounded border border-bg-border/60 bg-bg-base/40">
              <div className="border-b border-bg-border/40 px-2 py-1.5 text-[10px] uppercase tracking-brand text-ink-400">
                Properties · {filteredProps.length} key
                {filteredProps.length === 1 ? "" : "s"}
              </div>
              <table className="w-full text-[11px]">
                <thead className="text-[9px] uppercase tracking-brand text-ink-500">
                  <tr className="text-left">
                    <th className="px-2 py-1 font-medium">Key</th>
                    <th className="px-2 py-1 font-medium">Value</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-bg-border/30 font-mono text-ink-200">
                  {filteredProps.map(([k, v]) => (
                    <tr key={k} className="hover:bg-bg-base/30">
                      <td className="px-2 py-1 text-ink-300">{k}</td>
                      <td className="px-2 py-1 break-all text-ink-100">
                        {v === null
                          ? "—"
                          : typeof v === "object"
                            ? JSON.stringify(v)
                            : String(v)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Observations (from /api/chargers/{id}/state) */}
          {snapshot && filteredObs.length > 0 && (
            <div className="rounded border border-bg-border/60 bg-bg-base/40">
              <div className="border-b border-bg-border/40 px-2 py-1.5 text-[10px] uppercase tracking-brand text-ink-400">
                Observations · {filteredObs.length}
                {filterLc && ` of ${observations.length}`} StateIds
              </div>
              <table className="w-full text-[11px]">
                <thead className="text-[9px] uppercase tracking-brand text-ink-500">
                  <tr className="text-left">
                    <th className="px-2 py-1 font-medium">StateId</th>
                    <th className="px-2 py-1 font-medium">Name</th>
                    <th className="px-2 py-1 font-medium">Value</th>
                    <th className="px-2 py-1 font-medium">Observed</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-bg-border/30 font-mono text-ink-200">
                  {filteredObs.map((o) => (
                    <tr key={o.StateId} className="hover:bg-bg-base/30">
                      <td className="px-2 py-1 text-ink-500">{o.StateId}</td>
                      <td className="px-2 py-1 text-ink-300">
                        {STATE_NAMES[o.StateId] ?? "—"}
                      </td>
                      <td className="px-2 py-1 break-all text-ink-100">
                        {o.ValueAsString ?? "—"}
                      </td>
                      <td className="px-2 py-1 text-[10px] text-ink-500">
                        {fmtRelative(o.Timestamp)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {snapshot && observations.length === 0 && propertyEntries.length === 0 && (
            <p className="rounded border border-amber-700/40 bg-amber-950/30 px-2 py-1 text-[11px] text-amber-200">
              Vendor returned nothing — charger may be offline (Zaptec
              cloud can&apos;t reach it for live observations) or no
              credential is bound to its org.
            </p>
          )}
        </div>
      </details>
    </section>
  );
}
