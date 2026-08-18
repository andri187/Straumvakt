"use client";

// Per-org landing template — "Organisation" section.
//
// The org's own record as Straumvakt holds it. Read-only by design: org
// profile edits are an operator action (ADR 0027), which is why the parked
// host console's settings page was read-only too.
//
// No fetching here at all — every field comes from the OrgSummary the
// layout already loaded and put on context. That is the point of this page
// as a template example: a sub-route gets the whole organisation for free.

import { useOrg } from "../org-shell";
import { useLanguage } from "@/components/language-provider";
import { orgKindLabel, type OrgAddress } from "@/lib/org-tenant";

function formatAddress(address: OrgAddress): string | null {
  if (!address) return null;
  const line = [address.street, [address.postalCode, address.city].filter(Boolean).join(" ")]
    .filter((part) => part && part.length > 0)
    .join(", ");
  return line.length > 0 ? line : null;
}

export default function OrgProfilePage() {
  const { org, tenant } = useOrg();
  const { language } = useLanguage();
  const t = (is: string, en: string) => (language === "is" ? is : en);
  const dash = "—";

  const postal = formatAddress(org.postalAddress);
  const legal = formatAddress(org.legalAddress);

  return (
    <>
      <section className="org-hero">
        <h1>{t("Fyrirtækið", "Organisation")}</h1>
        <p>
          {t(
            "Skráningin eins og Straumvakt heldur henni. Breytingar á skráningu eru í höndum Straumvaktar.",
            "Your registration as Straumvakt holds it. Changes to the registration are made by Straumvakt.",
          )}
        </p>
      </section>

      <div className="org-grid g2">
        <div className="org-card">
          <div className="org-card-h">{t("Skráning", "Registration")}</div>
          <div className="org-card-b">
            <dl>
              <Kv k={t("Nafn", "Name")} v={org.displayName} />
              <Kv k={t("Lögheiti", "Legal name")} v={org.legalName ?? dash} />
              <Kv k={t("Kennitala", "Kennitala")} v={org.kennitala ?? dash} />
              <Kv k={t("Rekstrarform", "Legal form")} v={org.legalForm ?? dash} />
              <Kv k={t("VSK-nr.", "VAT no.")} v={org.vskNr ?? dash} />
              <Kv k={t("Tegund", "Kind")} v={orgKindLabel(org.kind, language)} />
              <Kv
                k={t("Hlutverk", "Roles")}
                v={org.roles.length > 0 ? org.roles.join(", ") : dash}
              />
              <Kv k={t("Staða", "Status")} v={org.status} />
            </dl>
          </div>
        </div>

        <div className="org-card">
          <div className="org-card-h">{t("Staðsetning", "Location")}</div>
          <div className="org-card-b">
            <dl>
              <Kv k={t("Póstfang", "Postal address")} v={postal ?? dash} />
              <Kv k={t("Lögheimili", "Registered address")} v={legal ?? dash} />
              <Kv
                k={t("Sveitarfélag", "Municipality")}
                v={org.municipalityName ?? dash}
              />
              <Kv k={t("Land", "Country")} v={org.countryCode ?? dash} />
              <Kv
                k={t("Mynt", "Currency")}
                v={org.defaultCurrency ?? dash}
              />
            </dl>
          </div>
        </div>
      </div>

      <div className="org-grid g2" style={{ marginTop: 14 }}>
        <div className="org-card">
          <div className="org-card-h">{t("Tengiliðir", "Contacts")}</div>
          <div className="org-card-b">
            <dl>
              {/* Typed FK first — it is authoritative over any raw
                  contacts[] entry with role "main" (see the Organization
                  model's comment on `contacts`). */}
              <Kv
                k={t("Aðaltengiliður", "Main contact")}
                v={
                  org.mainContact
                    ? `${org.mainContact.displayName ?? org.mainContact.email} · ${org.mainContact.email}`
                    : dash
                }
              />
              {/* Contact details recorded on branding.contacts — the shape
                  already populated across the org table. */}
              <Kv
                k={t("Vefur", "Website")}
                v={
                  tenant.branding.website ? (
                    <a
                      href={tenant.branding.website}
                      target="_blank"
                      rel="noreferrer noopener"
                      style={{ color: "var(--org-accent)" }}
                    >
                      {tenant.branding.website}
                    </a>
                  ) : (
                    dash
                  )
                }
              />
              <Kv
                k={t("Netfang", "Email")}
                v={
                  tenant.branding.email ? (
                    <a
                      href={`mailto:${tenant.branding.email}`}
                      style={{ color: "var(--org-accent)" }}
                    >
                      {tenant.branding.email}
                    </a>
                  ) : (
                    dash
                  )
                }
              />
              <Kv k={t("Sími", "Phone")} v={tenant.branding.phone ?? dash} />
            </dl>
          </div>
        </div>

        <div className="org-card">
          <div className="org-card-h">
            {t("Skráðir tengiliðir", "Recorded contacts")}
            <span className="sub">{org.contacts.length}</span>
          </div>
          {org.contacts.length === 0 ? (
            <div className="org-empty">
              {t("Engir tengiliðir skráðir.", "No contacts recorded.")}
            </div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>{t("Hlutverk", "Role")}</th>
                  <th>{t("Nafn", "Name")}</th>
                  <th>{t("Samband", "Reach")}</th>
                </tr>
              </thead>
              <tbody>
                {org.contacts.map((c, i) => (
                  <tr key={`${c.role}-${c.name}-${i}`}>
                    <td>{c.role}</td>
                    <td>{c.name}</td>
                    <td>{c.email ?? c.phone ?? dash}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </>
  );
}

function Kv({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="org-kv">
      <dt>{k}</dt>
      <dd>{v}</dd>
    </div>
  );
}
