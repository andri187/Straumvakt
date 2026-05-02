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
        description="Mid-Sprint 3 (Identity Foundation). Scope swap recorded in ADR 0015 — the original OCPI Foundation deferred to a new Sprint 14 (post-pilot); ADR 0014 identity work substituted. Sprint 3 closes when the four closure items below check. Sprint 4 (Membership + Permissions + Data Lifecycle) is queued."
      >
        {/* Operational alert — Dalvegur unsafe-middle */}
        <div className="rounded-lg border border-rose-700/40 bg-rose-950/30 p-5 shadow-card">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 rounded bg-rose-500/30 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-brand text-rose-100">
              operational
            </span>
            <div>
              <h2 className="text-sm font-semibold text-rose-100">
                Dalvegur Authorize handler — pick a path before Sprint 3 closes
              </h2>
              <p className="mt-1 text-xs text-rose-200/90">
                Zaptec installation flipped to{" "}
                <code className="font-mono">AuthenticationType=2</code> on
                2026-05-02 for probing. Gateway DO at{" "}
                <code className="font-mono">gateway/src/identity-do.ts:218–219</code>{" "}
                returns hardcoded <code className="font-mono">Accepted</code>{" "}
                for every Authorize.req. Customers can charge today only because
                the stub default-accepts — incidental, not designed.
              </p>
              <ul className="mt-2 space-y-1 text-xs text-rose-200/90">
                <li>
                  <span className="font-semibold text-rose-100">(a)</span> Ship
                  the real <code className="font-mono">/api/internal/ocpp-authorize</code>{" "}
                  route + IdToken lookup. Per-installation{" "}
                  <code className="font-mono">enforceAuthorize</code> flag in
                  shadow mode (default false) so deployment doesn't break customers.
                </li>
                <li>
                  <span className="font-semibold text-rose-100">(b)</span> Revert
                  Dalvegur to <code className="font-mono">AuthenticationType=0</code>{" "}
                  in the Zaptec portal. Stub stays as documented; real handler
                  ships Sprint 4+.
                </li>
              </ul>
              <p className="mt-2 text-[11px] text-rose-300/70">
                Default to (b) if (a)'s design isn't approved within the
                closure window. (b) is fully reversible.
              </p>
            </div>
          </div>
        </div>

        {/* Row 1 — sprint cards */}
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <article className="rounded-lg border border-bg-border bg-bg-surface/70 p-5 shadow-card backdrop-blur">
            <h2 className="text-xs font-semibold uppercase tracking-brand text-sv-green">
              Sprint 0–2 · done
            </h2>
            <p className="mt-2 text-sm font-semibold text-ink-50">
              Foundation · OCPP · Onboarding
            </p>
            <p className="mt-1 text-xs text-ink-300">
              V3 schema · hardware catalog · gateway Worker + DOs · admin
              CRUD · Zaptec wizard · cost-center splitting · Circuit tier ·
              org/profile reshape.
              <span className="ml-1 text-ink-500">
                ADR 0001–0012.
              </span>
            </p>
          </article>

          <article className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-5 shadow-card backdrop-blur">
            <h2 className="text-xs font-semibold uppercase tracking-brand text-amber-300">
              Sprint 3 · in flight · 4 closure items
            </h2>
            <p className="mt-2 text-sm font-semibold text-ink-50">
              Identity Foundation
            </p>
            <p className="mt-1 text-xs text-ink-300">
              Schema landed (UserAudience, IdToken, UserVendorRef,
              VendorUserGroup, Vehicle). Orphan-table write paths,
              S1 events-ingest port, Authorize handler decision,
              reconciliation docs pending.
              <span className="ml-1 text-ink-500">
                ADR 0014, 0015.
              </span>
            </p>
          </article>

          <article className="rounded-lg border border-brand-500/40 bg-brand-500/10 p-5 shadow-card backdrop-blur">
            <h2 className="text-xs font-semibold uppercase tracking-brand text-sv-sky">
              Sprint 4 · queued
            </h2>
            <p className="mt-2 text-sm font-semibold text-ink-50">
              Membership + Permissions + Data Lifecycle
            </p>
            <p className="mt-1 text-xs text-ink-300">
              MembershipRole/Status enums · invite lifecycle · scope
              narrowing · PlatformGrant rename · requirePermission middleware ·
              retention classes enforced · nightly aggregation ·
              raw_protocol age-out · prod cutover for events ingest.
              <span className="ml-1 text-ink-500">ADR 0014 build-order.</span>
            </p>
          </article>

          <article className="rounded-lg border border-bg-border bg-bg-surface/70 p-5 shadow-card backdrop-blur">
            <h2 className="text-xs font-semibold uppercase tracking-brand text-ink-400">
              Sprint 5 → 13 · pilot path
            </h2>
            <p className="mt-2 text-sm font-semibold text-ink-50">
              Invite flow · Tariff · Reports · Pilot Go-Live
            </p>
            <p className="mt-1 text-xs text-ink-300">
              Driver self-registration (S5) · tariff engine (S5/6) · report
              exports (S6/7) · outbound hardening + load test (S7/8) ·
              security hardening (S9) · pilot cutover (S10).
              <span className="block mt-1 text-ink-500">
                Sprint 14 (post-pilot): OCPI Foundation re-promoted.
              </span>
            </p>
          </article>
        </div>

        {/* Row 2 — Sprint 3 closure list + ADR trail */}
        <div className="mt-6 grid gap-4 lg:grid-cols-2">
          <section className="rounded-lg border border-amber-500/30 bg-bg-surface/70 p-5 shadow-card backdrop-blur">
            <h2 className="text-xs font-semibold uppercase tracking-brand text-amber-300">
              Sprint 3 closure list · gates Sprint 4 entry
            </h2>
            <p className="mt-1 text-[11px] text-ink-400">
              All four must check before Sprint 4 may begin. See{" "}
              <code className="font-mono text-ink-300">
                docs/retros/sprint-03.md
              </code>
              .
            </p>
            <ol className="mt-3 space-y-3 text-sm text-ink-200">
              <li className="flex gap-2">
                <span className="mt-0.5 text-amber-300">1.</span>
                <div>
                  <p className="font-medium text-ink-50">
                    Orphan-table write paths
                  </p>
                  <p className="text-xs text-ink-300">
                    <code className="font-mono text-ink-400">IdToken</code>,{" "}
                    <code className="font-mono text-ink-400">UserVendorRef</code>,{" "}
                    <code className="font-mono text-ink-400">Vehicle</code>{" "}
                    each get one repo write path. Admin form at{" "}
                    <code className="font-mono text-ink-400">/people/users/[id]</code>{" "}
                    attaches RFID + vehicle inline. VendorUserGroup deferred
                    to Sprint 4.
                  </p>
                  <p className="mt-1 text-[11px] italic text-ink-500">
                    ~half a day. Hand-tested round trip.
                  </p>
                </div>
              </li>
              <li className="flex gap-2">
                <span className="mt-0.5 text-amber-300">2.</span>
                <div>
                  <p className="font-medium text-ink-50">
                    Sprint S1 — events-ingest port
                  </p>
                  <p className="text-xs text-ink-300">
                    <code className="font-mono text-ink-400">/api/ocpp/events</code>{" "}
                    moves from UI Worker to{" "}
                    <code className="font-mono text-ink-400">apps/api</code>,
                    renamed{" "}
                    <code className="font-mono text-ink-400">/api/internal/ocpp-events</code>.
                    Gateway URL update + UI route deletion in same change.
                    Atomic deploy. Production cutover deferred to Sprint 4.
                  </p>
                  <p className="mt-1 text-[11px] italic text-ink-500">
                    2–3 hours per gbtNotes. Smoke: lastSeenAt ticks, status
                    flips, ChargeSession appears on StartTransaction.
                  </p>
                </div>
              </li>
              <li className="flex gap-2">
                <span className="mt-0.5 text-amber-300">3.</span>
                <div>
                  <p className="font-medium text-ink-50">
                    OCPP Authorize handler — real or revert
                  </p>
                  <p className="text-xs text-ink-300">
                    Pick path (a) ship real lookup with shadow-mode flag, or
                    (b) revert Dalvegur to anonymous. The unsafe middle
                    (auth required + stub gateway) closes either way.
                  </p>
                  <p className="mt-1 text-[11px] italic text-ink-500">
                    Operational priority — see alert above. Decide day one
                    of closure window.
                  </p>
                </div>
              </li>
              <li className="flex gap-2">
                <span className="mt-0.5 text-amber-300">4.</span>
                <div>
                  <p className="font-medium text-ink-50">
                    Reconciliation docs · committed
                  </p>
                  <p className="text-xs text-ink-300">
                    ADR 0015 · delivery plan §6 rewrite · this dashboard ·
                    sprint-03 retro. Drafted 2026-05-02. ADR 0014 needs a
                    forward-reference line to ADR 0015. All committed on the
                    working branch.
                  </p>
                  <p className="mt-1 text-[11px] italic text-ink-500">
                    Drafted; commit pending operator sign-off (Rule 1).
                  </p>
                </div>
              </li>
            </ol>
          </section>

          <section className="rounded-lg border border-bg-border bg-bg-surface/70 p-5 shadow-card backdrop-blur">
            <h2 className="text-xs font-semibold uppercase tracking-brand text-sv-sky">
              ADR trail · most-recent first
            </h2>
            <ul className="mt-3 space-y-2 text-sm text-ink-200">
              <li>
                <span className="font-mono text-xs text-amber-300">0015</span>{" "}
                <span className="font-medium">Sprint 3 scope swap</span>
                <span className="ml-2 text-xs text-ink-400">
                  OCPI deferred to new Sprint 14 · ADR 0014 substituted ·
                  gbtNotes S1 absorbed
                </span>
              </li>
              <li>
                <span className="font-mono text-xs text-amber-300">0014</span>{" "}
                <span className="font-medium">
                  Identity, Tenancy, Authorization
                </span>
                <span className="ml-2 text-xs text-ink-400">
                  4-layer model · UserAudience · MembershipRole ·
                  PlatformGrant · permission catalogue
                </span>
              </li>
              <li>
                <span className="font-mono text-xs text-sv-green">0013</span>{" "}
                <span className="font-medium">
                  Five-tier topology — Pages + Workers + DOs + Queues + Neon
                </span>
                <span className="ml-2 text-xs text-ink-400">
                  apps/api stood up · UI Worker thinning out · Prisma WASM
                  unblocked
                </span>
              </li>
              <li>
                <span className="font-mono text-xs text-sv-green">0012</span>{" "}
                <span className="font-medium">
                  Protocol-neutral physical model
                </span>
                <span className="ml-2 text-xs text-ink-400">
                  EVSE/Connector anchored · OCPP/OEM-API/OCPI all overlay this
                </span>
              </li>
              <li>
                <span className="font-mono text-xs text-sv-green">0011</span>{" "}
                <span className="font-medium">Control-plane optionality</span>
                <span className="ml-2 text-xs text-ink-400">
                  external CPMS overlay · imported sessions/CDRs as authority
                </span>
              </li>
              <li>
                <span className="font-mono text-xs text-ink-400">0010</span>{" "}
                <span className="font-medium">
                  Org/User profile enrichment
                </span>
                <span className="ml-2 text-xs text-ink-400">
                  21-value OrganizationRole · kennitala · multi-role
                </span>
              </li>
              <li>
                <span className="font-mono text-xs text-ink-400">0008</span>{" "}
                <span className="font-medium">Cost-center splitting</span>
                <span className="ml-2 text-xs text-ink-400">
                  inherited contracts · cost-factor catalogue · driver
                  contracts · kWh-cap accumulators
                </span>
              </li>
              <li>
                <span className="font-mono text-xs text-ink-500">
                  0001–0007
                </span>{" "}
                <span className="font-medium">Foundation set</span>
                <span className="ml-2 text-xs text-ink-400">
                  V3 schema · hardware catalog · pilot scope rev 1+2 ·
                  Service Binding · Circuit tier
                </span>
              </li>
            </ul>
          </section>
        </div>

        {/* Row 3 — current state snapshot + design references */}
        <div className="mt-6 grid gap-4 lg:grid-cols-2">
          <section className="rounded-lg border border-bg-border bg-bg-surface/70 p-5 shadow-card backdrop-blur">
            <h2 className="text-xs font-semibold uppercase tracking-brand text-sv-sky">
              Current state · 2026-05-02
            </h2>
            <dl className="mt-3 space-y-2 text-sm text-ink-200">
              <div className="flex gap-3">
                <dt className="w-32 shrink-0 text-xs uppercase tracking-brand text-ink-400">
                  Branch
                </dt>
                <dd className="font-mono text-xs text-ink-50">staging</dd>
              </div>
              <div className="flex gap-3">
                <dt className="w-32 shrink-0 text-xs uppercase tracking-brand text-ink-400">
                  Pilot site
                </dt>
                <dd>
                  Dalvegur 10–14 · 20 chargers · OcppCloudUrl points at{" "}
                  <code className="font-mono text-xs text-ink-300">
                    straumvakt-ocpp-staging
                  </code>
                </dd>
              </div>
              <div className="flex gap-3">
                <dt className="w-32 shrink-0 text-xs uppercase tracking-brand text-ink-400">
                  Auth state
                </dt>
                <dd className="text-rose-200">
                  AuthenticationType=2 (auth required) + stub gateway —
                  unsafe middle, see alert
                </dd>
              </div>
              <div className="flex gap-3">
                <dt className="w-32 shrink-0 text-xs uppercase tracking-brand text-ink-400">
                  Events ingest
                </dt>
                <dd className="text-amber-200">
                  Staging 404s post-Boot (S1 not yet shipped) · production
                  works
                </dd>
              </div>
              <div className="flex gap-3">
                <dt className="w-32 shrink-0 text-xs uppercase tracking-brand text-ink-400">
                  Identity tables
                </dt>
                <dd>
                  DDL landed · IdToken / UserVendorRef / Vehicle have no
                  write paths (orphan)
                </dd>
              </div>
              <div className="flex gap-3">
                <dt className="w-32 shrink-0 text-xs uppercase tracking-brand text-ink-400">
                  Zaptec API ceiling
                </dt>
                <dd>
                  ROPC tier · 15-user charge-history slice via{" "}
                  <code className="font-mono text-xs text-ink-300">
                    DetailLevel=1
                  </code>{" "}
                  · /api/Users 403 · full ~50-user list portal-only
                </dd>
              </div>
              <div className="flex gap-3">
                <dt className="w-32 shrink-0 text-xs uppercase tracking-brand text-ink-400">
                  Drift recorded
                </dt>
                <dd>
                  ADR 0015 + delivery plan §6 + sprint-03 retro drafted ·
                  awaiting commit
                </dd>
              </div>
            </dl>
          </section>

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
                  ADR 0008 · 8 cost factors · driver-contract routing
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
                  Phase-banded · what defers (tags A–F) · stale on Sprint 3 swap
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
              <li className="border-t border-bg-border/60 pt-2">
                <p className="text-xs uppercase tracking-brand text-ink-400">
                  gbtNotes (working set)
                </p>
                <p className="mt-1 text-xs text-ink-300">
                  <code className="font-mono">
                    scale-to-4000-chargers-sprint-plan.md
                  </code>{" "}
                  · review · ocpp-ingest gap-check · review · two
                  architecture SVGs. Sx numbering reconciled into delivery
                  Sprints 3–11 per ADR 0015.
                </p>
              </li>
            </ul>
          </section>
        </div>

        {/* Row 4 — pilot framing (unchanged) */}
        <div className="mt-6">
          <section className="rounded-lg border border-bg-border bg-bg-surface/70 p-5 shadow-card backdrop-blur">
            <h2 className="text-xs font-semibold uppercase tracking-brand text-sv-sky">
              Pilot framing
            </h2>
            <p className="mt-3 text-sm text-ink-200">
              Admin-functionality only. No driver-facing surface. No money
              movement during the 30-day pilot window. Drivers exist as inert
              admin-created records mapped to RFID idTags, with the polymorphic
              IdToken table from ADR 0014 carrying the lookup for both today's
              manual entry and tomorrow's OCPP-flip-driven discovery.
            </p>
            <p className="mt-2 text-sm text-ink-200">
              Three concepts kept distinct on every charger:{" "}
              <span className="text-sv-green">owner</span> (hardware),{" "}
              <span className="text-sv-sky">operator</span> (org_id, runs
              sessions),{" "}
              <span className="text-amber-300">payer</span> (resolved at
              session-stop via contract chain). ADR 0014 adds a fourth axis:{" "}
              <span className="text-ink-50">audience</span> (operator vs
              driver), discriminated on the User row.
            </p>
            <p className="mt-2 text-xs text-ink-400">
              You are signed in{email ? ` as ${email}` : ""}. Operator console
              wires up over Sprints 3–4 — the closure list above is the queue.
            </p>
          </section>
        </div>
      </PageShell>
    </>
  );
}
