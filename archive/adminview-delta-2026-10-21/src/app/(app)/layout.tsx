import { Suspense } from "react";
import { Sidebar } from "@/components/sidebar";
import { SidebarProvider } from "@/components/sidebar-context";
import { apiFetchServer } from "@/lib/api-client-server";

// LOCAL BROKEN-PREVIEW BUILD: the auth redirect to /login has been removed so
// the operator console renders without a valid admin session cookie. The /me
// fetch is still attempted (so persona-aware bits behave if a session exists),
// but a 401/failure no longer bounces to /login. Inner pages still server-fetch
// the live API and will error/empty — that is the intended "broken" state.
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  try {
    await apiFetchServer("/api/admin/me");
  } catch {
    // ignore — preview renders the shell regardless of session state
  }

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
