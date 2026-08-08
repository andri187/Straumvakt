// Where a Straumvakt employee lands after signing in at /staff.
//
// The brief for this page was "a real page for this persona, not another
// placeholder", so it answers the two questions an employee actually has on
// arrival, in that order:
//
//   1. What is waiting on me?     — host applications nobody has answered,
//                                   chargers knocking on the gateway with no
//                                   credentials, installations that were
//                                   provisioned but never got a credential
//                                   ref (the failure mode that reads as
//                                   "charger not linked" in the field).
//   2. What is the estate doing?  — sessions live right now, and the
//                                   cross-tenant org / installation / charger
//                                   counts no customer can see.
//
// Everything here is read live from endpoints that already exist in
// apps/api — nothing was added or changed there. Each panel loads
// independently through load() and degrades to a stated reason on failure,
// because these endpoints are individually permission-gated: a session with
// partial scope should see the parts it is allowed to see, not a 500.
//
// The persona gate matters more than the data. POST /api/admin/login answers
// identically for platform staff (Path A, env secret + PlatformGrant) and for
// an org operator (Path B, UserCredential), so the only place the difference
// becomes visible is GET /api/admin/me. If someone without platform scope
// gets this far, they are told plainly and pointed at the org entrance —
// rather than being shown a console where every panel 403s.

import { apiFetchServer } from "@/lib/api-client-server";
import { SignOutButton } from "./sign-out-button";

export const dynamic = "force-dynamic";
export const metadata = { title: "Platform overview" };

// ── API shapes (subset — only the fields this page renders) ────────────────

type Me = {
  email: string;
  role: string;
  userId: string | null;
  persona: "operator" | "host_admin" | "member" | "none";
  isPlatform: boolean;
  orgs: { orgId: string; displayName: string; kind: string; role: string }[];
};

type HostApplication = {
  id: string;
  companyName: string;
  contactName: string;
  siteType: string;
  sites: unknown[];
  createdAt: string;
};

type PendingDiscovery = {
  identityString: string;
  firstSeenAt: string;
  lastSeenAt: string;
  attemptCount: number;
  remoteAddr: string | null;
};

type ActiveSession = {
  chargingStationId: string;
  orgId: string;
  orgDisplayName: string | null;
  siteDisplayName: string | null;
  chargerDisplayName: string | null;
  identityString: string | null;
  startedAt: string;
  lastObservedAt: string;
  lastOperationMode: string | null;
  lastPowerW: number | null;
  lastSessionEnergyWh: number | null;
};

type Org = {
  id: string;
  displayName: string;
  kind: string;
  status: string;
  countryCode: string | null;
};

type Installation = {
  id: string;
  orgId: string;
  displayName: string;
  orgDisplayName: string;
  vendorSlug: string | null;
  credentialsRef: string | null;
  onboardingStatus: string;
};

type Charger = {
  siteAssetId: string;
  orgId: string;
  vendor: string | null;
};

// ── Loading ────────────────────────────────────────────────────────────────

type Loaded<T> = { ok: true; data: T } | { ok: false; reason: string };

/**
 * One GET, never throwing. A 403 here is a legitimate answer ("this session
 * lacks that permission"), not an error worth taking the whole page down for,
 * so the reason is carried into the panel and rendered.
 */
async function load<T>(path: string): Promise<Loaded<T>> {
  try {
    const res = await apiFetchServer(path);
    if (!res.ok) return { ok: false, reason: `HTTP ${res.status}` };
    return { ok: true, data: (await res.json()) as T };
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error ? err.message : "could not reach the API",
    };
  }
}

// ── Formatting ─────────────────────────────────────────────────────────────

function ago(iso: string, now: number): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "—";
  const secs = Math.max(0, Math.round((now - then) / 1000));
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function kw(watts: number | null): string {
  if (watts == null) return "—";
  return `${(watts / 1000).toFixed(1)} kW`;
}

// ── Small presentational pieces ────────────────────────────────────────────

function Panel({
  title,
  meta,
  children,
}: {
  title: string;
  meta?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-bg-border bg-bg-surface/70">
      <div className="flex items-baseline justify-between gap-3 border-b border-bg-border px-4 py-3">
        <h2 className="text-xs font-semibold uppercase tracking-widest text-ink-300">
          {title}
        </h2>
        {meta ? (
          <span className="shrink-0 text-[11px] tabular-nums text-ink-500">{meta}</span>
        ) : null}
      </div>
      {children}
    </section>
  );
}

