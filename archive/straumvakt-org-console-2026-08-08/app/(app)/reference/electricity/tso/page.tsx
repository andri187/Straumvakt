import { cookies } from "next/headers";
import { Topbar } from "@/components/topbar";
import { PageShell } from "@/components/page-shell";
import { SectionTabs, REFERENCE_TABS } from "@/components/section-tabs";
import { adminSessionConfig, verifyAdminSession } from "@/lib/admin-session";
import { filterByRole, loadCatalogue } from "@/lib/reference/iceland-parties";
import {
  CatalogueMissingNotice,
  PartyCard,
} from "@/components/reference/party-card";

export const metadata = { title: "TSO — Landsnet" };

export default async function TsoPage() {
  const jar = await cookies();
  const token = jar.get(adminSessionConfig.SESSION_COOKIE_NAME)?.value;
  const session = await verifyAdminSession(token);

  const cat = loadCatalogue();
  const parties = cat ? filterByRole(cat.parties, "tso") : [];

  return (
    <>
      <Topbar title="Reference · Electricity · TSO" email={session?.email} />
      <PageShell
        title="TSO — Landsnet"
        description="Iceland's transmission system operator. Single national TSO. No direct cost factor in pilot — Landsnet wholesale charges flow upstream to the DSO bill. Filtered from docs/reference/iceland-energy-parties.json (role=tso)."
      >
        <SectionTabs tabs={REFERENCE_TABS} />
        {!cat ? (
          <CatalogueMissingNotice />
        ) : (
          <div className="grid gap-4">
            <section className="rounded-lg border border-bg-border bg-bg-surface/70 p-5 shadow-card backdrop-blur">
              <p className="text-sm text-ink-200">
                Iceland has{" "}
                <strong className="text-ink-50">{parties.length}</strong>{" "}
                transmission system operator. All high-voltage backbone (66+
                kV) belongs to Landsnet; DSOs distribute from there.
              </p>
              <p className="mt-2 text-xs text-ink-400">
                Pilot doesn&apos;t bill TSO charges as a separate cost factor
                — Landsnet&apos;s wholesale rates flow into each DSO&apos;s
                tariff sheet upstream and are reflected in DSOF.
              </p>
            </section>
            <div className="grid gap-4 sm:grid-cols-2">
              {parties.map((p) => (
                <PartyCard key={p.slug} party={p} highlightRole="tso" />
              ))}
            </div>
          </div>
        )}
      </PageShell>
    </>
  );
}
