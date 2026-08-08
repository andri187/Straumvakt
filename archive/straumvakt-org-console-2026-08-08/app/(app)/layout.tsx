import { Suspense } from "react";
import type { Route } from "next";
import { redirect } from "next/navigation";
import { Sidebar } from "@/components/sidebar";
import { SidebarProvider } from "@/components/sidebar-context";
import { apiFetchServer } from "@/lib/api-client-server";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Session ownership lives on the API Worker. Verifying here means
  // forwarding the cookie to GET /api/admin/me — if the API Worker
  // HMAC-checks it, it returns 200 + session payload; otherwise 401
  // and we redirect. The UI Worker no longer needs AUTH_SECRET, so
  // the two-secret-coupling that bounced operators silently when the
  // values drifted is gone.
  //
  // The middleware-stamped header (x-straumvakt-admin-verified) is
  // still honoured as a fast-path so we don't double-fetch when the
  // middleware did fire — but the deployed OpenNext webpack build
  // ships an empty middleware-manifest at the moment, so the /me
  // round-trip carries the load.
  // Always resolve /me here (not just for auth) so we can route by persona:
  // a host_admin who lands on the operator console gets redirected to their
  // own /host portal (the operator pages are platform-gated and 403 for them).
  const res = await apiFetchServer("/api/admin/me");
  if (!res.ok) redirect("/login");
  const me = (await res.json().catch(() => ({}))) as { persona?: string };
  if (me.persona === "host_admin") redirect("/host" as Route);
  // operators / platform staff / others stay in the cross-tenant console

  return (
    <SidebarProvider>
      <div className="flex min-h-screen bg-bg-base text-ink-50">
        <Suspense fallback={null}>
          <Sidebar />
        </Suspense>
        <main className="flex-1 min-w-0 overflow-x-hidden">{children}</main>
      </div>
    </SidebarProvider>
  );
}
