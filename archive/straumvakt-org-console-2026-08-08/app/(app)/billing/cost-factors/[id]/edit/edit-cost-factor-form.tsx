"use client";

// Edit form for an existing billing.cost_factors row.
//
// Editable: displayName, description, defaultVatRatePct, defaultCurrency.
// Read-only (shown for context): code, anchorTier, status.
// Status changes (deactivate / reactivate) are handled from the catalogue
// page, not here.
//
// Sprint 9 — Track A.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api-client";

interface CostFactorRow {
  id: string;
  code: string;
  displayName: string;
  description: string | null;
  anchorTier: string;
  defaultVatRatePct: string;
  defaultCurrency: string;
  status: string;
  tariffCount: number;
  isOrphan: boolean;
}

export function EditCostFactorForm({ factor }: { factor: CostFactorRow }) {
  const router = useRouter();

  const [displayName, setDisplayName] = useState(factor.displayName);
  const [description, setDescription] = useState(factor.description ?? "");
  const [defaultVatRatePct, setDefaultVatRatePct] = useState(
    factor.defaultVatRatePct,
  );
  const [defaultCurrency, setDefaultCurrency] = useState(
    factor.defaultCurrency,
  );

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await apiFetch(
        `/api/admin/billing/cost-factors/${factor.id}`,
        {
          method: "PATCH",
          body: JSON.stringify({
            displayName: displayName.trim(),
            description: description.trim() || null,
            defaultVatRatePct: parseFloat(defaultVatRatePct),
            defaultCurrency: defaultCurrency.trim().toUpperCase(),
          }),
        },
      );
      if (!res.ok) {
        const b = (await res.json().catch(() => null)) as {
          error?: string;
          message?: string;
          issues?: { path: (string | number)[]; message: string }[];
        } | null;
        const msg =
          b?.issues
            ?.map((i) => `${i.path.join(".")}: ${i.message}`)
            .join("; ") ||
          b?.message ||
          b?.error ||
          `HTTP ${res.status}`;
        throw new Error(msg);
      }
      router.push("/billing/cost-factors");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {/* Read-only identity context */}
      <div className="grid gap-3 rounded border border-bg-border/40 bg-bg-inset/20 p-3 sm:grid-cols-2">
        <ReadOnlyField label="Code (immutable)" value={factor.code} mono />
        <ReadOnlyField
          label="Anchor tier (immutable)"
          value={anchorLabel(factor.anchorTier)}
        />
      </div>

      <fieldset className="rounded border border-bg-border/60 p-3">
        <legend className="px-1 text-[10px] font-semibold uppercase tracking-brand text-ink-400">
          Display
        </legend>
        <div className="space-y-3">
          <Field
            id="cf-display-name"
            label="Display name"
            required
            value={displayName}
            onChange={setDisplayName}
            placeholder="DSO grid fee"
          />
          <div>
            <label
              htmlFor="cf-description"
              className="block text-[11px] font-semibold uppercase tracking-brand text-ink-400"
            >
              Description
            </label>
            <textarea
              id="cf-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              placeholder="DSO grid-fee component, per kWh."
              className="mt-1 w-full rounded-md border border-bg-border bg-bg-base/50 px-3 py-2 text-sm text-ink-50 focus:border-sv-sky focus:outline-none"
            />
          </div>
        </div>
      </fieldset>

      <fieldset className="rounded border border-bg-border/60 p-3">
        <legend className="px-1 text-[10px] font-semibold uppercase tracking-brand text-ink-400">
          Defaults
        </legend>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            id="cf-vat"
            label="Default VAT %"
            required
            value={defaultVatRatePct}
            onChange={setDefaultVatRatePct}
            placeholder="24"
            mono
            hint="Iceland standard rate is 24 %"
          />
          <Field
            id="cf-currency"
            label="Default currency"
            required
            value={defaultCurrency}
            onChange={(v) => setDefaultCurrency(v.toUpperCase().slice(0, 3))}
            placeholder="ISK"
            mono
            hint="3-char ISO 4217"
          />
        </div>
      </fieldset>

      {error && (
        <div className="rounded border border-rose-700/40 bg-rose-950/30 p-2 text-xs text-rose-200">
          {error}
        </div>
      )}

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={submitting || displayName.trim().length === 0}
          className="rounded-md bg-sv-sky/20 px-4 py-2 text-sm font-medium text-sv-sky ring-1 ring-sv-sky/30 transition-colors hover:bg-sv-sky/30 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {submitting ? "Saving…" : "Save changes"}
        </button>
        <a
          href="/billing/cost-factors"
          className="rounded-md border border-bg-border px-4 py-2 text-sm text-ink-300 hover:bg-bg-base/50"
        >
          Cancel
        </a>
      </div>
    </form>
  );
}

function anchorLabel(tier: string): string {
  switch (tier) {
    case "org":
      return "Organisation";
    case "property":
      return "Property";
    case "site":
      return "Site  (DSO-level)";
    case "installation":
      return "Installation  (retailer-level)";
    case "circuit":
      return "Circuit";
    case "charger":
      return "Charger";
    case "driver_contract":
      return "Driver contract";
    default:
      return tier;
  }
}

function ReadOnlyField({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div>
      <span className="block text-[11px] font-semibold uppercase tracking-brand text-ink-500">
        {label}
      </span>
      <p
        className={
          "mt-1 rounded-md border border-bg-border/40 bg-bg-inset/40 px-3 py-2 text-sm text-ink-400 " +
          (mono ? "font-mono" : "")
        }
      >
        {value}
      </p>
    </div>
  );
}

function Field({
  id,
  label,
  required,
  hint,
  value,
  onChange,
  placeholder,
  mono,
}: {
  id: string;
  label: string;
  required?: boolean;
  hint?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  mono?: boolean;
}) {
  return (
    <label htmlFor={id} className="block">
      <span className="block text-[11px] font-semibold uppercase tracking-brand text-ink-400">
        {label}
        {required && <span className="ml-0.5 text-rose-400">*</span>}
      </span>
      <input
        id={id}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={
          "mt-1 w-full rounded-md border border-bg-border bg-bg-base/50 px-3 py-2 text-sm text-ink-50 focus:border-sv-sky focus:outline-none " +
          (mono ? "font-mono" : "")
        }
      />
      {hint && (
        <span className="mt-0.5 block text-[10px] text-ink-500">{hint}</span>
      )}
    </label>
  );
}
