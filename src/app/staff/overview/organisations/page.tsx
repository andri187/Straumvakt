import { redirect } from "next/navigation";
import { apiFetchServer } from "@/lib/api-client-server";
import { StaffNav } from "../staff-nav";
import { OrganisationList, type StaffOrganisation } from "./organisation-list";

export const dynamic = "force-dynamic";
export const metadata = { title: "Organisations" };

type Me = { isPlatform: boolean };

export default async function StaffOrganisationsPage() {
  const meRes = await apiFetchServer("/api/admin/me");
  if (meRes.status === 401) redirect("/staff");
  if (!meRes.ok)
    throw new Error(`Could not confirm staff session (${meRes.status})`);
  const me = (await meRes.json()) as Me;
  if (!me.isPlatform) redirect("/org");

  const response = await apiFetchServer("/api/admin/orgs");
  const organisations = response.ok
    ? (((await response.json()) as { orgs: StaffOrganisation[] }).orgs ?? [])
    : [];

  return (
    <>
      <StaffNav />
      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        <div id="support-context" className="border-b border-bg-border pb-5">
          <div className="sv-tagline">Platform directory</div>
          <h1 className="mt-1 text-2xl font-semibold text-ink-50">
            Organisations
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-ink-400">
            Enter a named support context before inspecting an organisation.
          </p>
        </div>
        <div className="mt-6">
          {response.ok ? (
            <OrganisationList organisations={organisations} />
          ) : (
            <p className="border border-bg-border px-4 py-8 text-sm text-ink-400">
              The organisation directory is unavailable (HTTP {response.status}
              ).
            </p>
          )}
        </div>
      </main>
    </>
  );
}
