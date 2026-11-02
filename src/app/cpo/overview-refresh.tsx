"use client";

import { useEffect, useState, useTransition } from "react";
import { RefreshCw } from "lucide-react";
import { useStructural } from "./structural-react";

// The explicit Refresh for the installations and chargers overviews. The cooldown is enforced by the server before it does
// any work; this mirrors the server's retry-after so the button says the same thing. The only timer is a one-second local
// countdown while a wait is showing - it sends nothing.
export function OverviewRefresh() {
  const store = useStructural();
  const [, start] = useTransition();
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(0);
  const [note, setNote] = useState<string | null>(null);
  const until = store.updatesAvailable ? 0 : store.nextAllowedAt();

  useEffect(() => {
    setNow(Date.now());
  }, [store.getVersion()]);
  useEffect(() => {
    if (until <= now) return;
    const timer = setTimeout(() => setNow(Date.now()), 1000);
    return () => clearTimeout(timer);
  }, [until, now]);

  const remaining = Math.max(0, Math.ceil((until - now) / 1000));
  const age = store.lastCheckedAt === null || now === 0 ? null : Math.max(0, Math.round((now - store.lastCheckedAt) / 1000));

  async function click() {
    if (busy) return;
    setBusy(true);
    setNote(null);
    const outcome = await store.refresh();
    setBusy(false);
    start(() => {
      if (outcome.kind === "no_changes") setNote("No changes.");
      else if (outcome.kind === "failed") setNote("Could not check for updates. Try again shortly.");
      else if (outcome.kind === "denied") setNote("Access was lost. Sign in again.");
      else if (outcome.kind === "cooldown") setNote(`Checked recently. Next check in ${Math.ceil(outcome.retryAfterMs / 1000)} s.`);
      else setNote(null);
    });
  }

  return (
    <span className="ie-refresh">
      {store.updatesAvailable ? <span className="ws-badge" role="status">Updates available</span> : null}
      <button type="button" className="ws-button" disabled={busy || remaining > 0} aria-busy={busy} onClick={() => void click()}>
        <RefreshCw size={15} aria-hidden="true" />
        {busy ? "Refreshing…" : remaining > 0 ? `Refresh in ${remaining}s` : "Refresh"}
      </button>
      <span className="ws-muted" role="status" aria-live="polite">
        {note ?? (store.checkFailed ? "Last check failed." : age !== null ? `Checked ${age < 5 ? "just now" : `${age} s ago`}` : "")}
      </span>
    </span>
  );
}
