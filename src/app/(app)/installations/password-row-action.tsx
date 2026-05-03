"use client";

import { useState } from "react";
import { apiFetch } from "@/lib/api-client";

/**
 * Compact per-row OCPP password manager — used on the /installations
 * list page so the operator can rotate or set a password without
 * navigating into the detail view.
 *
 * Same rotate/set semantics as the detail-page panel
 * (ocpp-password-panel.tsx); just rendered inline behind a
 * disclosure so the list rows stay scannable. The plaintext reveal
 * after a rotation is one-shot — operator must capture it before
 * collapsing the disclosure.
 */
export function PasswordRowAction({
  installationId,
  identityCount,
  authMode,
}: {
  installationId: string;
  identityCount: number;
  authMode: "basic" | "none" | "mixed" | "empty";
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<string | null>(null);
  const [setMode, setSetMode] = useState(false);
  const [setInput, setSetInput] = useState("");

  async function handleRotate() {
    if (busy) return;
    const ok = confirm(
      `Rotate OCPP password for ${identityCount} chargers in this installation? The new password is shown ONCE — capture it before closing the row. Existing chargers will fail auth until the vendor portal is updated.`,
    );
    if (!ok) return;
    setBusy(true);
    setError(null);
    setRevealed(null);
    try {
      const res = await apiFetch(
        `/api/admin/installations/${installationId}/ocpp-password/rotate`,
        { method: "POST" },
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const body = (await res.json()) as {
        result: { plaintext: string; identityCount: number };
      };
      setRevealed(body.result.plaintext);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleDisable() {
    if (busy) return;
    const first = confirm(
      `DISABLE OCPP Basic Auth for ${identityCount} chargers in this installation?\n\nAfter this, anyone who knows a charger's identity-string can connect to our gateway as that charger and inject fake events. Identity-strings are NOT secret.\n\nUse only when the charger firmware genuinely cannot send Basic Auth.`,
    );
    if (!first) return;
    const second = confirm(
      "Last chance — confirm again. The audit log will record this action.",
    );
    if (!second) return;
    setBusy(true);
    setError(null);
    setRevealed(null);
    try {
      const res = await apiFetch(
        `/api/admin/installations/${installationId}/ocpp-password/disable`,
        { method: "POST" },
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleSet(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (setInput.length < 8 || setInput.length > 128) {
      setError("password must be 8–128 chars");
      return;
    }
    const ok = confirm(
      `Set OCPP password for ${identityCount} chargers in this installation to the typed value? Existing chargers will fail auth until the vendor portal is updated.`,
    );
    if (!ok) return;
    setBusy(true);
    setError(null);
    setRevealed(null);
    try {
      const res = await apiFetch(
        `/api/admin/installations/${installationId}/ocpp-password`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ plaintext: setInput }),
        },
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
          message?: string;
        };
        throw new Error(body.message ?? body.error ?? `HTTP ${res.status}`);
      }
      setSetInput("");
      setSetMode(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="shrink-0 rounded border border-bg-border px-2 py-0.5 text-[10px] text-ink-300 hover:border-sv-sky/40 hover:text-sv-sky"
      >
        Manage password
      </button>
    );
  }

  return (
    <div className="mt-2 w-full rounded border border-bg-border/60 bg-bg-base/40 p-3 text-[11px]">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-ink-400">
          OCPP password — covers {identityCount}{" "}
          {identityCount === 1 ? "charger" : "chargers"}
        </span>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setSetMode(false);
            setRevealed(null);
            setError(null);
          }}
          className="text-ink-500 hover:text-ink-100"
        >
          Close
        </button>
      </div>

      {revealed && (
        <div className="mb-2 rounded border border-amber-500/40 bg-amber-950/20 p-2">
          <p className="font-semibold text-amber-200">
            New password — captured ONCE. Paste into Zaptec OCPP Settings → Password.
          </p>
          <div className="mt-1 flex items-center gap-2">
            <code className="flex-1 break-all rounded bg-bg-base/60 px-2 py-1 font-mono text-amber-100">
              {revealed}
            </code>
            <button
              type="button"
              onClick={() => void navigator.clipboard.writeText(revealed)}
              className="rounded border border-amber-500/40 px-2 py-0.5 text-amber-200 hover:bg-amber-500/10"
            >
              Copy
            </button>
          </div>
        </div>
      )}

      {error && (
        <p className="mb-2 rounded border border-rose-500/40 bg-rose-950/20 p-1.5 text-rose-200">
          {error}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={handleRotate}
          className="rounded border border-sv-sky/40 bg-sv-sky/10 px-2 py-1 text-sv-sky hover:bg-sv-sky/20 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? "Rotating…" : "Rotate"}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            setSetMode((s) => !s);
            setError(null);
          }}
          className="rounded border border-bg-border px-2 py-1 text-ink-300 hover:text-ink-100"
        >
          {setMode ? "Cancel set" : "Set explicit"}
        </button>
        {authMode !== "none" && (
          <button
            type="button"
            disabled={busy}
            onClick={handleDisable}
            className="rounded border border-rose-500/40 bg-rose-500/5 px-2 py-1 text-rose-300 hover:bg-rose-500/10 disabled:cursor-not-allowed disabled:opacity-50"
            title="Two confirms required"
          >
            Disable auth
          </button>
        )}
      </div>

      {setMode && (
        <form onSubmit={handleSet} className="mt-2 flex flex-wrap items-center gap-2">
          <input
            type="text"
            spellCheck={false}
            autoComplete="off"
            value={setInput}
            onChange={(e) => setSetInput(e.target.value)}
            placeholder="8–128 chars"
            className="flex-1 min-w-[14rem] rounded border border-bg-border bg-bg-base/60 px-2 py-1 font-mono text-ink-100 focus:border-sv-sky focus:outline-none"
          />
          <button
            type="submit"
            disabled={busy || setInput.length < 8}
            className="rounded border border-sv-sky/40 bg-sv-sky/10 px-2 py-1 text-sv-sky hover:bg-sv-sky/20 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? "Setting…" : "Set"}
          </button>
        </form>
      )}
    </div>
  );
}
