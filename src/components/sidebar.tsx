"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Smartphone,
  BookOpen,
  Zap,
  Wrench,
  Globe,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/cn";
import { useLanguage } from "@/components/language-provider";
import { useSidebar } from "@/components/sidebar-context";

type Label = { is: string; en: string };

type LeafItem = {
  kind: "leaf";
  href: string;
  label: Label;
  icon: LucideIcon;
};

type GroupItem = {
  kind: "group";
  basePath: string; // routes starting with this are considered "in this group"
  label: Label;
  icon: LucideIcon;
  children: { href: string; label: Label; icon: LucideIcon }[];
};

type NavItem = LeafItem | GroupItem;

// Minimal Sprint 0 nav — Dashboard only. Expanded in Sprint 5 per V3 plan.
// Mobile App / Reference / Technical Read are operator-side detour
// panels added during the Sprint 1.5 UI detour.
const nav: NavItem[] = [
  {
    kind: "leaf",
    href: "/dashboard",
    label: { is: "Mælaborð", en: "Dashboard" },
    icon: LayoutDashboard,
  },
  {
    kind: "leaf",
    href: "/mobile-app",
    label: { is: "Snjalltæki", en: "Mobile App" },
    icon: Smartphone,
  },
  {
    kind: "leaf",
    href: "/technical-read",
    label: { is: "Tæknilegur lestur", en: "Technical Read" },
    icon: Wrench,
  },
  {
    kind: "group",
    basePath: "/reference",
    label: { is: "Tilvísanir", en: "Reference" },
    icon: BookOpen,
    children: [
      {
        href: "/reference",
        label: { is: "Orkuaðilar Íslands", en: "Iceland — Energy Parties" },
        icon: Globe,
      },
      {
        href: "/reference/zaptec-api",
        label: { is: "Zaptec API", en: "Zaptec API" },
        icon: Zap,
      },
    ],
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
          {nav.map((item) => {
            if (item.kind === "leaf") {
              const active =
                pathname === item.href || pathname.startsWith(item.href + "/");
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href as Parameters<typeof Link>[0]["href"]}
                  title={item.label[language]}
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
                  <span className="md:hidden lg:block">
                    {item.label[language]}
                  </span>
                </Link>
              );
            }

            // Group: render header + children. Header is non-clickable
            // chrome at lg width; on collapsed-rail (md) only the icon
            // shows and acts like a label tooltip.
            const groupActive = pathname.startsWith(item.basePath);
            const GroupIcon = item.icon;
            return (
              <div key={item.basePath} className="pt-2">
                <div
                  title={item.label[language]}
                  className={cn(
                    "flex min-h-[36px] items-center gap-3 rounded-md px-3 py-1.5 text-[10px] font-semibold uppercase tracking-brand",
                    "md:justify-center md:px-0 lg:justify-start lg:px-3",
                    groupActive ? "text-sv-sky" : "text-ink-400",
                  )}
                >
                  <GroupIcon
                    className={cn(
                      "h-5 w-5 shrink-0",
                      groupActive ? "text-sv-green" : "text-ink-500",
                    )}
                  />
                  <span className="md:hidden lg:block">
                    {item.label[language]}
                  </span>
                </div>
                <div className="ml-2 space-y-0.5 border-l border-bg-border/60 pl-2 md:ml-0 md:border-l-0 md:pl-0 lg:ml-2 lg:border-l lg:pl-2">
                  {item.children.map((child) => {
                    // Exact match = active so /reference and
                    // /reference/zaptec-api don't both light up.
                    const childActive = pathname === child.href;
                    const ChildIcon = child.icon;
                    return (
                      <Link
                        key={child.href}
                        href={child.href as Parameters<typeof Link>[0]["href"]}
                        title={child.label[language]}
                        onClick={close}
                        className={cn(
                          "flex min-h-[36px] items-center gap-3 rounded-md px-3 py-1.5 text-sm transition-colors",
                          "md:justify-center md:px-0 lg:justify-start lg:px-3",
                          childActive
                            ? "bg-brand-500/15 text-sv-sky ring-1 ring-inset ring-brand-500/25"
                            : "text-ink-300 hover:bg-bg-raised hover:text-ink-50",
                        )}
                      >
                        <ChildIcon
                          className={cn(
                            "h-4 w-4 shrink-0",
                            childActive ? "text-sv-green" : "text-ink-500",
                          )}
                        />
                        <span className="md:hidden lg:block">
                          {child.label[language]}
                        </span>
                      </Link>
                    );
                  })}
                </div>
              </div>
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
