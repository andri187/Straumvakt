"use client";
// Action buttons for the TariffDefinition detail page.
// Sprint 9 — Track C.
//
// Edit:    navigate to /billing/tariffs/[id]/edit
//          (shown for draft + active; active shows status gate)
// Clone:   POST .../clone → navigate to new draft
// Publish: POST .../publish → refresh
// Retire:  POST .../retire → refresh (with warning if bindings exist)
//
// Rule 5: status transitions only via dedicated endpoints, never PATCH status.

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { apiFetch } from "@/lib/api-client";

export function TariffActionButtons({
  tariffId,
  status,
}: {
  tariffId: string;
  status: string;
}) {
  const router = useRouter();
  const [pending, setPending] = useState<
    "clone" | "publish" | "retire" | null
  >(null);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);

  async function doAction(action: "clone" | "publish" | "retire") {
    setError(null);
    setWarning(null);
    setPending(action);
    try {
      const res = await apiFetch(
        `/api/admin/billing/tariffs-mgmt/${tariffId}/${action}`,
        { method: "POST" },
      );
      const body = (await res.json().catch(() => null)) as {
        tariff?: { id: string };
        warning?: string | null;
        error?: string;
        message?: string;
      } | null;

      if (!res.ok) {
        throw new Error(body?.message ?? body?.error ?? `HTTP ${res.status}`);
      }

      if (action === "clone" && body?.tariff?.id) {
        router.push(
          `/billing/tariffs/${body.tariff.id}/edit` as Parameters<
            typeof router.push
          >[0],
        );
        router.refresh();
        return;
      }

      if (action === "retire" && body?.warning) {
        setWarning(body.warning);
      }

      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* Edit — available for draft and active (active shows limited fields) */}
      {(status === "draft" || status === "active") && (
        <Link
          href={`/billing/tariffs/${tariffId}/edit` as Parameters<typeof Link>[0]["href"]}
          className="rounded-md border border-bg-border bg-bg-base/40 px-3 py-1.5 text-xs font-medium text-ink-200 transition-colors hover:bg-bg-base/60 hover:text-ink-50"
        >
          {status === "active" ? "Edit name" : "Edit"}
        </Link>
      )}

      {/* Clone — always available */}
      <button
        onClick={() => doAction("clone")}
        disabled={pending !== null}
        className="rounded-md border border-sv-sky/30 bg-sv-sky/10 px-3 py-1.5 text-xs font-medium text-sv-sky transition-colors hover:bg-sv-sky/20 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {pending === "clone" ? "Cloning…" : "Clone to draft"}
      </button>

      {/* Publish — only for draft */}
      {status === "draft" && (
        <button
          onClick={() => doAction("publish")}
          disabled={pending !== null}
          className="rounded-md border border-emerald-700/40 bg-emerald-950/30 px-3 py-1.5 text-xs font-medium text-emerald-300 transition-colors hover:bg-emerald-950/50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pending === "publish" ? "Publishing…" : "Publish"}
        </button>
      )}

      {/* Retire — for draft and active */}
      {(status === "draft" || status === "active") && (
        <button
          onClick={() => {
            if (
              !confirm(
                status === "active"
                  ? "Retire this active tariff? Sessions after retirement will not find an active rate for anchored bindings."
                  : "Discard this draft tariff?",
              )
            ) {
              return;
            }
            void doAction("retire");
          }}
          disabled={pending !== null}
          className="rounded-md border border-rose-700/30 bg-rose-950/20 px-3 py-1.5 text-xs font-medium text-rose-300 transition-colors hover:bg-rose-950/40 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pending === "retire"
            ? "Retiring…"
            : status === "draft"
              ? "Discard draft"
              : "Retire"}
        </button>
      )}

      {/* Error */}
      {error && (
        <span className="rounded border border-rose-700/40 bg-rose-950/30 px-2 py-1 text-xs text-rose-200">
          {error}
        </span>
      )}

      {/* Warning (after retire with bindings) */}
      {warning && (
        <div className="w-full rounded border border-amber-700/40 bg-amber-950/30 px-3 py-2 text-xs text-amber-200">
          {warning}
        </div>
      )}
    </div>
  );
}
