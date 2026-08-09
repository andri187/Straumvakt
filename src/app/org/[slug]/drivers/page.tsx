"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  MetricValue,
  ProductEmpty,
  ProductError,
  ProductLoading,
  StatusBadge,
} from "@/components/product-state";
import { apiFetchJson } from "@/lib/api-client";
import { validDenialReason } from "@/lib/product-ui-guards";
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
  const [query, setQuery] = useState("");
  const [groupFilter, setGroupFilter] = useState("all");

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

  const groups = useMemo(
    () => [...new Set(memberships.map((membership) => membership.driverGroupName))].sort(),
    [memberships],
  );
  const filteredMemberships = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return memberships.filter((membership) => {
      const matchesGroup =
        groupFilter === "all" || membership.driverGroupName === groupFilter;
      const matchesQuery =
        needle.length === 0 ||
        [
          membership.userDisplayName,
          membership.userEmail,
          membership.driverGroupName,
          membership.agreementDisplayName,
        ].some((value) => value?.toLowerCase().includes(needle));
      return matchesGroup && matchesQuery;
    });
  }, [groupFilter, memberships, query]);

  function closeDenial(id: string) {
    setDenyingId(null);
    setDenialReason("");
    requestAnimationFrame(() => document.getElementById(`deny-${id}`)?.focus());
  }

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
        <button
          className="org-button secondary"
          type="button"
          onClick={load}
          disabled={loading}
          aria-busy={loading}
        >
          {loading ? "Refreshing..." : "Refresh"}
        </button>
      </section>

      {error ? <ProductError message={error} onRetry={load} /> : null}

      <div className="org-grid g4" style={{ marginBottom: 14 }}>
        <MetricValue
          label="Active members"
          value={tiles?.totalActiveMembers ?? 0}
          loading={loading}
        />
        <MetricValue
          label="Pending requests"
          value={requests.length}
          loading={loading}
          tone={requests.length > 0 ? "accent" : "default"}
        />
        <MetricValue
          label="Dormant 90+ days"
          value={tiles?.dormantMembers ?? 0}
          loading={loading}
        />
        <MetricValue
          label="Agreements in use"
          value={tiles?.membersByAgreement.length ?? 0}
          loading={loading}
        />
      </div>

      <section className="org-card" style={{ marginBottom: 14 }}>
        <div className="org-card-h">
          Access requests
          <span className="sub">approval creates a group membership</span>
        </div>
        {loading ? (
          <ProductLoading label="Loading access requests" />
        ) : requests.length === 0 ? (
          <ProductEmpty
            title="No pending access requests"
            detail="New requests will appear here for review."
          />
        ) : (
          <div className="org-request-list">
            {requests.map((request) => (
              <article
                className="org-request"
                key={request.id}
                aria-labelledby={`request-${request.id}`}
              >
                <div className="org-request-copy">
                  <strong id={`request-${request.id}`}>
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
                      aria-describedby={`reason-meta-${request.id}`}
                      value={denialReason}
                      onChange={(event) => setDenialReason(event.target.value)}
                    />
                    <div className="org-field-meta" id={`reason-meta-${request.id}`}>
                      <span>At least 3 characters</span>
                      <span>{denialReason.length}/500</span>
                    </div>
                    <div className="org-actions">
                      <button
                        type="button"
                        className="org-button secondary"
                        onClick={() => closeDenial(request.id)}
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        className="org-button danger"
                        disabled={
                          actingId === request.id ||
                          !validDenialReason(denialReason)
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
                      id={`deny-${request.id}`}
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
        <div className="org-toolbar" role="search">
          <label>
            Search drivers
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Name, email, group or agreement"
            />
          </label>
          <label>
            Driver group
            <select
              value={groupFilter}
              onChange={(event) => setGroupFilter(event.target.value)}
            >
              <option value="all">All groups</option>
              {groups.map((group) => (
                <option value={group} key={group}>
                  {group}
                </option>
              ))}
            </select>
          </label>
          <span className="org-result-count" aria-live="polite">
            {filteredMemberships.length} of {memberships.length} drivers
          </span>
        </div>
        <div className="org-table-wrap">
          <table>
            <caption className="org-sr-only">
              Driver memberships for {org.displayName}
            </caption>
            <thead>
              <tr>
                <th scope="col">Driver</th>
                <th scope="col">Group</th>
                <th scope="col">Agreement</th>
                <th scope="col">Last session</th>
                <th scope="col">Tokens</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td className="empty" colSpan={5}>
                    <ProductLoading label="Loading driver directory" />
                  </td>
                </tr>
              ) : memberships.length === 0 ? (
                <tr>
                  <td className="empty" colSpan={5}>
                    <ProductEmpty
                      title="No active memberships"
                      detail="Approved driver access will appear here."
                    />
                  </td>
                </tr>
              ) : filteredMemberships.length === 0 ? (
                <tr>
                  <td className="empty" colSpan={5}>
                    <ProductEmpty
                      title="No matching drivers"
                      detail="Clear the search or choose another driver group."
                    />
                  </td>
                </tr>
              ) : (
                filteredMemberships.map((membership) => (
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
                        <StatusBadge label="Dormant" tone="warning" />
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
