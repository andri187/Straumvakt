"use client";
// Sprint 8.4.7 — sortable client-side table for /chargers list.
// Sprint 9.7  — dropped the 3 firmware columns (Computer SW / Mainboard
// / Bootloader) — those still live on the per-charger Technical Read.
// Replaced with two compact "emblem + value" columns that are far more
// useful at-a-glance: Connector (type emblem + status) and Signal
// (colored bars by magnitude + -dBm value).

import { Fragment, useState, type ReactNode } from "react";
import Link from "next/link";
import { Signal, Wifi, RadioTower, Cable, Network } from "lucide-react";
import type { ChargerSummary } from "@straumvakt/shared/domain/chargers";
import {
  signalIconClass,
  formatSignal,
  signalQuality,
} from "@/lib/signal-quality";

const DASH = "—";

type SortKey =
  | "identityString"
  | "orgSite"
  | "vendorModel"
  | "connector"
  | "comm"
  | "signal"
  | "lifetimeKwh"
  | "online";

type SortDir = "asc" | "desc";

function fmtKWh(v: number | null): string {
  if (v == null) return DASH;
  // Icelandic locale: period for thousands, comma for decimal.
  // Manual formatter — Workers' SSR Intl falls back to en-US on
  // is-IS locale, so toLocaleString prints "4,302.61" instead of
  // "4.302,61". Format by hand to guarantee correctness.
  const fixed = v.toFixed(2);
  const [whole, frac] = fixed.split(".");
  const withSep = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${withSep},${frac} kWh`;
}

function fmtRelative(iso: string | null): string {
  if (!iso) return DASH;
  const t = new Date(iso).getTime();
  const ageSec = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (ageSec < 60) return `${ageSec}s`;
  const min = Math.floor(ageSec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ${min % 60}m`;
  const days = Math.floor(hr / 24);
  return `${days}d ${hr % 24}h`;
}

function compareNullable<T>(a: T | null, b: T | null, cmp: (x: T, y: T) => number): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1; // nulls last
  if (b == null) return -1;
  return cmp(a, b);
}

const STR = (a: string, b: string) => a.localeCompare(b);
const NUM = (a: number, b: number) => a - b;

// 9.8.2 — signal logic moved to @/lib/signal-quality (shared with
// the technical-read panel). Cisco-aligned thresholds.

function sortedRows(rows: ChargerSummary[], key: SortKey, dir: SortDir): ChargerSummary[] {
  const dirMul = dir === "asc" ? 1 : -1;
  const sorted = [...rows];
  sorted.sort((a, b) => {
    let n = 0;
    switch (key) {
      case "identityString":
        n = STR(a.identityString, b.identityString);
        break;
      case "orgSite":
        n = STR(`${a.orgDisplayName} · ${a.siteDisplayName}`, `${b.orgDisplayName} · ${b.siteDisplayName}`);
        break;
      case "vendorModel": {
        const av = `${a.vendor ?? ""} ${a.model ?? ""}`.trim();
        const bv = `${b.vendor ?? ""} ${b.model ?? ""}`.trim();
        n = compareNullable(av || null, bv || null, STR);
        break;
      }
      case "connector":
        // Sort by status first (charging > available > offline > —),
        // then by connector type as tiebreak.
        n = STR(connectorStatusLabel(a), connectorStatusLabel(b));
        if (n === 0) n = STR(a.connectorType, b.connectorType);
        break;
      case "comm":
        n = compareNullable(a.commMode, b.commMode, STR);
        break;
      case "signal": {
        // Strongest first (descending) when asc — quality is the
        // 0-100 proxy from @/lib/signal-quality so cellular % and
        // Wi-Fi |dBm| sort onto the same axis.
        n = compareNullable(
          signalQuality(b.signalDbm, b.commMode),
          signalQuality(a.signalDbm, a.commMode),
          NUM,
        );
        break;
      }
      case "lifetimeKwh":
        n = compareNullable(a.lifetimeKwh, b.lifetimeKwh, NUM);
        break;
      case "online": {
        if (a.online !== b.online) return a.online ? -dirMul : dirMul;
        if (a.online && b.online) {
          n = compareNullable(
            a.onlineSinceAt ? new Date(a.onlineSinceAt).getTime() : null,
            b.onlineSinceAt ? new Date(b.onlineSinceAt).getTime() : null,
            NUM,
          );
        } else {
          n = compareNullable(
            a.lastSeenAt ? new Date(a.lastSeenAt).getTime() : null,
            b.lastSeenAt ? new Date(b.lastSeenAt).getTime() : null,
            NUM,
          );
        }
        break;
      }
    }
    return n * dirMul;
  });
  return sorted;
}

