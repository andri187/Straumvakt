"use client";

// One-page installation editor: the CPO it is for, installation fields, the
// electrical structure (main protection → circuits → chargers), the on-site
// electrician, and the change history. No wizard, no checklist, no activation
// step. Rows added, edited or removed here are local until Save, which submits the
// whole document once with the revision it was loaded at. A stale revision is
// refused by the server and surfaced here, never overwritten.
//
// A new installation can be saved as a DRAFT and resumed later: the whole form as
// typed, except any password. A draft is only a saved copy of the form; it is not
// an installation and nothing can connect through it. Required fields are checked
// when the installation is created, not when a draft is saved. Drafts are kept
// only by pressing Save draft (there is no autosave and no polling); leaving the
// page never deletes one, and discarding is its own explicit action. Leaving with
// unsaved edits, or a typed password (which no draft keeps), asks first.
//
// Only one server action runs at a time and the form is read-only while it does,
// so a create, a draft save and a discard can never overlap or answer late over
// newer text. Each action is also safe to repeat on the server (idempotency key,
// draft revision), so a lost response is resolved by trying again. A draft that was
// already used never silently turns into a second installation.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { structuralStore } from "@/lib/sync/structural-singleton";
import type { Route } from "next";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { chargerAddress, cpoAddress } from "@/lib/installations/address";
import { afterCreate, afterDiscard, afterSaveDraft, createDraftRef, createSingleFlight, detach, saveDraftBody, startSession, type DraftSession } from "@/lib/installations/draft-session";
import { isZeroRating, moveChargerTo, stillUnassigned } from "@/lib/installations/attachment-selection";
import { DEVICE_TYPE_TEXT, allowanceText, deviceTypeChoice, deviceTypeValue, isDirty, isGuardedClick, parseAmps, passwordAction, passwordPendingForDraft, passwordProblem, zeroIfBlank, type DeviceKind } from "@/lib/installations/editor-model";
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
    mainGridType: "TN" | "IT" | null;
    electrician: { name: string | null; email: string | null; phone: string | null };
    responsible: { status: "not_provided" | "not_confirmed" | "confirmed" };
    password: { mode: "unset" | "none" | "password"; setAt: string | null };
  };
  circuits: { id: string; parentId: string | null; displayName: string; ratingAmps: number | null; phaseCount: 1 | 2 | 3 | null }[];
  chargers: { id: string; circuitId: string; label: string; chargePointId: string; vendor: string | null; model: string | null; serialNumber: string | null }[];
  connection: { status: "unverified"; cpoAddress: string | null; routingId: string | null; note: string };
  history?: { id: string; revision: number; entityType: string; action: string; diff: Record<string, { from: unknown; to: unknown }>; actorLabel: string; effectiveAt: string | null; occurredAt: string }[];
};

type Directory = {
  organisations: { id: string; displayName: string; routingId: string | null }[];
  sites: { id: string; orgId: string; displayName: string; address: string | null }[];
};

/** An unfinished form saved on the server. `payload` is only present on the one being resumed. */
export type DraftSummary = { id: string; orgId: string | null; orgName: string | null; name: string | null; revision: number; updatedAt: string };
export type DraftDetail = DraftSummary & { payload: Record<string, unknown> };

const INSTALLATIONS_API = "/api/cpo/installations";
const LIST_HREF = "/cpo/installations";
const LEAVE_TEXT = "You have unsaved changes on this page. Leave without saving them?";

type Busy = "save" | "draft" | "discard" | "directory";

// `zd`: a NEW row whose rating started as the literal 0 (the form default). Only such a field is put back to 0 if cleared.
type CircuitRow = { id: string; parentId: string | null; displayName: string; ratingAmps: string; phaseCount: "" | "1" | "2" | "3"; zd?: boolean };
export const SITE_CREATE = "__create_site__";
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

const str = (v: unknown, max = 200) => (typeof v === "string" ? v.slice(0, max) : "");
const phase = (v: unknown): "" | "1" | "2" | "3" => (v === "1" || v === "2" || v === "3" ? v : "");

/** The draft document back into editable rows. Nothing in it is trusted to be valid; the form checks at creation. */
function draftCircuits(p: Record<string, unknown> | null): CircuitRow[] {
  const list = Array.isArray(p?.circuits) ? (p!.circuits as Record<string, unknown>[]) : [];
  return list.map((c) => ({ id: str(c.id, 64), parentId: typeof c.parentId === "string" ? c.parentId : null, displayName: str(c.displayName, 120), ratingAmps: str(c.ratingAmps, 8), phaseCount: phase(c.phaseCount) }));
}
function draftChargers(p: Record<string, unknown> | null): ChargerRow[] {
  const list = Array.isArray(p?.chargers) ? (p!.chargers as Record<string, unknown>[]) : [];
  return list.map((c) => ({ id: str(c.id, 64), circuitId: str(c.circuitId, 64), label: str(c.label, 120), chargePointId: str(c.chargePointId, 48), vendor: str(c.vendor, 80), model: str(c.model, 80), serialNumber: str(c.serialNumber, 80) }));
}

/** A required field's marker. Decorative: the input carries aria-required. */
export const Req = () => <span className="ie-star" aria-hidden="true"> *</span>;

