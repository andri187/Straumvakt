# The clean shell — requirements for a real CPMS

Straumvakt, MDU-first, Zaptec estate, no public charging.
Written 2026-08-19 from an inventory of the restart only. **The legacy surface
is not assessed and its defects are not listed** — it is being discarded, not
migrated.

The question this answers is the one that was asked: *for the clean shell to be
a real CPMS, is something essential missing?*

---

## 0. Three facts to hold before the list

**The clean shell has never existed in one tree.** `dev/core-billing-integration`
carries the money engine and no PDF, no delivery adapter, no onboarding.
`dev/market-rails` carries those and **no `core-billing` at all**. Everything
below describes a union of two branches that has not yet been assembled. B's own
artifact says it: *"the invoice validator has still never run against a
GENERATED invoice."*

**The clean shell has essentially already defined a new schema.** It writes to
**zero** of the 66 baseline tables. It reads three, all read-only, all from one
file gathering activity evidence. Its real footprint is the **13 tables from
migrations 0002 and 0003**. So the fresh-schema question is less open than it
looked — the shell has been voting on it for three rounds.

**And the pathology has already reproduced inside the shell.** You restarted to
kill duplicate workflows. There are now:

- **two delivery state machines** — `core-billing/delivery-log.ts` and
  `contracts/invoice/delivery.ts`
- **two statement/document models** — `core-billing/statement.ts` and
  `contracts/invoice/document.ts`
- **two "active connector" derivations** — `flat-fee.ts:401` and
  `activity-month.ts:238`; only the second is used

Plus ~3.500 LOC and ~350 tests across **13 fully-orphaned modules**. The whole
PDF-and-delivery rail is complete, golden-filed, well tested, and has no entry
point. This is the A/B lane split doing exactly what a lane split does when the
lanes never merge. It is cheap to fix now and expensive in six months.

---

## 1. The requirements list

Status key: **built** · **partial** · **absent** · **out of scope** (deliberate,
with the reason)

### Asset and topology

| Requirement | Status | Note |
|---|---|---|
| Installation → circuit → station → EVSE → connector | built | via Zaptec import; the shell itself never reads `assets.*` |
| Connector lifecycle — active, deactivated, removed | **absent** | `Charger.Active` is read from Zaptec and dropped; no `disabled_at`. **This is the one that puts a wrong number on an invoice** |
| Validate an asserted connector exists | **absent** | the shell never reads `assets.connectors`, so an operator assertion can name a connector that isn't there |
| Circuit capacity model | partial | `ampereCeiling` stored, nothing allocates against it |

### Protocol and control

| Requirement | Status | Note |
|---|---|---|
| OCPP 1.6J termination, DO per identity | **built** | live, 21 chargers, 162 tests. The strongest thing in the shell |
| Remote start / stop | built | |
| Reset, unlock connector | **absent** | mapped in the action table, no route enqueues either |
| Smart charging / load profiles | **out of scope** | Zaptec OCPP Cloud does not support them; Zaptec owns balancing. Correct call — write it down |
| Site headroom control | **absent** | installation-level `AvailableCurrent` via Zaptec API is one call and would give DSO-cap and spot-price throttling |
| Firmware management | **absent** | Zaptec exposes it; nothing consumes it. Deferrable, not forever |

### Authorization

| Requirement | Status | Note |
|---|---|---|
| idTag → token → user → membership → agreement | **built** | with `no_contract` and `no_billable_clauses` verdicts |
| Enforcement | partial | `enforceAuthorize` defaults false; verdict computed and discarded |
| Default idTag registered as a token, bearer `org` | **absent** | blocks enforcement being switched on |
| Membership validity window — move-in / move-out | **absent** | `added_at` only; the unique forbids the history row |
| Per-charger visibility follows the grant | **absent** | driver UI shows chargers regardless of plan |

### Session and evidence

