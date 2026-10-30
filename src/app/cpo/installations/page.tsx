import Link from "next/link";
import type { Route } from "next";
import { redirect } from "next/navigation";
import { SHELL_SIGN_IN } from "@/lib/cpo-shell-policy";
import { toView } from "@/lib/installations/api";
import { DatabaseUnavailableError } from "@/lib/installations/api";
import { liveDeps } from "@/lib/installations/repo";
import { currentActor } from "@/lib/installations/session";
import { ContextBar } from "../workspace-ui";
import { InstallationEditor } from "./installation-editor";

export const metadata = { title: "Installations" };
export const dynamic = "force-dynamic";

type Search = Promise<{ id?: string | string[]; new?: string | string[] }>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

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

export default async function Page({ searchParams }: { searchParams: Search }) {
  if (!(await currentActor())) redirect(SHELL_SIGN_IN as Route);
  const sp = await searchParams;
  const id = first(sp.id);
  const wantsNew = first(sp.new) !== undefined;
  const deps = liveDeps();

  let body: React.ReactNode;
  let title = "Installations";
  let subtitle = "Locations, electrical structure and chargers.";
  try {
    if (id) {
      const found = /^[0-9a-f-]{36}$/i.test(id) ? await deps.withRepo((r) => r.get(id)) : null;
      if (!found) {
        body = (
          <State title="Installation not found">
            It may have been removed, or the link is wrong. <Link href={"/cpo/installations" as Route}>Back to all installations</Link>
          </State>
        );
      } else {
        title = found.snapshot.installation.displayName;
        subtitle = "Edit this installation, its electrical structure and its chargers on one page.";
        body = <InstallationEditor initial={toView(found.snapshot, found.routingId, found.history)} directory={null} />;
      }
    } else if (wantsNew) {
      title = "Add installation";
      subtitle = "An installation can be saved with no chargers; add them now or later.";
      const directory = await deps.withRepo((r) => r.directory());
      body = <InstallationEditor initial={null} directory={directory} />;
    } else {
      const rows = await deps.withRepo((r) => r.list(50, 0));
      body =
        rows.length === 0 ? (
          <State title="No installations yet">None have been added. This describes the database, not any charger connection.</State>
        ) : (
          <div className="ws-table-wrap">
            <table className="ws-table">
              <thead>
                <tr>
                  {["Installation", "Organisation", "Site", "Circuits", "Chargers", "Revision"].map((c) => (
                    <th key={c} scope="col">
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <Link href={`/cpo/installations?id=${r.id}` as Route}>{r.displayName}</Link>
                    </td>
                    <td>{r.orgName}</td>
                    <td>{r.siteName}</td>
                    <td>{r.circuitCount}</td>
                    <td>{r.chargerCount}</td>
                    <td>{r.revision}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {rows.length === 50 ? <p className="ws-muted">Showing the 50 most recently changed installations.</p> : null}
          </div>
        );
    }
  } catch (error) {
    body =
      error instanceof DatabaseUnavailableError ? (
        <State title="Database not connected">
          This deployment has no database configured, so installations cannot be loaded or saved. Nothing is shown because nothing could be read.
        </State>
      ) : (
        <State title="Could not load installations">The database did not answer. Nothing was changed. Reload to try again.</State>
      );
  }

  return (
    <>
      <ContextBar />
      <p className="ws-banner" role="note">
        Connected to the Straumvakt database. Chargers cannot connect yet: connection addresses are not active, and no charger&apos;s status or limits are confirmed.
      </p>
      <div className="ws-title">
        <div>
          <h1>{title}</h1>
          <p>{subtitle}</p>
        </div>
        {!id && !wantsNew ? (
          <Link className="ws-button ws-primary" href={"/cpo/installations?new=1" as Route}>
            Add installation
          </Link>
        ) : (
          <Link className="ws-button" href={"/cpo/installations" as Route}>
            All installations
          </Link>
        )}
      </div>
      {body}
    </>
  );
}
