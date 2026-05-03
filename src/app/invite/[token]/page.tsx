// Recipient-side invite landing page (Sprint 5 / ADR 0017
// milestone 5.8).
//
// Unauthenticated route — gated by the invite token in the URL,
// not by the admin session cookie. Server-component fetches the
// peek endpoint to render the org + role context, then mounts a
// client-component form that POSTs to the consume endpoint.

import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { InviteAcceptForm } from "./accept-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Accept invitation" };

type Peek = {
  invite: {
    orgId: string;
    orgDisplayName: string;
    role: string;
    email: string;
    expiresAt: string;
  };
};

const HOSTNAME_TO_API: Record<string, string> = {
  "hlada-staging.straumvakt.workers.dev":
    "https://hlada-api-staging.straumvakt.workers.dev",
  "hlada.straumvakt.workers.dev": "https://hlada-api.straumvakt.workers.dev",
};

async function resolveApiBase(): Promise<string> {
  if (process.env.NEXT_PUBLIC_API_BASE_URL) {
    return process.env.NEXT_PUBLIC_API_BASE_URL;
  }
  const h = await headers();
  const host = h.get("host") ?? "";
  return HOSTNAME_TO_API[host] ?? "http://localhost:8787";
}

export default async function InviteAcceptPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const apiBase = await resolveApiBase();
  const peekRes = await fetch(
    `${apiBase}/api/public/invites/peek?token=${encodeURIComponent(token)}`,
    { cache: "no-store" },
  );
  if (peekRes.status === 404) notFound();

  if (!peekRes.ok) {
    let reason: string | null = null;
    try {
      const body = (await peekRes.json()) as { error?: string };
      reason = body.error ?? null;
    } catch {
      reason = null;
    }
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center px-6 py-12">
        <h1 className="mb-2 text-xl font-semibold text-ink-50">
          Invitation unavailable
        </h1>
        <p className="text-sm text-ink-400">
          {reason === "expired" && "This invitation has expired. Ask the inviter to send a new one."}
          {reason === "already_used" && "This invitation has already been accepted."}
          {(!reason || (reason !== "expired" && reason !== "already_used")) &&
            "We couldn't load this invitation. Check the link or ask for a new one."}
        </p>
      </main>
    );
  }

  const { invite } = (await peekRes.json()) as Peek;

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center px-6 py-12">
      <div className="w-full rounded-lg border border-bg-border bg-bg-base/40 p-6">
        <h1 className="mb-1 text-lg font-semibold text-ink-50">
          You're invited to {invite.orgDisplayName}
        </h1>
        <p className="mb-4 text-sm text-ink-400">
          Role: <span className="font-mono text-sv-sky">{invite.role}</span>
          <br />
          For: <span className="text-ink-200">{invite.email}</span>
          <br />
          <span className="text-[11px] text-ink-500">
            Expires {new Date(invite.expiresAt).toLocaleString()}
          </span>
        </p>
        <InviteAcceptForm token={token} email={invite.email} />
      </div>
    </main>
  );
}
