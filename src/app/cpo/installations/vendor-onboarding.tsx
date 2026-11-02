"use client";

// Direct OEM onboarding: charger model → one OEM connection → a compact multiselect of the account's installations →
// "Onboard selected (N)" → the real saved outcome of each, inline. No file is downloaded or uploaded, there is no review page
// and nothing is copied between tools.
//
// Everything goes through the one installations endpoint (signed session, same-origin check, JSON). The server holds the OEM
// access token in a sealed, bound, short-lived cookie this page cannot read; the page never sees a token. The password is
// typed here, sent once to sign in, and cleared from the page at once. A package is never sent from here: the server reads
// each selected installation itself and saves it through the existing save service. See src/lib/installations/vendor-onboarding.ts.
//
// Limits: one server action at a time (the form is read-only while one runs); installations are onboarded one after another,
// two seconds apart, and the run stops on a rate limit; a response that arrives after the connection, the model or the page
// changed is discarded. Each installation keeps one idempotency key while its inputs are unchanged, so a lost response is
// resolved by pressing Onboard again (the server answers "already imported" rather than creating a second installation).

import Link from "next/link";
import { useRouter } from "next/navigation";
import { structuralStore } from "@/lib/sync/structural-singleton";
import type { Route } from "next";
import { useEffect, useRef, useState } from "react";
import { Req, SITE_CREATE, SiteCreate } from "./installation-editor";
import "./installation-editor.css";

type Directory = {
  organisations: { id: string; displayName: string; routingId: string | null }[];
  sites: { id: string; orgId: string; displayName: string; address: string | null }[];
};

const INSTALLATIONS_API = "/api/cpo/installations";
const PACE_MS = 2000;

/** The model choices. Only a vendor the server has switched on (and that has a reader) can be connected. */
const OEMS = [
  { slug: "easee", label: "Easee", model: "Charge", account: "Easee account email or phone" },
  { slug: "zaptec", label: "Zaptec", model: "Pro", account: "Zaptec account email" },
] as const;

type Listed = { id: string; name: string; activeChargerCount: number | null };
type Conn = { phase: "idle" | "checking" | "out" | "in"; expiresAt: number | null; label: string; installations: Listed[]; more: boolean; claims: string[] | null };
/** One vendor charger as the server reports it: registered in Straumvakt, configured at the OEM (or why not), never "connected". */
type Equip = {
  ref: string;
  name: string | null;
  serialNumber: string | null;
  chargePointId: string | null;
  address: string | null;
  registration: string;
  registrationMessage: string | null;
  configuration: { state: string; code: string; message: string } | null;
};
type Row = { state: "working" | "done" | "partial" | "error" | "waiting"; message: string; installationId: string | null; equipment?: Equip[] };
type Reply = { status: number; json: Record<string, unknown> };

const EMPTY: Conn = { phase: "idle", expiresAt: null, label: "", installations: [], more: false, claims: null };

const text = (v: unknown): string | null => (typeof v === "string" ? v : null);

function equipmentOf(value: unknown): Equip[] {
  if (!Array.isArray(value)) return [];
  const out: Equip[] = [];
  for (const v of value.slice(0, 500) as Record<string, unknown>[]) {
    if (!v || typeof v.ref !== "string" || typeof v.registration !== "string") continue;
    const c = v.configuration as Record<string, unknown> | null | undefined;
    out.push({
      ref: v.ref,
      name: text(v.name),
      serialNumber: text(v.serialNumber),
      chargePointId: text(v.chargePointId),
      address: text(v.address),
      registration: v.registration,
      registrationMessage: text(v.registrationMessage),
      configuration: c && typeof c.state === "string" ? { state: c.state, code: text(c.code) ?? "", message: text(c.message) ?? "" } : null,
    });
  }
  return out;
}

const REGISTERED = (e: Equip) => e.registration === "registered" || e.registration === "already_registered";
const CONFIG_LABEL: Record<string, string> = {
  configured: "Configured at the OEM and read back. Waiting for the charger to connect.",
  already_configured: "Already configured for this address. Waiting for the charger to connect.",
  blocked: "Not configured",
  failed: "Configuration did not finish",
  not_attempted: "Configuration not attempted",
};

