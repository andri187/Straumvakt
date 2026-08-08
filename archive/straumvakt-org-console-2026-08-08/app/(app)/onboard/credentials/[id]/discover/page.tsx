import Link from "next/link";
import { notFound } from "next/navigation";
import { SectionTabs, ONBOARD_TABS } from "@/components/section-tabs";
import { apiFetchServerJson } from "@/lib/api-client-server";
import type { VendorCredentialProbe } from "@straumvakt/shared/domain/vendor-credential-probe";
import { DiscoverTree } from "./discover-tree";

export const dynamic = "force-dynamic";
export const metadata = { title: "Onboard · Discover chargers" };

// Sprint 9 — PROBE-2 discovery surface. Server component that POSTs the
// /probe endpoint on load, then hands the response to the client tree
// component for display. The probe is strictly read-only; the
// "Attach to this credential" + "Onboard whole installation" buttons
// live on the client surface but are gated to PROBE-3 / PROBE-4 wiring
// (disabled with a "Coming soon" hint).

export default async function DiscoverCredentialPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  let probe: VendorCredentialProbe;
  try {
    const res = await apiFetchServerJson<{ probe: VendorCredentialProbe }>(
      `/api/admin/vendor-credentials/${id}/probe`,
      { method: "POST" },
    );
    probe = res.probe;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("credential_not_found")) notFound();
    return (
      <div className="mx-auto max-w-6xl px-6 py-8">
        <SectionTabs tabs={ONBOARD_TABS} />
        <div className="rounded border border-rose-500/40 bg-rose-950/20 p-6 text-sm text-rose-200">
          <p className="font-medium">Could not run discovery</p>
          <p className="mt-2 font-mono text-xs">{msg}</p>
          <p className="mt-4">
            <Link
              href={
                `/onboard/credentials/${id}/manage` as Parameters<
                  typeof Link
                >[0]["href"]
              }
              className="text-sv-sky hover:underline"
            >
              ← Back to credential
            </Link>
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <SectionTabs tabs={ONBOARD_TABS} />
      <header className="mb-6">
        <div className="flex items-center gap-2 text-xs text-ink-500">
          <Link href="/onboard/credentials" className="hover:text-sv-sky">
            Credentials
          </Link>
          <span>/</span>
          <Link
            href={
              `/onboard/credentials/${probe.credential.id}/manage` as Parameters<
                typeof Link
              >[0]["href"]
            }
            className="font-mono hover:text-sv-sky"
          >
            {probe.credential.username}
          </Link>
          <span>/</span>
          <span>Discover</span>
        </div>
        <h1 className="mt-1 text-2xl font-semibold text-ink-50">
          Discover available chargers
        </h1>
        <p className="mt-1 text-sm text-ink-400">
          Live inventory of every installation + charger this credential can see in
          Zaptec, cross-referenced against our DB. Read-only — no changes happen
          until you click an action below. Refresh the page to re-probe Zaptec.
        </p>
      </header>

      <DiscoverTree credentialId={probe.credential.id} initialProbe={probe} />
    </div>
  );
}
