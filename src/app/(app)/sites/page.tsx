import Link from "next/link";
import { SectionTabs, OPERATIONS_TABS } from "@/components/section-tabs";
import { ActionBar } from "@/components/action-bar";
import { apiFetchServerJson } from "@/lib/api-client-server";
import type {
  SiteTreeNode,
  SiteTreeInstallationNode,
  SiteTreeCircuitNode,
  SiteTreeChargerNode,
} from "@straumvakt/shared/domain/site-tree";

export const dynamic = "force-dynamic";
export const metadata = { title: "Sites" };

export default async function SitesPage() {
  const { tree } = await apiFetchServerJson<{ tree: SiteTreeNode[] }>(
    "/api/admin/sites/tree",
  );

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <SectionTabs tabs={OPERATIONS_TABS} />
      <ActionBar
        title="Sites"
        description="A Site is a sub-location inside a Property. Expand a site to drill into its installations → circuits → chargers."
        primaryAction={{ href: "/sites/new", label: "Add site" }}
      />

      <h2 className="mb-2 text-sm font-semibold uppercase tracking-brand text-ink-300">
        All sites ({tree.length})
      </h2>
      {tree.length === 0 ? (
        <div className="rounded border border-dashed border-bg-border p-6 text-center text-sm text-ink-500">
          No sites yet.
        </div>
      ) : (
        <div className="divide-y divide-bg-border/60 rounded-md border border-bg-border bg-bg-base/30">
          {tree.map((s) => (
            <SiteRow key={s.id} site={s} />
          ))}
        </div>
      )}
    </div>
  );
}

function SiteRow({ site }: { site: SiteTreeNode }) {
  const total = site.installations.length + site.orphanCircuits.length + site.orphanChargers.length;
  return (
    <details className="group" open={total > 0 && total <= 3}>
      <summary className="flex cursor-pointer items-center gap-3 px-4 py-2.5 hover:bg-bg-base/20">
        <span className="text-ink-500 transition-transform group-open:rotate-90">▸</span>
        <div className="flex flex-1 items-baseline gap-2 min-w-0">
          <Link href={`/sites/${site.id}`} className="text-sm font-medium text-ink-50 hover:text-sv-sky truncate">
            {site.displayName}
          </Link>
          <span className="text-[11px] text-ink-500 truncate">
            <Link className="text-sv-sky hover:underline" href={`/tenants/organizations/${site.orgId}`}>{site.orgDisplayName}</Link>
            {" · "}{site.propertyDisplayName}
            {" · "}<span className="font-mono">{site.siteType}/{site.accessLevel}</span>
          </span>
        </div>
        <ChargerCountPill online={site.chargersOnline} offline={site.chargersOffline} />
      </summary>

      <div className="border-t border-bg-border/40 bg-bg-base/20 px-4 py-2">
        {site.installations.map((inst) => (
          <InstallationRow key={inst.id} installation={inst} />
        ))}

        {site.orphanCircuits.length > 0 && (
          <div className="mt-1">
            <p className="px-1 text-[10px] uppercase tracking-brand text-ink-500">
              Circuits without installation
            </p>
            {site.orphanCircuits.map((cir) => (
              <CircuitRow key={cir.id} circuit={cir} indent={1} />
            ))}
          </div>
        )}

        {site.orphanChargers.length > 0 && (
          <div className="mt-1">
            <p className="px-1 text-[10px] uppercase tracking-brand text-ink-500">
              Chargers without installation/circuit
            </p>
            {site.orphanChargers.map((c) => (
              <ChargerLine key={c.chargingStationId} charger={c} indent={1} />
            ))}
          </div>
        )}

        {total === 0 && (
          <p className="px-1 py-2 text-[11px] italic text-ink-500">
            No installations, circuits, or chargers under this site yet.
          </p>
        )}
      </div>
    </details>
  );
}

