"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Smartphone,
  BookOpen,
  Zap,
  Wrench,
  Cable,
  Lightbulb,
  RadioTower,
  MapPin,
  Building2,
  Code2,
  Plug,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  Network,
  Briefcase,
  UserCog,
  PlusCircle,
  Wallet,
  Receipt,
  FileText,
  KeyRound,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/cn";
import { useLanguage } from "@/components/language-provider";
import { useSidebar } from "@/components/sidebar-context";

type Label = { is: string; en: string };

type Leaf = {
  kind: "leaf";
  href: string;
  label: Label;
  icon: LucideIcon;
};

type Group = {
  kind: "group";
  basePath: string; // routes starting with this are considered "in this group"
  label: Label;
  icon: LucideIcon;
  children: NavItem[];
  // Optional landing route the label itself navigates to. When set, clicking
  // the label navigates AND opens the group; chevron is the only collapse
  // toggle. When unset, the label is a pure expand/collapse button.
  defaultHref?: string;
};

type NavItem = Leaf | Group;

const nav: NavItem[] = [
  {
    kind: "leaf",
    href: "/dashboard",
    label: { is: "Dashboard", en: "Dashboard" },
    icon: LayoutDashboard,
  },
  {
    kind: "group",
    basePath: "/sites",
    label: { is: "Operations", en: "Operations" },
    icon: MapPin,
    defaultHref: "/sites",
    children: [
      {
        kind: "leaf",
        href: "/sites",
        label: { is: "Sites", en: "Sites" },
        icon: MapPin,
      },
      {
        kind: "leaf",
        href: "/installations",
        label: { is: "Installations", en: "Installations" },
        icon: Plug,
      },
      {
        kind: "leaf",
        href: "/circuits",
        label: { is: "Circuits", en: "Circuits" },
        icon: Cable,
      },
      {
        kind: "leaf",
        href: "/chargers",
        label: { is: "Chargers", en: "Chargers" },
        icon: Zap,
      },
    ],
  },
  {
    kind: "group",
    basePath: "/tenants",
    label: { is: "Tenants", en: "Tenants" },
    icon: Briefcase,
    defaultHref: "/tenants",
    children: [
      {
        kind: "leaf",
        href: "/tenants/organizations",
        label: { is: "Organizations", en: "Organizations" },
        icon: Network,
      },
      {
        kind: "leaf",
        href: "/tenants/properties",
        label: { is: "Properties", en: "Properties" },
        icon: Building2,
      },
      {
        kind: "leaf",
        href: "/people/users",
        label: { is: "Users", en: "Users" },
        icon: UserCog,
      },
    ],
  },
  {
    kind: "group",
    basePath: "/billing",
    label: { is: "Billing", en: "Billing" },
    icon: Wallet,
    defaultHref: "/billing",
    children: [
      {
        kind: "leaf",
        href: "/billing/cost-factors",
        label: { is: "Cost factors", en: "Cost factors" },
        icon: Receipt,
      },
      {
        kind: "leaf",
        href: "/billing/tariffs",
        label: { is: "Tariffs", en: "Tariffs" },
        icon: Receipt,
      },
      {
        kind: "leaf",
        href: "/billing/cost-centers",
        label: { is: "Cost centers", en: "Cost centers" },
        icon: Wallet,
      },
      {
        kind: "leaf",
        href: "/billing/contracts",
        label: { is: "Contracts", en: "Contracts" },
        icon: FileText,
      },
      {
        kind: "leaf",
        href: "/billing/driver-contracts",
        label: { is: "Driver contracts", en: "Driver contracts" },
        icon: FileText,
      },
      {
        kind: "leaf",
        href: "/billing/dso",
        label: { is: "DSO rates", en: "DSO rates" },
        icon: Cable,
      },
      {
        kind: "leaf",
        href: "/billing/electricity",
        label: { is: "Electricity rates", en: "Electricity rates" },
        icon: Lightbulb,
      },
    ],
  },
  {
    kind: "group",
    basePath: "/onboard",
    label: { is: "Onboard", en: "Onboard" },
    icon: PlusCircle,
    children: [
      {
        kind: "leaf",
        href: "/onboard",
        label: { is: "Test chain (utility)", en: "Test chain (utility)" },
        icon: PlusCircle,
      },
      {
        kind: "leaf",
        href: "/onboard/zaptec",
        label: { is: "Zaptec wizard", en: "Zaptec wizard" },
        icon: Zap,
      },
      {
        kind: "leaf",
        href: "/onboard/credentials",
        label: { is: "Vendor credentials", en: "Vendor credentials" },
        icon: KeyRound,
      },
    ],
  },
  {
    kind: "group",
    basePath: "/reference",
    label: { is: "Reference", en: "Reference" },
    icon: BookOpen,
    children: [
      {
        kind: "group",
        basePath: "/reference/electricity",
        label: { is: "Rafmagn", en: "Electricity" },
        icon: Zap,
        children: [
          {
            kind: "leaf",
            href: "/reference/electricity/dso",
            label: { is: "Dreifiveitur", en: "DSO" },
            icon: Cable,
          },
          {
            kind: "leaf",
            href: "/reference/electricity/retailers",
            label: { is: "Söluaðilar", en: "Electricity" },
            icon: Lightbulb,
          },
          {
            kind: "leaf",
            href: "/reference/electricity/tso",
            label: { is: "Landsnet", en: "TSO" },
            icon: RadioTower,
          },
        ],
      },
      {
        kind: "leaf",
        href: "/reference/public-charging",
        label: { is: "Almenningshleðsla", en: "Public Charging" },
        icon: MapPin,
      },
      {
        kind: "leaf",
        href: "/reference/rental-service",
        label: { is: "Hleðsluleiga", en: "Rental Service" },
        icon: Building2,
      },
      {
        kind: "group",
        basePath: "/reference/api",
        label: { is: "API tilvísun", en: "API Reference" },
        icon: Code2,
        children: [
          {
            kind: "leaf",
            href: "/reference/zaptec-api",
            label: { is: "Zaptec API", en: "Zaptec API" },
            icon: Zap,
          },
          {
            kind: "leaf",
            href: "/reference/easee-api",
            label: { is: "Easee API", en: "Easee API" },
            icon: Plug,
          },
        ],
      },
    ],
  },
  {
    kind: "leaf",
    href: "/mobile-app",
    label: { is: "Mobile App", en: "Mobile App" },
    icon: Smartphone,
  },
  {
    kind: "leaf",
    href: "/technical-read",
    label: { is: "Technical Read", en: "Technical Read" },
    icon: Wrench,
  },
];

