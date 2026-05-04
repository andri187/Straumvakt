// Contract detail page — Sprint 8.13. Read-side view + edit panel +
// delete action. Edit covers displayName, status, validFrom/Until.
// Cost-factor assignments and contract hierarchy are deferred to the
// Sprint 9 ADR for Contract enrichment.

import Link from "next/link";
import { notFound } from "next/navigation";
import { apiFetchServer } from "@/lib/api-client-server";
import type {
  ContractSummary,
  ContractTariffSummary,
} from "@straumvakt/shared/domain/contracts";
import { DeleteButton } from "@/components/delete-button";
import { ContractEditPanel } from "./edit-panel";

export const dynamic = "force-dynamic";
export const metadata = { title: "Contract" };

function formatRate(minor: string | null, vat: number | null): string {
  if (minor === null) return "—";
  const ex = Number(minor) / 100;
  if (vat === null) return `${ex.toFixed(2)} kr/kWh ex-VAT`;
  const inc = ex * (1 + vat / 100);
  return `${ex.toFixed(2)} ex-VAT  ·  ${inc.toFixed(2)} inc ${vat}% VAT`;
}

export default async function ContractDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [res, tariffsRes] = await Promise.all([
    apiFetchServer(`/api/admin/contracts/${id}`),
    apiFetchServer(`/api/admin/contracts/${id}/tariffs`),
  ]);
  if (res.status === 404) notFound();
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const { contract } = (await res.json()) as { contract: ContractSummary };
  const tariffs = tariffsRes.ok
    ? ((await tariffsRes.json()) as { tariffs: ContractTariffSummary }).tariffs
    : { dso: null, retailers: [] };

  const scopeHref =
    contract.scopeType === "site" && contract.scopeId
      ? `/sites/${contract.scopeId}`
      : contract.scopeType === "installation" && contract.scopeId
        ? `/installations/${contract.scopeId}`
        : null;

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <Link
        href={"/billing/contracts" as Parameters<typeof Link>[0]["href"]}
        className="mb-4 inline-block text-xs text-ink-400 hover:text-sv-sky"
      >
        ← Back to contracts
      </Link>

      <header className="mb-6 border-b border-bg-border pb-4">
        <h1 className="text-2xl font-semibold text-ink-50">
          {contract.displayName}
        </h1>
        <p className="mt-1 text-sm text-ink-400">
          Owner{" "}
          <Link
            href={
              `/accounts/organizations/${contract.orgId}` as Parameters<typeof Link>[0]["href"]
            }
            className="text-sv-sky hover:underline"
          >
            {contract.orgDisplayName}
          </Link>
          {contract.counterpartyOrgId && contract.counterpartyOrgDisplayName && (
            <>
              {" "}
              ↔ Counterparty{" "}
              <Link
                href={
                  `/accounts/organizations/${contract.counterpartyOrgId}` as Parameters<typeof Link>[0]["href"]
                }
                className="text-sv-sky hover:underline"
              >
                {contract.counterpartyOrgDisplayName}
              </Link>
            </>
          )}
          {" · "}Scope <span className="font-mono text-ink-300">{contract.scopeType}</span>
          {scopeHref && contract.scopeDisplayName && (
            <>
              {" "}
              ·{" "}
              <Link
                href={scopeHref as Parameters<typeof Link>[0]["href"]}
                className="text-sv-sky hover:underline"
              >
                {contract.scopeDisplayName}
              </Link>
            </>
          )}
        </p>
        <p className="mt-1 font-mono text-[10px] text-ink-500">{contract.id}</p>
      </header>

      <ContractEditPanel
        contractId={contract.id}
        initial={{
          displayName: contract.displayName,
          status: contract.status,
          validFrom: contract.validFrom.slice(0, 10),
          validUntil: contract.validUntil ? contract.validUntil.slice(0, 10) : "",
        }}
      />

      <section className="mt-8 rounded-lg border border-bg-border bg-bg-base/30 p-4">
        <h2 className="mb-3 text-sm font-semibold text-ink-50">
          Rates by contract scope
        </h2>
        <p className="mb-3 text-[11px] text-ink-500">
          DSO is anchored on the parent site. Each installation under
          the scope carries its own retailer rate (typically the same
          across an installation set, but can vary).
        </p>

        <div className="mb-4">
          <h3 className="mb-2 text-[11px] uppercase tracking-brand text-ink-400">
            DSO (distribution)
          </h3>
          {tariffs.dso ? (
            <div className="rounded border border-bg-border/60 bg-bg-base/20 px-3 py-2 text-xs">
              <div className="flex items-baseline gap-2">
                <span className="font-medium text-ink-100">
                  {tariffs.dso.tariffDisplayName}
                </span>
                <span className="text-[10px] text-ink-500">
                  Site:{" "}
                  <Link
                    href={
                      `/sites/${tariffs.dso.siteId}` as Parameters<typeof Link>[0]["href"]
                    }
                    className="text-sv-sky hover:underline"
                  >
                    {tariffs.dso.siteDisplayName}
                  </Link>
                </span>
              </div>
              <div className="mt-1 font-mono text-[11px] text-ink-300">
                {formatRate(tariffs.dso.pricePerKwhMinor, tariffs.dso.vatRatePct)}
              </div>
            </div>
          ) : (
            <p className="rounded border border-dashed border-amber-700/40 bg-amber-950/10 px-3 py-2 text-[11px] text-amber-300">
              No DSO bound on the contract&apos;s parent site. Will throw
              <span className="font-mono"> dso_tariff_unconfigured</span> at session-stop.
            </p>
          )}
        </div>

        <div>
          <h3 className="mb-2 text-[11px] uppercase tracking-brand text-ink-400">
            Retailer (electricity)
          </h3>
          {tariffs.retailers.length === 0 ? (
            <p className="rounded border border-dashed border-bg-border/60 bg-bg-base/20 px-3 py-2 text-[11px] text-ink-500">
              No installations under this scope, or scope type doesn&apos;t resolve retailers.
            </p>
          ) : (
            <ul className="space-y-1.5">
              {tariffs.retailers.map((r) => (
                <li
                  key={r.installationId}
                  className="rounded border border-bg-border/60 bg-bg-base/20 px-3 py-2 text-xs"
                >
                  <div className="flex items-baseline gap-2">
                    <Link
                      href={
                        `/installations/${r.installationId}` as Parameters<typeof Link>[0]["href"]
                      }
                      className="font-medium text-ink-100 hover:text-sv-sky"
                    >
                      {r.installationDisplayName}
                    </Link>
                    {r.tariffDisplayName ? (
                      <span className="text-[10px] text-ink-500">
                        {r.tariffDisplayName}
                      </span>
                    ) : (
                      <span className="rounded bg-amber-950/30 px-1.5 py-0.5 text-[10px] uppercase text-amber-300">
                        not bound
                      </span>
                    )}
                  </div>
                  <div className="mt-1 font-mono text-[11px] text-ink-300">
                    {formatRate(r.pricePerKwhMinor, r.vatRatePct)}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        {tariffs.dso && tariffs.retailers.length > 0 && (
          <p className="mt-3 text-[11px] text-emerald-300">
            All-in for the canonical installation (DSO + first retailer):{" "}
            <span className="font-mono">
              {(() => {
                const dso = tariffs.dso;
                const ret = tariffs.retailers[0];
                if (
                  !ret.pricePerKwhMinor ||
                  !dso.pricePerKwhMinor ||
                  ret.vatRatePct === null ||
                  dso.vatRatePct === null
                ) {
                  return "—";
                }
                const sub =
                  Number(dso.pricePerKwhMinor) + Number(ret.pricePerKwhMinor);
                const inc = (sub / 100) * (1 + ret.vatRatePct / 100);
                return `${inc.toFixed(2)} kr/kWh inc-VAT`;
              })()}
            </span>
          </p>
        )}
      </section>

      <section className="mt-6 rounded-lg border border-bg-border bg-bg-base/30 p-4">
        <h2 className="mb-3 text-sm font-semibold text-ink-50">
          Read-only metadata
        </h2>
        <dl className="grid grid-cols-[10rem_1fr] gap-x-3 gap-y-1.5 text-xs">
          <dt className="text-ink-500">Parent contract</dt>
          <dd className="font-mono text-[10px] text-ink-300">
            {contract.parentContractId ?? "—"}
          </dd>
          <dt className="text-ink-500">Created</dt>
          <dd className="text-ink-300">
            {new Date(contract.createdAt).toLocaleString()}
          </dd>
          <dt className="text-ink-500">Last updated</dt>
          <dd className="text-ink-300">
            {new Date(contract.updatedAt).toLocaleString()}
          </dd>
        </dl>
        <p className="mt-3 text-[11px] text-ink-500">
          Cost-factor assignments, period accumulators, and counterparty
          linking land in the Sprint 9 Contract enrichment. Today this is
          scaffolding scoped to a site/installation/charger.
        </p>
      </section>

      <section className="mt-6 rounded-lg border border-rose-700/30 bg-rose-950/10 p-4">
        <div className="flex items-baseline justify-between gap-4">
          <div>
            <h2 className="text-sm font-semibold text-rose-200">Danger zone</h2>
            <p className="mt-1 text-xs text-rose-300/80">
              Deleting this contract removes its row + any
              factor assignments / period accumulators (cascade).
              Historical sessions stay attributed; nothing in
              session_ledger reads from contracts today.
            </p>
          </div>
          <DeleteButton
            endpoint={`/api/admin/contracts/${contract.id}`}
            redirectTo="/billing/contracts"
            confirmText={`Delete contract "${contract.displayName}"? This cannot be undone.`}
            label="Delete contract"
          />
        </div>
      </section>
    </div>
  );
}
