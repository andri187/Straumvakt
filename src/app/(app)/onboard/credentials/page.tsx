import Link from "next/link";
import { SectionTabs, ONBOARD_TABS } from "@/components/section-tabs";
import { apiFetchServerJson } from "@/lib/api-client-server";
import type { VendorCredentialSummary } from "@straumvakt/shared/domain/vendor-credentials";
import type { OrgSummary } from "@straumvakt/shared/domain/orgs";
import { CredentialActions } from "./credential-actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Onboard · Vendor credentials" };

// Saved Zaptec/Easee/etc. portal credentials, one row per (org, vendor,
// username). Platform admin sees all; org users only see their own org's
// (when membership-roles activate per ADR 0006). Today every authenticated
// user is platform admin in pilot mode.

export default async function VendorCredentialsPage() {
  const [{ credentials }, { orgs }] = await Promise.all([
    apiFetchServerJson<{ credentials: VendorCredentialSummary[] }>(
      "/api/admin/vendor-credentials",
    ),
    apiFetchServerJson<{ orgs: OrgSummary[] }>("/api/admin/orgs"),
  ]);

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <SectionTabs tabs={ONBOARD_TABS} />
      <header className="mb-6">
        <h1 className="text-2xl font-semibold text-ink-50">Vendor credentials</h1>
        <p className="mt-1 text-sm text-ink-400">
          Saved Zaptec / Easee / Kempower portal credentials, organized by owning
          organisation. Passwords are AES-GCM encrypted with a Worker-side KEK; the
          plaintext is only used server-side when re-syncing the vendor inventory and
          never returned to the UI.
        </p>
      </header>

      {credentials.length === 0 ? (
        <div className="rounded border border-dashed border-bg-border p-8 text-center">
          <p className="text-sm text-ink-200">No saved credentials yet.</p>
          <p className="mt-1 text-xs text-ink-400">
            Run the{" "}
            <Link href="/onboard/zaptec" className="text-sv-sky hover:underline">
              Zaptec wizard
            </Link>{" "}
            and click <span className="text-sv-sky">Save to vault</span> after a
            successful Discover step to add one.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-md border border-bg-border bg-bg-base/30">
          <table className="w-full text-left text-sm">
            <thead className="bg-bg-inset/40 text-[10px] uppercase tracking-brand text-ink-500">
              <tr>
                <th className="px-3 py-2 font-medium">Vendor</th>
                <th className="px-3 py-2 font-medium">Username</th>
                <th className="px-3 py-2 font-medium">Owner org</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 text-right font-medium">Installs</th>
                <th className="px-3 py-2 text-right font-medium">Chargers (online / total)</th>
                <th className="px-3 py-2 font-medium">Last used</th>
                <th className="px-3 py-2 font-medium">Created</th>
                <th className="px-3 py-2 font-medium">Notes</th>
                <th className="px-3 py-2 text-right font-medium" />
              </tr>
            </thead>
            <tbody className="divide-y divide-bg-border/40">
              {credentials.map((c) => (
                <tr key={c.id} className="hover:bg-bg-raised/30">
                  <td className="px-3 py-2">
                    <div className="text-ink-100">{c.vendorDisplayName}</div>
                    <div className="font-mono text-[10px] text-ink-500">{c.vendorSlug}</div>
                  </td>
                  <td className="px-3 py-2 font-mono text-xs text-ink-100">{c.username}</td>
                  <td className="px-3 py-2">
                    <Link
                      href={`/tenants/organizations/${c.ownerOrgId}`}
                      className="text-sv-sky hover:underline"
                    >
                      {c.ownerOrgDisplayName}
                    </Link>
                  </td>
                  <td className="px-3 py-2">
                    <StatusBadge status={c.status} />
                  </td>
                  <td className="px-3 py-2 text-right text-ink-200">{c.installationCount ?? 0}</td>
                  <td className="px-3 py-2 text-right">
                    <span className="font-mono text-xs">
                      <span className={(c.chargersOnline ?? 0) > 0 ? "text-emerald-300" : "text-ink-500"}>
                        {c.chargersOnline ?? 0}
                      </span>
                      <span className="text-ink-500"> / {c.chargerCount ?? 0}</span>
                    </span>
                  </td>
                  <td className="px-3 py-2 text-xs text-ink-400">
                    {c.lastUsedAt ? new Date(c.lastUsedAt).toLocaleString() : "—"}
                  </td>
                  <td className="px-3 py-2 text-xs text-ink-400">
                    {new Date(c.createdAt).toLocaleString()}
                  </td>
                  <td className="px-3 py-2 text-xs text-ink-400">
                    {c.notes ?? <span className="text-ink-500">—</span>}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <CredentialActions
                      credentialId={c.id}
                      ownerOrgId={c.ownerOrgId}
                      status={c.status}
                      orgs={orgs}
                    />
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

function StatusBadge({ status }: { status: string }) {
  const tone =
    status === "active"
      ? "bg-emerald-950/40 text-emerald-300 border-emerald-700/40"
      : status === "expired"
        ? "bg-amber-950/40 text-amber-300 border-amber-700/40"
        : "bg-rose-950/40 text-rose-300 border-rose-700/40";
  return (
    <span className={"inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-medium uppercase " + tone}>
      {status}
    </span>
  );
}
