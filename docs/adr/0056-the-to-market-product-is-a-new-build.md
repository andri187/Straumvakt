# ADR 0056 — The to-market product is a new build, and the old one is reference

**Status:** Accepted · **Date:** 2026-08-28
**Depends on:** ADR 0054 (assets) · ADR 0055 (the clean slate)
**Changes:** FOCUS.md rule 1 — see §"What this does to rule 1"
**Decided by:** Andri, 2026-08-28

---

## Context

The harvest protocol said: move proven components into a clean shell, keeping
their earned correctness, and let the old path run until the clean one has
parity. That was followed, and it produced **clean libraries**:
`packages/commercial`, `packages/contracts`, `packages/shared/src/db`, and
migrations `0002`–`0008`. Together they carry 1,882 tests, a proven money
engine, an invoice rendered twice byte-identical, and a document model that
refuses a mixed posture at construction.

**But there is no clean application.** Those libraries are mounted inside
`apps/api` — the old app, with 187 endpoints serving the previous model, eight
surviving Prisma files, a scheduled job still writing billing lines into the
legacy tables, and a 66-table baseline underneath. The web UI and the Flutter
app are likewise the old ones, edited in place. The clean shell was built as a
set of parts and bolted into the thing it was meant to replace.

The consequences are visible and have been accumulating: `touch-it-convert-it`
has run since Sprint 3 with no completion date; the Prisma exception has no end
condition; the web branch has been unmerged since 11 August and labels nine
live endpoints as gated; and the clean shell writes to zero of the 66 baseline
tables while still living inside the app that owns them.

ADR 0055 already settled the data half: the estate, the CDRs, the orgs and the
drivers are archived, not migrated. This ADR settles the code half.

---

## Decision

**The to-market product is a new application. It starts empty and mounts only
what is deliberately harvested. The previous codebase is reference, not
inheritance.**

Three things follow, and they are the whole decision:

1. **Nothing is in the new build by default.** A module, an endpoint, a table
   or a screen exists because someone chose it and can say why.
2. **Old data is archived, never migrated.** No active charger, no active org,
   no active driver, no CDR crosses over. The legacy database is retained
   read-only as the archive and is not the product's database.
3. **The old application stays runnable until it is switched off whole.** Not
   converted file by file. One switch, one date.

### What is harvested — the manifest

Everything on this list moves because it has earned it. Everything not on it
must be argued for.

| Harvested | Why |
|---|---|
| **The gateway Worker, as-is** | The most mature thing we own — a Durable Object per identity, WebSocket hibernation, the auth path, the heartbeat cost model, months in production. **It is not rebuilt.** |
| `packages/commercial` | The money engine. 1,882 tests, proven offline end to end |
| `packages/contracts` | The document, the PDF, the delivery log, the agreement write surface |
| `packages/shared/src/db` | The Drizzle schema — the only schema definition that survives |
| The OCPP projections | Frames → rows. Proven against the live fleet |
| The Zaptec adapter | At the edge, per FOCUS rule 6. One vendor adapter, generic core |
| **The agreements resolver** | Three attempts and three months of silent failure to get right, and none of that is visible in the source. **Never rewritten.** |
| Migrations `0002`–`0008` | Re-based — see below |

### What is left behind

`apps/api`'s endpoint surface · the Prisma client, its 19 schema files and the
scheduled billing job · the 66-table baseline · the legacy billing generation ·
the existing web routes and the Flutter branches as *code*. All of it stays
readable as reference for as long as it is useful.

### The migration line is re-based

`0000_baseline` describes the previous 66-table world. A build that starts
empty cannot begin there. **The new build gets a single fresh initial migration
containing only its own schema**, with `0002`–`0008`'s content folded in. That
is a mechanical transformation of work already done, not a redesign.

---

## What this does to FOCUS rule 1

Rule 1 says the current code is the baseline and architecture is not
re-litigated. **This ADR does not overturn it — it completes the harvest
protocol that rule 1 already contains.** The protocol always said *harvest into
a clean shell*; what was missing was a clean shell to harvest into. Rule 1
continues to govern **inside** the new build with full force: within it, working
code is the answer, nothing is re-litigated, and nothing proven is rewritten.

Two standing items are discharged by this decision rather than completed:

- **`touch-it-convert-it`** ends. Prisma is not converted file by file; it is
  simply not mounted.
- **The Prisma exception in rule 1** can be struck once the old app is switched
  off.

---

## Consequences

- **The acceptance test becomes checkable.** "No endpoint exists that we did not
  choose" is only verifiable if the app started empty — and it pairs with ADR
  0055's "no row in the database was created by hand".
- **The endpoint surface should shrink by roughly an order of magnitude.** The
  rehearsal needs the endpoints its nine steps actually call; 187 exist because
  they served a model we are no longer building.
- **The web UI is re-created, not merged.** Its 79 classified routes remain
  valuable as *content* — the personas, the workflows, the honesty labels — and
  are referenced rather than inherited.
- **The gateway needs re-pointing, not rebuilding.** Its service binding moves
  to the new app; its auth resolves against the new identity tables.
- **The risk is scope creep in the shell.** A new application invites
  re-litigating settled things. Rule 1 applies inside it precisely to prevent
  that: if a harvested module works, it is not improved on the way in.
- **The old app is not deleted.** It runs until the rehearsal passes on the new
  one, then is switched off whole. Nothing is deleted while it is the only
  thing that works.

**Not decided here:** the new application's name and repository layout; whether
the new UI is a fresh app or the existing web project emptied; and the
switch-off date, which follows the rehearsal rather than leading it.
