import Link from "next/link";
import type { Route } from "next";
import { notFound, redirect } from "next/navigation";
import { apiFetchServer } from "@/lib/api-client-server";
import { StaffNav } from "../../staff-nav";

export const dynamic = "force-dynamic";
type Params = { id: string };
type Me = { isPlatform: boolean };
type HostApplication = {
  id: string;
  companyName: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string | null;
  siteType: string;
  status: "new" | "in_review" | "offered" | "won" | "lost";
  createdAt: string;
  sites: unknown[];
};
const FLOW = ["new", "in_review", "offered", "won"] as const;
const LABELS: Record<(typeof FLOW)[number], string> = {
  new: "Application received",
  in_review: "Review",
  offered: "Offer",
  won: "Accepted",
};

export default async function StaffOnboardingDetailPage({
  params,
}: {
  params: Promise<Params>;
}) {
  const meRes = await apiFetchServer("/api/admin/me");
  if (meRes.status === 401) redirect("/staff");
  if (!meRes.ok)
    throw new Error(`Could not confirm staff session (${meRes.status})`);
  const me = (await meRes.json()) as Me;
  if (!me.isPlatform) redirect("/org");
  const { id } = await params;
  const response = await apiFetchServer(`/api/admin/host-applications/${id}`);
  if (response.status === 404) notFound();
  if (!response.ok)
    throw new Error(`Could not load application (${response.status})`);
  const { application } = (await response.json()) as {
    application: HostApplication;
  };
  const current =
    application.status === "lost" ? -1 : FLOW.indexOf(application.status);
  return (
    <>
      <StaffNav />
      <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
        <Link
          href={"/staff/overview/onboarding" as Route}
          className="text-xs text-brand-300 underline underline-offset-2"
        >
          Back to onboarding
        </Link>
        <header className="mt-5 border-b border-bg-border pb-5">
          <div className="sv-tagline">Organisation application</div>
          <h1 className="mt-1 text-2xl font-semibold text-ink-50">
            {application.companyName}
          </h1>
          <p className="mt-2 text-sm text-ink-400">
            {application.contactName} | {application.contactEmail}
            {application.contactPhone ? ` | ${application.contactPhone}` : ""}
          </p>
        </header>
        {application.status === "lost" ? (
          <p className="mt-6 border-l-2 border-red-400 bg-red-400/10 px-4 py-3 text-sm text-ink-200">
            This application is closed.
          </p>
        ) : null}
        <ol className="mt-8 grid gap-0 md:grid-cols-4">
          {FLOW.map((step, index) => {
            const state =
              index < current
                ? "complete"
                : index === current
                  ? "current"
                  : "waiting";
            return (
              <li
                key={step}
                className="border border-bg-border p-4 md:border-r-0 md:last:border-r"
              >
                <span
                  className={`text-[10px] font-semibold uppercase tracking-wider ${state === "current" ? "text-brand-300" : "text-ink-500"}`}
                >
                  {state}
                </span>
                <div className="mt-2 text-sm font-medium text-ink-100">
                  {LABELS[step]}
                </div>
              </li>
            );
          })}
        </ol>
        <section className="mt-8 border border-bg-border">
          <div className="grid gap-px bg-bg-border sm:grid-cols-3">
            <div className="bg-bg-base p-4">
              <div className="text-[11px] uppercase tracking-wider text-ink-500">
                Site type
              </div>
              <div className="mt-1 text-sm text-ink-100">
                {application.siteType}
              </div>
            </div>
            <div className="bg-bg-base p-4">
              <div className="text-[11px] uppercase tracking-wider text-ink-500">
                Sites supplied
              </div>
              <div className="mt-1 text-sm tabular-nums text-ink-100">
                {application.sites.length}
              </div>
            </div>
            <div className="bg-bg-base p-4">
              <div className="text-[11px] uppercase tracking-wider text-ink-500">
                Received
              </div>
              <div className="mt-1 text-sm text-ink-100">
                {new Date(application.createdAt).toLocaleDateString("en-GB")}
              </div>
            </div>
          </div>
        </section>
      </main>
    </>
  );
}
