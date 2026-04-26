import type { IcelandRole, Party } from "@/lib/reference/iceland-parties";

const ROLE_BADGE_COLORS: Record<IcelandRole, string> = {
  retailer: "bg-amber-950/40 text-amber-300 border-amber-700/40",
  dso: "bg-sky-950/40 text-sky-300 border-sky-700/40",
  tso: "bg-violet-950/40 text-violet-300 border-violet-700/40",
  producer: "bg-emerald-950/40 text-emerald-300 border-emerald-700/40",
  public_charging: "bg-rose-950/40 text-rose-300 border-rose-700/40",
  home_charging: "bg-teal-950/40 text-teal-300 border-teal-700/40",
  aggregator: "bg-slate-800/60 text-slate-300 border-slate-700/40",
};

const ROLE_LABEL: Record<IcelandRole, string> = {
  retailer: "retailer",
  dso: "DSO",
  tso: "TSO",
  producer: "producer",
  public_charging: "public CPO",
  home_charging: "rental",
  aggregator: "aggregator",
};

export function PartyCard({
  party,
  highlightRole,
}: {
  party: Party;
  highlightRole: IcelandRole;
}) {
  const reg = party.addresses?.registered;
  const region = reg?.municipality ?? null;
  const tariffCount = party.tariff_items?.length ?? 0;

  return (
    <article className="rounded-lg border border-bg-border bg-bg-surface/70 p-5 shadow-card backdrop-blur">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-base font-semibold text-ink-50">
            {party.trade_name}
          </h3>
          <p className="mt-0.5 text-xs text-ink-300">{party.legal_name}</p>
        </div>
        <div className="flex flex-wrap justify-end gap-1">
          {party.roles.map((r) => (
            <span
              key={r}
              className={
                "inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-medium " +
                ROLE_BADGE_COLORS[r] +
                (r === highlightRole ? " ring-1 ring-sv-sky/40" : "")
              }
            >
              {ROLE_LABEL[r]}
            </span>
          ))}
        </div>
      </header>

      <dl className="mt-4 grid gap-x-4 gap-y-1.5 text-xs sm:grid-cols-[110px_1fr]">
        {party.kennitala && (
          <>
            <dt className="text-ink-500">Kennitala</dt>
            <dd className="font-mono text-ink-200">{party.kennitala}</dd>
          </>
        )}
        {region && (
          <>
            <dt className="text-ink-500">Region</dt>
            <dd className="text-ink-200">{region}</dd>
          </>
        )}
        {party.contacts?.website && (
          <>
            <dt className="text-ink-500">Website</dt>
            <dd className="truncate">
              <a
                href={party.contacts.website}
                target="_blank"
                rel="noreferrer"
                className="text-sv-green hover:text-sv-sky"
              >
                {party.contacts.website.replace(/^https?:\/\//, "")}
              </a>
            </dd>
          </>
        )}
        {party.contacts?.phone_main && (
          <>
            <dt className="text-ink-500">Phone</dt>
            <dd className="font-mono text-ink-200">
              {party.contacts.phone_main}
            </dd>
          </>
        )}
        {party.tariff_source?.url && (
          <>
            <dt className="text-ink-500">Tariff source</dt>
            <dd className="truncate">
              <a
                href={party.tariff_source.url}
                target="_blank"
                rel="noreferrer"
                className="text-sv-green hover:text-sv-sky"
              >
                {tariffCount > 0
                  ? `${tariffCount} item${tariffCount === 1 ? "" : "s"}`
                  : "Source"}{" "}
                ↗
              </a>
              {party.tariff_source.verified_on && (
                <span className="ml-2 text-ink-500">
                  verified {party.tariff_source.verified_on}
                </span>
              )}
            </dd>
          </>
        )}
      </dl>

      {party.notes && (
        <p className="mt-3 border-t border-bg-border/40 pt-3 text-xs text-ink-400">
          {party.notes}
        </p>
      )}
    </article>
  );
}

export function CatalogueMissingNotice() {
  return (
    <section className="rounded-lg border border-amber-700/40 bg-amber-950/20 p-5 shadow-card backdrop-blur">
      <h2 className="text-xs font-semibold uppercase tracking-brand text-amber-300">
        Catalogue not found
      </h2>
      <p className="mt-2 text-sm text-ink-100">
        Could not load{" "}
        <code className="font-mono text-xs">
          docs/reference/iceland-energy-parties.json
        </code>
        . The Reference subsection pages filter from this catalogue —
        check the file is in place.
      </p>
    </section>
  );
}
