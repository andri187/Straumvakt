// Sprint 9 / ADR 0019 milestone A.8 — Agreement detail (operator UI).
// Shows clauses, driver groups (with member rows linking to user detail),
// and bearer rules. Read-only; authoring is A.9.

import Link from "next/link";
import { notFound } from "next/navigation";
import { cookies } from "next/headers";
import { Topbar } from "@/components/topbar";
import { PageShell } from "@/components/page-shell";
import { adminSessionConfig, verifyAdminSession } from "@/lib/admin-session";
import { apiFetchServer } from "@/lib/api-client-server";

export const dynamic = "force-dynamic";

interface AgreementDetail {
  id: string;
  agreementType: "service_cpo" | "installation";
  displayName: string;
  status: "draft" | "active" | "expired";
  effectiveFrom: string;
  effectiveUntil: string | null;
  notes: string | null;
  counterparty: { id: string; displayName: string };
  installation: {
    id: string;
    displayName: string;
    installationType: string;
    enforceAuthorize: boolean;
  } | null;
  clauses: ClauseRow[];
  driverGroups: DriverGroupRow[];
  bearerRules: BearerRuleRow[];
}

interface ClauseRow {
  id: string;
  factorCode: string;
  factorDisplayNameEn: string;
  factorDisplayNameIs: string;
  defaultBearerType: string;
  defaultRateRefCode: string | null;
  allocationJson: unknown;
}

interface DriverGroupRow {
  id: string;
  displayName: string;
  ownerOrgId: string;
  ownerOrgDisplayName: string;
  members: MemberRow[];
}

interface MemberRow {
  membershipId: string;
  userId: string;
  userEmail: string;
  userDisplayName: string | null;
  addedAt: string;
}

interface BearerRuleRow {
  id: string;
  factorCode: string;
  scopeType: string | null;
  scopeId: string | null;
  audienceType: string | null;
  audienceId: string | null;
  bearerType: string | null;
  rateRefCode: string | null;
  effectiveFrom: string;
  effectiveUntil: string | null;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("is-IS", {
    year: "numeric",
    month: "short",
    day: "2-digit",
  });
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("is-IS", {
    dateStyle: "short",
    timeStyle: "short",
  });
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return { title: `Agreement · ${id.slice(0, 8)}` };
}

