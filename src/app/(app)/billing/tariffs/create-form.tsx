"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const RULE_KINDS = [
  "per_kwh",
  "per_session_flat",
  "per_minute_after_minutes",
  "percent_of_factors",
  "per_calendar_month_flat",
  "per_day_flat",
] as const;

export function CreateTariffForm({
  orgOptions,
  factorOptions,
}: {
  orgOptions: { id: string; label: string }[];
  factorOptions: { id: string; label: string; vat: string }[];
}) {
  const router = useRouter();
  const [orgId, setOrgId] = useState(orgOptions[0]?.id ?? "");
  const [costFactorId, setCostFactorId] = useState(factorOptions[0]?.id ?? "");
  const [displayName, setDisplayName] = useState("");
  const [ruleKind, setRuleKind] = useState<typeof RULE_KINDS[number]>("per_kwh");
  const [amountMinor, setAmountMinor] = useState("");
  const [thresholdMinutes, setThresholdMinutes] = useState("");
  const [percent, setPercent] = useState("");
  const [factorCodes, setFactorCodes] = useState("");
  const [vatRatePct, setVatRatePct] = useState("24");
  const [currency, setCurrency] = useState("ISK");
  const [validFrom, setValidFrom] = useState(new Date().toISOString().slice(0, 10));
  const [validUntil, setValidUntil] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function buildComputeRule(): Record<string, unknown> {
    const r: Record<string, unknown> = { kind: ruleKind };
    if (amountMinor) r.amountMinor = Number(amountMinor);
    if (thresholdMinutes) r.thresholdMinutes = Number(thresholdMinutes);
    if (percent) r.percent = Number(percent);
    if (factorCodes) r.factorCodes = factorCodes.split(",").map((s) => s.trim()).filter(Boolean);
    return r;
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); setError(null); setSubmitting(true);
    try {
      const res = await fetch("/api/admin/tariffs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          orgId, costFactorId, displayName,
          computeRule: buildComputeRule(),
          vatRatePct: Number(vatRatePct),
          currency,
          validFrom,
          validUntil: validUntil || undefined,
        }),
      });
      if (!res.ok) {
        const b = (await res.json().catch(() => null)) as { error?: string; issues?: { path: (string | number)[]; message: string }[] } | null;
        throw new Error(b?.issues?.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") || b?.error || `HTTP ${res.status}`);
      }
      setDisplayName(""); setAmountMinor(""); setThresholdMinutes(""); setPercent(""); setFactorCodes("");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally { setSubmitting(false); }
  }

  const valid = orgId && costFactorId && displayName.length > 0 && validFrom.length === 10;

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <Select label="Organization" required value={orgId} onChange={setOrgId} options={orgOptions.map((o) => ({ value: o.id, label: o.label }))} />
      <Select label="Cost factor" required value={costFactorId} onChange={setCostFactorId} options={factorOptions.map((f) => ({ value: f.id, label: f.label }))} />
      <Field label="Display name" required value={displayName} onChange={setDisplayName} placeholder="ON DSO Reykjavík" />
      <Select label="Compute rule kind" required value={ruleKind} onChange={(v) => setRuleKind(v as typeof RULE_KINDS[number])} options={RULE_KINDS.map((k) => ({ value: k, label: k }))} />
      {(ruleKind === "per_kwh" || ruleKind === "per_session_flat" || ruleKind === "per_calendar_month_flat" || ruleKind === "per_day_flat" || ruleKind === "per_minute_after_minutes") && (
        <Field label="Amount (minor units)" value={amountMinor} onChange={setAmountMinor} mono placeholder="aurar / 100=ISK 1" />
      )}
      {ruleKind === "per_minute_after_minutes" && (
        <Field label="Threshold minutes" value={thresholdMinutes} onChange={setThresholdMinutes} mono placeholder="60" />
      )}
      {ruleKind === "percent_of_factors" && (
        <>
          <Field label="Percent" value={percent} onChange={setPercent} mono placeholder="25" />
          <Field label="Factor codes (comma-separated)" value={factorCodes} onChange={setFactorCodes} mono placeholder="DSOF,REPF" />
        </>
      )}
      <Field label="VAT rate %" value={vatRatePct} onChange={setVatRatePct} mono />
      <Field label="Currency" value={currency} onChange={(v) => setCurrency(v.toUpperCase().slice(0, 3))} mono />
      <Field label="Valid from (YYYY-MM-DD)" required value={validFrom} onChange={setValidFrom} mono />
      <Field label="Valid until (YYYY-MM-DD, optional)" value={validUntil} onChange={setValidUntil} mono />

      {error && <div className="rounded border border-rose-700/40 bg-rose-950/30 p-2 text-xs text-rose-200">{error}</div>}
      <button type="submit" disabled={submitting || !valid} className="w-full rounded-md bg-sv-green/20 px-3 py-2 text-sm font-medium text-sv-green ring-1 ring-sv-green/30 hover:bg-sv-green/30 disabled:cursor-not-allowed disabled:opacity-40">
        {submitting ? "Creating…" : "Create tariff"}
      </button>
    </form>
  );
}

function Field({ label, required, value, onChange, placeholder, mono }: { label: string; required?: boolean; value: string; onChange: (v: string) => void; placeholder?: string; mono?: boolean }) {
  return <label className="block"><span className="block text-[11px] font-semibold uppercase tracking-brand text-ink-400">{label}{required && <span className="ml-0.5 text-rose-400">*</span>}</span><input type="text" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className={"mt-1 w-full rounded-md border border-bg-border bg-bg-base/50 px-3 py-2 text-sm text-ink-50 focus:border-sv-sky focus:outline-none " + (mono ? "font-mono" : "")} /></label>;
}
function Select({ label, required, value, onChange, options }: { label: string; required?: boolean; value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) {
  return <label className="block"><span className="block text-[11px] font-semibold uppercase tracking-brand text-ink-400">{label}{required && <span className="ml-0.5 text-rose-400">*</span>}</span><select value={value} onChange={(e) => onChange(e.target.value)} className="mt-1 w-full rounded-md border border-bg-border bg-bg-base/50 px-3 py-2 text-sm text-ink-50 focus:border-sv-sky focus:outline-none">{options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select></label>;
}