function connectorStatusLabel(c: ChargerSummary): string {
  // Per-connector status comes from OcppIdentity.status today (no
  // separate per-connector tracking in the list endpoint). When the
  // charger is offline, force "offline" same as the /sites tree
  // (8.13.4) so the row reads consistently.
  if (!c.online) return "offline";
  return c.status ?? "—";
}

// Sprint 9.9 — grouped table. Rows nest under Installation -> Circuit
// section headers with distinct surface tones so the operator can scan
// the fleet structurally instead of sorting a flat list.
//
// Surface palette (darker = deeper level):
//   Installation header   bg-sv-sky/10  · text-sv-sky
//   Circuit header        bg-bg-raised   · text-ink-200
//   Charger row           transparent (hover bg-bg-base/20)
//
// Sorting now happens within a circuit only (clicking a column header
// re-sorts each circuit's rows independently). Group order is fixed
// alphabetically — Installation name first, Circuit name second.
// Orphan chargers (no installation / no circuit) collect at the bottom
// under "Unassigned".

interface CircuitGroup {
  circuitId: string | null;
  circuitDisplayName: string | null;
  chargers: ChargerSummary[];
}

/** Flatten a group back to a flat charger list — the lamps below report
 *  on the installation as a whole, not per circuit. */
function allChargersIn(g: InstallationGroup): ChargerSummary[] {
  return g.circuits.flatMap((c) => c.chargers);
}

/**
 * Two independent data paths reach every charger, and until now the UI
 * showed only one of them.
 *
 *   API   — the Zaptec status sync. Writes `online` / `lastSeenAt`.
 *   OCPP  — the charger's own WebSocket to our gateway. `ocppOnline`.
 *
 * They are not the same question, and they diverged for three months
 * (13 May → 4 Aug 2026) while the fleet view read "online for 6d 15h"
 * throughout, because the vendor poll kept answering. A green API lamp
 * beside a red OCPP lamp is exactly that state, made visible.
 *
 * Lit when *any* charger in the installation is reporting on that path;
 * an installation is "dark" on a path only when none of its chargers is.
 */
function PathLamps({ chargers }: { chargers: ChargerSummary[] }) {
  if (chargers.length === 0) return null;
  const api = chargers.some((c) => c.online);
  const ocpp = chargers.some((c) => c.ocppOnline);
  return (
    <span className="ml-3 inline-flex items-center gap-1.5 align-middle">
      <Lamp label="API" on={api} title={
        api
          ? "Vendor API is reporting on this installation"
          : "No charger here has been seen by the vendor API recently"
      } />
      <Lamp label="OCPP" on={ocpp} title={
        ocpp
          ? "Chargers here are connected to the OCPP gateway"
          : "No OCPP frames from this installation — chargers are not talking to us"
      } />
    </span>
  );
}

