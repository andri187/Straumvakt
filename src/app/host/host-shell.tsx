"use client";

// Host portal shell — client-navigated chrome for the host_admin web
// portal (ADR 0027). Persists across child navigations (App Router keeps
// the layout mounted), so moving between Dashboard/Chargers is instant
// client-side nav with no server round-trip — the smoothness the operator
// console lacks. Provides the resolved host org via context.

import Link from "next/link";
import type { Route } from "next";
import { usePathname } from "next/navigation";
import { createContext, useContext } from "react";

export type HostOrg = {
  orgId: string;
  displayName: string;
  kind: string | null;
  role: string;
};

const OrgCtx = createContext<HostOrg | null>(null);
export function useHostOrg(): HostOrg | null {
  return useContext(OrgCtx);
}

const NAV: { href: Route; label: string }[] = [
  { href: "/host" as Route, label: "Mælaborð" },
  { href: "/host/chargers" as Route, label: "Hleðslustöðvar" },
];

export function HostShell({
  email,
  org,
  children,
}: {
  email: string;
  org: HostOrg;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  return (
    <OrgCtx.Provider value={org}>
      <div className="flex min-h-screen bg-bg-base text-ink-50">
        <aside className="flex w-60 shrink-0 flex-col border-r border-bg-border bg-bg-surface/60 backdrop-blur">
          <div className="flex items-center gap-3 border-b border-bg-border px-5 py-4">
            <div className="grid h-8 w-8 place-items-center rounded-lg bg-gradient-to-br from-sv-green via-sv-teal to-sv-blue text-[13px] font-black text-bg-base">
              S
            </div>
            <div className="leading-tight">
              <div className="sv-wordmark text-sm font-extrabold">Straumvakt</div>
              <div className="sv-tagline">Hýsill · Host</div>
            </div>
          </div>

          <div className="border-b border-bg-border px-5 py-3">
            <div className="text-sm font-bold">{org.displayName}</div>
            <div className="mt-0.5 text-[11px] text-ink-400">
              {org.kind === "company"
                ? "Fyrirtæki"
                : org.kind === "multi_dwelling"
                  ? "Fjölbýli"
                  : "Hýsill"}
            </div>
          </div>

          <nav className="flex-1 px-3 py-3">
            {NAV.map((n) => {
              const href = n.href as string;
              const active = href === "/host" ? pathname === "/host" : pathname.startsWith(href);
              return (
                <Link
                  key={n.href}
                  href={n.href}
                  className={
                    "block rounded-lg px-3 py-2 text-sm font-medium transition-colors " +
                    (active
                      ? "border border-brand-500/40 bg-brand-500/15 text-ink-50"
                      : "border border-transparent text-ink-300 hover:bg-bg-raised hover:text-ink-50")
                  }
                >
                  {n.label}
                </Link>
              );
            })}
          </nav>

          <div className="border-t border-bg-border px-5 py-3 text-[12px] text-ink-400">
            <div className="truncate">{email}</div>
            <div>Host admin</div>
          </div>
        </aside>

        <main className="min-w-0 flex-1 overflow-x-hidden p-7">{children}</main>
      </div>
    </OrgCtx.Provider>
  );
}
