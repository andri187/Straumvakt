"use client";

import { useState } from "react";
import { apiFetch } from "@/lib/api-client";
import type { IdTokenSummary } from "@straumvakt/shared/domain/users";

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
  const [value, setValue] = useState("");
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [justMintedId, setJustMintedId] = useState<string | null>(null);

  function resetForm() {
    setMode("auto");
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
      const body: Record<string, string> = { kind: "rfid" };
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

  return (
    <div className="px-5 py-4 space-y-3">
      {tokens.length === 0 ? (
        <p className="text-xs italic text-ink-500">
          No tokens yet. Should not happen for users created via the admin
          form (primary RFID auto-mints) — possibly a Sprint-1 user from
          before closure item 1 landed.
        </p>
      ) : (
        <ul className="divide-y divide-bg-border/40">
          {tokens.map((t) => (
            <li
              key={t.id}
              className={
                "flex flex-wrap items-center gap-3 py-2 " +
                (justMintedId === t.id ? "bg-emerald-500/5 -mx-2 px-2 rounded" : "")
              }
            >
              <code
                className={
                  "select-all rounded bg-bg-base/60 px-2 py-1 font-mono text-sm ring-1 " +
                  (t.status === "active"
                    ? "text-emerald-100 ring-emerald-500/30"
                    : "text-ink-400 line-through ring-bg-border/40")
                }
              >
                {t.value}
              </code>
              <span className="text-xs text-ink-300">
                {t.label ?? <span className="italic text-ink-500">no label</span>}
              </span>
              <span
                className={
                  "rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-brand " +
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
                {t.kind} · added {new Date(t.createdAt).toLocaleDateString()}
              </span>
              <span className="ml-auto" />
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
            </li>
          ))}
        </ul>
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
          <div className="flex gap-2 text-xs">
            <button
              type="button"
              onClick={() => setMode("auto")}
              className={
                "rounded-md px-3 py-1.5 font-medium ring-1 " +
                (mode === "auto"
                  ? "bg-sv-sky/20 text-sv-sky ring-sv-sky/40"
                  : "bg-bg-base/40 text-ink-400 ring-bg-border")
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
              I have a card UID
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
