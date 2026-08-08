"use client";

import { useState } from "react";
import { apiFetch } from "@/lib/api-client";
import type { IdTokenSummary } from "@straumvakt/shared/domain/users";

// Operator-friendly labels for IdTokenKind. The DB enum is
// implementation-orientated; this surface the operator names per
// 2026-05-10. Anything not in this map falls back to the raw enum.
const KIND_LABELS: Record<string, { short: string; full: string; tone: string }> = {
  rfid: {
    short: "RFID card/chip",
    full: "Physical RFID card or fob (MIFARE Classic / DESFire UID)",
    tone: "bg-sv-sky/15 text-sv-sky ring-sv-sky/30",
  },
  manual: {
    short: "Virtual RFID",
    full: "Operator-set static value (e.g. Zaptec portal default tag)",
    tone: "bg-amber-400/15 text-amber-300 ring-amber-400/30",
  },
  evccid: {
    short: "VID RFID",
    full: "Vehicle Identifier — value is the car's EVCCID / EV-PLC-MAC (Autocharge)",
    tone: "bg-purple-400/15 text-purple-300 ring-purple-400/30",
  },
  zaptec_proxy: {
    short: "Vendor (Zaptec)",
    full: "Mirrored from a Zaptec portal token",
    tone: "bg-emerald-400/15 text-emerald-300 ring-emerald-400/30",
  },
  ocpi_token: {
    short: "OCPI roaming",
    full: "Token from a roaming partner via OCPI",
    tone: "bg-indigo-400/15 text-indigo-300 ring-indigo-400/30",
  },
  app_jwt: {
    short: "App JWT",
    full: "Mobile-app issued JWT-derived token",
    tone: "bg-bg-raised/60 text-ink-300 ring-bg-border",
  },
  magic_link: {
    short: "Magic link",
    full: "One-shot email magic link",
    tone: "bg-bg-raised/60 text-ink-300 ring-bg-border",
  },
};

function kindLabel(kind: string) {
  return KIND_LABELS[kind] ?? {
    short: kind,
    full: kind,
    tone: "bg-bg-raised/60 text-ink-300 ring-bg-border",
  };
}

// Kinds the operator can pick when adding a token. Excludes vendor-
// mirrored / app / magic-link kinds which arrive via other paths.
const ADDABLE_KINDS = ["rfid", "manual", "evccid"] as const;
type AddableKind = (typeof ADDABLE_KINDS)[number];

/**
 * Operator surface for an individual user's RFID/IdToken collection.
 * Closure item 1 from docs/retros/sprint-03.md — gives the previously
 * orphan identity.id_tokens table a real write path through the admin
 * UI.
 *
 * Three operator actions:
 *   1. Auto-mint a new RFID UID (server generates an 8-hex-uppercase
 *      value; operator programs a card with it later).
 *   2. Add a manually-typed RFID UID (operator already has a card
 *      with a known UID and types the bytes in).
 *   3. Revoke an existing token (soft delete; row stays for audit,
 *      OCPP Authorize handler returns Blocked for revoked tokens).
 *
 * Pure client component — uses apiFetch + router.refresh on success
 * via the parent page's revalidation. No optimistic state for
 * revoke (refetch is fast and matches the rest of the admin UI).
 */
