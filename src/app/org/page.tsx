// /org — tenant-agnostic entry point into the per-org landing template.
//
// Renders nothing. It resolves whichever organisation the signed-in
// host_admin belongs to and bounces to that tenant's canonical URL, so
// anything that wants to send a host somewhere useful can link to a fixed
// "/org" without knowing which tenant they are.
//
// A caller who is not a host_admin is sent to /home — see
// src/lib/org-context.ts for why the redirect never names a staff route.

import { redirect } from "next/navigation";
import { orgLandingPathForSession } from "@/lib/org-context";

export default async function OrgEntryPage() {
  const path = await orgLandingPathForSession();
  redirect(path ?? "/home");
}