function InstallationRow({ installation }: { installation: SiteTreeInstallationNode }) {
  const childCount = installation.circuits.length + installation.directChargers.length;
  return (
    <details className="group/i" open={childCount > 0 && childCount <= 4}>
      <summary
        className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 hover:bg-bg-base/30"
        style={{ paddingLeft: "1.25rem" }}
      >
        <span className="text-[10px] text-ink-500 transition-transform group-open/i:rotate-90">▸</span>
        <Link
          href={`/installations/${installation.id}`}
          className="text-xs font-medium text-ink-100 hover:text-sv-sky"
        >
          {installation.displayName}
        </Link>
        {installation.vendorSlug && (
          <span className="rounded bg-sv-sky/10 px-1.5 py-0.5 font-mono text-[10px] text-sv-sky">
            {installation.vendorSlug}
          </span>
        )}
        <span className="font-mono text-[10px] text-ink-500">{installation.onboardingStatus}</span>
        <span className="ml-auto">
          <ChargerCountPill
            online={installation.chargersOnline}
            offline={installation.chargersOffline}
            small
          />
        </span>
      </summary>
      <div>
        {installation.circuits.map((cir) => (
          <CircuitRow key={cir.id} circuit={cir} indent={2} />
        ))}
        {installation.directChargers.length > 0 && (
          <div style={{ paddingLeft: "2.5rem" }} className="py-1">
            <p className="text-[10px] uppercase tracking-brand text-ink-500">
              Direct (no circuit)
            </p>
            {installation.directChargers.map((c) => (
              <ChargerLine key={c.chargingStationId} charger={c} indent={2} />
            ))}
          </div>
        )}
        {childCount === 0 && (
          <p style={{ paddingLeft: "2.5rem" }} className="py-1 text-[11px] italic text-ink-500">
            No circuits or chargers yet.
          </p>
        )}
      </div>
    </details>
  );
}

function CircuitRow({ circuit, indent }: { circuit: SiteTreeCircuitNode; indent: number }) {
  return (
    <details className="group/c" open={circuit.chargers.length > 0 && circuit.chargers.length <= 6}>
      <summary
        className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 hover:bg-bg-base/30"
        style={{ paddingLeft: `${1.25 * indent + 0.5}rem` }}
      >
        <span className="text-[10px] text-ink-500 transition-transform group-open/c:rotate-90">▸</span>
        <Link
          href={`/circuits/${circuit.id}`}
          className="text-xs text-ink-200 hover:text-sv-sky"
        >
          {circuit.displayName}
        </Link>
        <span className="font-mono text-[10px] text-ink-500">
          {circuit.phaseCount}-phase
          {circuit.ampereCeiling && ` · ${circuit.ampereCeiling}A`}
        </span>
        <span className="ml-auto text-[10px] text-ink-500">
          {circuit.chargers.length} charger{circuit.chargers.length === 1 ? "" : "s"}
        </span>
      </summary>
      <div>
        {circuit.chargers.length === 0 ? (
          <p
            style={{ paddingLeft: `${1.25 * (indent + 1) + 0.5}rem` }}
            className="py-1 text-[11px] italic text-ink-500"
          >
            No chargers on this circuit.
          </p>
        ) : (
          circuit.chargers.map((c) => (
            <ChargerLine key={c.chargingStationId} charger={c} indent={indent + 1} />
          ))
        )}
      </div>
    </details>
  );
}

function ChargerLine({ charger, indent }: { charger: SiteTreeChargerNode; indent: number }) {
  const label =
    charger.identityString ?? charger.serialNumber ?? charger.chargingStationId.slice(0, 8);
  const lastSeen = charger.lastSeenAt
    ? new Date(charger.lastSeenAt).toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : null;
  return (
    <div
      className="flex items-center gap-2 rounded px-2 py-1 text-xs hover:bg-bg-base/30"
      style={{ paddingLeft: `${1.25 * indent + 1}rem` }}
    >
      <span
        className={
          "h-1.5 w-1.5 rounded-full " +
          (charger.online ? "bg-emerald-400" : "bg-ink-500")
        }
        aria-label={charger.online ? "online" : "offline"}
      />
      <Link
        href={`/chargers/${charger.chargingStationId}`}
        className="font-mono text-ink-100 hover:text-sv-sky truncate"
      >
        {label}
      </Link>
      {charger.vendor && charger.model && (
        <span className="text-[10px] text-ink-500 truncate">
          {charger.vendor} {charger.model}
        </span>
      )}
      <span className="text-[10px] text-ink-500 truncate">{charger.connectorSummary}</span>
      <span className="ml-auto font-mono text-[10px] text-ink-500">
        {charger.status}
        {lastSeen && ` · ${lastSeen}`}
      </span>
    </div>
  );
}

function ChargerCountPill({
  online,
  offline,
  small = false,
}: {
  online: number;
  offline: number;
  small?: boolean;
}) {
  const cls = small ? "text-[10px]" : "text-[11px]";
  return (
    <span className={`flex shrink-0 items-center gap-1.5 font-mono ${cls}`}>
      <span className="inline-flex items-center gap-1 rounded bg-emerald-950/40 px-1.5 py-0.5 text-emerald-300 ring-1 ring-emerald-700/30">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
        {online}
      </span>
      <span className="inline-flex items-center gap-1 rounded bg-bg-base/50 px-1.5 py-0.5 text-ink-400 ring-1 ring-bg-border">
        <span className="h-1.5 w-1.5 rounded-full bg-ink-500" />
        {offline}
      </span>
    </span>
  );
}
