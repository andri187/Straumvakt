"use client";
// CreateTariffForm — client component for /billing/tariffs/new.
// Sprint 9 — Track C.
//
// Pilot compute rule kinds: flat_per_kwh, flat_per_session.
// These match the Zod schemas in apps/api/src/lib/billing/tariff-zod.ts.
// If an unrecognized kind is needed, use a seed script instead.

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

export function CreateTariffForm({
  orgOptions,
  factorOptions,
}: {
  orgOptions: { id: string; label: string }[];
  factorOptions: { id: string; label: string; vat: string; anchor: string }[];
}) {
  const router = useRouter();

  const [orgId, setOrgId] = useState(orgOptions[0]?.id ?? "");
  const [costFactorId, setCostFactorId] = useState(factorOptions[0]?.id ?? "");
  const [displayName, setDisplayName] = useState("");
  const [ruleKind, setRuleKind] = useState<PilotRuleKind>("flat_per_kwh");
  const [pricePerKwhMinor, setPricePerKwhMinor] = useState("");
  const [priceMinor, setPriceMinor] = useState("");
  const [vatRatePct, setVatRatePct] = useState("24.00");
  const [currency, setCurrency] = useState("ISK");
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
      const res = await apiFetch("/api/admin/billing/tariffs-mgmt", {
        method: "POST",
        body: JSON.stringify({
          orgId,
          costFactorId,
          displayName,
          currency,
          vatRatePct,
          computeRule: buildComputeRule(),
        }),
      });
      if (!res.ok) {
        const b = (await res.json().catch(() => null)) as {
          error?: string;
          issues?: { path: (string | number)[]; message: string }[];
        } | null;
        throw new Error(
          b?.issues
            ?.map((i) => `${i.path.join(".")}: ${i.message}`)
            .join("; ") ||
            b?.error ||
            `HTTP ${res.status}`,
        );
      }
      const data = (await res.json()) as { tariff: { id: string } };
      router.push(`/billing/tariffs/${data.tariff.id}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  const priceValid =
    ruleKind === "flat_per_kwh"
      ? /^\d+$/.test(pricePerKwhMinor)
      : /^\d+$/.test(priceMinor);

  const valid =
    orgId.length > 0 &&
    costFactorId.length > 0 &&
    displayName.length > 0 &&
    priceValid;

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField
          label="Organization"
          required
          value={orgId}
          onChange={setOrgId}
          options={orgOptions.map((o) => ({ value: o.id, label: o.label }))}
        />

        <SelectField
          label="Cost factor"
          required
          value={costFactorId}
          onChange={setCostFactorId}
          options={factorOptions.map((f) => ({ value: f.id, label: f.label }))}
        />

        <TextField
          label="Display name"
          required
          value={displayName}
          onChange={setDisplayName}
          placeholder="Veitur AD1"
          className="sm:col-span-2"
        />

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
      </div>

      <div className="rounded border border-sv-sky/20 bg-sv-sky/5 p-3 text-xs text-sv-sky">
        New tariff will be created as a <strong>draft</strong>. Use the Publish
        action on the detail page to activate it.
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
          {submitting ? "Creating…" : "Create draft tariff"}
        </button>
        <a
          href="/billing/tariffs"
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
