"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Initial = {
  displayName: string;
  installationId: string;
  ampereCeiling: string;
  phaseCount: string;
  vendorCircuitRef: string;
  metadataJson: string;
};

export function EditCircuitPanel({
  circuitId,
  installationOptions,
  initial,
}: {
  circuitId: string;
  installationOptions: { id: string; displayName: string }[];
  initial: Initial;
}) {
  const router = useRouter();
  const [s, setS] = useState<Initial>(initial);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function set<K extends keyof Initial>(k: K, v: string) { setS((p) => ({ ...p, [k]: v })); setSaved(false); }

  function toNum(v: string): number | undefined {
    if (v.trim() === "") return undefined;
    const n = Number(v); return Number.isFinite(n) ? n : undefined;
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); setError(null); setSubmitting(true); setSaved(false);
    try {
      let metadata: Record<string, unknown> | undefined;
      if (s.metadataJson.trim()) {
        try {
          const parsed: unknown = JSON.parse(s.metadataJson);
          if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
            throw new Error("metadata must be a JSON object");
          }
          metadata = parsed as Record<string, unknown>;
        } catch (err) {
          throw new Error(`metadata: ${err instanceof Error ? err.message : "invalid JSON"}`);
        }
      } else {
        metadata = {};
      }
      const res = await fetch(`/api/admin/circuits/${circuitId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          displayName: s.displayName,
          installationId: s.installationId || null,
          ampereCeiling: toNum(s.ampereCeiling) ?? null,
          phaseCount: toNum(s.phaseCount) ?? 3,
          vendorCircuitRef: s.vendorCircuitRef || undefined,
          metadata,
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
      <label className="block">
        <span className="block text-[11px] font-semibold uppercase tracking-brand text-ink-400">Installation</span>
        <select value={s.installationId} onChange={(e) => set("installationId", e.target.value)} className="mt-1 w-full rounded-md border border-bg-border bg-bg-base/50 px-3 py-2 text-sm text-ink-50 focus:border-sv-sky focus:outline-none">
          <option value="">— site-level —</option>
          {installationOptions.map((i) => <option key={i.id} value={i.id}>{i.displayName}</option>)}
        </select>
      </label>
      <Field label="Ampere ceiling" value={s.ampereCeiling} onChange={(v) => set("ampereCeiling", v)} mono />
      <label className="block">
        <span className="block text-[11px] font-semibold uppercase tracking-brand text-ink-400">Phase count</span>
        <select value={s.phaseCount} onChange={(e) => set("phaseCount", e.target.value)} className="mt-1 w-full rounded-md border border-bg-border bg-bg-base/50 px-3 py-2 text-sm text-ink-50 focus:border-sv-sky focus:outline-none">
          <option value="1">1</option><option value="3">3</option>
        </select>
      </label>
      <Field label="Vendor circuit ref" value={s.vendorCircuitRef} onChange={(v) => set("vendorCircuitRef", v)} mono />

      <label className="block">
        <span className="block text-[11px] font-semibold uppercase tracking-brand text-ink-400">Metadata (JSON object)</span>
        <textarea
          value={s.metadataJson}
          onChange={(e) => set("metadataJson", e.target.value)}
          rows={3}
          placeholder='{"key": "value"}'
          className="mt-1 w-full rounded-md border border-bg-border bg-bg-base/50 px-3 py-2 font-mono text-xs text-ink-50 focus:border-sv-sky focus:outline-none"
        />
      </label>

      {error && <div className="rounded border border-rose-700/40 bg-rose-950/30 p-2 text-xs text-rose-200">{error}</div>}
      {saved && <div className="rounded border border-sv-green/40 bg-sv-green/10 p-2 text-xs text-sv-green">Saved.</div>}

      <button type="submit" disabled={submitting || s.displayName.length === 0} className="rounded-md bg-sv-green/20 px-3 py-2 text-sm font-medium text-sv-green ring-1 ring-sv-green/30 hover:bg-sv-green/30 disabled:cursor-not-allowed disabled:opacity-40">
        {submitting ? "Saving…" : "Save changes"}
      </button>
    </form>
  );
}

function Field({ label, required, value, onChange, mono }: { label: string; required?: boolean; value: string; onChange: (v: string) => void; mono?: boolean }) {
  return <label className="block"><span className="block text-[11px] font-semibold uppercase tracking-brand text-ink-400">{label}{required && <span className="ml-0.5 text-rose-400">*</span>}</span><input type="text" value={value} onChange={(e) => onChange(e.target.value)} className={"mt-1 w-full rounded-md border border-bg-border bg-bg-base/50 px-3 py-2 text-sm text-ink-50 focus:border-sv-sky focus:outline-none " + (mono ? "font-mono" : "")} /></label>;
}
