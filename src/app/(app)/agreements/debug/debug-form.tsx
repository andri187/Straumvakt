"use client";

import { useState, useMemo } from "react";
import { apiFetch } from "@/lib/api-client";

type UserOption = { id: string; label: string; email: string };
type ChargerOption = { id: string; label: string; siteName: string; cpoName: string };

type BillingLine = {
  factorCode: string;
  kind: "passthrough" | "markup";
  basisType: "per_kwh" | "per_minute" | "per_day" | "per_session";
  basisQuantity: number;
  unitPriceMinor: string;
  amountExVatMinor: string;
  vatRatePct: number;
  vatAmountMinor: string;
  amountIncVatMinor: string;
  currency: string;
  bearerType: "org" | "usr" | "wrk" | "trd";
  bearerRef: string | null;
  recipientOrgId: string | null;
  recipientUserId: string | null;
  rateRefId: string | null;
  ruleId: string | null;
  computationDetail: Record<string, unknown>;
};

type Granted = {
  granted: true;
  cpoAgreement: { id: string; displayName: string } | null;
  workplaceAgreements: {
    id: string;
    displayName: string;
    counterpartyOrgId: string;
    driverGroupIds: string[];
  }[];
  driverGroup: { id: string; ownerOrgId: string } | null;
  sessionInputs: {
    at: string;
    energyKwh: number;
    durationMinutes: number;
    durationDays: number;
  };
  enlistedFactorCount: number;
  applicableRuleCount: number;
  billingLines: BillingLine[];
};

type Denied = {
  granted: false;
  reason: "no_membership" | string;
  message: string;
  cpoAgreement: { id: string; displayName: string } | null;
  cpoOrgId: string;
};

type Result = Granted | Denied;

