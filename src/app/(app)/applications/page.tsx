import { cookies } from "next/headers";
import Link from "next/link";
import { Topbar } from "@/components/topbar";
import { PageShell } from "@/components/page-shell";
import { adminSessionConfig, verifyAdminSession } from "@/lib/admin-session";
import { apiFetchServerJson } from "@/lib/api-client-server";
import type {
  HostApplicationStatus,
  HostApplicationSummary,
} from "@straumvakt/shared/domain/host-applications";
import { StatusControl } from "./status-controls";

export const metadata = { title: "Applications · Inbox" };

const STATUS_TABS: { value: HostApplicationStatus | "all"; label: string }[] = [
  { value: "all", label: "All" },
  { value: "new", label: "New" },
  { value: "in_review", label: "In review" },
  { value: "offered", label: "Offered" },
  { value: "won", label: "Won" },
  { value: "lost", label: "Lost" },
];

function isStatus(v: string | undefined): v is HostApplicationStatus {
  return (
    v === "new" ||
    v === "in_review" ||
    v === "offered" ||
    v === "won" ||
    v === "lost"
  );
}

export default async function ApplicationsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const jar = await cookies();
  const token = jar.get(adminSessionConfig.SESSION_COOKIE_NAME)?.value;
  const session = await verifyAdminSession(token);

  const sp = await searchParams;
  const activeStatus = isStatus(sp.status) ? sp.status : "all";
  const query = activeStatus === "all" ? "" : `?status=${activeStatus}`;

  const { items } = await apiFetchServerJson<{
    items: HostApplicationSummary[];
  }>(`/api/admin/host-applications${query}`);

  return (
    <>
      <Topbar title="Applications · Inbox" email={session?.email} />
      <PageShell
        title="Host applications"
        description="Inbound RFQs from the public /apply funnel (ADR 0026 §6). Work each lead through the pipeline; convert a won application into a host org."
      >
        <nav className="-mx-6 mb-6 border-b border-bg-border bg-bg-base/40 px-6">
          <ul className="flex gap-1 overflow-x-auto -mb-px">
            {STATUS_TABS.map((t) => {
              const active = activeStatus === t.value;
              const href =
                t.value === "all"
                  ? "/applications"
                  : `/applications?status=${t.value}`;
              return (
                <li key={t.value}>
                  <Link
                    href={href as Parameters<typeof Link>[0]["href"]}
                    className={
                      "inline-block whitespace-nowrap border-b-2 px-3 py-2.5 text-sm transition-colors " +
                      (active
                        ? "border-sv-sky text-sv-sky"
                        : "border-transparent text-ink-400 hover:text-ink-100 hover:border-bg-border")
                    }
                  >
                    {t.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        <section className="rounded-lg border border-bg-border bg-bg-surface/70 shadow-card backdrop-blur">
          <header className="border-b border-bg-border bg-bg-base/40 px-5 py-3">
            <h2 className="text-sm font-semibold text-ink-50">
              {items.length}{" "}
              {items.length === 1 ? "application" : "applications"}
              {activeStatus === "all" ? "" : ` · ${activeStatus}`}
            </h2>
          </header>
          {items.length === 0 ? (
            <div className="p-8 text-center">
              <p className="text-sm text-ink-200">
                No applications{activeStatus === "all" ? " yet" : " in this status"}.
              </p>
              <p className="mt-1 text-xs text-ink-400">
                Inbound leads from{" "}
                <span className="font-mono text-sv-green">/apply</span> land
                here.
              </p>
            </div>
          ) : (
            <table className="w-full text-left text-sm">
              <thead className="text-xs text-ink-400">
                <tr>
                  <th className="px-5 py-2 font-medium">Company</th>
                  <th className="px-5 py-2 font-medium">Type</th>
                  <th className="px-5 py-2 font-medium">Sites</th>
                  <th className="px-5 py-2 font-medium">Contact</th>
                  <th className="px-5 py-2 font-medium">Received</th>
                  <th className="px-5 py-2 font-medium">Status</th>
                  <th className="px-5 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {items.map((a) => (
                  <ApplicationRow key={a.id} application={a} />
                ))}
              </tbody>
            </table>
          )}
        </section>
      </PageShell>
    </>
  );
}

function ApplicationRow({
  application: a,
}: {
  application: HostApplicationSummary;
}) {
  const totalChargers = a.sites.reduce(
    (sum, s) => sum + s.estimatedChargers,
    0,
  );
  const totalDrivers = a.sites.reduce((sum, s) => sum + s.estimatedDrivers, 0);
  const received = new Date(a.createdAt).toLocaleDateString("is-IS", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });

  return (
    <tr className="border-t border-bg-border/40 align-top">
      <td className="px-5 py-3">
        <div className="font-medium text-ink-50">{a.companyName}</div>
        {a.kennitala && (
          <div className="font-mono text-[11px] text-ink-400">
            {a.kennitala.slice(0, 6)}-{a.kennitala.slice(6)}
          </div>
        )}
        {a.description && (
          <div className="mt-1 max-w-xs truncate text-xs text-ink-400">
            {a.description}
          </div>
        )}
      </td>
      <td className="px-5 py-3">
        <span className="inline-flex items-center rounded border border-bg-border/60 bg-bg-base/40 px-1.5 py-0.5 text-[10px] font-medium uppercase text-ink-200">
          {a.siteType === "multi_dwelling" ? "Multi-dwelling" : "Company"}
        </span>
      </td>
      <td className="px-5 py-3 text-ink-200">
        <div>
          {a.sites.length} {a.sites.length === 1 ? "site" : "sites"}
        </div>
        <div className="text-[11px] text-ink-400">
          ~{totalChargers} chargers · ~{totalDrivers} drivers
        </div>
      </td>
      <td className="px-5 py-3">
        <div className="text-ink-100">{a.contactName}</div>
        <a
          href={`mailto:${a.contactEmail}`}
          className="text-xs text-sv-sky hover:underline"
        >
          {a.contactEmail}
        </a>
        {a.contactPhone && (
          <div className="text-[11px] text-ink-400">{a.contactPhone}</div>
        )}
      </td>
      <td className="px-5 py-3 text-xs text-ink-300">{received}</td>
      <td className="px-5 py-3">
        <StatusControl id={a.id} current={a.status} />
      </td>
      <td className="px-5 py-3 text-right">
        {a.convertedOrgId ? (
          <Link
            href={
              `/accounts/organizations/${a.convertedOrgId}` as Parameters<
                typeof Link
              >[0]["href"]
            }
            className="text-xs text-ink-300 hover:text-sv-sky"
          >
            View host →
          </Link>
        ) : (
          <Link
            href="/accounts/organizations/new"
            className="whitespace-nowrap text-xs text-sv-green hover:text-sv-sky"
          >
            Convert to host →
          </Link>
        )}
      </td>
    </tr>
  );
}