function Unavailable({ reason }: { reason: string }) {
  return (
    <p className="px-4 py-6 text-xs text-ink-500">
      Not available to this session — <span className="text-ink-400">{reason}</span>
    </p>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="px-4 py-6 text-xs text-ink-500">{children}</p>;
}

/** Headline number for a queue panel. Amber once it is non-zero — these are all "someone must act". */
function QueueCount({ n, unit }: { n: number; unit: string }) {
  return (
    <div className="flex items-baseline gap-2 px-4 pt-4">
      <span
        className={`text-3xl font-semibold tabular-nums ${
          n > 0 ? "text-amber-300" : "text-ink-400"
        }`}
      >
        {n}
      </span>
      <span className="text-xs text-ink-400">{unit}</span>
    </div>
  );
}

function Stat({ n, label, sub }: { n: string; label: string; sub?: string }) {
  return (
    <div className="border-b border-r border-bg-border px-4 py-3 last:border-r-0">
      <div className="text-2xl font-semibold tabular-nums text-ink-50">{n}</div>
      <div className="mt-0.5 text-[11.5px] leading-tight text-ink-400">{label}</div>
      {sub ? <div className="text-[11px] text-ink-500">{sub}</div> : null}
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────

export default async function StaffOverviewPage() {
  const me = await load<Me>("/api/admin/me");

  // Deliberately not a redirect back to /staff. Middleware verifies the
  // cookie with the UI Worker's secret and this endpoint verifies it with the
  // API Worker's — if those two drift (the failure the /api/admin/me endpoint
  // was introduced to fix), redirecting would bounce between the two forever.
  // Say what happened instead.
  if (!me.ok) {
    return (
      <Centered title="Your session could not be confirmed.">
        <p>
          The cookie reached this page but{" "}
          <code className="text-ink-200">GET /api/admin/me</code> rejected it —{" "}
          <span className="text-ink-200">{me.reason}</span>.
        </p>
        <p className="mt-3">
          Signing in again usually clears it. If it does not, the UI and API
          Workers are holding different <code className="text-ink-200">AUTH_SECRET</code>{" "}
          values.
        </p>
        <p className="mt-5">
          <a className="text-brand-300 underline underline-offset-2" href="/staff">
            Back to the staff entrance
          </a>
        </p>
      </Centered>
    );
  }

  // Signed in, but not Straumvakt staff — Path B of the login endpoint. The
  // credentials were valid; the door was wrong.
  if (!me.data.isPlatform) {
    return (
      <Centered title="This entrance is for Straumvakt staff.">
        <p>
          You are signed in as{" "}
          <span className="text-ink-100">{me.data.email}</span>, but the account
          carries no platform grant
          {me.data.orgs.length > 0
            ? ` — it belongs to ${me.data.orgs
                .map((o) => o.displayName)
                .join(", ")}.`
            : "."}
        </p>
        <p className="mt-3">
          Nothing is wrong with your password. Your organisation&rsquo;s own
          view lives at the main entrance.
        </p>
        <p className="mt-5 flex items-center gap-4">
          <a className="text-brand-300 underline underline-offset-2" href="/">
            Go to straumvakt.org
          </a>
          <SignOutButton />
        </p>
      </Centered>
    );
  }

  const [applications, discoveries, sessions, orgs, installations, chargers] =
    await Promise.all([
      load<{ items: HostApplication[] }>("/api/admin/host-applications?status=new"),
      load<{ pending: PendingDiscovery[] }>("/api/admin/pending-discoveries"),
      load<{ sessions: ActiveSession[]; count: number; fetchedAt: string }>(
        "/api/admin/active-sessions",
      ),
      load<{ orgs: Org[] }>("/api/admin/orgs"),
      load<{ installations: Installation[] }>("/api/admin/installations"),
      load<{ chargers: Charger[] }>("/api/admin/chargers"),
    ]);

  const now = Date.now();

  // Installations that exist but have no credential reference. These are the
  // ones that look "not linked" from the field — the charger is provisioned,
  // the vendor integration has nothing to authenticate with.
  const uncredentialed = installations.ok
    ? installations.data.installations.filter((i) => i.credentialsRef === null)
    : [];

  const chargersByOrg = new Map<string, number>();
  if (chargers.ok) {
    for (const c of chargers.data.chargers) {
      chargersByOrg.set(c.orgId, (chargersByOrg.get(c.orgId) ?? 0) + 1);
    }
  }
  const installsByOrg = new Map<string, number>();
  if (installations.ok) {
    for (const i of installations.data.installations) {
      installsByOrg.set(i.orgId, (installsByOrg.get(i.orgId) ?? 0) + 1);
    }
  }
  const vendors = chargers.ok
    ? new Set(chargers.data.chargers.map((c) => c.vendor).filter(Boolean)).size
    : 0;

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-8 sm:px-6">
      {/* ── Who you are ───────────────────────────────────────────────── */}
      <header className="flex flex-wrap items-end justify-between gap-4 border-b border-bg-border pb-5">
        <div>
          <div className="sv-tagline">Platform operations</div>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-ink-50">
            Everything, across every tenant
          </h1>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-right">
            <div className="text-sm text-ink-100">{me.data.email}</div>
            <div className="text-[11px] uppercase tracking-wider text-ink-500">
              {me.data.persona}
              {me.data.userId === null ? " · bootstrap account" : ""}
            </div>
          </div>
          <SignOutButton />
        </div>
      </header>

      {/* ── 1. What is waiting on a person ────────────────────────────── */}
      <div>
        <h2 className="mb-3 text-sm font-semibold text-ink-100">Waiting on someone</h2>
        <div className="grid gap-4 lg:grid-cols-3">
          <Panel title="Host applications" meta="status: new">
            {!applications.ok ? (
              <Unavailable reason={applications.reason} />
            ) : applications.data.items.length === 0 ? (
              <Empty>Nothing unanswered.</Empty>
            ) : (
              <>
                <QueueCount n={applications.data.items.length} unit="unanswered" />
                <ul className="mt-3 divide-y divide-bg-border/70 border-t border-bg-border">
                  {applications.data.items.slice(0, 4).map((a) => (
                    <li key={a.id} className="px-4 py-2.5">
                      <div className="truncate text-[13px] text-ink-100">
                        {a.companyName}
                      </div>
                      <div className="mt-0.5 text-[11px] text-ink-500">
                        {a.siteType} · {a.sites.length}{" "}
                        {a.sites.length === 1 ? "site" : "sites"} ·{" "}
                        {ago(a.createdAt, now)}
                      </div>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </Panel>

          <Panel title="Knocking, no credentials" meta="pre-onboarding pool">
            {!discoveries.ok ? (
              <Unavailable reason={discoveries.reason} />
            ) : discoveries.data.pending.length === 0 ? (
              <Empty>No unknown chargers on the gateway.</Empty>
            ) : (
              <>
                <QueueCount n={discoveries.data.pending.length} unit="identities" />
                <ul className="mt-3 divide-y divide-bg-border/70 border-t border-bg-border">
                  {discoveries.data.pending.slice(0, 4).map((p) => (
                    <li key={p.identityString} className="px-4 py-2.5">
                      <div className="truncate font-mono text-[12.5px] text-ink-100">
                        {p.identityString}
                      </div>
                      <div className="mt-0.5 text-[11px] text-ink-500">
                        {p.attemptCount} attempts · last {ago(p.lastSeenAt, now)}
                        {p.remoteAddr ? ` · ${p.remoteAddr}` : ""}
                      </div>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </Panel>

          <Panel title="Installations with no credential" meta="reads as “not linked”">
            {!installations.ok ? (
              <Unavailable reason={installations.reason} />
            ) : uncredentialed.length === 0 ? (
              <Empty>Every installation has a credential reference.</Empty>
            ) : (
              <>
                <QueueCount n={uncredentialed.length} unit="installations" />
                <ul className="mt-3 divide-y divide-bg-border/70 border-t border-bg-border">
                  {uncredentialed.slice(0, 4).map((i) => (
                    <li key={i.id} className="px-4 py-2.5">
                      <div className="truncate text-[13px] text-ink-100">
                        {i.displayName}
                      </div>
                      <div className="mt-0.5 truncate text-[11px] text-ink-500">
                        {i.orgDisplayName} · {i.vendorSlug ?? "no vendor"} ·{" "}
                        {i.onboardingStatus}
                      </div>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </Panel>
        </div>
      </div>

      {/* ── 2. What is happening right now ────────────────────────────── */}
      <Panel
        title="Charging right now"
        meta={
          sessions.ok
            ? `${sessions.data.count} live · read ${ago(sessions.data.fetchedAt, now)}`
            : undefined
        }
      >
        {!sessions.ok ? (
          <Unavailable reason={sessions.reason} />
        ) : sessions.data.sessions.length === 0 ? (
          <Empty>No active sessions anywhere on the platform.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[46rem] text-left text-[13px]">
              <thead>
                <tr className="text-[11px] uppercase tracking-wider text-ink-500">
                  <th className="px-4 py-2 font-medium">Charger</th>
                  <th className="px-4 py-2 font-medium">Site</th>
                  <th className="px-4 py-2 font-medium">Organisation</th>
                  <th className="px-4 py-2 font-medium">Mode</th>
                  <th className="px-4 py-2 text-right font-medium">Power</th>
                  <th className="px-4 py-2 text-right font-medium">Energy</th>
                  <th className="px-4 py-2 text-right font-medium">Started</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-bg-border/70 border-t border-bg-border">
                {sessions.data.sessions.slice(0, 12).map((s) => (
                  <tr key={s.chargingStationId}>
                    <td className="px-4 py-2.5 text-ink-100">
                      {s.chargerDisplayName ?? (
                        <span className="font-mono text-[12px] text-ink-400">
                          {s.identityString ?? s.chargingStationId}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-ink-300">
                      {s.siteDisplayName ?? "—"}
                    </td>
                    <td className="px-4 py-2.5 text-ink-300">
                      {s.orgDisplayName ?? "—"}
                    </td>
                    <td className="px-4 py-2.5 text-ink-400">
                      {s.lastOperationMode ?? "—"}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-ink-100">
                      {kw(s.lastPowerW)}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-ink-300">
                      {s.lastSessionEnergyWh != null
                        ? `${(s.lastSessionEnergyWh / 1000).toFixed(1)} kWh`
                        : "—"}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-ink-400">
                      {ago(s.startedAt, now)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {sessions.data.sessions.length > 12 ? (
              <p className="border-t border-bg-border px-4 py-2 text-[11px] text-ink-500">
                Showing 12 of {sessions.data.sessions.length}.
              </p>
            ) : null}
          </div>
        )}
      </Panel>

      {/* ── 3. The estate ─────────────────────────────────────────────── */}
      <Panel title="The estate" meta="cross-tenant">
        <div className="grid grid-cols-2 sm:grid-cols-4">
          <Stat
            n={orgs.ok ? String(orgs.data.orgs.length) : "—"}
            label="organisations"
            sub={
              orgs.ok
                ? `${orgs.data.orgs.filter((o) => o.status === "active").length} active`
                : orgs.reason
            }
          />
          <Stat
            n={installations.ok ? String(installations.data.installations.length) : "—"}
            label="installations"
            sub={
              installations.ok
                ? `${uncredentialed.length} without a credential`
                : installations.reason
            }
          />
          <Stat
            n={chargers.ok ? String(chargers.data.chargers.length) : "—"}
            label="chargers"
            sub={chargers.ok ? `${vendors} vendor(s)` : chargers.reason}
          />
          <Stat
            n={sessions.ok ? String(sessions.data.count) : "—"}
            label="charging now"
            sub={sessions.ok ? undefined : sessions.reason}
          />
        </div>

        {!orgs.ok ? (
          <Unavailable reason={orgs.reason} />
        ) : orgs.data.orgs.length === 0 ? (
          <Empty>No organisations yet.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[40rem] text-left text-[13px]">
              <thead>
                <tr className="text-[11px] uppercase tracking-wider text-ink-500">
                  <th className="px-4 py-2 font-medium">Organisation</th>
                  <th className="px-4 py-2 font-medium">Kind</th>
                  <th className="px-4 py-2 font-medium">Country</th>
                  <th className="px-4 py-2 text-right font-medium">Installations</th>
                  <th className="px-4 py-2 text-right font-medium">Chargers</th>
                  <th className="px-4 py-2 text-right font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-bg-border/70 border-t border-bg-border">
                {orgs.data.orgs.map((o) => (
                  <tr key={o.id}>
                    <td className="px-4 py-2.5 text-ink-100">{o.displayName}</td>
                    <td className="px-4 py-2.5 text-ink-400">{o.kind}</td>
                    <td className="px-4 py-2.5 text-ink-400">{o.countryCode ?? "—"}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-ink-300">
                      {installations.ok ? (installsByOrg.get(o.id) ?? 0) : "—"}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-ink-300">
                      {chargers.ok ? (chargersByOrg.get(o.id) ?? 0) : "—"}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <span
                        className={`rounded px-1.5 py-0.5 text-[11px] ${
                          o.status === "active"
                            ? "bg-emerald-500/10 text-emerald-300"
                            : "bg-ink-700/60 text-ink-400"
                        }`}
                      >
                        {o.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <footer className="pb-4 text-[11px] leading-relaxed text-ink-500">
        Platform-staff view · read live on every request, nothing cached ·
        organisations sign in at{" "}
        <a className="text-ink-400 underline underline-offset-2" href="/">
          straumvakt.org
        </a>
        <br />
        Panels that say “not available to this session” are permission
        boundaries on individual endpoints, not outages.
      </footer>
    </div>
  );
}

/** Full-height single message — used for the two states that are not the overview. */
function Centered({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-lg rounded-2xl border border-bg-border bg-bg-surface/90 p-8 shadow-card">
        <h1 className="text-lg font-semibold text-ink-50">{title}</h1>
        <div className="mt-3 text-sm leading-relaxed text-ink-300">{children}</div>
      </div>
    </div>
  );
}
