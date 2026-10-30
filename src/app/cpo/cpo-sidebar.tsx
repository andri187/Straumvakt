"use client";

// Flat left navigation for the CPO workspace (approved presentation: dark
// surface, brand mark, non-collapsible section headings). At narrow widths the
// navigation is opened from a top bar; sign-out stays reachable in both.

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { Route } from "next";
import { usePathname } from "next/navigation";
import {
  Activity,
  Handshake,
  LayoutDashboard,
  Menu,
  MapPin,
  Receipt,
  Settings,
  UserCog,
  X,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { SHELL_LOGOUT_API } from "@/lib/cpo-shell-policy";
import { StraumvaktMark } from "./straumvakt-mark";
import { NAV_GROUPS, SETTINGS_ITEM, type NavIconKey } from "./sections";

const ICONS: Record<NavIconKey, LucideIcon> = {
  overview: LayoutDashboard,
  people: UserCog,
  installations: MapPin,
  chargers: Zap,
  sessions: Activity,
  costs: Receipt,
  agreements: Handshake,
  settings: Settings,
};

const LINK_BASE =
  "flex min-h-[44px] items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors";
const LINK_ACTIVE = "bg-brand-500/15 text-sv-sky ring-1 ring-inset ring-brand-500/25";
const LINK_IDLE = "text-ink-300 hover:bg-bg-raised hover:text-ink-50";

function SignOut({ className }: { className: string }) {
  return (
    <form method="post" action={SHELL_LOGOUT_API}>
      <button type="submit" className={className}>
        Sign out
      </button>
    </form>
  );
}

export function CpoSidebar({ username }: { username: string }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  // A link click navigates; close the narrow-width menu once the route changes.
  useEffect(() => setOpen(false), [pathname]);

  useEffect(() => {
    if (!open) return;
    const focusable = () => Array.from(menuRef.current?.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled])',
    ) ?? []).filter((element) => element.getClientRects().length > 0);
    focusable()[0]?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
      }
      if (event.key === "Tab") {
        const elements = focusable();
        const first = elements[0];
        const last = elements.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    const desktop = window.matchMedia('(min-width: 768px)');
    const onDesktop = () => { if (desktop.matches) setOpen(false); };
    desktop.addEventListener('change', onDesktop);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      desktop.removeEventListener('change', onDesktop);
      if (!desktop.matches) triggerRef.current?.focus();
    };
  }, [open]);

  const settingsActive = pathname === SETTINGS_ITEM.href;
  const SettingsIcon = ICONS.settings;

  return (
    <>
      <div className="flex items-center gap-3 border-b border-bg-border bg-bg-surface px-4 py-3 md:hidden">
        <button
          ref={triggerRef}
          type="button"
          aria-expanded={open}
          aria-controls="cpo-sidebar"
          onClick={() => setOpen((value) => !value)}
          className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-md border border-bg-border text-ink-100"
        >
          {open ? <X aria-hidden="true" className="h-5 w-5" /> : <Menu aria-hidden="true" className="h-5 w-5" />}
          <span className="sr-only">{open ? "Close menu" : "Open menu"}</span>
        </button>
        <StraumvaktMark className="h-8 w-8 shrink-0" gradientId="svMarkBoltBar" />
        <span className="sv-wordmark text-base font-bold">Straumvakt</span>
        <span className="flex-1" />
        <SignOut className="min-h-[44px] rounded-md border border-bg-border px-3 text-sm text-ink-100 hover:bg-bg-raised" />
      </div>

      {open ? (
        <button
          type="button"
          aria-label="Close menu"
          tabIndex={-1}
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-30 bg-black/60 md:hidden"
        />
      ) : null}

      <aside
        ref={menuRef}
        role={open ? "dialog" : undefined}
        aria-modal={open ? true : undefined}
        aria-label={open ? "Workspace navigation" : undefined}
        id="cpo-sidebar"
        className={`${
          open ? "fixed inset-y-0 left-0 z-40 flex" : "hidden"
        } w-64 shrink-0 flex-col border-r border-bg-border bg-bg-surface md:sticky md:top-0 md:z-auto md:flex md:h-screen md:self-start`}
      >
        <div className="flex items-center gap-3 border-b border-bg-border px-5 py-5">
          <StraumvaktMark className="h-9 w-9 shrink-0" />
          <div>
            <div className="sv-wordmark text-base font-bold leading-tight">Straumvakt</div>
            <div className="sv-tagline">Control · Overview · Convenience</div>
          </div>
        </div>

        <div className="flex justify-end px-3 pt-2 md:hidden">
          <button type="button" onClick={() => setOpen(false)} className="flex min-h-[44px] items-center gap-2 rounded-md px-3 text-sm text-ink-100">
            Close menu <X aria-hidden="true" className="h-4 w-4" />
          </button>
        </div>
        <nav aria-label="Main navigation" className="min-h-0 flex-1 overflow-y-auto px-3 py-4">
          {NAV_GROUPS.map((group) => (
            <section key={group.heading} className="mb-6" aria-label={group.heading}>
              <h2 className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-brand text-ink-400">
                {group.heading}
              </h2>
              <div className="space-y-1">
                {group.items.map((item) => {
                  const active = pathname === item.href;
                  const Icon = ICONS[item.key];
                  return (
                    <Link
                      key={item.href}
                      href={item.href as Route}
                      aria-current={active ? "page" : undefined}
                      className={`${LINK_BASE} ${active ? LINK_ACTIVE : LINK_IDLE}`}
                    >
                      <Icon
                        aria-hidden="true"
                        className={`h-5 w-5 shrink-0 ${active ? "text-sv-green" : "text-ink-400"}`}
                      />
                      <span>{item.label}</span>
                    </Link>
                  );
                })}
              </div>
            </section>
          ))}
        </nav>

        <div className="space-y-1 border-t border-bg-border p-3">
          <Link
            href={SETTINGS_ITEM.href as Route}
            aria-current={settingsActive ? "page" : undefined}
            className={`${LINK_BASE} ${settingsActive ? LINK_ACTIVE : LINK_IDLE}`}
          >
            <SettingsIcon aria-hidden="true" className="h-5 w-5 shrink-0" />
            <span>{SETTINGS_ITEM.label}</span>
          </Link>
          <SignOut className={`${LINK_BASE} w-full ${LINK_IDLE}`} />
          <p className="px-3 pt-2 text-xs text-ink-400">
            Signed in as {username} · shared test login
          </p>
        </div>
      </aside>
    </>
  );
}
