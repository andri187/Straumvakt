"use client";
// Sprint 8.4.7 — sortable client-side table for /chargers list.
// Page (Server Component) fetches the data once; this component owns
// the sort state and re-orders the array on each header click.

import { useState, type ReactNode } from "react";
import Link from "next/link";
import type { ChargerSummary } from "@straumvakt/shared/domain/chargers";

const DASH = "—";

type SortKey =
  | "identityString"
  | "orgSite"
  | "vendorModel"
  | "firmwareVersion"
  | "mainboardSwVersion"
  | "smartBootloaderVersion"
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
      case "firmwareVersion":
        n = compareNullable(a.firmwareVersion, b.firmwareVersion, STR);
        break;
      case "mainboardSwVersion":
        n = compareNullable(a.mainboardSwVersion, b.mainboardSwVersion, STR);
        break;
      case "smartBootloaderVersion":
        n = compareNullable(a.smartBootloaderVersion, b.smartBootloaderVersion, STR);
        break;
      case "lifetimeKwh":
        n = compareNullable(a.lifetimeKwh, b.lifetimeKwh, NUM);
        break;
      case "online": {
        // Group by online (true first when asc), tiebreak by onlineSinceAt
        // (longer-online first) for online rows, lastSeenAt for offline.
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
            <SortHeader label="Computer SW (911)" k="firmwareVersion" sortKey={sortKey} sortDir={sortDir} onClick={onHeaderClick} />
            <SortHeader label="Mainboard (908)" k="mainboardSwVersion" sortKey={sortKey} sortDir={sortDir} onClick={onHeaderClick} />
            <SortHeader label="Bootloader (912)" k="smartBootloaderVersion" sortKey={sortKey} sortDir={sortDir} onClick={onHeaderClick} />
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
  return (
    <tr className="hover:bg-bg-base/20">
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
      </td>
      <td className="px-3 py-1.5 text-ink-300">
        <span className="text-ink-400">{c.orgDisplayName}</span>
        <span className="text-ink-600"> · </span>
        <span>{c.siteDisplayName}</span>
      </td>
      <td className="px-3 py-1.5 text-ink-400">
        {c.vendor && c.model ? `${c.vendor} ${c.model}` : (c.vendor ?? c.model ?? DASH)}
      </td>
      <td className="px-3 py-1.5 font-mono text-[11px] text-ink-300">{c.firmwareVersion ?? DASH}</td>
      <td className="px-3 py-1.5 font-mono text-[11px] text-ink-300">{c.mainboardSwVersion ?? DASH}</td>
      <td className="px-3 py-1.5 font-mono text-[11px] text-ink-300">{c.smartBootloaderVersion ?? DASH}</td>
      <td className="px-3 py-1.5 text-right font-mono text-ink-200">{fmtKWh(c.lifetimeKwh)}</td>
      <td className="px-3 py-1.5">
        <OnlineCell c={c} />
      </td>
    </tr>
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
