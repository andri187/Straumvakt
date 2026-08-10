"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect } from "react";
import { Wrench } from "lucide-react";
import { cn } from "@/lib/cn";

function Mark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 120 120" className={className} fill="none" aria-hidden="true">
      <defs>
        <linearGradient id="zSbBolt" x1="40" y1="20" x2="80" y2="100" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#8EF5C7" />
          <stop offset="100%" stopColor="#6FDCEA" />
        </linearGradient>
      </defs>
      <path d="M 84 18 L 54 18 A 24 24 0 0 0 30 42 L 30 60" stroke="#3EE9A7" strokeWidth="13" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M 36 102 L 66 102 A 24 24 0 0 0 90 78 L 90 60" stroke="#2BB6E8" strokeWidth="13" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M 66 28 L 44 66 L 58 66 L 52 96 L 78 56 L 62 56 Z" fill="url(#zSbBolt)" />
    </svg>
  );
}

const NAV = [
  { href: "/technician", label: "Charger info all", icon: Wrench },
] as const;

export function Sidebar() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const embedded = searchParams?.get("embedded") === "1";

  // Tag <html> so globals.css can drop the layout's md:ml-64 margin
  // on <main>, letting the page render edge-to-edge inside the
  // embedding iframe.
  useEffect(() => {
    if (typeof document === "undefined") return;
    document.documentElement.classList.toggle("embedded", embedded);
    return () => {
      document.documentElement.classList.remove("embedded");
    };
  }, [embedded]);

  if (embedded) return null;

  return (
    <aside className="fixed inset-y-0 left-0 z-40 hidden w-64 shrink-0 flex-col border-r border-bg-border bg-bg-surface md:flex">
      <div className="flex items-center gap-3 border-b border-bg-border px-5 py-5">
        <Mark className="h-9 w-9 shrink-0" />
        <div className="min-w-0">
          <div className="sv-wordmark text-base font-bold leading-tight">Straumvakt</div>
          <div className="sv-tagline">Zaptec enrichment</div>
        </div>
      </div>
      <nav className="flex-1 space-y-0.5 overflow-y-auto px-2 py-4">
        {NAV.map(({ href, label, icon: Icon }) => {
          const active = pathname === href || pathname?.startsWith(href + "/");
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex min-h-[40px] items-center gap-3 rounded-md px-3 py-2 text-sm font-medium",
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
              <span>{label}</span>
            </Link>
          );
        })}
      </nav>
      <div className="border-t border-bg-border px-5 py-4 text-xs text-ink-400">
        Scratch workspace · live data
      </div>
    </aside>
  );
}
