"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api-client";

/**
 * Per-installation OCPP-Authorize enforce toggle.
 *
 * Sprint 4 milestone 4.6. When enforced, the OCPP gateway honours the
 * verdict from /api/internal/ocpp-authorize on every Authorize.req
 * (and StartTransaction.req) — only seeded RFIDs charge. When in
 * shadow mode, the gateway logs the verdict for observability but
 * always replies Accepted (today's safe default).
 *
 * Flipping to enforced is the operationally-impactful step. The
 * confirm dialog warns against flipping before the IdToken table is
 * verified seeded (which is what the dashboard backfill button does
 * for pre-existing users). Flipping back to shadow is reversible
 * with no customer impact.
 */
export function EnforceAuthorizeToggle({
  installationId,
  initialEnforce,
}: {
  installationId: string;
  initialEnforce: boolean;
}) {
  const router = useRouter();
  const [enforce, setEnforce] = useState(initialEnforce);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function flip(target: boolean) {
    if (busy || target === enforce) return;
    if (target === true) {
      const ok = confirm(
        "Flip this installation to ENFORCED? With auth required, only RFIDs that exist in identity.id_tokens with status='active' will charge. Verify the dashboard backfill ran AND every operator-known card has a row before continuing.",
      );
      if (!ok) return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch(
        `/api/admin/installations/${installationId}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ enforceAuthorize: target }),
        },
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as
          | { error?: string }
          | null;
        throw new Error(body?.error ?? `HTTP ${res.status}`);
      }
      setEnforce(target);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const isShadow = !enforce;

  return (
    <section
      className={
        "mt-8 rounded-lg border p-4 " +
        (isShadow
          ? "border-emerald-700/30 bg-emerald-950/10"
          : "border-amber-700/30 bg-amber-950/10")
      }
    >
      <header className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-ink-50">
            OCPP-Authorize mode ·{" "}
            {isShadow ? (
              <span className="text-emerald-300">shadow</span>
            ) : (
              <span className="text-amber-300">enforced</span>
            )}
          </h2>
          <p className="mt-1 text-xs text-ink-300">
            {isShadow
              ? "Gateway logs every verdict but always replies Accepted to the charger. Customer charging is unaffected by RFID seeding."
              : "Gateway honours the verdict — Accepted | Blocked | Expired | Invalid. Only RFIDs with active IdToken rows charge."}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => flip(false)}
            disabled={busy || isShadow}
            className={
              "rounded-md px-3 py-1.5 text-xs font-medium ring-1 " +
              (isShadow
                ? "bg-emerald-500/20 text-emerald-100 ring-emerald-500/40"
                : "border-bg-border text-ink-300 hover:bg-bg-base/50")
            }
          >
            Shadow
          </button>
          <button
            type="button"
            onClick={() => flip(true)}
            disabled={busy || !isShadow}
            className={
              "rounded-md px-3 py-1.5 text-xs font-medium ring-1 " +
              (!isShadow
                ? "bg-amber-500/20 text-amber-100 ring-amber-500/40"
                : "border-bg-border text-ink-300 hover:bg-bg-base/50")
            }
          >
            Enforce
          </button>
        </div>
      </header>
      {error && (
        <p className="mt-3 rounded border border-rose-700/40 bg-rose-950/30 p-2 text-[11px] text-rose-200">
          {error}
        </p>
      )}
      <p className="mt-3 text-[10px] text-ink-500">
        Flipping to enforced is reversible — toggle back to shadow at
        any time without customer impact. Sprint 4 / ADR 0014 milestone
        4.6.
      </p>
    </section>
  );
}
