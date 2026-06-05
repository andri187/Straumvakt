// Host portal layout — server-side gate via GET /api/admin/me (ADR 0027 /
// 0033). Runs once on entry to /host/* (App Router keeps the layout mounted
// across child navigations), so it doesn't re-fetch per page nav. Resolves
// the caller's persona + host org and hands them to the client shell.

import { redirect } from "next/navigation";
import { apiFetchServer } from "@/lib/api-client-server";
import { HostShell, type HostOrg } from "./host-shell";

type Me = {
  email: string;
  role: string;
  userId: string | null;
  persona: "operator" | "host_admin" | "member" | "none";
  isPlatform: boolean;
  orgs: HostOrg[];
};

export default async function HostLayout({ children }: { children: React.ReactNode }) {
  const res = await apiFetchServer("/api/admin/me");
  if (!res.ok) redirect("/login");
  const me = (await res.json()) as Me;

  // Operators belong in the cross-tenant console, not a single host view.
  if (me.persona === "operator") redirect("/dashboard");
  if (me.persona !== "host_admin") redirect("/login");

  const org = me.orgs.find((o) => o.role === "host_admin") ?? me.orgs[0];
  if (!org) redirect("/login");

  return (
    <HostShell email={me.email} org={org}>
      {children}
    </HostShell>
  );
}