function collectGroupBasePaths(items: NavItem[], acc: string[] = []): string[] {
  for (const it of items) {
    if (it.kind === "group") {
      acc.push(it.basePath);
      collectGroupBasePaths(it.children, acc);
    }
  }
  return acc;
}
const ALL_GROUP_BASE_PATHS = collectGroupBasePaths(nav);
const STORAGE_KEY = "straumvakt:sidebar:openGroups";

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

type RenderContext = {
  pathname: string;
  language: "is" | "en";
  close: () => void;
  isGroupOpen: (basePath: string) => boolean;
  toggleGroup: (basePath: string) => void;
};

function NavLeaf({ item, ctx, depth }: { item: Leaf; ctx: RenderContext; depth: number }) {
  const active = ctx.pathname === item.href || ctx.pathname.startsWith(item.href + "/");
  const Icon = item.icon;
  if (depth === 0) {
    return (
      <Link
        href={item.href as Parameters<typeof Link>[0]["href"]}
        title={item.label[ctx.language]}
        onClick={ctx.close}
        className={cn(
          "flex min-h-[40px] items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
          "md:justify-center md:px-0 lg:justify-start lg:px-3",
          active
            ? "bg-brand-500/15 text-sv-sky ring-1 ring-inset ring-brand-500/25"
            : "text-ink-300 hover:bg-bg-raised hover:text-ink-50",
        )}
      >
        <Icon className={cn("h-5 w-5 shrink-0", active ? "text-sv-green" : "text-ink-400")} />
        <span className="md:hidden lg:block">{item.label[ctx.language]}</span>
      </Link>
    );
  }
  return (
    <Link
      href={item.href as Parameters<typeof Link>[0]["href"]}
      title={item.label[ctx.language]}
      onClick={ctx.close}
      className={cn(
        "flex min-h-[34px] items-center gap-3 rounded-md px-3 py-1.5 text-sm transition-colors",
        "md:justify-center md:px-0 lg:justify-start lg:px-3",
        active
          ? "bg-brand-500/15 text-sv-sky ring-1 ring-inset ring-brand-500/25"
          : "text-ink-300 hover:bg-bg-raised hover:text-ink-50",
      )}
    >
      <Icon className={cn("h-4 w-4 shrink-0", active ? "text-sv-green" : "text-ink-500")} />
      <span className="md:hidden lg:block">{item.label[ctx.language]}</span>
    </Link>
  );
}

