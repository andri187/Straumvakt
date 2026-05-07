import { apiFetchServerJson } from "@/lib/api-client-server";
import { DebugForm } from "./debug-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Agreements · Debug resolver" };

type Options = {
  users: { id: string; label: string; email: string }[];
  chargers: { id: string; label: string; siteName: string; cpoName: string }[];
};

/**
 * Sprint 9 / ADR 0019 milestone A.6 — read-only resolver debug page.
 *
 * Internal validation tool. Pick a driver + charger + (optional) time
 * and energy/duration inputs; the page POSTs to
 * /api/admin/agreements/debug-resolve which loads the SessionContext
 * from real rows and runs resolveBillingLines() exactly as session-stop
 * will. Surfaces:
 *
 *   - whether the driver has any membership covering this charger's CPO
 *     (denies if not — the "explicit memberships only" rule)
 *   - which CPO + workplace agreements applied
 *   - the per-line bearer / recipient / amount
 *   - the cascadeSource per attribute (which rule won the bearer, the
 *     rate, the allocation — or null if the agreement default cascaded)
 *
 * Never writes a billing_line. Not surfaced in operator navigation;
 * direct URL access only.
 */
export default async function AgreementsDebugPage() {
  const options = await apiFetchServerJson<Options>(
    "/api/admin/agreements/debug-options"
  );

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <header className="mb-6 border-b border-bg-border pb-4">
        <h1 className="text-2xl font-semibold text-ink-50">
          Resolver debug
        </h1>
        <p className="mt-1 text-sm text-ink-400">
          Pick a driver and a charger. The resolver runs against real
          agreement rows and shows what billing_lines a session-stop
          would emit. Read-only.
        </p>
      </header>

      <DebugForm
        users={options.users}
        chargers={options.chargers}
      />
    </div>
  );
}
