import { cookies } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Topbar } from "@/components/topbar";
import { PageShell } from "@/components/page-shell";
import { adminSessionConfig, verifyAdminSession } from "@/lib/admin-session";
import { apiFetchServer, apiFetchServerJson } from "@/lib/api-client-server";
import type {
  IdTokenSummary,
  UserSummary,
  UserMembershipSummary,
} from "@straumvakt/shared/domain/users";
import type { OrgSummary } from "@straumvakt/shared/domain/orgs";
import { UserEditPanel } from "./edit-panel";
import { MembershipsPanel } from "./memberships-panel";
import { TokensPanel } from "./tokens-panel";

export const metadata = { title: "User detail" };

interface AgreementMembershipRow {
  membershipId: string;
  driverGroupId: string;
  driverGroupDisplayName: string;
  agreementId: string;
  agreementType: "service_cpo" | "installation";
  agreementDisplayName: string;
  agreementStatus: "draft" | "active" | "expired";
  installationId: string | null;
  installationDisplayName: string | null;
  counterpartyOrgDisplayName: string;
  effectiveFrom: string;
  effectiveUntil: string | null;
  addedAt: string;
}

function StatusPill({ status }: { status: string }) {
  const tone =
    status === "active"
      ? "bg-emerald-500/15 text-emerald-200 ring-emerald-500/30"
      : status === "suspended"
        ? "bg-amber-500/15 text-amber-200 ring-amber-500/30"
        : "bg-rose-500/15 text-rose-200 ring-rose-500/30";
  return (
    <span
      className={`rounded px-1.5 py-0.5 font-semibold uppercase tracking-brand ring-1 ring-inset ${tone}`}
    >
      {status}
    </span>
  );
}

function CountPill({
  label,
  count,
  muted,
}: {
  label: string;
  count: number;
  muted?: string | null;
}) {
  return (
    <span className="rounded bg-bg-base/60 px-1.5 py-0.5 ring-1 ring-inset ring-bg-border">
      <span className="font-mono text-ink-100">{count}</span>{" "}
      <span className="text-ink-400">{label}</span>
      {muted && <span className="ml-1 text-ink-500">({muted})</span>}
    </span>
  );
}

function CredentialsPill({ hasCredentials }: { hasCredentials: boolean }) {
  if (hasCredentials) {
    return (
      <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-emerald-200 ring-1 ring-inset ring-emerald-500/30">
        password set
      </span>
    );
  }
  return (
    <span
      title="Pilot inert record (ADR 0006) — no sign-in"
      className="rounded bg-bg-base/60 px-1.5 py-0.5 text-ink-400 ring-1 ring-inset ring-bg-border"
    >
      inert
    </span>
  );
}

function KV({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex gap-2">
      <dt className="text-ink-500">{label}</dt>
      <dd className="text-ink-200">{value}</dd>
    </div>
  );
}

// User.address is stored as a freeform JSONB; the edit panel works
// with the conventional street/city/postalCode/countryCode shape but
// tolerates extras (they'll round-trip through patch.address as-is).
function addressInitial(raw: unknown): {
  street: string;
  city: string;
  postalCode: string;
  countryCode: string;
} {
  if (!raw || typeof raw !== "object") {
    return { street: "", city: "", postalCode: "", countryCode: "" };
  }
  const a = raw as Record<string, unknown>;
  const s = (k: string) => (typeof a[k] === "string" ? (a[k] as string) : "");
  return {
    street: s("street"),
    city: s("city"),
    postalCode: s("postalCode"),
    countryCode: s("countryCode") || "IS",
  };
}

type TabKey = "profile" | "agreements";

