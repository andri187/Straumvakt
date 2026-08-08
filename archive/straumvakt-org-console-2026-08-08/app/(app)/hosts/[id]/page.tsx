import { cookies } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Topbar } from "@/components/topbar";
import { adminSessionConfig, verifyAdminSession } from "@/lib/admin-session";
import { apiFetchServer } from "@/lib/api-client-server";
import type { OrgSummary, OrganizationKind } from "@straumvakt/shared/domain/orgs";
import type { BillObjectSummary } from "@straumvakt/shared/domain/bill-objects";
import type { ContractSummary } from "@straumvakt/shared/domain/contracts";
import type { UserSummary } from "@straumvakt/shared/domain/users";
import type { FamilyGroupSummary } from "@straumvakt/shared/domain/family-groups";
import { BillObjectsPanel } from "../bill-objects-panel";

export const metadata = { title: "Host" };

type Tab = "overview" | "billing-homes" | "drivers" | "contract";

const TABS: { key: Tab; label: string }[] = [
  { key: "overview", label: "Overview" },
  { key: "billing-homes", label: "Billing-homes" },
  { key: "drivers", label: "Drivers" },
  { key: "contract", label: "Contract" },
];

const HOST_KINDS: OrganizationKind[] = ["multi_dwelling", "company"];

function kindLabel(kind: OrganizationKind | null): string | null {
  if (kind === "multi_dwelling") return "multi_dwelling";
  if (kind === "company") return "company";
  return null;
}

function formatKennitala(raw: string): string {
  const digits = raw.replace(/-/g, "");
  return digits.length === 10 ? `${digits.slice(0, 6)}-${digits.slice(6)}` : raw;
}

