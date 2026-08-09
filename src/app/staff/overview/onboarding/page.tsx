import Link from "next/link";
import type { Route } from "next";
import { redirect } from "next/navigation";
import { apiFetchServer } from "@/lib/api-client-server";
import { StaffNav } from "../staff-nav";

export const dynamic = "force-dynamic";
export const metadata = { title: "Onboarding queue" };

type Me = { isPlatform: boolean };
type HostApplication = {
  id: string;
  companyName: string;
  contactName: string;
  siteType: string;
  status: "new" | "in_review" | "offered" | "won" | "lost";
  createdAt: string;
  sites: unknown[];
};

const STATUS_LABEL: Record<HostApplication["status"], string> = {
  new: "New",
  in_review: "In review",
  offered: "Offer sent",
  won: "Accepted",
  lost: "Closed",
};

export default async function StaffOnboardingPage() {
  const meRes = await apiFetchServer("/api/admin/me");
  if (meRes.status === 401) redirect("/staff");
  if (!meRes.ok)
    throw new Error(`Could not confirm staff session (${meRes.status})`);
  const me = (await meRes.json()) as Me;
  if (!me.isPlatform) redirect("/org");

  const response = await apiFetchServer("/api/admin/host-applications");
  const items = response.ok
    ? (((await response.json()) as { items: HostApplication[] }).items ?? [])
    : [];

  return (
    <>
      <StaffNav />
      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        <div className="flex flex-wrap items-end justify-between gap-4 border-b border-bg-border pb-5">
          <div>
            <div className="sv-tagline">Customer onboarding</div>
            <h1 className="mt-1 text-2xl font-semibold text-ink-50">
              Application queue
            </h1>
          </div>
          <span className="text-xs tabular-nums text-ink-500">
            {items.length} applications
          </span>
        </div>
        {!response.ok ? (
          <p className="mt-6 border border-bg-border px-4 py-8 text-sm text-ink-400">
            The onboarding queue is unavailable (HTTP {response.status}).
          </p>
        ) : items.length === 0 ? (
          <p className="mt-6 border border-bg-border px-4 py-10 text-center text-sm text-ink-500">
            No organisation applications are waiting.
          </p>
        ) : (
          <div className="mt-6 overflow-x-auto border border-bg-border">
            <table className="w-full min-w-[46rem] text-left text-sm">
              <thead className="bg-bg-surface text-[11px] uppercase tracking-wider text-ink-500">
                <tr>
                  <th className="px-4 py-3 font-medium">Organisation</th>
                  <th className="px-4 py-3 font-medium">Contact</th>
                  <th className="px-4 py-3 font-medium">Sites</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 text-right font-medium">Opened</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-bg-border">
                {items.map((item) => (
                  <tr key={item.id}>
                    <td className="px-4 py-3">
                      <Link
                        href={`/staff/overview/onboarding/${item.id}` as Route}
                        className="font-medium text-brand-300 underline underline-offset-2"
                      >
                        {item.companyName}
                      </Link>
                      <div className="mt-0.5 text-xs text-ink-500">
                        {item.siteType}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-ink-300">
                      {item.contactName}
                    </td>
                    <td className="px-4 py-3 tabular-nums text-ink-300">
                      {item.sites.length}
                    </td>
                    <td className="px-4 py-3 text-ink-300">
                      {STATUS_LABEL[item.status]}
                    </td>
                    <td className="px-4 py-3 text-right text-ink-500">
                      {new Date(item.createdAt).toLocaleDateString("en-GB")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </>
  );
}
