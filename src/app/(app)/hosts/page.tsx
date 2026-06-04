import { cookies } from "next/headers";
import Link from "next/link";
import { Topbar } from "@/components/topbar";
import { PageShell } from "@/components/page-shell";
import { ActionBar } from "@/components/action-bar";
import { adminSessionConfig, verifyAdminSession } from "@/lib/admin-session";
import { apiFetchServerJson } from "@/lib/api-client-server";
import type { OrgSummary, OrganizationKind } from "@straumvakt/shared/domain/orgs";

export const metadata = { title: "Hosts" };

// ADR 0026 — "Hosts" is a filtered lens on Organizations, not a new
// object. A Host is an Org whose kind ∈ {multi_dwelling, company} (a
// customer that hosts charging and pays Straumvakt). Operators, vendors,
// DSOs etc. have kind=null and are excluded. The host-detail page lives
// at /hosts/[id] and reuses the same /api/admin/orgs/:id surface.

const HOST_KINDS: OrganizationKind[] = ["multi_dwelling", "company"];

type Filter = "all" | OrganizationKind;

function kindLabel(kind: OrganizationKind): string {
  return kind === "multi_dwelling" ? "Multi-dwelling" : "Company";
}

export default async function HostsPage({
  searchParams,
}: {
  searchParams: Promise<{ kind?: string }>;
}) {
  const jar = await cookies();
  const token = jar.get(adminSessionConfig.SESSION_COOKIE_NAME)?.value;
  const session = await verifyAdminSession(token);

  const sp = await searchParams;
  const filter: Filter =
    sp.kind === "multi_dwelling" || sp.kind === "company" ? sp.kind : "all";

  const { orgs } = await apiFetchServerJson<{ orgs: OrgSummary[] }>(
    `/api/admin/orgs`,
  );

  // The lens: orgs carrying a host kind. Non-host orgs (kind=null) drop out.
  const hosts = orgs.filter(
    (o): o is OrgSummary & { kind: OrganizationKind } =>
      o.kind != null && HOST_KINDS.includes(o.kind),
  );

  const counts = {
    all: hosts.length,
    multi_dwelling: hosts.filter((h) => h.kind === "multi_dwelling").length,
    company: hosts.filter((h) => h.kind === "company").length,
  };

  const visible =
    filter === "all" ? hosts : hosts.filter((h) => h.kind === filter);

  const tabs: { key: Filter; label: string; count: number }[] = [
    { key: "all", label: "All", count: counts.all },
    { key: "multi_dwelling", label: "Multi-dwelling", count: counts.multi_dwelling },
    { key: "company", label: "Company", count: counts.company },
  ];

  return (
    <>
      <Topbar title="Hosts" email={session?.email} />
      <PageShell
        title="Hosts"
        description="A Host is a customer Org that hosts charging and pays Straumvakt — a filtered lens on Organizations where kind ∈ {multi_dwelling, company} (ADR 0026). Drill into a host to administer its billing-homes, drivers, and contract."
      >
        <ActionBar
          title="Hosts"
          description="Going-public lens on Organizations. Onboard non-host orgs (operators, vendors, DSOs) from Accounts → Organizations."
        />

        <nav className="-mx-6 mb-6 border-b border-bg-border bg-bg-base/40 px-6">
          <ul className="-mb-px flex gap-1 overflow-x-auto">
            {tabs.map((t) => {
              const active = t.key === filter;
              const href = t.key === "all" ? "/hosts" : `/hosts?kind=${t.key}`;
              return (
                <li key={t.key}>
                  <Link
                    href={href as Parameters<typeof Link>[0]["href"]}
                    className={
                      "inline-block whitespace-nowrap border-b-2 px-3 py-2.5 text-sm transition-colors " +
                      (active
                        ? "border-sv-sky text-sv-sky"
                        : "border-transparent text-ink-400 hover:border-bg-border hover:text-ink-100")
                    }
                  >
                    {t.label} <span className="text-ink-500">· {t.count}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        <section className="rounded-lg border border-bg-border bg-bg-surface/70 shadow-card backdrop-blur">
          <header className="border-b border-bg-border bg-bg-base/40 px-5 py-3">
            <h2 className="text-sm font-semibold text-ink-50">
              {visible.length} {visible.length === 1 ? "host" : "hosts"}
              {filter !== "all" ? ` · ${kindLabel(filter)}` : ""}
            </h2>
          </header>
          {visible.length === 0 ? (
            <div className="p-8 text-center">
              <p className="text-sm text-ink-200">No hosts in this view.</p>
              <p className="mt-1 text-xs text-ink-400">
                Hosts are Organizations with{" "}
                <span className="font-mono text-ink-300">kind</span> set to{" "}
                <span className="font-mono text-ink-300">multi_dwelling</span> or{" "}
                <span className="font-mono text-ink-300">company</span>. Set an
                org&apos;s kind in Accounts → Organizations to surface it here.
              </p>
            </div>
          ) : (
            <table className="w-full text-left text-sm">
              <thead className="text-xs text-ink-400">
                <tr>
                  <th className="px-5 py-2 font-medium">Host</th>
                  <th className="px-5 py-2 font-medium">Type</th>
                  <th className="px-5 py-2 font-medium">Kennitala</th>
                  <th className="px-5 py-2 text-right font-medium">Sites</th>
                  <th className="px-5 py-2 text-right font-medium">Chargers</th>
                  <th className="px-5 py-2 text-right font-medium">Drivers</th>
                  <th className="px-5 py-2 font-medium">Status</th>
                  <th className="px-5 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {visible.map((h) => (
                  <tr key={h.id} className="border-t border-bg-border/40 hover:bg-bg-base/20">
                    <td className="px-5 py-2 font-medium text-ink-50">
                      <Link
                        href={`/hosts/${h.id}` as Parameters<typeof Link>[0]["href"]}
                        className="hover:text-sv-sky"
                      >
                        {h.displayName}
                      </Link>
                    </td>
                    <td className="px-5 py-2">
                      <KindBadge kind={h.kind} />
                    </td>
                    <td className="px-5 py-2 font-mono text-xs text-ink-300">
                      {h.kennitala ? (
                        `${h.kennitala.slice(0, 6)}-${h.kennitala.slice(6)}`
                      ) : (
                        <span className="text-ink-500">—</span>
                      )}
                    </td>
                    {/* OrgSummary carries no rollup counts yet — the API
                        returns identity-level fields only. Show em-dash until
                        a counts surface lands (REPORTED). */}
                    <td className="px-5 py-2 text-right text-ink-500">—</td>
                    <td className="px-5 py-2 text-right text-ink-500">—</td>
                    <td className="px-5 py-2 text-right text-ink-500">—</td>
                    <td className="px-5 py-2">
                      <StatusBadge status={h.status} />
                    </td>
                    <td className="px-5 py-2 text-right">
                      <Link
                        href={`/hosts/${h.id}` as Parameters<typeof Link>[0]["href"]}
                        className="text-xs text-sv-green hover:text-sv-sky"
                      >
                        Administer →
                      </Link>
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

function KindBadge({ kind }: { kind: OrganizationKind }) {
  const classes =
    kind === "multi_dwelling"
      ? "bg-sv-sky/10 text-sv-sky border-sv-sky/30"
      : "bg-violet-950/40 text-violet-300 border-violet-700/40";
  return (
    <span
      className={
        "inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-medium " +
        classes
      }
    >
      {kindLabel(kind)}
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  const classes =
    status === "active"
      ? "bg-emerald-950/40 text-emerald-300 border-emerald-700/40"
      : status === "suspended"
        ? "bg-amber-950/40 text-amber-300 border-amber-700/40"
        : "bg-slate-800/60 text-slate-400 border-slate-700/40";
  return (
    <span
      className={
        "inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-medium uppercase " +
        classes
      }
    >
      {status}
    </span>
  );
}
