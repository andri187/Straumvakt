import { redirect } from "next/navigation";
import { apiFetchServer } from "@/lib/api-client-server";
import {
  PRODUCT_WORKFLOWS,
  readinessCounts,
  type ContractState,
} from "@/lib/product-readiness";
import { StaffNav } from "../staff-nav";

export const dynamic = "force-dynamic";
export const metadata = { title: "Product readiness" };

const STATE_LABEL: Record<ContractState, string> = {
  ready: "Ready",
  read_only: "Read only",
  blocked: "Backend required",
  unsafe: "Security blocked",
};

const STATE_CLASS: Record<ContractState, string> = {
  ready: "border-emerald-400/40 bg-emerald-400/10 text-emerald-200",
  read_only: "border-sky-400/40 bg-sky-400/10 text-sky-200",
  blocked: "border-amber-300/40 bg-amber-300/10 text-amber-200",
  unsafe: "border-red-400/40 bg-red-400/10 text-red-200",
};

export default async function ProductReadinessPage() {
  const meRes = await apiFetchServer("/api/admin/me");
  if (meRes.status === 401) redirect("/staff");
  if (!meRes.ok)
    throw new Error(`Could not confirm staff session (${meRes.status})`);
  const me = (await meRes.json()) as { isPlatform: boolean };
  if (!me.isPlatform) redirect("/org");

  const counts = readinessCounts();
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

        <dl className="mt-6 grid gap-px border border-bg-border bg-bg-border sm:grid-cols-4">
          {[
            ["Ready", counts.ready],
            ["Read only", counts.read_only],
            ["Backend required", counts.blocked],
            ["Security blocked", counts.unsafe],
          ].map(([label, value]) => (
            <div key={label} className="bg-bg-base p-4">
              <dt className="text-[11px] uppercase tracking-normal text-ink-500">
                {label}
              </dt>
              <dd className="mt-1 text-2xl font-semibold tabular-nums text-ink-50">
                {value}
              </dd>
            </div>
          ))}
        </dl>

        <div className="mt-6 overflow-x-auto border border-bg-border">
          <table className="w-full min-w-[48rem] text-left text-sm">
            <thead className="bg-bg-surface text-[11px] uppercase tracking-normal text-ink-500">
              <tr>
                <th className="px-4 py-3 font-medium">Surface</th>
                <th className="px-4 py-3 font-medium">Workflow</th>
                <th className="px-4 py-3 font-medium">State</th>
                <th className="px-4 py-3 font-medium">Next dependency</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-bg-border">
              {PRODUCT_WORKFLOWS.map((workflow) => (
                <tr key={workflow.id}>
                  <td className="px-4 py-3 uppercase text-ink-500">
                    {workflow.surface}
                  </td>
                  <td className="px-4 py-3 font-medium text-ink-100">
                    {workflow.label}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex border px-2 py-1 text-[11px] font-semibold ${STATE_CLASS[workflow.state]}`}
                    >
                      {STATE_LABEL[workflow.state]}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-ink-400">
                    {workflow.dependency}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </main>
    </>
  );
}