function Lamp({ label, on, title }: { label: string; on: boolean; title: string }) {
  return (
    <span
      title={title}
      className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-brand ${
        on
          ? "border-emerald-600/40 bg-emerald-950/30 text-emerald-300"
          : "border-red-700/50 bg-red-950/30 text-red-300"
      }`}
    >
      <span
        aria-hidden="true"
        className={`h-1.5 w-1.5 rounded-full ${
          on
            ? "bg-emerald-400 shadow-[0_0_5px_1px_rgba(52,211,153,0.85)]"
            : "bg-red-500 shadow-[0_0_5px_1px_rgba(239,68,68,0.6)]"
        }`}
      />
      {label}
    </span>
  );
}

/**
 * Whether a charge here needs an Authorize verdict.
 *
 * A lit key means an unknown token is turned away. A struck-through dark
 * key means the charger will start for anyone who plugs in — which is a
 * legitimate configuration (free vend, cost borne by the site) but should
 * never be a surprise, because it is also why sessions arrive carrying a
 * vendor placeholder tag instead of a driver.
 *
 * null — the charger has no installation, so there is nothing to enforce.
 */
function AuthKey({ required }: { required: boolean | null }) {
  if (required === null) {
    return (
      <span
        title="No installation — authorization is not configured"
        className="mr-1.5 inline-block h-3 w-3 align-[-1px] text-ink-700"
        aria-hidden="true"
      >
        <KeyGlyph struck={false} />
      </span>
    );
  }
  return (
    <span
      title={
        required
          ? "Authorization required — an unknown token is rejected"
          : "No authorization required — this charger starts for anyone who plugs in"
      }
      className={`mr-1.5 inline-block h-3 w-3 align-[-1px] ${
        required
          ? "text-emerald-400 drop-shadow-[0_0_4px_rgba(52,211,153,0.9)]"
          : "text-ink-600"
      }`}
    >
      <KeyGlyph struck={!required} />
      <span className="sr-only">
        {required ? "Authorization required" : "No authorization required"}
      </span>
    </span>
  );
}

function KeyGlyph({ struck }: { struck: boolean }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6"
      strokeLinecap="round" strokeLinejoin="round" className="h-full w-full">
      <circle cx="5.5" cy="5.5" r="3" />
      <path d="M7.7 7.7 13 13" />
      <path d="M11 11l-1.4 1.4" />
      <path d="M13 13l1.2-1.2" />
      {struck && <path d="M2 14 14 2" strokeWidth="1.5" />}
    </svg>
  );
}

interface InstallationGroup {
  installationId: string | null;
  installationDisplayName: string | null;
  circuits: CircuitGroup[];
  totalCount: number;
}

function groupChargers(chargers: ChargerSummary[]): InstallationGroup[] {
  const byInstallation = new Map<string, InstallationGroup>();
  for (const c of chargers) {
    const ikey = c.installationId ?? "__unassigned_installation__";
    let inst = byInstallation.get(ikey);
    if (!inst) {
      inst = {
        installationId: c.installationId,
        installationDisplayName: c.installationDisplayName,
        circuits: [],
        totalCount: 0,
      };
      byInstallation.set(ikey, inst);
    }
    const ckey = c.circuitId ?? "__unassigned_circuit__";
    let circuit = inst.circuits.find((g) => (g.circuitId ?? "__unassigned_circuit__") === ckey);
    if (!circuit) {
      circuit = {
        circuitId: c.circuitId,
        circuitDisplayName: c.circuitDisplayName,
        chargers: [],
      };
      inst.circuits.push(circuit);
    }
    circuit.chargers.push(c);
    inst.totalCount++;
  }
  // Sort installations + circuits alphabetically; Unassigned (null name)
  // sinks to the bottom of each level.
  const orderName = (s: string | null) => s ?? "￿"; // unassigned last
  const groups = Array.from(byInstallation.values());
  groups.sort((a, b) => orderName(a.installationDisplayName).localeCompare(orderName(b.installationDisplayName)));
  for (const g of groups) {
    g.circuits.sort((a, b) => orderName(a.circuitDisplayName).localeCompare(orderName(b.circuitDisplayName)));
  }
  return groups;
}

export function ChargersTable({ chargers }: { chargers: ChargerSummary[] }) {
  const [sortKey, setSortKey] = useState<SortKey>("identityString");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  const onHeaderClick = (k: SortKey) => {
    if (k === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(k);
      setSortDir("asc");
    }
  };

  const groups = groupChargers(chargers);

  return (
    <div className="overflow-x-auto rounded-md border border-bg-border bg-bg-base/30">
      <table className="w-full text-xs">
        <thead className="border-b border-bg-border/60 text-[10px] uppercase tracking-brand text-ink-500">
          <tr className="text-left">
            <SortHeader label="Charger" k="identityString" sortKey={sortKey} sortDir={sortDir} onClick={onHeaderClick} />
            <SortHeader label="Org · Site" k="orgSite" sortKey={sortKey} sortDir={sortDir} onClick={onHeaderClick} />
            <SortHeader label="Vendor · Model" k="vendorModel" sortKey={sortKey} sortDir={sortDir} onClick={onHeaderClick} />
            <SortHeader label="Connector" k="connector" sortKey={sortKey} sortDir={sortDir} onClick={onHeaderClick} />
            <SortHeader label="Comm" k="comm" sortKey={sortKey} sortDir={sortDir} onClick={onHeaderClick} />
            <SortHeader label="Signal" k="signal" sortKey={sortKey} sortDir={sortDir} onClick={onHeaderClick} />
            <SortHeader label="Lifetime kWh" k="lifetimeKwh" sortKey={sortKey} sortDir={sortDir} onClick={onHeaderClick} align="right" />
            <SortHeader label="Online" k="online" sortKey={sortKey} sortDir={sortDir} onClick={onHeaderClick} />
          </tr>
        </thead>
        <tbody>
          {groups.map((g) => {
            const installationKey = g.installationId ?? "__unassigned_installation__";
            return (
              <Fragment key={installationKey}>
                <tr className="bg-sv-sky/10 ring-1 ring-inset ring-sv-sky/20">
                  <td colSpan={8} className="px-3 py-1.5 text-[11px] font-semibold text-sv-sky">
                    <span className="uppercase tracking-brand text-[9px] text-sv-sky/70">Installation · </span>
                    {g.installationDisplayName ?? (
                      <span className="italic text-ink-500">Unassigned</span>
                    )}
                    <span className="ml-2 text-[10px] font-normal text-ink-500">
                      ({g.totalCount} charger{g.totalCount === 1 ? "" : "s"})
                    </span>
                    <PathLamps chargers={allChargersIn(g)} />
                  </td>
                </tr>
                {g.circuits.map((circuit) => {
                  const circuitKey = `${installationKey}::${circuit.circuitId ?? "__unassigned_circuit__"}`;
                  const sortedRowsInCircuit = sortedRows(circuit.chargers, sortKey, sortDir);
                  return (
                    <Fragment key={circuitKey}>
                      <tr className="bg-bg-raised/60">
                        <td colSpan={8} className="px-6 py-1 text-[10px] text-ink-300">
                          <span className="uppercase tracking-brand text-[9px] text-ink-500">Circuit · </span>
                          {circuit.circuitDisplayName ?? (
                            <span className="italic text-ink-500">Unassigned</span>
                          )}
                          <span className="ml-2 text-[10px] text-ink-500">
                            ({circuit.chargers.length})
                          </span>
                        </td>
                      </tr>
                      {sortedRowsInCircuit.map((c) => {
                        const sameSerial =
                          c.serialNumber != null &&
                          c.identityString.toLowerCase() === c.serialNumber.toLowerCase();
                        return <ChargerRow key={c.chargingStationId} c={c} sameSerial={sameSerial} />;
                      })}
                    </Fragment>
                  );
                })}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function SortHeader({
  label,
  k,
  sortKey,
  sortDir,
  onClick,
  align,
}: {
  label: string;
  k: SortKey;
  sortKey: SortKey;
  sortDir: SortDir;
  onClick: (k: SortKey) => void;
  align?: "right";
}) {
  const active = sortKey === k;
  const indicator: ReactNode = active ? (
    <span className="ml-1 text-ink-300">{sortDir === "asc" ? "▲" : "▼"}</span>
  ) : (
    <span className="ml-1 text-ink-700">↕</span>
  );
  return (
    <th
      className={`px-3 py-2 font-medium ${align === "right" ? "text-right" : "text-left"}`}
    >
      <button
        type="button"
        onClick={() => onClick(k)}
        className={`inline-flex items-center hover:text-ink-200 ${active ? "text-ink-200" : ""}`}
      >
        {label}
        {indicator}
      </button>
    </th>
  );
}

function ChargerRow({ c, sameSerial }: { c: ChargerSummary; sameSerial: boolean }) {
  // Decommissioned rows render dim so they're visibly distinct from
  // active hardware when the toggle is on.
  const dim = c.decommissioned === true ? "opacity-60" : "";
  return (
    <tr className={`hover:bg-bg-base/20 ${dim}`}>
      <td className="px-3 py-1.5">
        <AuthKey required={c.enforceAuthorize} />
        <Link
          href={`/chargers/${c.chargingStationId}`}
          className="font-mono text-sm font-medium text-ink-50 hover:text-sv-sky"
        >
          {c.identityString}
        </Link>
        {!sameSerial && c.serialNumber && (
          <span className="ml-2 font-mono text-[10px] text-ink-500">{c.serialNumber}</span>
        )}
        {c.decommissioned === true && (
          <span className="ml-2 rounded border border-amber-700/40 bg-amber-950/30 px-1.5 py-0.5 text-[9px] uppercase tracking-brand text-amber-300">
            decom
          </span>
        )}
      </td>
      <td className="px-3 py-1.5 text-ink-300">
        <span className="text-ink-400">{c.orgDisplayName}</span>
        <span className="text-ink-600"> · </span>
        <span>{c.siteDisplayName}</span>
      </td>
      <td className="px-3 py-1.5 text-ink-400">
        {c.vendor && c.model ? `${c.vendor} ${c.model}` : (c.vendor ?? c.model ?? DASH)}
      </td>
      <td className="px-3 py-1.5">
        <ConnectorCell c={c} />
      </td>
      <td className="px-3 py-1.5">
        <CommCell mode={c.commMode} />
      </td>
      <td className="px-3 py-1.5">
        <SignalCell value={c.signalDbm} comm={c.commMode} />
      </td>
      <td className="px-3 py-1.5 text-right font-mono text-ink-200">{fmtKWh(c.lifetimeKwh)}</td>
      <td className="px-3 py-1.5">
        <OnlineCell c={c} />
      </td>
    </tr>
  );
}

/**
 * Connector-shape emblem. Lucide doesn't ship IEC 62196 plug icons,
 * so each connector type gets its own inline SVG. Type 2 has the
 * canonical 7-pin Mennekes layout (1 large flat top, 6 round
 * lower pins); CCS has the Type 2 head plus two large DC pins
 * underneath. CHAdeMO and Type 1 fall through to a generic plug.
 *
 * Drawn at 16×16 viewBox; the wrapping <span> sets size via
 * Tailwind so the emblem matches the row height of the other icons.
 */
function ConnectorEmblem({ type, className }: { type: string; className?: string }) {
  const t = type.toLowerCase();
  if (t.includes("ccs")) {
    return (
      <svg viewBox="0 0 16 16" className={className} fill="none" stroke="currentColor" strokeWidth="1" aria-hidden>
        <circle cx="8" cy="6" r="4.5" />
        <line x1="8" y1="2" x2="8" y2="3.2" strokeWidth="1.4" />
        <circle cx="6" cy="6" r="0.7" fill="currentColor" />
        <circle cx="10" cy="6" r="0.7" fill="currentColor" />
        <circle cx="6" cy="8" r="0.7" fill="currentColor" />
        <circle cx="10" cy="8" r="0.7" fill="currentColor" />
        <circle cx="5" cy="13" r="1.3" fill="currentColor" />
        <circle cx="11" cy="13" r="1.3" fill="currentColor" />
      </svg>
    );
  }
  if (t.includes("chademo")) {
    return (
      <svg viewBox="0 0 16 16" className={className} fill="none" stroke="currentColor" strokeWidth="1" aria-hidden>
        <circle cx="8" cy="8" r="6" />
        <circle cx="5.5" cy="6" r="1" fill="currentColor" />
        <circle cx="10.5" cy="6" r="1" fill="currentColor" />
        <circle cx="5.5" cy="10" r="1" fill="currentColor" />
        <circle cx="10.5" cy="10" r="1" fill="currentColor" />
        <circle cx="8" cy="11.5" r="0.8" fill="currentColor" />
      </svg>
    );
  }
  // Default: Type 2 (Mennekes) — 7-pin Schuko-derived layout.
  return (
    <svg viewBox="0 0 16 16" className={className} fill="none" stroke="currentColor" strokeWidth="1" aria-hidden>
      <circle cx="8" cy="8" r="6.2" />
      <line x1="8" y1="2.5" x2="8" y2="4" strokeWidth="1.4" />
      <circle cx="5.5" cy="6.5" r="0.8" fill="currentColor" />
      <circle cx="10.5" cy="6.5" r="0.8" fill="currentColor" />
      <circle cx="4.6" cy="9" r="0.8" fill="currentColor" />
      <circle cx="11.4" cy="9" r="0.8" fill="currentColor" />
      <circle cx="6.5" cy="11" r="0.8" fill="currentColor" />
      <circle cx="9.5" cy="11" r="0.8" fill="currentColor" />
    </svg>
  );
}

function ConnectorCell({ c }: { c: ChargerSummary }) {
  const status = connectorStatusLabel(c);
  // Tone for the status label — same scale as the /sites pill.
  const tone =
    status === "available"
      ? "text-emerald-300"
      : status === "charging" ||
          status === "preparing" ||
          status === "finishing" ||
          status === "suspended"
        ? "text-sv-sky"
        : status === "offline"
          ? "text-amber-300"
          : status === "faulted"
            ? "text-rose-300"
            : "text-ink-500";
  return (
    <span className="inline-flex items-center gap-1.5">
      <ConnectorEmblem type={c.connectorType} className="h-4 w-4 shrink-0 text-ink-400" />
      <span className="font-mono text-[10px] text-ink-400">{c.connectorType}</span>
      <span className={`text-[11px] ${tone}`}>{status}</span>
    </span>
  );
}

function CommCell({ mode }: { mode: string | null }) {
  // Pick an icon by transport. PLC + Ethernet share the cable icon
  // (both wired); Wi-Fi and LTE get their own.
  const Icon =
    mode == null
      ? Network
      : /wi[-\s]?fi/i.test(mode)
        ? Wifi
        : /lte|4g|5g|cellular/i.test(mode)
          ? RadioTower
          : /plc|ethernet|wired/i.test(mode)
            ? Cable
            : Network;
  return (
    <span className="inline-flex items-center gap-1.5">
      <Icon className="h-3.5 w-3.5 shrink-0 text-ink-400" />
      <span className="text-[11px] text-ink-300">{mode ?? DASH}</span>
    </span>
  );
}

function SignalCell({ value, comm }: { value: number | null; comm: string | null }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <Signal className={`h-3.5 w-3.5 shrink-0 ${signalIconClass(value, comm)}`} />
      <span className="font-mono text-[11px] text-ink-300">{formatSignal(value, comm)}</span>
    </span>
  );
}

function OnlineCell({ c }: { c: ChargerSummary }) {
  if (c.online) {
    return (
      <span className="inline-flex items-center gap-1.5">
        <span className="h-2 w-2 rounded-full bg-emerald-400" aria-hidden />
        <span className="text-emerald-300">online</span>
        {c.onlineSinceAt && (
          <span className="text-[10px] text-ink-500">for {fmtRelative(c.onlineSinceAt)}</span>
        )}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="h-2 w-2 rounded-full bg-ink-600" aria-hidden />
      <span className="text-ink-500">offline</span>
      {c.lastSeenAt && (
        <span className="text-[10px] text-ink-600">last seen {fmtRelative(c.lastSeenAt)} ago</span>
      )}
    </span>
  );
}
