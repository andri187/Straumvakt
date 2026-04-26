"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function CreateOrgForm() {
  const router = useRouter();
  const [slug, setSlug] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [countryCode, setCountryCode] = useState("IS");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/admin/orgs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ slug, displayName, countryCode }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as
          | { error?: string }
          | null;
        throw new Error(body?.error ?? `HTTP ${res.status}`);
      }
      setSlug("");
      setDisplayName("");
      setCountryCode("IS");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <Field
        label="Slug"
        hint="lowercase, dashes only — used in URLs"
        value={slug}
        onChange={setSlug}
        placeholder="kronan-pilot"
        mono
      />
      <Field
        label="Display name"
        hint="shown in the console"
        value={displayName}
        onChange={setDisplayName}
        placeholder="Krónan"
      />
      <Field
        label="Country"
        hint="ISO-3166-1 alpha-2 (IS / NO / SE)"
        value={countryCode}
        onChange={(v) => setCountryCode(v.toUpperCase().slice(0, 2))}
        placeholder="IS"
        mono
      />

      {error && (
        <div className="rounded border border-rose-700/40 bg-rose-950/30 p-2 text-xs text-rose-200">
          {error}
        </div>
      )}

      <button
        type="submit"
        disabled={
          submitting ||
          slug.length === 0 ||
          displayName.length === 0 ||
          countryCode.length !== 2
        }
        className="w-full rounded-md bg-sv-green/20 px-3 py-2 text-sm font-medium text-sv-green ring-1 ring-sv-green/30 transition-colors hover:bg-sv-green/30 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {submitting ? "Creating…" : "Create organization"}
      </button>
    </form>
  );
}

function Field({
  label,
  hint,
  value,
  onChange,
  placeholder,
  mono,
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  mono?: boolean;
}) {
  return (
    <label className="block">
      <span className="block text-[11px] font-semibold uppercase tracking-brand text-ink-400">
        {label}
      </span>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={
          "mt-1 w-full rounded-md border border-bg-border bg-bg-base/50 px-3 py-2 text-sm text-ink-50 ring-1 ring-transparent transition-colors focus:border-sv-sky focus:ring-sv-sky/20 focus:outline-none " +
          (mono ? "font-mono" : "")
        }
      />
      {hint && <span className="mt-0.5 block text-[10px] text-ink-500">{hint}</span>}
    </label>
  );
}
