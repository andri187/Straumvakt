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

export const metadata = { title: "Public Charging" };

export default async function PublicChargingPage() {
  const jar = await cookies();
  const token = jar.get(adminSessionConfig.SESSION_COOKIE_NAME)?.value;
  const session = await verifyAdminSession(token);

  const cat = loadCatalogue();
  const parties = cat ? filterByRole(cat.parties, "public_charging") : [];

  return (
    <>
      <Topbar title="Reference · Public Charging" email={session?.email} />
      <PageShell
        title="Public Charging — Icelandic CPOs"
        description="Public charging operators (CPOs) Straumvakt cares about for OCPI roaming and competitive context. Filtered from docs/reference/iceland-energy-parties.json (role=public_charging)."
      >
        <SectionTabs tabs={REFERENCE_TABS} />
        {!cat ? (
          <CatalogueMissingNotice />
        ) : (
          <div className="grid gap-4">
            <section className="rounded-lg border border-bg-border bg-bg-surface/70 p-5 shadow-card backdrop-blur">
              <p className="text-sm text-ink-200">
                <strong className="text-ink-50">{parties.length}</strong>{" "}
                public-charging operator
                {parties.length === 1 ? "" : "s"} in scope. Pilot reference
                set — competitive context. Straumvakt operates its own pilot
                site, not these. OCPI 2.2.1 CPO endpoints (Sprint 3) project
                Straumvakt&apos;s own data into the format these operators
                expect when roaming agreements light up post-pilot.
              </p>
            </section>
            <div className="grid gap-4 sm:grid-cols-2">
              {parties.map((p) => (
                <PartyCard key={p.slug} party={p} highlightRole="public_charging" />
              ))}
            </div>
          </div>
        )}
      </PageShell>
    </>
  );
}
