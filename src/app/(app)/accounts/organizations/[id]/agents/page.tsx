// Agents tab — manages org-level memberships + outstanding invites
// in one place (Sprint 5 closure / ADR 0017). Operator's first stop
// when they need to add or remove a person from an org.

import { notFound } from "next/navigation";
import { apiFetchServer } from "@/lib/api-client-server";
import type { OrgMembershipSummary } from "@straumvakt/shared/domain/users";
import { OrgInvitesPanel } from "../invites-panel";

export const dynamic = "force-dynamic";
export const metadata = { title: "Organization · Agents" };

type InviteListItem = {
  tokenId: string;
  userId: string;
  email: string;
  role: "manager" | "technician" | "finance" | "support" | "viewer";
  expiresAt: string;
  createdAt: string;
  invitedById: string | null;
};

export default async function OrganizationAgentsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [orgRes, memRes, invitesRes] = await Promise.all([
    apiFetchServer(`/api/admin/orgs/${id}`),
    apiFetchServer(`/api/admin/orgs/${id}/memberships`),
    apiFetchServer(`/api/admin/orgs/${id}/invites`),
  ]);
  if (orgRes.status === 404) notFound();
  if (!orgRes.ok) throw new Error(`HTTP ${orgRes.status}`);

  const memberships = memRes.ok
    ? ((await memRes.json()) as { memberships: OrgMembershipSummary[] })
        .memberships
    : [];
  const initialInvites = invitesRes.ok
    ? ((await invitesRes.json()) as { invites: InviteListItem[] }).invites
    : [];

  return (
    <>
      <section className="rounded-lg border border-bg-border bg-bg-base/30 p-4">
        <header className="mb-3">
          <h2 className="text-sm font-semibold text-ink-50">Active members</h2>
          <p className="mt-0.5 text-[11px] text-ink-400">
            People with active operator access to this org. Suspending or
            revoking an existing member is a Sprint 6+ surface — for now
            this list is read-only.
          </p>
        </header>
        {memberships.length === 0 ? (
          <p className="text-[11px] text-ink-500">
            No active members yet. Send an invite below.
          </p>
        ) : (
          <ul className="divide-y divide-bg-border/60 rounded border border-bg-border bg-bg-base/40">
            {memberships.map((m) => (
              <li
                key={m.userId}
                className="flex flex-wrap items-center gap-3 px-3 py-1.5 text-xs"
              >
                <span className="font-mono text-ink-100">{m.userEmail}</span>
                {m.userDisplayName && (
                  <span className="text-ink-300">{m.userDisplayName}</span>
                )}
                <span className="rounded bg-sv-sky/10 px-1.5 py-0.5 font-mono text-[10px] text-sv-sky">
                  {m.role}
                </span>
                <span className="ml-auto text-[10px] text-ink-500">
                  joined {new Date(m.createdAt).toLocaleDateString()}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <OrgInvitesPanel orgId={id} initialInvites={initialInvites} />
    </>
  );
}
