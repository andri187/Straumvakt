"use client";

import { useEffect } from "react";
import { useStructural, useViewEntry } from "../structural-react";
import { InstallationTree } from "./installation-tree";

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
 * The installations list. The page around it renders immediately (shell, title, buttons); this reads the list once through the
 * shared structural store and then keeps it: leaving and returning shows the same rows with no request. Whether it is still
 * current is the store's rate-limited check, never an assumption. Installation details load only when a row is expanded.
 */
export function InstallationsOverview({ attachQuery }: { attachQuery: string }) {
  const store = useStructural();
  useViewEntry(store, () => store.ensureOverview());
  const slot = store.overview;
  // Cleared while mounted (a local write elsewhere): read again rather than showing an empty page.
  useEffect(() => {
    if (slot.status === "idle" && !store.denied) void store.ensureOverview();
  }, [store, slot.status]);

  if (store.denied) {
    return <State title="Access was lost">Sign in again. Nothing is shown because nothing could be read.</State>;
  }
  const data = slot.status === "ready" ? slot.data : slot.status === "loading" || slot.status === "error" ? slot.previous : null;
  if (!data) {
    if (slot.status === "error") {
      return (
        <State title="Could not load installations">
          {slot.kind === "limited" ? "Too many reads just now. Wait a moment, then try again." : "The database did not answer."} Nothing was changed.{" "}
          <button type="button" className="it-retry" onClick={() => void store.ensureOverview(true)}>Try again</button>
        </State>
      );
    }
    return <p className="ws-muted" role="status" aria-busy="true">Loading installations…</p>;
  }
  if (data.rows.length === 0) return <State title="No installations yet">None have been added. This describes the database, not any charger connection.</State>;
  return (
    <>
      <InstallationTree rows={data.rows} attachQuery={attachQuery} />
      {data.rows.length === 50 ? <p className="ws-muted">Showing the 50 most recently changed installations; a site may list only some of its installations, and counts are of those shown.</p> : null}
      {slot.status === "error" ? <p className="ws-note" role="alert">{slot.kind === "limited" ? "The server asked for a short pause before reading again; this is the last list that loaded." : "The latest read failed; this is the last list that loaded."}</p> : null}
    </>
  );
}
