import Link from "next/link";
import type { Route } from "next";
import { redirect } from "next/navigation";
import { SHELL_SIGN_IN } from "@/lib/cpo-shell-policy";
import { readContextOrgId } from "@/lib/installations/context";
import { currentActor } from "@/lib/installations/session";
import "../installations/installation-editor.css";
import { ContextBar } from "../workspace-ui";
import { OverviewRefresh } from "../overview-refresh";
import { ChargersOverview } from "./chargers-overview";

export const metadata = { title: "Chargers" };
export const dynamic = "force-dynamic";

// The page itself reads nothing from the database: it checks the signed session (no I/O), renders the shell, and the lists load
// through the shared structural store (src/lib/sync/structural-store.ts) from the existing endpoints, which authorise every request.
export default async function Page() {
  const actor = await currentActor();
  if (!actor) redirect(SHELL_SIGN_IN as Route);
  const context = readContextOrgId() !== null;
  return (
    <>
      <ContextBar />
      <div className="ws-title">
        <div>
          <h1>Chargers</h1>
          <p>Equipment registered inside installations.</p>
        </div>
        <div className="ie-buttons"><OverviewRefresh />
        <Link className="ws-button ws-primary" href={"/cpo/installations" as Route}>
          Choose installation to add a charger
        </Link></div>
      </div>
      <ChargersOverview context={context} />
    </>
  );
}
