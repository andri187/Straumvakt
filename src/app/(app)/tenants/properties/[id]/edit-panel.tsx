"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Initial = {
  displayName: string;
  locationType: string;
  street: string;
  city: string;
  postalCode: string;
  countryCode: string;
  latitude: string;
  longitude: string;
};

export function EditPropertyPanel({ propertyId, initial }: { propertyId: string; initial: Initial }) {
  const router = useRouter();
  const [s, setS] = useState<Initial>(initial);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function set<K extends keyof Initial>(k: K, v: string) {
    setS((p) => ({ ...p, [k]: v }));
    setSaved(false);
  }

  function toNum(v: string): number | undefined {
    if (v.trim() === "") return undefined;
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null); setSubmitting(true); setSaved(false);
    try {
      const body = {
        displayName: s.displayName,
        locationType: s.locationType || undefined,
        street: s.street || undefined,
        city: s.city || undefined,
        postalCode: s.postalCode || undefined,
        countryCode: s.countryCode || "IS",
        latitude: toNum(s.latitude),
        longitude: toNum(s.longitude),
      };
      const res = await fetch(`/api/admin/properties/${propertyId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const b = (await res.json().catch(() => null)) as { error?: string; issues?: { path: (string | number)[]; message: string }[] } | null;
        throw new Error(b?.issues?.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") || b?.error || `HTTP ${res.status}`);
      }
      setSaved(true);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally { setSubmitting(false); }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <Field label="Display name" required value={s.displayName} onChange={(v) => set("displayName", v)} />
      <Field label="Location type" value={s.locationType} onChange={(v) => set("locationType", v)} placeholder="office / store / parking / depot" mono />
      <Field label="Street" value={s.street} onChange={(v) => set("street", v)} />
      <Field label="City" value={s.city} onChange={(v) => set("city", v)} />
      <Field label="Postal code" value={s.postalCode} onChange={(v) => set("postalCode", v)} mono />
      <Field label="Country code" value={s.countryCode} onChange={(v) => set("countryCode", v.toUpperCase().slice(0, 2))} mono />
      <Field label="Latitude" value={s.latitude} onChange={(v) => set("latitude", v)} mono />
      <Field label="Longitude" value={s.longitude} onChange={(v) => set("longitude", v)} mono />

      {error && <div className="rounded border border-rose-700/40 bg-rose-950/30 p-2 text-xs text-rose-200">{error}</div>}
      {saved && <div className="rounded border border-sv-green/40 bg-sv-green/10 p-2 text-xs text-sv-green">Saved.</div>}

      <button
        type="submit"
        disabled={submitting || s.displayName.length === 0}
        className="rounded-md bg-sv-green/20 px-3 py-2 text-sm font-medium text-sv-green ring-1 ring-sv-green/30 hover:bg-sv-green/30 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {submitting ? "Saving…" : "Save changes"}
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
