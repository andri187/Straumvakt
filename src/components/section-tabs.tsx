"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export type SectionTab = {
  href: string;
  label: string;
  exact?: boolean;
};

export function SectionTabs({ tabs }: { tabs: SectionTab[] }) {
  const pathname = usePathname();
  // Resolve longest matching href so nested paths don't double-highlight.
  const matchedHref = tabs
    .filter((t) =>
      t.exact
        ? pathname === t.href
        : pathname === t.href || pathname.startsWith(t.href + "/"),
    )
    .sort((a, b) => b.href.length - a.href.length)[0]?.href;

  return (
    <nav className="-mx-6 mb-6 border-b border-bg-border bg-bg-base/40 px-6">
      <ul className="flex gap-1 overflow-x-auto -mb-px">
        {tabs.map((t) => {
          const active = matchedHref === t.href;
          return (
            <li key={t.href}>
              <Link
                href={t.href as Parameters<typeof Link>[0]["href"]}
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
  );
}

// Predefined tab sets so call sites stay consistent.
export const OPERATIONS_TABS: SectionTab[] = [
  { href: "/sites", label: "Sites" },
  { href: "/installations", label: "Installations" },
  { href: "/circuits", label: "Circuits" },
  { href: "/chargers", label: "Chargers" },
];

export const TENANTS_TABS: SectionTab[] = [
  { href: "/tenants", label: "All", exact: true },
  { href: "/tenants/organizations", label: "Organizations" },
  { href: "/tenants/properties", label: "Properties" },
  { href: "/people/users", label: "Users" },
];

export const ONBOARD_TABS: SectionTab[] = [
  { href: "/onboard", label: "Test chain", exact: true },
  { href: "/onboard/zaptec", label: "Zaptec wizard" },
];

export const REFERENCE_TABS: SectionTab[] = [
  { href: "/reference/electricity/dso", label: "DSO" },
  { href: "/reference/electricity/retailers", label: "Retailers" },
  { href: "/reference/electricity/tso", label: "TSO" },
  { href: "/reference/public-charging", label: "Public charging" },
  { href: "/reference/rental-service", label: "Rental" },
  { href: "/reference/zaptec-api", label: "Zaptec API" },
  { href: "/reference/easee-api", label: "Easee API" },
];

export const CHARGERS_TABS: SectionTab[] = [
  { href: "/chargers", label: "Onboarded", exact: true },
  { href: "/chargers/pending", label: "Pending onboarding" },
];

export const BILLING_TABS: SectionTab[] = [
  { href: "/billing", label: "All", exact: true },
  { href: "/billing/cost-factors", label: "Cost factors" },
  { href: "/billing/tariffs", label: "Tariffs" },
  { href: "/billing/cost-centers", label: "Cost centers" },
  { href: "/billing/contracts", label: "Contracts" },
  { href: "/billing/driver-contracts", label: "Driver contracts" },
  { href: "/billing/dso", label: "DSO rates" },
  { href: "/billing/electricity", label: "Electricity rates" },
];
