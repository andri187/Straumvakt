import { Suspense } from "react";
import { headers } from "next/headers";
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
  const reqHeaders = await headers();
  let isAdmin = reqHeaders.get("x-straumvakt-admin-verified") === "1";
  if (!isAdmin) {
    const res = await apiFetchServer("/api/admin/me");
    if (!res.ok) redirect("/login");
    isAdmin = true;
  }
  void isAdmin;

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
