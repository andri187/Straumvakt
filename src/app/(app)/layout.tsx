import { Suspense } from "react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { Sidebar } from "@/components/sidebar";
import { SidebarProvider } from "@/components/sidebar-context";
import { adminSessionConfig, verifyAdminSession } from "@/lib/admin-session";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Middleware-as-belt-and-braces:  verify the session here too. The
  // OpenNext webpack build has been observed to ship an empty
  // middleware-manifest, in which case the middleware never runs and
  // unauthenticated visitors hit data-loading pages → 500. Reading the
  // cookie + HMAC-verifying it directly in the (app) layout makes
  // every protected page gated regardless of middleware bundling.
  const reqHeaders = await headers();
  let isAdmin = reqHeaders.get("x-straumvakt-admin-verified") === "1";
  if (!isAdmin) {
    const jar = await cookies();
    const token = jar.get(adminSessionConfig.SESSION_COOKIE_NAME)?.value;
    const session = await verifyAdminSession(token);
    if (!session) redirect("/login");
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
