"use client";

// One-page installation editor: installation fields, on-site electrician, an
// editable circuit/sub-circuit/charger tree, and the change history. No wizard,
// no checklist, no activation step. Rows added, edited or removed here are local
// until Save, which submits the whole document once with the revision it was
// loaded at. A stale revision is refused by the server and surfaced here, never
// overwritten.

import Link from "next/link";
import type { Route } from "next";
import { useCallback, useMemo, useRef, useState } from "react";
import "./installation-editor.css";

type View = {
  installation: {
    id: string;
    key: string;
    orgId: string;
    siteId: string;
    displayName: string;
    revision: number;
    mainDeviceType: string | null;
    mainRatingAmps: number | null;
    mainPhaseCount: 1 | 2 | 3 | null;
    electrician: { name: string | null; email: string | null; phone: string | null };
    responsible: { status: "not_provided" | "not_confirmed" | "confirmed" };
    password: { mode: "unset" | "none" | "password"; setAt: string | null };
  };
  circuits: { id: string; parentId: string | null; displayName: string; ratingAmps: number | null; phaseCount: 1 | 2 | 3 | null }[];
  chargers: { id: string; circuitId: string; label: string; chargePointId: string; vendor: string | null; model: string | null; serialNumber: string | null }[];
  connection: { status: "not_active"; address: string; note: string };
  history?: { id: string; revision: number; entityType: string; action: string; diff: Record<string, { from: unknown; to: unknown }>; actorLabel: string; effectiveAt: string | null; occurredAt: string }[];
};

type Directory = {
  organisations: { id: string; displayName: string; routingId: string | null }[];
  sites: { id: string; orgId: string; displayName: string; address: string | null }[];
};

type CircuitRow = { id: string; parentId: string | null; displayName: string; ratingAmps: string; phaseCount: "" | "1" | "2" | "3" };
type ChargerRow = { id: string; circuitId: string; label: string; chargePointId: string; vendor: string; model: string; serialNumber: string };
type Problem = { path: string; message: string };

const MAX_DEPTH = 8;
const asText = (n: number | null | undefined) => (n === null || n === undefined ? "" : String(n));
const uid = () => `new-${crypto.randomUUID()}`;

function toCircuitRows(v: View | null): CircuitRow[] {
  return (v?.circuits ?? []).map((c) => ({ id: c.id, parentId: c.parentId, displayName: c.displayName, ratingAmps: asText(c.ratingAmps), phaseCount: asText(c.phaseCount) as CircuitRow["phaseCount"] }));
}
function toChargerRows(v: View | null): ChargerRow[] {
  return (v?.chargers ?? []).map((c) => ({ id: c.id, circuitId: c.circuitId, label: c.label, chargePointId: c.chargePointId, vendor: c.vendor ?? "", model: c.model ?? "", serialNumber: c.serialNumber ?? "" }));
}

/** "" = unknown (null). "0" = a deliberately entered zero. Anything else must be a whole number. */
function parseAmps(s: string): { value: number | null; bad: boolean } {
  const t = s.trim();
  if (t === "") return { value: null, bad: false };
  if (!/^\d{1,4}$/.test(t)) return { value: null, bad: true };
  return { value: Number(t), bad: false };
}

function allowanceText(chain: (number | null)[]): string {
  for (const r of chain) if (r === null) return "0 A — capacity unknown";
  return `${Math.min(...(chain as number[]))} A`;
}

