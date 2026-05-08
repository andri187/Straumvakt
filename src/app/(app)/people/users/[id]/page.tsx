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
  // idTokens was added in Sprint 3 closure item 1; default to [] so an
  // older API deploy that doesn't include the field still renders.
  const detail = (await detailRes.json()) as {
    user: UserSummary;
    memberships: UserMembershipSummary[];
    idTokens?: IdTokenSummary[];
  };
  const { user, memberships } = detail;
  const idTokens = detail.idTokens ?? [];
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
        </div>
      </PageShell>
    </>
  );
}
