import Link from "next/link";
import { listAllContracts } from "@/lib/repositories/contracts";
import { listOrgs } from "@/lib/repositories/organizations";
import { CreateContractForm } from "./create-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Contracts" };

export default async function ContractsPage() {
  const [contracts, orgs] = await Promise.all([listAllContracts(), listOrgs()]);
  const orgOptions = orgs.filter((o) => o.status !== "archived").map((o) => ({ id: o.id, label: `${o.displayName} (${o.slug})` }));
  const contractOptions = contracts.map((c) => ({ id: c.id, label: `${c.displayName} [${c.scopeType}]` }));

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold text-ink-50">Contracts</h1>
        <p className="mt-1 text-sm text-ink-400">
          Org-rooted contracts with scoped overrides (ADR 0008). Deepest
          scope wins; missing factors fall through to the parent. Factor
          assignments (which factor → which cost center) come next
          milestone — for now this page just creates the contract row
          itself with parent linkage.
        </p>
      </header>

      <div className="grid gap-6 md:grid-cols-[2fr_1fr]">
        <section>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-brand text-ink-300">All contracts ({contracts.length})</h2>
          {contracts.length === 0 ? (
            <div className="rounded border border-dashed border-bg-border p-6 text-center text-sm text-ink-500">No contracts yet.</div>
          ) : (
            <ul className="divide-y divide-bg-border/60 rounded-md border border-bg-border bg-bg-base/30">
              {contracts.map((c) => (
                <li key={c.id} className="px-4 py-3">
                  <div className="flex items-baseline justify-between">
                    <div>
                      <div className="text-sm font-medium text-ink-50">{c.displayName}</div>
                      <div className="text-xs text-ink-500">
                        Org: <Link className="text-sv-sky hover:underline" href={`/tenants/organizations/${c.orgId}`}>{c.orgDisplayName}</Link>
                        {" · "}<span className="font-mono">{c.scopeType}</span>
                        {c.scopeId && <span className="ml-1 font-mono text-ink-400">({c.scopeId.slice(0, 8)})</span>}
                        {c.parentContractId && <span className="ml-2 rounded bg-bg-base/40 px-1.5 py-0.5 text-[10px] text-ink-400">child of {c.parentContractId.slice(0, 8)}</span>}
                      </div>
                      <div className="mt-0.5 text-[10px] font-mono text-ink-500">
                        {c.status} · valid from {new Date(c.validFrom).toISOString().slice(0, 10)}
                        {c.validUntil && ` until ${new Date(c.validUntil).toISOString().slice(0, 10)}`}
                      </div>
                    </div>
                    <span className="font-mono text-[10px] text-ink-500">{c.id.slice(0, 8)}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <aside>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-brand text-ink-300">Create contract</h2>
          {orgOptions.length === 0 ? (
            <div className="rounded border border-amber-700/40 bg-amber-950/20 p-3 text-xs text-amber-200">Create an Organization first.</div>
          ) : (
            <CreateContractForm orgOptions={orgOptions} contractOptions={contractOptions} />
          )}
        </aside>
      </div>
    </div>
  );
}
