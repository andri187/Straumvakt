import Link from "next/link";
import { apiFetchServer } from "@/lib/api-client-server";
import type { SiteSummary } from "@straumvakt/shared/domain/sites";

export const metadata = { title: "Organization · Sites" };

export default async function OrgSitesPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const res = await apiFetchServer(`/api/admin/orgs/${id}/sites`);
  const { sites } = res.ok
    ? ((await res.json()) as { sites: SiteSummary[] })
    : { sites: [] };

  return (
    <section>
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-brand text-ink-300">
          Sites ({sites.length})
        </h2>
        <Link
          href={"/sites/new" as Parameters<typeof Link>[0]["href"]}
          className="rounded border border-bg-border px-3 py-1 text-xs text-ink-300 hover:bg-bg-base/40 hover:text-ink-100"
        >
          + Add site
        </Link>
      </div>

      {sites.length === 0 ? (
        <div className="rounded border border-dashed border-bg-border p-6 text-center text-sm text-ink-500">
          No sites under this organization yet.
        </div>
      ) : (
        <ul className="divide-y divide-bg-border/60 rounded-md border border-bg-border bg-bg-base/30">
          {sites.map((s) => (
            <li
              key={s.id}
              className="flex items-center gap-3 px-3 py-1.5 text-xs hover:bg-bg-base/20"
            >
              <Link
                href={`/sites/${s.id}` as Parameters<typeof Link>[0]["href"]}
                className="shrink-0 text-sm font-medium text-ink-50 hover:text-sv-sky"
              >
                {s.displayName}
              </Link>
              <span className="font-mono text-[10px] text-ink-500">
                {s.siteType}/{s.accessLevel}
              </span>
              <span className="min-w-0 flex-1 truncate text-ink-500">
                Property: {s.propertyDisplayName}
                {s.powerClass && ` · ${s.powerClass}`}
              </span>
              <span className="shrink-0 font-mono text-[10px] text-ink-500">
                {s.provisioningStatus}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
