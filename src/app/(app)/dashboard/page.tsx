import { cookies } from "next/headers";
import { Topbar } from "@/components/topbar";
import { PageShell } from "@/components/page-shell";
import { adminSessionConfig, verifyAdminSession } from "@/lib/admin-session";

export const metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  const jar = await cookies();
  const token = jar.get(adminSessionConfig.SESSION_COOKIE_NAME)?.value;
  const session = await verifyAdminSession(token);
  const email = session?.email;

  return (
    <>
      <Topbar title="Dashboard" email={email} />
      <PageShell
        title="Straumvakt"
        description="Foundations are in. Sprint 0 is next. See docs/architecture for the delivery plan."
      >
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <article className="rounded-lg border border-bg-border bg-bg-surface/70 p-5 shadow-card backdrop-blur">
            <h2 className="text-xs font-semibold uppercase tracking-brand text-sv-sky">
              Sprint 0
            </h2>
            <p className="mt-2 text-sm font-semibold text-ink-50">
              Foundation schema
            </p>
            <p className="mt-1 text-xs text-ink-300">
              V3 Postgres schemas, tenant-scoped repositories, event log, money
              as BIGINT minor units.
            </p>
          </article>
          <article className="rounded-lg border border-bg-border bg-bg-surface/70 p-5 shadow-card backdrop-blur">
            <h2 className="text-xs font-semibold uppercase tracking-brand text-sv-sky">
              Sprint 1
            </h2>
            <p className="mt-2 text-sm font-semibold text-ink-50">
              OCPP foundation
            </p>
            <p className="mt-1 text-xs text-ink-300">
              Event-log-first webhook, idempotent, domain event translator,
              outbox dispatcher.
            </p>
          </article>
          <article className="rounded-lg border border-bg-border bg-bg-surface/70 p-5 shadow-card backdrop-blur">
            <h2 className="text-xs font-semibold uppercase tracking-brand text-sv-sky">
              Sprint 2
            </h2>
            <p className="mt-2 text-sm font-semibold text-ink-50">
              OCPI foundation
            </p>
            <p className="mt-1 text-xs text-ink-300">
              CPO + eMSP endpoints, token translator, external property / site
              shadow records.
            </p>
          </article>
        </div>

        <section className="mt-8 rounded-lg border border-bg-border bg-bg-surface/70 p-5 shadow-card backdrop-blur">
          <h2 className="text-sm font-semibold text-ink-50">
            Status: login shell live
          </h2>
          <p className="mt-1 text-sm text-ink-300">
            You are signed in{email ? ` as ${email}` : ""}. This is a clean V3
            rebuild — no mock data, no legacy schema. The next commit starts
            Sprint 0 per the delivery plan.
          </p>
        </section>
      </PageShell>
    </>
  );
}
