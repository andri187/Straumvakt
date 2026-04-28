"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api-client";

const STATUSES = ["pending_credentials", "discovering", "active", "suspended", "error"] as const;

type Initial = {
  displayName: string;
  vendorId: string;
  modelId: string;
  vendorInstallationRef: string;
  credentialsRef: string;
  credentialsStatus: string;
  onboardingStatus: string;
  retailerTariffId: string;
};

export function EditInstallationPanel({
  installationId,
  vendorOptions,
  initial,
}: {
  installationId: string;
  vendorOptions: { id: string; slug: string; displayName: string }[];
  initial: Initial;
}) {
  const router = useRouter();
  const [s, setS] = useState<Initial>(initial);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function set<K extends keyof Initial>(k: K, v: string) { setS((p) => ({ ...p, [k]: v })); setSaved(false); }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); setError(null); setSubmitting(true); setSaved(false);
    try {
      const patch: Record<string, unknown> = {};
      if (s.displayName !== initial.displayName) patch.displayName = s.displayName;
      if (s.vendorId !== initial.vendorId) patch.vendorId = s.vendorId || null;
      if (s.modelId !== initial.modelId) patch.modelId = s.modelId || null;
      if (s.vendorInstallationRef !== initial.vendorInstallationRef) patch.vendorInstallationRef = s.vendorInstallationRef || undefined;
      if (s.credentialsRef !== initial.credentialsRef) patch.credentialsRef = s.credentialsRef || undefined;
      if (s.credentialsStatus !== initial.credentialsStatus) patch.credentialsStatus = s.credentialsStatus || undefined;
      if (s.onboardingStatus !== initial.onboardingStatus) patch.onboardingStatus = s.onboardingStatus;
      if (s.retailerTariffId !== initial.retailerTariffId) patch.retailerTariffId = s.retailerTariffId || null;

      if (Object.keys(patch).length === 0) {
        setSubmitting(false);
        return;
      }
      const res = await apiFetch(`/api/admin/installations/${installationId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        const b = (await res.json().catch(() => null)) as { error?: string; issues?: { path: (string | number)[]; message: string }[] } | null;
        throw new Error(b?.issues?.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") || b?.error || `HTTP ${res.status}`);
      }
      setSaved(true); router.refresh();
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); } finally { setSubmitting(false); }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Display name" required value={s.displayName} onChange={(v) => set("displayName", v)} />
        <label className="block">
          <span className="block text-[11px] font-semibold uppercase tracking-brand text-ink-400">Vendor</span>
          <select value={s.vendorId} onChange={(e) => set("vendorId", e.target.value)} className="mt-1 w-full rounded-md border border-bg-border bg-bg-base/50 px-3 py-2 text-sm text-ink-50 focus:border-sv-sky focus:outline-none">
            <option value="">— none —</option>
            {vendorOptions.map((v) => <option key={v.id} value={v.id}>{v.displayName}</option>)}
          </select>
        </label>
        <Field label="Model id (UUID)" value={s.modelId} onChange={(v) => set("modelId", v)} mono />
        <Field label="Vendor installation ref" value={s.vendorInstallationRef} onChange={(v) => set("vendorInstallationRef", v)} mono />
        <Field label="Credentials ref" value={s.credentialsRef} onChange={(v) => set("credentialsRef", v)} mono />
        <Field label="Credentials status" value={s.credentialsStatus} onChange={(v) => set("credentialsStatus", v)} mono />
        <label className="block">
          <span className="block text-[11px] font-semibold uppercase tracking-brand text-ink-400">Onboarding status</span>
          <select value={s.onboardingStatus} onChange={(e) => set("onboardingStatus", e.target.value)} className="mt-1 w-full rounded-md border border-bg-border bg-bg-base/50 px-3 py-2 text-sm text-ink-50 focus:border-sv-sky focus:outline-none">
            {STATUSES.map((st) => <option key={st} value={st}>{st}</option>)}
          </select>
        </label>
        <Field label="Retailer tariff id (REPF)" value={s.retailerTariffId} onChange={(v) => set("retailerTariffId", v)} mono hint="paste UUID from /billing/tariffs" />
      </div>

      {error && <div className="rounded border border-rose-700/40 bg-rose-950/30 p-2 text-xs text-rose-200">{error}</div>}
      {saved && <div className="rounded border border-sv-green/40 bg-sv-green/10 p-2 text-xs text-sv-green">Saved.</div>}

      <button type="submit" disabled={submitting || s.displayName.length === 0} className="rounded-md bg-sv-green/20 px-4 py-2 text-sm font-medium text-sv-green ring-1 ring-sv-green/30 hover:bg-sv-green/30 disabled:cursor-not-allowed disabled:opacity-40">
        {submitting ? "Saving…" : "Save changes"}
      </button>
    </form>
  );
}

function Field({ label, required, value, onChange, mono, hint }: { label: string; required?: boolean; value: string; onChange: (v: string) => void; mono?: boolean; hint?: string }) {
  return <label className="block"><span className="block text-[11px] font-semibold uppercase tracking-brand text-ink-400">{label}{required && <span className="ml-0.5 text-rose-400">*</span>}</span><input type="text" value={value} onChange={(e) => onChange(e.target.value)} className={"mt-1 w-full rounded-md border border-bg-border bg-bg-base/50 px-3 py-2 text-sm text-ink-50 focus:border-sv-sky focus:outline-none " + (mono ? "font-mono" : "")} />{hint && <span className="mt-0.5 block text-[10px] text-ink-500">{hint}</span>}</label>;
}
