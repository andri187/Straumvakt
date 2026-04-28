"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const SITE_TYPES = ["standard", "workplace", "mdu", "hotel", "fleet", "retail"] as const;
const ACCESS_LEVELS = ["public", "private", "taxi_only"] as const;
const POWER_CLASSES = ["", "lt_50kw", "between_50_150kw", "between_150_500kw", "gt_500kw"] as const;

type Initial = {
  displayName: string;
  timezone: string;
  siteType: string;
  accessLevel: string;
  powerClass: string;
};

export function EditSitePanel({ siteId, initial }: { siteId: string; initial: Initial }) {
  const router = useRouter();
  const [s, setS] = useState<Initial>(initial);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function set<K extends keyof Initial>(k: K, v: string) { setS((p) => ({ ...p, [k]: v })); setSaved(false); }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); setError(null); setSubmitting(true); setSaved(false);
    try {
      const res = await fetch(`/api/admin/sites/${siteId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          displayName: s.displayName,
          timezone: s.timezone,
          siteType: s.siteType,
          accessLevel: s.accessLevel,
          powerClass: s.powerClass || null,
        }),
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
      <Field label="Display name" required value={s.displayName} onChange={(v) => set("displayName", v)} />
      <Field label="Timezone" value={s.timezone} onChange={(v) => set("timezone", v)} mono />
      <Select label="Site type" value={s.siteType} onChange={(v) => set("siteType", v)} options={SITE_TYPES} />
      <Select label="Access level" value={s.accessLevel} onChange={(v) => set("accessLevel", v)} options={ACCESS_LEVELS} />
      <Select label="Power class" value={s.powerClass} onChange={(v) => set("powerClass", v)} options={POWER_CLASSES} />

      {error && <div className="rounded border border-rose-700/40 bg-rose-950/30 p-2 text-xs text-rose-200">{error}</div>}
      {saved && <div className="rounded border border-sv-green/40 bg-sv-green/10 p-2 text-xs text-sv-green">Saved.</div>}

      <button type="submit" disabled={submitting || s.displayName.length === 0} className="rounded-md bg-sv-green/20 px-3 py-2 text-sm font-medium text-sv-green ring-1 ring-sv-green/30 hover:bg-sv-green/30 disabled:cursor-not-allowed disabled:opacity-40">
        {submitting ? "Saving…" : "Save changes"}
      </button>
    </form>
  );
}

function Field({ label, required, value, onChange, placeholder, mono }: { label: string; required?: boolean; value: string; onChange: (v: string) => void; placeholder?: string; mono?: boolean }) {
  return <label className="block"><span className="block text-[11px] font-semibold uppercase tracking-brand text-ink-400">{label}{required && <span className="ml-0.5 text-rose-400">*</span>}</span><input type="text" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className={"mt-1 w-full rounded-md border border-bg-border bg-bg-base/50 px-3 py-2 text-sm text-ink-50 focus:border-sv-sky focus:outline-none " + (mono ? "font-mono" : "")} /></label>;
}
function Select({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: readonly string[] }) {
  return <label className="block"><span className="block text-[11px] font-semibold uppercase tracking-brand text-ink-400">{label}</span><select value={value} onChange={(e) => onChange(e.target.value)} className="mt-1 w-full rounded-md border border-bg-border bg-bg-base/50 px-3 py-2 text-sm text-ink-50 focus:border-sv-sky focus:outline-none">{options.map((o) => <option key={o} value={o}>{o || "—"}</option>)}</select></label>;
}