export function InstallationEditor({ initial, directory }: { initial: View | null; directory: Directory | null }) {
  const [view, setView] = useState<View | null>(initial);
  const [dir, setDir] = useState<Directory | null>(directory);

  const [name, setName] = useState(initial?.installation.displayName ?? "");
  const [orgId, setOrgId] = useState(initial?.installation.orgId ?? "");
  const [siteId, setSiteId] = useState(initial?.installation.siteId ?? "");
  const [mainType, setMainType] = useState(initial?.installation.mainDeviceType ?? "");
  const [mainAmps, setMainAmps] = useState(asText(initial?.installation.mainRatingAmps));
  const [mainPhases, setMainPhases] = useState<"" | "1" | "2" | "3">(asText(initial?.installation.mainPhaseCount) as "" | "1" | "2" | "3");
  const [eName, setEName] = useState(initial?.installation.electrician.name ?? "");
  const [eEmail, setEEmail] = useState(initial?.installation.electrician.email ?? "");
  const [ePhone, setEPhone] = useState(initial?.installation.electrician.phone ?? "");
  const [effectiveAt, setEffectiveAt] = useState("");
  const [circuits, setCircuits] = useState<CircuitRow[]>(toCircuitRows(initial));
  const [chargers, setChargers] = useState<ChargerRow[]>(toChargerRows(initial));
  const [pwChoice, setPwChoice] = useState<"keep" | "none" | "set" | "generate">("keep");
  const [pwValue, setPwValue] = useState("");

  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error" | "conflict"; text: string } | null>(null);
  const [problems, setProblems] = useState<Problem[]>([]);
  const [generated, setGenerated] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const keyRef = useRef<string | null>(null);

  const touch = useCallback(() => { keyRef.current = null; }, []);
  const edit = <T,>(set: (v: T) => void) => (v: T) => { touch(); set(v); };

  const byId = useMemo(() => new Map(circuits.map((c) => [c.id, c])), [circuits]);
  const mainRating = parseAmps(mainAmps).value;
  const sites = (dir?.sites ?? []).filter((s) => s.orgId === orgId);

  const chainFor = (circuitId: string): (number | null)[] => {
    const chain: (number | null)[] = [];
    for (let cur: string | null = circuitId, i = 0; cur && i < 20; i++) {
      const c = byId.get(cur);
      if (!c) break;
      chain.push(parseAmps(c.ratingAmps).value);
      cur = c.parentId;
    }
    chain.push(mainRating);
    return chain;
  };

  const depthOf = (id: string) => {
    let d = 1;
    for (let cur = byId.get(id)?.parentId ?? null, i = 0; cur && i < 20; i++) { d++; cur = byId.get(cur)?.parentId ?? null; }
    return d;
  };

  const problemFor = (path: string) => problems.find((p) => p.path === path)?.message;

  const addCircuit = (parentId: string | null) => { touch(); setCircuits((cs) => [...cs, { id: uid(), parentId, displayName: "", ratingAmps: "", phaseCount: "" }]); };
  const addCharger = (circuitId: string) => { touch(); setChargers((cs) => [...cs, { id: uid(), circuitId, label: "", chargePointId: "", vendor: "", model: "", serialNumber: "" }]); };
  const removeCircuit = (id: string) => {
    touch();
    const doomed = new Set<string>([id]);
    for (let changed = true; changed; ) { changed = false; for (const c of circuits) if (c.parentId && doomed.has(c.parentId) && !doomed.has(c.id)) { doomed.add(c.id); changed = true; } }
    setCircuits((cs) => cs.filter((c) => !doomed.has(c.id)));
    setChargers((cs) => cs.filter((c) => !doomed.has(c.circuitId)));
  };
  const patchCircuit = (id: string, patch: Partial<CircuitRow>) => { touch(); setCircuits((cs) => cs.map((c) => (c.id === id ? { ...c, ...patch } : c))); };
  const patchCharger = (id: string, patch: Partial<ChargerRow>) => { touch(); setChargers((cs) => cs.map((c) => (c.id === id ? { ...c, ...patch } : c))); };

  async function copy(text: string, tag: string) {
    try { await navigator.clipboard.writeText(text); setCopied(tag); setTimeout(() => setCopied(null), 1800); } catch { setMessage({ kind: "error", text: "Copy is not available in this browser — select the text and copy it." }); }
  }

  async function createDirectory(body: Record<string, unknown>): Promise<{ id: string } | null> {
    const res = await fetch("/api/cpo/directory", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    if (!res.ok) { setMessage({ kind: "error", text: res.status === 503 ? "The database is not connected." : "Could not create that record." }); return null; }
    return (await res.json()) as { id: string };
  }
  async function refreshDirectory() {
    const res = await fetch("/api/cpo/directory", { cache: "no-store" });
    if (res.ok) setDir((await res.json()) as Directory);
  }

  async function save() {
    setMessage(null); setProblems([]);
    const local: Problem[] = [];
    const main = parseAmps(mainAmps);
    if (main.bad) local.push({ path: "installation.mainRatingAmps", message: "Whole amps, or leave empty if unknown" });
    const circuitPayload = circuits.map((c, i) => {
      const r = parseAmps(c.ratingAmps);
      if (r.bad) local.push({ path: `circuits.${i}.ratingAmps`, message: "Whole amps, or leave empty if unknown" });
      return { id: c.id, parentId: c.parentId, displayName: c.displayName, ratingAmps: r.value, phaseCount: c.phaseCount === "" ? null : Number(c.phaseCount) };
    });
    if (!view && (!orgId || !siteId)) local.push({ path: "siteId", message: "Choose an organisation and a site" });
    if (pwChoice === "set" && pwValue.length < 12) local.push({ path: "password", message: "At least 12 characters" });
    if (local.length) { setProblems(local); setMessage({ kind: "error", text: "Some fields need attention." }); return; }

    keyRef.current ??= crypto.randomUUID();
    const payload = {
      ...(view ? { installationId: view.installation.id, expectedRevision: view.installation.revision } : { orgId, siteId }),
      idempotencyKey: keyRef.current,
      ...(effectiveAt ? { effectiveAt: new Date(effectiveAt).toISOString() } : {}),
      installation: { displayName: name, mainDeviceType: mainType, mainRatingAmps: main.value, mainPhaseCount: mainPhases === "" ? null : Number(mainPhases) },
      electrician: { name: eName, email: eEmail, phone: ePhone },
      password: pwChoice === "set" ? { action: "set", value: pwValue } : { action: pwChoice },
      circuits: circuitPayload,
      chargers: chargers.map((c) => ({ id: c.id, circuitId: c.circuitId, label: c.label, chargePointId: c.chargePointId, vendor: c.vendor, model: c.model, serialNumber: c.serialNumber })),
    };

    setBusy(true);
    try {
      const res = await fetch("/api/cpo/installations", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
      const body = await res.json().catch(() => ({}));
      if (res.ok) {
        const next = body as View & { generatedPassword?: string; unchanged?: boolean; replayed?: boolean };
        setView(next);
        setCircuits(toCircuitRows(next)); setChargers(toChargerRows(next));
        setPwChoice("keep"); setPwValue(""); setGenerated(next.generatedPassword ?? null);
        keyRef.current = null;
        setMessage({ kind: "ok", text: next.unchanged ? "Nothing had changed." : next.replayed ? "Already saved." : `Saved as revision ${next.installation.revision}.` });
        if (!view) window.history.replaceState(null, "", `/cpo/installations?id=${next.installation.id}`);
      } else if (res.status === 409 && body.error === "stale_revision") {
        keyRef.current = null;
        setMessage({ kind: "conflict", text: "This installation was changed by someone else since you opened it. Nothing was saved. Reload to see the latest, then re-apply your edits." });
      } else if (res.status === 409) {
        setMessage({ kind: "error", text: body.message ?? "That conflicts with an existing record." });
      } else if (res.status === 422) {
        keyRef.current = null;
        setProblems(body.problems ?? []); setMessage({ kind: "error", text: body.message ?? "Some fields need attention." });
      } else if (res.status === 401) {
        setMessage({ kind: "error", text: "Your session has ended. Sign in again — your edits on this page are kept until you leave it." });
      } else if (res.status === 503) {
        setMessage({ kind: "error", text: "The database is not connected for this deployment. Nothing was saved." });
      } else {
        setMessage({ kind: "error", text: "Could not save. Nothing was changed — try again." });
      }
    } catch {
      setMessage({ kind: "error", text: "Network error. Nothing was confirmed saved — saving again is safe." });
    } finally {
      setBusy(false);
    }
  }

  const status = view?.installation.responsible.status ?? "not_provided";
  const statusText = { not_provided: "No electrician recorded", not_confirmed: "Not confirmed by the electrician", confirmed: "Confirmed by the electrician" }[status];

  const renderCircuit = (c: CircuitRow, index: number): React.ReactNode => {
    const depth = depthOf(c.id);
    const kids = circuits.filter((k) => k.parentId === c.id);
    const here = chargers.filter((ch) => ch.circuitId === c.id);
    return (
      <li key={c.id} className="ie-node" style={{ ["--depth" as string]: depth }}>
        <div className="ie-row">
          <label className="ie-field ie-grow">
            <span>Circuit name</span>
            <input value={c.displayName} onChange={(e) => patchCircuit(c.id, { displayName: e.target.value })} maxLength={120} aria-invalid={!!problemFor(`circuits.${index}.displayName`)} />
            <em>{problemFor(`circuits.${index}.displayName`)}</em>
          </label>
          <label className="ie-field ie-narrow">
            <span>Breaker (A)</span>
            <input inputMode="numeric" value={c.ratingAmps} onChange={(e) => patchCircuit(c.id, { ratingAmps: e.target.value })} placeholder="unknown" aria-invalid={!!problemFor(`circuits.${index}.ratingAmps`)} />
            <em>{problemFor(`circuits.${index}.ratingAmps`)}</em>
          </label>
          <label className="ie-field ie-narrow">
            <span>Phases</span>
            <select value={c.phaseCount} onChange={(e) => patchCircuit(c.id, { phaseCount: e.target.value as CircuitRow["phaseCount"] })}>
              <option value="">unknown</option><option value="1">1</option><option value="2">2</option><option value="3">3</option>
            </select>
          </label>
          <div className="ie-allow" aria-label="Effective charging allowance"><span>Allowance</span>{allowanceText(chainFor(c.id))}</div>
        </div>
        <div className="ie-actions">
          <button type="button" className="ws-button" onClick={() => addCircuit(c.id)} disabled={depth >= MAX_DEPTH} title={depth >= MAX_DEPTH ? `Nesting is limited to ${MAX_DEPTH} levels` : undefined}>+ Sub-circuit</button>
          <button type="button" className="ws-button" onClick={() => addCharger(c.id)}>+ Charger</button>
          <button type="button" className="ws-button" onClick={() => removeCircuit(c.id)} aria-label={`Remove circuit ${c.displayName || "(unnamed)"}`}>Remove</button>
        </div>
        {here.length > 0 && (
          <ul className="ie-chargers">
            {here.map((ch) => {
              const ci = chargers.indexOf(ch);
              return (
                <li key={ch.id} className="ie-charger">
                  <div className="ie-row">
                    <label className="ie-field ie-grow"><span>Charger name</span>
                      <input value={ch.label} onChange={(e) => patchCharger(ch.id, { label: e.target.value })} maxLength={120} aria-invalid={!!problemFor(`chargers.${ci}.label`)} />
                      <em>{problemFor(`chargers.${ci}.label`)}</em></label>
                    <label className="ie-field ie-grow"><span>Charge point id</span>
                      <input value={ch.chargePointId} onChange={(e) => patchCharger(ch.id, { chargePointId: e.target.value })} maxLength={48} autoCapitalize="off" spellCheck={false} aria-invalid={!!problemFor(`chargers.${ci}.chargePointId`)} />
                      <em>{problemFor(`chargers.${ci}.chargePointId`)}</em></label>
                    <label className="ie-field ie-grow"><span>Maker (optional)</span>
                      <input value={ch.vendor} onChange={(e) => patchCharger(ch.id, { vendor: e.target.value })} maxLength={80} /></label>
                    <label className="ie-field ie-grow"><span>Model (optional)</span>
                      <input value={ch.model} onChange={(e) => patchCharger(ch.id, { model: e.target.value })} maxLength={80} /></label>
                    <label className="ie-field ie-grow"><span>Serial (optional)</span>
                      <input value={ch.serialNumber} onChange={(e) => patchCharger(ch.id, { serialNumber: e.target.value })} maxLength={80} aria-invalid={!!problemFor(`chargers.${ci}.serialNumber`)} />
                      <em>{problemFor(`chargers.${ci}.serialNumber`)}</em></label>
                    <button type="button" className="ws-button" onClick={() => { touch(); setChargers((cs) => cs.filter((x) => x.id !== ch.id)); }} aria-label={`Remove charger ${ch.label || "(unnamed)"}`}>Remove</button>
                  </div>
                  <p className="ws-muted">Equipment id {ch.id.startsWith("new-") ? "is assigned when saved" : ch.id}. Connection status: unknown — not connected.</p>
                </li>
              );
            })}
          </ul>
        )}
        {kids.length > 0 && <ul className="ie-tree">{kids.map((k) => renderCircuit(k, circuits.indexOf(k)))}</ul>}
      </li>
    );
  };

  const roots = circuits.filter((c) => c.parentId === null);

  return (
    <form className="ie" onSubmit={(e) => { e.preventDefault(); void save(); }} noValidate>
      <section className="ws-panel" aria-labelledby="ie-conn">
        <div className="ws-panel-heading"><h2 id="ie-conn">Connection address</h2><span className="ws-badge">Not yet active</span></div>
        {view ? (
          <>
            <div className="ie-address">
              <code>{view.connection.address}</code>
              <button type="button" className="ws-button" onClick={() => copy(view.connection.address, "address")}>{copied === "address" ? "Copied" : "Copy"}</button>
            </div>
            <p className="ws-muted">{view.connection.note} Replace <code>{"{charge-point-id}"}</code> with each charger&apos;s own id below. The address never contains a password. It stays the same if you rename the installation.</p>
          </>
        ) : (
          <p className="ws-muted">The address is generated when the installation is first saved, so it can never point at a record that does not exist.</p>
        )}
        <fieldset className="ie-pw">
          <legend>Charger password (optional)</legend>
          <p className="ws-muted">Currently: {view?.installation.password.mode === "password" ? `a password is set${view.installation.password.setAt ? ` (${new Date(view.installation.password.setAt).toLocaleString()})` : ""}` : view?.installation.password.mode === "none" ? "deliberately no password" : "not chosen yet"}. A password cannot be shown again; set a new one to replace it.</p>
          <div className="ie-row">
            <label className="ie-field"><span>Change</span>
              <select value={pwChoice} onChange={(e) => edit(setPwChoice)(e.target.value as typeof pwChoice)}>
                <option value="keep">Leave as is</option><option value="none">No password</option><option value="set">Set a password</option><option value="generate">Generate a password</option>
              </select></label>
            {pwChoice === "set" && (
              <label className="ie-field ie-grow"><span>New password (12+ characters)</span>
                <input type="password" autoComplete="new-password" value={pwValue} onChange={(e) => edit(setPwValue)(e.target.value)} maxLength={128} />
                <em>{problemFor("password")}</em></label>
            )}
          </div>
          {generated && (
            <div className="ws-note" role="status">
              <strong>Generated password — shown once.</strong> Copy it now; it cannot be retrieved later.
              <div className="ie-address"><code>{generated}</code><button type="button" className="ws-button" onClick={() => copy(generated, "pw")}>{copied === "pw" ? "Copied" : "Copy"}</button></div>
            </div>
          )}
        </fieldset>
      </section>

      <section className="ws-panel" aria-labelledby="ie-inst">
        <div className="ws-panel-heading"><h2 id="ie-inst">Installation</h2>{view && <span className="ws-badge">Revision {view.installation.revision}</span>}</div>
        <div className="ie-row">
          <label className="ie-field ie-grow"><span>Name</span>
            <input value={name} onChange={(e) => edit(setName)(e.target.value)} maxLength={120} aria-invalid={!!problemFor("installation.displayName")} />
            <em>{problemFor("installation.displayName")}</em></label>
          {view ? (
            <p className="ws-muted ie-grow">Identifier <code>{view.installation.key}</code></p>
          ) : (
            <>
              <label className="ie-field ie-grow"><span>CPO organisation</span>
                <select value={orgId} onChange={(e) => { edit(setOrgId)(e.target.value); setSiteId(""); }}>
                  <option value="">Choose…</option>{(dir?.organisations ?? []).map((o) => <option key={o.id} value={o.id}>{o.displayName}</option>)}
                </select></label>
              <label className="ie-field ie-grow"><span>Site / address</span>
                <select value={siteId} onChange={(e) => edit(setSiteId)(e.target.value)} disabled={!orgId} aria-invalid={!!problemFor("siteId")}>
                  <option value="">Choose…</option>{sites.map((s) => <option key={s.id} value={s.id}>{s.displayName}{s.address ? ` — ${s.address}` : ""}</option>)}
                </select><em>{problemFor("siteId")}</em></label>
            </>
          )}
        </div>
        {!view && <DirectoryCreate orgId={orgId} onOrg={async (n) => { const c = await createDirectory({ action: "create-organisation", displayName: n }); if (c) { await refreshDirectory(); setOrgId(c.id); } }} onSite={async (n, a) => { const c = await createDirectory({ action: "create-site", orgId, displayName: n, address: a }); if (c) { await refreshDirectory(); setSiteId(c.id); } }} />}
        <div className="ie-row">
          <label className="ie-field ie-grow"><span>Main protective device (type)</span>
            <input value={mainType} onChange={(e) => edit(setMainType)(e.target.value)} maxLength={60} placeholder="e.g. main breaker, fuse" /></label>
          <label className="ie-field ie-narrow"><span>Rating (A)</span>
            <input inputMode="numeric" value={mainAmps} onChange={(e) => edit(setMainAmps)(e.target.value)} placeholder="unknown" aria-invalid={!!problemFor("installation.mainRatingAmps")} />
            <em>{problemFor("installation.mainRatingAmps")}</em></label>
          <label className="ie-field ie-narrow"><span>Phases</span>
            <select value={mainPhases} onChange={(e) => edit(setMainPhases)(e.target.value as typeof mainPhases)}><option value="">unknown</option><option value="1">1</option><option value="2">2</option><option value="3">3</option></select></label>
          <div className="ie-allow"><span>Allowance</span>{allowanceText([mainRating])}</div>
        </div>
        <p className="ws-muted">Missing capacity counts as 0 A of charging allowance; an entered 0 is a deliberate zero. These figures are not confirmed on any charger — enforcement is unavailable until chargers connect.</p>
      </section>

      <section className="ws-panel" aria-labelledby="ie-elec">
        <div className="ws-panel-heading"><h2 id="ie-elec">On-site electrician</h2><span className="ws-badge">{statusText}</span></div>
        <div className="ie-row">
          <label className="ie-field ie-grow"><span>Name</span><input value={eName} onChange={(e) => edit(setEName)(e.target.value)} maxLength={120} /></label>
          <label className="ie-field ie-grow"><span>Email</span><input type="email" value={eEmail} onChange={(e) => edit(setEEmail)(e.target.value)} maxLength={254} aria-invalid={!!problemFor("electrician.email")} /><em>{problemFor("electrician.email")}</em></label>
          <label className="ie-field ie-grow"><span>Phone</span><input type="tel" value={ePhone} onChange={(e) => edit(setEPhone)(e.target.value)} maxLength={32} aria-invalid={!!problemFor("electrician.phone")} /><em>{problemFor("electrician.phone")}</em></label>
        </div>
        <p className="ws-muted">The electrician need not have a Straumvakt account. No email is sent: confirmation by email is not enabled yet, so this stays &quot;not confirmed&quot;, and any later edit leaves it unconfirmed.</p>
      </section>

      <section className="ws-panel" aria-labelledby="ie-tree">
        <div className="ws-panel-heading"><h2 id="ie-tree">Electrical structure</h2>
          <button type="button" className="ws-button" onClick={() => addCircuit(null)}>+ Circuit</button></div>
        <p className="ws-muted">Main protective device{mainType ? ` — ${mainType}` : ""}{mainAmps ? `, ${mainAmps} A` : ""}</p>
        {roots.length === 0 ? <p className="ws-muted">No circuits yet. An installation can be saved without circuits or chargers.</p> : <ul className="ie-tree">{roots.map((c) => renderCircuit(c, circuits.indexOf(c)))}</ul>}
        {problemFor("circuits") && <p className="ie-error" role="alert">{problemFor("circuits")}</p>}
      </section>

      <div className="ie-savebar">
        <label className="ie-field"><span>Physical change happened (optional)</span>
          <input type="datetime-local" value={effectiveAt} onChange={(e) => edit(setEffectiveAt)(e.target.value)} /></label>
        <button type="submit" className="ws-button ws-primary" disabled={busy}>{busy ? "Saving…" : view ? "Save changes" : "Create installation"}</button>
        <div role="status" aria-live="polite" className={`ie-msg ie-${message?.kind ?? "none"}`}>
          {message?.text}
          {message?.kind === "conflict" && <> <Link href={`/cpo/installations?id=${view?.installation.id}` as Route} prefetch={false} onClick={() => window.location.reload()}>Reload</Link></>}
        </div>
      </div>

      {view?.history && (
        <section className="ws-panel" aria-labelledby="ie-hist">
          <div className="ws-panel-heading"><h2 id="ie-hist">Change history</h2></div>
          {view.history.length === 0 ? <p className="ws-muted">No changes recorded.</p> : (
            <ol className="ie-history">
              {view.history.map((h) => (
                <li key={h.id}>
                  <strong>{describe(h)}</strong> <span className="ws-muted">rev {h.revision} · {h.actorLabel} · {new Date(h.occurredAt).toLocaleString()}{h.effectiveAt ? ` · effective ${new Date(h.effectiveAt).toLocaleString()}` : ""}</span>
                  <ul>{Object.entries(h.diff).map(([f, d]) => <li key={f}>{f}: <s>{show(d.from)}</s> → {show(d.to)}</li>)}</ul>
                </li>
              ))}
            </ol>
          )}
        </section>
      )}
    </form>
  );
}

const show = (v: unknown) => (v === null || v === undefined || v === "" ? "—" : String(v));
const describe = (h: { entityType: string; action: string }) => `${h.entityType} ${h.action}`;

function DirectoryCreate({ orgId, onOrg, onSite }: { orgId: string; onOrg: (name: string) => void; onSite: (name: string, address: string) => void }) {
  const [org, setOrg] = useState("");
  const [site, setSite] = useState("");
  const [addr, setAddr] = useState("");
  return (
    <details className="ie-dir">
      <summary>Need a new organisation or site?</summary>
      <div className="ie-row">
        <label className="ie-field ie-grow"><span>New CPO organisation</span><input value={org} onChange={(e) => setOrg(e.target.value)} maxLength={120} /></label>
        <button type="button" className="ws-button" disabled={org.trim().length < 2} onClick={() => { onOrg(org.trim()); setOrg(""); }}>Add organisation</button>
      </div>
      <div className="ie-row">
        <label className="ie-field ie-grow"><span>New site name</span><input value={site} onChange={(e) => setSite(e.target.value)} maxLength={120} /></label>
        <label className="ie-field ie-grow"><span>Address</span><input value={addr} onChange={(e) => setAddr(e.target.value)} maxLength={200} /></label>
        <button type="button" className="ws-button" disabled={!orgId || site.trim().length < 2} onClick={() => { onSite(site.trim(), addr.trim()); setSite(""); setAddr(""); }}>Add site</button>
      </div>
      {!orgId && <p className="ws-muted">Choose the organisation first to add a site to it.</p>}
    </details>
  );
}
