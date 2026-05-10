// Sprint 9 / ADR 0019 milestone A.8 — Agreements list (operator UI).
// Pilot scope: only service_cpo and installation types are surfaced
// per the 2026-05-09 addendum.

import Link from "next/link";
import { cookies } from "next/headers";
import { Topbar } from "@/components/topbar";
import { PageShell } from "@/components/page-shell";
import { adminSessionConfig, verifyAdminSession } from "@/lib/admin-session";
import { apiFetchServer } from "@/lib/api-client-server";

export const metadata = { title: "Agreements" };
export const dynamic = "force-dynamic";

interface AgreementListRow {
  id: string;
  agreementType: "service_cpo" | "installation";
  displayName: string;
  status: "draft" | "active" | "expired";
  effectiveFrom: string;
  effectiveUntil: string | null;
  counterpartyOrgId: string;
  counterpartyDisplayName: string;
  installationId: string | null;
  installationDisplayName: string | null;
  clauseCount: number;
  driverGroupCount: number;
  memberCount: number;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("is-IS", {
    year: "numeric",
    month: "short",
    day: "2-digit",
  });
}

export default async function AgreementsPage() {
  const jar = await cookies();
  const token = jar.get(adminSessionConfig.SESSION_COOKIE_NAME)?.value;
  const session = await verifyAdminSession(token);

  const res = await apiFetchServer(`/api/admin/agreements`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const { agreements } = (await res.json()) as { agreements: AgreementListRow[] };

  const installationCount = agreements.filter((a) => a.agreementType === "installation").length;
  const serviceCpoCount = agreements.filter((a) => a.agreementType === "service_cpo").length;

  return (
    <>
      <Topbar title="Agreements" email={session?.email} />
      <PageShell title="Agreements">
        {/* Header */}
        <section className="mb-6 rounded-lg border border-bg-border bg-bg-base/30 p-5">
          <p className="mb-3 text-xs text-ink-400">
            Commercial + operational contracts per ADR 0019. Pilot surfaces only
            <span className="mx-1 rounded bg-sv-sky/10 px-1.5 py-0.5 font-mono text-[10px] text-sv-sky">service_cpo</span>
            and
            <span className="mx-1 rounded bg-sv-sky/10 px-1.5 py-0.5 font-mono text-[10px] text-sv-sky">installation</span>
            types. Click into one to see clauses, driver groups, and memberships.
          </p>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm md:grid-cols-3">
            <Stat label="Total" value={String(agreements.length)} />
            <Stat label="Service (CPO)" value={String(serviceCpoCount)} accent="sky" />
            <Stat label="Installation" value={String(installationCount)} accent="emerald" />
          </dl>
        </section>

        {/* List */}
        <section className="rounded-lg border border-bg-border bg-bg-surface/70 shadow-card backdrop-blur">
          <h2 className="border-b border-bg-border/60 px-5 py-2 text-[11px] font-semibold uppercase tracking-brand text-ink-300">
            Agreements{" "}
            <span className="text-ink-500">· {agreements.length}</span>
          </h2>
          {agreements.length === 0 ? (
            <p className="px-5 py-12 text-center text-sm italic text-ink-500">
              No agreements yet. The first {`<service_cpo>`} or {`<installation>`} agreement
              will land here when you wire one up via the seed scripts (operator-facing
              authoring UI is A.9 — not yet built).
            </p>
          ) : (
            <ul className="divide-y divide-bg-border/40">
              {agreements.map((a) => (
                <li key={a.id} className="px-5 py-3 hover:bg-bg-raised/30">
                  <Link
                    href={`/agreements/${a.id}` as Parameters<typeof Link>[0]["href"]}
                    className="block"
                  >
                    <div className="flex flex-wrap items-baseline justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-ink-100 hover:text-sv-sky">
                          {a.displayName}
                        </p>
                        <p className="mt-0.5 text-xs text-ink-400">
                          <TypeBadge type={a.agreementType} />
                          <span className="ml-2">{a.counterpartyDisplayName}</span>
                          {a.installationDisplayName && (
                            <span className="ml-2 text-ink-500">· {a.installationDisplayName}</span>
                          )}
                        </p>
                        <div className="mt-1.5 flex flex-wrap items-center gap-3 text-[10px] text-ink-500">
                          <span>
                            {a.clauseCount} clause{a.clauseCount === 1 ? "" : "s"}
                          </span>
                          <span>·</span>
                          <span>
                            {a.driverGroupCount} group{a.driverGroupCount === 1 ? "" : "s"}
                          </span>
                          <span>·</span>
                          <span>
                            {a.memberCount} member{a.memberCount === 1 ? "" : "s"}
                          </span>
                        </div>
                      </div>
                      <div className="text-right">
                        <StatusPill status={a.status} />
                        <p className="mt-1 text-[11px] text-ink-500">
                          From {formatDate(a.effectiveFrom)}
                          {a.effectiveUntil && ` until ${formatDate(a.effectiveUntil)}`}
                        </p>
                      </div>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </PageShell>
    </>
  );
}

function Stat({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: "sky" | "emerald";
}) {
  const valueClass =
    accent === "sky"
      ? "text-sv-sky"
      : accent === "emerald"
        ? "text-emerald-300"
        : "text-ink-100";
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-wide text-ink-500">{label}</dt>
      <dd className={`mt-0.5 font-mono text-base font-semibold ${valueClass}`}>{value}</dd>
    </div>
  );
}

function TypeBadge({ type }: { type: "service_cpo" | "installation" }) {
  const cls =
    type === "service_cpo"
      ? "bg-sv-sky/15 text-sv-sky ring-sv-sky/30"
      : "bg-emerald-400/15 text-emerald-300 ring-emerald-400/30";
  return (
    <span className={`rounded px-1.5 py-0.5 font-mono text-[10px] font-medium ring-1 ring-inset ${cls}`}>
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
