import { cookies } from "next/headers";
import { Topbar } from "@/components/topbar";
import { PageShell } from "@/components/page-shell";
import { adminSessionConfig, verifyAdminSession } from "@/lib/admin-session";
import { filterByRole, loadCatalogue } from "@/lib/reference/iceland-parties";
import {
  CatalogueMissingNotice,
  PartyCard,
} from "@/components/reference/party-card";

export const metadata = { title: "Rental Service" };

export default async function RentalServicePage() {
  const jar = await cookies();
  const token = jar.get(adminSessionConfig.SESSION_COOKIE_NAME)?.value;
  const session = await verifyAdminSession(token);

  const cat = loadCatalogue();
  const parties = cat ? filterByRole(cat.parties, "home_charging") : [];

  return (
    <>
      <Topbar title="Reference · Rental Service" email={session?.email} />
      <PageShell
        title="Rental Service — Charger leasing operators"
        description="Operators who lease/sell charger hardware (home, MDU, workplace) — distinct from public CPOs. The CHRGRF cost factor anchors at the Charger and routes to the rental beneficiary via owner_org_id. Filtered from docs/reference/iceland-energy-parties.json (role=home_charging)."
      >
        {!cat ? (
          <CatalogueMissingNotice />
        ) : (
          <div className="grid gap-4">
            <section className="rounded-lg border border-bg-border bg-bg-surface/70 p-5 shadow-card backdrop-blur">
              <p className="text-sm text-ink-200">
                <strong className="text-ink-50">{parties.length}</strong>{" "}
                rental / home-charging operator
                {parties.length === 1 ? "" : "s"} in scope. CHRGRF (charger
                hardware rental fee) anchors at the Charger row — flat or
                periodic, not usage-based per ADR 0008.
              </p>
              <p className="mt-2 text-xs text-ink-400">
                When N1 leases a charger to a Krónan workplace,{" "}
                <code className="font-mono text-[11px]">
                  assets.chargers.owner_org_id
                </code>
                {" "}= N1 and the rental fee routes through the driver
                contract&apos;s CHRGRF override to whichever cost center the
                workplace designates. Issue Engine post-pilot reads{" "}
                <code className="font-mono text-[11px]">owner_org_id</code>
                {" "}for service-ticket routing — the operator runs the site,
                the owner fixes the iron.
              </p>
            </section>
            <div className="grid gap-4 sm:grid-cols-2">
              {parties.map((p) => (
                <PartyCard key={p.slug} party={p} highlightRole="home_charging" />
              ))}
            </div>
          </div>
        )}
      </PageShell>
    </>
  );
}
