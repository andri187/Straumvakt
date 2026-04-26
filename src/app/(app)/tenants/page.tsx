import Link from "next/link";
import { SectionTabs, TENANTS_TABS } from "@/components/section-tabs";
import { listOrgs } from "@/lib/repositories/organizations";
import { listAllProperties } from "@/lib/repositories/properties";
import { listUsers } from "@/lib/repositories/users";

export const dynamic = "force-dynamic";
export const metadata = { title: "Tenants" };

type Row = {
  type: "Organization" | "Property" | "User";
  href: string;
  name: string;
  detail: string;
  parent: string;
  id: string;
  updatedAt: string;
};

export default async function TenantsPage() {
  const [orgs, properties, users] = await Promise.all([
    listOrgs({ includeArchived: true }),
    listAllProperties(),
    listUsers({ includeDeleted: true }),
  ]);

  const rows: Row[] = [
    ...orgs.map((o): Row => ({
      type: "Organization",
      href: `/tenants/organizations/${o.id}`,
      name: o.displayName,
      detail: `slug ${o.slug} · ${o.countryCode}${o.kennitala ? ` · kennitala ${o.kennitala}` : ""}${o.status !== "active" ? ` · ${o.status}` : ""}`,
      parent: "—",
      id: o.id,
      updatedAt: o.updatedAt,
    })),
    ...properties.map((p): Row => ({
      type: "Property",
      href: `/tenants/properties`,
      name: p.displayName,
      detail: p.locationType ?? "",
      parent: p.orgDisplayName,
      id: p.id,
      updatedAt: p.updatedAt,
    })),
    ...users.map((u): Row => ({
      type: "User",
      href: `/people/users/${u.id}`,
      name: u.displayName ?? u.email,
      detail: u.email,
      parent: "—",
      id: u.id,
      updatedAt: u.updatedAt,
    })),
  ].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  const counts = {
    org: orgs.length,
    property: properties.length,
    user: users.length,
  };

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <SectionTabs tabs={TENANTS_TABS} />
      <header className="mb-6">
        <h1 className="text-2xl font-semibold text-ink-50">Tenants</h1>
        <p className="mt-1 text-sm text-ink-400">
          Combined view across Organizations ({counts.org}), Properties ({counts.property}), and Users ({counts.user}). Click a row to drill in.
        </p>
      </header>

      {rows.length === 0 ? (
        <div className="rounded border border-dashed border-bg-border p-6 text-center text-sm text-ink-500">
          Nothing yet. Use the tabs above to create.
        </div>
      ) : (
        <table className="w-full overflow-hidden rounded-md border border-bg-border bg-bg-base/30 text-sm">
          <thead className="bg-bg-base/50 text-[10px] uppercase tracking-brand text-ink-400">
            <tr>
              <th className="px-3 py-2 text-left">Type</th>
              <th className="px-3 py-2 text-left">Name</th>
              <th className="px-3 py-2 text-left">Detail</th>
              <th className="px-3 py-2 text-left">Owner / parent</th>
              <th className="px-3 py-2 text-left">ID</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-bg-border/60">
            {rows.map((r) => (
              <tr key={`${r.type}:${r.id}`} className="hover:bg-bg-base/20">
                <td className="px-3 py-2">
                  <span className={
                    "inline-block rounded px-1.5 py-0.5 font-mono text-[10px] " +
                    (r.type === "Organization"
                      ? "bg-sv-sky/15 text-sv-sky"
                      : r.type === "Property"
                      ? "bg-sv-green/15 text-sv-green"
                      : "bg-amber-700/30 text-amber-200")
                  }>{r.type}</span>
                </td>
                <td className="px-3 py-2">
                  <Link href={r.href as Parameters<typeof Link>[0]["href"]} className="text-ink-100 hover:text-sv-sky">
                    {r.name}
                  </Link>
                </td>
                <td className="px-3 py-2 text-ink-400">{r.detail}</td>
                <td className="px-3 py-2 text-ink-400">{r.parent}</td>
                <td className="px-3 py-2 font-mono text-[10px] text-ink-500">{r.id.slice(0, 8)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
