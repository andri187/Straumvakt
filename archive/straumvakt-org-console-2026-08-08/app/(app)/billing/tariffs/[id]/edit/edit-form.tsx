"use client";
// EditTariffForm — client component for /billing/tariffs/[id]/edit.
// Sprint 9 — Track C.
//
// When isActiveOnly = true, only displayName is shown/editable (Rule 5).
// When isActiveOnly = false (draft), all pilot-scope fields are editable.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api-client";

// Pilot-scope compute rule kinds. Keep in sync with
// apps/api/src/lib/billing/tariff-zod.ts PILOT_COMPUTE_RULE_KINDS.
const PILOT_RULE_KINDS = [
  { value: "flat_per_kwh", label: "Flat per kWh" },
  { value: "flat_per_session", label: "Flat per session" },
] as const;

type PilotRuleKind = (typeof PILOT_RULE_KINDS)[number]["value"];

const KNOWN_PILOT_KINDS = new Set<string>(["flat_per_kwh", "flat_per_session"]);

interface TariffHeader {
  id: string;
  displayName: string;
  currency: string;
  vatRatePct: string;
  computeRule: Record<string, unknown>;
  computeRuleKind: string | null;
  pricePerKwhMinor: string | null;
  costFactorId: string;
  status: string;
}

export function EditTariffForm({
  tariff,
  factorOptions,
  isActiveOnly,
}: {
  tariff: TariffHeader;
  factorOptions: { id: string; label: string; vat: string }[];
  isActiveOnly: boolean;
}) {
  const router = useRouter();

  const initialRuleKind = (
    tariff.computeRuleKind &&
    KNOWN_PILOT_KINDS.has(tariff.computeRuleKind)
      ? tariff.computeRuleKind
      : "flat_per_kwh"
  ) as PilotRuleKind;

  const initialPricePerKwh =
    tariff.computeRuleKind === "flat_per_kwh"
      ? ((tariff.computeRule?.pricePerKwhMinor as string | undefined) ??
          tariff.pricePerKwhMinor ??
          "")
      : "";

  const initialPriceSession =
    tariff.computeRuleKind === "flat_per_session"
      ? ((tariff.computeRule?.priceMinor as string | undefined) ?? "")
      : "";

  const unknownRuleKind =
    tariff.computeRuleKind !== null &&
    !KNOWN_PILOT_KINDS.has(tariff.computeRuleKind);

  const [displayName, setDisplayName] = useState(tariff.displayName);
  const [costFactorId, setCostFactorId] = useState(tariff.costFactorId);
  const [ruleKind, setRuleKind] = useState<PilotRuleKind>(initialRuleKind);
  const [pricePerKwhMinor, setPricePerKwhMinor] = useState(initialPricePerKwh);
  const [priceMinor, setPriceMinor] = useState(initialPriceSession);
  const [vatRatePct, setVatRatePct] = useState(tariff.vatRatePct);
  const [currency, setCurrency] = useState(tariff.currency);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function buildComputeRule(): Record<string, unknown> {
    if (ruleKind === "flat_per_kwh") {
      return { kind: "flat_per_kwh", pricePerKwhMinor };
    }
    return { kind: "flat_per_session", priceMinor };
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const body: Record<string, unknown> = { displayName };
      if (!isActiveOnly) {
        body.costFactorId = costFactorId;
        body.currency = currency;
        body.vatRatePct = vatRatePct;
        if (!unknownRuleKind) {
          body.computeRule = buildComputeRule();
        }
      }
      const res = await apiFetch(
        `/api/admin/billing/tariffs-mgmt/${tariff.id}`,
        { method: "PATCH", body: JSON.stringify(body) },
      );
      if (!res.ok) {
        const b = (await res.json().catch(() => null)) as {
          error?: string;
          suggestion?: string;
          issues?: { path: (string | number)[]; message: string }[];
        } | null;
        const msg =
          b?.issues
            ?.map((i) => `${i.path.join(".")}: ${i.message}`)
            .join("; ") ||
          (b?.error === "active_immutable"
            ? "Active tariff: only display name may be changed. Clone to create an editable draft."
            : b?.error) ||
          `HTTP ${res.status}`;
        throw new Error(msg);
      }
      router.push(`/billing/tariffs/${tariff.id}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  const priceValid = isActiveOnly
    ? true
    : ruleKind === "flat_per_kwh"
      ? /^\d+$/.test(pricePerKwhMinor)
      : /^\d+$/.test(priceMinor);

  const valid = displayName.length > 0 && priceValid;

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {/* Unknown rule-kind banner */}
      {!isActiveOnly && unknownRuleKind && (
        <div className="rounded border border-amber-700/30 bg-amber-950/20 p-3 text-xs text-amber-200">
          Compute rule kind{" "}
          <span className="font-mono text-amber-300">
            {tariff.computeRuleKind}
          </span>{" "}
          is not yet editable in the UI. The current rule will be preserved.
          Use a seed script to change the rule shape.
          <pre className="mt-2 overflow-x-auto rounded bg-bg-inset/60 p-2 font-mono text-[10px] text-ink-300">
            {JSON.stringify(tariff.computeRule, null, 2)}
          </pre>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        {/* Display name — editable for both draft and active */}
        <TextField
          label="Display name"
          required
          value={displayName}
          onChange={setDisplayName}
          placeholder="Veitur AD1"
          className="sm:col-span-2"
        />

        {/* Draft-only fields */}
        {!isActiveOnly && (
          <>
            <SelectField
              label="Cost factor"
              value={costFactorId}
              onChange={setCostFactorId}
              options={factorOptions.map((f) => ({
                value: f.id,
                label: f.label,
              }))}
            />

            <TextField
              label="VAT rate %"
              value={vatRatePct}
              onChange={setVatRatePct}
              placeholder="24.00"
              mono
            />

            <TextField
              label="Currency (ISO)"
              value={currency}
              onChange={(v) => setCurrency(v.toUpperCase().slice(0, 3))}
              placeholder="ISK"
              mono
            />

            {!unknownRuleKind && (
              <>
                <div className="sm:col-span-2">
                  <p className="mb-2 text-[11px] font-semibold uppercase tracking-brand text-ink-400">
                    Compute rule kind
                  </p>
                  <div className="flex gap-3">
                    {PILOT_RULE_KINDS.map((k) => (
                      <label
                        key={k.value}
                        className="flex cursor-pointer items-center gap-1.5 rounded border border-bg-border px-3 py-2 text-xs text-ink-200 hover:bg-bg-base/40"
                      >
                        <input
                          type="radio"
                          name="ruleKind"
                          value={k.value}
                          checked={ruleKind === k.value}
                          onChange={() => setRuleKind(k.value)}
                          className="h-3 w-3"
                        />
                        <span className="font-mono">{k.label}</span>
                      </label>
                    ))}
                  </div>
                </div>

                {ruleKind === "flat_per_kwh" && (
                  <TextField
                    label="Price per kWh (minor units, e.g. 86400 = 864,00 kr)"
                    required
                    value={pricePerKwhMinor}
                    onChange={setPricePerKwhMinor}
                    placeholder="86400"
                    mono
                  />
                )}

                {ruleKind === "flat_per_session" && (
                  <TextField
                    label="Price per session (minor units)"
                    required
                    value={priceMinor}
                    onChange={setPriceMinor}
                    placeholder="100000"
                    mono
                  />
                )}
              </>
            )}
          </>
        )}
      </div>

      {error && (
        <div className="rounded border border-rose-700/40 bg-rose-950/30 p-2 text-xs text-rose-200">
          {error}
        </div>
      )}

      <div className="flex gap-3">
        <button
          type="submit"
          disabled={submitting || !valid}
          className="rounded-md bg-sv-green/20 px-4 py-2 text-sm font-medium text-sv-green ring-1 ring-sv-green/30 transition-colors hover:bg-sv-green/30 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {submitting ? "Saving…" : "Save changes"}
        </button>
        <a
          href={`/billing/tariffs/${tariff.id}`}
          className="rounded-md px-4 py-2 text-sm font-medium text-ink-400 hover:text-ink-200"
        >
          Cancel
        </a>
      </div>
    </form>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function TextField({
  label,
  required,
  value,
  onChange,
  placeholder,
  mono,
  className,
}: {
  label: string;
  required?: boolean;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  mono?: boolean;
  className?: string;
}) {
  return (
    <label className={`block ${className ?? ""}`}>
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
    </label>
  );
}

function SelectField({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <label className="block">
      <span className="block text-[11px] font-semibold uppercase tracking-brand text-ink-400">
        {label}
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
