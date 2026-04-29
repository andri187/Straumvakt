import Link from "next/link";
import { SectionTabs, OPERATIONS_TABS, CHARGERS_TABS } from "@/components/section-tabs";
import { ActionBar } from "@/components/action-bar";
import { apiFetchServerJson } from "@/lib/api-client-server";
import type { PendingDiscoverySummary } from "@straumvakt/shared/domain/pending-discoveries";
import { DismissButton } from "./dismiss-button";

export const dynamic = "force-dynamic";
export const metadata = { title: "Chargers · Pending onboarding" };

// Pre-onboarding pool — physical chargers that have presented Basic-
// Auth against the OCPP gateway but no OcppIdentity row matches their
// identity-string. Populated by the gateway's auth-fail upsert (see
// src/app/api/internal/ocpp-auth/route.ts → recordPendingDiscovery).
//
// Click "Claim" to jump to /chargers/new with the identity string
// pre-filled; on successful provision the pending_discoveries row
// is deleted in the same tx (apps/api repositories/chargers.ts +
// repositories/onboarding-chains.ts).

export default async function PendingChargersPage() {
  const { pending } = await apiFetchServerJson<{ pending: PendingDiscoverySummary[] }>(
    "/api/admin/pending-discoveries",
  );

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <SectionTabs tabs={OPERATIONS_TABS} />
      <SectionTabs tabs={CHARGERS_TABS} />
      <ActionBar
        title="Pending onboarding"
        description="Chargers that connected to the OCPP gateway with credentials that don't match any provisioned OcppIdentity. Claim a row to pre-fill the new-charger form with the discovered identity string."
      />

      {pending.length === 0 ? (
        <div className="rounded border border-dashed border-bg-border p-8 text-center">
          <p className="text-sm text-ink-200">No pending chargers.</p>
          <p className="mt-1 text-xs text-ink-400">
            Pending discoveries appear here automatically once a charger boots
            against the gateway URL with credentials that don&apos;t match an
            existing OcppIdentity row. Point your charger at{" "}
            <code className="font-mono">wss://straumvakt-ocpp-staging.straumvakt.workers.dev/ocpp/&lt;identity&gt;</code>{" "}
            to surface it here.
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-md border border-bg-border bg-bg-base/30">
          <table className="w-full text-left text-sm">
            <thead className="bg-bg-inset/40 text-[10px] uppercase tracking-brand text-ink-500">
              <tr>
                <th className="px-3 py-2 font-medium">Identity</th>
                <th className="px-3 py-2 font-medium">First seen</th>
                <th className="px-3 py-2 font-medium">Last seen</th>
                <th className="px-3 py-2 font-medium text-right">Attempts</th>
                <th className="px-3 py-2 font-medium">Source</th>
                <th className="px-3 py-2 font-medium" />
              </tr>
            </thead>
            <tbody className="divide-y divide-bg-border/40">
              {pending.map((p) => (
                <tr key={p.identityString} className="hover:bg-bg-raised/30">
                  <td className="px-3 py-2 font-mono text-xs text-ink-100">
                    {p.identityString}
                  </td>
                  <td className="px-3 py-2 text-xs text-ink-300">
                    {new Date(p.firstSeenAt).toLocaleString()}
                  </td>
                  <td className="px-3 py-2 text-xs text-ink-200">
                    {new Date(p.lastSeenAt).toLocaleString()}
                  </td>
                  <td className="px-3 py-2 text-right text-xs text-ink-200">
                    {p.attemptCount}
                  </td>
                  <td className="px-3 py-2 font-mono text-[10px] text-ink-500">
                    {p.remoteAddr ?? "—"}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Link
                      href={{
                        pathname: "/chargers/new",
                        query: { identityString: p.identityString },
                      }}
                      className="mr-2 rounded-md bg-sv-green/20 px-2 py-1 text-[11px] font-medium text-sv-green ring-1 ring-sv-green/30 hover:bg-sv-green/30"
                    >
                      Claim
                    </Link>
                    <DismissButton identityString={p.identityString} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
