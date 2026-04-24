import { Suspense } from "react";
import { headers } from "next/headers";
import { Sidebar } from "@/components/sidebar";
import { SidebarProvider } from "@/components/sidebar-context";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Middleware already verified the session via HMAC and stamped this
  // trusted header — reading it here avoids a second crypto.subtle round-trip.
  const reqHeaders = await headers();
  const isAdmin = reqHeaders.get("x-straumvakt-admin-verified") === "1";
  // Exposed only for components that can gate features on admin presence.
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
