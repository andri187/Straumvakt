import { redirect } from "next/navigation";
import { apiFetchServer } from "@/lib/api-client-server";
import { StaffNav } from "../staff-nav";
import { ReadinessView } from "./readiness-view";

export const dynamic = "force-dynamic";
export const metadata = { title: "Product readiness" };

export default async function ProductReadinessPage() {
  const meRes = await apiFetchServer("/api/admin/me");
  if (meRes.status === 401) redirect("/staff");
  if (!meRes.ok)
    throw new Error(`Could not confirm staff session (${meRes.status})`);
  const me = (await meRes.json()) as { isPlatform: boolean };
  if (!me.isPlatform) redirect("/org");

  return (
    <>
      <StaffNav />
      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        <header className="border-b border-bg-border pb-5">
          <div className="sv-tagline">Product-to-market contract</div>
          <h1 className="mt-1 text-2xl font-semibold text-ink-50">
            What can be tested without pretending
          </h1>
          <p className="mt-2 max-w-3xl text-sm leading-relaxed text-ink-400">
            Source-wired is not the same as field-proven. This view separates
            available contracts from read-only, missing and unsafe workflows.
          </p>
        </header>

        <ReadinessView />

        <section className="mt-6 grid gap-4 md:grid-cols-2" aria-label="Staff contract boundaries">
          <article className="border border-sky-400/30 bg-sky-400/5 p-4">
            <div className="text-[11px] font-semibold uppercase tracking-normal text-sky-200">
              Support context
            </div>
            <h2 className="mt-2 text-base font-semibold text-ink-50">
              Assistance is not impersonation
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-ink-400">
              The acting Straumvakt employee and organisation scope must remain
              visible. Persisted entry, expiry and exit commands are still a
              backend dependency.
            </p>
            <button
              type="button"
              disabled
              aria-describedby="support-context-dependency"
              className="mt-4 min-h-10 border border-bg-border px-3 text-sm text-ink-500"
            >
              Enter support context
            </button>
            <p id="support-context-dependency" className="mt-2 text-xs text-ink-500">
              Requires platform.support.enter and attributed audit events.
            </p>
          </article>
          <article className="border border-amber-300/30 bg-amber-300/5 p-4">
            <div className="text-[11px] font-semibold uppercase tracking-normal text-amber-200">
              Audit and onboarding aggregate
            </div>
            <h2 className="mt-2 text-base font-semibold text-ink-50">
              Writes exist; staff reads are incomplete
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-ink-400">
              Do not infer a complete event history or aggregate onboarding
              state from separate routes. Both remain disabled until canonical
              tenant-scoped read contracts exist.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <button type="button" disabled className="min-h-10 border border-bg-border px-3 text-sm text-ink-500">
                Open audit trail
              </button>
              <button type="button" disabled className="min-h-10 border border-bg-border px-3 text-sm text-ink-500">
                Open onboarding aggregate
              </button>
            </div>
          </article>
        </section>
      </main>
    </>
  );
}