| Requirement | Status | Note |
|---|---|---|
| Session capture, both paths | built | |
| Contract check on the CDR import path | **absent** | the vendor path never reaches the gate |
| Refuse rather than zero on missing energy | **absent** on the live path | `z.Energy ?? 0` |
| OCMF signature verification | **absent** | stored, never verified, never billed from |
| Meter mode resolution and anomaly holds | built, **orphaned** | `meter-energy.ts`, 39 tests, reachable only from dead code |

### Money

| Requirement | Status | Note |
|---|---|---|
| Tariff resolution ladder, audience × scope | **built** | |
| Flat-fee subscription line | **built** | |
| Period lifecycle, six states | **built** | |
| Refusal discipline throughout | **built** | the best part of the system |
| Invoice document, header, validation | **built** | Icelandic legal header, refuses at construction |
| Gap-free numbering | built logic, **no store** | migration 0004 does not exist |
| Agreement write surface | **absent** | no org reaches invoiceable without a hand-written row |
| Rate load from the database | **absent** | `loadFlatFeeRates` returns `[]` unconditionally |
| Credit notes / corrections | built, **orphaned** | `period-close.ts` correction path has no caller |
| PDF render and delivery | built, **orphaned** | complete rail, golden file, no entry point |

### Collection — the half that turns an invoice into money

| Requirement | Status | Note |
|---|---|---|
| Delivery log, fail-closed | built | two implementations |
| Dunning | built, **orphaned** | zero importers |
| Payment reconciliation | built, **orphaned** | zero importers |
| A payment rail | **absent** | kröfuhafi undecided; bank transfer against a PDF is the baseline |
| **Remittance ledger** | **absent** | see §2 |

### Operations

| Requirement | Status | Note |
|---|---|---|
| Offline detection | built, **not wired** | `liveness-sweeper.ts`, 266 LOC, 31 tests, zero callers |
| Alerting to a human | **absent** | Sentry not installed, metrics module has no importer, all eight mail templates are onboarding |
| Audit trail | **absent** | `audit.actions` exists in baseline; the shell never touches it |
| Operator console | **absent** from the shell | archived; replacement is read-only |
| Support session trace | **absent** | no event-log viewer |

### Tenancy and identity

| Requirement | Status | Note |
|---|---|---|
| `org_id` on every row and query | **built** | rule 5 held throughout |
| Cross-tenant refusal on every read and write | **built** | 404, not 403 |
| **Read the organisation** | **absent** | see §2 |
| Org identity exposure guard | built, **orphaned** | `org-exposure.ts` fixes a leak that is still live |

### Reporting

| Requirement | Status | Note |
|---|---|---|
| Operator: estate, periods, statements | partial | nine endpoints exist, read paths thin |
| Host/board statement | **absent** | see §2 |
| Driver: own cost and history | **absent** | mobile app has no money screen at all |

### Compliance

| Requirement | Status | Note |
|---|---|---|
| Icelandic invoice content and numbering | **built** | |
| VAT posture, agent vs principal | **built** | |
| Kennitala validation and storage contract | **built** | checksum, masking, never logged |
| Retention — 7 years for invoices | **absent** | no policy, no field, no job |
| GDPR — per-resident session data | **absent** | no retention class, no erasure path, no subject-access route |
| AFIR / EPBD | **out of scope** | MDU-restricted charging is outside AFIR; neither is EEA law yet |

---

## 2. What is essential and unaccounted for

Six. Everything else above is either built, deliberately deferred, or a known
blocker already on your list.

### 2.1 · The organisation is never read

The clean shell **never reads `tenancy.organizations`**. Every path that
produces an invoice today takes the host's legal name, kennitala and address
from a fixture.

That is the invoice header — the legal artefact. It is the one thing
`renderHeader` refuses to render without, and there is no code path that
supplies it from the database. Not hard; entirely missing.

### 2.2 · There is no remittance ledger

This is the one I would put first.

Your model: the MDU org holds the meter and pays the utility; Straumvakt bills
the dwellers **on the org's behalf** and remits. The document layer supports it
— `claimHolder` is explicit, `Straumvakt f.h. <host>` renders, agent posture is
golden-tested.

