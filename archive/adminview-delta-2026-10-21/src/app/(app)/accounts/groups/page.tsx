import Link from "next/link";
import { SectionTabs, ACCOUNTS_TABS } from "@/components/section-tabs";
import { apiFetchServerJson } from "@/lib/api-client-server";
import type { FamilyGroupSummary } from "@straumvakt/shared/domain/family-groups";
import type { VendorUserGroupSummary } from "@straumvakt/shared/domain/vendor-user-groups";

export const dynamic = "force-dynamic";
export const metadata = { title: "Accounts · Groups" };

/**
 * Cross-org groups directory. Surfaces every kind of grouping in one
 * place so operators see the full picture before drilling into an
 * org's detail. Today's kinds:
 *   • Family groups   — multi-driver households (existing model)
 *   • Vendor groups   — Zaptec UserGroup mirror (populated when sync
 *                       engine lands; deferred OCPP-auth sprint)
 *
 * Future kinds (none yet): native DriverGroup, AgentGroup,
 * CostCenter membership, etc. Each gets its own filter chip.
 */

type Kind = "all" | "family" | "vendor";

export default async function GroupsPage({
  searchParams,
}: {
  searchParams: Promise<{ kind?: string }>;
}) {
  const sp = await searchParams;
  const kind: Kind =
    sp.kind === "family" || sp.kind === "vendor" ? sp.kind : "all";

  const { familyGroups, vendorGroups } = await apiFetchServerJson<{
    familyGroups: FamilyGroupSummary[];
    vendorGroups: VendorUserGroupSummary[];
  }>("/api/admin/groups");

  const familyShown = kind === "all" || kind === "family";
  const vendorShown = kind === "all" || kind === "vendor";

  const total =
    (familyShown ? familyGroups.length : 0) +
    (vendorShown ? vendorGroups.length : 0);

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <SectionTabs tabs={ACCOUNTS_TABS} />

      <header className="mb-4 border-b border-bg-border pb-4">
        <h1 className="text-2xl font-semibold text-ink-50">Groups</h1>
        <p className="mt-1 text-sm text-ink-400">
          User groupings across all organizations. Family groups are
          multi-driver households (one driver pays for several). Vendor
          groups mirror Zaptec UserGroups and populate when the sync
          engine lands.
        </p>
      </header>

      <div className="mb-3 flex items-center gap-2">
        <KindChip current={kind} value="all" label={`All (${familyGroups.length + vendorGroups.length})`} />
        <KindChip current={kind} value="family" label={`Family (${familyGroups.length})`} />
        <KindChip current={kind} value="vendor" label={`Vendor (${vendorGroups.length})`} />
      </div>

      {total === 0 ? (
        <div className="rounded border border-dashed border-bg-border p-8 text-center text-sm text-ink-500">
          No groups yet.
        </div>
      ) : (
        <div className="space-y-6">
          {familyShown && familyGroups.length > 0 && (
            <section>
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-brand text-ink-400">
                Family groups ({familyGroups.length})
              </h2>
              <ul className="divide-y divide-bg-border/60 rounded-md border border-bg-border bg-bg-base/30">
                {familyGroups.map((g) => (
                  <li
                    key={g.id}
                    className="flex items-center gap-3 px-3 py-1.5 text-xs hover:bg-bg-base/20"
                  >
                    <span className="shrink-0 rounded bg-emerald-950/40 px-1.5 py-0.5 font-mono text-[10px] text-emerald-300">
                      family
                    </span>
                    <span className="shrink-0 text-sm font-medium text-ink-50">
                      {g.displayName}
                    </span>
                    <Link
                      href={`/accounts/organizations/${g.orgId}` as Parameters<typeof Link>[0]["href"]}
                      className="shrink-0 text-[11px] text-sv-sky hover:underline"
                    >
                      {g.orgDisplayName}
                    </Link>
                    <span className="min-w-0 flex-1 truncate text-ink-500">
                      Primary:{" "}
                      {g.primaryUserDisplayName
                        ? `${g.primaryUserDisplayName} · ${g.primaryUserEmail}`
                        : g.primaryUserEmail}
                    </span>
                    <span className="shrink-0 text-[11px] text-ink-400">
                      {g.memberCount} member
                      {g.memberCount === 1 ? "" : "s"}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {vendorShown && vendorGroups.length > 0 && (
            <section>
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-brand text-ink-400">
                Vendor groups ({vendorGroups.length})
              </h2>
              <ul className="divide-y divide-bg-border/60 rounded-md border border-bg-border bg-bg-base/30">
                {vendorGroups.map((g) => (
                  <li
                    key={g.id}
                    className="flex items-center gap-3 px-3 py-1.5 text-xs hover:bg-bg-base/20"
                  >
                    <span className="shrink-0 rounded bg-sv-sky/15 px-1.5 py-0.5 font-mono text-[10px] text-sv-sky">
                      {g.vendorSlug}
                    </span>
                    <span className="shrink-0 text-sm font-medium text-ink-50">
                      {g.name}
                    </span>
                    <Link
                      href={`/accounts/organizations/${g.orgId}` as Parameters<typeof Link>[0]["href"]}
                      className="shrink-0 text-[11px] text-sv-sky hover:underline"
                    >
                      {g.orgDisplayName}
                    </Link>
                    <Link
                      href={`/installations/${g.installationId}`}
                      className="shrink-0 text-[11px] text-ink-400 hover:text-sv-sky"
                    >
                      → {g.installationDisplayName}
                    </Link>
                    <span className="min-w-0 flex-1 truncate text-[11px] text-ink-500">
                      synced{" "}
                      {new Date(g.lastSyncedAt).toLocaleString(undefined, {
                        dateStyle: "short",
                        timeStyle: "short",
                      })}
                    </span>
                    <span className="shrink-0 text-[11px] text-ink-400">
                      {g.memberCount} member
                      {g.memberCount === 1 ? "" : "s"}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {familyShown && familyGroups.length === 0 && vendorShown && (
            <p className="text-[11px] italic text-ink-500">
              No family groups yet.
            </p>
          )}
          {vendorShown && vendorGroups.length === 0 && familyShown && (
            <p className="text-[11px] italic text-ink-500">
              No vendor groups yet — sync engine lands in the
              deferred OCPP-auth sprint.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function KindChip({
  current,
  value,
  label,
}: {
  current: Kind;
  value: Kind;
  label: string;
}) {
  const active = current === value;
  const href = (value === "all"
    ? "/accounts/groups"
    : `/accounts/groups?kind=${value}`) as Parameters<typeof Link>[0]["href"];
  return (
    <Link
      href={href}
      className={
        "rounded border px-2 py-1 text-[11px] " +
        (active
          ? "border-sv-sky bg-sv-sky/10 text-sv-sky"
          : "border-bg-border bg-bg-base/40 text-ink-300 hover:bg-bg-raised hover:text-ink-50")
      }
    >
      {label}
    </Link>
  );
}
