"use client";

// New-cost-factor form. Pilot codes are shown as suggestions in the code
// input (datalist). Any valid code matching ^[A-Z][A-Z0-9_]{2,11}$ is
// accepted — pilot scope is a UI narrowing only.
//
// Sprint 9 — Track A.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api-client";

// Pilot-scope codes shown as datalist suggestions. Match PILOT_FACTOR_CODES
// in apps/api/src/lib/billing/pilot-scope.ts.
// TODO: when extending past pilot, expand this list or remove the datalist
// filter so all 15 catalog codes are suggested.
const PILOT_CODE_SUGGESTIONS = [
  "USRF",
  "INT",
  "DSO",
  "MTR",
  "ELE",
  "TRF_CHG",
  "TRF_IDLE",
];

const ANCHOR_TIERS = [
  { value: "org", label: "Organisation" },
  { value: "property", label: "Property" },
  { value: "site", label: "Site  (DSO-level)" },
  { value: "installation", label: "Installation  (retailer-level)" },
  { value: "circuit", label: "Circuit" },
  { value: "charger", label: "Charger" },
  { value: "driver_contract", label: "Driver contract" },
] as const;

type AnchorTier = (typeof ANCHOR_TIERS)[number]["value"];

export function NewCostFactorForm() {
  const router = useRouter();

  const [code, setCode] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [description, setDescription] = useState("");
  const [anchorTier, setAnchorTier] = useState<AnchorTier>("installation");
  const [defaultVatRatePct, setDefaultVatRatePct] = useState("24");
  const [defaultCurrency, setDefaultCurrency] = useState("ISK");
  const [status, setStatus] = useState<"draft" | "active">("active");

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await apiFetch("/api/admin/billing/cost-factors", {
        method: "POST",
        body: JSON.stringify({
          code: code.trim().toUpperCase(),
          displayName: displayName.trim(),
          description: description.trim() || null,
          anchorTier,
          defaultVatRatePct: parseFloat(defaultVatRatePct),
          defaultCurrency: defaultCurrency.trim().toUpperCase(),
          status,
        }),
      });
      if (!res.ok) {
        const b = (await res.json().catch(() => null)) as {
          error?: string;
          message?: string;
          issues?: { path: (string | number)[]; message: string }[];
        } | null;
        const msg =
          b?.issues?.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") ||
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

  const codeValid =
    code.length === 0 || /^[A-Z][A-Z0-9_]{2,11}$/.test(code.toUpperCase());

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <fieldset className="rounded border border-bg-border/60 p-3">
        <legend className="px-1 text-[10px] font-semibold uppercase tracking-brand text-ink-400">
          Identity (immutable once saved)
        </legend>
        <div className="grid gap-3 sm:grid-cols-2">
          {/* Code */}
          <div>
            <label
              htmlFor="cf-code"
              className="block text-[11px] font-semibold uppercase tracking-brand text-ink-400"
            >
              Code <span className="text-rose-400">*</span>
            </label>
            <input
              id="cf-code"
              list="pilot-codes"
              type="text"
              required
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="DSO"
              className={
                "mt-1 w-full rounded-md border bg-bg-base/50 px-3 py-2 font-mono text-sm text-ink-50 focus:border-sv-sky focus:outline-none " +
                (codeValid ? "border-bg-border" : "border-rose-600/60")
              }
            />
            <datalist id="pilot-codes">
              {PILOT_CODE_SUGGESTIONS.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
            {!codeValid && (
              <span className="mt-0.5 block text-[10px] text-rose-400">
                3–12 uppercase letters, digits, or underscores; must start with a
                letter.
              </span>
            )}
            <span className="mt-0.5 block text-[10px] text-ink-500">
              Pilot suggestions: {PILOT_CODE_SUGGESTIONS.join(", ")}. Any valid
              code is accepted.
            </span>
          </div>

          {/* Anchor tier */}
          <div>
            <label
              htmlFor="cf-anchor"
              className="block text-[11px] font-semibold uppercase tracking-brand text-ink-400"
            >
              Anchor tier <span className="text-rose-400">*</span>
            </label>
            <select
              id="cf-anchor"
              value={anchorTier}
              onChange={(e) => setAnchorTier(e.target.value as AnchorTier)}
              className="mt-1 w-full rounded-md border border-bg-border bg-bg-base/50 px-3 py-2 text-sm text-ink-50 focus:border-sv-sky focus:outline-none"
            >
              {ANCHOR_TIERS.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
            <span className="mt-0.5 block text-[10px] text-ink-500">
              Determines which entity FK links to this factor. Cannot be changed
              after creation.
            </span>
          </div>
        </div>
      </fieldset>

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
              placeholder="DSO grid-fee component, per kWh. Rate comes from the RateReference catalog."
              className="mt-1 w-full rounded-md border border-bg-border bg-bg-base/50 px-3 py-2 text-sm text-ink-50 focus:border-sv-sky focus:outline-none"
            />
          </div>
        </div>
      </fieldset>

      <fieldset className="rounded border border-bg-border/60 p-3">
        <legend className="px-1 text-[10px] font-semibold uppercase tracking-brand text-ink-400">
          Defaults
        </legend>
        <div className="grid gap-3 sm:grid-cols-3">
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
          <div>
            <label
              htmlFor="cf-status"
              className="block text-[11px] font-semibold uppercase tracking-brand text-ink-400"
            >
              Status
            </label>
            <select
              id="cf-status"
              value={status}
              onChange={(e) => setStatus(e.target.value as "draft" | "active")}
              className="mt-1 w-full rounded-md border border-bg-border bg-bg-base/50 px-3 py-2 text-sm text-ink-50 focus:border-sv-sky focus:outline-none"
            >
              <option value="active">Active</option>
              <option value="draft">Draft (not yet assignable)</option>
            </select>
          </div>
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
          disabled={
            submitting ||
            code.length === 0 ||
            displayName.length === 0 ||
            !codeValid
          }
          className="rounded-md bg-sv-sky/20 px-4 py-2 text-sm font-medium text-sv-sky ring-1 ring-sv-sky/30 transition-colors hover:bg-sv-sky/30 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {submitting ? "Creating…" : "Create cost factor"}
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
