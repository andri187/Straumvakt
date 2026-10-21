# The new build — manifest, endpoint budget, screen list

**WS-0 of `SOW-market-phase.md` v3. Decided by ADR 0056.**
This document is the boundary of the new build. **Anything not traceable to a
line here is not built.** That sentence is the whole point of the document: the
previous application reached 187 endpoints across 52 route files because every
question anyone asked got its own route, and nothing ever said no.

---

## 1. What crosses over

| Harvested | Form | Why |
|---|---|---|
| **The gateway Worker** | as-is, re-pointed | Durable Object per identity, WebSocket hibernation, the auth path, the heartbeat cost model. Months in production. **Not rebuilt** |
| `packages/commercial` | as-is | the money engine, 1,882 tests, proven offline end to end |
| `packages/contracts` | as-is | the document, the PDF, the delivery log, the agreement write surface |
| `packages/shared/src/db` | as-is | the only schema definition that survives |
| OCPP projections | harvested module | frames → rows, proven against the live fleet |
| Zaptec adapter | harvested module, at the edge | one vendor adapter, generic core — FOCUS rule 6 |
| **The agreements resolver** | as-is, untouched | three attempts and three months of silent failure to get right, none of it visible in the source |
| Migrations `0002`–`0008` | **re-based** into one fresh initial migration | `0000_baseline` describes the 66-table world; a build that starts empty cannot begin there |

## 2. What is archived

**All of it, read-only, and none of it migrated.**

Old chargers · old CDRs and session history · old orgs · old drivers, tokens and
memberships · old agreements and billing lines · the 66-table baseline · the
legacy billing generation.

The legacy database is retained **as the archive**. It is not emptied, not
migrated and not read in normal operation. Per ADR 0055 there is no retention
obligation — no invoice was ever served — so it exists purely as rollback
insurance and reference.

## 3. What is left behind as code

`apps/api`'s endpoint surface · the Prisma client, its 19 schema files and the
scheduled billing job · the legacy billing generation · the existing web routes
and the Flutter branches **as code**. All remain readable as reference for as
long as they are useful, and are switched off whole rather than converted.

---

## 4. The endpoint budget

**Revised after a duplicate audit.** The first draft was derived persona by
persona and contained ten duplicates — the same resource listed once per
persona, which is precisely the habit that grew the old surface to 187.

**The rule that replaces it: one resource, many scopes. Never one route per
persona.** A driver reading their sessions and a participant reading their
company's sessions are the same resource under different tenancy, not two
endpoints. Who may see what is a scoping question answered once, in the
middleware, not a routing question answered repeatedly.

### The duplicates removed

| Counted twice | Now |
|---|---|
| sign-in, once per persona ×4 | **one** session resource; the role comes from the identity |
| read/update an org (admin) + read/update own profile (host) | **one** org resource, scoped |
| list devices and placements (admin) + list chargers and state (host) | **one** device resource, two projections |
| accept a discovered charger (host) + attach a device (admin) | **one** attach — accepting a discovery *is* attaching |
| list/invite/remove drivers (host) + own roster (participant) | **one** membership resource; the participant's scope is their own group |
| list own sessions (participant) + history (driver) + host's view | **one** sessions resource, scoped |
| read own statement (participant) + what I owe (driver) + billing material (host) | **one** statement resource, scoped |

### The budget, by resource

| # | Resource | Operations | Steps |
|---|---|---|---|
| 1 | session / auth | sign in, sign out | 2, 3, 6, 9 |
| 2 | host applications | submit, list, approve | 3 |
| 3 | orgs | create, read, update, list *(cross-tenant only for admin)* | 3 |
| 4 | plans — the Straumvakt→host terms | set, read | 3 |
| 5 | sites | create, list | 4 |
| 6 | installations — one meter, one bill | create, read, list | 4 |
| 7 | circuits | create, list | 4 |
| 8 | vendor credentials | store, read status | 4 |
| 9 | vendor import | trigger, list discoveries | 4 |
| 10 | devices and placements | list, **attach**, detach | 4 |
| 11 | charger groups | create, list, add member, remove member | 6 |
| 12 | driver groups | create, list, add member, close member | 6 |
| 13 | invites | create, redeem, revoke | 6 |
| 14 | **grants** — driver group ↔ charger group | create, close, **list with the why** | 6 |
| 15 | agreements | create, read; clause add / amend / end | 5 |
| 16 | cost ownership | set group default, set per-driver override | 5 |
| 17 | sessions | list *(scoped)*, read, active | 7 |
| 18 | periods | open, record activity, assert, price, issue, document | 8 |
| 19 | statements | list *(scoped)*, read document | 8 |
| 20 | audit | list *(scoped)* | all |
| 21 | act-on-behalf | begin, end — logged as impersonation | all |
| 22 | internal | `ocpp-auth`, `ocpp-authorize`, ingest | 7 |

