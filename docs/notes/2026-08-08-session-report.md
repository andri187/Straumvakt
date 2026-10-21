# Session report — 2026-08-07 → 08

Written to be picked up cold. Facts are measured; where something is
uncertain it says so.

**Where you are:** branch `dev/housekeeping` @ `ee0ced5`. 23 commits.
Nothing pushed. Nothing deployed. `master` and `staging` untouched.

---

## 1. The one thing to read first

**A promotion to staging is staged and blocked, deliberately.** The last
request was "deploy housekeeping to staging". Measured, that promotion carries
**135 commits / 621 files** — the whole day, not the 4 housekeeping commits:
the Drizzle port, the migration-authority flip, the SQLSTATE fix, the 32-table
drop. Against a database 21 chargers write to continuously.

Nothing was pushed. **Three answers needed** — see §7.

---

## 2. Three real bugs found and fixed

These were live. None was visible by reading the source.

### 2.1 The agreements ledger had never priced anything — three stacked causes

`agreements.billing_lines`: 0 rows after ~2 months of a cron firing every
minute. Each cause was invisible until the one ahead of it was removed.

1. **Attribution.** 8 of 1,619 completed sessions carried a `user_id`, and the
   newest was 86 days old — outside the tick's 30-day window. But 56 were
   resolvable from `identity.id_tokens` all along: RFID `EE43C609263CC7`
   belongs to `driver@n1.is` and always did. The link was never made at
   session-stop.
2. **Every clause failed validation.** `allocation_json` says
   `"bearer_type": "USR"` — uppercase. The Postgres enum, `BEARER_CODES`, and
   the sibling `default_bearer_type` column *on the same row* are lowercase.
   ADR 0019 documents the JSON uppercase and the seeder followed it. JSONB is
   unconstrained, so nothing caught it and **the resolver rejected every clause
   in the database for three months.**
3. **Both suppliers were wrong.** `VEITUR-AD1` had a NULL `supplier_org_id` on
   the seeder's premise that Veitur was not a seeded org — it is. The retailer
   rate pointed at **N1 ehf** (the site host, `{cpo,site_host}`) instead of
   **N1 Rafmagn** (`{retailer}`). Distribution revenue credited nobody; energy
   revenue credited the landlord.

**Result, test branch only:** 128 lines over 64 sessions, 889.3 kWh,
**19,264.97 ISK** — DSO→Veitur @ 8.64 kr/kWh, ELE→N1 Rafmagn @ 8.83, 24% VAT.

**Staging still has the two mis-pointed suppliers.** The case fix is code and
carries over; the supplier fix is data and does not.

Full account: `2026-08-07-first-priced-session.md`.

### 2.2 Drizzle wraps driver errors — every SQLSTATE branch was dead

`errors.ts` asserted *"the driver does not wrap it, so this is the raw pg
error"* and read `err.code`. False. A real violation arrives as:

```
{ name: 'Error', code: undefined, cause: { code: '23505', ... } }
```

So `isUniqueViolation` and `isForeignKeyViolation` returned **false for every
real violation since the identity port shipped** — silently, because the
fallthrough is a 500. The id-token delete path that should return *"still
referenced — revoke instead"* was throwing 500s.

Fixed with `pgErrorCode()`, which walks the cause chain.
`test/parity/error-shape.probe.test.ts` guards it and prints the shape.

### 2.3 `driver_access_requests.triggeredBy` missing its `@map`

Every query on that model failed at runtime — the whole driver access-request
flow was dead in staging. Fixed; guarded by `schema-columns.test.ts`.

---

## 3. What was built

### Drizzle port — 571 → **481** Prisma calls, 32 → **131** Drizzle (~21%)

Ported: `chargers.ts` (the hardest file — 21 queries, 3 transactions, a
six-level `include` with `take: 1`), plus user-tokens, invites, org-invites,
vehicle-id-sessions, vehicle-recurrence, create-driver, billing-electricity,
active-sessions, org-email-domains, host-applications, admin-bootstrap,
driver-group-memberships, driver-invoices, pending-discoveries,
charger-zaptec-config, and their routes.

**Three shared helpers became dual-client** (`recordAuditAction` 15 callers,
`unsealAndAuth` 3, `enqueueCommand` 2) so files port on their own schedule
instead of a big-bang.

**Translation traps, all silent under typecheck:**

