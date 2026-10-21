---
agent: claude-a
status: draft
promote_to_ready_when: round 4 closes and ADR 0054 items 1–6 are applied
round: 5
lane: legacy-cutover-and-prisma-retirement
created_utc: 2026-08-28T20:00:00Z
worktree: E:\Claude\Straumvakt-core-billing
branch: dev/core-billing-integration
decision: docs/adr/0055-legacy-history-is-archived-not-carried.md
completion_md: E:\Claude\Straumvakt\docs\agent-runs\<dispatch-date>\claude-a-legacy-cutover-and-prisma-retirement-completion.md
completion_json: E:\Claude\Straumvakt\docs\agent-runs\<dispatch-date>\claude-a-legacy-cutover-and-prisma-retirement-completion.json
external_mutation_allowed: false
very_tldr: Archive the legacy CDR and billing history out of the live database, switch off and delete the cron that still writes billing lines through Prisma, and port the two driver route files — collapsing the Prisma retirement into the same round.
---

# Claude A Prompt — The Legacy Cutover and the Prisma Retirement

**Draft. Do not execute until promoted to `ready`.** It is gated on round 4
closing and ADR 0054 items 1–6 being applied, because cutting history does not
cut ingest and live sockets need somewhere to land first.

The decision is **ADR 0055** — read it before anything else. This prompt
implements it.

---

## 0. Operating rules

Round 4's rules carry unchanged. Restated where this round differs:

1. Work only in `E:\Claude\Straumvakt-core-billing` on
   `dev/core-billing-integration`.
2. **Forbidden without exception:** push; deploy; DNS; any Cloudflare, Neon or
   GitHub mutation; charger commands; hardware.
3. **This round is the first that may touch data, and it does so under a
   standing stop.** Every destructive step — the export, the deletion, the
   cron switch-off — is **prepared, scripted, dry-run and left unexecuted.**
   Andri runs them at a terminal. You produce the runbook; you do not run it.
   `CLAUDE.md` rule 3 governs: no `migrate deploy`, no `migrate reset`, no raw
   SQL against a connection that does not resolve to localhost or a
   user-confirmed dev branch.
4. **No deletion of anything, anywhere, before the archive is proven
   restorable.** Not one row.
5. Commit the completion artifact after every phase.
6. Deliverable-gated, no wall-clock target.
7. Never print, echo, log or commit a secret, connection string, kennitala or
   personal row. **The archive contains real customer data — no sample of it
   appears in the repository, in a log, or in the artifact.**

---

## 1. Phase 1 — One dump, restore proven

**No invoice was ever served from this data. It is test data** — Andri
confirmed 2026-08-28. There is no accounting record, no retention obligation,
and no selective preservation. The whole database goes.

The dump is **ordinary rollback insurance**: you do not drop a database with
live sockets attached and no way back. It is not an archive, nothing will read
it, and no code path knows it exists.

Required:

1. Script one full dump. One file. No per-table export, no manifest, no
   checksum ceremony.
2. **Prove it restores, once**, against a scratch target — never against
   production, and never against a database Andri has not named in the current
   message. A dump nobody has restored is not insurance.
3. Deliver both as a runbook. **Execute neither.**

---

## 2. Phase 2 — Establish what stops when the cron stops

Not a gate any more — the wipe is unconditional — but the blast radius still
has to be known before the switch is thrown.

Required:

1. **Does the scheduled handler run in the deployed Worker?**
   `apps/api/src/index.ts:488` invokes `runAgreementsBillingTick`. Establish it
   from the code and read-only `wrangler` verbs — not by triggering it.
2. **Find every reader of `agreementBillingLine`.** If there are none, the cron
   has been writing into a void, and that is the finding of the round.
3. **Name every surface that changes the day it stops**, and say for each
   whether it fails loudly or silently.

---

## 3. Phase 3 — Switch off the legacy writer

**Only after Phase 1's verdict and Andri's answer.**

Required:

1. Remove the scheduled `runAgreementsBillingTick` invocation from `index.ts`.
   **`index.ts` is not on the fragile-file list, but treat it as one** — the
   change is one call site and nothing else.
2. Delete `lib/agreement/billing-tick.ts`, and the legacy writer path through
   `lib/agreement/persist.ts` and `lib/billing/generation-idempotency.ts`.
   **Delete, do not comment out.** A commented-out billing writer is a fourth
   billing generation waiting to be uncommented.
