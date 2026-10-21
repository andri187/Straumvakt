"use client";

// Host page — "Bjóða ökumanni" (invite a driver). ADR 0028 host↔driver
// INVITE loop, host side. The host_admin picks one of their org's driver
// groups, enters a driver email, and mints a single-use invite code to
// share. Pending/used invites listed below. Concept look (host.css).

import { useCallback, useEffect, useState } from "react";
import { apiFetch, apiFetchJson } from "@/lib/api-client";
import { useHostOrg } from "../host-shell";

type DriverGroup = {
  id: string;
  displayName: string;
  agreementStatus: string;
  installationDisplayName: string | null;
};

type Invite = {
  tokenId: string;
  email: string;
  driverGroupId: string;
  driverGroupDisplayName: string;
  status: "pending" | "used" | "expired";
  createdAt: string;
  expiresAt: string;
  usedAt: string | null;
};

type CreatedInvite = {
  token: string;
  expiresAt: string;
  inviteUrl: string;
  driverGroupDisplayName: string;
  email: string;
};

function statusBadge(s: Invite["status"]): {
  cls: string;
  dot: string;
  label: string;
} {
  if (s === "pending") return { cls: "s-ok", dot: "bg-ok", label: "Bíður" };
  if (s === "used") return { cls: "s-mut", dot: "bg-mut", label: "Leyst inn" };
  return { cls: "s-bad", dot: "bg-bad", label: "Útrunnið" };
}

