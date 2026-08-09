"use client";

import Link from "next/link";
import type { Route } from "next";
import { usePathname } from "next/navigation";

const ITEMS: ReadonlyArray<{ href: string; label: string; exact?: boolean }> = [
  { href: "/staff/overview", label: "Overview", exact: true },
  { href: "/staff/overview/onboarding", label: "Onboarding" },
  { href: "/staff/overview/organisations", label: "Organisations" },
  { href: "/staff/overview/readiness", label: "Readiness" },
  {
    href: "/staff/overview/organisations#support-context",
    label: "Support context",
    exact: true,
  },
  { href: "/staff/overview#operations", label: "Operations", exact: true },
] as const;

export function StaffNav() {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Staff"
      className="border-b border-bg-border bg-bg-surface/85"
    >
      <div className="mx-auto flex max-w-6xl items-center gap-1 overflow-x-auto px-4 sm:px-6">
        <Link
          href="/staff/overview"
          className="mr-4 shrink-0 py-3 text-sm font-semibold text-ink-50"
        >
          Straumvakt staff
        </Link>
        {ITEMS.map((item) => {
          const active = item.exact
            ? pathname === item.href.split("#")[0]
            : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href as Route}
              aria-current={active ? "page" : undefined}
              className={`shrink-0 border-b-2 px-3 py-3 text-xs font-medium transition ${
                active
                  ? "border-brand-400 text-ink-50"
                  : "border-transparent text-ink-400 hover:text-ink-100"
              }`}
            >
              {item.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
