"use client";

// Per-org landing page — the "overview" section of the template.
//
// The organisation is whatever the layout resolved; this file reads it
// from context and never names a tenant. All data comes from the
// org-scoped endpoints a host_admin can actually reach (each is gated by
// requirePermission(..., { orgIdParam }) in apps/api/src/routes/admin/orgs.ts,
// so the org id in the path is also the tenant boundary):
//
//   GET /api/admin/orgs/:id/sessions        billing.read  → month + lifetime totals, recent
//   GET /api/admin/orgs/:id/chargers        charger.read  → stations + online flag
//   GET /api/admin/orgs/:id/installations   site.read     → installations
//
// Every one of those verbs is in HOST_ADMIN_BUNDLE
// (apps/api/src/lib/auth/permissions.ts), so a host_admin sees the whole
// page. Panels degrade individually: a failing fetch shows its own notice
// rather than blanking the page.

import { useEffect, useState } from "react";
import Link from "next/link";
import type { Route } from "next";
import { apiFetchJson } from "@/lib/api-client";
import { useLanguage } from "@/components/language-provider";
import { getLocale } from "@/lib/i18n";
import { orgSectionLabel } from "@/lib/org-tenant";
import { useOrg } from "./org-shell";

type Charger = {
  chargingStationId: string;
  identityString?: string;
  installationDisplayName?: string | null;
  online?: boolean;
};

type Installation = { id: string; displayName: string };

type RecentSession = {
  id: string;
  startedAt: string;
  station: string;
  energyKwh: number | null;
  status: string;
};

type SessionSummary = {
  totalCount: number;
  totalEnergyKwh: number;
  monthCount: number;
  monthEnergyKwh: number;
  recent: RecentSession[];
};

function sessionBadge(
  status: string,
  language: "is" | "en",
): { cls: string; label: string } {
  const map: Record<string, { cls: string; is: string; en: string }> = {
    in_progress: { cls: "ok", is: "Í hleðslu", en: "Charging" },
    completed: { cls: "ok", is: "Lokið", en: "Completed" },
    faulted: { cls: "bad", is: "Bilun", en: "Faulted" },
    aborted: { cls: "bad", is: "Hætt við", en: "Aborted" },
  };
  const hit = map[status];
  if (!hit) {
    return { cls: "mut", label: language === "is" ? "Óþekkt" : "Unknown" };
  }
  return { cls: hit.cls, label: language === "is" ? hit.is : hit.en };
}

