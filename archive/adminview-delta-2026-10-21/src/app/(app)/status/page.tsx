// Internal project status board — where the build actually stands.
//
// Parked at /status rather than /dashboard: that route is the operator
// product page ("One place to run chargers, people, power, and billing")
// and is what hosts land on after login. This is scaffolding for building
// Straumvakt, not part of it. It sits inside the (app) group so it
// inherits the same auth gate as every other page there.
//
// STATIC FOR NOW. Every number below is a snapshot taken 2026-08-03 from
// the test branch (br-withered-hat-abtc5gzi) and will decay. The intended
// next step is to derive them live:
//
//   sessions / attribution / orphan idTags  → charging.sessions
//   migration state                          → _prisma_migrations vs disk
//   ADR statuses                             → docs/adr/*.md status lines
//   schema map                               → prisma/schema.prisma at build
//
// Kept deliberately dependency-free — no mermaid, no chart library — so
// it costs the bundle nothing.

export const metadata = { title: "Project status" };

const SNAPSHOT = "2026-08-03";

type Tone = "good" | "warn" | "crit" | "idle";

const tone: Record<Tone, string> = {
  good: "border-emerald-600/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  warn: "border-amber-600/40 bg-amber-500/10 text-amber-700 dark:text-amber-400",
  crit: "border-red-600/40 bg-red-500/10 text-red-700 dark:text-red-400",
  idle: "border-neutral-500/30 bg-neutral-500/10 text-neutral-500",
};

function Pill({ t, children }: { t: Tone; children: React.ReactNode }) {
  return (
    <span
      className={`shrink-0 whitespace-nowrap border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider ${tone[t]}`}
    >
      {children}
    </span>
  );
}

function Panel({
  title,
  meta,
  children,
}: {
  title: string;
  meta?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
      <div className="flex items-baseline justify-between gap-3 border-b border-neutral-200 px-4 py-3 dark:border-neutral-800">
        <h2 className="text-xs font-semibold uppercase tracking-widest text-neutral-600 dark:text-neutral-400">
          {title}
        </h2>
        {meta ? (
          <span className="font-mono text-[11px] tabular-nums text-neutral-400">
            {meta}
          </span>
        ) : null}
      </div>
      {children}
    </section>
  );
}

function Row({
  id,
  children,
  t,
  pill,
}: {
  id: string;
  children: React.ReactNode;
  t: Tone;
  pill: string;
}) {
  return (
    <div className="grid grid-cols-[130px_1fr_auto] items-baseline gap-3 border-b border-neutral-100 px-4 py-2.5 last:border-b-0 dark:border-neutral-800/60">
      <span className="font-mono text-xs text-neutral-400">{id}</span>
      <span className="text-[13.5px] leading-snug">{children}</span>
      <Pill t={t}>{pill}</Pill>
    </div>
  );
}

function Stat({ n, k, hl }: { n: string; k: string; hl?: boolean }) {
  return (
    <div className="flex flex-col gap-0.5 border-b border-r border-neutral-100 px-4 py-3 dark:border-neutral-800/60">
      <span
        className={`font-mono text-lg font-semibold tabular-nums tracking-tight ${
          hl ? "text-amber-700 dark:text-amber-400" : ""
        }`}
      >
        {n}
      </span>
      <span className="text-[11.5px] leading-tight text-neutral-500">{k}</span>
    </div>
  );
}