3. **Everything the agreement resolver earned stays.** FOCUS rule 1: the
   resolver took three attempts and three months of silent failure to get
   right, and none of that is visible in the source. Separate the *writer* from
   the *resolution logic*, keep the second, and say in the artifact exactly
   what you kept and why.
4. Prove by test that nothing else invoked the removed path.

---

## 3a. Phase 3a — The estate cutover: remove and re-onboard

ADR 0055 decision 5. The 30 charger rows were written by the legacy importer
and are the wrong shape, not merely stale. They go, and the fleet is
re-onboarded through the pathway ADR 0054 defines.

**The order is write → cut over → remove, and it is not negotiable.** The fleet
is live; 21 sockets resolve by `identity_string` today.

Required:

1. **Confirm the pagination fix has landed** (Claude B, round 4) and that the
   vendor inventory is complete. 30-of-35 may be an artifact of the ignored
   `Pages` envelope. **If the true count is not established, stop here and say
   so** — a re-onboard against an incomplete inventory silently omits chargers.
2. **Write the new rows first.** `devices`, `device_identities`, `placements`,
   and the EVSE/connector hierarchy from `BootNotification` rather than the
   1:1:1 invention. Every field's provenance recorded: what came from the
   vendor, what came from a boot frame, what was asserted by an operator.
3. **Cut the gateway resolution over** to `device_identities` → `device` →
   open `placement` (ADR 0054 item 8, built in round 4). **Prove both paths
   resolve identically for all 30 identities before the old one is removed.**
   A single divergence is a stop.
4. **Then remove the legacy asset rows**, under the same archive-first rule as
   everything else in this round: archived, restore-proven, then deleted — and
   delivered as a runbook, not executed.
5. **State the lifetime-counter consequence in the artifact.** The new device
   rows start at zero. The historical figures are in the archive and **nothing
   derives a lifetime value from them.**
6. Sessions are self-carrying — `org_id`, `site_id`, `charging_station_id`,
   `evse_id` — so history does not move when the asset rows do. **Confirm that
   holds against the actual foreign keys** before removing anything, and report
   any constraint that would orphan or cascade.

---

## 3b. Phase 3b — The clean slate, and the correct onboarding order

ADR 0055 decision 6. Users, drivers, memberships, invites and idTokens go, and
people are onboarded properly afterwards.

**The rule inverts here.** Decisions 1–5 archive; this one **deletes**.
Archiving real people's national identifiers, emails and credentials to a file
nobody will review again is the worst available outcome, and it is what
"archive everything" produces if applied without thinking.

Required:

1. **Verify admin access does not depend on a user row — before deleting
   anything.** The 2026-08-08 decision records admin auth as binding-only, no
   fallback in either path. Prove it. **If it turns out any user row is
   load-bearing for console access, stop and report; do not work around it.**
2. **Everything goes.** Users, drivers, memberships, invites, idTokens, virtual
   RFIDs. No selective preservation, no extracted identity file, no "just the
   drivers" copy kept somewhere convenient. They exist in the Phase 1 dump and
   nowhere else.
3. **No sample of any of it appears in the repository, a log, a test fixture or
   the completion artifact.** A checksum-valid kennitala is indistinguishable
   from a real person's.
5. **The default idTag is a token, not a person.** It is re-registered as an
   ordinary group member under the installation agreement — no resolver branch,
   no nullable `userId`. It counts as one active driver; excluding it is a
   group question.
6. **Deliver the correct onboarding order** as
   `docs/notes/<date>-clean-slate-onboarding-order.md`. Nobody has written it
   down, and everything above assumes it exists. At minimum it must state the
   order and what each step requires of the one before:
   org → site → installation → circuit → **device → placement** → agreement →
   clauses → bearer rules → driver groups → drivers → memberships → idTokens →
   `enforceAuthorize` on. **Name the step at which an org becomes invoiceable**,
   and the step at which a driver becomes billable.
7. **Deletion is a runbook, not an execution.** Same standing stop as every
   other destructive step in this round.

---

## 4. Phase 4 — Port the driver routes

The two remaining Prisma clusters. Both fail loudly, so per FOCUS rule 1 they
can be fixed on sight.

- `routes/public/driver.ts` — `user.findUnique` ×2, `membership.findFirst` ×2,
  `idToken.findMany`, `driverGroupMembership.findMany` and `.findFirst`,
  `connector.findUnique`, `chargingStation.findMany`.
- `routes/public/driver-charger-pin.ts` — `driverGroupMembership.findFirst`,
  `chargingStation.findUnique`.

Required:

1. **Repository before route**, per FOCUS rule 1's discipline. A route may not
   lead its repository.
