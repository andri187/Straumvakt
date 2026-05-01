import Link from "next/link";
import { notFound } from "next/navigation";
import { SectionTabs, ONBOARD_TABS } from "@/components/section-tabs";
import { apiFetchServerJson } from "@/lib/api-client-server";
import type { CredentialManageTree } from "@straumvakt/shared/domain/credential-management";
import { ManageTree } from "./manage-tree";

export const dynamic = "force-dynamic";
export const metadata = { title: "Onboard · Manage credential" };

// Server component: fetches the cross-referenced Zaptec ↔ our-DB tree
// for one stored credential and hands it to the client component for
// selection. The tree call talks live to the Zaptec API, so the page
// loads in a few seconds — no caching, always fresh.

export default async function ManageCredentialPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  let tree: CredentialManageTree;
  try {
    const res = await apiFetchServerJson<{ tree: CredentialManageTree }>(
      `/api/admin/vendor-credentials/${id}/manage-tree`,
    );
    tree = res.tree;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("credential_not_found")) notFound();
    return (
      <div className="mx-auto max-w-6xl px-6 py-8">
        <SectionTabs tabs={ONBOARD_TABS} />
        <div className="rounded border border-rose-500/40 bg-rose-950/20 p-6 text-sm text-rose-200">
          <p className="font-medium">Could not load credential management view</p>
          <p className="mt-2 font-mono text-xs">{msg}</p>
          <p className="mt-4">
            <Link href="/onboard/credentials" className="text-sv-sky hover:underline">
              ← Back to credentials
            </Link>
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <SectionTabs tabs={ONBOARD_TABS} />
      <header className="mb-6">
        <div className="flex items-center gap-2 text-xs text-ink-500">
          <Link href="/onboard/credentials" className="hover:text-sv-sky">
            Credentials
          </Link>
          <span>/</span>
          <span className="font-mono">{tree.credentialUsername}</span>
        </div>
        <h1 className="mt-1 text-2xl font-semibold text-ink-50">
          Manage <span className="font-mono text-sv-sky">{tree.credentialUsername}</span>
        </h1>
        <p className="mt-1 text-sm text-ink-400">
          Tick the chargers this credential should manage. Adding pulls the
          charger into our DB under its existing installation; removing
          deletes the charger row (and its sessions) without touching Zaptec.
          Installations not yet imported require the{" "}
          <Link href="/onboard/zaptec" className="text-sv-sky hover:underline">
            Zaptec wizard
          </Link>{" "}
          — the manage flow can't bootstrap fresh installations because we
          have no password to seed the auth hash.
        </p>
      </header>

      <ManageTree credentialId={tree.credentialId} initialTree={tree} />
    </div>
  );
}
