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

export default async function UserDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const jar = await cookies();
  const token = jar.get(adminSessionConfig.SESSION_COOKIE_NAME)?.value;
  const session = await verifyAdminSession(token);

  const { id } = await params;
  const detailRes = await apiFetchServer(`/api/admin/users/${id}`);
  if (detailRes.status === 404) notFound();
  if (!detailRes.ok) throw new Error(`HTTP ${detailRes.status}`);
  const { user, memberships, idTokens } = (await detailRes.json()) as {
    user: UserSummary;
    memberships: UserMembershipSummary[];
    idTokens: IdTokenSummary[];
  };
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
      <PageShell
        title={user.displayName ?? user.email}
        description={`${user.email} · status ${user.status} · ${memberships.length} membership${memberships.length === 1 ? "" : "s"}`}
      >
        <div className="mb-3 text-xs text-ink-400">
          <Link href="/people/users" className="hover:text-ink-50">
            ← All users
          </Link>
        </div>

        <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
          <div className="space-y-6">
            <section className="rounded-lg border border-bg-border bg-bg-surface/70 shadow-card backdrop-blur">
              <header className="flex flex-wrap items-baseline justify-between gap-3 border-b border-bg-border bg-bg-base/40 px-5 py-3">
                <div>
                  <h2 className="text-sm font-semibold text-ink-50">
                    Memberships ({memberships.length})
                  </h2>
                  <p className="text-xs text-ink-400">
                    One row per Org this user belongs to. Roles drive nav
                    restrictions post-pilot — inert during pilot per ADR 0006.
                  </p>
                </div>
              </header>
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
              <header className="flex flex-wrap items-baseline justify-between gap-3 border-b border-bg-border bg-bg-base/40 px-5 py-3">
                <div>
                  <h2 className="text-sm font-semibold text-ink-50">
                    RFID tokens ({idTokens.filter((t) => t.status === "active").length}{" "}
                    active / {idTokens.length} total)
                  </h2>
                  <p className="text-xs text-ink-400">
                    Each token authorizes this user at chargers via OCPP
                    Authorize.req. Closure item 1 from{" "}
                    <code className="font-mono text-ink-300">
                      docs/retros/sprint-03.md
                    </code>{" "}
                    — primary RFID is auto-minted on user create; add more
                    here for additional cards or virtual idTags.
                  </p>
                </div>
              </header>
              <TokensPanel userId={user.id} initialTokens={idTokens} />
            </section>
          </div>

          <aside className="space-y-6"><div className="rounded-lg border border-bg-border bg-bg-surface/70 p-5 shadow-card backdrop-blur">
            <h2 className="text-xs font-semibold uppercase tracking-brand text-sv-sky">
              User detail
            </h2>
            <dl className="mt-3 grid gap-x-4 gap-y-1.5 text-xs sm:grid-cols-[110px_1fr]">
              <dt className="text-ink-500">User ID</dt>
              <dd className="font-mono text-ink-200">{user.id}</dd>
              <dt className="text-ink-500">Email</dt>
              <dd className="font-mono text-ink-100">{user.email}</dd>
              <dt className="text-ink-500">Sign-in</dt>
              <dd className="text-ink-200">
                {user.hasCredentials ? (
                  <span className="text-emerald-300">Has password</span>
                ) : (
                  <span title="Pilot inert record (ADR 0006)">
                    Inert (no signin)
                  </span>
                )}
              </dd>
              <dt className="text-ink-500">Created</dt>
              <dd className="text-ink-200">
                {new Date(user.createdAt).toLocaleString()}
              </dd>
            </dl>
            <div className="mt-4 border-t border-bg-border/40 pt-4">
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
            </div>
          </aside>
        </div>
      </PageShell>
    </>
  );
}
