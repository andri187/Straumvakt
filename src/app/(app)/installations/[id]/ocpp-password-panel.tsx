"use client";

import { useState } from "react";
import { apiFetch } from "@/lib/api-client";

/**
 * Per-installation OCPP password manager.
 *
 * Two operations:
 *   • Rotate — server generates a fresh random password, stamps the
 *     hash on every OcppIdentity in this installation, and returns
 *     the plaintext ONCE. Operator must capture it immediately —
 *     it's never persisted in plaintext, so a missed copy = another
 *     rotation.
 *   • Set — operator-supplied plaintext (e.g. mirroring a value
 *     they've typed into Zaptec's portal). Same bulk-update,
 *     same audit row, no plaintext returned.
 *
 * Pushing the new password into the charger itself is the operator's
 * job (typically via the vendor portal — Zaptec, Easee, etc.). A
 * future commit can wire UpdateOcppSettings to push automatically
 * via the encrypted vendor credential.
 */

type AuthMode = "basic" | "none" | "mixed" | "empty";

type Summary = {
  installationId: string;
  identityCount: number;
  lastRotatedAt: string | null;
  authMode: AuthMode;
};

type RotateResult = {
  installationId: string;
  identityCount: number;
  plaintext: string;
};

export function InstallationOcppPasswordPanel({
  installationId,
  initialSummary,
}: {
  installationId: string;
  initialSummary: Summary | null;
}) {
  const [summary, setSummary] = useState<Summary | null>(initialSummary);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<string | null>(null);
  const [setMode, setSetMode] = useState(false);
  const [setInput, setSetInput] = useState("");

  async function handleRotate() {
    if (busy) return;
    const ok = confirm(
      `Rotate OCPP password for ${summary?.identityCount ?? "?"} chargers in this installation? The new password is shown ONCE — capture it before closing the page. Existing chargers will fail auth until the vendor portal is updated with the new value.`,
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
      const body = (await res.json()) as { result: RotateResult };
      setRevealed(body.result.plaintext);
      setSummary({
        installationId: body.result.installationId,
        identityCount: body.result.identityCount,
        lastRotatedAt: new Date().toISOString(),
        authMode: "basic",
      });
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
      `Set OCPP password for ${summary?.identityCount ?? "?"} chargers in this installation to the value you just typed? Existing chargers will fail auth until the vendor portal is updated with this value.`,
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
        const body = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
        throw new Error(body.message ?? body.error ?? `HTTP ${res.status}`);
      }
      const body = (await res.json()) as { result: { identityCount: number } };
      setSummary({
        installationId,
        identityCount: body.result.identityCount,
        lastRotatedAt: new Date().toISOString(),
        authMode: "basic",
      });
      setSetInput("");
      setSetMode(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleDisable() {
    if (busy) return;
    const first = confirm(
      `DISABLE OCPP Basic Auth for ${summary?.identityCount ?? "?"} chargers in this installation?\n\nAfter this, ANYONE who knows a charger's identity-string can connect to our gateway as that charger and inject fake StatusNotification, MeterValues, and StartTransaction events. Identity-strings are NOT secret — they're written into the vendor portal in plaintext and sometimes printed on charger labels.\n\nUse only when:\n  • The charger firmware genuinely cannot send Basic Auth, AND\n  • The fraud / pollution risk is acceptable for this fleet.`,
    );
    if (!first) return;
    const second = confirm(
      "Last chance — confirm again that you want to put this installation on the no-auth path. The audit log will record this action.",
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
      const body = (await res.json()) as { result: { identityCount: number } };
      setSummary({
        installationId,
        identityCount: body.result.identityCount,
        lastRotatedAt: new Date().toISOString(),
        authMode: "none",
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  function copyRevealed() {
    if (!revealed) return;
    void navigator.clipboard.writeText(revealed);
  }

  const authMode = summary?.authMode ?? "empty";

  return (
    <section className="mt-8 rounded-lg border border-bg-border bg-bg-base/30 p-4">
      <header className="mb-3">
        <h2 className="text-sm font-semibold text-ink-50">OCPP password</h2>
        <p className="mt-0.5 text-[11px] text-ink-400">
          Installation-level Basic-Auth password. One value covers every
          charger in this installation (the Zaptec model). Rotation
          re-stamps the hash across all chargers in one transaction.
          Plaintext is shown once on rotate — capture it then.
        </p>
      </header>

      <dl className="mb-3 flex flex-wrap gap-x-6 gap-y-1 text-xs">
        <div>
          <dt className="inline text-ink-500">Auth mode: </dt>
          <dd className="inline">
            {authMode === "basic" && (
              <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 font-mono text-[10px] text-emerald-300">
                Basic Auth required
              </span>
            )}
            {authMode === "none" && (
              <span className="rounded bg-amber-500/10 px-1.5 py-0.5 font-mono text-[10px] text-amber-300">
                No auth — chargers connect without password
              </span>
            )}
            {authMode === "mixed" && (
              <span className="rounded bg-rose-500/10 px-1.5 py-0.5 font-mono text-[10px] text-rose-300">
                MIXED — some chargers have hash, some don't (drift)
              </span>
            )}
            {authMode === "empty" && (
              <span className="text-ink-400">no chargers yet</span>
            )}
          </dd>
        </div>
        <div>
          <dt className="inline text-ink-500">Chargers covered: </dt>
          <dd className="inline text-ink-100">
            {summary?.identityCount ?? "—"}
          </dd>
        </div>
        <div>
          <dt className="inline text-ink-500">Last changed: </dt>
          <dd className="inline text-ink-100">
            {summary?.lastRotatedAt
              ? new Date(summary.lastRotatedAt).toLocaleString()
              : "never (initial import)"}
          </dd>
        </div>
      </dl>

      {revealed && (
        <div className="mb-3 rounded-md border border-amber-500/40 bg-amber-950/20 p-3 text-[11px]">
          <p className="font-semibold text-amber-200">
            New password — captured ONCE. Paste this into the vendor
            portal (Zaptec → OCPP Settings → Password) before leaving
            the page.
          </p>
          <div className="mt-2 flex items-center gap-2">
            <code className="flex-1 break-all rounded bg-bg-base/60 px-2 py-1 font-mono text-amber-100">
              {revealed}
            </code>
            <button
              type="button"
              onClick={copyRevealed}
              className="rounded border border-amber-500/40 px-2 py-1 text-amber-200 hover:bg-amber-500/10"
            >
              Copy
            </button>
            <button
              type="button"
              onClick={() => setRevealed(null)}
              className="rounded border border-bg-border px-2 py-1 text-ink-400 hover:text-ink-100"
            >
              Hide
            </button>
          </div>
        </div>
      )}

      {error && (
        <p className="mb-2 rounded border border-rose-500/40 bg-rose-950/20 p-2 text-[11px] text-rose-200">
          {error}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={handleRotate}
          className="rounded-md border border-sv-sky/40 bg-sv-sky/10 px-3 py-1.5 text-xs font-medium text-sv-sky hover:bg-sv-sky/20 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? "Rotating…" : "Rotate password"}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            setSetMode((s) => !s);
            setError(null);
          }}
          className="rounded-md border border-bg-border px-3 py-1.5 text-xs text-ink-300 hover:text-ink-100"
        >
          {setMode ? "Cancel" : "Set explicit password"}
        </button>
        {authMode !== "none" && (
          <button
            type="button"
            disabled={busy}
            onClick={handleDisable}
            className="rounded-md border border-rose-500/40 bg-rose-500/5 px-3 py-1.5 text-xs text-rose-300 hover:bg-rose-500/10 disabled:cursor-not-allowed disabled:opacity-50"
            title="Put the entire installation on the no-auth path. Two confirms required."
          >
            Disable Basic Auth
          </button>
        )}
      </div>

      {setMode && (
        <form onSubmit={handleSet} className="mt-3 flex flex-wrap items-center gap-2">
          <input
            type="text"
            spellCheck={false}
            autoComplete="off"
            value={setInput}
            onChange={(e) => setSetInput(e.target.value)}
            placeholder="8–128 chars"
            className="flex-1 min-w-[16rem] rounded border border-bg-border bg-bg-base/60 px-2 py-1.5 font-mono text-xs text-ink-100 focus:border-sv-sky focus:outline-none"
          />
          <button
            type="submit"
            disabled={busy || setInput.length < 8}
            className="rounded-md border border-sv-sky/40 bg-sv-sky/10 px-3 py-1.5 text-xs font-medium text-sv-sky hover:bg-sv-sky/20 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? "Setting…" : "Set"}
          </button>
        </form>
      )}
    </section>
  );
}
