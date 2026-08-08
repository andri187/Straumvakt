# FOCUS — Straumvakt active canon

**This is the document you read to start. Read this and CLAUDE.md's safety
rules (1–4). Nothing else is required.**

Adopted 2026-08-07. Supersedes the ADR corpus and the architecture planning
documents as *active* canon — see [Legacy](#legacy) at the bottom. Nothing was
deleted; the lineage of every rule below is cited.

---

## The eight focus rules

### 1. The current code is the baseline

Build forward on what exists. **Architecture is not re-litigated.** If a
question is already answered by working code, the code is the answer.

> **Why:** `SCOPE_2026-08-04.md` measured the failure mode. In one session,
> **nine things were found already built that nobody knew about**, and three
> ADRs were written duplicating ground ten others already covered. **45 ADRs
> exceed what one person can hold**, so each new question got answered fresh
> instead of looked up — *"that is how three billing generations happened;
> nobody decided to model billing three times."* This rule is the cure.
>
> *Extracted from: `docs/architecture/SCOPE_2026-08-04.md` §the discovery
> problem.*

#### Exception — Prisma is not part of the baseline

**Touch it, convert it.** Anything you edit on the way to market moves from
Prisma to Drizzle in the same change. Not a scheduled big-bang port, and not
"leave it, it works" either.

This is a deliberate, standing exception to rules 1 and 8, decided once so it
never has to be decided again:

- It **contradicts rule 1** because Prisma *is* working code — and we are
  going to change it anyway. **We no longer define ourselves by Prisma.** It
  is a migration in flight, not a baseline to accept.
- It **contradicts rule 8** only in appearance. This is one standing decision,
  not a decision per file. Nobody re-argues it at the top of each file.

The discipline that makes it safe is unchanged and non-negotiable:

- **Repository before route.** A route cannot lead its repository; the
  typecheck will catch it, but the revert costs more than the pause.
- **The ingest path and the money path fail silently.** Those keep parity or
  rolled-back-real-DB coverage per file. Everything else can be fixed on
  sight.
- The traps are written down — see `docs/reference/prisma-to-drizzle-*.md`.
  Read them before the first translation, not after the first bug.

#### The harvest protocol — how we build

**Harvest into a clean shell.** Not a rewrite, and not building on top of the
tangle. Proven components move into clean packages **keeping their earned
correctness**; the old path keeps running until the clean one has parity.
There is no parity cliff and no big-bang cutover.

1. **Copy proven code into the clean package. Keep the old path running.**
   Extraction is copy-then-re-export: the old location re-exports the new one,
   so no caller breaks and nothing is deleted.
2. **Point NEW callers at the clean package.** Old callers move when they are
   next touched — same touch-it-convert-it rule, same reason.
3. **Retire the old path only after the clean path has parity coverage** on
   any surface that can fail silently. A surface that fails loudly can be
   fixed on sight; one that fails silently cannot, so it earns a test first.
4. **Conversions land on the right side of the hybrid** — Drizzle for the
   control plane, raw SQL for the hot path (rule 7) — and keep vendors at the
   edge (rule 6). A harvest that lands code on the wrong side of either is a
   harvest that has to be done twice.
5. **Never re-implement a proven component from scratch.** Harvest means
   *move, preserving correctness*. Working code carries bugs already found and
   fixed; a rewrite reintroduces every one of them, and you will not know
   which until a customer does.

> **Why this and not a rebuild:** the agreements resolver took three attempts
> and three months of silent failure to get right — a case mismatch that
> rejected every clause in the database, two mis-pointed suppliers, a window
> that could never drain a backlog. None of that is visible in the source. It
> is only visible in the fact that the code now works.

### 2. The four safety rules stand, unchanged

Branch and deploy safety · secrets · database operations · fragile
infrastructure files. **They never relax**, and when a rule's application is
ambiguous the default is always stop-and-ask.

They live in CLAUDE.md and are quoted nowhere else on purpose — one copy, no
drift.

> *Extracted from: `CLAUDE.md` Rules 1–4 (all CRITICAL) and the
> "If you're unsure" clause.*

### 3. One money ENGINE — but two money lines, and only one of them is ours

**One pipeline shape: CDR → priced ledger → invoice, on the agreements
engine.** There is never a second billing path, and never a "temporary" one.

**But there are two distinct money lines, and conflating them is the mistake
this rule exists to prevent:**

| line | whose money | Straumvakt's posture | market phase |
|---|---|---|---|
| **host ↔ driver** | **the host's** | **agent** — Straumvakt presents the claim *on the host's behalf* (kröfuhafi is the host, rendered "Straumvakt f.h. \<host\>") and remits | **deferred** — needs attribution |
| **Straumvakt ↔ host** | **Straumvakt's** | principal, on its own invoice | **this is the market line** |

**The flat connector fee is the second line.** Straumvakt → host, per
connector, billed to the org. It is Straumvakt's own revenue, which is why it
ships first: it needs no driver attribution, and it does not require us to
handle anyone else's money.

It is implemented as a **degenerate agreement** — one cost factor, one rate
reference — not as a shortcut around the engine.

> **Why the distinction is load-bearing:** money we merely *present* carries
> obligations money we *earn* does not — VAT posture, remittance, and whose
> name is on the claim all differ. A pipeline that cannot tell them apart will
> get the invoice header wrong, and the invoice header is the legal artefact.
>
> **Why one engine:** three billing generations already exist. ADR 0048
> measured them and chose — the agreements generation survives, legacy
> retires. A fourth path, even a simple one, would be the most expensive
> shortcut available. Two *lines* through one *engine* is the correct shape;
> two engines is not.
>
> *Extracted from: ADR 0048 (supersedes ADR 0025); ADR 0031 Q2.1 (Straumvakt's
> revenue = the Straumvakt → host service fee) + its 2026-06-14 amendment
> (host is principal on driver-facing money; agent posture; per-factor
> markup).*

### 4. The CDR is the record; money is derived from it, never destructively

The event log and the CDR are evidence. Prices are **computed from** them and
written alongside — an amount is never edited in place, and a session's
record is never rewritten to make an invoice come out right.

> *Extracted from: ADR 0049.*

### 5. Tenancy in every row and every query

`org_id` on the row, `org_id` in the query. Every repository function takes
tenant scope. A query without it is a bug, not a shortcut.

> *Extracted from: Architecture V3 principle 3; CLAUDE.md Rule 7
> (repository + mapper).*

### 6. Vendors stay at the edge; OCPP stays generic

No new vendor identifier in `core`. **The dependency-cruiser ratchet stays
green** — baseline entries may be *removed*, never added. The OCPP engine
knows the protocol, not the vendor.

> **Why:** an adapter in a model makes the slowest-changing layer depend on
> the fastest-changing external dependency. Easee is when that bill comes due.
>
> *Extracted from: `docs/notes/2026-08-04-target-domain-tree.md` §Vendors;
> enforced by `.dependency-cruiser.cjs` — **leave the ratchet alone**.*

### 7. Drizzle owns the schema; raw SQL owns the hot path

**The schema is the asset; the ORM is an accessor.** Schema changes start in
`packages/db` (today `packages/shared/src/db`), and `drizzle-kit` writes the
migration.

The hot ingest path stays **raw SQL**. ADR 0051 swapped which ORM owns the
schema; it did **not** repeal the hybrid boundary, which exists because
per-row ORM writes were measured as insufficient at 4k chargers.

Never run `drizzle-kit push`.

> *Extracted from: ADR 0051 (Drizzle owns the schema) + ADR 0018 Decision 2
> (hybrid ORM boundary, still in force).*

### 8. Decisions are lightweight now

**One line in `DECISIONS.md`.** Not a new ADR per choice.

Green `tsc` and green build before merge. Write an ADR only when a decision
is genuinely load-bearing and irreversible — and expect that to be rare.

> **Why:** the ADR-per-decision ceremony is precisely what produced the corpus
> being retired. 51 documents nobody can hold is not a memory aid.
>
> *Extracted from: the failure mode named in `SCOPE_2026-08-04.md`;
> supersedes CLAUDE.md Rule 11 (sprint discipline / ADR-per-scope-change) for
> the market phase.*

---

## Current-state baseline

**This is the foundation we build ON — not aspiration.**

Straumvakt today is a deployed, multi-service charging platform, not a
mockup. A **Next.js operator console** and a **Hono/Cloudflare Worker API**
run against multi-schema Neon Postgres. A **separate OCPP 1.6 gateway
Worker** terminates charger WebSockets with a Durable Object per charger
identity and delivers events through Cloudflare Queues — this is the generic
OCPP metering and authorisation path, and it is real: ~21 chargers write to
it continuously. The **asset chain** (property → site → charging station →
EVSE → connector, with the circuit graph alongside) exists and is populated.
**Sessions and CDRs** are recorded, including OCMF-signed metering held from
the vendor CDR feed. The **agreements engine** — parties, agreements,
clauses, cost factors, rate references — exists and, as of 2026-08-07,
**emits priced billing lines on the test branch** (ADR 0048). **Org, identity
and tenancy** are in place with composable, admin-set organisation roles. A
**Flutter driver app** runs against staging.

What is uneven is uneven honestly: the backend anticipates more product than
is demonstrated end-to-end, and several surfaces are visual previews rather
than working flows. That is what the parked list below is for.

---

## Active workstreams

**These two are the only live track.**

### A. Onboarding

```
org self-enrols
  → org created (roles set by Straumvakt admin)
    → invite / enrol users
      → attach existing chargers
        → set the flat-fee agreement
```

One path, end to end. Not seven.

### B. CDR → invoice ledger

```
session ends
  → CDR recorded
    → priced line in the ledger
      → month-end invoice  (bulk-to-org, or invoice-on-behalf)
```

The flat-fee path bills **per connector, to the org**, and therefore needs
**no driver attribution** — which is what makes it shippable now.

### The Drizzle port is not a workstream

It has no scope of its own and no completion date to negotiate. **Rule 1's
exception governs it: touch it, convert it.** The port completes as a
by-product of the two workstreams above, and the last Prisma call disappears
whenever the last file anyone needed is touched.

Two consequences worth stating so nobody re-derives them:

- **Do not schedule a "porting sprint."** That is the ceremony rule 8
  retires, applied to a migration.
- **Do not leave a file half-converted** to avoid a bigger change. Repository
  before route; if the route has to wait, the route waits.

`packages/db` is the home for both the schema and the hybrid hot path
(rule 7). The commercial half was unblocked by ADR 0048.

---

## Parked — and what un-parks each

| Parked | Un-parked by |
|---|---|
| **Attribution / `createDriver`** | **The first invoice.** Un-park this FIRST, immediately after — it is the workplace-vs-home differentiator and the flat fee defers it only because per-connector billing does not need it. |
| Team-scale workspace split (M2–M4: `contracts`, vendor extraction, repo reshape, governance, conformance suite) | A second team actually building in parallel |
| Service and Flex verticals | Operate reaching market |
| Issues Engine | A support load that manual handling cannot absorb |
| Full cost-center engine — DSO-by-address, retailer choice, home-charging reimbursement, contractor 10%, premium/CC billing | A signed host who needs one of them specifically |
| Installation dissolution (ADR 0047) beyond leaving the anchor as-is | A schema change that cannot be made around it |
| Roaming / OCPI, OCPP 2.0.1, BLE settings, NFC | A customer requirement, not a roadmap slot |

Parked means **stop thinking about it**. The un-park trigger is the only thing
worth remembering.

---

## Legacy

**`docs/adr/` (51 documents) and the architecture planning documents are
historical reference, not active canon.** They are banner-marked in place.
Nothing was deleted and nothing was moved — cross-links and the paths
referenced by `.dependency-cruiser.cjs` still resolve.

Their load-bearing constraints are extracted into the eight rules above.
**Read the rules, not the corpus.** Open an ADR only to recover the *reasoning*
behind a rule you are about to challenge — and rule 1 says think hard before
you do.

`docs/reference/*` and the function report are **not** legacy — they describe
what is, not what was decided.
