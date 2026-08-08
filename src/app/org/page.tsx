// /org — tenant-agnostic entry point into the per-org landing template.
//
// Renders nothing. It resolves whichever organisation the signed-in
// host_admin belongs to and bounces to that tenant's canonical URL, so
// anything that wants to send a host somewhere useful can link to a fixed
// "/org" without knowing which tenant they are.
//
// Deliberately goes through the same requireOrgContext() as /org/[slug]
// rather than resolving the path itself, so every entry into the template
// gates identically: no session redirects to the login page, a non-host_admin
// persona redirects to /home, and a host_admin is sent to their own tenant's
// canonical URL (requireOrgContext redirects whenever the slug it was given —
// here, none — is not the resolved tenant's). Resolving the path separately
// here is what previously made an unauthenticated /org land on /home instead
// of the login page.
//
// See src/lib/org-context.ts for why the non-host_admin redirect never names
// a staff route.

import type { Route } from "next";
import { redirect } from "next/navigation";
import { requireOrgContext } from "@/lib/org-context";

export default async function OrgEntryPage() {
  // Never returns: with no slug passed, the canonical-slug check at the end
  // of requireOrgContext always redirects. The line below is unreachable
  // belt-and-braces so this can't fall through to rendering nothing.
  const { tenant } = await requireOrgContext();
  redirect(`/org/${tenant.slug}` as Route);
}
