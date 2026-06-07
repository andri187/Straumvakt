"use client";

// Host portal shell — ports the host-portal-concept design (sidebar + topbar +
// card system via host.css) onto the real app. Client component so nav is
// instant; persists across child navigations. Provides the resolved host org.

import Link from "next/link";
import type { Route } from "next";
import { usePathname } from "next/navigation";
import { createContext, useContext, type ReactNode } from "react";
import { apiFetch } from "@/lib/api-client";

async function hostLogout() {
  try {
    await apiFetch("/api/admin/logout", { method: "POST" });
  } catch {
    // ignore — clear client state regardless
  }
  window.location.href = "/login";
}

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

type Item = { label: string; href?: Route; icon: ReactNode; soon?: boolean };
type Section = { label: string; items: Item[] };

const I = {
  dash: (
    <svg viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /></svg>
  ),
  bolt: <svg viewBox="0 0 24 24"><path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z" /></svg>,
  plus: <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" /><path d="M12 8v8M8 12h8" /></svg>,
  users: <svg viewBox="0 0 24 24"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></svg>,
  userplus: <svg viewBox="0 0 24 24"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M19 8v6M22 11h-6" /></svg>,
  mail: <svg viewBox="0 0 24 24"><rect x="2" y="4" width="20" height="16" rx="2" /><path d="m22 7-10 5L2 7" /></svg>,
  building: <svg viewBox="0 0 24 24"><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><path d="M9 22V12h6v10" /></svg>,
  file: <svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /><path d="M16 13H8M16 17H8M10 9H8" /></svg>,
  receipt: <svg viewBox="0 0 24 24"><path d="M5 2h14a1 1 0 0 1 1 1v18l-3-2-3 2-3-2-3 2V3a1 1 0 0 1 1-1Z" /><path d="M8 7h8M8 11h8M8 15h5" /></svg>,
  gear: <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></svg>,
};

const SECTIONS: Section[] = [
  {
    label: "Yfirlit",
    items: [
      { label: "Mælaborð", href: "/host" as Route, icon: I.dash },
      { label: "Hleðslustöðvar", href: "/host/chargers" as Route, icon: I.bolt },
      { label: "Setja upp stöð", icon: I.plus, soon: true },
    ],
  },
  {
    label: "Ökumenn",
    items: [
      { label: "Ökumenn", href: "/host/drivers" as Route, icon: I.users },
      { label: "Bjóða ökumanni", href: "/host/invite" as Route, icon: I.userplus },
      { label: "Aðgangsbeiðnir", icon: I.mail, soon: true },
    ],
  },
  {
    label: "Reikningar",
    items: [
      { label: "Einingar & eigendur", icon: I.building, soon: true },
      { label: "Samningar", href: "/host/agreements" as Route, icon: I.file },
      { label: "Reikningar", icon: I.receipt, soon: true },
    ],
  },
  {
    label: "Annað",
    items: [{ label: "Stillingar", href: "/host/settings" as Route, icon: I.gear }],
  },
];

function isActive(pathname: string, href: string): boolean {
  return href === "/host" ? pathname === "/host" : pathname.startsWith(href);
}

export function HostShell({
  email,
  org,
  children,
}: {
  email: string;
  org: HostOrg;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const initials = org.displayName.slice(0, 2).toUpperCase();
  const kindLabel =
    org.kind === "company" ? "Fyrirtæki" : org.kind === "multi_dwelling" ? "Fjölbýli · HOA" : "Hýsill";

  return (
    <div className="host-root">
      <div className="shell">
        <aside className="sidebar">
          <div className="brand">
            <div className="logo">S</div>
            <div className="word">
              <strong>Straumvakt</strong>
              <span>Hýsill · Host</span>
            </div>
          </div>
          <nav className="nav">
            {SECTIONS.map((sec) => (
              <div key={sec.label}>
                <div className="nav-label">{sec.label}</div>
                {sec.items.map((it) => {
                  const active = it.href ? isActive(pathname, it.href) : false;
                  const inner = (
                    <>
                      <span className="ico">{it.icon}</span>
                      {it.label}
                      {it.soon && <span className="tag soon solo">soon</span>}
                    </>
                  );
                  return it.href ? (
                    <Link
                      key={it.label}
                      href={it.href}
                      className={"nav-item" + (active ? " active" : "")}
                    >
                      {inner}
                    </Link>
                  ) : (
                    <div key={it.label} className="nav-item" style={{ opacity: 0.65 }}>
                      {inner}
                    </div>
                  );
                })}
              </div>
            ))}
          </nav>
          <div className="nav-foot">
            <div className="avatar">{initials}</div>
            <div>
              <div style={{ color: "var(--soft)", fontWeight: 600 }}>{email}</div>
              <div>Hýsilstjóri</div>
            </div>
          </div>
        </aside>

        <div className="main">
          <div className="topbar">
            <div className="org">
              {org.displayName}
              <span className="pill host">{kindLabel}</span>
            </div>
            <div className="spacer" />
            <button className="tlink" type="button" onClick={hostLogout} style={{ background: "none", border: 0, cursor: "pointer" }}>Útskrá</button>
          </div>
          <div className="content">
            <OrgCtx.Provider value={org}>{children}</OrgCtx.Provider>
          </div>
        </div>
      </div>
    </div>
  );
}