export default function OrgOverviewPage() {
  const { org, tenant } = useOrg();
  const { language } = useLanguage();
  const locale = getLocale(language);
  const t = (is: string, en: string) => (language === "is" ? is : en);

  const [chargers, setChargers] = useState<Charger[] | null>(null);
  const [installations, setInstallations] = useState<Installation[] | null>(null);
  const [sessions, setSessions] = useState<SessionSummary | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const orgId = org.id;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [ch, ins, se] = await Promise.all([
          apiFetchJson<{ chargers: Charger[] }>(
            `/api/admin/orgs/${orgId}/chargers`,
          ),
          apiFetchJson<{ installations: Installation[] }>(
            `/api/admin/orgs/${orgId}/installations`,
          ),
          apiFetchJson<{ summary: SessionSummary }>(
            `/api/admin/orgs/${orgId}/sessions`,
          ),
        ]);
        if (cancelled) return;
        setChargers(ch.chargers);
        setInstallations(ins.installations);
        setSessions(se.summary);
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [orgId]);

  const total = chargers?.length ?? 0;
  const online = chargers?.filter((c) => c.online).length ?? 0;
  const num = (n: number) => n.toLocaleString(locale);
  const stationsIn = (name: string) =>
    chargers?.filter((c) => (c.installationDisplayName ?? "") === name).length ?? 0;

  return (
    <>
      <section className="org-hero">
        <h1>{tenant.wordmark}</h1>
        <p>{tenant.tagline[language]}</p>
      </section>

      {err && <div className="org-error">{err}</div>}

      <div className="org-grid g4" style={{ marginBottom: 14 }}>
        <Kpi
          label={t("Orka í mánuðinum", "Energy this month")}
          value={sessions ? `${num(sessions.monthEnergyKwh)} kWh` : null}
          accent
        />
        <Kpi
          label={t("Hleðslur í mánuðinum", "Sessions this month")}
          value={sessions ? num(sessions.monthCount) : null}
        />
        <Kpi
          label={t("Stöðvar", "Stations")}
          value={chargers === null ? null : `${num(online)} / ${num(total)}`}
          sub={t("nettengdar", "online")}
        />
        <Kpi
          label={t("Hleðslur alls", "Sessions all time")}
          value={sessions ? num(sessions.totalCount) : null}
        />
      </div>

      <div className="org-grid g2" style={{ marginBottom: 14 }}>
        <div className="org-card">
          <div className="org-card-h">
            {t("Uppsetningar", "Installations")}
            <span className="sub">
              {installations ? num(installations.length) : ""}
            </span>
          </div>
          <table>
            <thead>
              <tr>
                <th>{t("Uppsetning", "Installation")}</th>
                <th>{t("Stöðvar", "Stations")}</th>
                <th>{t("Staða", "Status")}</th>
              </tr>
            </thead>
            <tbody>
              {installations === null && (
                <tr>
                  <td colSpan={3} className="empty">
                    {t("Hleð…", "Loading…")}
                  </td>
                </tr>
              )}
              {installations?.length === 0 && (
                <tr>
                  <td colSpan={3} className="empty">
                    {t("Engar uppsetningar.", "No installations.")}
                  </td>
                </tr>
              )}
              {installations?.map((i) => {
                const n = stationsIn(i.displayName);
                return (
                  <tr key={i.id}>
                    <td>
                      <strong>{i.displayName}</strong>
                    </td>
                    <td>{num(n)}</td>
                    <td>
                      <span className={"org-badge " + (n > 0 ? "ok" : "mut")}>
                        <span className="dot" />
                        {n > 0
                          ? t("Virk", "Active")
                          : t("Engar stöðvar", "No stations")}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="org-card" style={{ alignSelf: "start" }}>
          <div className="org-card-h">
            {t("Staða stöðva", "Station status")}
            <span className="sub">
              {chargers === null
                ? ""
                : t(`${num(total)} stöðvar`, `${num(total)} stations`)}
            </span>
          </div>
          {chargers === null ? (
            <div className="org-empty">{t("Hleð…", "Loading…")}</div>
          ) : chargers.length === 0 ? (
            <div className="org-empty">
              {t("Engar stöðvar skráðar.", "No stations registered.")}
            </div>
          ) : (
            <div className="org-stations">
              {chargers.slice(0, 24).map((c) => (
                <div
                  key={c.chargingStationId}
                  className={"org-station " + (c.online ? "ok" : "bad")}
                  title={c.identityString ?? c.chargingStationId}
                >
                  <div className="id">
                    {(c.identityString ?? c.chargingStationId).slice(-4)}
                  </div>
                  {c.online ? t("Nettengd", "Online") : t("Ótengd", "Offline")}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="org-card" style={{ marginBottom: 14 }}>
        <div className="org-card-h">
          {t("Nýlegar hleðslur", "Recent sessions")}
          <span className="sub">{t("síðustu 10", "last 10")}</span>
        </div>
        <table>
          <thead>
            <tr>
              <th>{t("Stöð", "Station")}</th>
              <th>{t("Orka", "Energy")}</th>
              <th>{t("Staða", "Status")}</th>
              <th>{t("Tími", "Time")}</th>
            </tr>
          </thead>
          <tbody>
            {sessions === null && (
              <tr>
                <td colSpan={4} className="empty">
                  {t("Hleð…", "Loading…")}
                </td>
              </tr>
            )}
            {sessions?.recent.length === 0 && (
              <tr>
                <td colSpan={4} className="empty">
                  {t("Engar hleðslur enn.", "No sessions yet.")}
                </td>
              </tr>
            )}
            {sessions?.recent.map((s) => {
              const b = sessionBadge(s.status, language);
              return (
                <tr key={s.id}>
                  <td className="mono">{s.station}</td>
                  <td>
                    {s.energyKwh === null ? "—" : `${num(s.energyKwh)} kWh`}
                  </td>
                  <td>
                    <span className={"org-badge " + b.cls}>
                      <span className="dot" />
                      {b.label}
                    </span>
                  </td>
                  <td style={{ color: "var(--dim)" }}>
                    {s.startedAt.slice(0, 16).replace("T", " ")}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Section cards. Which ones appear, and which are live, is the
          tenant's section list from src/lib/org-tenant.ts. */}
      <div className="org-grid g3">
        {tenant.sections
          .filter((s) => s.key !== "overview")
          .map((section) => {
            const { title, blurb } = orgSectionLabel(section.key, language);
            const body = (
              <>
                <div className="t">
                  {title}
                  {!section.built && (
                    <span className="org-tag-soon">
                      {t("væntanlegt", "soon")}
                    </span>
                  )}
                </div>
                <div className="b">{blurb}</div>
              </>
            );
            return section.built ? (
              <Link
                key={section.key}
                href={`/org/${tenant.slug}${section.path}` as Route}
                className="org-section"
              >
                {body}
              </Link>
            ) : (
              <div key={section.key} className="org-section soon">
                {body}
              </div>
            );
          })}
      </div>
    </>
  );
}

function Kpi({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string | null;
  sub?: string;
  accent?: boolean;
}) {
  return (
    <div className="org-card org-kpi">
      <div className="lbl">{label}</div>
      <div className={"val" + (accent ? " accent" : "")}>{value ?? "—"}</div>
      {sub && <div className="sub">{sub}</div>}
    </div>
  );
}
