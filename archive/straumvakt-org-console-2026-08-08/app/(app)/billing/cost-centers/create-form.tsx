"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api-client";

export function CreateCostCenterForm({ orgOptions }: { orgOptions: { id: string; label: string }[] }) {
  const router = useRouter();
  const [orgId, setOrgId] = useState(orgOptions[0]?.id ?? "");
  const [code, setCode] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [payerOrgId, setPayerOrgId] = useState("");
  const [payerUserId, setPayerUserId] = useState("");
  const [beneficiaryOrgId, setBeneficiaryOrgId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); setError(null); setSubmitting(true);
    try {
      const res = await apiFetch("/api/admin/cost-centers", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          orgId, code: code.toUpperCase(), displayName,
          payerOrgId: payerOrgId || undefined,
          payerUserId: payerUserId || undefined,
          beneficiaryOrgId: beneficiaryOrgId || undefined,
        }),
      });
      if (!res.ok) {
        const b = (await res.json().catch(() => null)) as { error?: string; issues?: { path: (string | number)[]; message: string }[] } | null;
        throw new Error(b?.issues?.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") || b?.error || `HTTP ${res.status}`);
      }
      router.push("/billing/cost-centers");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally { setSubmitting(false); }
  }

  const valid = orgId && code.length > 0 && displayName.length > 0;

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Select label="Owner organization" required value={orgId} onChange={setOrgId} options={orgOptions.map((o) => ({ value: o.id, label: o.label }))} />
        <Field label="Code" required value={code} onChange={(v) => setCode(v.toUpperCase())} mono placeholder="STRAUMVAKT_PAYS" hint="UPPER_SNAKE only" />
        <Field label="Display name" required value={displayName} onChange={setDisplayName} placeholder="Straumvakt pays" />
        <Select label="Payer organization (optional)" value={payerOrgId} onChange={setPayerOrgId} options={[{ value: "", label: "— none —" }, ...orgOptions.map((o) => ({ value: o.id, label: o.label }))]} />
        <Field label="Payer user id (optional)" value={payerUserId} onChange={setPayerUserId} mono hint="UUID; mutually exclusive with payer org" />
        <Select label="Beneficiary organization (optional)" value={beneficiaryOrgId} onChange={setBeneficiaryOrgId} options={[{ value: "", label: "— none —" }, ...orgOptions.map((o) => ({ value: o.id, label: o.label }))]} />
      </div>

      {error && <div className="rounded border border-rose-700/40 bg-rose-950/30 p-2 text-xs text-rose-200">{error}</div>}
      <button type="submit" disabled={submitting || !valid} className="rounded-md bg-sv-green/20 px-4 py-2 text-sm font-medium text-sv-green ring-1 ring-sv-green/30 hover:bg-sv-green/30 disabled:cursor-not-allowed disabled:opacity-40">
        {submitting ? "Creating…" : "Create cost center"}
      </button>
    </form>
  );
}

function Field({ label, required, hint, value, onChange, placeholder, mono }: { label: string; required?: boolean; hint?: string; value: string; onChange: (v: string) => void; placeholder?: string; mono?: boolean }) {
  return <label className="block"><span className="block text-[11px] font-semibold uppercase tracking-brand text-ink-400">{label}{required && <span className="ml-0.5 text-rose-400">*</span>}</span><input type="text" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className={"mt-1 w-full rounded-md border border-bg-border bg-bg-base/50 px-3 py-2 text-sm text-ink-50 focus:border-sv-sky focus:outline-none " + (mono ? "font-mono" : "")} />{hint && <span className="mt-0.5 block text-[10px] text-ink-500">{hint}</span>}</label>;
}
function Select({ label, required, value, onChange, options }: { label: string; required?: boolean; value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) {
  return <label className="block"><span className="block text-[11px] font-semibold uppercase tracking-brand text-ink-400">{label}{required && <span className="ml-0.5 text-rose-400">*</span>}</span><select value={value} onChange={(e) => onChange(e.target.value)} className="mt-1 w-full rounded-md border border-bg-border bg-bg-base/50 px-3 py-2 text-sm text-ink-50 focus:border-sv-sky focus:outline-none">{options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select></label>;
}