export default function StatusPage() {
  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6 px-5 py-8">
      <header className="flex flex-col gap-1 border-b border-neutral-200 pb-4 dark:border-neutral-800">
        <h1 className="text-xl font-semibold tracking-tight">
          Where the build stands
        </h1>
        <p className="font-mono text-xs text-neutral-400">
          snapshot {SNAPSHOT} · branch dev/p4-c-ingest-integrity · not
          auto-updating yet
        </p>
      </header>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="border border-red-600/40 bg-red-500/5 px-4 py-3">
          <div className="font-mono text-[10.5px] uppercase tracking-widest text-red-700 dark:text-red-400">
            Deadline · 6 days
          </div>
          <div className="mt-1 text-base font-semibold">2026-08-09</div>
          <p className="mt-1 text-xs leading-snug text-neutral-500">
            Forward partitions on protocol_log run out.
          </p>
        </div>
        <div className="border border-neutral-200 px-4 py-3 dark:border-neutral-800">
          <div className="font-mono text-[10.5px] uppercase tracking-widest text-neutral-400">
            Deployed
          </div>
          <div className="mt-1 text-base font-semibold">Nothing since 3 Aug</div>
          <p className="mt-1 text-xs leading-snug text-neutral-500">
            All work committed and pushed; Cloudflare runs the previous build.
          </p>
        </div>
        <div className="border border-neutral-200 px-4 py-3 dark:border-neutral-800">
          <div className="font-mono text-[10.5px] uppercase tracking-widest text-neutral-400">
            Deploy order
          </div>
          <div className="mt-1 text-base font-semibold">Gateway → API → Web</div>
          <p className="mt-1 text-xs leading-snug text-neutral-500">
            Reversed, OCMF frames get marked raw_protocol and land in the
            short-retention table.
          </p>
        </div>
      </div>

      <Panel title="What the database holds" meta="test branch · 3 Aug">
        <div className="grid grid-cols-2 sm:grid-cols-5">
          <Stat n="1,566" k="charge sessions" />
          <Stat n="22" k="with a driver attached" hl />
          <Stat n="25" k="idTags matching no token" />
          <Stat n="2" k="tokens in total" />
          <Stat n="31" k="chargers" />
          <Stat n="7" k="circuits, all flat" />
          <Stat n="3" k="users · 2 with no org" />
          <Stat n="0" k="agreements, tariffs, invoices" hl />
          <Stat n="347,133" k="heartbeat rows" />
          <Stat n="6,321" k="OCMF rows reclassified" />
        </div>
      </Panel>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Decisions" meta="6 accepted · 1 part · 1 held">
          <Row id="0031" t="good" pill="accepted">
            Straumvakt is agent, host is principal
          </Row>
          <Row id="0037" t="good" pill="accepted">
            Retention class in the R2 key
          </Row>
          <Row id="0039" t="good" pill="accepted">
            Protocol log split from event log
          </Row>
          <Row id="0040" t="good" pill="accepted">
            Tier by volume, not age
          </Row>
          <Row id="0043" t="good" pill="accepted">
            Drivers can exist with no org
          </Row>
          <Row id="0045" t="good" pill="accepted">
            Circuits become a graph
          </Row>
          <Row id="0044" t="warn" pill="in part">
            Token kinds &amp; app capabilities —{" "}
            <span className="text-neutral-500">
              D3 struck, D1/D2 wait on 0038
            </span>
          </Row>
          <Row id="0042" t="crit" pill="held">
            Driver identity —{" "}
            <span className="text-neutral-500">no user has a kennitala</span>
          </Row>
        </Panel>

        <Panel title="Schema audit" meta="1 of 10 fixed">
          <Row id="F2" t="good" pill="fixed">
            tap_intents foreign keys
          </Row>
          <Row id="F1" t="crit" pill="open">
            Kennitala rule unenforced — nobody owns the invoice
          </Row>
          <Row id="F3" t="crit" pill="open">
            OcppIdentity not unique — cross-tenant writes
          </Row>
          <Row id="F4" t="warn" pill="open">
            Rate references overlap; two readers disagree
          </Row>
          <Row id="F5" t="warn" pill="open">
            Arbitrary agreement pick decides who is billed
          </Row>
          <Row id="F6" t="warn" pill="open">
            Financial tables carry refs with no FK
          </Row>
          <Row id="F7–10" t="idle" pill="open">
            Cascade risk, missing index, duplicate pendings
          </Row>
        </Panel>
      </div>

      <Panel title="Migrations not yet applied to staging" meta="1 ready · 5 unwritten">
        <Row id="ready" t="good" pill="deploy">
          tap_intents foreign keys —{" "}
          <span className="text-neutral-500">
            tested on the test branch, all four verified
          </span>
        </Row>
        <Row id="next" t="idle" pill="to write">
          sessions.id_token_id — so a CDR keeps its RFID label after a card is
          revoked
        </Row>
        <Row id="next" t="idle" pill="to write">
          Autocharge / Plug &amp; Charge kinds, in OCPP 2.0.1 vocabulary
        </Row>
        <Row id="next" t="idle" pill="to write">
          Drop app_jwt and magic_link —{" "}
          <span className="text-neutral-500">verified zero rows</span>
        </Row>
        <Row id="next" t="idle" pill="to write">
          Unique on OcppIdentity(vendor, resourceId)
        </Row>
        <Row id="next" t="idle" pill="to write">
          circuits.parent_circuit_id — nullable, left unpopulated
        </Row>
      </Panel>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Driver creation" meta="1 of 5 correct">
          <Row id="registration" t="good" pill="issues token">
            self-enrollment
          </Row>
          <Row id="users" t="crit" pill="no token">
            admin creates
          </Row>
          <Row id="invites" t="crit" pill="no token">
            invite consumed
          </Row>
          <Row id="host-invites" t="crit" pill="no token">
            host invite consumed
          </Row>
          <Row id="bootstrap" t="idle" pill="n/a">
            first run —{" "}
            <span className="text-neutral-500">creates an operator</span>
          </Row>
          <Row id="createDriver" t="warn" pill="unwired">
            the single source of truth —{" "}
            <span className="text-neutral-500">
              written, compiles, nothing calls it
            </span>
          </Row>
        </Panel>

        <Panel title="The open question" meta="blocks the billing rebuild">
          <div className="flex flex-col gap-2.5 px-4 py-4 text-[13.5px] leading-relaxed text-neutral-600 dark:text-neutral-400">
            <p>
              The billing layer exists in{" "}
              <strong className="text-neutral-900 dark:text-neutral-100">
                three generations
              </strong>
              : an old Tariff/Invoice layer, a Contract family, and an Agreement
              family. The same concept is modelled three times.
            </p>
            <p>
              All of them are{" "}
              <strong className="text-neutral-900 dark:text-neutral-100">
                empty
              </strong>
              . Nothing to migrate, nothing to preserve.
            </p>
            <p>
              ADR 0031 was amended 2026-06-14 with per-factor forwarding and
              markup rules, described in terms of clauses and composable roles —
              vocabulary matching the Agreement family. So:{" "}
              <strong className="text-neutral-900 dark:text-neutral-100">
                does Agreement implement that amendment?
              </strong>{" "}
              If yes, delete the other two.
            </p>
            <p className="text-neutral-500">
              This window closes the day a real customer generates an invoice.
            </p>
          </div>
        </Panel>
      </div>

      <footer className="font-mono text-[11px] leading-relaxed text-neutral-400">
        Fixed 3 Aug — typecheck covered a third of the codebase and now covers
        all of it · the two Prisma schemas had silently drifted · three
        migrations were applied by hand and never recorded, which would have
        broken every migration after them.
        <br />
        Partition drop stays dry-run until PARTITION_DROP_ENABLED is set
        deliberately.
      </footer>
    </div>
  );
}
