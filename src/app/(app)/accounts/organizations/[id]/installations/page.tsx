import Link from "next/link";
import { apiFetchServer } from "@/lib/api-client-server";
import type { InstallationSummary } from "@straumvakt/shared/domain/installations";

export const metadata = { title: "Organization · Installations" };

export default async function OrgInstallationsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const res = await apiFetchServer(`/api/admin/orgs/${id}/installations`);
  const { installations } = res.ok
    ? ((await res.json()) as { installations: InstallationSummary[] })
    : { installations: [] };

  return (
    <section>
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-brand text-ink-300">
          Installations ({installations.length})
        </h2>
        <Link
          href={"/installations/new" as Parameters<typeof Link>[0]["href"]}
          className="rounded border border-bg-border px-3 py-1 text-xs text-ink-300 hover:bg-bg-base/40 hover:text-ink-100"
        >
          + Add installation
        </Link>
      </div>

      {installations.length === 0 ? (
        <div className="rounded border border-dashed border-bg-border p-6 text-center text-sm text-ink-500">
          No installations under this organization yet.
        </div>
      ) : (
        <ul className="divide-y divide-bg-border/60 rounded-md border border-bg-border bg-bg-base/30">
          {installations.map((i) => (
            <li
              key={i.id}
              className="flex items-center gap-3 px-3 py-1.5 text-xs hover:bg-bg-base/20"
            >
              <Link
                href={`/installations/${i.id}` as Parameters<typeof Link>[0]["href"]}
                className="shrink-0 text-sm font-medium text-ink-50 hover:text-sv-sky"
              >
                {i.displayName}
              </Link>
              {i.vendorSlug && (
                <span className="shrink-0 rounded bg-sv-sky/10 px-1.5 py-0.5 font-mono text-[10px] text-sv-sky">
                  {i.vendorSlug}
                </span>
              )}
              <span className="min-w-0 flex-1 truncate text-ink-500">
                Site: {i.siteDisplayName}
                {i.vendorInstallationRef && (
                  <>
                    {" · "}
                    <span className="font-mono">{i.vendorInstallationRef}</span>
                  </>
                )}
              </span>
              <span className="shrink-0 font-mono text-[10px] text-ink-500">
                {i.onboardingStatus}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