**Nothing tracks what Straumvakt owes each org.** Money collected from dwellers
is not Straumvakt's money. There is no account of it, no remittance statement,
no reconciliation of collected-versus-remitted, and no balance a host can ask
about. The collection packet named it in passing — *"a registration conversation
and a remittance ledger, not a rebuild"* — and then it was deferred with the
rest of the host↔driver line.

It is not optional for the product as described. The moment one dweller pays,
Straumvakt is holding somebody else's money with no ledger for it. That is also
the point where the accountant's client-account question (`vörslureikningur`)
stops being theoretical.

### 2.3 · You can produce an invoice and cannot receive money

`reconciliation.ts` and `dunning.ts` are written, tested, and have **zero
importers**. There is no payment rail at all — the kröfuhafi decision is open,
and the do-nothing baseline is a bank transfer against an emailed PDF, matched
by hand.

For a platform fee to one org that is survivable. For per-dweller billing across
a building it is not: an incoming transfer carries whatever reference the payer
typed, and unmatched payments accumulate silently.

### 2.4 · No audit trail

`audit.actions` exists in the baseline schema and the clean shell never writes
to it. `audit.read`, `platform.impersonate` and `platform.support.action` are
declared permissions with no implementation anywhere.

A CPMS acting as an agent on other people's money needs to answer "who changed
this tariff, when, and what did it do to whose bill." Today nothing can.

### 2.5 · Nothing watches anything

The sweeper, the metrics writer and the Sentry scrubber are all written, all
tested, and all unwired. There is no channel from a detected condition to a
human — not email, not push, not a dashboard.

This is the requirement that makes every other one operable. Without it, the
first sign of any failure is a resident complaining, and at more than one
building that stops working.

### 2.6 · Retention has no owner

Two clocks, neither started: invoices must be kept 7 years, and per-resident
session data is personal data with a presence pattern attached. No retention
class, no deletion path, no subject-access route. Cheap now, structurally
awkward once there is data.

---

## 3. What I would not build

Naming these so they stop reappearing as gaps.

- **Smart charging / load profiles.** Zaptec OCPP Cloud does not support them
  and Zaptec's own balancer is better than what we would write. Take
  installation-level `AvailableCurrent` instead — one API call, gives site
  headroom and spot-price throttling.
- **Roaming / OCPI.** No public charging.
- **Reservations.** Table exists in baseline with no writer; MDU stalls are
  assigned, not reserved.
- **An apartment abstraction.** The dweller identifies himself; `BillObject` is
  not needed for the MDU line.
- **Anything AFIR-shaped.** Out of scope and not EEA law.

---

## 4. The consequence for the fresh schema

The clean shell writes to **none** of the 66 baseline tables and reads three.
So the target schema is close to: the 13 tables from 0002/0003, plus the
handful the requirements above add, plus whatever the surviving
onboarding/asset path genuinely needs.

The legacy billing generation — `billing.tariffs`, `tariff_definitions`,
`cost_centers`, `contracts`, `driver_contracts`, `billing_lines` — is **never
created** rather than retired. ADR 0048's cutover does not need to happen.

Two things to resolve before generating it:

1. **Pick one of each duplicated pair** — delivery state machine, document
   model, active-connector derivation. Then delete the loser rather than leaving
   both compiling.
2. **Decide what the surviving onboarding path writes.** That determines the
   `properties.*`, `ocpp.*` and `identity.*` reach, which is the largest
   remaining unknown in the table count.

---

## 5. Where I am not confident

- **The onboarding path's schema reach.** I inventoried the money side
  thoroughly and the asset/identity side by inference from the import code.
- **Whether the orphaned modules are abandoned or merely early.** Several —
  `plug-time`, `rate-window`, `provenance-state` — look like deliberate
  advance work rather than dead ends. Worth a decision each rather than a sweep.
- **Nothing here was executed.** No environment was queried; the shell's Drizzle
  adapters have never run against Postgres, so "built" means "written and
  tested against a fixture" throughout.