export default function HostInvite() {
  const org = useHostOrg();
  const [groups, setGroups] = useState<DriverGroup[] | null>(null);
  const [invites, setInvites] = useState<Invite[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const [groupId, setGroupId] = useState("");
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [created, setCreated] = useState<CreatedInvite | null>(null);
  const [copied, setCopied] = useState(false);

  const loadInvites = useCallback(async () => {
    if (!org) return;
    const r = await apiFetchJson<{ invites: Invite[] }>(
      `/api/admin/orgs/${org.orgId}/driver-invites`,
    );
    setInvites(r.invites);
  }, [org]);

  useEffect(() => {
    if (!org) return;
    let cancelled = false;
    (async () => {
      try {
        const [g, inv] = await Promise.all([
          apiFetchJson<{ groups: DriverGroup[] }>(
            `/api/admin/orgs/${org.orgId}/driver-groups`,
          ),
          apiFetchJson<{ invites: Invite[] }>(
            `/api/admin/orgs/${org.orgId}/driver-invites`,
          ),
        ]);
        if (cancelled) return;
        setGroups(g.groups);
        setInvites(inv.invites);
        if (g.groups.length > 0) setGroupId((prev) => prev || g.groups[0].id);
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [org]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!org || !groupId || !email.trim()) return;
    setSubmitting(true);
    setErr(null);
    setCreated(null);
    setCopied(false);
    try {
      const res = await apiFetch(
        `/api/admin/orgs/${org.orgId}/driver-invites`,
        {
          method: "POST",
          body: JSON.stringify({ driverGroupId: groupId, email: email.trim() }),
        },
      );
      const body = (await res.json().catch(() => null)) as
        | { invite: CreatedInvite }
        | { error?: string }
        | null;
      if (!res.ok || !body || !("invite" in body)) {
        const eb = body as { error?: string } | null;
        throw new Error(eb?.error || `HTTP ${res.status}`);
      }
      setCreated(body.invite);
      setEmail("");
      await loadInvites();
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : String(e2));
    } finally {
      setSubmitting(false);
    }
  }

  const fullLink =
    created && typeof window !== "undefined"
      ? `${window.location.origin}${created.inviteUrl}`
      : (created?.inviteUrl ?? "");

  async function copyLink() {
    if (!fullLink) return;
    try {
      await navigator.clipboard.writeText(fullLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard blocked — the link is visible to copy manually */
    }
  }

  return (
    <>
      <div className="head">
        <div>
          <h1>Bjóða ökumanni</h1>
          <p>
            Veldu aðgangshóp og sláðu inn netfang ökumanns. Þú færð kóða/hlekk
            til að deila — ökumaðurinn leysir hann inn í Straumvakt appinu.
          </p>
        </div>
      </div>

      {err && (
        <div
          className="card"
          style={{
            padding: "14px 18px",
            marginBottom: 16,
            borderColor: "rgba(255,107,107,.4)",
            color: "var(--red)",
          }}
        >
          {err}
        </div>
      )}

      <div className="grid g2">
        <div className="card" style={{ alignSelf: "start" }}>
          <div className="card-h">Nýtt boð</div>
          <div style={{ padding: 18 }}>
            <form onSubmit={submit}>
              <div className="field">
                <label htmlFor="dg">Aðgangshópur</label>
                {groups === null ? (
                  <div className="sub">Hleð…</div>
                ) : groups.length === 0 ? (
                  <div className="sub">
                    Engir aðgangshópar til. Hafðu samband við rekstraraðila.
                  </div>
                ) : (
                  <select
                    id="dg"
                    className="inp"
                    value={groupId}
                    onChange={(ev) => setGroupId(ev.target.value)}
                  >
                    {groups.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.displayName}
                        {g.installationDisplayName
                          ? ` · ${g.installationDisplayName}`
                          : ""}
                      </option>
                    ))}
                  </select>
                )}
              </div>

              <div className="field">
                <label htmlFor="em">Netfang ökumanns</label>
                <input
                  id="em"
                  className="inp"
                  type="email"
                  placeholder="okumadur@example.is"
                  value={email}
                  onChange={(ev) => setEmail(ev.target.value)}
                  required
                />
              </div>

              <button
                className="btn primary"
                type="submit"
                disabled={
                  submitting ||
                  !groupId ||
                  !email.trim() ||
                  groups?.length === 0
                }
              >
                {submitting ? "Bý til…" : "Búa til boð"}
              </button>
            </form>

            {created && (
              <div
                className="card"
                style={{
                  marginTop: 18,
                  padding: 16,
                  borderColor: "rgba(43,182,232,.4)",
                }}
              >
                <div style={{ fontWeight: 700, marginBottom: 6 }}>
                  Boð tilbúið fyrir {created.email}
                </div>
                <div className="sub" style={{ marginBottom: 10 }}>
                  Hópur: {created.driverGroupDisplayName} · Rennur út{" "}
                  {created.expiresAt.slice(0, 10)}
                </div>
                <div className="field">
                  <label>Kóði</label>
                  <input
                    className="inp mono"
                    readOnly
                    value={created.token}
                    onFocus={(e) => e.currentTarget.select()}
                  />
                </div>
                <div className="field">
                  <label>Hlekkur</label>
                  <input
                    className="inp mono"
                    readOnly
                    value={fullLink}
                    onFocus={(e) => e.currentTarget.select()}
                  />
                </div>
                <button type="button" className="btn sm" onClick={copyLink}>
                  {copied ? "Afritað ✓" : "Afrita hlekk"}
                </button>
              </div>
            )}
          </div>
        </div>

        <div className="card">
          <div className="card-h">
            Útgefin boð{" "}
            <span className="sub">{invites ? `${invites.length}` : ""}</span>
          </div>
          <table>
            <thead>
              <tr>
                <th>Netfang</th>
                <th>Hópur</th>
                <th>Staða</th>
                <th>Rennur út</th>
              </tr>
            </thead>
            <tbody>
              {invites === null && (
                <tr>
                  <td colSpan={4} className="empty">
                    Hleð…
                  </td>
                </tr>
              )}
              {invites?.length === 0 && (
                <tr>
                  <td colSpan={4} className="empty">
                    Engin boð gefin út enn.
                  </td>
                </tr>
              )}
              {invites?.map((i) => {
                const b = statusBadge(i.status);
                return (
                  <tr key={i.tokenId}>
                    <td>
                      <strong>{i.email || "—"}</strong>
                    </td>
                    <td className="sub">{i.driverGroupDisplayName}</td>
                    <td>
                      <span className={"badge2 " + b.cls}>
                        <span className={"dot " + b.dot} />
                        {b.label}
                      </span>
                    </td>
                    <td className="sub">{i.expiresAt.slice(0, 10)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
