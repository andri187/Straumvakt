import Link from "next/link";
import { SectionTabs, OPERATIONS_TABS, CHARGERS_TABS } from "@/components/section-tabs";
import { ActionBar } from "@/components/action-bar";
import { apiFetchServerJson } from "@/lib/api-client-server";
import type { ChargerSummary } from "@straumvakt/shared/domain/chargers";

export const dynamic = "force-dynamic";
export const metadata = { title: "Chargers" };

const DASH = "—";

function fmtKWh(v: number | null): string {
  if (v == null) return DASH;
  return `${v.toLocaleString("is-IS", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} kWh`;
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

export default async function ChargersPage() {
  const { chargers } = await apiFetchServerJson<{ chargers: ChargerSummary[] }>(
    "/api/admin/chargers",
  );

  return (
    <div className="mx-auto max-w-7xl px-6 py-8">
      <SectionTabs tabs={OPERATIONS_TABS} />
      <SectionTabs tabs={CHARGERS_TABS} />
      <ActionBar
        title="Onboarded chargers"
        description="Each row corresponds to a ChargingStation + EVSE + Connector + OCPP identity. The OCPP Basic-Auth password is revealed once after create."
        primaryAction={{ href: "/chargers/new", label: "Add charger" }}
      />

      <h2 className="mb-2 text-sm font-semibold uppercase tracking-brand text-ink-300">All onboarded ({chargers.length})</h2>
      {chargers.length === 0 ? (
        <div className="rounded border border-dashed border-bg-border p-6 text-center text-sm text-ink-500">No chargers yet.</div>
      ) : (
        <div className="overflow-x-auto rounded-md border border-bg-border bg-bg-base/30">
          <table className="w-full text-xs">
            <thead className="border-b border-bg-border/60 text-[10px] uppercase tracking-brand text-ink-500">
              <tr className="text-left">
                <th className="px-3 py-2 font-medium">Charger</th>
                <th className="px-3 py-2 font-medium">Org · Site</th>
                <th className="px-3 py-2 font-medium">Vendor · Model</th>
                <th className="px-3 py-2 font-medium">Computer SW (911)</th>
                <th className="px-3 py-2 font-medium">Mainboard (908)</th>
                <th className="px-3 py-2 font-medium">Bootloader (912)</th>
                <th className="px-3 py-2 text-right font-medium">Lifetime kWh</th>
                <th className="px-3 py-2 font-medium">Online</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-bg-border/40">
              {chargers.map((c) => {
                const sameSerial =
                  c.serialNumber != null &&
                  c.identityString.toLowerCase() === c.serialNumber.toLowerCase();
                return (
                  <ChargerRow
                    key={c.chargingStationId}
                    c={c}
                    sameSerial={sameSerial}
                  />
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
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
        {c.vendor && c.model ? `${c.vendor} ${c.model}` : c.vendor ?? c.model ?? DASH}
      </td>
      <td className="px-3 py-1.5 font-mono text-[11px] text-ink-300">
        {c.firmwareVersion ?? DASH}
      </td>
      <td className="px-3 py-1.5 font-mono text-[11px] text-ink-300">
        {c.mainboardSwVersion ?? DASH}
      </td>
      <td className="px-3 py-1.5 font-mono text-[11px] text-ink-300">
        {c.smartBootloaderVersion ?? DASH}
      </td>
      <td className="px-3 py-1.5 text-right font-mono text-ink-200">
        {fmtKWh(c.lifetimeKwh)}
      </td>
      <td className="px-3 py-1.5">
        <OnlineCell c={c} />
      </td>
    </tr>
  );
}

function OnlineCell({ c }: { c: ChargerSummary }) {
  if (c.online) {
    const since = c.onlineSinceAt;
    return (
      <span className="inline-flex items-center gap-1.5">
        <span className="h-2 w-2 rounded-full bg-emerald-400" aria-hidden />
        <span className="text-emerald-300">online</span>
        {since && (
          <span className="text-[10px] text-ink-500">for {fmtRelative(since)}</span>
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

