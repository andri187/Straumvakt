import { cookies } from "next/headers";
import { Topbar } from "@/components/topbar";
import { PageShell } from "@/components/page-shell";
import { adminSessionConfig, verifyAdminSession } from "@/lib/admin-session";
import { filterByRole, loadCatalogue } from "@/lib/reference/iceland-parties";
import {
  CatalogueMissingNotice,
  PartyCard,
} from "@/components/reference/party-card";

export const metadata = { title: "Electricity — Retailers" };

export default async function RetailersPage() {
  const jar = await cookies();
  const token = jar.get(adminSessionConfig.SESSION_COOKIE_NAME)?.value;
  const session = await verifyAdminSession(token);

  const cat = loadCatalogue();
  const parties = cat ? filterByRole(cat.parties, "retailer") : [];

  return (
    <>
      <Topbar title="Reference · Electricity · Retailers" email={session?.email} />
      <PageShell
        title="Electricity — Retailers"
        description="Icelandic söluaðilar. The REPF cost factor anchors at the installation level — siblings on the same site can be on different retailers. Filtered from docs/reference/iceland-energy-parties.json (role=retailer)."
      >
        {!cat ? (
          <CatalogueMissingNotice />
        ) : (
          <div className="grid gap-4">
            <section className="rounded-lg border border-bg-border bg-bg-surface/70 p-5 shadow-card backdrop-blur">
              <p className="text-sm text-ink-200">
                <strong className="text-ink-50">{parties.length}</strong>{" "}
                electricity retailer{parties.length === 1 ? "" : "s"} in
                scope. Each installation in V3 attaches to one retailer via{" "}
                <code className="font-mono text-xs">
                  properties.installations.retailer_tariff_id
                </code>
                {" "}(per ADR 0008). The tariff engine evaluates the linked{" "}
                <code className="font-mono text-xs">tariff_definition.compute_rule</code>
                {" "}at session-stop.
              </p>
            </section>
            <div className="grid gap-4 sm:grid-cols-2">
              {parties.map((p) => (
                <PartyCard key={p.slug} party={p} highlightRole="retailer" />
              ))}
            </div>
          </div>
        )}
      </PageShell>
    </>
  );
}
