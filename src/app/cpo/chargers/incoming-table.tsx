"use client";

import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { Route } from "next";
import type { IncomingCharger } from "@/lib/installations/discovery";
import { MAX_BULK_ATTACH, attachSearch, pruneSelection, selectAllIds, toggleSelected } from "@/lib/installations/attachment-selection";
import { INCOMING_WINDOW_MS, incomingExpiresAtMs } from "@/lib/installations/incoming-window";
import { visibleIncoming } from "@/lib/installations/incoming-visible";
import "./chargers.css";

const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { timeZone: "UTC", dateStyle: "medium", timeStyle: "short" }) + " UTC";
const WINDOW_MINUTES = Math.round(INCOMING_WINDOW_MS / 60000);

type Snapshot = { rows: IncomingCharger[] | null; asOf: string };
type Problem = "denied" | "failed" | null;

/** The complete BootNotification as the server returns it for one row. */
export type BootDetail = {
  messageId: string;
  receivedAt: string;
  frameBytes: number;
  validation: { ok: true } | { ok: false; code: string; description: string };
  payload: unknown;
};
// loading: request in flight. none: the server has no capture. A cached `ready`/`none` is never fetched again by toggling.
type BootState = { s: "loading" } | { s: "ready"; detail: BootDetail } | { s: "none" } | { s: "failed" } | { s: "denied" };

/** Compact "message with code" glyph. Decorative: the button carries the accessible name. */
function BootIcon() {
  return (
    <svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d="M3 4.5h14a1 1 0 0 1 1 1v7.5a1 1 0 0 1-1 1H9l-3.5 3v-3H3a1 1 0 0 1-1-1V5.5a1 1 0 0 1 1-1z" />
      <path d="M8.2 7.6 6.3 9.3l1.9 1.7M11.8 7.6l1.9 1.7-1.9 1.7" />
    </svg>
  );
}

function BootPanel({ id, state }: { id: string; state: BootState | undefined }) {
  const region = { id, className: "cg-boot", role: "region", "aria-label": "BootNotification" } as const;
  if (!state || state.s === "loading") return <div {...region} aria-busy="true"><p className="cg-muted">Loading…</p></div>;
  if (state.s === "none") return <div {...region}><p className="cg-muted">No BootNotification received yet</p></div>;
  if (state.s === "denied") return <div {...region}><p className="cg-muted" role="alert">Access was lost, so this could not be read. Sign in again.</p></div>;
  if (state.s === "failed") return <div {...region}><p className="cg-muted" role="alert">Could not be loaded. Collapse and open it again, or press Refresh.</p></div>;
  const d = state.detail;
  let body: string;
  try {
    body = JSON.stringify(d.payload, null, 2) ?? "null";
  } catch {
    body = "";
  }
  return (
    <div {...region}>
      <p className="cg-boot-meta">
        <span>Message ID <code>{d.messageId}</code></span>
        <span>Received {when(d.receivedAt)}</span>
        {d.validation.ok ? null : <span>Not valid OCPP 1.6: {d.validation.code}</span>}
      </p>
      {/* Text node only: the charger's strings are never interpreted as markup. */}
      <pre className="cg-boot-body" tabIndex={0}>{body}</pre>
    </div>
  );
}

/**
 * Chargers that have knocked at this CPO's address but are not registered. These are recorded connection attempts
 * (throttled by the gateway), not live status. Attaching goes through the installation editor, the same operation as
 * typing the id by hand; nothing is registered until that form is saved.
 *
 * Unregistered rows are listed for a window after their last recorded knock. The server applies it; while the page is
 * open the rows are also hidden locally at their deadline using the clock offset learned from the response, with one
 * timeout and no network work. Refresh is the only read, one explicit request per click.
 */
