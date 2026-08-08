"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api-client";

const STATUSES = ["pending_credentials", "discovering", "active", "suspended", "error"] as const;

export function CreateInstallationForm({
  orgOptions,
  vendorOptions,
}: {
  orgOptions: { id: string; label: string }[];
  vendorOptions: { id: string; slug: string; displayName: string }[];
}) {
  const router = useRouter();
  const [orgId, setOrgId] = useState(orgOptions[0]?.id ?? "");
  const [siteId, setSiteId] = useState("");
  const [sites, setSites] = useState<{ id: string; displayName: string }[]>([]);
  const [displayName, setDisplayName] = useState("");
  const [vendorId, setVendorId] = useState("");
  const [vendorInstallationRef, setVendorInstallationRef] = useState("");
  const [onboardingStatus, setOnboardingStatus] = useState<typeof STATUSES[number]>("pending_credentials");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!orgId) return;
    apiFetch(`/api/admin/orgs/${orgId}/sites`).then((r) => r.json()).then((d: { sites?: { id: string; displayName: string }[] }) => {
      const list = d.sites ?? [];
      setSites(list);
      setSiteId(list[0]?.id ?? "");
    }).catch(() => setSites([]));
  }, [orgId]);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); setError(null); setSubmitting(true);
    try {
      const res = await apiFetch("/api/admin/installations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          orgId, siteId, displayName,
          vendorId: vendorId || undefined,
          vendorInstallationRef: vendorInstallationRef || undefined,
          onboardingStatus,
        }),
      });
      if (!res.ok) {
        const b = (await res.json().catch(() => null)) as { error?: string; issues?: { path: (string | number)[]; message: string }[] } | null;
        throw new Error(b?.issues?.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") || b?.error || `HTTP ${res.status}`);
      }
      router.push("/installations");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally { setSubmitting(false); }
  }

  const valid = orgId && siteId && displayName.length > 0;

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Select label="Organization" required value={orgId} onChange={setOrgId} options={orgOptions.map((o) => ({ value: o.id, label: o.label }))} />
        <Select label="Site" required value={siteId} onChange={setSiteId} options={sites.map((s) => ({ value: s.id, label: s.displayName }))} placeholder={sites.length === 0 ? "(no sites for this org)" : undefined} />
        <Field label="Display name" required value={displayName} onChange={setDisplayName} placeholder="Reykjavík HQ Zaptec" />
        <Select label="Vendor" value={vendorId} onChange={setVendorId} options={[{ value: "", label: "— none —" }, ...vendorOptions.map((v) => ({ value: v.id, label: v.displayName }))]} />
        <Field label="Vendor installation ref" value={vendorInstallationRef} onChange={setVendorInstallationRef} mono placeholder="(populated by Zaptec wizard)" />
        <Select label="Onboarding status" value={onboardingStatus} onChange={(v) => setOnboardingStatus(v as typeof STATUSES[number])} options={STATUSES.map((s) => ({ value: s, label: s }))} />
      </div>

      {error && <div className="rounded border border-rose-700/40 bg-rose-950/30 p-2 text-xs text-rose-200">{error}</div>}
      <button type="submit" disabled={submitting || !valid} className="rounded-md bg-sv-green/20 px-4 py-2 text-sm font-medium text-sv-green ring-1 ring-sv-green/30 hover:bg-sv-green/30 disabled:cursor-not-allowed disabled:opacity-40">
        {submitting ? "Creating…" : "Create installation"}
      </button>
    </form>
  );
}

function Field({ label, required, value, onChange, placeholder, mono }: { label: string; required?: boolean; value: string; onChange: (v: string) => void; placeholder?: string; mono?: boolean }) {
  return (
    <label className="block">
      <span className="block text-[11px] font-semibold uppercase tracking-brand text-ink-400">{label}{required && <span className="ml-0.5 text-rose-400">*</span>}</span>
      <input type="text" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className={"mt-1 w-full rounded-md border border-bg-border bg-bg-base/50 px-3 py-2 text-sm text-ink-50 focus:border-sv-sky focus:outline-none " + (mono ? "font-mono" : "")} />
    </label>
  );
}

function Select({ label, required, value, onChange, options, placeholder }: { label: string; required?: boolean; value: string; onChange: (v: string) => void; options: { value: string; label: string }[]; placeholder?: string }) {
  return (
    <label className="block">
      <span className="block text-[11px] font-semibold uppercase tracking-brand text-ink-400">{label}{required && <span className="ml-0.5 text-rose-400">*</span>}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="mt-1 w-full rounded-md border border-bg-border bg-bg-base/50 px-3 py-2 text-sm text-ink-50 focus:border-sv-sky focus:outline-none">
        {placeholder && <option value="" disabled>{placeholder}</option>}
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  );
}
