# ADR 0055 — The legacy CDR history is archived and cut, not carried

**Status:** Accepted · **Date:** 2026-08-28
**Depends on:** ADR 0054 (devices, placements, effective dating) — its items
1–6 must be applied before this executes
**Touches:** FOCUS.md rule 1 §the harvest protocol step 3 · FOCUS.md rule 4
(the CDR is the record) · the 2026-08-20 fresh-start correction

> FOCUS rule 8: write an ADR only when a decision is load-bearing *and*
> irreversible. Cutting history qualifies on both. Once the legacy billing
> writer is switched off and its rows are out of the live database, the path
> back is a restore rather than a revert.

---

## Context

The fresh start was decided on 2026-08-20: nothing legacy is inherited, no
backfill, and legacy data is reference data that never sizes a decision. That
settled what the *new* system consumes. It did not settle what happens to the
old system's history, and so the old system is still running.

Measured 2026-08-28 on `dev/core-billing-integration`:

- `lib/agreement/billing-tick.ts` reads `chargeSession` through Prisma and is
  invoked from a **scheduled handler in `index.ts:488`**. Through
  `lib/agreement/persist.ts` and `lib/billing/generation-idempotency.ts` it
  writes `agreementBillingLine.createMany`. **The legacy billing generation is
  not dormant code; it is a cron that writes billing lines.**
- Eight production files still query Prisma. **Six of them are on that legacy
  agreement and billing path.** The other two are the driver API surface.
- The clean shell writes to **zero** of the 66 baseline tables and reads three.

The harvest protocol's step 3 says the old path retires only after the clean
path has parity coverage on any surface that can fail silently — and the money
path is named as exactly such a surface. Taken literally against the legacy
history, that obliges someone to establish parity between the new engine and a
billing generation whose output we have already decided not to inherit.

**That is work with no beneficiary.** It is also the last thing standing
between here and a single money path: once `0002` is applied there are two
writers — the Prisma cron writing `agreementBillingLine` and the new engine
writing `statements` — and nothing decides which owns a period.

---

## Decision

### 1 · One dump, then wipe

**Amended 2026-08-28, same day, on Andri's instruction: clear all of it.**

The original decision specified a per-table export with a manifest, checksums
and a restore path — an archive as a system. That is dead weight. The clean
slate is total, so the whole of it goes at once and nothing is selectively
preserved.

**Take one raw database dump. Prove it restores. Wipe everything.**

**No invoice was ever served from this data. It is test data.** Andri
confirmed it 2026-08-28. So there is no accounting record, no statutory
retention period, and no legal reason to keep any of it — the entire retention
question that shaped the first draft of this ADR does not apply.

The dump is therefore **ordinary rollback insurance and nothing more**: you do
not drop a database with live sockets attached and no way back. Nothing reads
it, nothing derives from it, no code path knows it exists, and it is expected
never to be opened. Prove it restores once, then wipe.

That also settles the question this ADR originally left open — *what actually
invoices customer 1 today* — for the purpose of this decision. Nothing does.
Whether customer 1 is billed by hand remains a separate operational fact and
does not gate the wipe.

### 2 · The legacy billing writer is switched off and deleted, not kept at parity

The scheduled `runAgreementsBillingTick` call goes, the writer goes, and the
harvest protocol's step-3 parity obligation for the legacy money path goes with
them. **There is nothing to be in parity with once the history is not
inherited.**

### 3 · Nothing in the clean shell reads a legacy table

It already reads three; those three go. After this, the new system's footprint
is its own tables and no others.

### 4 · The archive is the retention mechanism, not the live database

Records underlying an invoice already issued to a real customer are accounting
records and carry a statutory retention period. **Retention does not require
them to be queryable in production.** The archive discharges the obligation;
its format and location are the accountant's call, not an engineering one.

### 5 · The installed estate is removed and re-onboarded through the correct pathway

The 30 charger rows in the database were written by the legacy importer, which
invents one EVSE and one connector at index 1 with `type: "Type2"` and a
warranty date of install + 5 years, reads `Charger.Active` and discards it, and
has no placement model at all. **They are not rows that can be corrected in
place** — they are the wrong shape, produced by a path ADR 0054 replaces.

They go with the rest of the legacy data, and the fleet is re-onboarded through
the pathway that writes `devices`, `device_identities`, `placements` and the
real EVSE/connector hierarchy from `BootNotification`.

