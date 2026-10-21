"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ContractGate,
  MetricValue,
  ProductEmpty,
  ProductError,
  ProductLoading,
  StatusBadge,
} from "@/components/product-state";
import { apiFetchJson } from "@/lib/api-client";
import { normalizeStatus, statusTone } from "@/lib/product-ui-guards";
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

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [membershipBody, factorBody] = await Promise.all([
        apiFetchJson<{ memberships: Membership[] }>(
          `/api/admin/billing/driver-contracts?orgId=${org.id}`,
        ),
        apiFetchJson<{ byAnchor: CostFactorGroup[] }>(
          "/api/admin/billing/cost-factors",
        ),
      ]);
      setMemberships(membershipBody.memberships);
      setFactorGroups(factorBody.byAnchor);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setLoading(false);
    }
  }, [org.id]);

  useEffect(() => {
    void load();
  }, [load]);

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
      {error ? <ProductError message={error} onRetry={load} /> : null}
      <div className="org-grid g4" style={{ marginBottom: 14 }}>
        <MetricValue
          label="Agreements in use"
          value={agreements.length}
          loading={loading}
        />
        <MetricValue
          label="Driver memberships"
          value={memberships.length}
          loading={loading}
          tone="accent"
        />
        <MetricValue
          label="Cost factors"
          value={factors.length}
          loading={loading}
        />
        <MetricValue
          label="Active factors"
          value={factors.filter((factor) => factor.status === "active").length}
          loading={loading}
        />
      </div>
      <div className="org-grid g2 org-align-start">
        <section className="org-card">
          <div className="org-card-h">
            Driver agreements <span className="sub">read only</span>
          </div>
          {loading ? (
            <ProductLoading label="Loading driver agreements" />
          ) : agreements.length === 0 ? (
            <ProductEmpty
              title="No driver agreement is assigned"
              detail="Assignments will appear when an agreement is active."
            />
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
                    <StatusBadge
                      label={normalizeStatus(agreement.status)}
                      tone={statusTone(agreement.status)}
                    />
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
            <ProductLoading label="Loading cost-factor catalogue" />
          ) : factors.length === 0 ? (
            <ProductEmpty
              title="No cost factors configured"
              detail="The platform catalogue is currently empty."
            />
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
      <ContractGate
        id="driver-cost-assignment"
        eyebrow="Driver cost assignment"
        title="Editing needs a narrow assignment contract"
        detail="The API can report membership and agreement state, but this UI has no safe command for assigning a cost factor with an effective date, preview and rollback."
        action="Edit driver pricing"
      />
    </>
  );
}
