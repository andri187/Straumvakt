"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/cn";
import { useLanguage } from "@/components/language-provider";
import { useSidebar } from "@/components/sidebar-context";

type NavItem = {
  href: string;
  label: { is: string; en: string };
  icon: LucideIcon;
};

// Minimal Sprint 0 nav — Dashboard only. Expanded in Sprint 5 per V3 plan.
const nav: NavItem[] = [
  {
    href: "/dashboard",
    label: { is: "Mælaborð", en: "Dashboard" },
    icon: LayoutDashboard,
  },
];

function StraumvaktMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 120 120"
      className={className}
      fill="none"
      aria-hidden="true"
    >
      <defs>
        <linearGradient
          id="svSbBolt"
          x1="40"
          y1="20"
          x2="80"
          y2="100"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0%" stopColor="#8EF5C7" />
          <stop offset="100%" stopColor="#6FDCEA" />
        </linearGradient>
      </defs>
      <path
        d="M 84 18 L 54 18 A 24 24 0 0 0 30 42 L 30 60"
        stroke="#3EE9A7"
        strokeWidth="13"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M 36 102 L 66 102 A 24 24 0 0 0 90 78 L 90 60"
        stroke="#2BB6E8"
        strokeWidth="13"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M 66 28 L 44 66 L 58 66 L 52 96 L 78 56 L 62 56 Z"
        fill="url(#svSbBolt)"
      />
    </svg>
  );
}

export function Sidebar() {
  const { language } = useLanguage();
  const { mobileOpen, close } = useSidebar();
  const pathname = usePathname();

  return (
    <>
      <div
        className={cn(
          "fixed inset-0 z-40 bg-black/60 backdrop-blur-sm transition-opacity duration-200 md:hidden",
          mobileOpen
            ? "opacity-100 pointer-events-auto"
            : "opacity-0 pointer-events-none",
        )}
        onClick={close}
        aria-hidden="true"
      />

      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex w-64 shrink-0 flex-col border-r border-bg-border bg-bg-surface",
          "transition-transform duration-200 ease-in-out",
          mobileOpen ? "translate-x-0" : "-translate-x-full",
          "md:relative md:translate-x-0 md:w-14",
          "lg:w-64",
        )}
      >
        <div className="flex items-center gap-3 border-b border-bg-border px-5 py-5 md:justify-center md:px-2 lg:justify-start lg:px-5">
          <StraumvaktMark className="h-9 w-9 shrink-0" />
          <div className="min-w-0 md:hidden lg:block">
            <div className="sv-wordmark text-base font-bold leading-tight">
              Straumvakt
            </div>
            <div className="sv-tagline">
              {language === "is"
                ? "Umsjá · Yfirsýn · Þægindi"
                : "Control · Overview · Convenience"}
            </div>
          </div>
        </div>

        <nav className="flex-1 space-y-0.5 overflow-y-auto px-2 py-4">
          {nav.map(({ href, label, icon: Icon }) => {
            const active = pathname === href || pathname.startsWith(href + "/");
            return (
              <Link
                key={href}
                href={href as Parameters<typeof Link>[0]["href"]}
                title={label[language]}
                onClick={close}
                className={cn(
                  "flex min-h-[40px] items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                  "md:justify-center md:px-0 lg:justify-start lg:px-3",
                  active
                    ? "bg-brand-500/15 text-sv-sky ring-1 ring-inset ring-brand-500/25"
                    : "text-ink-300 hover:bg-bg-raised hover:text-ink-50",
                )}
              >
                <Icon
                  className={cn(
                    "h-5 w-5 shrink-0",
                    active ? "text-sv-green" : "text-ink-400",
                  )}
                />
                <span className="md:hidden lg:block">{label[language]}</span>
              </Link>
            );
          })}
        </nav>

        <div className="border-t border-bg-border px-5 py-4 text-xs text-ink-400 md:hidden lg:block">
          {language === "is" ? "v0.1.0 · Áfangi 0" : "v0.1.0 · Sprint 0"}
        </div>
      </aside>
    </>
  );
}