Three constraints follow, and none of them is optional:

**a · The fleet is live, so the new rows exist before the old ones stop
resolving.** The gateway resolves a connection by `identity_string`. Removing
identities before `device_identities` is populated and ADR 0054 item 8 has
switched the resolution over means live chargers stop being attributable —
21 sockets, mid-session. **Write, cut over, then remove. Never remove first.**

**b · The true fleet size is not yet known.** 30 rows here, 35 in the vendor
portal, 20 active and 15 deactivated — and `listChargers` ignores the vendor's
`Pages` envelope, so 30-of-35 may be a pagination artifact rather than a fact.
**The pagination fix lands before the re-onboard**, or the re-onboard
faithfully reproduces an incomplete inventory.

**c · Lifetime counters restart at zero.** ADR 0054 decision 1 says a device
carries lifetime energy and session counts and that they are permanent. A fresh
onboard writes new device rows, so those counters begin empty. That is the
accepted cost of the fresh start; the historical numbers live in the archive,
and **nothing derives a lifetime figure from the archive** — it is reference
data, not a source.

### 6 · Everything goes — and identity data does not even reach the dump twice

The users, drivers, memberships, invites and idTokens created during the old
system's life go too, and the clean slate is repopulated by onboarding people
properly in the correct order.

They are inside the single dump from decision 1 and **nowhere else**. No
separate export of people, no extracted identity file, no "just the drivers"
copy kept somewhere convenient — a second copy of real kennitala, emails and
credentials is a liability held for no stated purpose, and the dump already
covers the one obligation that exists.

**Nothing survives in the live database.** The clean slate is repopulated by
onboarding people properly, in the correct order.

Two things are not personal data and are not covered by this:

- **The default idTag is a token, not a person.** It is re-registered properly
  as an ordinary group member under the installation agreement — which is what
  makes `enforceAuthorize` switchable at all.
- **Organisations are not people.** Host orgs, sites, installations and
  circuits are re-onboarded on their merits, not deleted for privacy reasons.

**Verify admin access does not depend on a user row before deleting any.** The
2026-08-08 decision line records that admin auth is binding-only — the password
is a Worker binding with no fallback in either path — but *verify it*, because
the failure mode is being locked out of the console with no user table to log
in against.

### 7 · This executes after ADR 0054 items 1–6 are applied

Cutting history does not cut ingest. Live WebSockets keep producing CDRs and
they need somewhere to land, so the new tables exist and accept sessions
**before** the old writer is switched off. Round 4, then this.

---

## Answered 2026-08-28 — this no longer gates anything

The first draft made the cutover conditional on *what actually invoices
customer 1 today*. **Andri answered: no invoice was ever served, the data is
test data.** Nothing downstream depends on it, nothing is at risk from
switching the cron off, and the wipe is unconditional.

What remains true regardless: the fleet is live, so the **order** in decision 5
still holds — write, cut over, remove. That is a sequencing constraint, not a
data one.

---

## Why not keep it running

Three reasons, in order of weight:

1. **Two writers on one money path is the failure this project already had.**
   Three billing generations happened because nobody decided to model billing
   three times; keeping a fourth alive "just in case" is the same mechanism.
2. **The parity work is unbounded and benefits nothing.** Parity against a
   history we do not inherit produces a test suite protecting an output nobody
   reads.
3. **It is what makes the Prisma retirement affordable.** Six of the eight
   surviving Prisma files become deletable rather than convertible. Only the
   driver routes need porting, and those fail loudly.

---

## Consequences

- **The harvest protocol's step-3 obligation for the legacy money path
  dissolves.** It still stands for every other silently-failing surface.
- **The Prisma retirement collapses into this cutover** instead of being a
  separate round. What survives is `routes/public/driver.ts` and
  `driver-charger-pin.ts`, both loud-failing, both portable on sight.
- **The legacy retention decision narrows** from "what do we keep and where"
  to "what format does the accountant want the archive in".
- **The 66-table baseline stops mattering.** It becomes the archive's problem.
- **`prisma generate` comes out of the deploy scripts** once the last import
  goes, which also removes the risk of the deploy generating a client for
  tables ADR 0054 has reshaped.
- **Irreversible.** After the archive is taken and the rows are gone, a
  question about a 2026 session is answered from the archive or not at all.

**Not decided here:** per-driver session retention in the *new* system — still
open, still Andri's; and the archive's format and storage location, which is
the accountant's answer.