function listed(value: unknown): Listed[] {
  if (!Array.isArray(value)) return [];
  const out: Listed[] = [];
  for (const v of value.slice(0, 50) as Record<string, unknown>[]) {
    if (!v || typeof v.id !== "string" || v.id === "" || typeof v.name !== "string") continue;
    out.push({ id: v.id, name: v.name, activeChargerCount: typeof v.activeChargerCount === "number" ? v.activeChargerCount : null });
  }
  return out;
}

async function call(body: Record<string, unknown>, signal?: AbortSignal): Promise<Reply> {
  const res = await fetch(INSTALLATIONS_API, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal });
  return { status: res.status, json: (await res.json().catch(() => ({}))) as Record<string, unknown> };
}

/** A failed reply as one sentence. Server messages are written to be shown; nothing upstream is passed on. */
function describe(r: Reply, what: string): string {
  if (r.status === 401) return "Your session has ended. Sign in again.";
  if (r.status === 503) return "The database is not connected for this deployment. Nothing was saved.";
  const problems = Array.isArray(r.json.problems) ? (r.json.problems as { path?: string; message?: string }[]) : [];
  const detail = problems[0]?.message ? ` (${problems[0].path ?? "input"}: ${problems[0].message})` : "";
  if (typeof r.json.message === "string") return `${r.json.message}${detail}`;
  return `${what} Nothing was changed.`;
}

