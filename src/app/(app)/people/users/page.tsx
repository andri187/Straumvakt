import { cookies } from "next/headers";
import Link from "next/link";
import { Topbar } from "@/components/topbar";
import { PageShell } from "@/components/page-shell";
import { SectionTabs, TENANTS_TABS } from "@/components/section-tabs";
import { ActionBar } from "@/components/action-bar";
import { adminSessionConfig, verifyAdminSession } from "@/lib/admin-session";
import { apiFetchServerJson } from "@/lib/api-client-server";
import type { UserSummary } from "@straumvakt/shared/domain/users";

export const metadata = { title: "Tenants · Users" };

export default async function UsersPage({
  searchParams,
}: {
  searchParams: Promise<{ deleted?: string }>;
}) {
  const jar = await cookies();
  const token = jar.get(adminSessionConfig.SESSION_COOKIE_NAME)?.value;
  const session = await verifyAdminSession(token);

  const sp = await searchParams;
  const includeDeleted = sp.deleted === "1";
  const { users } = await apiFetchServerJson<{ users: UserSummary[] }>(
    `/api/admin/users${includeDeleted ? "?includeDeleted=true" : ""}`,
  );

  return (
    <>
      <Topbar title="Tenants · Users" email={session?.email} />
      <PageShell
        title="Users"
        description="Platform-level user records — staff plus drivers. Per ADR 0006, drivers are inert during pilot."
      >
        <SectionTabs tabs={TENANTS_TABS} />
        <ActionBar
          title="Users"
          description={
            <>
              Cross-tenant view. Membership-per-org is on the user&apos;s detail page.{" "}
              <Link
                href={includeDeleted ? "/people/users" : "/people/users?deleted=1"}
                className="text-sv-sky hover:underline"
              >
                {includeDeleted ? "Hide deleted" : "Show deleted"}
              </Link>
            </>
          }
          primaryAction={{ href: "/people/users/new", label: "Add user" }}
        />

        <section className="rounded-lg border border-bg-border bg-bg-surface/70 shadow-card backdrop-blur">
          <header className="border-b border-bg-border bg-bg-base/40 px-5 py-3">
            <h2 className="text-sm font-semibold text-ink-50">
              {users.length} user{users.length === 1 ? "" : "s"}
              {includeDeleted ? " (incl. deleted)" : ""}
            </h2>
          </header>
          {users.length === 0 ? (
            <div className="p-8 text-center">
              <p className="text-sm text-ink-200">No users yet.</p>
              <p className="mt-1 text-xs text-ink-400">
                Click <span className="text-sv-green">Add user</span> above to create the first one.
              </p>
            </div>
          ) : (
            <table className="w-full text-left text-sm">
              <thead className="text-xs text-ink-400">
                <tr>
                  <th className="px-5 py-2 font-medium">Email</th>
                  <th className="px-5 py-2 font-medium">Display name</th>
                  <th className="px-5 py-2 font-medium">Sign-in</th>
                  <th className="px-5 py-2 font-medium">Status</th>
                  <th className="px-5 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id} className="border-t border-bg-border/40">
                    <td className="px-5 py-2 font-mono text-xs text-ink-100">{u.email}</td>
                    <td className="px-5 py-2 text-ink-200">
                      {u.displayName ?? <span className="text-ink-500">—</span>}
                    </td>
                    <td className="px-5 py-2 text-xs">
                      {u.hasCredentials ? (
                        <span className="text-emerald-300">Has password</span>
                      ) : (
                        <span className="text-ink-500" title="Pilot inert record (ADR 0006)">
                          Inert (no signin)
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-2"><StatusBadge status={u.status} /></td>
                    <td className="px-5 py-2 text-right">
                      <Link href={`/people/users/${u.id}`} className="text-xs text-sv-green hover:text-sv-sky">
                        Manage →
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
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
    <span className={"inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-medium uppercase " + classes}>
      {status}
    </span>
  );
}