function NavGroup({ item, ctx, depth }: { item: Group; ctx: RenderContext; depth: number }) {
  const active = ctx.pathname.startsWith(item.basePath);
  const open = ctx.isGroupOpen(item.basePath);
  const GroupIcon = item.icon;
  const labelClasses = cn(
    "flex w-full items-center gap-2 rounded-md px-3 text-[10px] font-semibold uppercase tracking-brand transition-colors",
    depth === 0 ? "min-h-[36px] py-1.5" : "min-h-[28px] py-1 text-[9px]",
    "md:justify-center md:px-0 lg:justify-start lg:px-3",
    active ? "text-sv-sky" : "text-ink-400",
    "hover:bg-bg-raised hover:text-ink-50",
  );
  const iconEl = (
    <GroupIcon
      className={cn(
        "shrink-0",
        depth === 0 ? "h-5 w-5" : "h-4 w-4",
        active ? "text-sv-green" : "text-ink-500",
      )}
    />
  );
  const chevronEl = (
    <ChevronRight
      className={cn(
        "h-3.5 w-3.5 shrink-0 transition-transform duration-150 md:hidden lg:block",
        open && "rotate-90",
        active ? "text-sv-sky" : "text-ink-500",
      )}
    />
  );
  return (
    <div className={depth === 0 ? "pt-2" : "pt-1"}>
      {item.defaultHref ? (
        <div className="flex items-stretch">
          <Link
            href={item.defaultHref as Parameters<typeof Link>[0]["href"]}
            title={item.label[ctx.language]}
            onClick={() => {
              if (!open) ctx.toggleGroup(item.basePath);
              ctx.close();
            }}
            className={cn(labelClasses, "flex-1")}
          >
            {iconEl}
            <span className="flex-1 text-left md:hidden lg:block">
              {item.label[ctx.language]}
            </span>
          </Link>
          <button
            type="button"
            aria-label={`Toggle ${item.label[ctx.language]}`}
            aria-expanded={open}
            onClick={(e) => {
              e.preventDefault();
              ctx.toggleGroup(item.basePath);
            }}
            className={cn(
              "ml-0.5 flex w-7 items-center justify-center rounded-md transition-colors",
              "hover:bg-bg-raised md:hidden lg:flex",
            )}
          >
            {chevronEl}
          </button>
        </div>
      ) : (
        <button
          type="button"
          title={item.label[ctx.language]}
          onClick={() => ctx.toggleGroup(item.basePath)}
          aria-expanded={open}
          className={labelClasses}
        >
          {iconEl}
          <span className="flex-1 text-left md:hidden lg:block">
            {item.label[ctx.language]}
          </span>
          {chevronEl}
        </button>
      )}
      {open && (
        <div
          className={cn(
            "space-y-0.5 md:ml-0 md:border-l-0 md:pl-0",
            depth === 0
              ? "ml-2 border-l border-bg-border/60 pl-2 lg:ml-2 lg:border-l lg:pl-2"
              : "ml-3 border-l border-bg-border/40 pl-2 lg:ml-3 lg:border-l lg:pl-2",
          )}
        >
          {item.children.map((child) =>
            child.kind === "leaf" ? (
              <NavLeaf key={child.href} item={child} ctx={ctx} depth={depth + 1} />
            ) : (
              <NavGroup key={child.basePath} item={child} ctx={ctx} depth={depth + 1} />
            ),
          )}
        </div>
      )}
    </div>
  );
}

