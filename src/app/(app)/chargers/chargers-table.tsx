"use client";
// Sprint 8.4.7 — sortable client-side table for /chargers list.
// Sprint 9.7  — dropped the 3 firmware columns (Computer SW / Mainboard
// / Bootloader) — those still live on the per-charger Technical Read.
// Replaced with two compact "emblem + value" columns that are far more
// useful at-a-glance: Connector (type emblem + status) and Signal
// (colored bars by magnitude + -dBm value).

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { Signal, Wifi, RadioTower, Cable, Network } from "lucide-react";
import type { ChargerSummary } from "@straumvakt/shared/domain/chargers";

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

/**
 * Map signal magnitude (|dBm|) -> Tailwind colour class. Same scale
 * as TechnicalReadPills (8.4.7.2): 30-55 green · 55-70 yellow ·
 * 70-80 orange · 80+ red · null gray. Stronger signals have smaller
 * magnitude (closer to 0).
 */
function signalIconClass(dbm: number | null): string {
  if (dbm == null) return "text-ink-600";
  const m = Math.abs(dbm);
  if (m < 55) return "text-emerald-400";
  if (m < 70) return "text-yellow-400";
  if (m < 80) return "text-orange-400";
  return "text-rose-400";
}

function fmtSignal(dbm: number | null): string {
  if (dbm == null) return DASH;
  // RF signal strength is negative dBm. Some Zaptec firmwares report
  // magnitude as positive; normalize to canonical negative form.
  const v = dbm <= 0 ? dbm : -dbm;
  return `${v} dBm`;
}

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
      case "signal":
        // Stronger signal sorts first when asc. dBm is negative;
        // we sort by |dBm| ascending so green/closer-to-zero wins.
        n = compareNullable(
          a.signalDbm != null ? Math.abs(a.signalDbm) : null,
          b.signalDbm != null ? Math.abs(b.signalDbm) : null,
          NUM,
        );
        break;
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

  const sorted = sortedRows(chargers, sortKey, sortDir);

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
        <tbody className="divide-y divide-bg-border/40">
          {sorted.map((c) => {
            const sameSerial =
              c.serialNumber != null &&
              c.identityString.toLowerCase() === c.serialNumber.toLowerCase();
            return <ChargerRow key={c.chargingStationId} c={c} sameSerial={sameSerial} />;
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
        <SignalCell dbm={c.signalDbm} />
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

function SignalCell({ dbm }: { dbm: number | null }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <Signal className={`h-3.5 w-3.5 shrink-0 ${signalIconClass(dbm)}`} />
      <span className="font-mono text-[11px] text-ink-300">{fmtSignal(dbm)}</span>
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
