"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetchJson } from "@/lib/api-client";
import { useOrg } from "../org-shell";

type AccessRequest = {
  id: string;
  userEmail: string;
  userDisplayName: string | null;
  installationDisplayName: string;
  siteDisplayName: string;
  triggeredBy: string;
  status: "pending" | "approved" | "denied" | "withdrawn";
  createdAt: string;
};

type Membership = {
  membershipId: string;
  userDisplayName: string | null;
  userEmail: string;
  driverGroupName: string;
  agreementDisplayName: string;
  agreementStatus: string;
  lastSessionAt: string | null;
  idTokenCount: number;
  isDormant: boolean;
};

type Tiles = {
  totalActiveMembers: number;
  dormantMembers: number;
  membersByAgreement: { agreementDisplayName: string; count: number }[];
};

export default function OrgDriversPage() {
  const { org } = useOrg();
  const [requests, setRequests] = useState<AccessRequest[]>([]);
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [tiles, setTiles] = useState<Tiles | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actingId, setActingId] = useState<string | null>(null);
  const [denyingId, setDenyingId] = useState<string | null>(null);
  const [denialReason, setDenialReason] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [requestBody, membershipBody] = await Promise.all([
        apiFetchJson<{
          items: AccessRequest[];
          totals: Record<string, number>;
        }>(
          `/api/admin/access-requests?orgId=${org.id}&status=pending&limit=100`,
        ),
        apiFetchJson<{ memberships: Membership[]; tiles: Tiles }>(
          `/api/admin/billing/driver-contracts?orgId=${org.id}`,
        ),
      ]);
      setRequests(requestBody.items);
      setMemberships(membershipBody.memberships);
      setTiles(membershipBody.tiles);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setLoading(false);
    }
  }, [org.id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function review(
    id: string,
    body: { action: "approve" } | { action: "deny"; denialReason: string },
  ) {
    setActingId(id);
    setError(null);
    try {
      await apiFetchJson(`/api/admin/access-requests/${id}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      });
      setDenyingId(null);
      setDenialReason("");
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setActingId(null);
    }
  }

  return (
    <>
      <section className="org-page-head">
        <div>
          <div className="org-eyebrow">People and access</div>
          <h1>Drivers</h1>
          <p>Memberships, agreements and requests awaiting a decision.</p>
        </div>
        <button className="org-button secondary" type="button" onClick={load}>
          Refresh
        </button>
      </section>

      {error ? <div className="org-error">{error}</div> : null}

      <div className="org-grid g4" style={{ marginBottom: 14 }}>
        <DriverMetric
          label="Active members"
          value={loading ? null : (tiles?.totalActiveMembers ?? 0)}
        />
        <DriverMetric
          label="Pending requests"
          value={loading ? null : requests.length}
          accent={requests.length > 0}
        />
        <DriverMetric
          label="Dormant 90+ days"
          value={loading ? null : (tiles?.dormantMembers ?? 0)}
        />
        <DriverMetric
          label="Agreements in use"
          value={loading ? null : (tiles?.membersByAgreement.length ?? 0)}
        />
      </div>

      <section className="org-card" style={{ marginBottom: 14 }}>
        <div className="org-card-h">
          Access requests
          <span className="sub">approval creates a group membership</span>
        </div>
        {loading ? (
          <div className="org-empty">Loading...</div>
        ) : requests.length === 0 ? (
          <div className="org-empty">No pending access requests.</div>
        ) : (
          <div className="org-request-list">
            {requests.map((request) => (
              <article className="org-request" key={request.id}>
                <div className="org-request-copy">
                  <strong>
                    {request.userDisplayName ?? request.userEmail}
                  </strong>
                  <span>{request.userEmail}</span>
                  <span>
                    {request.installationDisplayName} |{" "}
                    {request.siteDisplayName}
                  </span>
                  <small>
                    {request.triggeredBy.replaceAll("_", " ")} |{" "}
                    {new Date(request.createdAt).toLocaleDateString("en-GB")}
                  </small>
                </div>
                {denyingId === request.id ? (
                  <div className="org-denial-form">
                    <label htmlFor={`reason-${request.id}`}>
                      Reason sent to driver
                    </label>
                    <textarea
                      id={`reason-${request.id}`}
                      maxLength={500}
                      value={denialReason}
                      onChange={(event) => setDenialReason(event.target.value)}
                    />
                    <div className="org-actions">
                      <button
                        type="button"
                        className="org-button secondary"
                        onClick={() => setDenyingId(null)}
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        className="org-button danger"
                        disabled={
                          actingId === request.id ||
                          denialReason.trim().length === 0
                        }
                        onClick={() =>
                          review(request.id, {
                            action: "deny",
                            denialReason: denialReason.trim(),
                          })
                        }
                      >
                        Deny request
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="org-actions">
                    <button
                      type="button"
                      className="org-button secondary"
                      disabled={actingId === request.id}
                      onClick={() => {
                        setDenyingId(request.id);
                        setDenialReason("");
                      }}
                    >
                      Deny
                    </button>
                    <button
                      type="button"
                      className="org-button"
                      disabled={actingId === request.id}
                      onClick={() => review(request.id, { action: "approve" })}
                    >
                      {actingId === request.id ? "Working..." : "Approve"}
                    </button>
                  </div>
                )}
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="org-card">
        <div className="org-card-h">
          Driver directory
          <span className="sub">agreement-derived access</span>
        </div>
        <div className="org-table-wrap">
          <table>
            <thead>
              <tr>
                <th>Driver</th>
                <th>Group</th>
                <th>Agreement</th>
                <th>Last session</th>
                <th>Tokens</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td className="empty" colSpan={5}>
                    Loading...
                  </td>
                </tr>
              ) : memberships.length === 0 ? (
                <tr>
                  <td className="empty" colSpan={5}>
                    No active memberships.
                  </td>
                </tr>
              ) : (
                memberships.map((membership) => (
                  <tr key={membership.membershipId}>
                    <td>
                      <strong>
                        {membership.userDisplayName ?? membership.userEmail}
                      </strong>
                      <div className="org-cell-sub">{membership.userEmail}</div>
                    </td>
                    <td>{membership.driverGroupName}</td>
                    <td>
                      {membership.agreementDisplayName}
                      <div className="org-cell-sub">
                        {membership.agreementStatus}
                      </div>
                    </td>
                    <td>
                      {membership.lastSessionAt
                        ? new Date(membership.lastSessionAt).toLocaleDateString(
                            "en-GB",
                          )
                        : "Never"}
                      {membership.isDormant ? (
                        <div className="org-cell-sub warning">Dormant</div>
                      ) : null}
                    </td>
                    <td className="mono">{membership.idTokenCount}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

function DriverMetric({
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