export function Incoming({ rows, context, asOf, fetchImpl, onCount }: { rows: IncomingCharger[] | null; context: boolean; asOf?: string; fetchImpl?: typeof fetch; onCount?: (waiting: number | null) => void }) {
  const [snap, setSnap] = useState<Snapshot>({ rows, asOf: asOf ?? new Date(0).toISOString() });
  const [problem, setProblem] = useState<Problem>(null);
  const [pending, setPending] = useState(false);
  // null until mounted: the first client render shows exactly what the server rendered, then expiry is applied.
  const [nowMs, setNowMs] = useState<number | null>(null);
  const offset = useRef(0); // server clock minus browser clock, learned when a snapshot arrives
  const inFlight = useRef(false);
  // Opened captures are kept for the life of this snapshot: collapsing and opening again makes no request. Refresh clears them.
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const [boots, setBoots] = useState<ReadonlyMap<string, BootState>>(new Map());
  // Rows ticked for "Add to installation". Local only; pruned below whenever a row stops being shown.
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const bootAsked = useRef(new Set<string>());
  const fetchRef = useRef(fetchImpl);
  fetchRef.current = fetchImpl;

  const clock = useCallback(() => Date.now() + offset.current, []);
  const learnOffset = useCallback((iso: string) => {
    const server = Date.parse(iso);
    offset.current = Number.isFinite(server) && server > 0 ? server - Date.now() : 0;
  }, []);

  useEffect(() => {
    if (asOf) learnOffset(asOf);
    setNowMs(clock());
    // Back in view: re-evaluate against the cached snapshot. No request.
    const onVisible = () => document.visibilityState === "visible" && setNowMs(clock());
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [asOf, clock, learnOffset]);

  // A row the gateway reported with an open pending socket stays until the next read, however old its last boot is.
  const stays = (r: IncomingCharger) => r.socket === true;
  const visible = visibleIncoming(snap.rows, nowMs);

  // Tell the page how many are waiting, from exactly the rows shown below. Not before the browser clock is read (the first
  // render applies no window), and null when no list could be read, so "unavailable" is never reported as zero.
  const countRef = useRef(onCount);
  countRef.current = onCount;
  const waiting = snap.rows === null ? null : visible.length;
  useEffect(() => {
    if (snap.rows !== null && nowMs === null) return;
    countRef.current?.(waiting);
  }, [waiting, snap.rows, nowMs]);

  const visibleIds = visible.map((r) => r.chargePointId);
  const visibleKey = visibleIds.join("|");
  // A row that expired or was refreshed away is dropped from the selection, so no hidden row is ever carried along.
  useEffect(() => {
    setSelected((prev) => {
      const kept = pruneSelection(prev, visibleKey ? visibleKey.split("|") : []);
      return kept.length === prev.size ? prev : new Set(kept);
    });
  }, [visibleKey]);
  const chosen = pruneSelection(selected, visibleIds);
  const allChosen = visibleIds.length > 0 && chosen.length === Math.min(visibleIds.length, MAX_BULK_ATTACH);

  // One timeout, for the next deadline among the rows still shown. It only updates local state.
  useEffect(() => {
    const expiring = visible.filter((r) => !stays(r));
    if (nowMs === null || expiring.length === 0) return;
    const next = Math.min(...expiring.map((r) => incomingExpiresAtMs(Date.parse(r.lastSeenAt))));
    const t = setTimeout(() => setNowMs(clock()), Math.min(Math.max(next - clock() + 50, 50), 2 ** 31 - 1));
    return () => clearTimeout(t);
  }, [visible.map((r) => r.chargePointId).join("|"), nowMs, clock]); // eslint-disable-line react-hooks/exhaustive-deps

  async function refresh() {
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    try {
      const res = await (fetchRef.current ?? fetch)("/api/cpo/installations?incoming=1", { credentials: "same-origin", headers: { accept: "application/json" } });
      if (res.status === 401 || res.status === 403) return setProblem("denied");
      if (!res.ok) return setProblem("failed");
      const body = (await res.json()) as { incoming?: IncomingCharger[]; asOf?: string };
      if (!Array.isArray(body.incoming) || typeof body.asOf !== "string") return setProblem("failed");
      learnOffset(body.asOf);
      setSnap({ rows: body.incoming, asOf: body.asOf });
      // A deliberate Refresh invalidates opened captures and collapses the panels (collapsed is the default).
      bootAsked.current = new Set();
      setBoots(new Map());
      setOpen(new Set());
      setNowMs(clock());
      setProblem(null);
    } catch {
      setProblem("failed");
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }

  async function toggleBoot(chargePointId: string) {
    const isOpen = open.has(chargePointId);
    setOpen((prev) => {
      const next = new Set(prev);
      if (isOpen) next.delete(chargePointId);
      else next.add(chargePointId);
      return next;
    });
    // Opening for the first time reads the one capture. A cached result, or a request already made, is not repeated.
    if (isOpen || bootAsked.current.has(chargePointId)) return;
    bootAsked.current.add(chargePointId);
    const set = (st: BootState) => setBoots((prev) => new Map(prev).set(chargePointId, st));
    set({ s: "loading" });
    try {
      const res = await (fetchRef.current ?? fetch)(`/api/cpo/installations?incoming=1&boot=${encodeURIComponent(chargePointId)}`, { credentials: "same-origin", headers: { accept: "application/json" } });
      if (res.status === 401 || res.status === 403) return set({ s: "denied" });
      if (!res.ok) {
        bootAsked.current.delete(chargePointId); // a failure is retried by opening again
        return set({ s: "failed" });
      }
      const body = (await res.json()) as { capture?: BootDetail | null };
      set(body.capture && typeof body.capture.messageId === "string" ? { s: "ready", detail: body.capture } : { s: "none" });
    } catch {
      bootAsked.current.delete(chargePointId);
      set({ s: "failed" });
    }
  }

  if (!context) return <p className="ws-note" role="note">No CPO is set for this workspace, so incoming chargers are not listed.</p>;
  const recovery = (snap.rows ?? []).filter((r) => r.state === "recovery");
  return (
    <section className="cg-section" aria-labelledby="incoming-h">
      <div className="cg-section-title">
        <h2 id="incoming-h">Incoming chargers</h2>
        <span>Not registered</span>
        <button type="button" className="cg-refresh" onClick={refresh} disabled={pending} aria-busy={pending}>{pending ? "Refreshing…" : "Refresh"}</button>
      </div>
      {problem === "denied" ? (
        <p className="ws-note" role="alert">Access was lost, so the list could not be read. Sign in again.</p>
      ) : problem === "failed" ? (
        <p className="ws-note" role="alert">Incoming chargers could not be loaded. Press Refresh to try again.</p>
      ) : null}
      {snap.rows === null ? (
        problem ? null : <p className="ws-note" role="note">Incoming chargers could not be loaded.</p>
      ) : visible.length === 0 ? (
        <p className="ws-muted">
          None seen in the last {WINDOW_MINUTES} minutes as of the last read. A charger that tries to connect with an unregistered id appears here; this is not a list of what is online. Refresh reads the list again; it does not contact a charger.
        </p>
      ) : (
        <div className="ws-table-wrap">
          <div className="cg-bulk" role="group" aria-label="Selected incoming chargers">
            <span role="status" aria-live="polite">{chosen.length === 0 ? "None selected" : `${chosen.length} selected`}{visibleIds.length > MAX_BULK_ATTACH ? ` (up to ${MAX_BULK_ATTACH} at a time)` : ""}</span>
            {chosen.length > 0 ? (
              <Link className="cg-attach cg-attach-bulk" href={`/cpo/installations${attachSearch(chosen)}` as Route} prefetch={false}>Add to installation…</Link>
            ) : (
              <span className="cg-attach cg-attach-bulk cg-disabled" aria-disabled="true">Add to installation…</span>
            )}
          </div>
          <table className="ws-table cg-table cg-incoming" aria-label="Incoming chargers">
            <thead>
              <tr>
                <th scope="col" className="cg-check">
                  <input type="checkbox" checked={allChosen} onChange={() => setSelected(allChosen ? new Set() : selectAllIds(visibleIds))} aria-label="Select all shown incoming chargers" />
                </th>
                <th scope="col">OCPP identity</th>
                <th scope="col">Last seen</th>
                <th scope="col" className="cg-actions"><span className="cg-sr">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => {
                const panelId = `boot-${r.chargePointId}`;
                const isOpen = open.has(r.chargePointId);
                return (
                  <Fragment key={r.chargePointId}>
                    <tr className="cg-row">
                      <td className="cg-check">
                        <input type="checkbox" checked={selected.has(r.chargePointId)} disabled={!selected.has(r.chargePointId) && selected.size >= MAX_BULK_ATTACH} onChange={() => setSelected((prev) => toggleSelected(prev, r.chargePointId))} aria-label={`Select ${r.chargePointId}`} />
                      </td>
                      <td><code className="cg-id">{r.chargePointId}</code></td>
                      <td className="cg-muted">
                        {when(r.lastSeenAt)}
                        {r.socket === true ? <span className="cg-socket" title="Reported by the gateway: a waiting connection is open. This does not prove the charger is responding."> · connection open</span> : null}
                      </td>
                      <td className="cg-actions">
                        <div className="cg-actions-row">
                        <button type="button" className="cg-boot-btn" onClick={() => void toggleBoot(r.chargePointId)} aria-expanded={isOpen} aria-controls={panelId} aria-label="Show BootNotification" title="Show BootNotification">
                          <BootIcon />
                          <span className="cg-sr"> {r.chargePointId}</span>
                        </button>
                        <Link className="cg-attach" href={`/cpo/installations?attach=${encodeURIComponent(r.chargePointId)}` as Route} prefetch={false}>
                          Attach…<span className="cg-sr"> {r.chargePointId}</span>
                        </Link>
                        </div>
                      </td>
                    </tr>
                    {isOpen ? (
                      <tr className="cg-boot-row">
                        <td colSpan={4}><BootPanel id={panelId} state={boots.get(r.chargePointId)} /></td>
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {snap.rows !== null && snap.asOf && Date.parse(snap.asOf) > 0 ? <p className="cg-asof" role="status">Read {when(snap.asOf)}. Listed for {WINDOW_MINUTES} minutes after the last recorded attempt, or while a waiting connection is open.</p> : null}
      {recovery.length > 0 && (
        <>
          <h3 className="cg-subhead">Known chargers needing attention</h3>
          <ul className="cg-recovery">
            {recovery.map((r) => (
              <li key={r.chargePointId}><code className="cg-id">{r.chargePointId}</code> <span className="cg-muted">last seen {when(r.lastSeenAt)} — {r.note}</span></li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