export function DebugForm({
  users,
  chargers,
}: {
  users: UserOption[];
  chargers: ChargerOption[];
}) {
  const [userId, setUserId] = useState<string>(users[0]?.id ?? "");
  const [chargerId, setChargerId] = useState<string>(chargers[0]?.id ?? "");
  const [energyKwh, setEnergyKwh] = useState<string>("10");
  const [durationMinutes, setDurationMinutes] = useState<string>("60");
  const [at, setAt] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);

  // Group chargers by CPO+site for nicer optgroups.
  const groupedChargers = useMemo(() => {
    const groups = new Map<string, ChargerOption[]>();
    for (const c of chargers) {
      const key = `${c.cpoName} · ${c.siteName}`;
      const list = groups.get(key) ?? [];
      list.push(c);
      groups.set(key, list);
    }
    return Array.from(groups.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [chargers]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    setResult(null);
    try {
      const body: Record<string, unknown> = {
        userId,
        chargingStationId: chargerId,
        energyKwh: Number(energyKwh) || 0,
        durationMinutes: Number(durationMinutes) || 0,
      };
      if (at) {
        body.at = new Date(at).toISOString();
      }
      const res = await apiFetch("/api/admin/agreements/debug-resolve", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`HTTP ${res.status}: ${text}`);
      }
      const json = (await res.json()) as Result;
      setResult(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-8">
      <form
        onSubmit={onSubmit}
        className="grid grid-cols-1 gap-4 rounded-lg border border-bg-border bg-bg-raised/40 p-5 md:grid-cols-2"
      >
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium uppercase tracking-wide text-ink-400">
            Driver
          </span>
          <select
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
            className="rounded border border-bg-border bg-bg-base px-3 py-2 text-sm text-ink-100"
            required
          >
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.label} ({u.email})
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium uppercase tracking-wide text-ink-400">
            Charger
          </span>
          <select
            value={chargerId}
            onChange={(e) => setChargerId(e.target.value)}
            className="rounded border border-bg-border bg-bg-base px-3 py-2 text-sm text-ink-100"
            required
          >
            {groupedChargers.map(([groupName, list]) => (
              <optgroup key={groupName} label={groupName}>
                {list.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium uppercase tracking-wide text-ink-400">
            Energy (kWh)
          </span>
          <input
            type="number"
            min={0}
            step="0.001"
            value={energyKwh}
            onChange={(e) => setEnergyKwh(e.target.value)}
            className="rounded border border-bg-border bg-bg-base px-3 py-2 text-sm text-ink-100"
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium uppercase tracking-wide text-ink-400">
            Duration (minutes)
          </span>
          <input
            type="number"
            min={0}
            step="1"
            value={durationMinutes}
            onChange={(e) => setDurationMinutes(e.target.value)}
            className="rounded border border-bg-border bg-bg-base px-3 py-2 text-sm text-ink-100"
          />
        </label>

        <label className="flex flex-col gap-1.5 md:col-span-2">
          <span className="text-xs font-medium uppercase tracking-wide text-ink-400">
            Session start time (optional, defaults to now)
          </span>
          <input
            type="datetime-local"
            value={at}
            onChange={(e) => setAt(e.target.value)}
            className="rounded border border-bg-border bg-bg-base px-3 py-2 text-sm text-ink-100"
          />
        </label>

        <div className="md:col-span-2 flex items-center justify-end gap-3 pt-2">
          {error ? (
            <span className="text-sm text-rose-400">{error}</span>
          ) : null}
          <button
            type="submit"
            disabled={submitting || !userId || !chargerId}
            className="rounded bg-sv-sky px-4 py-2 text-sm font-medium text-bg-base disabled:opacity-50"
          >
            {submitting ? "Resolving…" : "Resolve"}
          </button>
        </div>
      </form>

      {result ? <ResultBlock result={result} /> : null}
    </div>
  );
}

function ResultBlock({ result }: { result: Result }) {
  if (!result.granted) {
    return (
      <section className="rounded-lg border border-rose-400/40 bg-rose-400/5 p-5">
        <h2 className="text-lg font-semibold text-rose-300">
          Access denied — {result.reason}
        </h2>
        <p className="mt-2 text-sm text-ink-300">{result.message}</p>
        <dl className="mt-4 grid grid-cols-1 gap-1 text-sm md:grid-cols-2">
          <KV label="CPO ORG id" value={result.cpoOrgId} />
          <KV
            label="CPO Agreement"
            value={
              result.cpoAgreement
                ? `${result.cpoAgreement.displayName} (${result.cpoAgreement.id.slice(0, 8)}…)`
                : "none"
            }
          />
        </dl>
      </section>
    );
  }

  const totals = result.billingLines.reduce(
    (acc, l) => {
      const inc = BigInt(l.amountIncVatMinor);
      acc.byBearer[l.bearerType] = (acc.byBearer[l.bearerType] ?? 0n) + inc;
      acc.total += inc;
      return acc;
    },
    {
      total: 0n,
      byBearer: {} as Record<string, bigint>,
    }
  );

  return (
    <section className="space-y-6">
      <div className="rounded-lg border border-emerald-400/40 bg-emerald-400/5 p-5">
        <h2 className="text-lg font-semibold text-emerald-300">
          Access granted
        </h2>
        <dl className="mt-3 grid grid-cols-1 gap-1 text-sm md:grid-cols-2">
          <KV
            label="CPO Agreement"
            value={
              result.cpoAgreement
                ? `${result.cpoAgreement.displayName}`
                : "none"
            }
          />
          <KV
            label="Workplace agreements"
            value={
              result.workplaceAgreements.length === 0
                ? "none"
                : result.workplaceAgreements
                    .map((a) => a.displayName)
                    .join(", ")
            }
          />
          <KV
            label="DriverGroup"
            value={
              result.driverGroup
                ? `${result.driverGroup.id.slice(0, 8)}… (owner ${result.driverGroup.ownerOrgId.slice(0, 8)}…)`
                : "none"
            }
          />
          <KV
            label="Enlisted factors"
            value={String(result.enlistedFactorCount)}
          />
          <KV
            label="Applicable rules"
            value={String(result.applicableRuleCount)}
          />
          <KV
            label="Inputs"
            value={`${result.sessionInputs.energyKwh} kWh · ${result.sessionInputs.durationMinutes} min · ${new Date(result.sessionInputs.at).toLocaleString()}`}
          />
        </dl>
      </div>

      <div>
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-ink-400">
          Billing lines ({result.billingLines.length})
        </h3>
        {result.billingLines.length === 0 ? (
          <p className="text-sm text-ink-400 italic">
            No lines emitted (no enlisted factor produced an output for
            this session — possibly all rates are missing).
          </p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-bg-border">
            <table className="w-full text-sm">
              <thead className="bg-bg-raised/60 text-xs uppercase text-ink-400">
                <tr>
                  <th className="px-3 py-2 text-left">Factor</th>
                  <th className="px-3 py-2 text-left">Kind</th>
                  <th className="px-3 py-2 text-left">Bearer</th>
                  <th className="px-3 py-2 text-right">Ex-VAT</th>
                  <th className="px-3 py-2 text-right">VAT</th>
                  <th className="px-3 py-2 text-right">Inc-VAT</th>
                  <th className="px-3 py-2 text-left">Recipient</th>
                  <th className="px-3 py-2 text-left">Won by rule</th>
                </tr>
              </thead>
              <tbody>
                {result.billingLines.map((l, i) => (
                  <tr
                    key={`${l.factorCode}-${l.kind}-${i}`}
                    className="border-t border-bg-border"
                  >
                    <td className="px-3 py-2 font-mono text-amber-300">
                      {l.factorCode}
                    </td>
                    <td className="px-3 py-2">
                      <KindBadge kind={l.kind} />
                    </td>
                    <td className="px-3 py-2">
                      <BearerBadge bearer={l.bearerType} />
                    </td>
                    <td className="px-3 py-2 text-right font-mono">
                      {formatMinor(l.amountExVatMinor, l.currency)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-ink-400">
                      {formatMinor(l.vatAmountMinor, l.currency)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono font-semibold">
                      {formatMinor(l.amountIncVatMinor, l.currency)}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs text-ink-400">
                      {recipientLabel(l)}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs text-ink-400">
                      {l.ruleId
                        ? l.ruleId.slice(0, 8) + "…"
                        : <span className="italic">default</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-bg-border bg-bg-raised/30">
                  <td colSpan={5} className="px-3 py-2 text-right text-xs uppercase tracking-wide text-ink-400">
                    Total
                  </td>
                  <td className="px-3 py-2 text-right font-mono font-bold text-ink-50">
                    {formatMinor(totals.total.toString(), result.billingLines[0]?.currency ?? "ISK")}
                  </td>
                  <td colSpan={2} />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>

      <div>
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-ink-400">
          Roll-up by bearer
        </h3>
        <ul className="space-y-1 font-mono text-sm">
          {Object.entries(totals.byBearer).map(([bearer, amt]) => (
            <li key={bearer} className="flex items-center gap-3">
              <BearerBadge bearer={bearer as BillingLine["bearerType"]} />
              <span className="text-ink-200">
                {formatMinor(amt.toString(), result.billingLines[0]?.currency ?? "ISK")}
              </span>
            </li>
          ))}
        </ul>
      </div>

      <details className="rounded-lg border border-bg-border bg-bg-raised/20 p-4">
        <summary className="cursor-pointer text-sm font-medium text-ink-300">
          Raw response (audit trail per line)
        </summary>
        <pre className="mt-3 max-h-96 overflow-auto rounded bg-bg-base/50 p-3 text-xs text-ink-300">
          {JSON.stringify(result, null, 2)}
        </pre>
      </details>
    </section>
  );
}

function KV({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-wrap gap-2">
      <dt className="text-ink-400">{label}:</dt>
      <dd className="text-ink-100 font-mono">{value}</dd>
    </div>
  );
}

function KindBadge({ kind }: { kind: BillingLine["kind"] }) {
  const cls =
    kind === "passthrough"
      ? "bg-sv-sky/15 text-sv-sky ring-sv-sky/30"
      : "bg-amber-400/15 text-amber-300 ring-amber-400/30";
  return (
    <span
      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${cls}`}
    >
      {kind}
    </span>
  );
}

function BearerBadge({ bearer }: { bearer: BillingLine["bearerType"] }) {
  const map: Record<BillingLine["bearerType"], string> = {
    org: "bg-sv-sky/15 text-sv-sky ring-sv-sky/30",
    usr: "bg-rose-400/15 text-rose-300 ring-rose-400/30",
    wrk: "bg-emerald-400/15 text-emerald-300 ring-emerald-400/30",
    trd: "bg-purple-400/15 text-purple-300 ring-purple-400/30",
  };
  return (
    <span
      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-mono uppercase ring-1 ring-inset ${map[bearer]}`}
    >
      {bearer}
    </span>
  );
}

function recipientLabel(l: BillingLine): string {
  if (l.recipientOrgId) return `org ${l.recipientOrgId.slice(0, 8)}…`;
  if (l.recipientUserId) return `user ${l.recipientUserId.slice(0, 8)}…`;
  return "—";
}

function formatMinor(minorStr: string, currency: string): string {
  const minor = BigInt(minorStr);
  const negative = minor < 0n;
  const abs = negative ? -minor : minor;
  const major = abs / 100n;
  const cents = abs % 100n;
  const formatted = `${major.toString()}.${cents.toString().padStart(2, "0")}`;
  return `${negative ? "−" : ""}${formatted} ${currency}`;
}
