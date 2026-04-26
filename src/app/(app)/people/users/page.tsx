import { cookies } from "next/headers";
import Link from "next/link";
import { Topbar } from "@/components/topbar";
import { PageShell } from "@/components/page-shell";
import { adminSessionConfig, verifyAdminSession } from "@/lib/admin-session";
import { listUsers } from "@/lib/repositories/users";
import { CreateUserForm } from "./create-form";

export const metadata = { title: "People · Users" };

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
  const users = await listUsers({ includeDeleted });

  return (
    <>
      <Topbar title="People · Users" email={session?.email} />
      <PageShell
        title="Users"
        description="Platform-level user records — staff (owner / admin / operator / helper / contractor / viewer) plus drivers. Per ADR 0006, drivers are inert during pilot (no signin); staff use admin-session env credentials. Real auth lands post-pilot."
      >
        <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
          <section className="rounded-lg border border-bg-border bg-bg-surface/70 shadow-card backdrop-blur">
            <header className="flex flex-wrap items-baseline justify-between gap-3 border-b border-bg-border bg-bg-base/40 px-5 py-3">
              <div>
                <h2 className="text-sm font-semibold text-ink-50">
                  {users.length} user{users.length === 1 ? "" : "s"}
                  {includeDeleted ? " (incl. deleted)" : ""}
                </h2>
                <p className="text-xs text-ink-400">
                  Cross-tenant view. Membership-per-org is on the user&apos;s
                  detail page.
                </p>
              </div>
              <Link
                href={
                  includeDeleted ? "/people/users" : "/people/users?deleted=1"
                }
                className="text-xs text-ink-300 hover:text-ink-50"
              >
                {includeDeleted ? "Hide deleted" : "Show deleted"}
              </Link>
            </header>
            {users.length === 0 ? (
              <div className="p-8 text-center">
                <p className="text-sm text-ink-200">No users yet.</p>
                <p className="mt-1 text-xs text-ink-400">
                  Create the first one on the right. Pilot drivers are
                  admin-created records; staff users (operator console) get
                  added the same way.
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
                      <td className="px-5 py-2 font-mono text-xs text-ink-100">
                        {u.email}
                      </td>
                      <td className="px-5 py-2 text-ink-200">
                        {u.displayName ?? (
                          <span className="text-ink-500">—</span>
                        )}
                      </td>
                      <td className="px-5 py-2 text-xs">
                        {u.hasCredentials ? (
                          <span className="text-emerald-300">Has password</span>
                        ) : (
                          <span
                            className="text-ink-500"
                            title="Pilot inert record (ADR 0006) — no signin path until post-pilot"
                          >
                            Inert (no signin)
                          </span>
                        )}
                      </td>
                      <td className="px-5 py-2">
                        <StatusBadge status={u.status} />
                      </td>
                      <td className="px-5 py-2 text-right">
                        <Link
                          href={`/people/users/${u.id}`}
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
              Create user
            </h2>
            <p className="mt-2 text-xs text-ink-400">
              Email is the unique key. Display name optional. Pilot drivers
              left without a password — staff also start without one (admin
              session is env-var driven). Add memberships from the user
              detail page.
            </p>
            <div className="mt-4">
              <CreateUserForm />
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
