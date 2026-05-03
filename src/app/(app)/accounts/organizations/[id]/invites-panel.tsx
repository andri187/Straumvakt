"use client";

import { useState } from "react";
import { apiFetch } from "@/lib/api-client";

/**
 * Org-scoped agent invites panel (Sprint 5.7).
 *
 * Operator side of the flow:
 *   • "Invite agent" form: email + role + ttl. Submits to
 *     POST /api/admin/orgs/:orgId/invites. Returns plaintext +
 *     expiry — we surface them ONCE in the reveal block at the
 *     top, with a copy-to-clipboard. Operator pastes into Slack /
 *     email / SMS to deliver. We don't send mail directly yet.
 *   • Outstanding invites list: per-row Revoke button. Revoking
 *     kills the token AND flips the Membership row back to
 *     'revoked' so re-inviting starts fresh.
 */

const ROLES = ["manager", "technician", "finance", "support", "viewer"] as const;
type Role = (typeof ROLES)[number];

type InviteListItem = {
  tokenId: string;
  userId: string;
  email: string;
  role: Role;
  expiresAt: string;
  createdAt: string;
  invitedById: string | null;
};

type CreateResult = {
  tokenId: string;
  tokenPlaintext: string;
  expiresAt: string;
  userId: string;
  isNewUser: boolean;
};

export function OrgInvitesPanel({
  orgId,
  initialInvites,
}: {
  orgId: string;
  initialInvites: InviteListItem[];
}) {
  const [invites, setInvites] = useState<InviteListItem[]>(initialInvites);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<{
    plaintext: string;
    inviteUrl: string;
    expiresAt: string;
    email: string;
  } | null>(null);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("manager");
  const [ttlHours, setTtlHours] = useState(72);

  async function refreshList() {
    const res = await apiFetch(`/api/admin/orgs/${orgId}/invites`);
    if (res.ok) {
      const body = (await res.json()) as { invites: InviteListItem[] };
      setInvites(body.invites);
    }
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    setRevealed(null);
    try {
      const res = await apiFetch(`/api/admin/orgs/${orgId}/invites`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: email.trim(),
          role,
          ttlHours,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
          issues?: { message: string }[];
        };
        if (body.error === "already_active_member") {
          throw new Error("This person is already an active member of this org.");
        }
        const issueMsg = body.issues?.[0]?.message;
        throw new Error(issueMsg ?? body.error ?? `HTTP ${res.status}`);
      }
      const body = (await res.json()) as { invite: CreateResult };
      const baseUrl = window.location.origin;
      setRevealed({
        plaintext: body.invite.tokenPlaintext,
        inviteUrl: `${baseUrl}/invite/${body.invite.tokenPlaintext}`,
        expiresAt: body.invite.expiresAt,
        email: email.trim(),
      });
      setEmail("");
      await refreshList();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleRevoke(tokenId: string, label: string) {
    if (busy) return;
    const ok = confirm(
      `Revoke pending invite for ${label}? The link they have stops working immediately.`,
    );
    if (!ok) return;
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch(
        `/api/admin/orgs/${orgId}/invites/${tokenId}`,
        { method: "DELETE" },
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      await refreshList();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mt-8 rounded-lg border border-bg-border bg-bg-base/30 p-4">
      <header className="mb-3">
        <h2 className="text-sm font-semibold text-ink-50">Agent invites</h2>
        <p className="mt-0.5 text-[11px] text-ink-400">
          Invite a person to be an agent of this org. They get a one-shot
          link to accept and set their password. Links are shown ONCE on
          create — paste into Slack / email yourself.
        </p>
      </header>

      {revealed && (
        <div className="mb-3 rounded-md border border-amber-500/40 bg-amber-950/20 p-3 text-[11px]">
          <p className="font-semibold text-amber-200">
            Invite link for {revealed.email} — captured ONCE. Copy and send
            now (expires {new Date(revealed.expiresAt).toLocaleString()}).
          </p>
          <div className="mt-2 flex items-center gap-2">
            <code className="flex-1 break-all rounded bg-bg-base/60 px-2 py-1 font-mono text-amber-100">
              {revealed.inviteUrl}
            </code>
            <button
              type="button"
              onClick={() => void navigator.clipboard.writeText(revealed.inviteUrl)}
              className="rounded border border-amber-500/40 px-2 py-1 text-amber-200 hover:bg-amber-500/10"
            >
              Copy
            </button>
            <button
              type="button"
              onClick={() => setRevealed(null)}
              className="rounded border border-bg-border px-2 py-1 text-ink-400 hover:text-ink-100"
            >
              Hide
            </button>
          </div>
        </div>
      )}

      {error && (
        <p className="mb-2 rounded border border-rose-500/40 bg-rose-950/20 p-2 text-[11px] text-rose-200">
          {error}
        </p>
      )}

      <form
        onSubmit={handleCreate}
        className="mb-4 grid gap-2 sm:grid-cols-[1fr_140px_100px_auto]"
      >
        <input
          type="email"
          required
          autoComplete="off"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="email@example.com"
          className="rounded border border-bg-border bg-bg-base/60 px-2 py-1.5 text-xs text-ink-100 focus:border-sv-sky focus:outline-none"
        />
        <select
          value={role}
          onChange={(e) => setRole(e.target.value as Role)}
          className="rounded border border-bg-border bg-bg-base/60 px-2 py-1.5 text-xs text-ink-100 focus:border-sv-sky focus:outline-none"
        >
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
        <input
          type="number"
          min={1}
          max={720}
          value={ttlHours}
          onChange={(e) => setTtlHours(Number(e.target.value))}
          title="TTL in hours (default 72)"
          className="rounded border border-bg-border bg-bg-base/60 px-2 py-1.5 text-xs text-ink-100 focus:border-sv-sky focus:outline-none"
        />
        <button
          type="submit"
          disabled={busy || email.trim().length === 0}
          className="rounded-md border border-sv-sky/40 bg-sv-sky/10 px-3 py-1.5 text-xs font-medium text-sv-sky hover:bg-sv-sky/20 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? "Sending…" : "Invite"}
        </button>
      </form>

      <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-brand text-ink-400">
        Outstanding ({invites.length})
      </h3>
      {invites.length === 0 ? (
        <p className="text-[11px] text-ink-500">No outstanding invites.</p>
      ) : (
        <ul className="divide-y divide-bg-border/60 rounded border border-bg-border bg-bg-base/40">
          {invites.map((inv) => (
            <li
              key={inv.tokenId}
              className="flex flex-wrap items-center gap-3 px-3 py-1.5 text-xs"
            >
              <span className="font-mono text-ink-100">{inv.email}</span>
              <span className="rounded bg-sv-sky/10 px-1.5 py-0.5 font-mono text-[10px] text-sv-sky">
                {inv.role}
              </span>
              <span className="min-w-0 flex-1 text-[10px] text-ink-500">
                expires {new Date(inv.expiresAt).toLocaleString()} · sent{" "}
                {new Date(inv.createdAt).toLocaleString()}
              </span>
              <button
                type="button"
                disabled={busy}
                onClick={() => handleRevoke(inv.tokenId, inv.email)}
                className="rounded border border-rose-500/40 bg-rose-500/5 px-2 py-1 text-[10px] text-rose-300 hover:bg-rose-500/10 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Revoke
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
