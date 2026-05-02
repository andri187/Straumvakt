"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * Section tabs scoped to a single org's detail pages. Highlights the
 * tab whose href is the longest prefix of the current pathname so
 * nested paths land on the right tab.
 */
export function OrgSectionTabs({ orgId }: { orgId: string }) {
  const pathname = usePathname();
  const base = `/tenants/organizations/${orgId}`;
  const tabs: { href: string; label: string; exact?: boolean }[] = [
    { href: base, label: "Profile", exact: true },
    { href: `${base}/sites`, label: "Sites" },
    { href: `${base}/installations`, label: "Installations" },
    { href: `${base}/driver-groups`, label: "Driver groups" },
    { href: `${base}/contracts`, label: "Contracts" },
  ];

  const matched = tabs
    .filter((t) =>
      t.exact
        ? pathname === t.href
        : pathname === t.href || pathname.startsWith(t.href + "/"),
    )
    .sort((a, b) => b.href.length - a.href.length)[0]?.href;

  return (
    <nav className="-mx-6 mb-6 border-b border-bg-border bg-bg-base/40 px-6">
      <ul className="-mb-px flex gap-1 overflow-x-auto">
        {tabs.map((t) => {
          const active = matched === t.href;
          return (
            <li key={t.href}>
              <Link
                href={t.href as Parameters<typeof Link>[0]["href"]}
                className={
                  "inline-block whitespace-nowrap border-b-2 px-3 py-2.5 text-sm transition-colors " +
                  (active
                    ? "border-sv-sky text-sv-sky"
                    : "border-transparent text-ink-400 hover:border-bg-border hover:text-ink-100")
                }
              >
                {t.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