2. **These query the two models ADR 0054 reshaped** — `chargingStation` is now
   `devices` plus `placements`, and `driverGroupMembership` is dated. The port
   is not a translation; **the queries change meaning.** A charger's org comes
   from its open placement, and a membership check asks `period @> at`.
3. Tenancy on every query, FOCUS rule 5.
4. Tests for every route, including the cases the new model creates: a device
   whose placement closed, a membership that ended, a driver querying a charger
   that moved to another host.

---

## 5. Phase 5 — Remove Prisma

Only once the last import is gone.

1. `prisma generate` out of `deploy:staging` and `deploy:prod`.
2. The four Prisma packages out of `package.json`.
3. The 19 `.prisma` schema files — **archived to the repo's own history and
   deleted from the tree**, not left as a second declaration of tables Drizzle
   now owns alone.
4. `apps/api/src/generated/prisma/**` deleted, and confirmed absent from the
   build.
5. `npm run build` green, `npm run check` green, the full suite green.
6. **State in the artifact that Drizzle is now the only schema definition**,
   and that FOCUS rule 1's Prisma exception has been discharged and can be
   struck from `FOCUS.md`. Propose the edit; do not make it.

---

## 6. Completion gates

| # | Gate |
|---|---|
| 1 | Baseline recorded |
| 2 | One full dump scripted; **restore proven once** against a scratch target |
| 3 | Verdict delivered: does the scheduled handler run in the deployed Worker |
| 4 | Every reader of `agreementBillingLine` found, or proven to have none |
| 5 | What changes when it stops, per surface, loud or silent |
| 6–8 | *(struck — no selective archive, no manifest, no accountant question: the data is test data and no invoice was ever served)* |
| 9 | **Nothing wiped anywhere before gate 2 passes** |
| 9a | Vendor inventory confirmed complete, or the round **stopped** at that point |
| 9b | New `devices` / `device_identities` / `placements` / EVSE / connector rows written **before** anything is removed, with per-field provenance |
| 9c | Both resolution paths proven identical for all identities; a single divergence stops the phase |
| 9d | Legacy asset rows archived and restore-proven before removal; removal delivered as a runbook, unexecuted |
| 9e | Foreign keys checked for orphan/cascade against sessions before removal |
| 9f | Lifetime-counter restart stated in the artifact; no lifetime value derived from the archive |
| 9g | Admin access proven independent of any user row **before** a deletion is prepared; a dependency stops the phase |
| 9h | Everything cleared — no selective preservation, no extracted identity file |
| 9j | No personal value anywhere in the repo, logs, fixtures or the artifact |
| 9k | Default idTag re-registered as an ordinary group member — no resolver branch, no nullable `userId` |
| 9l | **The correct onboarding order written down**, naming where an org becomes invoiceable and where a driver becomes billable |
| 10 | Scheduled invocation removed; legacy writer **deleted, not commented** |
| 11 | The agreement resolution logic preserved, with what was kept stated explicitly |
| 12 | Tests prove nothing else invoked the removed path |
| 13 | Both driver route files ported, repository before route |
| 14 | Queries re-expressed against placements and dated memberships — not translated literally |
| 15 | Tests for the new model's cases: closed placement, ended membership, moved charger |
| 16 | `prisma generate` out of both deploy scripts |
| 17 | Prisma packages, `.prisma` files and the generated client removed |
| 18 | Build, check and full suite green with Prisma absent |
| 19 | Artifact states Drizzle is the only schema definition and proposes striking rule 1's exception |
| 20 | **No destructive step executed against any database — every one delivered as a runbook** |
| 21 | Completion `.md` and `.json` committed after every phase |

---

## 7. Fallback queue

1. The `ocpp_identities` retirement, which ADR 0054 deferred and this round
   makes possible.
2. Every remaining Prisma-shaped idiom in the Drizzle code — enums, generated
   types, comments referring to Prisma as the owner.
3. The `.env`/deploy surface: what referenced Prisma and now does not.
4. A round-5 revision of "what stands between here and a real invoice".

---

## 8. Completion artifact

Per `docs/notes/2026-08-10-agent-completion-artifact-rule.md`, with the §6 gate
table row by row.

**External state must state:** no push, no deploy, **no export, deletion or
cron change executed against any database or Worker — all delivered as runbooks
for Andri**, no SQL against any environment, no Cloudflare/Neon/GitHub
mutation, no customer data reproduced anywhere in the repository or artifact,
and which branch was written to.
