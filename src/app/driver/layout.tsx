"use client";

// Driver web portal shell (ADR 0033) — reuses the host design system
// (host.css / .host-root) with a driver-specific nav. Client-gated on the
// bearer token; /driver/login renders bare (outside the shell).

import "../host/host.css";
import Link from "next/link";
import type { Route } from "next";
import { usePathname, useRouter } from "next/navigation";
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import {
  getDriverToken,
  clearDriverToken,
  driverFetch,
  DriverAuthError,
  type DriverProfile,
} from "./driver-auth";

const MeCtx = createContext<DriverProfile | null>(null);
export function useDriverMe(): DriverProfile | null {
  return useContext(MeCtx);
}

const I = {
  dash: (
    <svg viewBox="0 0 24 24">
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
    </svg>
  ),
  bolt: (
    <svg viewBox="0 0 24 24">
      <path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z" />
    </svg>
  ),
  cal: (
    <svg viewBox="0 0 24 24">
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <path d="M16 2v4M8 2v4M3 10h18" />
    </svg>
  ),
  receipt: (
    <svg viewBox="0 0 24 24">
      <path d="M5 2h14a1 1 0 0 1 1 1v18l-3-2-3 2-3-2-3 2V3a1 1 0 0 1 1-1Z" />
      <path d="M8 7h8M8 11h8M8 15h5" />
    </svg>
  ),
  users: (
    <svg viewBox="0 0 24 24">
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
    </svg>
  ),
  key: (
    <svg viewBox="0 0 24 24">
      <circle cx="7.5" cy="15.5" r="4.5" />
      <path d="m10.5 12.5 8-8M16 7l3 3" />
    </svg>
  ),
  plus: (
    <svg viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8v8M8 12h8" />
    </svg>
  ),
  gear: (
    <svg viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  ),
};

type Item = { label: string; href?: Route; icon: ReactNode; soon?: boolean };
const SECTIONS: { label: string; items: Item[] }[] = [
  {
    label: "Yfirlit",
    items: [
      { label: "Mælaborð", href: "/driver" as Route, icon: I.dash },
    ],
  },
  {
    label: "Mín notkun",
    items: [
      { label: "Hleðslusaga", href: "/driver/history" as Route, icon: I.cal },
      { label: "Kostnaður", href: "/driver/cost" as Route, icon: I.receipt },
      { label: "Fjölskylda", icon: I.users, soon: true },
    ],
  },
  {
    label: "Aðgangur",
    items: [
      { label: "Mínir aðgangar", href: "/driver/access" as Route, icon: I.key },
      { label: "Leysa inn boð", href: "/driver/redeem" as Route, icon: I.plus },
    ],
  },
  {
    label: "Annað",
    items: [
      { label: "Stillingar", href: "/driver/settings" as Route, icon: I.gear },
    ],
  },
];

export default function DriverLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  if (pathname === "/driver/login") return <>{children}</>;
  return <DriverShell>{children}</DriverShell>;
}

function DriverShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [me, setMe] = useState<DriverProfile | null>(null);
  const [ready, setReady] = useState(false);
  const [navOpen, setNavOpen] = useState(false);

  useEffect(() => {
    if (!getDriverToken()) {
      router.replace("/driver/login" as Route);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const m = await driverFetch<DriverProfile>("/api/driver/me");
        if (cancelled) return;
        setMe(m);
        setReady(true);
      } catch (e) {
        if (e instanceof DriverAuthError) {
          router.replace("/driver/login" as Route);
        } else if (!cancelled) {
          setReady(true); // show shell; pages surface their own errors
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  function logout() {
    clearDriverToken();
    router.replace("/driver/login" as Route);
  }

  if (!ready) {
    return (
      <div className="host-root">
        <div className="login-wrap">
          <div className="sub">Hleð…</div>
        </div>
      </div>
    );
  }

  const name = me?.displayName || me?.email || "Ökumaður";
  const initials = name.slice(0, 2).toUpperCase();

  return (
    <div className="host-root">
      <div className="shell">
        <aside className={"sidebar" + (navOpen ? " open" : "")}>
          <div className="brand">
            <img className="logo" src="/landing/straumvakt-logo-icon.png" alt="Straumvakt" />
            <div className="word">
              <strong>Straumvakt</strong>
              <span>Ökumaður · Driver</span>
            </div>
          </div>
          <nav className="nav">
            {SECTIONS.map((sec) => (
              <div key={sec.label}>
                <div className="nav-label">{sec.label}</div>
                {sec.items.map((it) => {
                  const active = it.href
                    ? (it.href as string) === "/driver"
                      ? pathname === "/driver"
                      : pathname.startsWith(it.href as string)
                    : false;
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
                      onClick={() => setNavOpen(false)}
                    >
                      {inner}
                    </Link>
                  ) : (
                    <div
                      key={it.label}
                      className="nav-item"
                      style={{ opacity: 0.65 }}
                    >
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
              <div style={{ color: "var(--soft)", fontWeight: 600 }}>
                {name}
              </div>
              <div>Ökumaður</div>
            </div>
          </div>
        </aside>
        {navOpen && (
          <div
            className="sidebar-backdrop"
            onClick={() => setNavOpen(false)}
          />
        )}

        <div className="main">
          <div className="topbar">
            <button
              className="hamb"
              type="button"
              aria-label="Valmynd"
              onClick={() => setNavOpen((v) => !v)}
            >
              ☰
            </button>
            <div className="org">{me?.organizationName || "Mín hleðsla"}</div>
            <div className="spacer" />
            <button
              className="tlink"
              onClick={logout}
              style={{ background: "none", border: 0 }}
            >
              Útskrá
            </button>
          </div>
          <div className="content">
            <MeCtx.Provider value={me}>{children}</MeCtx.Provider>
          </div>
        </div>
      </div>
    </div>
  );
}
