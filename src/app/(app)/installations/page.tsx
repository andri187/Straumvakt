import Link from "next/link";
import { SectionTabs, OPERATIONS_TABS } from "@/components/section-tabs";
import { ActionBar } from "@/components/action-bar";
import { apiFetchServerJson } from "@/lib/api-client-server";
import type { InstallationSummary } from "@straumvakt/shared/domain/installations";
import { PasswordRowAction } from "./password-row-action";

export const dynamic = "force-dynamic";
export const metadata = { title: "Installations" };

type OcppRowSummary = {
  installationId: string;
  identityCount: number;
  lastRotatedAt: string | null;
};

function formatRotatedAt(iso: string | null): string {
  if (!iso) return "never";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "never";
  return d.toLocaleString();
}

export default async function InstallationsPage() {
  const { installations, ocppSummaries } = await apiFetchServerJson<{
    installations: InstallationSummary[];
    // ocppSummaries is missing on pre-fix api Worker deploys; defensively
    // optional so the UI keeps rendering during the deploy window.
    ocppSummaries?: OcppRowSummary[];
  }>("/api/admin/installations");
  const ocppByInstallation = new Map<string, OcppRowSummary>();
  for (const s of ocppSummaries ?? []) ocppByInstallation.set(s.installationId, s);

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
          {installations.map((i) => {
            const ocpp = ocppByInstallation.get(i.id);
            const identityCount = ocpp?.identityCount ?? 0;
            return (
              <li
                key={i.id}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-1.5 text-xs hover:bg-bg-base/20"
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
                  <Link className="text-sv-sky hover:underline" href={`/accounts/organizations/${i.orgId}` as Parameters<typeof Link>[0]["href"]}>
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
                <span
                  className="shrink-0 text-[10px] text-ink-500"
                  title={
                    ocpp?.lastRotatedAt
                      ? `Last rotated ${formatRotatedAt(ocpp.lastRotatedAt)}`
                      : "Never rotated since import"
                  }
                >
                  pwd · {identityCount}{" "}
                  {identityCount === 1 ? "charger" : "chargers"}
                  {ocpp?.lastRotatedAt && (
                    <>
                      {" · "}
                      <span className="text-ink-300">
                        {formatRotatedAt(ocpp.lastRotatedAt)}
                      </span>
                    </>
                  )}
                </span>
                <PasswordRowAction
                  installationId={i.id}
                  identityCount={identityCount}
                />
                <span className="shrink-0 font-mono text-[10px] text-ink-500">
                  {i.onboardingStatus}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