export default async function HostDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const tab: Tab =
    sp.tab === "billing-homes" ||
    sp.tab === "drivers" ||
    sp.tab === "contract"
      ? sp.tab
      : "overview";

  const jar = await cookies();
  const token = jar.get(adminSessionConfig.SESSION_COOKIE_NAME)?.value;
  const session = await verifyAdminSession(token);

  const orgRes = await apiFetchServer(`/api/admin/orgs/${id}`);
  if (orgRes.status === 404) notFound();
  if (!orgRes.ok) throw new Error(`HTTP ${orgRes.status}`);
  const { org } = (await orgRes.json()) as { org: OrgSummary };

  // Guard the lens: this surface is for host orgs only. A non-host org
  // (operator / vendor / DSO, kind=null) reached here directly should be
  // sent to its full org profile rather than rendered with empty host
  // rollups.
  if (!org.kind || !HOST_KINDS.includes(org.kind)) {
    return (
      <>
        <Topbar title="Hosts" email={session?.email} />
        <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
          <div className="mb-3 text-xs text-ink-400">
            <Link
              href={"/hosts" as Parameters<typeof Link>[0]["href"]}
              className="hover:text-ink-50"
            >
              ← Hosts
            </Link>
          </div>
          <div className="rounded-lg border border-amber-500/40 bg-amber-950/20 p-6">
            <h1 className="text-lg font-semibold text-amber-100">
              {org.displayName} is not a host
            </h1>
            <p className="mt-1 text-sm text-amber-200/80">
              This organization has no host kind (multi_dwelling / company). The
              Hosts lens only covers customer hosts. Manage it from its full org
              profile.
            </p>
            <Link
              href={`/accounts/organizations/${org.id}` as Parameters<typeof Link>[0]["href"]}
              className="mt-3 inline-block text-sm text-sv-sky hover:underline"
            >
              Open org profile →
            </Link>
          </div>
        </div>
      </>
    );
  }

  // Fetch the per-tab payloads in parallel. Each degrades to empty on
  // failure so one missing surface doesn't 500 the whole host page.
  const [billRes, usersRes, contractsRes, familyRes] = await Promise.all([
    apiFetchServer(`/api/admin/orgs/${id}/bill-objects`),
    apiFetchServer(`/api/admin/users`),
    apiFetchServer(`/api/admin/orgs/${id}/contracts`),
    apiFetchServer(`/api/admin/orgs/${id}/family-groups`),
  ]);

  const { items: billObjects } = billRes.ok
    ? ((await billRes.json()) as { items: BillObjectSummary[] })
    : { items: [] };
  const { users } = usersRes.ok
    ? ((await usersRes.json()) as { users: UserSummary[] })
    : { users: [] };
  const { contracts } = contractsRes.ok
    ? ((await contractsRes.json()) as { contracts: ContractSummary[] })
    : { contracts: [] };
  const { familyGroups } = familyRes.ok
    ? ((await familyRes.json()) as { familyGroups: FamilyGroupSummary[] })
    : { familyGroups: [] };

  // Drivers eligible for billing-home assignment: active driver-audience
  // users. The members endpoint enforces this server-side; we mirror the
  // filter so the picker only offers valid candidates.
  const driverCandidates = users.filter(
    (u) => u.audience === "driver" && u.status === "active",
  );

  const kindBadge = kindLabel(org.kind);

  return (
    <>
      <Topbar title={`Hosts · ${org.displayName}`} email={session?.email} />
      <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="mb-3 text-xs text-ink-400">
          <Link
            href={"/hosts" as Parameters<typeof Link>[0]["href"]}
            className="hover:text-ink-50"
          >
            ← Hosts
          </Link>
        </div>

        <header className="mb-4 border-b border-bg-border pb-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-2xl font-semibold text-ink-50">
                  {org.displayName}
                </h1>
                {kindBadge && (
                  <span className="rounded bg-sv-sky/10 px-2 py-0.5 font-mono text-[11px] text-sv-sky">
                    {kindBadge}
                  </span>
                )}
              </div>
              <p className="mt-1 font-mono text-sm text-ink-400">
                {org.kennitala ? formatKennitala(org.kennitala) : "no kennitala"}
                {org.roles.length > 0 && ` · roles: ${org.roles.join(", ")}`}
              </p>
            </div>
            <Link
              href={`/accounts/organizations/${org.id}` as Parameters<typeof Link>[0]["href"]}
              className="rounded border border-bg-border bg-bg-base/40 px-3 py-1.5 text-xs text-ink-300 hover:bg-bg-raised hover:text-ink-100"
            >
              Full org profile →
            </Link>
          </div>
        </header>

        {/* KPI rollups — OrgSummary carries no aggregates yet, so these
            show em-dash. Billing-homes count is locally known. */}
        <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Kpi label="Billing-homes" value={String(billObjects.length)} />
          <Kpi label="Drivers (host)" value="—" />
          <Kpi label="Chargers" value="—" />
          <Kpi label="Contracts" value={String(contracts.length)} />
        </div>

        <nav className="-mx-6 mb-6 border-b border-bg-border bg-bg-base/40 px-6">
          <ul className="-mb-px flex gap-1 overflow-x-auto">
            {TABS.map((t) => {
              const active = t.key === tab;
              const href =
                t.key === "overview"
                  ? `/hosts/${id}`
                  : `/hosts/${id}?tab=${t.key}`;
              return (
                <li key={t.key}>
                  <Link
                    href={href as Parameters<typeof Link>[0]["href"]}
                    className={
                      "inline-block whitespace-nowrap border-b-2 px-3 py-2.5 text-sm transition-colors " +
                      (active
                        ? "border-sv-sky text-sv-sky"
                        : "border-transparent text-ink-400 hover:border-bg-border hover:text-ink-100")
                    }
                  >
                    {t.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        {tab === "overview" && (
          <OverviewTab org={org} billObjectCount={billObjects.length} />
        )}
        {tab === "billing-homes" && (
          <BillObjectsPanel
            orgId={org.id}
            initialBillObjects={billObjects}
            driverCandidates={driverCandidates}
          />
        )}
        {tab === "drivers" && (
          <DriversTab orgId={org.id} familyGroups={familyGroups} />
        )}
        {tab === "contract" && <ContractTab contracts={contracts} />}
      </div>
    </>
  );
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-bg-border bg-bg-base/30 px-4 py-3">
      <div className="text-[10px] uppercase tracking-brand text-ink-500">
        {label}
      </div>
      <div className="mt-1 text-xl font-semibold text-ink-50">{value}</div>
    </div>
  );
}

function OverviewTab({
  org,
  billObjectCount,
}: {
  org: OrgSummary;
  billObjectCount: number;
}) {
  return (
    <section className="space-y-4">
      <div className="rounded-lg border border-bg-border bg-bg-base/30 p-4">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-brand text-ink-300">
          Host profile
        </h2>
        <div className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          <Row label="Legal name" value={org.legalName} />
          <Row label="Legal form" value={org.legalForm} />
          <Row label="VSK" value={org.vskNr} mono />
          <Row label="Currency" value={org.defaultCurrency} mono />
          <Row
            label="Postal address"
            value={
              org.postalAddress
                ? `${org.postalAddress.street}, ${org.postalAddress.postalCode} ${org.postalAddress.city}`
                : null
            }
          />
          <Row
            label="Main contact"
            value={
              org.mainContact
                ? `${org.mainContact.displayName ?? org.mainContact.email}`
                : null
            }
          />
          <Row label="Billing-homes" value={String(billObjectCount)} />
          <Row label="Status" value={org.status} />
        </div>
      </div>

      <p className="text-[11px] text-ink-500">
        Site / installation / charger detail lives on the full org profile —{" "}
        <Link
          href={`/accounts/organizations/${org.id}/sites` as Parameters<typeof Link>[0]["href"]}
          className="text-sv-sky hover:underline"
        >
          view sites
        </Link>
        {" · "}
        <Link
          href={`/accounts/organizations/${org.id}/installations` as Parameters<typeof Link>[0]["href"]}
          className="text-sv-sky hover:underline"
        >
          installations
        </Link>
        .
      </p>
    </section>
  );
}

function DriversTab({
  orgId,
  familyGroups,
}: {
  orgId: string;
  familyGroups: FamilyGroupSummary[];
}) {
  // Driver access for a host flows through DriverGroupMemberships (ADR
  // 0026 access spine). There is no per-org driver-group LIST endpoint
  // mounted yet, so we surface the closest available signal — the host's
  // family/household groups — and point at the full org driver-groups tab.
  return (
    <section>
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-brand text-ink-300">
          Driver groups ({familyGroups.length})
        </h2>
        <Link
          href={`/accounts/organizations/${orgId}/driver-groups` as Parameters<typeof Link>[0]["href"]}
          className="text-[11px] text-sv-sky hover:underline"
        >
          Full driver groups →
        </Link>
      </div>

      <p className="mb-3 text-[11px] text-ink-500">
        Drivers gain access through DriverGroup memberships (ADR 0026 access
        spine), and pay through their billing-home (the Billing-homes tab).
        Family / household groupings — where one driver pays for several — are
        shown below.
      </p>

      {familyGroups.length === 0 ? (
        <div className="rounded border border-dashed border-bg-border p-6 text-center text-sm text-ink-500">
          No driver groups for this host yet.
        </div>
      ) : (
        <ul className="divide-y divide-bg-border/60 rounded-md border border-bg-border bg-bg-base/30">
          {familyGroups.map((g) => (
            <li
              key={g.id}
              className="flex items-center gap-3 px-3 py-1.5 text-xs hover:bg-bg-base/20"
            >
              <span className="shrink-0 text-sm font-medium text-ink-50">
                {g.displayName}
              </span>
              <span className="min-w-0 flex-1 truncate text-ink-500">
                Primary:{" "}
                {g.primaryUserDisplayName
                  ? `${g.primaryUserDisplayName} · ${g.primaryUserEmail}`
                  : g.primaryUserEmail}
              </span>
              <span className="shrink-0 text-[11px] text-ink-400">
                {g.memberCount} member{g.memberCount === 1 ? "" : "s"}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function ContractTab({ contracts }: { contracts: ContractSummary[] }) {
  return (
    <section>
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-brand text-ink-300">
        Contracts ({contracts.length})
      </h2>
      {contracts.length === 0 ? (
        <div className="rounded border border-dashed border-bg-border p-6 text-center text-sm text-ink-500">
          No contracts for this host yet.
        </div>
      ) : (
        <div className="overflow-hidden rounded-md border border-bg-border bg-bg-base/30">
          <table className="w-full text-left text-sm">
            <thead className="text-xs text-ink-400">
              <tr>
                <th className="px-4 py-2 font-medium">Contract</th>
                <th className="px-4 py-2 font-medium">Scope</th>
                <th className="px-4 py-2 font-medium">Counterparty</th>
                <th className="px-4 py-2 font-medium">Valid from</th>
                <th className="px-4 py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {contracts.map((ct) => (
                <tr key={ct.id} className="border-t border-bg-border/40">
                  <td className="px-4 py-2 font-medium text-ink-50">
                    {ct.displayName}
                  </td>
                  <td className="px-4 py-2 text-ink-300">
                    <span className="font-mono text-[11px]">{ct.scopeType}</span>
                    {ct.scopeDisplayName && (
                      <span className="text-ink-500"> · {ct.scopeDisplayName}</span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-ink-300">
                    {ct.counterpartyOrgDisplayName ?? (
                      <span className="text-ink-500">—</span>
                    )}
                  </td>
                  <td className="px-4 py-2 font-mono text-[11px] text-ink-300">
                    {new Date(ct.validFrom).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-2">
                    <ContractStatusBadge status={ct.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function ContractStatusBadge({ status }: { status: ContractSummary["status"] }) {
  const classes =
    status === "active"
      ? "bg-emerald-950/40 text-emerald-300 border-emerald-700/40"
      : status === "pending_configuration"
        ? "bg-amber-950/40 text-amber-300 border-amber-700/40"
        : "bg-slate-800/60 text-slate-400 border-slate-700/40";
  return (
    <span
      className={
        "inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-medium " +
        classes
      }
    >
      {status.replace(/_/g, " ")}
    </span>
  );
}

function Row({
  label,
  value,
  mono,
}: {
  label: string;
  value: string | null;
  mono?: boolean;
}) {
  return (
    <div className="flex items-baseline gap-3">
      <dt className="shrink-0 basis-32 text-[10px] uppercase tracking-brand text-ink-500">
        {label}
      </dt>
      <dd className={mono ? "font-mono text-ink-200" : "text-ink-200"}>
        {value ?? <span className="text-ink-500">—</span>}
      </dd>
    </div>
  );
}
