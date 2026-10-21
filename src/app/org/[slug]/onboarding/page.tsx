"use client";

import { useEffect, useMemo, useState } from "react";
import { apiFetchJson } from "@/lib/api-client";
import { useOrg } from "../org-shell";
import { AccessPolicyPreview } from "./access-policy-preview";

type Installation = { id: string; onboardingStatus: string };
type Charger = { chargingStationId: string };
type DriverGroup = { id: string };
type Agreement = { id: string; status: string };
type LoadState = {
  installations: Installation[];
  chargers: Charger[];
  groups: DriverGroup[];
  agreements: Agreement[];
};
type Step = {
  title: string;
  detail: string;
  state: "complete" | "in_progress" | "not_started" | "unavailable";
  owner: "Organisation" | "Straumvakt";
};

export default function OrganisationOnboardingPage() {
  const { org } = useOrg();
  const [data, setData] = useState<LoadState | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      apiFetchJson<{ installations: Installation[] }>(
        `/api/admin/orgs/${org.id}/installations`,
      ),
      apiFetchJson<{ chargers: Charger[] }>(
        `/api/admin/orgs/${org.id}/chargers`,
      ),
      apiFetchJson<{ groups: DriverGroup[] }>(
        `/api/admin/orgs/${org.id}/driver-groups`,
      ),
      apiFetchJson<{ agreements: Agreement[] }>(
        `/api/admin/orgs/${org.id}/agreements`,
      ),
    ])
      .then(([installations, chargers, groups, agreements]) => {
        if (!cancelled)
          setData({
            installations: installations.installations,
            chargers: chargers.chargers,
            groups: groups.groups,
            agreements: agreements.agreements,
          });
      })
      .catch((reason) => {
        if (!cancelled)
          setError(reason instanceof Error ? reason.message : String(reason));
      });
    return () => {
      cancelled = true;
    };
  }, [org.id]);

  const steps = useMemo<Step[]>(() => {
    if (!data) return [];
    const activeAgreements = data.agreements.filter(
      (item) => item.status === "active",
    ).length;
    return [
      {
        title: "Organisation",
        detail: "Organisation identity is recorded.",
        state: "complete",
        owner: "Organisation",
      },
      {
        title: "Administrator",
        detail: "You are signed in with organisation administration access.",
        state: "complete",
        owner: "Organisation",
      },
      {
        title: "Commercial terms",
        detail:
          activeAgreements > 0
            ? `${activeAgreements} active agreement${activeAgreements === 1 ? "" : "s"} recorded.`
            : "No active agreement is recorded.",
        state: activeAgreements > 0 ? "complete" : "not_started",
        owner: "Straumvakt",
      },
      {
        title: "Infrastructure",
        detail: `${data.installations.length} installation${data.installations.length === 1 ? "" : "s"} recorded.`,
        state: data.installations.length > 0 ? "complete" : "not_started",
        owner: "Organisation",
      },
      {
        title: "Chargers",
        detail: `${data.chargers.length} charger${data.chargers.length === 1 ? "" : "s"} recorded.`,
        state: data.chargers.length > 0 ? "complete" : "not_started",
        owner: "Straumvakt",
      },
      {
        title: "Driver access",
        detail: `${data.groups.length} driver group${data.groups.length === 1 ? "" : "s"} recorded.`,
        state: data.groups.length > 0 ? "in_progress" : "not_started",
        owner: "Organisation",
      },
      {
        title: "Validation",
        detail: "Activation readiness is not evaluated by the current API.",
        state: "unavailable",
        owner: "Straumvakt",
      },
    ];
  }, [data]);

  return (
    <>
      <section className="org-hero">
        <h1>Onboarding</h1>
        <p>Organisation, infrastructure and driver-access readiness.</p>
      </section>
      {error ? <div className="org-error">{error}</div> : null}
      {data === null && error === null ? (
        <div className="org-card">
          <div className="org-empty">Loading...</div>
        </div>
      ) : null}
      {data ? (
        <>
          <div className="org-onboarding-list">
            {steps.map((step, index) => (
              <section key={step.title} className="org-onboarding-step">
                <div className={`org-step-index ${step.state}`}>
                  {index + 1}
                </div>
                <div>
                  <div className="org-step-owner">{step.owner}</div>
                  <h2>{step.title}</h2>
                  <p>{step.detail}</p>
                </div>
                <span
                  className={`org-badge ${step.state === "complete" ? "ok" : step.state === "unavailable" ? "bad" : "mut"}`}
                >
                  <span className="dot" />
                  {step.state.replace("_", " ")}
                </span>
              </section>
            ))}
          </div>
          <section className="org-card" style={{ marginTop: 14 }}>
            <AccessPolicyPreview />
          </section>
        </>
      ) : null}
    </>
  );
}
