"use client";

import { useEffect, useRef, useState } from "react";
import { useStructural, useViewEntry } from "../structural-react";
import { GroupedChargers } from "./grouped-table";
import { Incoming } from "./incoming-table";
import { LiveStatusProvider } from "./live-status";
import type { ChargerTab } from "./charger-tab";

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

const TABS: readonly { id: ChargerTab; label: string }[] = [
  { id: "registered", label: "Already onboarded" },
  { id: "knocking", label: "Knocking" },
];

/**
 * Registered chargers and the ones knocking (incoming, not registered), in two tabs. The page around it renders at once; each
 * list loads on its own through the shared store and neither waits for the other. Both panels stay mounted and the inactive one
 * is only hidden, so switching tabs makes no request and loses no selection, opened capture or expiry state. The registered
 * list is structural and kept like the installations list; Incoming is operational, so it is reused only while fresh and read
 * again on entry otherwise.
 *
 * The waiting count comes from the rows the Knocking table itself shows (same window, same expiry), so the badge, the notice
 * and the table cannot disagree. It adds no read, timer or storage: when no list could be read it says so instead of zero.
 */
export function ChargersOverview({ context, initialTab = "registered" }: { context: boolean; initialTab?: ChargerTab }) {
  const store = useStructural();
  useViewEntry(store, async () => {
    await Promise.all([store.ensureChargers(), context ? store.ensureIncoming() : Promise.resolve()]);
  });
  useEffect(() => {
    if (store.chargers.status === "idle" && !store.denied) void store.ensureChargers();
  }, [store, store.chargers.status]);

  const [tab, setTab] = useState<ChargerTab>(initialTab);
  // undefined: the Knocking table has not reported yet. null: no list could be read. A number: visible, not-yet-onboarded rows.
  const [reported, setReported] = useState<number | null | undefined>(undefined);
  const tabRefs = useRef<Partial<Record<ChargerTab, HTMLButtonElement | null>>>({});

  const inc = store.incoming;
  const incoming = !context ? null : inc.status === "ready" ? inc.data : inc.status === "loading" || inc.status === "error" ? inc.previous : null;
  const ch = store.chargers;
  const data = ch.status === "ready" ? ch.data : ch.status === "loading" || ch.status === "error" ? ch.previous : null;

  const incomingLoading = context && !incoming && (inc.status === "idle" || inc.status === "loading");
  // Not reported while the Knocking table is not on the page (first load, or a local write cleared the list to read again).
  const waiting: number | null | undefined = !context || incomingLoading ? undefined : reported;

  function select(next: ChargerTab, focus = false) {
    setTab(next);
    if (focus) tabRefs.current[next]?.focus();
    // Keep the address honest for reload and sharing. A history edit only: no navigation, no request.
    try {
      const url = new URL(window.location.href);
      if (next === "knocking") url.searchParams.set("tab", "knocking");
      else url.searchParams.delete("tab");
      window.history.replaceState(null, "", url);
    } catch {
      /* the tab still switches */
    }
  }

  function onKeyDown(event: React.KeyboardEvent) {
    const at = TABS.findIndex((t) => t.id === tab);
    const to = event.key === "ArrowRight" ? (at + 1) % TABS.length : event.key === "ArrowLeft" ? (at + TABS.length - 1) % TABS.length : event.key === "Home" ? 0 : event.key === "End" ? TABS.length - 1 : -1;
    if (to < 0) return;
    event.preventDefault();
    select(TABS[to].id, true);
  }

  const badge =
    !context || waiting === undefined ? null : waiting === null ? (
      <span className="cg-badge cg-badge-unknown" title="Waiting chargers could not be checked">?<span className="cg-sr"> waiting count unavailable</span></span>
    ) : waiting > 0 ? (
      <span className="cg-badge">{waiting}<span className="cg-sr"> not onboarded</span></span>
    ) : null;

  return (
    <>
      <div className="cg-tabs" role="tablist" aria-label="Chargers" onKeyDown={onKeyDown}>
        {TABS.map((t) => (
          <button
            key={t.id}
            ref={(el) => { tabRefs.current[t.id] = el; }}
            type="button"
            role="tab"
            id={`cg-tab-${t.id}`}
            aria-selected={tab === t.id}
            aria-controls={`cg-panel-${t.id}`}
            tabIndex={tab === t.id ? 0 : -1}
            className="cg-tab"
            onClick={() => select(t.id)}
          >
            {t.label}
            {t.id === "knocking" ? badge : null}
          </button>
        ))}
      </div>

      {tab === "registered" && context && typeof waiting === "number" && waiting > 0 ? (
        <p className="cg-waiting" role="status">
          <strong>{waiting} charger{waiting === 1 ? " is" : "s are"} knocking</strong> and not onboarded yet.{" "}
          <button type="button" className="cg-review" onClick={() => select("knocking", true)}>Review</button>
        </p>
      ) : tab === "registered" && context && waiting === null ? (
        <p className="cg-waiting cg-waiting-unknown" role="status">Chargers waiting to be onboarded could not be checked. Open Knocking and press Refresh to try again.</p>
      ) : null}

      <div role="tabpanel" id="cg-panel-registered" aria-labelledby="cg-tab-registered" hidden={tab !== "registered"}>
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
      </div>

      <div role="tabpanel" id="cg-panel-knocking" aria-labelledby="cg-tab-knocking" hidden={tab !== "knocking"}>
        {incomingLoading ? (
          <p className="ws-muted" role="status" aria-busy="true">Loading incoming chargers…</p>
        ) : (
          <Incoming key={incoming?.asOf ?? "none"} rows={incoming?.rows ?? null} context={context} asOf={incoming?.asOf} onCount={setReported} />
        )}
      </div>
    </>
  );
}
