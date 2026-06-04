"use client";

import { useState } from "react";
import { apiFetch } from "@/lib/api-client";

interface MintedDetail {
  userId: string;
  email: string;
  value: string;
}

interface ErrorDetail {
  userId: string;
  email: string;
  error: string;
}

interface BackfillReport {
  scanned: number;
  minted: number;
  errors: number;
  mintedDetails: MintedDetail[];
  errorDetails: ErrorDetail[];
}

/**
 * One-click trigger for POST /api/admin/tokens/backfill. Idempotent —
 * the endpoint walks every User row that has zero IdToken rows and
 * mints one primary RFID. Re-running after the first pass is a no-op.
 *
 * Surfaces the report inline so the operator can audit which users
 * got which UID. RFID UIDs are not secrets so we display them plainly.
 */
export function BackfillRfidButton() {
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<BackfillReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    if (
      !confirm(
        "Backfill primary RFIDs for every user that currently has zero tokens? Idempotent — re-running after the first pass is a no-op.",
      )
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch("/api/admin/tokens/backfill", {
        method: "POST",
      });
      const body = (await res.json().catch(() => null)) as
        | BackfillReport
        | { error?: string }
        | null;
      if (!res.ok) {
        throw new Error(
          (body && "error" in body && body.error) || `HTTP ${res.status}`,
        );
      }
      setReport(body as BackfillReport);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={run}
        disabled={busy}
        className="rounded-md bg-amber-500/15 px-3 py-1.5 text-[11px] font-medium text-amber-200 ring-1 ring-amber-500/40 hover:bg-amber-500/25 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {busy ? "Running…" : "Backfill primary RFIDs for existing users"}
      </button>

      {error && (
        <p className="rounded border border-rose-700/40 bg-rose-950/30 p-2 text-[11px] text-rose-200">
          {error}
        </p>
      )}

      {report && (
        <div className="rounded border border-emerald-700/30 bg-emerald-950/10 p-3 text-[11px]">
          <p className="font-semibold text-emerald-200">
            Scanned {report.scanned} · minted {report.minted} ·{" "}
            {report.errors > 0 ? (
              <span className="text-rose-200">errors {report.errors}</span>
            ) : (
              <span className="text-emerald-200">no errors</span>
            )}
          </p>
          {report.mintedDetails.length > 0 && (
            <details className="mt-2">
              <summary className="cursor-pointer text-emerald-200/80 hover:text-emerald-100">
                Show minted tokens ({report.mintedDetails.length})
              </summary>
              <table className="mt-2 w-full text-[10px]">
                <thead className="text-ink-400">
                  <tr>
                    <th className="text-left font-medium">User</th>
                    <th className="text-left font-medium">RFID UID</th>
                  </tr>
                </thead>
                <tbody>
                  {report.mintedDetails.map((d) => (
                    <tr
                      key={d.userId}
                      className="border-t border-emerald-700/20"
                    >
                      <td className="py-1 font-mono text-ink-200">{d.email}</td>
                      <td className="py-1 font-mono text-emerald-100">
                        {d.value}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          )}
          {report.errorDetails.length > 0 && (
            <details className="mt-2">
              <summary className="cursor-pointer text-rose-200/80 hover:text-rose-100">
                Show errors ({report.errorDetails.length})
              </summary>
              <ul className="mt-2 space-y-1">
                {report.errorDetails.map((e) => (
                  <li key={e.userId} className="text-rose-200">
                    <span className="font-mono">{e.email}</span> — {e.error}
                  </li>
                ))}
              </ul>
            </details>
          )}
          {report.scanned === 0 && (
            <p className="mt-1 text-ink-400">
              Every existing user already has at least one token. Nothing to do.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
