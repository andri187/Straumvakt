import { cookies } from "next/headers";
import { Topbar } from "@/components/topbar";
import { PageShell } from "@/components/page-shell";
import { adminSessionConfig, verifyAdminSession } from "@/lib/admin-session";

export const metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  const jar = await cookies();
  const token = jar.get(adminSessionConfig.SESSION_COOKIE_NAME)?.value;
  const session = await verifyAdminSession(token);
  const email = session?.email;

  return (
    <>
      <Topbar title="Dashboard" email={email} />
      <PageShell
        title="Straumvakt"
        description="Foundation rev 4 — admin-functionality only. Sprints 0 + 1 in (1.5 staging deploy pending). Sprint 2 — Admin Onboarding + Zaptec + Cost-Center Splitting + Profile Enrichment (ADRs 0007-0010) — is next. ChargerHost dropped; Property attaches to Org directly."
      >
        {/* Row 1 — sprint cards */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <article className="rounded-lg border border-bg-border bg-bg-surface/70 p-5 shadow-card backdrop-blur">
            <h2 className="text-xs font-semibold uppercase tracking-brand text-sv-green">
              Sprint 0 · done
            </h2>
            <p className="mt-2 text-sm font-semibold text-ink-50">
              Foundation schema
            </p>
            <p className="mt-1 text-xs text-ink-300">
              18 V3 Postgres schemas, tenant-scoped repositories, event log,
              money as BIGINT minor units, hardware catalog seeded.
              <span className="ml-1 text-ink-500">ADR 0001–0003.</span>
            </p>
          </article>

          <article className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-5 shadow-card backdrop-blur">
            <h2 className="text-xs font-semibold uppercase tracking-brand text-amber-300">
              Sprint 1 · 1.1–1.4 done · 1.5 pending
            </h2>
            <p className="mt-2 text-sm font-semibold text-ink-50">
              OCPP foundation
            </p>
            <p className="mt-1 text-xs text-ink-300">
              Gateway Worker, per-identity DOs, event-log-first ingest via
              Service Binding, outbox dispatcher.
              <span className="ml-1 text-ink-500">ADR 0004.</span>
              <span className="block mt-1 text-amber-300/80">
                1.5 = staging deploy + real charger smoke test (operator action).
              </span>
            </p>
          </article>

          <article className="rounded-lg border border-brand-500/40 bg-brand-500/10 p-5 shadow-card backdrop-blur">
            <h2 className="text-xs font-semibold uppercase tracking-brand text-sv-sky">
              Sprint 2 · next · 13 milestones
            </h2>
            <p className="mt-2 text-sm font-semibold text-ink-50">
              Admin Onboarding + Zaptec + Cost-Center Splitting
            </p>
            <p className="mt-1 text-xs text-ink-300">
              2.1–2.9 admin CRUD + Zaptec OAuth wizard + Circuit (ADR 0007).
              2.10–2.13 add cost-factor catalog, inherited contracts, driver
              contracts, kWh-cap accumulators (ADR 0008).
            </p>
          </article>

          <article className="rounded-lg border border-bg-border bg-bg-surface/70 p-5 shadow-card backdrop-blur">
            <h2 className="text-xs font-semibold uppercase tracking-brand text-ink-400">
              Sprints 3 → 10 · future
            </h2>
            <p className="mt-2 text-sm font-semibold text-ink-50">
              OCPI · Data lifecycle · Money math · Pilot
            </p>
            <p className="mt-1 text-xs text-ink-300">
              CPO endpoints. Then retention machinery. Sprint 5 tariff engine
              becomes the resolver. Sprint 6 dashboard splits by cost center.
              Driver experience + Issue Engine = post-pilot (ADR 0006).
            </p>
          </article>
        </div>

        {/* Row 2 — state + recent decisions */}
        <div className="mt-6 grid gap-4 lg:grid-cols-2">
          <section className="rounded-lg border border-amber-500/30 bg-bg-surface/70 p-5 shadow-card backdrop-blur">
            <h2 className="text-xs font-semibold uppercase tracking-brand text-amber-300">
              Closing Sprint 1 · before Sprint 2 starts
            </h2>
            <ul className="mt-3 space-y-2 text-sm text-ink-200">
              <li className="flex gap-2">
                <span className="text-amber-300">○</span>
                <span>
                  <span className="font-medium text-ink-50">
                    Walk the 1.5 staging-deploy runbook
                  </span>{" "}
                  — gateway + main-app deployed; real charger heartbeat,
                  config round-trip, RemoteStop, zero-energy CDR all green
                  on staging.
                  <span className="ml-1 text-ink-500">
                    Operator action; needs Windows symlink unblocked first.
                  </span>
                </span>
              </li>
              <li className="flex gap-2">
                <span className="text-amber-300">○</span>
                <span>
                  <span className="font-medium text-ink-50">
                    File the Sprint 1 retro
                  </span>{" "}
                  — done; <code className="font-mono text-xs text-ink-300">docs/retros/sprint-01.md</code>{" "}
                  written. Update with the runbook outcome after walk-through.
                </span>
              </li>
              <li className="flex gap-2">
                <span className="text-amber-300">○</span>
                <span>
                  <span className="font-medium text-ink-50">
                    Commit the rev-3 doc bundle
                  </span>{" "}
                  — ADRs 0006 / 0007 / 0008, delivery plan rev 3, sprint task
                  lists, architecture canon §6/§10 amendments, README, dashboard
                  copy, three SVGs in <code className="font-mono text-xs text-ink-300">public/</code>.
                </span>
              </li>
              <li className="flex gap-2">
                <span className="text-amber-300">○</span>
                <span>
                  <span className="font-medium text-ink-50">
                    Rotate the leaked admin password
                  </span>{" "}
                  — was committed in <code className="font-mono text-xs text-ink-300">21247f9</code>{" "}
                  (already pushed). Plaintext redacted in working copy. Rotate via
                  <code className="font-mono text-xs text-ink-300">
                    {" "}wrangler secret put ADMIN_PASSWORD --env staging
                  </code>.
                </span>
              </li>
            </ul>
          </section>

          <section className="rounded-lg border border-bg-border bg-bg-surface/70 p-5 shadow-card backdrop-blur">
            <h2 className="text-xs font-semibold uppercase tracking-brand text-sv-sky">
              Recent decisions · ADR trail
            </h2>
            <ul className="mt-3 space-y-2 text-sm text-ink-200">
              <li>
                <span className="font-mono text-xs text-sv-green">0010</span>{" "}
                <span className="font-medium">Org/User profile enrichment + multi-role + OCPP config keys</span>
                <span className="ml-2 text-xs text-ink-400">
                  21-value OrganizationRole · kennitala · iceland-energy-parties as real Org rows
                </span>
              </li>
              <li>
                <span className="font-mono text-xs text-sv-green">0009</span>{" "}
                <span className="font-medium">Drop ChargerHost tier</span>
                <span className="ml-2 text-xs text-ink-400">
                  Property attaches to Org directly · HostType → Site.site_type · multi-role makes Host vestigial
                </span>
              </li>
              <li>
                <span className="font-mono text-xs text-sv-green">0008</span>{" "}
                <span className="font-medium">Cost-center splitting</span>
                <span className="ml-2 text-xs text-ink-400">
                  inherited contracts · runtime cost-factor catalog · driver
                  contracts · kWh-cap accumulators
                </span>
              </li>
              <li>
                <span className="font-mono text-xs text-sv-green">0007</span>{" "}
                <span className="font-medium">Circuit asset tier back</span>
                <span className="ml-2 text-xs text-ink-400">
                  Site → [Installation] → [Circuit] → Charger; additive 2.6
                </span>
              </li>
              <li>
                <span className="font-mono text-xs text-sv-green">0006</span>{" "}
                <span className="font-medium">Pilot scope rev 2</span>
                <span className="ml-2 text-xs text-ink-400">
                  admin-only pilot · Driver Experience + Issue Engine
                  post-pilot · new Sprints 2 + 4
                </span>
              </li>
              <li>
                <span className="font-mono text-xs text-ink-400">0005</span>{" "}
                <span className="font-medium">Pilot scope rev 1</span>
                <span className="ml-2 text-xs text-ink-400">
                  6 topical groups (A–F) deferred to post-pilot
                </span>
              </li>
              <li>
                <span className="font-mono text-xs text-ink-400">0004</span>{" "}
                <span className="font-medium">
                  OCPP transport via Service Binding
                </span>
                <span className="ml-2 text-xs text-ink-400">
                  constant-time secret header (no HMAC over public internet)
                </span>
              </li>
              <li>
                <span className="font-mono text-xs text-ink-500">0001–0003</span>{" "}
                <span className="font-medium">Sprint 0 foundation set</span>
                <span className="ml-2 text-xs text-ink-400">
                  V3 schema · hardware catalog + installations · no CPMS
                  backfill
                </span>
              </li>
            </ul>
          </section>
        </div>

        {/* Row 3 — design references + pilot framing */}
        <div className="mt-6 grid gap-4 lg:grid-cols-2">
          <section className="rounded-lg border border-bg-border bg-bg-surface/70 p-5 shadow-card backdrop-blur">
            <h2 className="text-xs font-semibold uppercase tracking-brand text-sv-sky">
              Design references
            </h2>
            <ul className="mt-3 space-y-2 text-sm text-ink-200">
              <li>
                <a
                  href="/cost_center_splitting_model.svg"
                  target="_blank"
                  rel="noreferrer"
                  className="text-sv-green hover:text-sv-sky"
                >
                  Cost-center splitting model
                </a>
                <span className="ml-2 text-xs text-ink-400">
                  ADR 0008 · 8 cost factors · inherited contracts · driver-contract
                  routing · 4 worked scenarios
                </span>
              </li>
              <li>
                <a
                  href="/straumvakt_roadmap.svg"
                  target="_blank"
                  rel="noreferrer"
                  className="text-sv-green hover:text-sv-sky"
                >
                  Pilot roadmap (rev 2)
                </a>
                <span className="ml-2 text-xs text-ink-400">
                  Phase-banded · what ships in pilot · what defers (tags A–F)
                </span>
              </li>
              <li>
                <a
                  href="/entity_relationships.svg"
                  target="_blank"
                  rel="noreferrer"
                  className="text-sv-green hover:text-sv-sky"
                >
                  Entity relationships
                </a>
                <span className="ml-2 text-xs text-ink-400">
                  People-side · hardware-side · charge session as the binding row
                </span>
              </li>
              <li>
                <a
                  href="/data-model.svg"
                  target="_blank"
                  rel="noreferrer"
                  className="text-sv-green hover:text-sv-sky"
                >
                  Data model map
                </a>
                <span className="ml-2 text-xs text-ink-400">
                  Every Postgres namespace and its tables in one frame
                </span>
              </li>
            </ul>
          </section>

          <section className="rounded-lg border border-bg-border bg-bg-surface/70 p-5 shadow-card backdrop-blur">
            <h2 className="text-xs font-semibold uppercase tracking-brand text-sv-sky">
              Pilot framing
            </h2>
            <p className="mt-3 text-sm text-ink-200">
              Admin-functionality only. No driver-facing surface. No money
              movement during the 30-day pilot window. Drivers exist as inert
              admin-created records mapped to RFID idTags.
            </p>
            <p className="mt-2 text-sm text-ink-200">
              Three concepts kept distinct on every charger: <span className="text-sv-green">owner</span>{" "}
              (hardware), <span className="text-sv-sky">operator</span>{" "}
              (org_id, runs sessions), <span className="text-amber-300">payer</span>{" "}
              (resolved at session-stop via contract chain).
            </p>
            <p className="mt-2 text-xs text-ink-400">
              You are signed in{email ? ` as ${email}` : ""}. Operator console
              wires up over Sprint 2 — list pages and detail views appear as
              each milestone lands.
            </p>
          </section>
        </div>
      </PageShell>
    </>
  );
}