const clock = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function VendorOnboarding({ directory, vendors, initialVendor = null }: { directory: Directory; vendors: string[]; initialVendor?: string | null }) {
  const router = useRouter();
  const org = directory.organisations[0] ?? null;
  const [sites, setSites] = useState(directory.sites);
  const [vendor, setVendor] = useState<string | null>(null);
  const [conn, setConn] = useState<Conn>(EMPTY);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [siteFor, setSiteFor] = useState<Record<string, string>>({});
  const [accept, setAccept] = useState(false);
  const [rows, setRows] = useState<Record<string, Row>>({});
  // Per installation, per OEM charger reference: the OCPP id the operator chose (or that is already registered).
  const [ids, setIds] = useState<Record<string, Record<string, string>>>({});
  const [creatingFor, setCreatingFor] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [waitUntil, setWaitUntil] = useState(0);
  const [nowMs, setNowMs] = useState(() => Date.now());

  // Bumped whenever the connection, the model or the page changes; a response from an earlier generation is discarded.
  const generation = useRef(0);
  // The synchronous one-at-a-time guard (state updates lag a render).
  const busy = useRef(false);
  const abort = useRef<AbortController | null>(null);
  // One idempotency key per installation while what is being asked for is unchanged.
  const keys = useRef<Record<string, { sig: string; key: string }>>({});

  useEffect(() => () => { generation.current += 1; abort.current?.abort(); }, []);

  // The vendor's own pause, counted down on the page. A local timer only; no request is made while it runs.
  useEffect(() => {
    if (waitUntil <= nowMs) return;
    const t = setTimeout(() => setNowMs(Date.now()), 1000);
    return () => clearTimeout(t);
  }, [waitUntil, nowMs]);
  const remaining = Math.max(0, Math.ceil((waitUntil - nowMs) / 1000));

  // The connection ends when it says it does; the installations are hidden then, not left looking usable.
  useEffect(() => {
    if (conn.phase !== "in" || conn.expiresAt === null) return;
    const g = generation.current;
    const t = setTimeout(() => {
      if (g !== generation.current) return;
      generation.current += 1;
      setConn({ ...EMPTY, phase: "out", label: conn.label });
      setNotice({ kind: "error", text: `The ${conn.label} connection has ended. Connect again to continue.` });
    }, Math.max(0, conn.expiresAt - Date.now()));
    return () => clearTimeout(t);
  }, [conn.phase, conn.expiresAt, conn.label]);

  const startWait = (seconds: number) => {
    const n = Date.now();
    setNowMs(n);
    setWaitUntil(n + Math.max(1, seconds) * 1000);
  };

  const resetSelection = () => { setSelected({}); setSiteFor({}); setRows({}); setIds({}); setCreatingFor(null); keys.current = {}; };

  async function exclusive(fn: () => Promise<void>) {
    if (busy.current) return;
    busy.current = true;
    setWorking(true);
    try { await fn(); } finally { busy.current = false; setWorking(false); }
  }

  const oem = OEMS.find((o) => o.slug === vendor) ?? null;

  /** Applies a reply to connect / resume. */
  function applyConnection(r: Reply, label: string, resumed: boolean) {
    if (r.status === 200 && r.json.connected === true) {
      const expires = typeof r.json.expiresAt === "string" ? Date.parse(r.json.expiresAt) : NaN;
      setConn({
        phase: "in",
        label: typeof r.json.label === "string" ? r.json.label : label,
        expiresAt: Number.isFinite(expires) ? expires : null,
        installations: listed(r.json.installations),
        more: r.json.more === true,
        claims: Array.isArray(r.json.claims) ? (r.json.claims as unknown[]).filter((c): c is string => typeof c === "string") : null,
      });
      return;
    }
    setConn({ ...EMPTY, phase: "out", label });
    if (r.status === 200) {
      if (resumed && r.json.reason === "vendor_session_ended") setNotice({ kind: "error", text: `${label} ended the earlier connection. Connect again.` });
      return;
    }
    if (r.status === 429) {
      const seconds = typeof r.json.retryAfter === "number" ? r.json.retryAfter : 60;
      startWait(seconds);
    }
    setNotice({ kind: "error", text: describe(r, `Could not connect to ${label}.`) });
  }

  async function chooseModel(slug: string) {
    if (busy.current || slug === vendor) return;
    const label = OEMS.find((o) => o.slug === slug)?.label ?? slug;
    generation.current += 1;
    abort.current?.abort();
    setVendor(slug);
    setNotice(null);
    resetSelection();
    setConn({ ...EMPTY, phase: "checking", label });
    await exclusive(async () => {
      const g = generation.current;
      try {
        // No sign-in and no vendor traffic unless this browser already holds a live connection for this model.
        const r = await call({ action: "vendor-inventory", vendor: slug });
        if (g !== generation.current) return;
        applyConnection(r, label, true);
      } catch {
        if (g !== generation.current) return;
        setConn({ ...EMPTY, phase: "out", label });
        setNotice({ kind: "error", text: "Network error. Nothing was changed." });
      }
    });
  }

  // Arriving from the model board (?model=): continue as if that model's button had just been pressed. Only a model this
  // deployment has switched on is honoured. The zero-delay timer makes development's mount/unmount/mount run it once.
  useEffect(() => {
    if (!initialVendor || !vendors.includes(initialVendor) || !OEMS.some((o) => o.slug === initialVendor)) return;
    const t = setTimeout(() => void chooseModel(initialVendor), 0);
    return () => clearTimeout(t);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function connect(event: React.FormEvent) {
    event.preventDefault();
    if (!vendor || !oem || busy.current || remaining > 0) return;
    if (!username.trim() || !password) { setNotice({ kind: "error", text: "Enter the account and password." }); return; }
    // The password lives in this variable for the length of one request and nowhere else: the field is cleared at once.
    const credentials = { username, password };
    setPassword("");
    await exclusive(async () => {
      generation.current += 1;
      const g = generation.current;
      setNotice(null);
      resetSelection();
      try {
        const r = await call({ action: "vendor-connect", vendor, ...credentials });
        if (g !== generation.current) return;
        applyConnection(r, oem.label, false);
        if (r.status === 200 && r.json.connected === true) setUsername("");
      } catch {
        if (g !== generation.current) return;
        setNotice({ kind: "error", text: "Network error. No connection was confirmed." });
      }
    });
  }

  async function disconnect() {
    if (!vendor || busy.current) return;
    const slug = vendor;
    const label = oem?.label ?? slug;
    await exclusive(async () => {
      generation.current += 1;
      abort.current?.abort();
      try { await call({ action: "vendor-disconnect", vendor: slug }); } catch { /* the cookie lapses on its own */ }
      resetSelection();
      setConn({ ...EMPTY, phase: "out", label });
      setNotice({ kind: "ok", text: `Disconnected from ${label}.` });
    });
  }

  const chosen = conn.installations.filter((i) => selected[i.id]);
  const todo = chosen.filter((i) => rows[i.id]?.state !== "done");
  const missingSite = todo.some((i) => !siteFor[i.id]);

  async function onboard() {
    if (!vendor || !org || busy.current || remaining > 0 || todo.length === 0) return;
    if (missingSite) { setNotice({ kind: "error", text: "Choose the Straumvakt site for each selected installation first." }); return; }
    const slug = vendor;
    const queue = todo.map((i) => ({ item: i, siteId: siteFor[i.id] }));
    await exclusive(async () => {
      const g = generation.current;
      const controller = new AbortController();
      abort.current = controller;
      const stale = () => g !== generation.current;
      const put = (id: string, row: Row | null) => setRows((rs) => { const next = { ...rs }; if (row) next[id] = row; else delete next[id]; return next; });
      setNotice(null);
      let saved = 0;
      let needAttention = 0;
      for (let n = 0; n < queue.length; n++) {
        const { item, siteId } = queue[n];
        if (n > 0) { await wait(PACE_MS); if (stale()) return; }
        // Same inputs → same key, so a lost response is retried as the same request; changed inputs are a new request.
        // The OCPP ids the operator chose (or that are already registered) travel with every request, so a retry is a complete
        // statement of intent and the server only does what is still unfinished.
        const chosenIds = Object.fromEntries(Object.entries(ids[item.id] ?? {}).map(([ref, id]) => [ref, id.trim()]).filter(([, id]) => id !== ""));
        const sig = `${slug}|${item.id}|${siteId}|${accept}|${JSON.stringify(chosenIds)}`;
        if (keys.current[item.id]?.sig !== sig) keys.current[item.id] = { sig, key: crypto.randomUUID() };
        const prior = rows[item.id]?.equipment;
        put(item.id, { state: "working", message: "Reading from the OEM, saving and configuring…", installationId: null, equipment: prior });
        let r: Reply;
        try {
          r = await call({ action: "vendor-onboard", vendor: slug, installationRef: item.id, siteId, idempotencyKey: keys.current[item.id].key, acceptVendorElectrical: accept, ocppIds: chosenIds }, controller.signal);
        } catch {
          if (stale()) return;
          needAttention += 1;
          put(item.id, { state: "error", message: "The request did not finish. If it was lost, onboard again: it will not create a second installation.", installationId: null, equipment: prior });
          continue;
        }
        if (stale()) return;
        // The request got an answer, so its key is spent: the next attempt (a retry of unfinished work) is a new request.
        delete keys.current[item.id];

        const savedId = r.json.installationId;
        if (r.status === 200 && typeof savedId === "string") {
          // Invalidate cached overviews after our own successful write. Client
          // form state is retained by the router's RSC merge.
          structuralStore().localMutation(savedId); // the shared overview/detail caches drop this installation now, not after a cooldown
          router.refresh();
          const equipment = equipmentOf(r.json.equipment);
          const warnings = Array.isArray(r.json.warnings) ? (r.json.warnings as string[]) : [];
          const notes = Array.isArray(r.json.notes) ? (r.json.notes as string[]) : [];
          const circuits = Number(r.json.circuits ?? 0);
          const registered = equipment.filter(REGISTERED).length;
          const needId = equipment.filter((e) => e.registration === "needs_identity" || e.registration === "invalid_identity").length;
          const configured = equipment.filter((e) => e.configuration?.state === "configured" || e.configuration?.state === "already_configured").length;
          const retryable = equipment.some((e) => e.registration === "failed" || e.configuration?.state === "failed" || e.configuration?.state === "not_attempted");
          // Registered chargers keep their ids on the page so the next request restates them.
          setIds((s) => ({ ...s, [item.id]: { ...(s[item.id] ?? {}), ...Object.fromEntries(equipment.filter(REGISTERED).flatMap((e) => (e.chargePointId ? [[e.ref, e.chargePointId]] : []))) } }));
          const finished = r.json.registrationComplete === true && !retryable;
          if (finished || equipment.length === 0) saved += 1;
          else needAttention += 1;
          const summary = r.json.outcome === "already_imported" && equipment.length === 0
            ? "Already onboarded earlier. The existing installation is unchanged."
            : `${r.json.outcome === "already_imported" ? "Installation already existed" : "Installation saved"} with ${circuits} circuit${circuits === 1 ? "" : "s"}. ${equipment.length === 0 ? "No chargers in the OEM data." : `${registered} of ${equipment.length} charger${equipment.length === 1 ? "" : "s"} registered, ${configured} configured at the OEM${needId > 0 ? `, ${needId} need an OCPP id` : ""}. No charger is confirmed connected until it sends its first BootNotification.`}`;
          put(item.id, {
            state: finished || equipment.length === 0 ? "done" : "partial",
            message: [summary, ...notes, ...(warnings.length ? [`${warnings.length} note${warnings.length === 1 ? "" : "s"}: ${warnings.slice(0, 3).join(" ")}`] : [])].join(" "),
            installationId: savedId,
            equipment,
          });
          continue;
        }

        needAttention += 1;
        const message = describe(r, "This installation could not be onboarded.");
        if (r.status === 409 && r.json.error === "connection_required") {
          // The connection is gone. Stop, keep what was saved, and ask for a fresh sign-in.
          put(item.id, { state: "error", message, installationId: null });
          generation.current += 1;
          setConn({ ...EMPTY, phase: "out", label: conn.label });
          setNotice({ kind: "error", text: `${message} Installations already saved are listed below.` });
          return;
        }
        if (r.status === 429) {
          startWait(typeof r.json.retryAfter === "number" ? r.json.retryAfter : 60);
          put(item.id, { state: "waiting", message, installationId: null });
          setNotice({ kind: "error", text: `${message} The remaining installations were not attempted.` });
          return;
        }
        put(item.id, { state: "error", message, installationId: null });
        if (r.status === 401) return;
      }
      setNotice({
        kind: needAttention > 0 ? "error" : "ok",
        text: `${saved} of ${queue.length} onboarded${needAttention > 0 ? `; ${needAttention} need${needAttention === 1 ? "s" : ""} attention` : ""}. Each result is shown on its row; the ones that failed can be tried again.`,
      });
    });
  }

  if (!org) return <p className="ws-muted">No CPO is associated with this workspace, so nothing can be onboarded.</p>;

  const enabled = vendors.filter((v) => OEMS.some((o) => o.slug === v));
  const names = new Map<string, number>();
  for (const i of conn.installations) names.set(i.name, (names.get(i.name) ?? 0) + 1);
  const allDone = chosen.length > 0 && todo.length === 0;

  return (
    <section className="vo" aria-label="Onboard from OEM">
      <p className="ws-note" role="note">
        Choose the charger model, connect to its OEM account, select the installations and press Onboard. An OEM site becomes a Straumvakt <em>installation</em>; you choose the Straumvakt <em>site</em> it belongs to.
        Straumvakt registers the chargers with the OCPP id you give each one, then (only where this deployment allows it) points them at your CPO address through the OEM&apos;s own API. Load balancing, current limits and charging are never changed, and no charger is started or stopped.
      </p>

      {enabled.length === 0 ? (
        <p className="ws-note" role="status">
          Direct connection to an OEM account is not enabled for this deployment. Add the installation by hand instead: <Link href={"/cpo/installations?new=1" as Route} prefetch={false}>Add installation</Link>.
        </p>
      ) : null}

      <div role="group" aria-label="Charger model" className="vo-models">
        {OEMS.map((o) => {
          const on = enabled.includes(o.slug);
          return (
            <button key={o.slug} type="button" className="vo-model" aria-pressed={vendor === o.slug} disabled={!on || working} onClick={() => void chooseModel(o.slug)}>
              <strong>{o.label} {o.model}</strong>
              <small>{on ? "Connect with the OEM account" : "Not enabled"}</small>
            </button>
          );
        })}
      </div>

      {vendor && oem && conn.phase === "checking" ? <p className="ws-muted" role="status">Checking for an existing {oem.label} connection…</p> : null}

      {vendor && oem && conn.phase === "out" ? (
        <form className="vo" onSubmit={(e) => void connect(e)} autoComplete="off" aria-busy={working}>
          <p className="ws-muted">
            Controlled operator test: use a Straumvakt-controlled {oem.label} account. The password is sent over HTTPS only to sign in once and is not stored. The connection then lasts at most 15 minutes and is kept in this browser as an encrypted cookie the page cannot read.
          </p>
          <fieldset disabled={working} style={{ border: 0, padding: 0, margin: 0 }}>
            <div className="ie-row">
              <label className="ie-field ie-grow"><span>{oem.account}<Req /></span>
                <input value={username} onChange={(e) => setUsername(e.target.value)} maxLength={320} autoComplete="off" spellCheck={false} aria-required="true" /></label>
              <label className="ie-field ie-grow"><span>Password<Req /></span>
                <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} maxLength={1024} autoComplete="off" aria-required="true" /></label>
            </div>
            <div className="vo-bar">
              <button type="submit" className="ws-button ws-primary" disabled={working || remaining > 0}>{working ? "Connecting…" : remaining > 0 ? `Wait ${remaining} s` : "Connect"}</button>
            </div>
          </fieldset>
        </form>
      ) : null}

      {vendor && oem && conn.phase === "in" ? (
        <>
          <div className="vo-bar">
            <p className="vo-connected">✓ Connected to {conn.label}{conn.expiresAt ? ` · ends ${clock(conn.expiresAt)}` : ""}</p>
            <button type="button" className="ws-button" onClick={() => void disconnect()} disabled={working}>Disconnect</button>
          </div>
          {conn.claims && conn.claims.length > 0 && !conn.claims.some((c) => /partner/i.test(c)) ? (
            <p className="ws-muted">This account is not a {conn.label} operator (Partner) account; the OEM may restrict what it can read.</p>
          ) : null}

          {conn.installations.length === 0 ? (
            <p className="ws-muted">This account lists no installations.</p>
          ) : (
            <ul className="vo-list" aria-label={`${conn.label} installations`}>
              {conn.installations.map((i) => {
                const row = rows[i.id];
                const on = selected[i.id] === true;
                const locked = working || row?.state === "done";
                return (
                  <li key={i.id} className="vo-row" data-selected={on}>
                    <label className="vo-row-main">
                      <input
                        type="checkbox" checked={on} disabled={locked}
                        onChange={(e) => {
                          setSelected((s) => ({ ...s, [i.id]: e.target.checked }));
                          if (!e.target.checked && creatingFor === i.id) setCreatingFor(null);
                        }}
                      />
                      <span className="vo-name">{i.name}{(names.get(i.name) ?? 0) > 1 ? <small className="ws-muted"> · reference …{i.id.slice(-6)}</small> : null}</span>
                      <span className="vo-count" title={`Count reported by ${conn.label}; not live connection status`}>{i.activeChargerCount === null ? "Chargers: —" : `${i.activeChargerCount} charger${i.activeChargerCount === 1 ? "" : "s"}`}</span>
                    </label>
                    {on && row?.state !== "done" && row?.state !== "partial" && !row?.equipment ? (
                      <div className="vo-site">
                        <label className="ie-field">
                          <span>Straumvakt site<Req /></span>
                          <select
                            value={creatingFor === i.id ? SITE_CREATE : (siteFor[i.id] ?? "")}
                            disabled={locked}
                            aria-required="true"
                            onChange={(e) => {
                              if (e.target.value === SITE_CREATE) setCreatingFor(i.id);
                              else { setCreatingFor(null); setSiteFor((s) => ({ ...s, [i.id]: e.target.value })); }
                            }}
                          >
                            <option value="">Choose…</option>
                            {sites.map((s) => <option key={s.id} value={s.id}>{s.displayName}{s.address ? ` — ${s.address}` : ""}</option>)}
                            <option value={SITE_CREATE}>Create Site +</option>
                          </select>
                        </label>
                      </div>
                    ) : null}
                    {creatingFor === i.id ? (
                      <SiteCreate
                        initialName={i.name}
                        onCancel={() => setCreatingFor(null)}
                        onSite={async (name, address) => {
                          if (busy.current) return false;
                          let made = false;
                          await exclusive(async () => {
                            try {
                              const res = await fetch("/api/cpo/directory", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "create-site", orgId: org.id, displayName: name, address }) });
                              if (!res.ok) { setNotice({ kind: "error", text: res.status === 503 ? "The database is not connected." : "Could not create that site." }); return; }
                              const body = (await res.json()) as { id: string };
                              setSites((s) => [...s, { id: body.id, orgId: org.id, displayName: name, address: address || null }]);
                              setSiteFor((s) => ({ ...s, [i.id]: body.id }));
                              setCreatingFor(null);
                              made = true;
                            } catch {
                              setNotice({ kind: "error", text: "Network error. The site may not have been created." });
                            }
                          });
                          return made;
                        }}
                      />
                    ) : null}
                    {row ? (
                      <p className={`vo-state ${row.state === "done" ? "vo-ok" : row.state === "working" ? "" : row.state === "waiting" || row.state === "partial" ? "vo-wait" : "vo-err"}`} role="status">
                        {row.message}{" "}
                        {row.installationId ? <Link className="ws-button" href={`/cpo/installations?id=${row.installationId}` as Route} prefetch={false}>Open installation</Link> : null}
                      </p>
                    ) : null}
                    {row?.equipment && row.equipment.length > 0 ? (
                      <ul className="vo-chargers" aria-label={`${i.name} chargers`}>
                        {row.equipment.map((e) => {
                          const needsId = e.registration === "needs_identity" || e.registration === "invalid_identity";
                          const chosenId = ids[i.id]?.[e.ref] ?? "";
                          return (
                            <li key={e.ref} className="vo-charger">
                              <strong>{e.name ?? e.ref}</strong>
                              {e.serialNumber ? <small className="ws-muted"> · serial {e.serialNumber}</small> : null}
                              {needsId ? (
                                <span className="vo-id">
                                  <label className="ie-field">
                                    <span>OCPP id for {e.name ?? e.ref}{e.registration === "invalid_identity" ? " (not valid)" : ""}</span>
                                    <input
                                      value={chosenId}
                                      maxLength={48}
                                      disabled={working || row.state === "done"}
                                      spellCheck={false}
                                      autoComplete="off"
                                      onChange={(ev) => setIds((s) => ({ ...s, [i.id]: { ...(s[i.id] ?? {}), [e.ref]: ev.target.value } }))}
                                    />
                                  </label>
                                  {e.serialNumber ? (
                                    <button type="button" className="ws-button" disabled={working} onClick={() => setIds((s) => ({ ...s, [i.id]: { ...(s[i.id] ?? {}), [e.ref]: e.serialNumber! } }))}>
                                      Use serial as OCPP id
                                    </button>
                                  ) : null}
                                </span>
                              ) : (
                                <span className="ws-muted"> · {REGISTERED(e) ? `registered as ${e.chargePointId}` : (e.registrationMessage ?? "not registered")}</span>
                              )}
                              {e.configuration ? (
                                <p className={`vo-state ${e.configuration.state === "configured" || e.configuration.state === "already_configured" ? "vo-ok" : e.configuration.state === "failed" ? "vo-err" : "vo-wait"}`}>
                                  {CONFIG_LABEL[e.configuration.state] ?? e.configuration.state}
                                  {e.configuration.state === "configured" || e.configuration.state === "already_configured" ? "" : `: ${e.configuration.message}`}
                                  {e.address && e.configuration.state !== "configured" && e.configuration.state !== "already_configured" ? <> Address: <code>{e.address}</code></> : null}
                                </p>
                              ) : needsId ? (
                                <p className="vo-state vo-wait">Not registered: enter this charger&apos;s OCPP id, then press Onboard again.</p>
                              ) : null}
                            </li>
                          );
                        })}
                      </ul>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
          {conn.more ? <p className="ws-muted">Showing the first {conn.installations.length} installations.</p> : null}

          {conn.installations.length > 0 ? (
            <>
              <label className="vo-check">
                <input type="checkbox" checked={accept} disabled={working} onChange={(e) => setAccept(e.target.checked)} />
                {" "}Use the OEM&apos;s rated current and three-phase flag for the circuits. These are the OEM&apos;s settings, not confirmed breaker ratings; left off, they stay unknown (no charging allowance) and the OEM values are kept for reference.
              </label>
              <div className="vo-bar">
                <button type="button" className="ws-button ws-primary" onClick={() => void onboard()} disabled={working || remaining > 0 || todo.length === 0 || missingSite}>
                  {working ? "Onboarding…" : remaining > 0 ? `Wait ${remaining} s` : `Onboard selected (${todo.length})`}
                </button>
                {todo.length > 0 && missingSite ? <span className="ws-muted">Choose a Straumvakt site for each selected installation.</span> : null}
                {allDone ? <span className="ws-muted">Everything selected has been onboarded.</span> : null}
              </div>
            </>
          ) : null}
        </>
      ) : null}

      <div role="status" aria-live="polite" className={`ie-msg ie-${notice?.kind ?? "none"}`}>{notice?.text}</div>
    </section>
  );
}