| Prisma | Drizzle | why it matters |
|---|---|---|
| `mode: "insensitive"` | `lower(a)=lower(b)`, **not `ilike`** | `_` and `%` are wildcards; OCPP identity strings contain underscores |
| `desc` sorts NULLs last | Postgres sorts them first | say `NULLS LAST` or you try never-used credentials first |
| `numeric` → Decimal `"7.4"` | string `"7.40"` | read via `normaliseDecimalString`, write via `toNumeric` |
| nested `take: 1` | `DISTINCT ON`, not a join | a join multiplies the parent rows |
| `{ increment: 1 }` | must stay in SQL | racing writes lose counts |

**Two lessons that cost reverts:** a route can never lead its repository (4
reverts), and files are CRLF so multi-line replacements in JS template
literals silently match nothing — hence `scripts/lib/replace.mjs`, which
throws on a miss.

### Schema: Drizzle owns it (was ADR 0051)

`packages/shared/src/db/*.ts` is the source of truth; migrations are
`drizzle-kit`, **baselined on test and staging**. drizzle-kit had never seen
this database, so a naive `generate` wanted to CREATE all 66 tables (1,187
lines). The migration was generated and then **recorded as applied without
executing it** (`apps/api/scripts/drizzle-baseline.mjs`, hashing copied from
drizzle's own dialect, with `--verify`).

Proof it took: adding one column now produces one line of SQL.

`check:schema-parity` → `check:schema-consistency` (the old one compared two
copies of the same Prisma files). **`drizzle-kit push` is banned.**

### 32 dead tables dropped — test **and** staging

61 of 98 tables had zero rows; only 32 were safe. **"Empty" is not "unused":**
17 empty tables have live writers (`charging.live_sessions` is empty only when
nothing is charging; `meter_values` through retention).

**Near-miss worth remembering:** `agreements.bearer_rules` looked unreferenced
and is read by the live billing resolver via `include: { bearerRules: true }`.
A grep for `.bearerRule.findMany` finds nothing, because **Prisma relation
loads don't look like model accessors.** The scan was rerun against relation
field names.

### Tests — 7 of 10 fake-client tests converted

They break the moment their subject ports: the mock still applies, it just
stops intercepting. **Do not build a fake Drizzle.** They moved to
`test/parity/` against real Postgres in a rolled-back transaction.

Two gotchas: Postgres `now()` is **transaction-stable**, so rows made in one
transaction share `created_at` (set timestamps explicitly to test ordering);
and enum values must be real ones.

**12 parity files, 88 tests. 623 unit tests. 8/8 checks.**

### Governance — canon replaced

`FOCUS.md` (8 rules, each citing the legacy ADR it extracts) · `DECISIONS.md`
(one line per decision) · `TASKS.md` (16 tasks, gates, parallel tracks) ·
`SERVICES.md` · `WORKSPACE.md` reconciled. **51 ADRs + 7 planning docs
bannered legacy in place** — nothing deleted, nothing moved.

Two rules carry amendments made after first draft: **rule 1** gained the
*Prisma-is-not-the-baseline / touch-it-convert-it* exception plus the harvest
protocol; **rule 3** was rewritten because it conflated the two money lines.

### `packages/contracts` — the clean shell spine

19 domain + 10 input modules harvested from `shared`; **shared re-exports
every path**, so all 127 consumers were untouched. Two new pieces:
`money/lines` (a *shape* — `{whoseMoney, posture, counterparty}` — cataloguing
5 line kinds, not two hardcoded) and `vendor/adapter` (interface only).
`packages/commercial` created as an empty home.

---

## 4. Designs written, not built

- **`2026-08-08-commercial-harvest-and-invoice-ledger-design.md`** — Rule 5,
  **uncommitted, awaiting your approval.** Harvest plan (only the 2 pure files
  move first), the parity harness spec, the invoice ledger, the flat-fee line.
  Key finding: `billing_lines.session_id` is **already nullable** and
  `billable_event_type` already exists, so a non-session line needs no
  reshape. Two nullable columns would be added: `posture`, `whose_money_kind`.
  **Posture must be stored, never derived** — ADR 0031 makes it a property of
  the agreement, so "recipient == Straumvakt ⇒ principal" is wrong.
- ADR 0047 (dissolving Installation) · 0048 (agreements survives) · 0049 (the
  CDR is the record; OCPI 2.2.1 is its shape) · 0050 (read models, one
  onboarding) · 0051 · 0052 (workspace split — parked).

---

## 5. Findings worth acting on

**Admin credential — it was never hardcoded.** Both auth paths read the
binding with no fallback and throw if unset; no worker config carries a value.
**The weak value came from `.env.example`**, which shipped non-empty
`ADMIN_EMAIL`/`ADMIN_PASSWORD` and is tracked in git. Those are now blank.
`ADMIN_PASSWORD` **is set** on both staging workers (confirmed via
`wrangler secret list` — names only). Whether it was *rotated* is unknown to
me and unknowable.

*(The `admin01` elsewhere in the repo is the Teltonika router factory default,
in text warning against factory defaults.)*

**The CDR is thin — and part of that is expected, not a defect.** 46 columns,
1,619 sessions: `user_id` on **0.5%**, `id_tag` on 5.5%. For an earlier period
OCPP Authorize was disabled at the Zaptec portal and the installation did not
require authorization, so sessions from that period **could not** carry driver
attribution — a known historical operating configuration, by design. Labelling
those sessions is pending a confirmed cutover date; see
`2026-08-08-auth-enforcement-period-discovery.md`. **Do not re-diagnose the
attribution gap as a fault without checking that note first.** 11 columns have never held a value. Three energy feeds
(`ocpp_*`, `cdr_*`, `amqp_*`) measure one fact and **disagree** — 8% on
energy (worst 12.1 kWh), 12% on time (worst ~16 h) — and only 49 of 1,619
sessions have two sources to compare at all.

**1,497 signed OCMF envelopes are held and unparsed.** 1,607 exist in
`imported_cdr_refs`; 110 were extracted. **56 belong to the 64 billable
sessions.** `imported_cdr_refs` is `ON DELETE CASCADE` — **deleting sessions
destroys them.** Back them out before any purge.

**The connector state machine is captured and thrown away.** 4,438
`StatusNotification` frames since May (Preparing 386, SuspendedEV 374) are
projected onto `connectors.status` and overwritten. Plug-in/plug-out and
parking time are reconstructible back to May and exist as data nowhere —
which is why there is no basis for a plugtime fee.

**Two pricing paths disagree on 22 of 57 sessions (39%)**, totals off 363.93
ISK. That is CO-3, and it has never run.

**No observability** beyond `wrangler tail`. **Email fails open** — right for
a notice, wrong for an invoice.

---

## 6. State

| | |
|---|---|
| branch | `dev/housekeeping` @ `ee0ced5` (23 commits, unpushed) |
| Prisma → Drizzle | **481** → 0 · Drizzle **131** · ~21% |
| depcruise baseline | **24** (22 vendor) — unchanged all day |
| packages | shared · contracts (live) · commercial (empty) |
| tests | 623 unit · 88 parity · 8/8 checks · tsc + build clean |
| test branch | 79 sessions, ledger priced, 32 tables dropped, baselined |
| staging | 32 tables dropped, drizzle baselined, **suppliers still wrong** |
| prod | untouched |

Uncommitted: the commercial design note (task 3).

---

## 7. What needs you

**Blocking the promotion:**

1. Is the **135-commit** promotion to staging intended, or housekeeping alone?
2. Was `ADMIN_PASSWORD` actually **rotated**, or just already set?
3. Confirm opening a PR is wanted — CLAUDE.md Rule 1 says *"never open or
   merge a PR"*; your prompt authorised it. Merge stays yours either way.

**Decisions queued:**

4. **Approve the money design** (task 3) — includes: add `per_connector` to
   `RATE_BASES` (recommended) vs reuse `per_day` with connector-days.
5. **Invoice delivery** — emailed PDF vs PEPPOL/TS-236 for launch.
6. **Collection** — which bank for kröfuhafi registration. **Longest lead
   time of anything here; starting it early is free optionality.**
7. **Neon plan** (Launch vs Scale) and whether Dev is always-hot. Delta is
   ≈$40–50/mo hot vs ≈$5–15 scale-to-zero.
8. Staging supplier fix — 2 UPDATEs, Rule 5, not applied.
9. `/mobile-app-mock` — whole-directory keep or kill. The 22 "unreferenced"
   files are runtime-loaded Flutter output; parking them breaks the demo.

---

## 8. If you do one thing next

**Back out the 1,497 OCMF envelopes.** It is cheap, idempotent, and the only
item here that is destroyed by a step already authorised (the session purge).
Everything else waits without cost.

Then: approve the money design, and start the bank conversation.