**22 resources, 44 operations.** Against 187 endpoints across 52 route files.

The count is not the point; the shape is. **A resource answers many questions.
The old surface grew because each question was given its own route** —
`billing-tariff-detail` and `billing-tariff-mgmt` were the same resource twice,
and thirteen billing route files served one engine.

### Original derivation, kept for the trace

Below is the first draft, persona by persona, retained so the duplicate audit
can be checked rather than trusted.

### Admin — Straumvakt · 13

| # | Endpoint | Step |
|---|---|---|
| 1 | sign in | 2 · bootstrap |
| 2 | list host applications | 3 |
| 3 | review / approve an application | 3 |
| 4 | create an org from an approved application | 3 |
| 5 | list orgs — cross-tenant, the only place it is legal | 3 |
| 6 | read an org | 3 |
| 7 | update an org — identity, billing identity | 3 |
| 8 | set the host's plan — the Straumvakt→host terms | 3 |
| 9 | list devices and their placements | 4 |
| 10 | attach a device to an installation | 4 |
| 11 | detach a device | 4 |
| 12 | read the audit trail | all — it is what makes "no row by hand" checkable |
| 13 | act on behalf of a host, logged as such | all |

### Host / CPO · 22

| # | Endpoint | Step |
|---|---|---|
| 14 | accept invitation, first sign-in | 3 |
| 15 | read / update own org profile | 3 |
| 16 | create a site | 4 |
| 17 | create an installation — one meter, one bill | 4 |
| 18 | create a circuit | 4 |
| 19 | store the vendor credential | 4 |
| 20 | import the installation from the vendor | 4 |
| 21 | list discovered chargers, accept one | 4 |
| 22 | list chargers and their live state | 4 |
| 23 | create a charger group | 6 |
| 24 | add a charger to a group — dated | 6 |
| 25 | remove a charger from a group — closes a row | 6 |
| 26 | create a driver group | 6 |
| 27 | invite a driver | 6 |
| 28 | list drivers and memberships | 6 |
| 29 | close a membership — move out | 6 |
| 30 | create a grant — driver group ↔ charger group | 6 |
| 31 | close a grant | 6 |
| 32 | create an agreement | 5 |
| 33 | add / amend / end a clause | 5 |
| 34 | set cost-factor ownership — group default and per-driver override | 5 |
| 35 | list statements and the month's billing material | 8 |

### Participant — a company charging at someone else's installation · 5

| # | Endpoint | Step |
|---|---|---|
| 36 | sign in | 9 |
| 37 | list own drivers | 9 |
| 38 | invite / remove own driver — delegated roster management | 9 |
| 39 | list own sessions and costs | 9 |
| 40 | read own statement | 9 |

### Driver · 5

| # | Endpoint | Step |
|---|---|---|
| 41 | redeem an invite, sign in | 6 |
| 42 | list what I may charge at | 6 |
| 43 | the active session | 7 |
| 44 | session history with cost | 7 |
| 45 | what I owe, and to whom | 8 |

### The period — operator, already built as nine over ports · 6

open · record activity · assert a connector · price · issue · fetch the document.
**Step 8.**

### Internal · 3

`ocpp-auth` · `ocpp-authorize` · ingest. **Step 7.**

---

*(End of the original persona-by-persona draft. Its total of 54 contained the
ten duplicates listed above; the resource budget of 22 resources and 44
operations supersedes it.)*

### What is deliberately absent, and why

- **No debug or evidence routes.** `agreements-debug`, the readiness and
  evidence surfaces exist in the old app because nobody trusted the model. In a
  build where refusals are named and every row is audited, those are
  diagnostics, not product.
- **No `properties`, no `bill-objects`.** The apartment abstraction is
  withdrawn — the dweller is the billable party.
- **Thirteen billing route files become one engine plus six period operations.**
  `billing-tariff-detail` and `billing-tariff-mgmt` were the same resource
  twice.
