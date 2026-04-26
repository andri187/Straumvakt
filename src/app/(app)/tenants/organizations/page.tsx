import { cookies } from "next/headers";
import Link from "next/link";
import { Topbar } from "@/components/topbar";
import { PageShell } from "@/components/page-shell";
import { adminSessionConfig, verifyAdminSession } from "@/lib/admin-session";
import { listOrgs } from "@/lib/repositories/organizations";
import { CreateOrgForm } from "./create-form";

export const metadata = { title: "Tenants · Organizations" };

export default async function OrganizationsPage({
  searchParams,
}: {
  searchParams: Promise<{ archived?: string }>;
}) {
  const jar = await cookies();
  const token = jar.get(adminSessionConfig.SESSION_COOKIE_NAME)?.value;
  const session = await verifyAdminSession(token);

  const sp = await searchParams;
  const includeArchived = sp.archived === "1";
  const orgs = await listOrgs({ includeArchived });

  return (
    <>
      <Topbar title="Tenants · Organizations" email={session?.email} />
      <PageShell
        title="Organizations"
        description="Every Org is a SaaS tenant on Straumvakt — the CPO. Each Org owns Hosts, Properties, Sites, and downstream entities via org_id. Sprint 2.1 (per ADR 0006)."
      >
        <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
          <section className="rounded-lg border border-bg-border bg-bg-surface/70 shadow-card backdrop-blur">
            <header className="flex flex-wrap items-baseline justify-between gap-3 border-b border-bg-border bg-bg-base/40 px-5 py-3">
              <div>
                <h2 className="text-sm font-semibold text-ink-50">
                  {orgs.length} {orgs.length === 1 ? "org" : "orgs"}
                  {includeArchived ? " (incl. archived)" : ""}
                </h2>
                <p className="text-xs text-ink-400">
                  Platform-admin view. Org status: active / suspended / archived.
                </p>
              </div>
              <Link
                href={
                  includeArchived
                    ? "/tenants/organizations"
                    : "/tenants/organizations?archived=1"
                }
                className="text-xs text-ink-300 hover:text-ink-50"
              >
                {includeArchived ? "Hide archived" : "Show archived"}
              </Link>
            </header>
            {orgs.length === 0 ? (
              <div className="p-8 text-center">
                <p className="text-sm text-ink-200">No organizations yet.</p>
                <p className="mt-1 text-xs text-ink-400">
                  Use the form on the right to create the first one. Pilot
                  expects Krónan, N1, and the Straumvakt platform org seeded
                  during onboarding.
                </p>
              </div>
            ) : (
              <table className="w-full text-left text-sm">
                <thead className="text-xs text-ink-400">
                  <tr>
                    <th className="px-5 py-2 font-medium">Display name</th>
                    <th className="px-5 py-2 font-medium">Slug</th>
                    <th className="px-5 py-2 font-medium">Country</th>
                    <th className="px-5 py-2 font-medium">Status</th>
                    <th className="px-5 py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {orgs.map((o) => (
                    <tr key={o.id} className="border-t border-bg-border/40">
                      <td className="px-5 py-2 font-medium text-ink-50">
                        {o.displayName}
                      </td>
                      <td className="px-5 py-2 font-mono text-xs text-ink-300">
                        {o.slug}
                      </td>
                      <td className="px-5 py-2 text-ink-200">{o.countryCode}</td>
                      <td className="px-5 py-2">
                        <StatusBadge status={o.status} />
                      </td>
                      <td className="px-5 py-2 text-right">
                        <Link
                          href={`/tenants/organizations/${o.id}`}
                          className="text-xs text-sv-green hover:text-sv-sky"
                        >
                          Manage →
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          <aside className="rounded-lg border border-bg-border bg-bg-surface/70 p-5 shadow-card backdrop-blur">
            <h2 className="text-xs font-semibold uppercase tracking-brand text-sv-sky">
              Create organization
            </h2>
            <p className="mt-2 text-xs text-ink-400">
              Slug becomes the URL key (lowercase, dashes only). Display name
              is what shows in the operator console. Country is ISO-3166-1
              alpha-2.
            </p>
            <div className="mt-4">
              <CreateOrgForm />
            </div>
          </aside>
        </div>
      </PageShell>
    </>
  );
}

function StatusBadge({ status }: { status: string }) {
  const classes =
    status === "active"
      ? "bg-emerald-950/40 text-emerald-300 border-emerald-700/40"
      : status === "suspended"
        ? "bg-amber-950/40 text-amber-300 border-amber-700/40"
        : "bg-slate-800/60 text-slate-400 border-slate-700/40";
  return (
    <span
      className={
        "inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-medium uppercase " +
        classes
      }
    >
      {status}
    </span>
  );
}