export function Sidebar() {
  const { language } = useLanguage();
  const { mobileOpen, close } = useSidebar();
  const pathname = usePathname();

  // Group open/closed state. Default = all open. Hydrated from localStorage
  // after mount so SSR markup matches the all-open default; first paint may
  // briefly show all-open before reapplying user prefs.
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(ALL_GROUP_BASE_PATHS.map((p) => [p, true])),
  );

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw) as Record<string, boolean>;
      setOpenGroups((prev) => ({ ...prev, ...saved }));
    } catch {
      /* ignore corrupt localStorage */
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(openGroups));
    } catch {
      /* quota / privacy mode */
    }
  }, [openGroups]);

  const toggleGroup = useCallback((basePath: string) => {
    setOpenGroups((prev) => ({ ...prev, [basePath]: !prev[basePath] }));
  }, []);

  const expandAll = useCallback(() => {
    setOpenGroups(Object.fromEntries(ALL_GROUP_BASE_PATHS.map((p) => [p, true])));
  }, []);

  const collapseAll = useCallback(() => {
    setOpenGroups(Object.fromEntries(ALL_GROUP_BASE_PATHS.map((p) => [p, false])));
  }, []);

  // Auto-expand parents of the active route — so deep links don't get
  // hidden behind a collapsed parent. Doesn't override user choice for
  // siblings; only forces ancestors of the current pathname.
  useEffect(() => {
    setOpenGroups((prev) => {
      const next = { ...prev };
      let changed = false;
      for (const basePath of ALL_GROUP_BASE_PATHS) {
        if (
          (pathname === basePath || pathname.startsWith(basePath + "/")) &&
          !next[basePath]
        ) {
          next[basePath] = true;
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [pathname]);

  const isGroupOpen = useCallback(
    (basePath: string) => openGroups[basePath] ?? true,
    [openGroups],
  );

  const ctx: RenderContext = useMemo(
    () => ({ pathname, language, close, isGroupOpen, toggleGroup }),
    [pathname, language, close, isGroupOpen, toggleGroup],
  );

  const allExpanded = ALL_GROUP_BASE_PATHS.every((p) => openGroups[p] !== false);

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

        <div className="border-b border-bg-border/60 px-3 py-2 md:hidden lg:flex lg:items-center lg:justify-between">
          <span className="text-[10px] font-semibold uppercase tracking-brand text-ink-500">
            {language === "is" ? "Yfirlit" : "Navigation"}
          </span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={allExpanded ? collapseAll : expandAll}
              title={
                allExpanded
                  ? language === "is"
                    ? "Loka öllum"
                    : "Collapse all"
                  : language === "is"
                    ? "Opna alla"
                    : "Expand all"
              }
              aria-label={allExpanded ? "Collapse all groups" : "Expand all groups"}
              className="rounded p-1 text-ink-400 transition-colors hover:bg-bg-raised hover:text-ink-50"
            >
              {allExpanded ? (
                <ChevronsDownUp className="h-4 w-4" />
              ) : (
                <ChevronsUpDown className="h-4 w-4" />
              )}
            </button>
          </div>
        </div>

        <nav className="flex-1 space-y-0.5 overflow-y-auto px-2 py-3">
          {nav.map((item) =>
            item.kind === "leaf" ? (
              <NavLeaf key={item.href} item={item} ctx={ctx} depth={0} />
            ) : (
              <NavGroup key={item.basePath} item={item} ctx={ctx} depth={0} />
            ),
          )}
        </nav>

        <div className="border-t border-bg-border px-5 py-4 text-xs text-ink-400 md:hidden lg:block">
          {language === "is" ? "v0.1.0 · Áfangi 2 (næst)" : "v0.1.0 · Sprint 2 (next)"}
        </div>
      </aside>
    </>
  );
}
