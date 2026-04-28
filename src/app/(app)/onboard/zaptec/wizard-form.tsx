"use client";

import { useState } from "react";

type Step = "credentials" | "installations";

type DiscoveredInstallation = {
  id: string;
  name: string;
  address: string | null;
  activeChargerCount: number | null;
  maxCurrent: number | null;
  timezone: string | null;
};

export function ZaptecWizardForm() {
  const [step, setStep] = useState<Step>("credentials");
  const [zaptecUser, setZaptecUser] = useState("");
  const [zaptecPass, setZaptecPass] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [discovered, setDiscovered] = useState<DiscoveredInstallation[]>([]);

  async function onConnect(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      // Server-side exchanges the credentials for a Zaptec OAuth token
      // (one-shot, not persisted), lists installations, returns the
      // summary rows. Persistence happens at the per-installation import
      // step (milestone 2.7) where a refresh-token reference lands under
      // `installations.credentials_ref`.
      const res = await fetch("/api/admin/zaptec/discover", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: zaptecUser, password: zaptecPass }),
      });
      const body = (await res.json().catch(() => null)) as
        | { installations?: DiscoveredInstallation[]; error?: string }
        | null;
      if (!res.ok) {
        const msg =
          body?.error === "invalid_credentials"
            ? "Invalid Zaptec credentials."
            : body?.error === "zaptec_unreachable"
              ? "Could not reach api.zaptec.com — check network and retry."
              : body?.error === "zaptec_oauth_error" || body?.error === "zaptec_oauth_no_token"
                ? "Zaptec OAuth rejected the credentials."
                : body?.error === "zaptec_list_error"
                  ? "Authenticated, but listing installations failed at Zaptec."
                  : `Discover failed (HTTP ${res.status}).`;
        setError(msg);
        return;
      }
      setDiscovered(body?.installations ?? []);
      setStep("installations");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  function onBack() {
    setStep("credentials");
    setError(null);
  }

  return (
    <div className="space-y-4">
      <ol className="flex items-center gap-2 text-xs">
        <Pill active={step === "credentials"} done={step === "installations"}>
          1. Zaptec credentials
        </Pill>
        <span className="text-ink-600">→</span>
        <Pill active={step === "installations"} done={false}>
          2. Discovered installations
        </Pill>
      </ol>

      {step === "credentials" && (
        <form
          onSubmit={onConnect}
          className="space-y-3 rounded-md border border-bg-border bg-bg-base/30 p-4"
        >
          <Field
            label="Zaptec username"
            required
            value={zaptecUser}
            onChange={setZaptecUser}
            placeholder="user@straumvakt.is"
            mono
          />
          <Field
            label="Zaptec password"
            required
            value={zaptecPass}
            onChange={setZaptecPass}
            type="password"
          />
          <p className="rounded border border-bg-border/40 bg-bg-base/40 p-2 text-[10px] text-ink-400">
            Password is exchanged server-side for an OAuth refresh token
            immediately and never persisted in plaintext. Stored under the
            installation's <code className="font-mono">credentials_ref</code>{" "}
            once you import an installation.
          </p>

          {error && (
            <div className="rounded border border-rose-700/40 bg-rose-950/30 p-2 text-xs text-rose-200">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={submitting || zaptecUser.length === 0 || zaptecPass.length === 0}
            className="rounded-md bg-sv-green/20 px-4 py-2 text-sm font-medium text-sv-green ring-1 ring-sv-green/30 hover:bg-sv-green/30 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {submitting ? "Connecting…" : "Connect to Zaptec"}
          </button>
        </form>
      )}

      {step === "installations" && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs text-ink-400">
              {`Discovered ${discovered.length} installation${discovered.length === 1 ? "" : "s"} accessible to ${zaptecUser}.`}
            </p>
            <button
              type="button"
              onClick={onBack}
              className="text-xs text-ink-400 hover:text-ink-50"
            >
              ← Different credentials
            </button>
          </div>

          <div className="overflow-hidden rounded-md border border-bg-border bg-bg-base/30">
            <table className="w-full text-left text-xs">
              <thead className="bg-bg-inset/40 text-[10px] uppercase tracking-brand text-ink-500">
                <tr>
                  <th className="px-3 py-2 font-medium">Installation</th>
                  <th className="px-3 py-2 font-medium">Address</th>
                  <th className="px-3 py-2 font-medium">Chargers</th>
                  <th className="px-3 py-2 font-medium">Max A</th>
                  <th className="px-3 py-2 font-medium">Time zone</th>
                  <th className="px-3 py-2 font-medium" />
                </tr>
              </thead>
              <tbody className="divide-y divide-bg-border/40">
                {discovered.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-3 py-6 text-center text-[11px] italic text-ink-500">
                      No installations returned by Zaptec for these credentials.
                    </td>
                  </tr>
                ) : (
                  discovered.map((inst) => (
                    <tr key={inst.id} className="hover:bg-bg-raised/30">
                      <td className="px-3 py-2">
                        <div className="text-ink-100">{inst.name}</div>
                        <div className="font-mono text-[10px] text-ink-500">{inst.id}</div>
                      </td>
                      <td className="px-3 py-2 text-ink-300">{inst.address ?? "—"}</td>
                      <td className="px-3 py-2 text-ink-200">{inst.activeChargerCount ?? "—"}</td>
                      <td className="px-3 py-2 text-ink-200">{inst.maxCurrent ?? "—"}</td>
                      <td className="px-3 py-2 font-mono text-[10px] text-ink-400">{inst.timezone ?? "—"}</td>
                      <td className="px-3 py-2 text-right">
                        <button
                          type="button"
                          disabled
                          title="Import flow lands in milestone 2.7"
                          className="rounded border border-bg-border/60 bg-bg-base/40 px-2 py-1 text-[11px] text-ink-500 disabled:cursor-not-allowed"
                        >
                          Import
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <p className="text-[10px] text-ink-500">
            Importing maps a Zaptec installation onto a Straumvakt Site.
            You'll pick the target Org + Property + Site at that point — the
            credentials are scoped to the installation row that gets created.
          </p>
        </div>
      )}
    </div>
  );
}

function Pill({
  children,
  active,
  done,
}: {
  children: React.ReactNode;
  active: boolean;
  done: boolean;
}) {
  return (
    <span
      className={
        "rounded-full px-2 py-1 ring-1 " +
        (active
          ? "bg-sv-sky/20 text-sv-sky ring-sv-sky/40"
          : done
            ? "bg-sv-green/20 text-sv-green ring-sv-green/40"
            : "bg-bg-base/40 text-ink-400 ring-bg-border")
      }
    >
      {children}
    </span>
  );
}

function Field({
  label,
  required,
  value,
  onChange,
  placeholder,
  mono,
  type = "text",
}: {
  label: string;
  required?: boolean;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  mono?: boolean;
  type?: string;
}) {
  return (
    <label className="block">
      <span className="block text-[11px] font-semibold uppercase tracking-brand text-ink-400">
        {label}
        {required && <span className="ml-0.5 text-rose-400">*</span>}
      </span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={
          "mt-1 w-full rounded-md border border-bg-border bg-bg-base/50 px-3 py-2 text-sm text-ink-50 focus:border-sv-sky focus:outline-none " +
          (mono ? "font-mono" : "")
        }
      />
    </label>
  );
}