- **No vehicles, no tap intents, no access requests** until a rehearsal step
  needs them.
- **Resources, not questions.** The old surface grew one route per question
  asked. A well-shaped resource answers many.

---

## 5. The screens

One per rehearsal step, per persona. **A step reachable only by script has not
been built.**

| Persona | Screens |
|---|---|
| **Admin** | application review · org creation and profile · plan · device attach/detach with placements · audit · act-on-behalf banner |
| **Host / CPO** | first sign-in · profile · site / installation / circuit · vendor credential and import · discovery review · chargers and state · charger groups · driver groups and invites · grants matrix — *who can charge here* and *why* · agreement, clauses, cost ownership · the month's billing material · **the held period, with its named reason** |
| **Participant** | sign-in · own roster · own sessions and costs · own statement |
| **Driver** | redeem and sign in · where I may charge · active session · history with cost · what I owe and to whom |

**Two screens carry more weight than the rest:** the **grants matrix**, because
access control has to be explainable rather than merely correct; and the **held
period**, because holding is the expected outcome until several decisions land,
and it is the screen an operator will actually reach for.

---

## 5a. Gap check — 2026-08-28

Run against this manifest, ADR 0056 and SOW v3. **Two of these block WS-1.**

### Blocking

**1 · The user authentication model is undecided.** Admin is a Worker binding
and drivers redeem invites, but **how a host or participant user signs in has
never been decided** — password, magic link, an identity provider. WS-1 lists
"auth" as though it were settled. It is the first thing the shell needs and the
hardest to change later, because every session, invite and audit entry hangs
off it.

**2 · Outbound email has no owner.** Invites are the spine of onboarding —
host, participant and driver all arrive through one — and **nothing in the
manifest sends or captures a message.** The rehearsal mimics delivery, so it
needs a capture mechanism *and* a screen to read the captured mail, or step 3
cannot be walked at all. Add a **messages** resource and an admin mailbox
screen.

### Structural

**3 · The cost factor catalogue contradicts the acceptance test.** Factors are
runtime data by design — a new factor is a row, not a migration. But nothing
creates them, so either they are seeded (a row created neither by hand nor by a
screen) or an admin screen manages them. **The acceptance test needs an
explicit carve-out for platform reference data**, and that carve-out must be
narrow and named, or it becomes the hole everything else slips through.

**4 · Deployment topology is unspecified.** SOW v1 had a four-tier environment
workstream; v3 says only "a new Neon branch". The new application needs its own
Workers, hostnames and environments — and **"what production means" is still
open**, with all three public hostnames bound to Workers named `-staging`.
WS-7's gateway re-point is a **live cutover on 21 sockets**, not a
configuration change, and it deserves more than a line.

**5 · Scheduling, queues and observability are not on the harvest list.** The
activity job and period close need a scheduler; OCPP ingest runs through a
queue; and the old app carries metrics, Sentry and a scrubbing module that
keeps idTags out of a third party. None of it appears in §1. They are almost
certainly harvested — but "almost certainly" is what §1 exists to eliminate.

### Product surfaces argued for and not budgeted

**6 · Unattributed energy has no resource.** Every kWh falls on the meter
owner, so a session nobody can attribute is a silent loss with a known payer.
The reconciliation — consumed, attributed, and what the host is absorbing, with
a reason per session — is not among the 22 resources.

**7 · Terms acceptance is not captured.** A penalty is only chargeable if the
driver accepted terms that name it. Acceptance needs a version and a timestamp
at invite redemption, and a statement carrying a penalty should be able to cite
it. **Consent you never captured cannot be retrofitted.**

### Smaller, recorded so they are not rediscovered

Document storage for rendered invoices · backups for the new database ·
Hyperdrive or equivalent pooling · session expiry and revocation · the alert
**emit** path, which stays in scope even though AMS consumes it · and the new
application's name and repository layout, which ADR 0056 explicitly left open
and which WS-1 cannot start without.

---

## 6. How this document is used

- **WS-1 through WS-9 build only from this list.** An addition is an edit here
  first, with the step it serves.
- **The endpoint budget is verified against the nine steps screen by screen**
  before the shell is written. My derivation is a starting point, not an
  authority.
- **When the rehearsal passes, this becomes the product's inventory** — the
  answer to "what does Straumvakt do", written before the code rather than
  reconstructed after it.