export function TokensPanel({
  userId,
  initialTokens,
}: {
  userId: string;
  initialTokens: IdTokenSummary[];
}) {
  const [tokens, setTokens] = useState<IdTokenSummary[]>(initialTokens);
  const [adding, setAdding] = useState(false);
  const [mode, setMode] = useState<"auto" | "manual">("auto");
  const [kind, setKind] = useState<AddableKind>("rfid");
  const [value, setValue] = useState("");
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [justMintedId, setJustMintedId] = useState<string | null>(null);

  // Per-row edit state. Only one token edits at a time — store the id
  // currently in edit mode plus the working draft. Keeps state simple
  // vs a Map of drafts per id.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [editLabel, setEditLabel] = useState("");

  function resetForm() {
    setMode("auto");
    setKind("rfid");
    setValue("");
    setLabel("");
    setError(null);
  }

  async function refetch() {
    const res = await apiFetch(`/api/admin/users/${userId}/tokens`);
    if (res.ok) {
      const body = (await res.json()) as { tokens: IdTokenSummary[] };
      setTokens(body.tokens);
    }
  }

  async function submitAdd(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const body: Record<string, string> = { kind };
      if (mode === "manual" && value.trim().length > 0) {
        body.value = value.trim().toUpperCase();
      }
      if (label.trim().length > 0) {
        body.label = label.trim();
      }
      const res = await apiFetch(`/api/admin/users/${userId}/tokens`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => null)) as
        | { token?: IdTokenSummary; error?: string; message?: string }
        | null;
      if (!res.ok) {
        throw new Error(
          data?.message ?? data?.error ?? `HTTP ${res.status}`,
        );
      }
      if (data?.token) {
        setTokens([...tokens, data.token]);
        if (mode === "auto") setJustMintedId(data.token.id);
      }
      setAdding(false);
      resetForm();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function revoke(tokenId: string) {
    if (
      !confirm(
        "Revoke this token? It cannot be un-revoked. Sessions using it will be denied at Authorize.req.",
      )
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/admin/tokens/${tokenId}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as
          | { error?: string }
          | null;
        throw new Error(body?.error ?? `HTTP ${res.status}`);
      }
      await refetch();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function permanentDelete(tokenId: string, value: string) {
    const typed = prompt(
      `Permanently delete this token? This is IRREVERSIBLE — the row is removed from the database, audit history is lost.\n\nTo confirm, type the token value: ${value}`,
    );
    if (typed !== value) {
      if (typed !== null) {
        setError("Confirmation didn't match — token not deleted.");
      }
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch(
        `/api/admin/tokens/${tokenId}/permanent`,
        { method: "DELETE" },
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as
          | { error?: string; message?: string }
          | null;
        throw new Error(body?.message ?? body?.error ?? `HTTP ${res.status}`);
      }
      setTokens(tokens.filter((t) => t.id !== tokenId));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  function startEdit(t: IdTokenSummary) {
    setEditingId(t.id);
    setEditValue(t.value);
    setEditLabel(t.label ?? "");
    setError(null);
  }

  function cancelEdit() {
    setEditingId(null);
    setEditValue("");
    setEditLabel("");
  }

  async function submitEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editingId) return;
    const original = tokens.find((t) => t.id === editingId);
    if (!original) return;

    const newValue = editValue.trim().toUpperCase();
    const newLabel = editLabel.trim();
    const valueChanged = newValue !== original.value;
    const labelChanged = newLabel !== (original.label ?? "");

    if (newValue.length === 0) {
      setError("Value can't be empty.");
      return;
    }
    if (!valueChanged && !labelChanged) {
      cancelEdit();
      return;
    }
    if (
      valueChanged &&
      !confirm(
        `Changing the token value from "${original.value}" to "${newValue}" repoints which RFID UID this token authorizes. Sessions started after this change will require the new value. Proceed?`,
      )
    ) {
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const patch: Record<string, string | null> = {};
      if (valueChanged) patch.value = newValue;
      if (labelChanged) patch.label = newLabel.length > 0 ? newLabel : null;
      const res = await apiFetch(`/api/admin/tokens/${editingId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch),
      });
      const data = (await res.json().catch(() => null)) as
        | { token?: IdTokenSummary; error?: string; message?: string }
        | null;
      if (!res.ok) {
        throw new Error(
          data?.message ?? data?.error ?? `HTTP ${res.status}`,
        );
      }
      if (data?.token) {
        setTokens(tokens.map((t) => (t.id === editingId ? data.token! : t)));
      }
      cancelEdit();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="px-5 py-4 space-y-3">
      {tokens.length === 0 ? (
        <p className="text-xs italic text-ink-500">
          No tokens yet. Should not happen for users created via the admin
          form (primary RFID auto-mints) — possibly a Sprint-1 user from
          before closure item 1 landed.
        </p>
      ) : (
        <>
          <div className="hidden md:grid grid-cols-[minmax(0,170px)_minmax(0,1fr)_minmax(0,130px)_80px_minmax(0,90px)_auto] gap-x-3 px-1 pb-1 text-[10px] font-semibold uppercase tracking-brand text-ink-500">
            <span>Value</span>
            <span>Label</span>
            <span>Type</span>
            <span>Status</span>
            <span>Added</span>
            <span className="text-right">Actions</span>
          </div>
          <ul className="divide-y divide-bg-border/40">
          {tokens.map((t) => (
            <li
              key={t.id}
              className={
                "py-2 " +
                (justMintedId === t.id ? "bg-emerald-500/5 -mx-2 px-2 rounded" : "")
              }
            >
              {editingId === t.id ? (
                <form onSubmit={submitEdit} className="space-y-2 rounded border border-sv-sky/30 bg-bg-base/30 p-3">
                  <label className="block">
                    <span className="block text-[11px] font-semibold uppercase tracking-brand text-ink-400">
                      Card UID (hex) — wire-format value
                    </span>
                    <input
                      type="text"
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      className="mt-1 w-full rounded-md border border-bg-border bg-bg-base/50 px-3 py-2 font-mono text-sm uppercase text-ink-50 focus:border-sv-sky focus:outline-none"
                      required
                    />
                    <span className="mt-0.5 block text-[10px] text-amber-300">
                      ⚠ Editing changes which RFID UID this token authorizes. The OCPP Authorize handler matches on this exact value.
                    </span>
                  </label>
                  <label className="block">
                    <span className="block text-[11px] font-semibold uppercase tracking-brand text-ink-400">
                      Label <span className="text-ink-500">(optional)</span>
                    </span>
                    <input
                      type="text"
                      value={editLabel}
                      onChange={(e) => setEditLabel(e.target.value)}
                      placeholder="Black tag · Office card · Spare"
                      className="mt-1 w-full rounded-md border border-bg-border bg-bg-base/50 px-3 py-2 text-sm text-ink-50 focus:border-sv-sky focus:outline-none"
                    />
                  </label>
                  <div className="flex items-center gap-2">
                    <button
                      type="submit"
                      disabled={busy || editValue.trim().length === 0}
                      className="rounded-md bg-sv-sky/20 px-3 py-2 text-xs font-medium text-sv-sky ring-1 ring-sv-sky/40 hover:bg-sv-sky/30 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {busy ? "Saving…" : "Save"}
                    </button>
                    <button
                      type="button"
                      onClick={cancelEdit}
                      disabled={busy}
                      className="rounded border border-bg-border px-3 py-2 text-xs text-ink-300 hover:bg-bg-base/50"
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              ) : (
                <div className="grid grid-cols-1 gap-y-1 gap-x-3 md:grid-cols-[minmax(0,170px)_minmax(0,1fr)_minmax(0,130px)_80px_minmax(0,90px)_auto] md:items-center">
                  <code
                    className={
                      "select-all justify-self-start rounded bg-bg-base/60 px-2 py-1 font-mono text-sm ring-1 " +
                      (t.status === "active"
                        ? "text-emerald-100 ring-emerald-500/30"
                        : "text-ink-400 line-through ring-bg-border/40")
                    }
                  >
                    {t.value}
                  </code>
                  <span className="truncate text-xs text-ink-300">
                    {t.label ?? <span className="italic text-ink-500">no label</span>}
                  </span>
                  <span
                    className={
                      "justify-self-start rounded px-1.5 py-0.5 text-[10px] font-medium ring-1 ring-inset whitespace-nowrap " +
                      kindLabel(t.kind).tone
                    }
                    title={kindLabel(t.kind).full}
                  >
                    {kindLabel(t.kind).short}
                  </span>
                  <span
                    className={
                      "justify-self-start rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-brand " +
                      (t.status === "active"
                        ? "bg-emerald-500/20 text-emerald-200"
                        : t.status === "revoked"
                          ? "bg-rose-500/20 text-rose-200"
                          : t.status === "expired"
                            ? "bg-amber-500/20 text-amber-200"
                            : "bg-ink-500/20 text-ink-300")
                    }
                  >
                    {t.status}
                  </span>
                  <span className="text-[10px] text-ink-500">
                    {new Date(t.createdAt).toLocaleDateString()}
                  </span>
                  <div className="flex flex-wrap items-center gap-2 justify-self-end">
                    <button
                      type="button"
                      onClick={() => startEdit(t)}
                      disabled={busy}
                      className="rounded border border-bg-border bg-bg-base/40 px-2 py-1 text-[11px] text-ink-300 hover:bg-bg-base/70 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      Edit
                    </button>
                    {t.status === "active" && (
                      <button
                        type="button"
                        onClick={() => revoke(t.id)}
                        disabled={busy}
                        className="rounded border border-rose-700/40 bg-rose-950/30 px-2 py-1 text-[11px] text-rose-200 hover:bg-rose-950/60 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        Revoke
                      </button>
                    )}
                    {t.status === "revoked" && (
                      <button
                        type="button"
                        onClick={() => permanentDelete(t.id, t.value)}
                        disabled={busy}
                        title="Permanently remove the row from the database (loses audit history)."
                        className="rounded border border-rose-900/60 bg-rose-950/60 px-2 py-1 text-[11px] text-rose-200 hover:bg-rose-900/80 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        Delete permanently
                      </button>
                    )}
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
        </>
      )}

      {error && (
        <p className="rounded border border-rose-700/40 bg-rose-950/30 p-2 text-xs text-rose-200">
          {error}
        </p>
      )}

      {!adding ? (
        <button
          type="button"
          onClick={() => {
            resetForm();
            setAdding(true);
          }}
          className="rounded-md bg-sv-sky/10 px-3 py-2 text-xs font-medium text-sv-sky ring-1 ring-sv-sky/30 hover:bg-sv-sky/20"
        >
          + Add RFID token
        </button>
      ) : (
        <form
          onSubmit={submitAdd}
          className="space-y-3 rounded border border-sv-sky/30 bg-bg-base/30 p-3"
        >
          <div>
            <span className="block text-[11px] font-semibold uppercase tracking-brand text-ink-400">
              Token type
            </span>
            <div className="mt-1 flex flex-wrap gap-2 text-xs">
              {ADDABLE_KINDS.map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => {
                    setKind(k);
                    // Auto-generate makes no sense for evccid (the
                    // value IS the EVCCID — must be supplied) or
                    // virtual-rfid (operator typically has a specific
                    // string in mind). Default those to manual entry.
                    if (k === "evccid" || k === "manual") setMode("manual");
                  }}
                  title={kindLabel(k).full}
                  className={
                    "rounded-md px-3 py-1.5 font-medium ring-1 ring-inset " +
                    (kind === k
                      ? kindLabel(k).tone
                      : "bg-bg-base/40 text-ink-400 ring-bg-border hover:text-ink-200")
                  }
                >
                  {kindLabel(k).short}
                </button>
              ))}
            </div>
            <span className="mt-1 block text-[10px] text-ink-500">
              {kindLabel(kind).full}
            </span>
          </div>

          <div className="flex gap-2 text-xs">
            <button
              type="button"
              onClick={() => setMode("auto")}
              disabled={kind === "evccid" || kind === "manual"}
              className={
                "rounded-md px-3 py-1.5 font-medium ring-1 " +
                (mode === "auto"
                  ? "bg-sv-sky/20 text-sv-sky ring-sv-sky/40"
                  : "bg-bg-base/40 text-ink-400 ring-bg-border") +
                (kind === "evccid" || kind === "manual"
                  ? " cursor-not-allowed opacity-40"
                  : "")
              }
            >
              Auto-generate UID
            </button>
            <button
              type="button"
              onClick={() => setMode("manual")}
              className={
                "rounded-md px-3 py-1.5 font-medium ring-1 " +
                (mode === "manual"
                  ? "bg-sv-sky/20 text-sv-sky ring-sv-sky/40"
                  : "bg-bg-base/40 text-ink-400 ring-bg-border")
              }
            >
              I have a value
            </button>
          </div>

          {mode === "manual" && (
            <label className="block">
              <span className="block text-[11px] font-semibold uppercase tracking-brand text-ink-400">
                Card UID (hex)
              </span>
              <input
                type="text"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder="DEADBEEF"
                className="mt-1 w-full rounded-md border border-bg-border bg-bg-base/50 px-3 py-2 font-mono text-sm uppercase text-ink-50 focus:border-sv-sky focus:outline-none"
                required
              />
              <span className="mt-0.5 block text-[10px] text-ink-500">
                Read off the card with any NFC scanner. 8 chars (MIFARE Classic) or 14 chars (DESFire). Case-insensitive — stored uppercase.
              </span>
            </label>
          )}

          <label className="block">
            <span className="block text-[11px] font-semibold uppercase tracking-brand text-ink-400">
              Label <span className="text-ink-500">(optional)</span>
            </span>
            <input
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Black tag · Office card · Spare"
              className="mt-1 w-full rounded-md border border-bg-border bg-bg-base/50 px-3 py-2 text-sm text-ink-50 focus:border-sv-sky focus:outline-none"
            />
          </label>

          <div className="flex items-center gap-2">
            <button
              type="submit"
              disabled={busy || (mode === "manual" && value.trim().length === 0)}
              className="rounded-md bg-sv-sky/20 px-3 py-2 text-xs font-medium text-sv-sky ring-1 ring-sv-sky/40 hover:bg-sv-sky/30 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {busy ? "Adding…" : mode === "auto" ? "Mint and add" : "Add"}
            </button>
            <button
              type="button"
              onClick={() => {
                setAdding(false);
                resetForm();
              }}
              disabled={busy}
              className="rounded border border-bg-border px-3 py-2 text-xs text-ink-300 hover:bg-bg-base/50"
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
