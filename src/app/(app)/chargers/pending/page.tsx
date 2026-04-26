import { SectionTabs, OPERATIONS_TABS, CHARGERS_TABS } from "@/components/section-tabs";
import { ActionBar } from "@/components/action-bar";

export const dynamic = "force-dynamic";
export const metadata = { title: "Chargers · Pending onboarding" };

// Pending pool — physical chargers that have the gateway URL configured
// and have attempted to connect, but no OcppIdentity row matches their
// presented Basic-Auth credentials yet. The list populates via a future
// gateway-side hook (see `Wiring needed` block below).
//
// Until that hook lands the pending pool is always empty. Showing the
// page now so the operator console has a stable home for the eventual
// flow.

export default async function PendingChargersPage() {
  const pending: never[] = [];

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <SectionTabs tabs={OPERATIONS_TABS} />
      <SectionTabs tabs={CHARGERS_TABS} />
      <ActionBar
        title="Pending onboarding"
        description="Physical chargers that have the gateway URL configured and have attempted to connect, but their identity hasn't been provisioned yet. Claim a row here to pre-fill the create-charger form with the discovered identity string."
      />

      {pending.length === 0 ? (
        <div className="rounded border border-dashed border-bg-border p-8 text-center">
          <p className="text-sm text-ink-200">No pending chargers.</p>
          <p className="mt-1 text-xs text-ink-400">
            Pending discoveries appear here automatically once a charger boots
            against the gateway URL with credentials that don&apos;t match an
            existing OcppIdentity row.
          </p>
        </div>
      ) : (
        // Will render the list of pending discoveries once the gateway hook lands.
        <ul className="rounded-md border border-bg-border bg-bg-base/30">
          {/* placeholder for future PendingDiscovery rows */}
        </ul>
      )}

      <section className="mt-6 rounded-md border border-amber-700/40 bg-amber-950/20 p-4 text-xs text-amber-200">
        <h2 className="text-sm font-semibold text-amber-100">Wiring needed</h2>
        <p className="mt-1">
          To populate this view, the OCPP gateway worker needs a small
          discovery hook on the auth path:
        </p>
        <ol className="mt-2 list-decimal pl-5 space-y-0.5 text-amber-200/90">
          <li>
            New schema table <code className="font-mono">ocpp.pending_discoveries</code>{" "}
            — columns: <code className="font-mono">identity_string</code>,{" "}
            <code className="font-mono">first_seen_at</code>,{" "}
            <code className="font-mono">last_seen_at</code>,{" "}
            <code className="font-mono">attempt_count</code>,{" "}
            <code className="font-mono">remote_addr</code>,{" "}
            <code className="font-mono">user_agent</code>,{" "}
            <code className="font-mono">last_payload_summary</code>{" "}
            (JSONB, e.g., the BootNotification body).
          </li>
          <li>
            Gateway hook on auth-fail-due-to-unknown-identity: upsert by{" "}
            <code className="font-mono">identity_string</code>, increment{" "}
            <code className="font-mono">attempt_count</code>, update{" "}
            <code className="font-mono">last_seen_at</code>. Skip if the
            identity already exists in <code className="font-mono">ocpp_identities</code>.
          </li>
          <li>
            On successful provision via{" "}
            <a className="underline hover:text-amber-100" href="/chargers/new">
              /chargers/new
            </a>{" "}
            with a matching <code className="font-mono">identity_string</code>:
            delete the discovery row in the same transaction.
          </li>
          <li>
            Repository + admin route to list discoveries (org-scoped is
            tricky here since these aren&apos;t org-bound until claimed —
            platform-admin reads only).
          </li>
        </ol>
        <p className="mt-2 text-amber-200/80">
          Estimated effort: ~2 hours including migration, hook, repo, list
          rendering, and a &quot;Claim&quot; button that pre-fills{" "}
          <code className="font-mono">/chargers/new</code> with the
          discovered identity string.
        </p>
      </section>
    </div>
  );
}