export default async function UserDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const jar = await cookies();
  const token = jar.get(adminSessionConfig.SESSION_COOKIE_NAME)?.value;
  const session = await verifyAdminSession(token);

  const { id } = await params;
  const sp = await searchParams;
  const tab: TabKey = sp.tab === "agreements" ? "agreements" : "profile";
  const detailRes = await apiFetchServer(`/api/admin/users/${id}`);
  if (detailRes.status === 404) notFound();
  if (!detailRes.ok) throw new Error(`HTTP ${detailRes.status}`);
  // idTokens was added in Sprint 3 closure item 1; default to [] so an
  // older API deploy that doesn't include the field still renders.
  const detail = (await detailRes.json()) as {
    user: UserSummary;
    memberships: UserMembershipSummary[];
    idTokens?: IdTokenSummary[];
    agreementMemberships?: AgreementMembershipRow[];
  };
  const { user, memberships } = detail;
  const idTokens = detail.idTokens ?? [];
  const agreementMemberships = detail.agreementMemberships ?? [];
  const { orgs } = await apiFetchServerJson<{ orgs: OrgSummary[] }>(
    "/api/admin/orgs",
  );

  const memberOrgIds = new Set(memberships.map((m) => m.orgId));
  const availableOrgs = orgs.filter((o) => !memberOrgIds.has(o.id));

  return (
    <>
      <Topbar
        title={`People · ${user.email}`}
        email={session?.email}
      />
      <PageShell title={user.displayName ?? user.email}>
        <div className="mb-3 text-xs text-ink-400">
          <Link href="/people/users" className="hover:text-ink-50">
            ← All users
          </Link>
        </div>

        <div className="space-y-4">
          <section className="rounded-lg border border-bg-border bg-bg-surface/70 px-5 py-4 shadow-card backdrop-blur">
            <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
              <div className="min-w-0">
                <h1 className="truncate text-base font-semibold text-ink-50">
                  {user.displayName ?? user.email}
                </h1>
                <p className="truncate font-mono text-xs text-ink-400">{user.email}</p>
              </div>
              <div className="flex flex-wrap items-center gap-1.5 text-[10px]">
                <StatusPill status={user.status} />
                <CountPill
                  label="agreements"
                  count={agreementMemberships.filter((m) => m.agreementStatus === "active").length}
                  muted={
                    agreementMemberships.length >
                    agreementMemberships.filter((m) => m.agreementStatus === "active").length
                      ? `${agreementMemberships.length} total`
                      : null
                  }
                />
                <CountPill label="memberships" count={memberships.length} />
                <CountPill
                  label="RFIDs"
                  count={idTokens.filter((t) => t.status === "active").length}
                  muted={idTokens.length > idTokens.filter((t) => t.status === "active").length
                    ? `${idTokens.length} total`
                    : null}
                />
                <CredentialsPill hasCredentials={user.hasCredentials} />
              </div>
            </div>
            <dl className="mt-3 grid gap-x-4 gap-y-0.5 border-t border-bg-border/40 pt-3 text-[11px] sm:grid-cols-2 lg:grid-cols-4">
              <KV label="ID" value={<span className="font-mono">{user.id.slice(0, 8)}…</span>} />
              <KV label="Kennitala" value={user.kennitala ?? "—"} />
              <KV label="Phone" value={user.phone ?? "—"} />
              <KV label="Created" value={new Date(user.createdAt).toLocaleDateString()} />
            </dl>
            <details className="mt-3 border-t border-bg-border/40 pt-3">
              <summary className="cursor-pointer text-[11px] font-medium text-sv-sky hover:text-sv-sky/80">
                Edit profile fields →
              </summary>
              <div className="mt-3">
                <UserEditPanel
                  userId={user.id}
                  initial={{
                    email: user.email,
                    displayName: user.displayName ?? "",
                    status: user.status,
                    kennitala: user.kennitala ?? "",
                    phone: user.phone ?? "",
                    locale: user.locale,
                    notes: user.notes ?? "",
                    firstName: user.firstName ?? "",
                    middleName: user.middleName ?? "",
                    lastName: user.lastName ?? "",
                    dateOfBirth: user.dateOfBirth ?? "",
                    photoUrl: user.photoUrl ?? "",
                    address: addressInitial(user.address),
                  }}
                />
              </div>
            </details>
          </section>

          {/* Tab nav — switches the panes below. Header card above
              stays visible on both tabs as the "identity card". */}
          <nav className="flex items-stretch gap-1 border-b border-bg-border">
            <TabLink
              href={`/people/users/${user.id}` as Parameters<typeof Link>[0]["href"]}
              label="Profile"
              count={memberships.length + idTokens.filter((t) => t.status === "active").length}
              active={tab === "profile"}
            />
            <TabLink
              href={`/people/users/${user.id}?tab=agreements` as Parameters<typeof Link>[0]["href"]}
              label="Agreements"
              count={agreementMemberships.filter((m) => m.agreementStatus === "active").length}
              active={tab === "agreements"}
            />
          </nav>

          {/* ADR 0019 A.8 — agreement memberships (driver-side access)
              Distinct from "Memberships" panel (OrgMembership / admin
              role within an Org). This section shows the installations
              / CPOs the driver actually has charging access at, via
              DriverGroup → Agreement. */}
          {tab === "agreements" && (
          <section className="rounded-lg border border-bg-border bg-bg-surface/70 shadow-card backdrop-blur">
            <h2 className="border-b border-bg-border/60 px-5 py-2 text-[11px] font-semibold uppercase tracking-brand text-ink-300">
              Agreement access{" "}
              <span className="text-ink-500">· {agreementMemberships.length}</span>
            </h2>
            {agreementMemberships.length === 0 ? (
              <p className="px-5 py-6 text-center text-xs italic text-ink-500">
                No agreement memberships — this driver cannot charge anywhere
                under the new agreements model. Add them to a DriverGroup via
                the agreement detail page (or via the seed scripts during
                pilot).
              </p>
            ) : (
              <ul className="divide-y divide-bg-border/40">
                {agreementMemberships.map((m) => (
                  <li key={m.membershipId} className="px-5 py-3 hover:bg-bg-raised/30">
                    <div className="flex flex-wrap items-baseline justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <Link
                          href={`/agreements/${m.agreementId}` as Parameters<typeof Link>[0]["href"]}
                          className="text-sm font-medium text-ink-100 hover:text-sv-sky"
                        >
                          {m.agreementDisplayName}
                        </Link>
                        <p className="mt-0.5 text-[11px] text-ink-400">
                          <span
                            className={
                              "rounded px-1.5 py-0.5 font-mono text-[10px] font-medium ring-1 ring-inset " +
                              (m.agreementType === "service_cpo"
                                ? "bg-sv-sky/15 text-sv-sky ring-sv-sky/30"
                                : "bg-emerald-400/15 text-emerald-300 ring-emerald-400/30")
                            }
                          >
                            {m.agreementType}
                          </span>
                          <span className="ml-2">{m.counterpartyOrgDisplayName}</span>
                          {m.installationDisplayName && (
                            <span className="ml-2 text-ink-500">· {m.installationDisplayName}</span>
                          )}
                        </p>
                        <p className="mt-0.5 text-[10px] text-ink-500">
                          Group: <span className="text-ink-400">{m.driverGroupDisplayName}</span>
                        </p>
                      </div>
                      <div className="text-right">
                        <span
                          className={
                            "rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-brand ring-1 ring-inset " +
                            (m.agreementStatus === "active"
                              ? "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30"
                              : m.agreementStatus === "draft"
                                ? "bg-amber-500/15 text-amber-300 ring-amber-500/30"
                                : "bg-bg-raised/60 text-ink-400 ring-bg-border")
                          }
                        >
                          {m.agreementStatus}
                        </span>
                        <p className="mt-1 text-[10px] text-ink-500">
                          since {new Date(m.addedAt).toLocaleDateString("is-IS")}
                        </p>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
          )}

          {tab === "profile" && (
          <>
          <section className="rounded-lg border border-bg-border bg-bg-surface/70 shadow-card backdrop-blur">
            <h2 className="border-b border-bg-border/60 px-5 py-2 text-[11px] font-semibold uppercase tracking-brand text-ink-300">
              Memberships <span className="text-ink-500">· {memberships.length}</span>
            </h2>
            <MembershipsPanel
              userId={user.id}
              memberships={memberships}
              availableOrgs={availableOrgs.map((o) => ({
                id: o.id,
                kennitala: o.kennitala,
                displayName: o.displayName,
              }))}
            />
          </section>

          <section className="rounded-lg border border-bg-border bg-bg-surface/70 shadow-card backdrop-blur">
            <h2 className="border-b border-bg-border/60 px-5 py-2 text-[11px] font-semibold uppercase tracking-brand text-ink-300">
              RFID tokens{" "}
              <span className="text-ink-500">
                · {idTokens.filter((t) => t.status === "active").length} active
                {idTokens.length !== idTokens.filter((t) => t.status === "active").length &&
                  ` / ${idTokens.length} total`}
              </span>
            </h2>
            <TokensPanel userId={user.id} initialTokens={idTokens} />
          </section>
          </>
          )}
        </div>
      </PageShell>
    </>
  );
}

function TabLink({
  href,
  label,
  count,
  active,
}: {
  href: Parameters<typeof Link>[0]["href"];
  label: string;
  count: number;
  active: boolean;
}) {
  const base = "px-4 py-2 text-sm border-b-2 -mb-px transition-colors";
  const cls = active
    ? "border-sv-sky text-sv-sky font-semibold"
    : "border-transparent text-ink-400 hover:text-ink-100 hover:border-bg-border";
  return (
    <Link href={href} className={`${base} ${cls}`}>
      {label}
      <span
        className={
          "ml-2 rounded px-1.5 py-0.5 font-mono text-[10px] " +
          (active ? "bg-sv-sky/15 text-sv-sky" : "bg-bg-base/60 text-ink-500")
        }
      >
        {count}
      </span>
    </Link>
  );
}
