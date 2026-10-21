import { cookies } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Topbar } from "@/components/topbar";
import { adminSessionConfig, verifyAdminSession } from "@/lib/admin-session";
import { apiFetchServer } from "@/lib/api-client-server";
import type { OrgSummary } from "@straumvakt/shared/domain/orgs";
import { OrgSectionTabs } from "./org-section-tabs";

export default async function OrganizationDetailLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const jar = await cookies();
  const token = jar.get(adminSessionConfig.SESSION_COOKIE_NAME)?.value;
  const session = await verifyAdminSession(token);

  const { id } = await params;
  const res = await apiFetchServer(`/api/admin/orgs/${id}`);
  if (res.status === 404) notFound();
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const { org } = (await res.json()) as { org: OrgSummary };

  const headline = [
    org.kennitala ? `kennitala ${formatKennitala(org.kennitala)}` : null,
    org.legalForm,
    org.countryCode,
    `status ${org.status}`,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <>
      <Topbar title={`Accounts · ${org.displayName}`} email={session?.email} />
      <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="mb-3 text-xs text-ink-400">
          <Link href="/accounts/organizations" className="hover:text-ink-50">
            ← All organizations
          </Link>
        </div>
        <header className="mb-4 border-b border-bg-border pb-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="min-w-0">
              <h1 className="text-2xl font-semibold text-ink-50">
                {org.displayName}
              </h1>
              {headline && (
                <p className="mt-1 text-sm text-ink-400">{headline}</p>
              )}
            </div>
            {org.roles.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {org.roles.map((r) => (
                  <span
                    key={r}
                    className="rounded bg-sv-sky/10 px-1.5 py-0.5 font-mono text-[10px] text-sv-sky"
                  >
                    {r}
                  </span>
                ))}
              </div>
            )}
          </div>
        </header>
        <OrgSectionTabs orgId={org.id} />
        {children}
      </div>
    </>
  );
}

function formatKennitala(raw: string): string {
  const digits = raw.replace(/-/g, "");
  return digits.length === 10 ? `${digits.slice(0, 6)}-${digits.slice(6)}` : raw;
}
