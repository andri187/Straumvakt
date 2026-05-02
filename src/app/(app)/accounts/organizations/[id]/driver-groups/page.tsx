import { apiFetchServer } from "@/lib/api-client-server";
import type { FamilyGroupSummary } from "@straumvakt/shared/domain/family-groups";

export const metadata = { title: "Organization · Driver groups" };

/**
 * Driver groups tab. Currently surfaces FamilyGroup rows (the closest
 * existing model — multi-driver households where one driver pays for
 * several). Will broaden when ADR 0014's user-import flow lands and
 * we start mirroring Zaptec UserGroups as proper DriverGroup rows.
 */
export default async function OrgDriverGroupsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const res = await apiFetchServer(`/api/admin/orgs/${id}/family-groups`);
  const { familyGroups } = res.ok
    ? ((await res.json()) as { familyGroups: FamilyGroupSummary[] })
    : { familyGroups: [] };

  return (
    <section>
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-brand text-ink-300">
          Driver groups ({familyGroups.length})
        </h2>
      </div>

      <p className="mb-3 text-[11px] text-ink-500">
        Family / household groupings where one driver pays for several. Future:
        Zaptec UserGroup imports + native DriverGroup model land in Sprint 5
        (ADR 0014).
      </p>

      {familyGroups.length === 0 ? (
        <div className="rounded border border-dashed border-bg-border p-6 text-center text-sm text-ink-500">
          No driver groups for this organization yet.
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
