import Link from "next/link";
import type { Route } from "next";
import { notFound, redirect } from "next/navigation";
import { apiFetchServer } from "@/lib/api-client-server";
import { StaffNav } from "../../staff-nav";

export const dynamic = "force-dynamic";
type Params = { orgId: string };
type Me = { isPlatform: boolean; email: string };
type Org = { id: string; displayName: string; kind: string; status: string };
async function readCount(path: string, key: string): Promise<number | null> {
  const response = await apiFetchServer(path);
  if (!response.ok) return null;
  const body = (await response.json()) as Record<string, unknown>;
  return Array.isArray(body[key]) ? body[key].length : null;
}

export default async function StaffSupportContextPage({
  params,
}: {
  params: Promise<Params>;
}) {
  const meRes = await apiFetchServer("/api/admin/me");
  if (meRes.status === 401) redirect("/staff");
  if (!meRes.ok)
    throw new Error(`Could not confirm staff session (${meRes.status})`);
  const me = (await meRes.json()) as Me;
  if (!me.isPlatform) redirect("/org");
  const { orgId } = await params;
  const orgRes = await apiFetchServer(`/api/admin/orgs/${orgId}`);
  if (orgRes.status === 404) notFound();
  if (!orgRes.ok)
    throw new Error(`Could not load organisation (${orgRes.status})`);
  const { org } = (await orgRes.json()) as { org: Org };
  const [installations, chargers, drivers, groups] = await Promise.all([
    readCount(`/api/admin/orgs/${orgId}/installations`, "installations"),
    readCount(`/api/admin/orgs/${orgId}/chargers`, "chargers"),
    readCount(`/api/admin/orgs/${orgId}/drivers`, "drivers"),
    readCount(`/api/admin/orgs/${orgId}/driver-groups`, "groups"),
  ]);
  return (
    <>
      <StaffNav />
      <div className="border-y border-amber-300/50 bg-amber-300/10">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-widest text-amber-300">
              Support context
            </div>
            <div className="mt-0.5 text-sm text-ink-50">
              {org.displayName} | staff actor {me.email}
            </div>
          </div>
          <Link
            href={"/staff/overview/organisations" as Route}
            className="text-xs font-medium text-amber-200 underline underline-offset-2"
          >
            Exit support context
          </Link>
        </div>
      </div>
      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        <div className="sv-tagline">Organisation support</div>
        <h1 className="mt-1 text-2xl font-semibold text-ink-50">
          {org.displayName}
        </h1>
        <p className="mt-2 text-sm text-ink-400">
          {org.kind} | {org.status}
        </p>
        <dl className="mt-8 grid gap-px border border-bg-border bg-bg-border sm:grid-cols-2 lg:grid-cols-4">
          {[
            ["Installations", installations],
            ["Chargers", chargers],
            ["Drivers", drivers],
            ["Driver groups", groups],
          ].map(([label, value]) => (
            <div key={label as string} className="bg-bg-base p-4">
              <dt className="text-[11px] uppercase tracking-wider text-ink-500">
                {label}
              </dt>
              <dd className="mt-1 text-2xl font-semibold tabular-nums text-ink-50">
                {value ?? "Unavailable"}
              </dd>
            </div>
          ))}
        </dl>
        <p className="mt-6 max-w-3xl border-l-2 border-amber-300 px-4 text-sm leading-relaxed text-ink-300">
          This context is read-only. Entering it does not impersonate an
          organisation user or grant a mutation permission.
        </p>
      </main>
    </>
  );
}
