"use client";

import { useEffect, useMemo, useState } from "react";
import { apiFetchJson } from "@/lib/api-client";
import { useOrg } from "../org-shell";

type Membership = {
  membershipId: string;
  agreementId: string;
  agreementDisplayName: string;
  agreementType: string;
  agreementStatus: string;
  driverGroupName: string;
};

type CostFactor = {
  id: string;
  code: string;
  displayName: string;
  description: string | null;
  anchorTier: string;
  defaultVatRatePct: string;
  defaultCurrency: string;
  status: string;
  tariffCount: number;
};

type CostFactorGroup = { anchor: string; factors: CostFactor[] };

export default function OrgAgreementsPage() {
  const { org } = useOrg();
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [factorGroups, setFactorGroups] = useState<CostFactorGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      apiFetchJson<{ memberships: Membership[] }>(
        `/api/admin/billing/driver-contracts?orgId=${org.id}`,
      ),
      apiFetchJson<{ byAnchor: CostFactorGroup[] }>(
        "/api/admin/billing/cost-factors",
      ),
    ])
      .then(([membershipBody, factorBody]) => {
        if (cancelled) return;
        setMemberships(membershipBody.memberships);
        setFactorGroups(factorBody.byAnchor);
      })
      .catch((caught) => {
        if (!cancelled)
          setError(caught instanceof Error ? caught.message : String(caught));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [org.id]);

  const agreements = useMemo(() => {
    const byId = new Map<
      string,
      {
        id: string;
        name: string;
        type: string;
        status: string;
        groups: Set<string>;
        members: number;
      }
    >();
    for (const membership of memberships) {
      const current = byId.get(membership.agreementId) ?? {
        id: membership.agreementId,
        name: membership.agreementDisplayName,
        type: membership.agreementType,
        status: membership.agreementStatus,
        groups: new Set<string>(),
        members: 0,
      };
      current.groups.add(membership.driverGroupName);
      current.members += 1;
      byId.set(current.id, current);
    }
    return [...byId.values()];
  }, [memberships]);

  const factors = factorGroups.flatMap((group) => group.factors);

  return (
    <>
      <section className="org-page-head">
        <div>
          <div className="org-eyebrow">Commercial configuration</div>
          <h1>Agreements and cost factors</h1>
          <p>
            Current assignments are visible; changing driver pricing is not
            exposed in this surface.
          </p>
        </div>
      </section>
      {error ? <div className="org-error">{error}</div> : null}
      <div className="org-grid g4" style={{ marginBottom: 14 }}>
        <AgreementMetric
          label="Agreements in use"
          value={loading ? null : agreements.length}
        />
        <AgreementMetric
          label="Driver memberships"
          value={loading ? null : memberships.length}
          accent
        />
        <AgreementMetric
          label="Cost factors"
          value={loading ? null : factors.length}
        />
        <AgreementMetric
          label="Active factors"
          value={
            loading
              ? null
              : factors.filter((factor) => factor.status === "active").length
          }
        />
      </div>
      <div className="org-grid g2 org-align-start">
        <section className="org-card">
          <div className="org-card-h">
            Driver agreements <span className="sub">read only</span>
          </div>
          {loading ? (
            <div className="org-empty">Loading...</div>
          ) : agreements.length === 0 ? (
            <div className="org-empty">No driver agreement is assigned.</div>
          ) : (
            <div className="org-compact-list">
              {agreements.map((agreement) => (
                <article key={agreement.id}>
                  <div>
                    <strong>{agreement.name}</strong>
                    <span>
                      {agreement.type.replaceAll("_", " ")} | {agreement.status}
                    </span>
                  </div>
                  <div className="org-list-metric">
                    <strong>{agreement.members}</strong>
                    <span>{agreement.groups.size} groups</span>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
        <section className="org-card">
          <div className="org-card-h">
            Cost-factor catalogue <span className="sub">platform-defined</span>
          </div>
          {loading ? (
            <div className="org-empty">Loading...</div>
          ) : factors.length === 0 ? (
            <div className="org-empty">No cost factors configured.</div>
          ) : (
            <div className="org-compact-list">
              {factors.slice(0, 12).map((factor) => (
                <article key={factor.id}>
                  <div>
                    <strong>{factor.displayName}</strong>
                    <span>
                      {factor.code} | {factor.anchorTier.replaceAll("_", " ")}
                    </span>
                  </div>
                  <div className="org-list-metric">
                    <strong>{factor.tariffCount}</strong>
                    <span>tariffs</span>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      </div>
      <section className="org-blocked-panel">
        <div>
          <div className="org-eyebrow">Driver cost assignment</div>
          <h2>Editing needs a narrow assignment contract</h2>
          <p>
            The API can report membership and agreement state, but this UI has
            no safe command for assigning a cost factor with an effective date,
            preview and rollback.
          </p>
        </div>
        <button type="button" disabled>
          Edit driver pricing
        </button>
      </section>
    </>
  );
}

function AgreementMetric({
  label,
  value,
  accent = false,
}: {
  label: string;
  value: number | null;
  accent?: boolean;
}) {
  return (
    <div className="org-card org-kpi">
      <div className="lbl">{label}</div>
      <div className={`val${accent ? " accent" : ""}`}>{value ?? "-"}</div>
    </div>
  );
}
