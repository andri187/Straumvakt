// Per-org Sessions tab. Reuses the platform-wide ChargeLogTable
// component with an `org` scope so the response is filtered to
// only this organization's session_ledger rows. Hides the
// Site/Org column since every row is the same org anyway.

import Link from "next/link";
import { ChargeLogTable } from "@/app/(app)/charge-log/charge-log-table";

export const dynamic = "force-dynamic";
export const metadata = { title: "Organization · Sessions" };

export default async function OrgSessionsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <section>
      <div className="mb-3">
        <h2 className="text-sm font-semibold uppercase tracking-brand text-ink-300">
          Sessions for this organization
        </h2>
        <p className="mt-1 text-[11px] text-ink-500">
          Every closed charging session at any site under this org.
          Click a session ID for the full timeline + power chart.
          Open the platform-wide{" "}
          <Link
            href={"/charge-log" as Parameters<typeof Link>[0]["href"]}
            className="text-sv-sky hover:underline"
          >
            charge log
          </Link>{" "}
          for cross-org context.
        </p>
      </div>
      <ChargeLogTable scope={{ kind: "org", orgId: id }} hideColumns={["site"]} />
    </section>
  );
}
