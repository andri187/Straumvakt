"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function CreatePropertyForm({ orgOptions }: { orgOptions: { id: string; label: string }[] }) {
  const router = useRouter();
  const [orgId, setOrgId] = useState(orgOptions[0]?.id ?? "");
  const [displayName, setDisplayName] = useState("");
  const [locationType, setLocationType] = useState("");
  const [street, setStreet] = useState("");
  const [city, setCity] = useState("");
  const [postalCode, setPostalCode] = useState("");
  const [latitude, setLatitude] = useState("");
  const [longitude, setLongitude] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toNum(v: string): number | undefined {
    if (v.trim() === "") return undefined;
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const body = {
        orgId,
        displayName,
        locationType: locationType || undefined,
        street: street || undefined,
        city: city || undefined,
        postalCode: postalCode || undefined,
        countryCode: "IS",
        latitude: toNum(latitude),
        longitude: toNum(longitude),
      };
      const res = await fetch("/api/admin/properties", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const b = (await res.json().catch(() => null)) as { error?: string; issues?: { path: (string | number)[]; message: string }[] } | null;
        throw new Error(b?.issues?.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") || b?.error || `HTTP ${res.status}`);
      }
      router.push("/tenants/properties");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  const valid = orgId.length > 0 && displayName.length > 0;

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <label className="block">
        <span className="block text-[11px] font-semibold uppercase tracking-brand text-ink-400">
          Organization<span className="ml-0.5 text-rose-400">*</span>
        </span>
        <select value={orgId} onChange={(e) => setOrgId(e.target.value)} className="mt-1 w-full rounded-md border border-bg-border bg-bg-base/50 px-3 py-2 text-sm text-ink-50 focus:border-sv-sky focus:outline-none">
          {orgOptions.map((o) => (
            <option key={o.id} value={o.id}>{o.label}</option>
          ))}
        </select>
      </label>
      <Field label="Display name" required value={displayName} onChange={setDisplayName} placeholder="Straumvakt Reykjavík HQ" />
      <Field label="Location type" value={locationType} onChange={setLocationType} placeholder="office / store / parking / depot" mono />
      <Field label="Street" value={street} onChange={setStreet} />
      <Field label="City" value={city} onChange={setCity} />
      <Field label="Postal code" value={postalCode} onChange={setPostalCode} mono />
      <Field label="Latitude" value={latitude} onChange={setLatitude} mono placeholder="64.1466" />
      <Field label="Longitude" value={longitude} onChange={setLongitude} mono placeholder="-21.9426" />

      {error && <div className="rounded border border-rose-700/40 bg-rose-950/30 p-2 text-xs text-rose-200">{error}</div>}

      <button type="submit" disabled={submitting || !valid} className="w-full rounded-md bg-sv-green/20 px-3 py-2 text-sm font-medium text-sv-green ring-1 ring-sv-green/30 hover:bg-sv-green/30 disabled:cursor-not-allowed disabled:opacity-40">
        {submitting ? "Creating…" : "Create property"}
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
