import Link from "next/link";
import { notFound } from "next/navigation";
import { SectionTabs, OPERATIONS_TABS } from "@/components/section-tabs";
import { getCircuitById, listInstallationsBySite } from "@/lib/repositories/circuits";
import { EditCircuitPanel } from "./edit-panel";

export const dynamic = "force-dynamic";

export default async function CircuitDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const circuit = await getCircuitById(id);
  if (!circuit) notFound();
  const installations = await listInstallationsBySite(circuit.siteId);

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
        }}
      />
    </div>
  );
}
