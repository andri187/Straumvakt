// Entry gate for every /cpo page. Middleware already redirects anonymous
// visitors; this verifies the shell session again on the server so a page
// can never render without one even if the routing layer is bypassed.

import type { Metadata, Route } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { readShellCookie, SHELL_SIGN_IN } from "@/lib/cpo-shell-policy";
import { verifyShellSession } from "@/lib/cpo-shell-session";
import { CpoSidebar } from "./cpo-sidebar";
import "./workspace.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Workspace" };

export default async function CpoLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const cookie = readShellCookie((await headers()).get("cookie"));
  const session = await verifyShellSession(cookie);
  if (!session) redirect(SHELL_SIGN_IN as Route);

  return (
    <div className="flex min-h-screen flex-col bg-bg-base text-ink-50 md:flex-row">
      <CpoSidebar username={session.username} />
      <main className="min-w-0 flex-1 px-4 py-6 md:px-8 md:py-8">
        <div className="ws">{children}</div>
      </main>
    </div>
  );
}
