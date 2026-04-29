"use client";

import { useState } from "react";
import { ChevronRight } from "lucide-react";
import { apiFetch } from "@/lib/api-client";

type Step = "credentials" | "installations";

type DiscoveredCharger = {
  id: string;
  name: string;
  serialNo: string | null;
  deviceId: string | null;
  mid: string | null;
  active: boolean | null;
};

type DiscoveredCircuit = {
  id: string;
  name: string;
  maxCurrent: number | null;
  isActive: boolean;
  chargers: DiscoveredCharger[];
};

type DiscoveredInstallation = {
  id: string;
  name: string;
  address: string | null;
  activeChargerCount: number | null;
  maxCurrent: number | null;
  timezone: string | null;
  circuits: DiscoveredCircuit[];
};

export function ZaptecWizardForm() {
  const [step, setStep] = useState<Step>("credentials");
  const [zaptecUser, setZaptecUser] = useState("");
  const [zaptecPass, setZaptecPass] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [discovered, setDiscovered] = useState<DiscoveredInstallation[]>([]);
  const [openInstallations, setOpenInstallations] = useState<Set<string>>(new Set());
  const [openCircuits, setOpenCircuits] = useState<Set<string>>(new Set());

  function toggleInstallation(id: string) {
    setOpenInstallations((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function toggleCircuit(id: string) {
    setOpenCircuits((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function onConnect(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await apiFetch("/api/admin/zaptec/discover", {
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
      setOpenInstallations(new Set());
      setOpenCircuits(new Set());
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
          <Field label="Zaptec username" required value={zaptecUser} onChange={setZaptecUser} placeholder="user@straumvakt.is" mono />
          <Field label="Zaptec password" required value={zaptecPass} onChange={setZaptecPass} type="password" />
          <p className="rounded border border-bg-border/40 bg-bg-base/40 p-2 text-[10px] text-ink-400">
            Password is exchanged server-side for an OAuth refresh token immediately and never persisted in plaintext.
            Stored under the installation's <code className="font-mono">credentials_ref</code> once you import an installation.
          </p>
          {error && (
            <div className="rounded border border-rose-700/40 bg-rose-950/30 p-2 text-xs text-rose-200">{error}</div>
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
            <button type="button" onClick={onBack} className="text-xs text-ink-400 hover:text-ink-50">
              ← Different credentials
            </button>
          </div>

          <div className="overflow-hidden rounded-md border border-bg-border bg-bg-base/30">
            <table className="w-full text-left text-xs">
              <thead className="bg-bg-inset/40 text-[10px] uppercase tracking-brand text-ink-500">
                <tr>
                  <th className="w-6 px-2 py-2" />
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
                    <td colSpan={7} className="px-3 py-6 text-center text-[11px] italic text-ink-500">
                      No installations returned by Zaptec for these credentials.
                    </td>
                  </tr>
                ) : (
                  discovered.flatMap((inst) => [
                    <tr key={inst.id} className="hover:bg-bg-raised/30">
                      <td className="px-2 py-2 align-top">
                        <button
                          type="button"
                          onClick={() => toggleInstallation(inst.id)}
                          className="rounded p-1 text-ink-400 hover:bg-bg-base/40 hover:text-ink-100"
                          aria-label={openInstallations.has(inst.id) ? "Collapse" : "Expand"}
                        >
                          <ChevronRight
                            className={
                              "h-3.5 w-3.5 transition-transform " +
                              (openInstallations.has(inst.id) ? "rotate-90" : "")
                            }
                          />
                        </button>
                      </td>
                      <td className="px-3 py-2 align-top">
                        <div className="text-ink-100">{inst.name}</div>
                        <div className="font-mono text-[10px] text-ink-500">{inst.id}</div>
                      </td>
                      <td className="px-3 py-2 align-top text-ink-300">{inst.address ?? "—"}</td>
                      <td className="px-3 py-2 align-top text-ink-200">{inst.activeChargerCount ?? "—"}</td>
                      <td className="px-3 py-2 align-top text-ink-200">{inst.maxCurrent ?? "—"}</td>
                      <td className="px-3 py-2 align-top font-mono text-[10px] text-ink-400">{inst.timezone ?? "—"}</td>
                      <td className="px-3 py-2 align-top text-right">
                        <button
                          type="button"
                          disabled
                          title="Import flow lands in milestone 2.7"
                          className="rounded border border-bg-border/60 bg-bg-base/40 px-2 py-1 text-[11px] text-ink-500 disabled:cursor-not-allowed"
                        >
                          Import
                        </button>
                      </td>
                    </tr>,
                    openInstallations.has(inst.id) ? (
                      <tr key={inst.id + ":circuits"} className="bg-bg-base/40">
                        <td />
                        <td colSpan={6} className="px-3 py-2">
                          <CircuitTable
                            circuits={inst.circuits}
                            openCircuits={openCircuits}
                            onToggle={toggleCircuit}
                          />
                        </td>
                      </tr>
                    ) : null,
                  ])
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

function CircuitTable({
  circuits,
  openCircuits,
  onToggle,
}: {
  circuits: DiscoveredCircuit[];
  openCircuits: Set<string>;
  onToggle: (id: string) => void;
}) {
  if (circuits.length === 0) {
    return (
      <p className="px-2 py-3 text-[11px] italic text-ink-500">
        No circuits returned for this installation.
      </p>
    );
  }
  return (
    <div className="overflow-hidden rounded border border-bg-border/40 bg-bg-surface/40">
      <table className="w-full text-left text-[11px]">
        <thead className="bg-bg-inset/40 text-[10px] uppercase tracking-brand text-ink-500">
          <tr>
            <th className="w-6 px-2 py-1.5" />
            <th className="px-3 py-1.5 font-medium">Circuit</th>
            <th className="px-3 py-1.5 font-medium">Max A</th>
            <th className="px-3 py-1.5 font-medium">Active</th>
            <th className="px-3 py-1.5 font-medium">Chargers</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-bg-border/30">
          {circuits.flatMap((c) => [
            <tr key={c.id} className="hover:bg-bg-raised/20">
              <td className="px-2 py-1.5 align-top">
                <button
                  type="button"
                  onClick={() => onToggle(c.id)}
                  disabled={c.chargers.length === 0}
                  className="rounded p-1 text-ink-400 hover:bg-bg-base/40 hover:text-ink-100 disabled:cursor-not-allowed disabled:opacity-30"
                  aria-label={openCircuits.has(c.id) ? "Collapse" : "Expand"}
                >
                  <ChevronRight
                    className={
                      "h-3 w-3 transition-transform " +
                      (openCircuits.has(c.id) ? "rotate-90" : "")
                    }
                  />
                </button>
              </td>
              <td className="px-3 py-1.5 align-top">
                <div className="text-ink-100">{c.name}</div>
                <div className="font-mono text-[10px] text-ink-500">{c.id}</div>
              </td>
              <td className="px-3 py-1.5 align-top text-ink-200">{c.maxCurrent ?? "—"}</td>
              <td className="px-3 py-1.5 align-top text-ink-200">{c.isActive ? "yes" : "no"}</td>
              <td className="px-3 py-1.5 align-top text-ink-200">{c.chargers.length}</td>
            </tr>,
            openCircuits.has(c.id) && c.chargers.length > 0 ? (
              <tr key={c.id + ":chargers"} className="bg-bg-base/30">
                <td />
                <td colSpan={4} className="px-3 py-1.5">
                  <ChargerTable chargers={c.chargers} />
                </td>
              </tr>
            ) : null,
          ])}
        </tbody>
      </table>
    </div>
  );
}

function ChargerTable({ chargers }: { chargers: DiscoveredCharger[] }) {
  return (
    <div className="overflow-hidden rounded border border-bg-border/30 bg-bg-base/40">
      <table className="w-full text-left text-[10px]">
        <thead className="bg-bg-inset/30 text-[9px] uppercase tracking-brand text-ink-500">
          <tr>
            <th className="px-3 py-1 font-medium">Charger</th>
            <th className="px-3 py-1 font-medium">Serial</th>
            <th className="px-3 py-1 font-medium">Device ID</th>
            <th className="px-3 py-1 font-medium">MID</th>
            <th className="px-3 py-1 font-medium">Active</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-bg-border/20">
          {chargers.map((ch) => (
            <tr key={ch.id} className="hover:bg-bg-raised/10">
              <td className="px-3 py-1">
                <div className="text-ink-100">{ch.name}</div>
                <div className="font-mono text-[9px] text-ink-500">{ch.id}</div>
              </td>
              <td className="px-3 py-1 font-mono text-ink-300">{ch.serialNo ?? "—"}</td>
              <td className="px-3 py-1 font-mono text-ink-300">{ch.deviceId ?? "—"}</td>
              <td className="px-3 py-1 font-mono text-ink-300">{ch.mid ?? "—"}</td>
              <td className="px-3 py-1 text-ink-200">
                {ch.active === null ? "—" : ch.active ? "yes" : "no"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Pill({ children, active, done }: { children: React.ReactNode; active: boolean; done: boolean }) {
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
