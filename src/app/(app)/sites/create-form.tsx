"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

const SITE_TYPES = ["standard", "workplace", "mdu", "hotel", "fleet", "retail"] as const;
const ACCESS_LEVELS = ["public", "private", "taxi_only"] as const;
const POWER_CLASSES = ["", "lt_50kw", "between_50_150kw", "between_150_500kw", "gt_500kw"] as const;

export function CreateSiteForm({ orgOptions }: { orgOptions: { id: string; label: string }[] }) {
  const router = useRouter();
  const [orgId, setOrgId] = useState(orgOptions[0]?.id ?? "");
  const [propertyId, setPropertyId] = useState("");
  const [properties, setProperties] = useState<{ id: string; displayName: string }[]>([]);
  const [displayName, setDisplayName] = useState("");
  const [timezone, setTimezone] = useState("Atlantic/Reykjavik");
  const [siteType, setSiteType] = useState<typeof SITE_TYPES[number]>("standard");
  const [accessLevel, setAccessLevel] = useState<typeof ACCESS_LEVELS[number]>("private");
  const [powerClass, setPowerClass] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!orgId) return;
    fetch(`/api/admin/orgs/${orgId}/properties`)
      .then((r) => r.json())
      .then((d: { properties?: { id: string; displayName: string }[] }) => {
        const list = d.properties ?? [];
        setProperties(list);
        setPropertyId(list[0]?.id ?? "");
      })
      .catch(() => setProperties([]));
  }, [orgId]);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/admin/sites", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          orgId, propertyId, displayName, timezone, siteType, accessLevel,
          powerClass: powerClass || undefined,
        }),
      });
      if (!res.ok) {
        const b = (await res.json().catch(() => null)) as { error?: string; issues?: { path: (string | number)[]; message: string }[] } | null;
        throw new Error(b?.issues?.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") || b?.error || `HTTP ${res.status}`);
      }
      setDisplayName("");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  const valid = orgId && propertyId && displayName.length > 0;

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <Select label="Organization" required value={orgId} onChange={setOrgId} options={orgOptions.map((o) => ({ value: o.id, label: o.label }))} />
      <Select label="Property" required value={propertyId} onChange={setPropertyId} options={properties.map((p) => ({ value: p.id, label: p.displayName }))} placeholder={properties.length === 0 ? "(no properties for this org)" : undefined} />
      <Field label="Display name" required value={displayName} onChange={setDisplayName} placeholder="Reykjavík HQ parking" />
      <Field label="Timezone" value={timezone} onChange={setTimezone} mono />
      <Select label="Site type" required value={siteType} onChange={(v) => setSiteType(v as typeof SITE_TYPES[number])} options={SITE_TYPES.map((s) => ({ value: s, label: s }))} />
      <Select label="Access level" required value={accessLevel} onChange={(v) => setAccessLevel(v as typeof ACCESS_LEVELS[number])} options={ACCESS_LEVELS.map((s) => ({ value: s, label: s }))} />
      <Select label="Power class" value={powerClass} onChange={setPowerClass} options={POWER_CLASSES.map((s) => ({ value: s, label: s || "—" }))} />

      {error && <div className="rounded border border-rose-700/40 bg-rose-950/30 p-2 text-xs text-rose-200">{error}</div>}

      <button type="submit" disabled={submitting || !valid} className="w-full rounded-md bg-sv-green/20 px-3 py-2 text-sm font-medium text-sv-green ring-1 ring-sv-green/30 hover:bg-sv-green/30 disabled:cursor-not-allowed disabled:opacity-40">
        {submitting ? "Creating…" : "Create site"}
      </button>
    </form>
  );
}

function Field({ label, required, value, onChange, placeholder, mono }: { label: string; required?: boolean; value: string; onChange: (v: string) => void; placeholder?: string; mono?: boolean }) {
  return (
    <label className="block">
      <span className="block text-[11px] font-semibold uppercase tracking-brand text-ink-400">
        {label}{required && <span className="ml-0.5 text-rose-400">*</span>}
      </span>
      <input type="text" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className={"mt-1 w-full rounded-md border border-bg-border bg-bg-base/50 px-3 py-2 text-sm text-ink-50 focus:border-sv-sky focus:outline-none " + (mono ? "font-mono" : "")} />
    </label>
  );
}

function Select({ label, required, value, onChange, options, placeholder }: { label: string; required?: boolean; value: string; onChange: (v: string) => void; options: { value: string; label: string }[]; placeholder?: string }) {
  return (
    <label className="block">
      <span className="block text-[11px] font-semibold uppercase tracking-brand text-ink-400">
        {label}{required && <span className="ml-0.5 text-rose-400">*</span>}
      </span>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="mt-1 w-full rounded-md border border-bg-border bg-bg-base/50 px-3 py-2 text-sm text-ink-50 focus:border-sv-sky focus:outline-none">
        {placeholder && <option value="" disabled>{placeholder}</option>}
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  );
}
