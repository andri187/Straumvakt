import Link from "next/link";
import { apiFetchServerJson } from "@/lib/api-client-server";
import type { OrgSummary } from "@straumvakt/shared/domain/orgs";
import { CreateChargerForm } from "../create-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "New charger" };

export default async function NewChargerPage({
  searchParams,
}: {
  searchParams: Promise<{ identityString?: string }>;
}) {
  const sp = await searchParams;
  const initialIdentityString = (sp.identityString ?? "").slice(0, 64);

  const { orgs } = await apiFetchServerJson<{ orgs: OrgSummary[] }>("/api/admin/orgs");
  const orgOptions = orgs
    .filter((o) => o.status !== "archived")
    .map((o) => ({ id: o.id, label: o.kennitala ? `${o.displayName} · ${o.kennitala}` : o.displayName }));

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <Link href="/chargers" className="mb-4 inline-block text-xs text-ink-400 hover:text-sv-sky">
        ← Back to chargers
      </Link>
      <header className="mb-6 border-b border-bg-border pb-4">
        <h1 className="text-2xl font-semibold text-ink-50">New charger</h1>
        <p className="mt-1 text-sm text-ink-400">
          Creates ChargingStation + EVSE + Connector + OCPP identity in one
          transaction. The OCPP Basic-Auth password is revealed once after
          create. Required fields are marked with <span className="text-rose-400">*</span>.
        </p>
        {initialIdentityString && (
          <p className="mt-2 rounded border border-sv-sky/30 bg-sv-sky/10 px-3 py-2 text-xs text-sv-sky">
            Claiming pending discovery — identityString pre-filled with{" "}
            <code className="font-mono">{initialIdentityString}</code>. The matching
            row in <code className="font-mono">ocpp.pending_discoveries</code> is
            removed when this charger is created.
          </p>
        )}
      </header>
      {orgOptions.length === 0 ? (
        <div className="rounded border border-amber-700/40 bg-amber-950/20 p-3 text-xs text-amber-200">Create Org + Property + Site first.</div>
      ) : (
        <CreateChargerForm orgOptions={orgOptions} initialIdentityString={initialIdentityString} />
      )}
    </div>
  );
}
