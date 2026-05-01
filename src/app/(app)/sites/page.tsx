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
import { OcppEmblem, type OcppEmblemState } from "./auth-toggle-button";

function flatChargers(
  node: SiteTreeNode | SiteTreeInstallationNode | SiteTreeCircuitNode,
): SiteTreeChargerNode[] {
  if ("orphanCircuits" in node) {
    return [
      ...node.installations.flatMap(flatChargers),
      ...node.orphanCircuits.flatMap((c) => c.chargers),
      ...node.orphanChargers,
    ];
  }
  if ("circuits" in node) {
    return [...node.circuits.flatMap((c) => c.chargers), ...node.directChargers];
  }
  return node.chargers;
}

/**
 * Aggregate OCPP config state across a list of Zaptec chargers.
 * Worst-state-wins so the operator's eye lands on rows that need
 * fixing. Non-Zaptec rows are excluded so a stray entry doesn't
 * drag the state to "unknown".
 */
function aggregateOcppState(chargers: SiteTreeChargerNode[]): {
  state: OcppEmblemState;
  count: number;
} {
  const zaptec = chargers.filter((c) => c.vendor === "Zaptec");
  if (zaptec.length === 0) return { state: "unknown", count: 0 };
  // unknown wins over everything below: if even one charger's state
  // is unreadable, surface that as the row's state.
  const anyUnknown = zaptec.some((c) => c.ocppActive === null || c.authRequired === null);
  if (anyUnknown) return { state: "unknown", count: zaptec.length };
  // misconfigured wins next: any charger where mode isn't OCPP can't
  // be auto-fixed by the auth toggle.
  const anyMisconfigured = zaptec.some((c) => c.ocppActive === false);
  if (anyMisconfigured) return { state: "misconfigured", count: zaptec.length };
  // mode is OCPP across the board → state hinges on authRequired.
  const allAuthOn = zaptec.every((c) => c.authRequired === true);
  if (allAuthOn) return { state: "ready", count: zaptec.length };
  // any auth-off → amber. Aggregate "fix" enables auth on all in scope
  // (the more common operator intent).
  return { state: "auth-off", count: zaptec.length };
}

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
        <KwhPill value={site.lifetimeEnergyKWhTotal} />
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
  const ocpp = aggregateOcppState(flatChargers(installation));
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
        <span className="ml-auto flex items-center gap-1.5">
          {installation.vendorSlug === "zaptec" && (
            <OcppEmblem
              scope={{ kind: "installation", installationId: installation.id }}
              state={ocpp.state}
              count={ocpp.count}
              label={installation.displayName}
            />
          )}
          <KwhPill value={installation.lifetimeEnergyKWhTotal} small />
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
        <span className="ml-auto flex items-center gap-1.5">
          <KwhPill value={circuit.lifetimeEnergyKWhTotal} small />
          <span className="text-[10px] text-ink-500">
            {circuit.chargers.length} charger{circuit.chargers.length === 1 ? "" : "s"}
          </span>
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

/**
 * Format kWh as ###.###,## (Icelandic / German style: period
 * thousands separator, comma decimal). Returns em-dash for null.
 * Examples: 22285.691 → "22.285,69"; 1.5 → "1,50"; null → "—".
 */
