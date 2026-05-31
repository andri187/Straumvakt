"use client";

// Stage-new-version form for RateReference.
//
// Submits to POST /api/admin/billing/rate-references.
//
// Key Rule 5 constraints:
//   - If an active row exists for the same code, effectiveFrom MUST be in the
//     future so the API can auto-close the current row.
//   - price (priceMinor), basis, and effectiveFrom are permanently set on create.
//     To change them, stage another new version.
//
// Phase 4 will add a pattern_json section here for ToD restrictions.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api-client";

const BASIS_OPTIONS = [
  { value: "per_kwh", label: "per kWh (energy)" },
  { value: "per_minute", label: "per minute (time)" },
  { value: "per_day", label: "per day (standing)" },
  { value: "per_session", label: "per session (flat)" },
] as const;

export function StageNewVersionForm({
  factorOptions,
  prefillCode,
  prefillCostFactorId,
}: {
  factorOptions: { id: string; label: string }[];
  prefillCode: string;
  prefillCostFactorId: string;
}) {
  const router = useRouter();
  const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);

  const [code, setCode] = useState(prefillCode);
  const [costFactorId, setCostFactorId] = useState(
    prefillCostFactorId || (factorOptions[0]?.id ?? ""),
  );
  const [costFactorIdManual, setCostFactorIdManual] = useState(
    factorOptions.length === 0 ? prefillCostFactorId : "",
  );
  const [supplierOrgId, setSupplierOrgId] = useState("");
  const [basis, setBasis] = useState<"per_kwh" | "per_minute" | "per_day" | "per_session">(
    "per_kwh",
  );
  const [priceMinorStr, setPriceMinorStr] = useState("");
  const [currency, setCurrency] = useState("ISK");
  const [vatRatePct, setVatRatePct] = useState("24.00");
  const [effectiveFrom, setEffectiveFrom] = useState(tomorrow);
  const [effectiveUntil, setEffectiveUntil] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const resolvedCostFactorId =
    factorOptions.length > 0 ? costFactorId : costFactorIdManual;

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await apiFetch("/api/admin/billing/rate-references", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          code: code.trim(),
          costFactorId: resolvedCostFactorId,
          supplierOrgId: supplierOrgId.trim() || null,
          basis,
          priceMinorStr: priceMinorStr.trim(),
          currency: currency.toUpperCase().slice(0, 3),
          vatRatePct,
          effectiveFrom,
          effectiveUntil: effectiveUntil || null,
          notes: notes.trim() || null,
        }),
      });
      if (!res.ok) {
        const b = (await res.json().catch(() => null)) as {
          error?: string;
          message?: string;
          issues?: { path: (string | number)[]; message: string }[];
        } | null;
        throw new Error(
          b?.issues?.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") ||
            b?.message ||
            b?.error ||
            `HTTP ${res.status}`,
        );
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      router.push("/billing/rate-references" as any);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  const valid =
    code.trim().length > 0 &&
    resolvedCostFactorId.length > 0 &&
    /^\d+$/.test(priceMinorStr.trim()) &&
    effectiveFrom.length === 10;

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field
          label="Rate code"
          required
          value={code}
          onChange={setCode}
          mono
          placeholder="veitur-dso-c"
          hint="Stable identifier shared across versions. Use kebab-case."
        />

        {factorOptions.length > 0 ? (
          <Select
            label="Cost factor"
            required
            value={costFactorId}
            onChange={setCostFactorId}
            options={factorOptions.map((f) => ({ value: f.id, label: f.label }))}
          />
        ) : (
          <Field
            label="Cost factor UUID"
            required
            value={costFactorIdManual}
            onChange={setCostFactorIdManual}
            mono
            placeholder="UUID from agreements.cost_factors"
            hint="No seeded factors found — paste UUID directly."
          />
        )}

        <Select
          label="Rate basis"
          required
          value={basis}
          onChange={(v) => setBasis(v as typeof basis)}
          options={BASIS_OPTIONS.map((b) => ({ value: b.value, label: b.label }))}
        />

        <Field
          label="Price (minor units)"
          required
          value={priceMinorStr}
          onChange={setPriceMinorStr}
          mono
          placeholder="86400  (= 864.00 kr)"
          hint="Integer in aurar. 864.00 kr = 86400."
        />

        <Field
          label="Currency"
          value={currency}
          onChange={(v) => setCurrency(v.toUpperCase().slice(0, 3))}
          mono
          placeholder="ISK"
        />

        <Field
          label="VAT rate %"
          value={vatRatePct}
          onChange={setVatRatePct}
          mono
          placeholder="24.00"
        />

        <Field
          label="Effective from (YYYY-MM-DD)"
          required
          value={effectiveFrom}
          onChange={setEffectiveFrom}
          mono
          hint="Must be a future date if a currently-active row exists for this code."
        />

        <Field
          label="Effective until (YYYY-MM-DD, optional)"
          value={effectiveUntil}
          onChange={setEffectiveUntil}
          mono
          hint="Leave empty for open-ended."
        />

        <Field
          label="Supplier org UUID (optional)"
          value={supplierOrgId}
          onChange={setSupplierOrgId}
          mono
          placeholder="UUID of the DSO or retailer org"
        />
      </div>

      <div>
        <span className="block text-[11px] font-semibold uppercase tracking-brand text-ink-400">
          Notes (optional)
        </span>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
          placeholder="e.g. Veitur DSO C-zone Q3 2026 rate, effective 2026-10-01"
          className="mt-1 w-full rounded-md border border-bg-border bg-bg-base/50 px-3 py-2 text-sm text-ink-50 focus:border-sv-sky focus:outline-none"
        />
      </div>

      {error && (
        <div className="rounded border border-rose-700/40 bg-rose-950/30 p-2 text-xs text-rose-200">
          {error}
        </div>
      )}

      <button
        type="submit"
        disabled={submitting || !valid}
        className="rounded-md bg-sv-green/20 px-4 py-2 text-sm font-medium text-sv-green ring-1 ring-sv-green/30 hover:bg-sv-green/30 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {submitting ? "Staging…" : "Stage version"}
      </button>
    </form>
  );
}

function Field({
  label,
  required,
  hint,
  value,
  onChange,
  placeholder,
  mono,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  mono?: boolean;
}) {
  return (
    <label className="block">
      <span className="block text-[11px] font-semibold uppercase tracking-brand text-ink-400">
        {label}
        {required && <span className="ml-0.5 text-rose-400">*</span>}
      </span>
      <input
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

function Select({
  label,
  required,
  value,
  onChange,
  options,
}: {
  label: string;
  required?: boolean;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <label className="block">
      <span className="block text-[11px] font-semibold uppercase tracking-brand text-ink-400">
        {label}
        {required && <span className="ml-0.5 text-rose-400">*</span>}
      </span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full rounded-md border border-bg-border bg-bg-base/50 px-3 py-2 text-sm text-ink-50 focus:border-sv-sky focus:outline-none"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
