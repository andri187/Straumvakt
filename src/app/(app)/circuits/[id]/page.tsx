import Link from "next/link";
import { notFound } from "next/navigation";
import { SectionTabs, OPERATIONS_TABS } from "@/components/section-tabs";
import { apiFetchServer, apiFetchServerJson } from "@/lib/api-client-server";
import type { CircuitSummary } from "@straumvakt/shared/domain/circuits";
import { DeleteButton } from "@/components/delete-button";
import { EditCircuitPanel } from "./edit-panel";

export const dynamic = "force-dynamic";

export default async function CircuitDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const detailRes = await apiFetchServer(`/api/admin/circuits/${id}`);
  if (detailRes.status === 404) notFound();
  if (!detailRes.ok) throw new Error(`HTTP ${detailRes.status}`);
  const { circuit } = (await detailRes.json()) as { circuit: CircuitSummary };
  const { installations } = await apiFetchServerJson<{
    installations: { id: string; displayName: string }[];
  }>(`/api/admin/sites/${circuit.siteId}/installations`);

  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      <SectionTabs tabs={OPERATIONS_TABS} />
      <Link href="/circuits" className="mb-4 inline-block text-xs text-ink-400 hover:text-sv-sky">
        ← Back to circuits
      </Link>
      <header className="mb-6 border-b border-bg-border pb-4">
        <h1 className="text-2xl font-semibold text-ink-50">{circuit.displayName}</h1>
        <p className="mt-1 text-sm text-ink-400">
          Org <Link href={`/tenants/organizations/${circuit.orgId}`} className="text-sv-sky hover:underline">{circuit.orgDisplayName}</Link>
          {" · "}Site <span className="text-ink-300">{circuit.siteDisplayName}</span>
          {circuit.installationDisplayName && <> · Installation <span className="text-ink-300">{circuit.installationDisplayName}</span></>}
        </p>
        <p className="mt-1 font-mono text-[10px] text-ink-500">{circuit.id}</p>
      </header>

      <EditCircuitPanel
        circuitId={circuit.id}
        installationOptions={installations}
        initial={{
          displayName: circuit.displayName,
          installationId: circuit.installationId ?? "",
          ampereCeiling: circuit.ampereCeiling?.toString() ?? "",
          phaseCount: circuit.phaseCount.toString(),
          vendorCircuitRef: circuit.vendorCircuitRef ?? "",
          metadataJson:
            circuit.metadata && Object.keys(circuit.metadata as Record<string, unknown>).length > 0
              ? JSON.stringify(circuit.metadata, null, 2)
              : "",
        }}
      />

      <section className="mt-8 rounded-lg border border-rose-700/30 bg-rose-950/10 p-4">
        <div className="flex items-baseline justify-between gap-4">
          <div>
            <h2 className="text-sm font-semibold text-rose-200">Danger zone</h2>
            <p className="mt-1 text-xs text-rose-300/80">
              Deleting this circuit removes ALL chargers physically anchored to it
              (per operator policy). Site + installation are preserved.
            </p>
          </div>
          <DeleteButton
            endpoint={`/api/admin/circuits/${circuit.id}`}
            redirectTo="/circuits"
            confirmText={`Delete circuit "${circuit.displayName}" and ALL chargers on it? This cannot be undone.`}
            label="Delete circuit"
          />
        </div>
      </section>
    </div>
  );
}
