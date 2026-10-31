import Link from "next/link";
import type { Route } from "next";
import { redirect } from "next/navigation";
import { SHELL_SIGN_IN } from "@/lib/cpo-shell-policy";
import { DatabaseUnavailableError } from "@/lib/installations/api";
import { openDb, readDatabaseUrl } from "@/lib/installations/db";
import type { IncomingCharger } from "@/lib/installations/discovery";
import { listChargers } from "@/lib/installations/drizzle-store";
import { shellDeps } from "@/lib/installations/live-bindings";
import { currentActor } from "@/lib/installations/session";
import "../installations/installation-editor.css";
import { ContextBar } from "../workspace-ui";
import { OverviewRefresh } from "../overview-refresh";
import { GroupedChargers } from "./grouped-table";
import { Incoming } from "./incoming-table";
import { LiveStatusProvider } from "./live-status";

export const metadata = { title: "Chargers" };
export const dynamic = "force-dynamic";

function State({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="ws-table-wrap">
      <div className="ws-empty">
        <strong>{title}</strong>
        {children}
      </div>
    </div>
  );
}

export default async function Page() {
  const actor = await currentActor();
  if (!actor) redirect(SHELL_SIGN_IN as Route);
  const deps = shellDeps();
  const ctx = deps.contextOrgId ?? null;
  let incoming: IncomingCharger[] | null = null;
  const incomingAsOf = new Date().toISOString();
  const incomingRead = (async () => { if (ctx) {
    try {
      incoming = await deps.withRepo((r) => r.listIncoming(ctx, actor));
    } catch {
      incoming = null;
    }
  } })();
  let body: React.ReactNode;
  try {
    const url = readDatabaseUrl();
    if (!url) throw new DatabaseUnavailableError();
    const { db, close } = openDb(url);
    try {
      const rows = await listChargers(db, { limit: 100, offset: 0 });
      body =
        rows.length === 0 ? (
          <State title="No chargers registered">
            A charger is registered inside an installation&apos;s circuit: open or add an installation, then use &quot;+ Charger&quot; on a circuit. This does not confirm that no charger is online.
          </State>
        ) : (
          <LiveStatusProvider>
          <GroupedChargers rows={rows} />
          {rows.length >= 100 ? <p className="cg-note">Showing the first 100 registered chargers.</p> : null}
          </LiveStatusProvider>
        );
    } finally {
      await close();
    }
  } catch (error) {
    body =
      error instanceof DatabaseUnavailableError ? (
        <State title="Database not connected">This deployment has no database configured, so chargers cannot be listed.</State>
      ) : (
        <State title="Could not load chargers">The database did not answer. Reload to try again.</State>
      );
  }
  await incomingRead;
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
      <Incoming key={incomingAsOf} rows={incoming} context={ctx !== null} asOf={incomingAsOf} />
      {body}
    </>
  );
}
