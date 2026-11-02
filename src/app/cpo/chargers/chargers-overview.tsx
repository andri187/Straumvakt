"use client";

import { useEffect } from "react";
import { useStructural, useViewEntry } from "../structural-react";
import { GroupedChargers } from "./grouped-table";
import { Incoming } from "./incoming-table";
import { LiveStatusProvider } from "./live-status";

function State({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="ws-table-wrap">
      <div className="ws-empty">
        <strong>{title}</strong>
        {children}
      </div>
    </div>
  );
}

/**
 * Incoming (discovery) and registered chargers. The page around it renders at once; each part loads on its own and neither
 * waits for the other. The registered list is structural and is kept in the shared store like the installations list;
 * Incoming is operational, so it is reused only while fresh and read again on entry otherwise.
 */
export function ChargersOverview({ context }: { context: boolean }) {
  const store = useStructural();
  useViewEntry(store, async () => {
    await Promise.all([store.ensureChargers(), context ? store.ensureIncoming() : Promise.resolve()]);
  });
  useEffect(() => {
    if (store.chargers.status === "idle" && !store.denied) void store.ensureChargers();
  }, [store, store.chargers.status]);

  const inc = store.incoming;
  const incoming = !context ? null : inc.status === "ready" ? inc.data : inc.status === "loading" || inc.status === "error" ? inc.previous : null;
  const ch = store.chargers;
  const data = ch.status === "ready" ? ch.data : ch.status === "loading" || ch.status === "error" ? ch.previous : null;

  return (
    <>
      {context && !incoming && (inc.status === "idle" || inc.status === "loading") ? (
        <p className="ws-muted" role="status" aria-busy="true">Loading incoming chargers…</p>
      ) : (
        <Incoming key={incoming?.asOf ?? "none"} rows={incoming?.rows ?? null} context={context} asOf={incoming?.asOf} />
      )}
      {store.denied ? (
        <State title="Access was lost">Sign in again. Nothing is shown because nothing could be read.</State>
      ) : data === null ? (
        ch.status === "error" ? (
          <State title="Could not load chargers">
            {ch.kind === "limited" ? "Too many reads just now. Wait a moment, then try again." : "The database did not answer."}{" "}
            <button type="button" className="it-retry" onClick={() => void store.ensureChargers(true)}>Try again</button>
          </State>
        ) : (
          <p className="ws-muted" role="status" aria-busy="true">Loading chargers…</p>
        )
      ) : data.rows.length === 0 ? (
        <State title="No chargers registered">
          A charger is registered inside an installation&apos;s circuit: open or add an installation, then use &quot;+ Charger&quot; on a circuit. This does not confirm that no charger is online.
        </State>
      ) : (
        <LiveStatusProvider installationIds={[...new Set(data.rows.map((r) => r.installationId))]}>
          <GroupedChargers rows={data.rows} />
          {data.rows.length >= 100 ? <p className="cg-note">Showing the first 100 registered chargers.</p> : null}
        </LiveStatusProvider>
      )}
    </>
  );
}