function formatKwh(kwh: number | null): string {
  if (kwh == null) return "—";
  const fixed = kwh.toFixed(2); // "22285.69"
  const [intPart, fracPart] = fixed.split(".");
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${grouped},${fracPart}`;
}

function formatRelativeDuration(fromISO: string | null): string | null {
  if (!fromISO) return null;
  const ms = Date.now() - new Date(fromISO).getTime();
  if (!Number.isFinite(ms) || ms < 0) return null;
  const min = Math.floor(ms / 60_000);
  if (min < 1) return "<1m";
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  const remMin = min % 60;
  if (h < 24) return remMin > 0 ? `${h}h ${remMin}m` : `${h}h`;
  const d = Math.floor(h / 24);
  const remH = h % 24;
  return remH > 0 ? `${d}d ${remH}h` : `${d}d`;
}

function ChargerLine({ charger, indent }: { charger: SiteTreeChargerNode; indent: number }) {
  const label =
    charger.identityString ?? charger.serialNumber ?? charger.chargingStationId.slice(0, 8);
  const connectedFor = formatRelativeDuration(charger.onlineSince);
  const onlineDot = charger.online ? "bg-emerald-400" : "bg-ink-600";
  const statusText = charger.online
    ? connectedFor
      ? `online for ${connectedFor}`
      : "online"
    : "offline";
  // Per-charger row is intentionally minimal: dot + identity + a
  // single human-readable status sentence ("online for 3h 12m" /
  // "offline"). Vendor/model, connector type, last-seen timestamp,
  // and the per-charger emblems live on the charger detail page —
  // putting them inline here makes the tree unreadable at scale.
  return (
    <div
      className="flex items-center gap-2 rounded px-2 py-1 text-xs hover:bg-bg-base/30"
      style={{ paddingLeft: `${1.25 * indent + 1}rem` }}
    >
      <span
        className={`h-2 w-2 shrink-0 rounded-full ${onlineDot}`}
        title={
          charger.online
            ? charger.onlineSince
              ? `Online since ${new Date(charger.onlineSince).toLocaleString()}`
              : "Online"
            : "Not heard from in last 5 min"
        }
      />
      <Link
        href={`/chargers/${charger.chargingStationId}`}
        className="font-mono text-ink-100 hover:text-sv-sky truncate"
      >
        {label}
      </Link>
      <span className="ml-auto flex items-center gap-2 text-[11px] text-ink-400">
        <span>{statusText}</span>
        <span
          className="font-mono text-ink-300"
          title={
            charger.lifetimeEnergyKWh != null
              ? `Lifetime energy delivered (Zaptec SignedMeterValueKwh)`
              : "Lifetime energy unavailable"
          }
        >
          {formatKwh(charger.lifetimeEnergyKWh)} kWh
        </span>
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

/**
 * Aggregate lifetime-kWh pill for parent rows (site, installation,
 * circuit). Single value formatted as ###.###,## kWh — Icelandic /
 * European convention with period thousands separator + comma
 * decimal. Em-dash when no charger in scope reported a value.
 */
function KwhPill({ value, small = false }: { value: number | null; small?: boolean }) {
  const cls = small ? "text-[10px]" : "text-[11px]";
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 rounded bg-sv-sky/10 px-1.5 py-0.5 font-mono text-sv-sky ring-1 ring-sv-sky/30 ${cls}`}
      title={value != null ? "Lifetime kWh delivered (sum of children)" : "No lifetime kWh data available"}
    >
      <span>{formatKwh(value)}</span>
      <span className="text-sv-sky/60">kWh</span>
    </span>
  );
}

/**
 * Per-source online emblem — green when the charger is reachable
 * via this control plane, grey otherwise. `active = null` means
 * "unknown" (e.g. Zaptec API unreachable, no credential available)
 * and renders the same as offline but with a different tooltip so
 * the operator knows the difference.
 *
 *   API  → Zaptec cloud reports IsOnline. Vendor-side data plane.
 *   OCPP → our gateway has a live authenticated session.
 *
 * Both green = full hand-shake. Green API + grey OCPP = "Zaptec
 * sees the charger but auth is failing on our side" — exactly the
 * config-drift signal the operator needs to spot.
 */
function SourceEmblem({ label, active }: { label: string; active: boolean | null }) {
  const tone = active
    ? "bg-emerald-950/40 text-emerald-300 ring-emerald-700/30"
    : active === false
      ? "bg-bg-base/50 text-ink-500 ring-bg-border"
      : "bg-bg-base/30 text-ink-600 ring-bg-border/40";
  const dotTone = active
    ? "bg-emerald-400"
    : active === false
      ? "bg-ink-500"
      : "bg-ink-600";
  const title = active
    ? `${label} active`
    : active === false
      ? `${label} offline`
      : `${label} status unknown`;
  return (
    <span
      title={title}
      className={`inline-flex shrink-0 items-center gap-1 rounded px-1 py-0.5 font-mono text-[9px] ring-1 ${tone}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${dotTone}`} />
      {label}
    </span>
  );
}
