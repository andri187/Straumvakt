import { cookies } from "next/headers";
import { Topbar } from "@/components/topbar";
import { PageShell } from "@/components/page-shell";
import { adminSessionConfig, verifyAdminSession } from "@/lib/admin-session";
import { filterByRole, loadCatalogue } from "@/lib/reference/iceland-parties";
import {
  CatalogueMissingNotice,
  PartyCard,
} from "@/components/reference/party-card";

export const metadata = { title: "DSO — Distribution System Operators" };

export default async function DsoPage() {
  const jar = await cookies();
  const token = jar.get(adminSessionConfig.SESSION_COOKIE_NAME)?.value;
  const session = await verifyAdminSession(token);

  const cat = loadCatalogue();
  const parties = cat ? filterByRole(cat.parties, "dso") : [];

  return (
    <>
      <Topbar title="Reference · Electricity · DSO" email={session?.email} />
      <PageShell
        title="DSO — Distribution System Operators"
        description="Icelandic dreifiveitur. The DSOF cost factor anchors at the site level — one site, one DSO. Filtered from docs/reference/iceland-energy-parties.json (role=dso)."
      >
        {!cat ? (
          <CatalogueMissingNotice />
        ) : (
          <div className="grid gap-4">
            <section className="rounded-lg border border-bg-border bg-bg-surface/70 p-5 shadow-card backdrop-blur">
              <p className="text-sm text-ink-200">
                <strong className="text-ink-50">{parties.length}</strong>{" "}
                distribution system operator
                {parties.length === 1 ? "" : "s"} in scope. Each site in V3
                attaches to exactly one DSO via{" "}
                <code className="font-mono text-xs">
                  properties.sites.dso_tariff_id
                </code>
                {" "}(per ADR 0008). Pilot sites are inside Veitur&apos;s
                Reykjavík metro footprint by default.
              </p>
            </section>
            <div className="grid gap-4 sm:grid-cols-2">
              {parties.map((p) => (
                <PartyCard key={p.slug} party={p} highlightRole="dso" />
              ))}
            </div>
          </div>
        )}
      </PageShell>
    </>
  );
}
