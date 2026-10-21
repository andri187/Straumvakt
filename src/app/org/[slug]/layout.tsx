// Per-org landing template — entry gate.
//
// Runs once on entry to /org/[slug] (the App Router keeps a layout mounted
// across child navigations, so sub-pages don't re-resolve the org). It
// verifies the caller is a host_admin, loads their Organization row and
// resolves the tenant profile, then hands both to the client shell.
//
// See src/lib/org-context.ts for why this uses the existing
// /api/admin/me + /api/admin/orgs/:orgId endpoints and adds no auth of
// its own, and src/lib/org-tenant.ts for what "the tenant profile" is.

import type { Metadata } from "next";
import { requireOrgContext } from "@/lib/org-context";
import { OrgShell } from "./org-shell";
import "../org-landing.css";

type Params = { slug: string };

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const { slug } = await params;
  const { tenant } = await requireOrgContext(slug);
  return { title: tenant.wordmark };
}

export default async function OrgLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<Params>;
}) {
  const { slug } = await params;
  const { email, org, tenant } = await requireOrgContext(slug);

  return (
    <OrgShell value={{ email, org, tenant }}>{children}</OrgShell>
  );
}
