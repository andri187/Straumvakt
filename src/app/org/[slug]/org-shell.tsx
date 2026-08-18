"use client";

// Chrome for the per-org landing template — header, tenant nav, footer.
//
// Entirely driven by the OrgTenantProfile it is handed; there is no
// organisation named anywhere in this file. The tenant's accent is applied
// as three CSS custom properties on the root element, which org-landing.css
// then uses throughout, so a new tenant re-skins the page by adding one
// registry entry in src/lib/org-tenant.ts.
//
// Client component so nav is instant and the resolved org stays mounted
// across child navigations. The org is exposed through context, which is
// how the sub-pages read it without a second /api/admin/orgs/:id fetch.

import Link from "next/link";
import type { Route } from "next";
import { usePathname } from "next/navigation";
import { createContext, useContext, type ReactNode } from "react";
import { apiFetch } from "@/lib/api-client";
import { useLanguage } from "@/components/language-provider";
import {
  orgKindLabel,
  orgSectionLabel,
  type OrgSummary,
  type OrgTenantProfile,
} from "@/lib/org-tenant";

type OrgShellValue = {
  org: OrgSummary;
  tenant: OrgTenantProfile;
  email: string;
};

const OrgCtx = createContext<OrgShellValue | null>(null);

/**
 * The organisation this page is rendering, plus its template parameters.
 * Only valid under OrgShell; every page under /org/[slug] has one.
 */
export function useOrg(): OrgShellValue {
  const value = useContext(OrgCtx);
  if (!value) {
    throw new Error("useOrg must be used inside OrgShell");
  }
  return value;
}

async function signOut() {
  try {
    await apiFetch("/api/admin/logout", { method: "POST" });
  } catch {
    // Clear client state regardless — the cookie is the session.
  }
  window.location.href = "/";
}

export function OrgShell({
  value,
  children,
}: {
  value: OrgShellValue;
  children: ReactNode;
}) {
  const { language } = useLanguage();
  const pathname = usePathname();
  const { org, tenant, email } = value;
  const base = `/org/${tenant.slug}`;

  return (
    <div
      className="org-root"
      style={
        {
          "--org-accent": tenant.accent.base,
          "--org-accent-on": tenant.accent.on,
          "--org-accent-soft": tenant.accent.soft,
        } as React.CSSProperties
      }
    >
      <header className="org-header">
        <div className="org-header-inner">
          {tenant.logoSrc ? (
            <span className="org-logo">
              {/* Plain <img>: the logo path comes from the org row's own
                  branding JSONB and is not known at build time. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={tenant.logoSrc} alt={tenant.wordmark} />
            </span>
          ) : (
            <span className="org-logo monogram">{tenant.monogram}</span>
          )}

          <div className="org-name">
            <span className="truncate">{tenant.wordmark}</span>
            <span className="org-pill">{orgKindLabel(org.kind, language)}</span>
          </div>

          <div className="spacer" />

          <div className="org-by" title="Straumvakt">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/landing/straumvakt-logo-icon.png" alt="" />
            <span>{language === "is" ? "Keyrt á Straumvakt" : "Powered by Straumvakt"}</span>
          </div>

          <button type="button" className="org-linkbtn" onClick={signOut}>
            {language === "is" ? "Útskrá" : "Sign out"}
          </button>
        </div>
      </header>

      <nav className="org-nav">
        <div className="org-nav-inner">
          {tenant.sections.map((section) => {
            const { title } = orgSectionLabel(section.key, language);
            if (!section.built) {
              return (
                <span key={section.key} className="soon">
                  {title}
                </span>
              );
            }
            const href = `${base}${section.path}`;
            const active =
              section.path === ""
                ? pathname === base
                : pathname.startsWith(href);
            return (
              <Link
                key={section.key}
                href={href as Route}
                className={active ? "active" : undefined}
              >
                {title}
              </Link>
            );
          })}
          <span className="spacer" />
        </div>
      </nav>

      <main className="org-main">
        <OrgCtx.Provider value={value}>{children}</OrgCtx.Provider>
      </main>

      <footer className="org-main" style={{ paddingTop: 0 }}>
        <p style={{ color: "#6b7791", fontSize: "0.76rem" }}>
          {language === "is" ? "Skráð(ur) inn sem" : "Signed in as"} {email}
          {org.kennitala ? ` · kt. ${org.kennitala}` : ""}
        </p>
      </footer>
    </div>
  );
}
