import Link from "next/link";
import { SectionTabs, OPERATIONS_TABS } from "@/components/section-tabs";
import { ActionBar } from "@/components/action-bar";
import { apiFetchServerJson } from "@/lib/api-client-server";
import type { InstallationSummary } from "@straumvakt/shared/domain/installations";

export const dynamic = "force-dynamic";
export const metadata = { title: "Installations" };

export default async function InstallationsPage() {
  const { installations } = await apiFetchServerJson<{
    installations: InstallationSummary[];
  }>("/api/admin/installations");

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <SectionTabs tabs={OPERATIONS_TABS} />
      <ActionBar
        title="Installations"
        description="A vendor installation under a Site — typically a Zaptec or Easee deployment. Holds the vendor reference + retailer tariff anchor (ADR 0008). Zaptec OAuth auto-fetch arrives at milestone 2.7."
        primaryAction={{ href: "/installations/new", label: "Add installation" }}
      />

      <h2 className="mb-2 text-sm font-semibold uppercase tracking-brand text-ink-300">
        All installations ({installations.length})
      </h2>
      {installations.length === 0 ? (
        <div className="rounded border border-dashed border-bg-border p-6 text-center text-sm text-ink-500">No installations yet.</div>
      ) : (
        <ul className="divide-y divide-bg-border/60 rounded-md border border-bg-border bg-bg-base/30">
          {installations.map((i) => (
            <li
              key={i.id}
              className="flex items-center gap-3 px-3 py-1.5 text-xs hover:bg-bg-base/20"
            >
              <Link
                href={`/installations/${i.id}`}
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
                <Link className="text-sv-sky hover:underline" href={`/tenants/organizations/${i.orgId}`}>
                  {i.orgDisplayName}
                </Link>
                {" · "}
                {i.siteDisplayName}
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
    </div>
  );
}
