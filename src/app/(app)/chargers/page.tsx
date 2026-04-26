import Link from "next/link";
import { listAllChargers } from "@/lib/repositories/chargers";
import { listOrgs } from "@/lib/repositories/organizations";
import { CreateChargerForm } from "./create-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Chargers" };

export default async function ChargersPage() {
  const [chargers, orgs] = await Promise.all([listAllChargers(), listOrgs()]);
  const orgOptions = orgs.filter((o) => o.status !== "archived").map((o) => ({ id: o.id, label: `${o.displayName} (${o.slug})` }));

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold text-ink-50">Chargers</h1>
        <p className="mt-1 text-sm text-ink-400">
          Each row creates ChargingStation + EVSE + Connector + OCPP
          identity in one transaction. The OCPP Basic-Auth password is
          revealed once after create.
        </p>
      </header>

      <div className="grid gap-6 md:grid-cols-[2fr_1fr]">
        <section>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-brand text-ink-300">All chargers ({chargers.length})</h2>
          {chargers.length === 0 ? (
            <div className="rounded border border-dashed border-bg-border p-6 text-center text-sm text-ink-500">No chargers yet.</div>
          ) : (
            <ul className="divide-y divide-bg-border/60 rounded-md border border-bg-border bg-bg-base/30">
              {chargers.map((c) => (
                <li key={c.chargingStationId} className="px-4 py-3">
                  <div className="flex items-baseline justify-between">
                    <div>
                      <div className="text-sm font-medium text-ink-50">{c.identityString}</div>
                      <div className="text-xs text-ink-500">
                        {c.orgDisplayName} · {c.siteDisplayName}
                        {c.vendor && c.model && <> · <span className="text-ink-300">{c.vendor} {c.model}</span></>}
                      </div>
                      <div className="mt-0.5 text-[10px] font-mono text-ink-500">{c.ocppVersion} · {c.connectorType}{c.serialNumber && ` · ${c.serialNumber}`}</div>
                    </div>
                    <span className="font-mono text-[10px] text-ink-500">{c.chargingStationId.slice(0, 8)}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <aside>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-brand text-ink-300">Create charger</h2>
          {orgOptions.length === 0 ? (
            <div className="rounded border border-amber-700/40 bg-amber-950/20 p-3 text-xs text-amber-200">Create Org + Property + Site first.</div>
          ) : (
            <CreateChargerForm orgOptions={orgOptions} />
          )}
        </aside>
      </div>
    </div>
  );
}
