import type { Route } from "next";
import { notFound, redirect } from "next/navigation";
import { SHELL_SIGN_IN } from "@/lib/cpo-shell-policy";
import { currentActor } from "@/lib/installations/session";
import { canViewPlatformKpis, KpiOverview } from "./kpi-overview";

export const metadata = { title: "Overview" };

export default async function CpoOverviewPage() {
  // The layout and page render independently, so the page checks the actor itself.
  const actor = await currentActor();
  if (!actor) redirect(SHELL_SIGN_IN as Route);
  if (!canViewPlatformKpis(actor)) notFound();
  return <KpiOverview />;
}