export function InstallationEditor({ initial, directory, initialDraft = null, openDrafts = [], incoming = [], attachIds = [] }: { initial: View | null; directory: Directory | null; initialDraft?: DraftDetail | null; openDrafts?: DraftSummary[]; incoming?: { chargePointId: string }[]; attachIds?: string[] }) {
  const router = useRouter();
  const [view, setView] = useState<View | null>(initial);
  const [dir, setDir] = useState<Directory | null>(directory);
  const [others, setOthers] = useState<DraftSummary[]>(openDrafts.filter((d) => d.id !== initialDraft?.id));
  // Which server draft this form is attached to. The id is chosen here, once, so creating the draft twice (double click,
  // lost response) is one row on the server; the revision is known only once the server has confirmed the draft.
  const session = useRef<DraftSession>(startSession(initialDraft ? { id: initialDraft.id, revision: initialDraft.revision } : undefined));
  const dp = initialDraft?.payload ?? null;

  // The CPO is the workspace's, decided by the server (CPO_SHELL_ORG_ID) and handed in as a directory holding only that one
  // organisation and its sites. There is nothing to choose here, and nothing in the browser can change it.
  const orgId = initial?.installation.orgId ?? directory?.organisations[0]?.id ?? "";

  const [name, setName] = useState(initial?.installation.displayName ?? str(dp?.name, 120));
  const [siteId, setSiteId] = useState(initial?.installation.siteId ?? str(dp?.siteId, 64));
  const startType = deviceTypeChoice(initial ? (initial.installation.mainDeviceType ?? "") : str(dp?.mainType, 60));
  const [mainKind, setMainKind] = useState<DeviceKind>(startType.kind);
  const [mainCustom, setMainCustom] = useState(startType.custom);
  const mainType = deviceTypeValue(mainKind, mainCustom);
  // A new form starts every rating at 0 (a configured zero allowance, never a measurement). A resumed draft keeps what it saved.
  const [mainAmps, setMainAmps] = useState(initial ? asText(initial.installation.mainRatingAmps) : dp ? str(dp.mainAmps, 8) : "0");
  const [mainZd, setMainZd] = useState(!initial && !dp);
  const [creatingSite, setCreatingSite] = useState(false);
  // Selected Incoming chargers not yet on a circuit ("To assign"). Form state only: nothing is registered until Save, and
  // Save is refused while any remain. Ids already on this installation are not offered again.
  const [toAssign, setToAssign] = useState<string[]>(() => stillUnassigned(attachIds, initial ? toChargerRows(initial) : draftChargers(initialDraft?.payload ?? null)));
  const [pickCircuit, setPickCircuit] = useState<Record<string, string>>({});
  const [drag, setDrag] = useState<{ kind: "pending" | "row"; id: string } | null>(null);
  const [overCircuit, setOverCircuit] = useState<string | null>(null);
  const [mainGrid, setMainGrid] = useState<"" | "TN" | "IT">(initial ? (initial.installation.mainGridType ?? "") : dp?.mainGrid === "TN" || dp?.mainGrid === "IT" ? dp.mainGrid : "");
  const [mainPhases, setMainPhases] = useState<"" | "1" | "2" | "3">(initial ? (asText(initial.installation.mainPhaseCount) as "" | "1" | "2" | "3") : phase(dp?.mainPhases));
  const [eName, setEName] = useState(initial?.installation.electrician.name ?? str(dp?.eName, 120));
  const [eEmail, setEEmail] = useState(initial?.installation.electrician.email ?? str(dp?.eEmail, 254));
  const [ePhone, setEPhone] = useState(initial?.installation.electrician.phone ?? str(dp?.ePhone, 32));
  const [effectiveAt, setEffectiveAt] = useState("");
  const [circuits, setCircuits] = useState<CircuitRow[]>(initial ? toCircuitRows(initial) : draftCircuits(dp));
  const [chargers, setChargers] = useState<ChargerRow[]>(initial ? toChargerRows(initial) : draftChargers(dp));
  // The one password field. Never saved anywhere but the create/save request; a draft keeps only `pwPending`.
  const [pwValue, setPwValue] = useState("");
  const [pwPending, setPwPending] = useState(dp?.pwPending === true);
  const [removePw, setRemovePw] = useState(false);

  // One server action at a time. The guard is synchronous (state updates lag a render); the state drives the disabled UI.
  const [busy, setBusy] = useState<Busy | null>(null);
  const [flight] = useState(() => createSingleFlight<Busy>(setBusy));
  const [message, setMessage] = useState<{ kind: "ok" | "error" | "conflict"; text: string } | null>(null);
  const [problems, setProblems] = useState<Problem[]>([]);
  // The draft this form came from was already used to create an installation: nothing more is offered until a deliberate step.
  const [usedDraft, setUsedDraft] = useState<{ installationId: string | null } | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const keyRef = useRef<string | null>(null);

  const touch = useCallback(() => { keyRef.current = null; }, []);
  const edit = <T,>(set: (v: T) => void) => (v: T) => { touch(); set(v); };

  // ── Unsaved work ─────────────────────────────────────────────────────────
  const currentKey = JSON.stringify({ orgId, name, siteId, mainType, mainAmps, mainPhases, mainGrid, eName, eEmail, ePhone, effectiveAt, circuits, chargers, removePw, toAssign });
  const [baseline, setBaseline] = useState(currentKey);
  const [rebase, setRebase] = useState(false);
  useEffect(() => { if (rebase) { setBaseline(currentKey); setRebase(false); } }, [rebase, currentKey]);
  const dirty = isDirty({ baseline, current: currentKey, passwordTyped: pwValue !== "" });
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const skipGuard = useRef(false);

  /** Leaves the page on purpose (after a save, a discard or a confirmed choice): the leave prompt is skipped. */
  const leave = (href: string = LIST_HREF) => {
    skipGuard.current = true;
    setTimeout(() => { skipGuard.current = false; }, 4000);
    window.location.assign(href);
  };

  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (skipGuard.current || !dirtyRef.current) return;
      e.preventDefault();
      e.returnValue = "";
    };
    // Client-side navigation (the All installations link, the sidebar) does not fire beforeunload, so same-site link
    // clicks are checked here, before the router sees them.
    const onClick = (e: MouseEvent) => {
      if (skipGuard.current || !dirtyRef.current) return;
      const link = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!link || link.hasAttribute("data-ie-leave")) return;
      if (!isGuardedClick(e, { target: link.target, download: link.hasAttribute("download"), href: link.href }, window.location)) return;
      if (!window.confirm(LEAVE_TEXT)) { e.preventDefault(); e.stopImmediatePropagation(); }
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    document.addEventListener("click", onClick, true);
    return () => { window.removeEventListener("beforeunload", onBeforeUnload); document.removeEventListener("click", onClick, true); };
  }, []);

  // The browser's Back button is a history pop that the page cannot veto. So once there is unsaved work, one extra history
  // entry for this same page is pushed; Back then pops that entry instead of leaving, and the choice is asked here.
  const sentinel = useRef(false);
  useEffect(() => {
    if (dirty && !sentinel.current) {
      sentinel.current = true;
      window.history.pushState(window.history.state, "", window.location.href);
    }
  }, [dirty]);
  useEffect(() => {
    const onPop = () => {
      if (skipGuard.current || !sentinel.current) return;
      if (dirtyRef.current && !window.confirm(LEAVE_TEXT)) { window.history.pushState(window.history.state, "", window.location.href); return; }
      sentinel.current = false;
      skipGuard.current = true;
      setTimeout(() => { skipGuard.current = false; }, 4000);
      window.history.back(); // past the extra entry, to where the operator came from
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

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

  const addCircuit = (parentId: string | null) => { touch(); setCircuits((cs) => [...cs, { id: uid(), parentId, displayName: "", ratingAmps: "0", phaseCount: "", zd: true }]); };
  const usedIds = new Set([...chargers.map((c) => c.chargePointId.trim().toLowerCase()).filter(Boolean), ...toAssign.map((i) => i.toLowerCase())]);
  const circuitPath = (c: CircuitRow): string => {
    const names: string[] = [];
    for (let cur: CircuitRow | undefined = c, i = 0; cur && i < 20; i++) { names.unshift(cur.displayName.trim() || "(unnamed)"); cur = cur.parentId ? byId.get(cur.parentId) : undefined; }
    return names.join(" › ");
  };
  /** Assigning an incoming charger only fills the form; nothing is registered until the form is saved, the same as typing the id. */
  const assignPending = (chargePointId: string, circuitId: string) => {
    if (!circuitId || !byId.has(circuitId) || !toAssign.includes(chargePointId)) return;
    touch();
    setChargers((cs) => (cs.some((c) => c.chargePointId.trim().toLowerCase() === chargePointId.toLowerCase()) ? cs : [...cs, { id: uid(), circuitId, label: "", chargePointId, vendor: "", model: "", serialNumber: "" }]));
    setToAssign((l) => l.filter((x) => x !== chargePointId));
    setPickCircuit((p) => { const { [chargePointId]: _gone, ...rest } = p; return rest; });
  };
  const moveRow = (chargerId: string, circuitId: string) => {
    if (!byId.has(circuitId)) return;
    touch();
    setChargers((cs) => moveChargerTo(cs, chargerId, circuitId));
  };
  const dropOn = (circuitId: string) => {
    const d = drag;
    setDrag(null); setOverCircuit(null);
    if (!d) return;
    if (d.kind === "pending") assignPending(d.id, circuitId);
    else moveRow(d.id, circuitId);
  };
  const dragProps = (kind: "pending" | "row", id: string) => ({
    draggable: true,
    onDragStart: (e: React.DragEvent) => { e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", id); setDrag({ kind, id }); },
    onDragEnd: () => { setDrag(null); setOverCircuit(null); },
  });
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

  /** Runs one server action at a time; a second request while one is in flight is ignored, and the form is read-only meanwhile. */
  async function exclusive<T>(kind: Busy, fn: () => Promise<T>): Promise<T | undefined> {
    const r = await flight.run(kind, fn);
    return r.ran ? r.value : undefined;
  }

  async function post(body: Record<string, unknown>): Promise<{ ok: boolean; status: number; json: Record<string, unknown> }> {
    const res = await fetch(INSTALLATIONS_API, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    return { ok: res.ok, status: res.status, json: (await res.json().catch(() => ({}))) as Record<string, unknown> };
  }

  const failure = (status: number, json: Record<string, unknown>, what: string) =>
    status === 401 ? "Your session has ended. Sign in again — your edits on this page are kept until you leave it."
      : status === 503 ? `The database is not connected for this deployment. ${what}`
      : typeof json.message === "string" ? json.message : `${what} Nothing was changed — try again.`;

  /** The whole form as typed. There is deliberately no password in it: only the fact that one was typed is kept. */
  function draftPayload() {
    return {
      name, siteId, mainType, mainAmps: zeroIfBlank(mainAmps, mainZd), mainPhases, mainGrid, eName, eEmail, ePhone, effectiveAt: "",
      pwPending: passwordPendingForDraft({ value: pwValue, pending: pwPending }),
      circuits: circuits.map((c) => ({ id: c.id, parentId: c.parentId, displayName: c.displayName, ratingAmps: zeroIfBlank(c.ratingAmps, !!c.zd), phaseCount: c.phaseCount })),
      chargers: chargers.map((c) => ({ id: c.id, circuitId: c.circuitId, label: c.label, chargePointId: c.chargePointId, vendor: c.vendor, model: c.model, serialNumber: c.serialNumber })),
    };
  }

  /** Saves the form as a draft: no required-field checks, nothing is created. Repeating it is safe. True when the draft now holds this form. */
  async function saveDraft(): Promise<boolean> {
    return (await exclusive("draft", async () => {
      setMessage(null); setProblems([]);
      // The draft schema has no place for a selection that is not on a circuit, so it would be lost silently. Refuse instead.
      if (toAssign.length > 0) {
        setMessage({ kind: "error", text: `${toAssign.length} selected ${toAssign.length === 1 ? "charger is" : "chargers are"} not on a circuit, and a draft cannot keep that. Assign ${toAssign.length === 1 ? "it" : "them"} to a circuit or remove ${toAssign.length === 1 ? "it" : "them"} from the selection first.` });
        return false;
      }
      try {
        const r = await post(saveDraftBody(session.current, orgId, draftPayload()));
        const out = afterSaveDraft(session.current, r);
        session.current = out.session;
        if (out.kind === "saved") {
          window.history.replaceState(null, "", `${LIST_HREF}?new=1&draft=${session.current.id}`);
          setPwPending(passwordPendingForDraft({ value: pwValue, pending: pwPending }));
          setRebase(true);
          setMessage({ kind: "ok", text: `${out.unchanged ? "Draft already saved." : `Draft saved (revision ${session.current.revision}).`} Nothing has been created.${pwValue !== "" ? " The password you typed is not kept in a draft; you will enter it again when you resume." : ""}` });
          return true;
        }
        if (out.kind === "stale") {
          setMessage({ kind: "conflict", text: "This draft was changed in another tab or window since you opened it. Nothing was overwritten. Reload to see the latest, then re-apply your edits." });
        } else if (out.kind === "consumed") {
          setUsedDraft({ installationId: out.installationId });
        } else if (out.kind === "gone") {
          setMessage({ kind: "error", text: "This draft was discarded elsewhere, so this copy was not saved. Your form is still here: press Save draft again to keep it as a new draft." });
        } else if (out.kind === "invalid") {
          setProblems(out.problems);
          setMessage({ kind: "error", text: failure(r.status, r.json, "The draft could not be saved.") });
        } else {
          setMessage({ kind: "error", text: failure(r.status, r.json, "The draft was not saved.") });
        }
      } catch {
        setMessage({ kind: "error", text: "Network error. The draft may not have been saved — saving again is safe." });
      }
      return false;
    })) === true;
  }

  /** Save, then leave — only if the save worked. A failed save keeps the form and says why. */
  async function saveDraftAndClose() {
    if (flight.current) return;
    if (pwValue !== "" && !window.confirm("The password you typed cannot be kept in a draft; you will enter it again when you resume.\n\nSave the draft and close?")) return;
    if (await saveDraft()) leave();
  }

  /** Discards one draft on the server. True when it no longer exists as an open draft (discarded now, before, or never). */
  async function discardById(id: string): Promise<boolean> {
    try {
      const r = await post({ action: "discard-draft", draftId: id });
      const out = afterDiscard({ id, revision: undefined }, r);
      if (out.kind === "already_used") {
        setUsedDraft({ installationId: typeof r.json.installationId === "string" ? r.json.installationId : null });
        return false;
      }
      if (out.kind === "gone") return true;
      setMessage({ kind: "error", text: failure(r.status, r.json, "The draft was not discarded.") });
    } catch {
      setMessage({ kind: "error", text: "Network error. The draft may not have been discarded — try again." });
    }
    return false;
  }

  async function discardOther(d: DraftSummary) {
    if (flight.current) return;
    const label = d.name ? `"${d.name}"` : "this unfinished installation";
    if (!window.confirm(`Discard the saved draft ${label}? Organisations and sites are not affected.`)) return;
    await exclusive("discard", async () => {
      setMessage(null);
      if (await discardById(d.id)) setOthers((list) => list.filter((x) => x.id !== d.id));
    });
  }

  /** The only way a draft is deleted: an explicit choice, never a side effect of leaving. */
  async function discardThisDraft() {
    if (flight.current) return;
    setMessage(null);
    const saved = session.current.revision !== undefined;
    const ok = window.confirm(saved
      ? "Discard this draft?\n\nThe saved draft will be deleted and what you typed is lost. Organisations and sites you added with this form were saved when you added them and are not removed."
      : "Discard this form?\n\nNothing was saved from it. Organisations and sites you added with this form were saved when you added them and are not removed.");
    if (!ok) return;
    if (!saved) { leave(); return; }
    await exclusive("discard", async () => {
      if (await discardById(session.current.id)) leave();
    });
  }

  /** The operator, having seen that the draft was used, chooses to make another installation from this form. Creates nothing yet. */
  function startSeparate() {
    if (!window.confirm("Create a SEPARATE installation from this form?\n\nThe draft already produced an installation. Pressing Create installation afterwards will make a second one.")) return;
    session.current = detach();
    keyRef.current = null;
    setUsedDraft(null);
    window.history.replaceState(null, "", `${LIST_HREF}?new=1`);
    setMessage({ kind: "ok", text: "This form is no longer linked to the used draft. Nothing has been created yet." });
  }

  async function save() {
    await exclusive("save", saveNow);
  }

  async function saveNow() {
    setMessage(null); setProblems([]);
    const local: Problem[] = [];
    const main = parseAmps(zeroIfBlank(mainAmps, mainZd));
    if (mainZd && mainAmps.trim() === "") setMainAmps("0");
    if (main.bad) local.push({ path: "installation.mainRatingAmps", message: "Whole amps, or leave empty if unknown" });
    const circuitPayload = circuits.map((c, i) => {
      const r = parseAmps(zeroIfBlank(c.ratingAmps, !!c.zd));
      if (c.zd && c.ratingAmps.trim() === "") patchCircuit(c.id, { ratingAmps: "0" });
      if (r.bad) local.push({ path: `circuits.${i}.ratingAmps`, message: "Whole amps, or leave empty if unknown" });
      return { id: c.id, parentId: c.parentId, displayName: c.displayName, ratingAmps: r.value, phaseCount: c.phaseCount === "" ? null : Number(c.phaseCount) };
    });
    if (!view && !siteId) local.push({ path: "siteId", message: "Choose a site" });
    const pw = passwordProblem({ value: pwValue, pending: !view && pwPending });
    if (pw) local.push({ path: "password", message: pw });
    if (toAssign.length > 0) {
      setMessage({ kind: "error", text: `${toAssign.length} selected ${toAssign.length === 1 ? "charger is" : "chargers are"} not on a circuit (${toAssign.join(", ")}). Assign ${toAssign.length === 1 ? "it" : "them"} to a circuit or remove ${toAssign.length === 1 ? "it" : "them"} from the selection before saving. Nothing was saved.` });
      return;
    }
    if (local.length) { setProblems(local); setMessage({ kind: "error", text: "Some fields need attention." }); return; }

    keyRef.current ??= crypto.randomUUID();
    const payload = {
      ...(view ? { installationId: view.installation.id, expectedRevision: view.installation.revision } : { orgId, siteId, ...createDraftRef(session.current) }),
      idempotencyKey: keyRef.current,
      ...(view && effectiveAt ? { effectiveAt: new Date(effectiveAt).toISOString() } : {}),
      installation: { displayName: name, mainDeviceType: mainType, mainRatingAmps: main.value, mainPhaseCount: mainPhases === "" ? null : Number(mainPhases), mainGridType: mainGrid === "" ? null : mainGrid },
      electrician: { name: eName, email: eEmail, phone: ePhone },
      password: passwordAction({ isNew: !view, value: pwValue, removing: removePw }),
      circuits: circuitPayload,
      chargers: chargers.map((c) => ({ id: c.id, circuitId: c.circuitId, label: c.label, chargePointId: c.chargePointId, vendor: c.vendor, model: c.model, serialNumber: c.serialNumber })),
    };

    try {
      const res = await fetch(INSTALLATIONS_API, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
      const body = await res.json().catch(() => ({}));
      if (res.ok) {
        const next = body as View & { unchanged?: boolean; replayed?: boolean };
        setView(next);
        if (!view) session.current = afterCreate(session.current, { ok: true, status: res.status, json: body }).session; // the server closed the draft in the same transaction
        setCircuits(toCircuitRows(next)); setChargers(toChargerRows(next));
        setPwValue(""); setPwPending(false); setRemovePw(false); setMainZd(false); setRebase(true);
        keyRef.current = null;
        setMessage({ kind: "ok", text: next.unchanged ? "Nothing had changed." : next.replayed ? "Already saved." : `Saved as revision ${next.installation.revision}.` });
        if (!view) window.history.replaceState(null, "", `${LIST_HREF}?id=${next.installation.id}`);
        structuralStore().localMutation(next.installation.id); // the shared overview/detail caches drop this installation now, not after a cooldown
        router.refresh(); // Own writes bypass the short navigation cache immediately.
      } else if (res.status === 409 && body.error === "stale_revision") {
        keyRef.current = null;
        setMessage({ kind: "conflict", text: "This installation was changed by someone else since you opened it. Nothing was saved. Reload to see the latest, then re-apply your edits." });
      } else if (res.status === 409 && body.error === "draft_unavailable") {
        keyRef.current = null;
        const out = afterCreate(session.current, { ok: false, status: res.status, json: body });
        session.current = out.session;
        if (out.kind === "draft_consumed") {
          // The draft already produced an installation (this form's own earlier create, or another tab). Nothing was created now.
          setUsedDraft({ installationId: out.installationId });
        } else if (out.kind === "draft_gone") {
          setMessage({ kind: "error", text: "The draft this form came from was discarded elsewhere. Nothing was created. Your form is still here: press Create installation to create it, or Save draft to keep it." });
        } else {
          setMessage({ kind: "error", text: body.message ?? "That draft cannot be used." });
        }
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
    }
  }

  // Every address is built from the CPO's routing id and a charger's own id: the saved installation's CPO, or the chosen one.
  const liveRouting = view ? view.connection.routingId : ((dir?.organisations ?? []).find((o) => o.id === orgId)?.routingId ?? null);

  const status = view?.installation.responsible.status ?? "not_provided";
  const statusText = { not_provided: "No electrician recorded", not_confirmed: "Not confirmed by the electrician", confirmed: "Confirmed by the electrician" }[status];

  const renderCircuit = (c: CircuitRow, index: number): React.ReactNode => {
    const depth = depthOf(c.id);
    const kids = circuits.filter((k) => k.parentId === c.id);
    const here = chargers.filter((ch) => ch.circuitId === c.id);
    return (
      <li key={c.id} className="ie-node" style={{ ["--depth" as string]: depth }}>
        <div
          className={`ie-drop${drag ? " ie-drop-ready" : ""}${overCircuit === c.id ? " ie-drop-over" : ""}`}
          onDragOver={(e) => { if (drag) { e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = "move"; if (overCircuit !== c.id) setOverCircuit(c.id); } }}
          onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null) && overCircuit === c.id) setOverCircuit(null); }}
          onDrop={(e) => { if (drag) { e.preventDefault(); e.stopPropagation(); dropOn(c.id); } }}
        >
        <div className="ie-row">
          <label className="ie-field ie-grow">
            <span>Circuit name<Req /></span>
            <input value={c.displayName} onChange={(e) => patchCircuit(c.id, { displayName: e.target.value })} maxLength={120} aria-required="true" aria-invalid={!!problemFor(`circuits.${index}.displayName`)} />
            <em>{problemFor(`circuits.${index}.displayName`)}</em>
          </label>
          <label className="ie-field ie-narrow">
            <span>Breaker (A)</span>
            <input inputMode="numeric" value={c.ratingAmps} onChange={(e) => patchCircuit(c.id, { ratingAmps: e.target.value })} onBlur={() => { if (c.zd && c.ratingAmps.trim() === "") patchCircuit(c.id, { ratingAmps: "0" }); }} placeholder="not specified" aria-invalid={!!problemFor(`circuits.${index}.ratingAmps`)} className={isZeroRating(c.ratingAmps) ? "ie-zero" : undefined} aria-describedby={isZeroRating(c.ratingAmps) ? `zero-${c.id}` : undefined} />
            {isZeroRating(c.ratingAmps) && <span id={`zero-${c.id}`} className="ie-zero-flag">⚠ 0 A</span>}
            <em>{problemFor(`circuits.${index}.ratingAmps`)}</em>
          </label>
          <label className="ie-field ie-narrow">
            <span>Phases</span>
            <select value={c.phaseCount} onChange={(e) => patchCircuit(c.id, { phaseCount: e.target.value as CircuitRow["phaseCount"] })}>
              <option value="">not set</option><option value="1">1</option><option value="2">2</option><option value="3">3</option>
            </select>
          </label>
          <div className="ie-allow" aria-label="Effective charging allowance"><span>Allowance</span>{allowanceText(chainFor(c.id))}</div>
        </div>
        <div className="ie-actions">
          <button type="button" className="ws-button" onClick={() => addCircuit(c.id)} disabled={depth >= MAX_DEPTH} title={depth >= MAX_DEPTH ? `Nesting is limited to ${MAX_DEPTH} levels` : undefined}>+ Sub-circuit</button>
          <button type="button" className="ws-button" onClick={() => addCharger(c.id)}>+ Charger</button>
          <button type="button" className="ws-button" onClick={() => removeCircuit(c.id)} aria-label={`Remove circuit ${c.displayName || "(unnamed)"}`}>Remove</button>
        </div>
        </div>
        {here.length > 0 && (
          <ul className="ie-chargers">
            {here.map((ch) => {
              const ci = chargers.indexOf(ch);
              return (
                <li key={ch.id} className="ie-charger">
                  <div className="ie-row">
                    <span className="ie-handle" {...dragProps("row", ch.id)} title="Drag to another circuit" aria-hidden="true">⠿</span>
                    {circuits.length > 1 && (
                      <label className="ie-field ie-narrow"><span>Circuit</span>
                        <select value={ch.circuitId} onChange={(e) => moveRow(ch.id, e.target.value)} aria-label={`Move ${ch.label || ch.chargePointId || "charger"} to circuit`}>
                          {circuits.map((k) => <option key={k.id} value={k.id}>{circuitPath(k)}</option>)}
                        </select></label>
                    )}
                    <label className="ie-field ie-grow"><span>Charger name<Req /></span>
                      <input value={ch.label} onChange={(e) => patchCharger(ch.id, { label: e.target.value })} maxLength={120} aria-required="true" aria-invalid={!!problemFor(`chargers.${ci}.label`)} />
                      <em>{problemFor(`chargers.${ci}.label`)}</em></label>
                    <label className="ie-field ie-grow"><span>Charge point id<Req /></span>
                      <input value={ch.chargePointId} onChange={(e) => patchCharger(ch.id, { chargePointId: e.target.value })} maxLength={48} autoCapitalize="off" spellCheck={false} aria-required="true" aria-invalid={!!problemFor(`chargers.${ci}.chargePointId`)} />
                      <em>{problemFor(`chargers.${ci}.chargePointId`)}</em></label>
                    {ch.id.startsWith("new-") && incoming.filter((c) => !usedIds.has(c.chargePointId.toLowerCase()) || c.chargePointId.toLowerCase() === ch.chargePointId.trim().toLowerCase()).length > 0 && (
                      <label className="ie-field ie-grow"><span>Incoming</span>
                        <select value="" onChange={(e) => { if (e.target.value) patchCharger(ch.id, { chargePointId: e.target.value }); }}>
                          <option value="">Pick…</option>{incoming.filter((c) => !usedIds.has(c.chargePointId.toLowerCase())).map((c) => <option key={c.chargePointId} value={c.chargePointId}>{c.chargePointId}</option>)}
                        </select></label>
                    )}
                    <label className="ie-field ie-grow"><span>Maker (optional)</span>
                      <input value={ch.vendor} onChange={(e) => patchCharger(ch.id, { vendor: e.target.value })} maxLength={80} /></label>
                    <label className="ie-field ie-grow"><span>Model (optional)</span>
                      <input value={ch.model} onChange={(e) => patchCharger(ch.id, { model: e.target.value })} maxLength={80} /></label>
                    <label className="ie-field ie-grow"><span>Serial (optional)</span>
                      <input value={ch.serialNumber} onChange={(e) => patchCharger(ch.id, { serialNumber: e.target.value })} maxLength={80} aria-invalid={!!problemFor(`chargers.${ci}.serialNumber`)} />
                      <em>{problemFor(`chargers.${ci}.serialNumber`)}</em></label>
                    <button type="button" className="ws-button" onClick={() => { touch(); setChargers((cs) => cs.filter((x) => x.id !== ch.id)); }} aria-label={`Remove charger ${ch.label || "(unnamed)"}`}>Remove</button>
                  </div>
                  <ChargerAddress address={chargerAddress(liveRouting, ch.chargePointId)} routingKnown={liveRouting !== null} tag={ch.id} copied={copied} onCopy={copy} />
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
  const endpoint = cpoAddress(liveRouting);
  const savedDraft = !view && session.current.revision !== undefined;
  const stateText = dirty ? (view ? "Unsaved changes." : "Unsaved changes — kept only when you press Save draft.") : savedDraft ? "All changes are in the saved draft." : "";
  const lockedByUsedDraft = usedDraft !== null;

  return (
    <form className="ie" onSubmit={(e) => { e.preventDefault(); void save(); }} noValidate aria-busy={busy !== null}>
      <fieldset className="ie-lock" disabled={busy !== null}>
      {!view && initialDraft && (
        <p className="ws-note" role="note">Resumed a saved draft{initialDraft.name ? ` “${initialDraft.name}”` : ""} (saved {new Date(initialDraft.updatedAt).toLocaleString()}). Nothing has been created from it yet.</p>
      )}
      {!view && !initialDraft && others.length > 0 && (
        <section className="ws-panel" aria-labelledby="ie-drafts">
          <div className="ws-panel-heading"><h2 id="ie-drafts">Saved drafts</h2></div>
          <p className="ws-muted">Unfinished installations you saved earlier. Nothing has been created from them. Resume one, or discard it if it will not be used; discarding does not remove any organisation or site.</p>
          <ul className="ie-tree">
            {others.map((d) => (
              <li key={d.id} className="ie-node">
                <div className="ie-row">
                  <span className="ie-grow">{d.name ?? "Unnamed installation"}{d.orgName ? ` — ${d.orgName}` : ""} <span className="ws-muted">saved {new Date(d.updatedAt).toLocaleString()}</span></span>
                  <Link href={`${LIST_HREF}?new=1&draft=${d.id}` as Route} className="ws-button" prefetch={false}>Resume</Link>
                  <button type="button" className="ws-button" onClick={() => void discardOther(d)}>Discard</button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="ws-panel" aria-labelledby="ie-conn">
        <div className="ws-panel-heading"><h2 id="ie-conn">OCPP connection URL</h2></div>
        {endpoint ? (
          <>
            <div className="ie-address">
              <code>{endpoint}</code>
              <button type="button" className="ws-button" onClick={() => copy(endpoint, "address")}>{copied === "address" ? "Copied" : "Copy"}</button>
            </div>
            <p className="ws-muted">Each charger adds its own charge point id; its full URL is shown under it below.</p>
          </>
        ) : (
          <p className="ws-muted">This CPO has no connection address yet.</p>
        )}
        <div className="ie-pw">
          <div className="ie-row">
            <label className="ie-field ie-grow"><span>OCPP password (optional){pwValue !== "" && <Req />}</span>
              <input
                type="password" autoComplete="new-password" value={pwValue} maxLength={128}
                onChange={(e) => { edit(setPwValue)(e.target.value); if (e.target.value !== "") setRemovePw(false); }}
                placeholder={view ? "Leave empty to keep the current setting" : undefined}
                aria-invalid={!!problemFor("password")}
              />
              <em>{problemFor("password")}</em></label>
          </div>
          {view && <p className="ws-muted">{view.installation.password.mode === "password" ? `A password is set${view.installation.password.setAt ? ` (${new Date(view.installation.password.setAt).toLocaleString()})` : ""}.` : view.installation.password.mode === "none" ? "No password, by choice." : "No password has been chosen yet."}</p>}
          {!view && pwPending && pwValue === "" && (
            <p className="ws-note" role="note">
              You had entered a password before saving this draft. It is not kept in drafts, so enter it again —{" "}
              <button type="button" className="ie-link" onClick={() => { touch(); setPwPending(false); setProblems((ps) => ps.filter((p) => p.path !== "password")); }}>or continue without a password</button>.
            </p>
          )}
          {view?.installation.password.mode === "password" && (removePw ? (
            <p className="ws-note" role="status">The password will be removed when you press Save changes. <button type="button" className="ie-link" onClick={() => { touch(); setRemovePw(false); }}>Keep it</button></p>
          ) : (
            <button type="button" className="ws-button" onClick={() => { if (window.confirm("Remove this installation's OCPP password when you save?\n\nChargers will then connect without one.")) { touch(); setPwValue(""); setRemovePw(true); } }}>Remove password…</button>
          ))}
        </div>
      </section>

      <section className="ws-panel" aria-labelledby="ie-inst">
        <div className="ws-panel-heading"><h2 id="ie-inst">Installation</h2>{view && <span className="ws-badge">Revision {view.installation.revision}</span>}</div>
        <div className="ie-row">
          <label className="ie-field ie-grow"><span>Name<Req /></span>
            <input value={name} onChange={(e) => edit(setName)(e.target.value)} maxLength={120} aria-required="true" aria-invalid={!!problemFor("installation.displayName")} />
            <em>{problemFor("installation.displayName")}</em></label>
          {view ? (
            <p className="ws-muted ie-grow">Identifier <code>{view.installation.key}</code></p>
          ) : (
            <label className="ie-field ie-grow"><span>Site / address<Req /></span>
              <select value={creatingSite ? SITE_CREATE : siteId} onChange={(e) => { if (e.target.value === SITE_CREATE) setCreatingSite(true); else { setCreatingSite(false); edit(setSiteId)(e.target.value); } }} aria-required="true" aria-invalid={!!problemFor("siteId")}>
                <option value="">Choose…</option>{sites.map((s) => <option key={s.id} value={s.id}>{s.displayName}{s.address ? ` — ${s.address}` : ""}</option>)}<option value={SITE_CREATE}>Create Site +</option>
              </select><em>{problemFor("siteId")}</em></label>
          )}
        </div>
        {!view && creatingSite && <SiteCreate onCancel={() => setCreatingSite(false)} onSite={async (n, a) => (await exclusive("directory", async () => { setMessage(null); const c = await createDirectory({ action: "create-site", orgId, displayName: n, address: a }); if (!c) return false; await refreshDirectory(); touch(); setSiteId(c.id); setCreatingSite(false); return true; })) === true} />}

        {toAssign.length > 0 && (
          <div className="ie-attach" role="group" aria-labelledby="ie-attach">
            <div className="ie-subhead"><h3 id="ie-attach">To assign ({toAssign.length})</h3><span className="ws-badge">Incoming, not registered</span></div>
            {circuits.length === 0 ? (
              <p className="ws-muted">Add a circuit below first, then drag each charger onto it.</p>
            ) : (
              <ul className="ie-pending">
                {toAssign.map((id) => (
                  <li key={id} className={`ie-pending-item${drag?.kind === "pending" && drag.id === id ? " ie-dragging" : ""}`}>
                    <span className="ie-handle" {...dragProps("pending", id)} title="Drag onto a circuit" aria-hidden="true">⠿</span>
                    <code>{id}</code>
                    <select value={pickCircuit[id] ?? ""} onChange={(e) => setPickCircuit((p) => ({ ...p, [id]: e.target.value }))} aria-label={`Circuit for ${id}`}>
                      <option value="">Choose circuit…</option>{circuits.map((c) => <option key={c.id} value={c.id}>{circuitPath(c)}</option>)}
                    </select>
                    <button type="button" className="ws-button" onClick={() => assignPending(id, pickCircuit[id] ?? "")} disabled={!pickCircuit[id]}>Assign</button>
                    <button type="button" className="ws-button" onClick={() => { touch(); setToAssign((l) => l.filter((x) => x !== id)); }} aria-label={`Remove ${id} from the selection`}>Remove</button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        <div className="ie-subhead"><h3 id="ie-tree">Electrical structure</h3></div>
        <div className="ie-node ie-main" role="group" aria-labelledby="ie-tree">
          <strong>Main protection</strong>
          <div className="ie-row">
            <label className="ie-field ie-narrow"><span>TN/IT</span>
              <select value={mainGrid} onChange={(e) => edit(setMainGrid)(e.target.value as typeof mainGrid)}><option value="">Select…</option><option value="TN">TN</option><option value="IT">IT</option></select></label>
            <label className="ie-field ie-narrow"><span>Phases</span>
              <select value={mainPhases} onChange={(e) => edit(setMainPhases)(e.target.value as typeof mainPhases)}><option value="">not set</option><option value="1">1</option><option value="2">2</option><option value="3">3</option></select></label>
            <label className="ie-field ie-grow"><span>CB</span>
              <select value={mainKind} onChange={(e) => edit(setMainKind)(e.target.value as DeviceKind)}>
                <option value="">Not specified</option><option value="breaker">{DEVICE_TYPE_TEXT.breaker}</option><option value="fuse">{DEVICE_TYPE_TEXT.fuse}</option><option value="other">{DEVICE_TYPE_TEXT.other}</option>
              </select></label>
            <label className="ie-field ie-narrow"><span>Rating (A)</span>
              <input inputMode="numeric" value={mainAmps} onChange={(e) => edit(setMainAmps)(e.target.value)} onBlur={() => { if (mainZd && mainAmps.trim() === "") setMainAmps("0"); }} placeholder="not specified" aria-invalid={!!problemFor("installation.mainRatingAmps")} className={isZeroRating(mainAmps) ? "ie-zero" : undefined} aria-describedby={isZeroRating(mainAmps) ? "zero-main" : undefined} />
              {isZeroRating(mainAmps) && <span id="zero-main" className="ie-zero-flag">⚠ 0 A</span>}
              <em>{problemFor("installation.mainRatingAmps")}</em></label>
          </div>
          {mainKind === "other" && (
            <div className="ie-row">
              <label className="ie-field ie-grow"><span>Description (optional)</span>
                <input value={mainCustom} onChange={(e) => edit(setMainCustom)(e.target.value)} maxLength={60} /></label>
            </div>
          )}
          {roots.length === 0 ? <p className="ws-muted">No circuits yet. An installation can be saved without circuits or chargers.</p> : <ul className="ie-tree">{roots.map((c) => renderCircuit(c, circuits.indexOf(c)))}</ul>}
          <div className="ie-actions"><button type="button" className="ws-button" onClick={() => addCircuit(null)}>+ Circuit</button></div>
        </div>
        {problemFor("circuits") && <p className="ie-error" role="alert">{problemFor("circuits")}</p>}
      </section>

      <section className="ws-panel" aria-labelledby="ie-elec">
        <div className="ws-panel-heading"><h2 id="ie-elec">On-site electrician</h2><span className="ws-badge">{statusText}</span></div>
        <div className="ie-row">
          <label className="ie-field ie-grow"><span>Name</span><input value={eName} onChange={(e) => edit(setEName)(e.target.value)} maxLength={120} /></label>
          <label className="ie-field ie-grow"><span>Email</span><input type="email" value={eEmail} onChange={(e) => edit(setEEmail)(e.target.value)} maxLength={254} aria-invalid={!!problemFor("electrician.email")} /><em>{problemFor("electrician.email")}</em></label>
          <label className="ie-field ie-grow"><span>Phone</span><input type="tel" value={ePhone} onChange={(e) => edit(setEPhone)(e.target.value)} maxLength={32} aria-invalid={!!problemFor("electrician.phone")} /><em>{problemFor("electrician.phone")}</em></label>
        </div>
        <p className="ws-muted">No email is sent; confirmation is not enabled yet, so this stays &quot;not confirmed&quot;.</p>
      </section>

      {usedDraft && (
        <div className="ws-note ie-used" role="alert">
          <strong>This draft was already used to create an installation.</strong> Nothing new was created by this attempt{usedDraft.installationId ? "." : ", and it could not be identified from here — find it in the installations list."}
          <div className="ie-actions">
            {usedDraft.installationId && <Link href={`${LIST_HREF}?id=${usedDraft.installationId}` as Route} prefetch={false} className="ws-button ws-primary" data-ie-leave="">Open the installation</Link>}
            <button type="button" className="ws-button" onClick={startSeparate}>Create a separate installation from this form…</button>
            <Link href={LIST_HREF as Route} prefetch={false} className="ws-button" data-ie-leave="">Leave this form</Link>
          </div>
        </div>
      )}

      <div className="ie-savebar">
        {view && (
          <details className="ie-dir ie-adv">
            <summary>Change details</summary>
            <label className="ie-field"><span>Physical change happened (optional)</span>
              <input type="datetime-local" value={effectiveAt} onChange={(e) => edit(setEffectiveAt)(e.target.value)} /></label>
          </details>
        )}
        <div className="ie-buttons">
          {!view && <button type="button" className="ws-button" onClick={() => void discardThisDraft()}>{busy === "discard" ? "Discarding…" : "Discard draft"}</button>}
          {!view && <button type="button" className="ws-button" onClick={() => void saveDraft()} disabled={lockedByUsedDraft}>{busy === "draft" ? "Saving draft…" : "Save draft"}</button>}
          {!view && <button type="button" className="ws-button" onClick={() => void saveDraftAndClose()} disabled={lockedByUsedDraft}>Save draft and close</button>}
          <button type="submit" className="ws-button ws-primary" disabled={lockedByUsedDraft}>{busy === "save" ? "Saving…" : view ? "Save changes" : "Create installation"}</button>
        </div>
        <div role="status" aria-live="polite" className={`ie-msg ie-${message?.kind ?? "none"}`}>
          {stateText && <span className="ie-dirty">{stateText} </span>}
          {message?.text}
          {message?.kind === "conflict" && <> <Link href={`${LIST_HREF}${view ? `?id=${view.installation.id}` : `?new=1${savedDraft ? `&draft=${session.current.id}` : ""}`}` as Route} prefetch={false} data-ie-leave="" onClick={() => window.location.reload()}>Reload</Link></>}
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
      </fieldset>
    </form>
  );
}

/** One charger's complete address, built only from the charge point id typed for that charger. */
function ChargerAddress({ address, routingKnown, tag, copied, onCopy }: { address: string | null; routingKnown: boolean; tag: string; copied: string | null; onCopy: (text: string, tag: string) => void }) {
  if (!routingKnown) return <p className="ws-muted">This charger&apos;s address appears once its organisation has a routing id.</p>;
  if (!address) return <p className="ws-muted">Enter this charger&apos;s charge point id to see its address. It is the id you configure on the charger itself — not assumed to be its serial number.</p>;
  return (
    <div className="ie-address">
      <code>{address}</code>
      <button type="button" className="ws-button" onClick={() => onCopy(address, `charger-${tag}`)}>{copied === `charger-${tag}` ? "Copied" : "Copy"}</button>
    </div>
  );
}

const show = (v: unknown) => (v === null || v === undefined || v === "" ? "—" : String(v));
const describe = (h: { entityType: string; action: string }) => `${h.entityType} ${h.action}`;


/** The site-name/address entry opened by "Create Site +". Values stay until the site is created; a failure keeps them. `initialName` is only a suggestion the operator can change. */
export function SiteCreate({ onSite, onCancel, initialName = "" }: { onSite: (name: string, address: string) => Promise<boolean>; onCancel: () => void; initialName?: string }) {
  const [site, setSite] = useState(initialName);
  const [addr, setAddr] = useState("");
  return (
    <div className="ie-row ie-newsite">
      <label className="ie-field ie-grow"><span>New site name<Req /></span><input value={site} onChange={(e) => setSite(e.target.value)} maxLength={120} autoFocus aria-required="true" /></label>
      <label className="ie-field ie-grow"><span>Address</span><input value={addr} onChange={(e) => setAddr(e.target.value)} maxLength={200} /></label>
      <button type="button" className="ws-button" disabled={site.trim().length < 2} onClick={() => void onSite(site.trim(), addr.trim())}>Add site</button>
      <button type="button" className="ws-button" onClick={onCancel}>Cancel</button>
    </div>
  );
}

/** "* required", shown once, beside the page title (the page and any preview use this one). */
export function RequiredNote() {
  return <span className="ie-required">* required</span>;
}

// Onboarding installations read directly from an OEM account is in ./vendor-onboarding.tsx; it reuses SiteCreate, Req and
// SITE_CREATE from this file and saves through the same endpoint as this editor. Nothing here reads or writes an import file.

