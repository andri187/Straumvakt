import Link from "next/link";
import type { Route } from "next";
import { redirect } from "next/navigation";
import { SHELL_SIGN_IN } from "@/lib/cpo-shell-policy";
import { DatabaseUnavailableError } from "@/lib/installations/api";
import { openDb, readDatabaseUrl } from "@/lib/installations/db";
import { listChargers } from "@/lib/installations/drizzle-store";
import { currentActor } from "@/lib/installations/session";
import { ContextBar } from "../workspace-ui";
import { LiveConnection, LiveStatusProvider } from "./live-status";

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
  if (!(await currentActor())) redirect(SHELL_SIGN_IN as Route);
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
          <div className="ws-table-wrap">
            <table className="ws-table">
              <thead>
                <tr>
                  {["Charger", "Charge point id", "Installation", "Circuit", "Equipment", "Connection"].map((c) => (
                    <th key={c} scope="col">
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.deviceId}>
                    <td>{r.label}</td>
                    <td>
                      <code>{r.chargePointId}</code>
                    </td>
                    <td>
                      <Link href={`/cpo/installations?id=${r.installationId}` as Route}>{r.installationName}</Link>
                    </td>
                    <td>{r.circuitName ?? "—"}</td>
                    <td>{[r.vendor, r.model].filter(Boolean).join(" ") || "Not recorded"}</td>
                    <td>
                      <LiveConnection deviceId={r.deviceId} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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
  return (
    <>
      <ContextBar />
      <p className="ws-banner" role="note">
        Registered chargers only. Chargers cannot connect yet, so no live status, session or limit is shown or confirmed.
      </p>
      <div className="ws-title">
        <div>
          <h1>Chargers</h1>
          <p>Equipment registered inside installations.</p>
        </div>
        <Link className="ws-button ws-primary" href={"/cpo/installations" as Route}>
          Choose installation to add a charger
        </Link>
      </div>
      {body}
    </>
  );
}