export default async function AgreementDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const jar = await cookies();
  const token = jar.get(adminSessionConfig.SESSION_COOKIE_NAME)?.value;
  const session = await verifyAdminSession(token);

  const res = await apiFetchServer(`/api/admin/agreements/${id}`);
  if (res.status === 404) notFound();
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const { agreement } = (await res.json()) as { agreement: AgreementDetail };

  return (
    <>
      <Topbar title={agreement.displayName} email={session?.email} />
      <PageShell title={agreement.displayName}>
        {/* Breadcrumb */}
        <nav className="mb-4 text-xs text-ink-500">
          <Link
            href={"/agreements" as Parameters<typeof Link>[0]["href"]}
            className="hover:text-sv-sky"
          >
            Agreements
          </Link>
          <span className="mx-2">/</span>
          <span className="text-ink-300">{agreement.displayName}</span>
        </nav>

        {/* Metadata */}
        <section className="mb-6 rounded-lg border border-bg-border bg-bg-base/30 p-5">
          <div className="mb-4 flex flex-wrap items-baseline gap-3">
            <TypeBadge type={agreement.agreementType} />
            <StatusPill status={agreement.status} />
            <span className="font-mono text-[10px] text-ink-500">
              {agreement.id}
            </span>
          </div>
          <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-sm md:grid-cols-2">
            <Field label="Counterparty">
              <Link
                href={`/accounts/organizations/${agreement.counterparty.id}` as Parameters<typeof Link>[0]["href"]}
                className="text-ink-100 hover:text-sv-sky"
              >
                {agreement.counterparty.displayName}
              </Link>
            </Field>
            {agreement.installation && (
              <Field label="Installation">
                <Link
                  href={`/installations/${agreement.installation.id}` as Parameters<typeof Link>[0]["href"]}
                  className="text-ink-100 hover:text-sv-sky"
                >
                  {agreement.installation.displayName}
                </Link>
                <span className="ml-2 rounded bg-bg-raised/60 px-1.5 py-0.5 font-mono text-[10px] text-ink-300 ring-1 ring-inset ring-bg-border">
                  {agreement.installation.installationType}
                </span>
                {agreement.installation.enforceAuthorize ? (
                  <span className="ml-2 rounded bg-rose-500/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-brand text-rose-300 ring-1 ring-inset ring-rose-500/30">
                    enforce authorize
                  </span>
                ) : (
                  <span className="ml-2 rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-brand text-amber-300 ring-1 ring-inset ring-amber-500/30">
                    shadow mode
                  </span>
                )}
              </Field>
            )}
            <Field label="Effective from">{formatDate(agreement.effectiveFrom)}</Field>
            <Field label="Effective until">
              {agreement.effectiveUntil ? formatDate(agreement.effectiveUntil) : "—"}
            </Field>
          </dl>
          {agreement.notes && (
            <div className="mt-4 border-t border-bg-border/40 pt-3">
              <p className="text-[11px] uppercase tracking-wide text-ink-500">Notes</p>
              <p className="mt-1 text-sm text-ink-300">{agreement.notes}</p>
            </div>
          )}
        </section>

        {/* Driver groups */}
        <section className="mb-6 rounded-lg border border-bg-border bg-bg-surface/70 shadow-card backdrop-blur">
          <h2 className="border-b border-bg-border/60 px-5 py-2 text-[11px] font-semibold uppercase tracking-brand text-ink-300">
            Driver groups{" "}
            <span className="text-ink-500">· {agreement.driverGroups.length}</span>
          </h2>
          {agreement.driverGroups.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm italic text-ink-500">
              No driver groups under this agreement.
            </p>
          ) : (
            <div className="divide-y divide-bg-border/40">
              {agreement.driverGroups.map((g) => (
                <div key={g.id} className="px-5 py-4">
                  <div className="mb-2 flex flex-wrap items-baseline justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium text-ink-100">{g.displayName}</p>
                      <p className="text-[11px] text-ink-500">
                        Owner:{" "}
                        <Link
                          href={`/accounts/organizations/${g.ownerOrgId}` as Parameters<typeof Link>[0]["href"]}
                          className="hover:text-sv-sky"
                        >
                          {g.ownerOrgDisplayName}
                        </Link>
                      </p>
                    </div>
                    <span className="text-[11px] text-ink-500">
                      {g.members.length} member{g.members.length === 1 ? "" : "s"}
                    </span>
                  </div>
                  {g.members.length > 0 && (
                    <ul className="mt-2 space-y-1.5 border-t border-bg-border/30 pt-2">
                      {g.members.map((m) => (
                        <li
                          key={m.membershipId}
                          className="flex items-baseline justify-between gap-3 rounded px-2 py-1 hover:bg-bg-raised/30"
                        >
                          <Link
                            href={`/people/users/${m.userId}` as Parameters<typeof Link>[0]["href"]}
                            className="flex-1 text-sm text-ink-200 hover:text-sv-sky"
                          >
                            {m.userDisplayName ?? m.userEmail}
                            <span className="ml-2 text-[10px] text-ink-500">{m.userEmail}</span>
                          </Link>
                          <span className="text-[10px] text-ink-500">
                            added {formatDateTime(m.addedAt)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Clauses */}
        <section className="mb-6 rounded-lg border border-bg-border bg-bg-surface/70 shadow-card backdrop-blur">
          <h2 className="border-b border-bg-border/60 px-5 py-2 text-[11px] font-semibold uppercase tracking-brand text-ink-300">
            Clauses{" "}
            <span className="text-ink-500">· {agreement.clauses.length}</span>
          </h2>
          {agreement.clauses.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm italic text-ink-500">
              No clauses yet — this agreement grants access but has no fee dimensions
              configured. Sessions resolved against it will produce zero billing lines.
              Authoring UI is A.9 (not yet built).
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-bg-border/40 text-[10px] uppercase tracking-brand text-ink-500">
                  <th className="px-5 py-2 text-left font-semibold">Factor</th>
                  <th className="px-5 py-2 text-left font-semibold">Default bearer</th>
                  <th className="px-5 py-2 text-left font-semibold">Rate ref</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-bg-border/40">
                {agreement.clauses.map((c) => (
                  <tr key={c.id} className="hover:bg-bg-raised/30">
                    <td className="px-5 py-2">
                      <span className="font-mono text-xs text-sv-sky">{c.factorCode}</span>
                      <span className="ml-2 text-ink-300">{c.factorDisplayNameEn}</span>
                    </td>
                    <td className="px-5 py-2 font-mono text-xs uppercase text-ink-200">
                      {c.defaultBearerType}
                    </td>
                    <td className="px-5 py-2 font-mono text-xs text-ink-400">
                      {c.defaultRateRefCode ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        {/* Bearer rules */}
        <section className="rounded-lg border border-bg-border bg-bg-surface/70 shadow-card backdrop-blur">
          <h2 className="border-b border-bg-border/60 px-5 py-2 text-[11px] font-semibold uppercase tracking-brand text-ink-300">
            Bearer rules (overrides){" "}
            <span className="text-ink-500">· {agreement.bearerRules.length}</span>
          </h2>
          {agreement.bearerRules.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm italic text-ink-500">
              No overrides — every session resolves to the agreement's clause defaults.
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-bg-border/40 text-[10px] uppercase tracking-brand text-ink-500">
                  <th className="px-5 py-2 text-left font-semibold">Factor</th>
                  <th className="px-5 py-2 text-left font-semibold">Audience</th>
                  <th className="px-5 py-2 text-left font-semibold">Scope</th>
                  <th className="px-5 py-2 text-left font-semibold">Bearer</th>
                  <th className="px-5 py-2 text-left font-semibold">Rate ref</th>
                  <th className="px-5 py-2 text-left font-semibold">Effective</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-bg-border/40">
                {agreement.bearerRules.map((br) => (
                  <tr key={br.id} className="hover:bg-bg-raised/30">
                    <td className="px-5 py-2 font-mono text-xs text-sv-sky">{br.factorCode}</td>
                    <td className="px-5 py-2 text-xs text-ink-300">
                      {br.audienceType ? `${br.audienceType}` : "—"}
                    </td>
                    <td className="px-5 py-2 text-xs text-ink-300">
                      {br.scopeType ? `${br.scopeType}` : "—"}
                    </td>
                    <td className="px-5 py-2 font-mono text-xs uppercase text-ink-200">
                      {br.bearerType ?? "(inherit)"}
                    </td>
                    <td className="px-5 py-2 font-mono text-xs text-ink-400">
                      {br.rateRefCode ?? "(inherit)"}
                    </td>
                    <td className="px-5 py-2 text-xs text-ink-400">
                      {formatDate(br.effectiveFrom)}
                      {br.effectiveUntil && ` – ${formatDate(br.effectiveUntil)}`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </PageShell>
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-wide text-ink-500">{label}</dt>
      <dd className="mt-0.5 text-sm">{children}</dd>
    </div>
  );
}

function TypeBadge({ type }: { type: "service_cpo" | "installation" }) {
  const cls =
    type === "service_cpo"
      ? "bg-sv-sky/15 text-sv-sky ring-sv-sky/30"
      : "bg-emerald-400/15 text-emerald-300 ring-emerald-400/30";
  return (
    <span className={`rounded px-2 py-0.5 font-mono text-[10px] font-medium ring-1 ring-inset ${cls}`}>
      {type}
    </span>
  );
}

function StatusPill({ status }: { status: "draft" | "active" | "expired" }) {
  const cls =
    status === "active"
      ? "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30"
      : status === "draft"
        ? "bg-amber-500/15 text-amber-300 ring-amber-500/30"
        : "bg-bg-raised/60 text-ink-400 ring-bg-border";
  return (
    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-brand ring-1 ring-inset ${cls}`}>
      {status}
    </span>
  );
}
