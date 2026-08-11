# Core billing — operations pack

**2026-08-11.** Six things a reviewer, an operator, or a UI author needs before
any of this reaches a customer. Written against source, not against plans.

1. Migration preflight and rollback
2. UI contract — what is interactive, read-only, disabled, hidden
3. Data-quality checklist for billing source rows
4. Operator runbook — statement regeneration and retry
5. Privacy and security note — driver billing material
6. Cross-tenant threat model

---

## 1 · Migration preflight and rollback

`apps/api/drizzle/0002_powerful_warbird.sql` — 11 `CREATE TYPE`, 11
`CREATE TABLE`, 26 `CREATE INDEX`. No `ALTER`, no `DROP`, no touch to any
existing object.

### Before applying

- [ ] **Never `drizzle-kit push`.** It diffs and reconciles in one step with no
      SQL to review, against a database 21 chargers write to. Generate, read,
      apply.
- [ ] Confirm you are on the **staging branch**, not the Neon default branch.
      The project's default branch is abandoned; staging is `br-tiny-river-abgpqq37`.
- [ ] `npm run check:schema-consistency` → expect **77 tables / 938 columns**.
      A different number means Drizzle and Prisma have drifted and the client the
      ~500 un-ported calls use is lying.
- [ ] `npm run check:api-schema` → "in sync (9 files)".
- [ ] Confirm the three previously-used names are absent:
      `billing.statements`, `billing.invoices`, `billing.invoice_lines` were
      dropped on 2026-08-07. Only `statements` is reused, with a different shape.
      ```sql
      SELECT table_schema, table_name FROM information_schema.tables
      WHERE table_schema IN ('billing','reports')
        AND table_name IN ('statements','statement_lines','statement_delivery_attempts',
                           'statement_exports','session_settlements','settlement_components',
                           'settlement_holds','billing_periods','mutation_receipts',
                           'driver_activity_month','connector_activity_month');
      ```
      Expect **zero rows**. Any row means someone applied part of this already.
- [ ] Confirm the 11 enum type names are free:
      ```sql
      SELECT n.nspname, t.typname FROM pg_type t
      JOIN pg_namespace n ON n.oid = t.typnamespace
      WHERE n.nspname = 'billing' AND t.typtype = 'e';
      ```
      `BalanceType`, `PlanCategory`, `InvoiceStatus` and friends will be there.
      None of the 11 new names should be.
- [ ] Take the Neon branch snapshot / note the LSN you would restore to.

### Applying

- [ ] Apply the file as-is. Statements are separated by
      `--> statement-breakpoint`; there is no transaction wrapper, so apply it
      inside one yourself if your tool does not.
- [ ] Verify the journal moved: `apps/api/drizzle/meta/_journal.json` must have
      the `0002` entry and `meta/0002_snapshot.json` must exist. **Both move with
      the SQL.** Hand-editing SQL without regenerating the snapshot silently
      corrupts every future diff.

### After applying

- [ ] Re-run the two information_schema queries; expect 11 tables and 11 types.
- [ ] `PARITY_DATABASE_URL=… npm --prefix apps/api run test:parity` —
      `schema-columns` and `domain-schemas` are the two checks that can catch a
      real persistence defect, and they run **under no root script and in no CI
      workflow**. Run them by hand, here, or this migration is unverified.
- [ ] Nothing reads or writes these tables yet, so no smoke test is possible or
      needed. That is the point of applying schema before handlers.

### Rollback

One transaction. Nothing outside the slice references any of it.

```sql
BEGIN;
DROP TABLE IF EXISTS billing.statement_delivery_attempts;
DROP TABLE IF EXISTS billing.statement_lines;
DROP TABLE IF EXISTS billing.statement_exports;
DROP TABLE IF EXISTS billing.statements;
DROP TABLE IF EXISTS billing.settlement_components;
DROP TABLE IF EXISTS billing.settlement_holds;
DROP TABLE IF EXISTS billing.session_settlements;
DROP TABLE IF EXISTS billing.billing_periods;
DROP TABLE IF EXISTS billing.mutation_receipts;
DROP TABLE IF EXISTS reports.driver_activity_month;
DROP TABLE IF EXISTS reports.connector_activity_month;
DROP TYPE IF EXISTS billing."CorrectionReason";
DROP TYPE IF EXISTS billing."DeliveryState";
DROP TYPE IF EXISTS billing."DeliveryChannel";
DROP TYPE IF EXISTS billing."StatementLineKind";
DROP TYPE IF EXISTS billing."StatementRecipientKind";
DROP TYPE IF EXISTS billing."RateComponentKind";
DROP TYPE IF EXISTS billing."ReviewReason";
DROP TYPE IF EXISTS billing."ProvenanceState";
DROP TYPE IF EXISTS billing."SettlementProvenance";
DROP TYPE IF EXISTS billing."SettlementStatus";
DROP TYPE IF EXISTS billing."PeriodState";
COMMIT;
```

**This rollback stays safe exactly until the first route lands.** After that,
dropping `session_settlements` discards priced money that exists nowhere else —
`reports.session_ledger` holds one rolled-up total and no unit price, so it
cannot reconstruct a settlement.

### The migration deliberately NOT in this one

`UNIQUE (cost_factor_id, code, effective_from)` on `agreements.rate_references`.
`CREATE UNIQUE INDEX` fails on existing duplicates, and `0002` is otherwise
unfailable. Sequence:

```sql
-- 1. Are there duplicates? A human decides which row was in force.
SELECT cost_factor_id, code, effective_from, count(*)
FROM agreements.rate_references GROUP BY 1,2,3 HAVING count(*) > 1;
-- 2. Resolve them.
-- 3. Then, OUTSIDE a transaction:
CREATE UNIQUE INDEX CONCURRENTLY rate_references_factor_code_from_uniq
  ON agreements.rate_references (cost_factor_id, code, effective_from);
```

Step 1 is not automatable. The point of the index is that the system cannot
currently tell which of two rows priced a session.

---

## 2 · UI contract

For whoever builds the console screens. State per surface, and **why**.

| Surface | State | Why |
|---|---|---|
| Driver session cost | **interactive, and wrong today** | Renders aurar as krónur — a 649.88 kr session shows as 64,988 kr. Fix the number before anything else on this table. |
| Driver billing material | **hidden** | No route. `GET /api/driver/invoices` returns a flat session list with no period, total, VAT split or subscription lines; do not dress it up as a statement. |
| Period list / preflight | **disabled** | No table applied, no route. Show the screen with controls disabled and a reason, not an empty state that reads as "no periods". |
| Close period | **disabled** | Must carry `expectedBlockerCount` when it lands, so the button needs the count the operator was shown, not a fresh fetch. |
| Review queue (holds) | **disabled** | The seven `ReviewReason` values are the filter set; do not invent an eighth in the UI. |
| Resolve hold | **disabled** | When it lands: the note field is **required and non-empty**; the API rejects whitespace. Do not offer a "resolve" affordance without it. |
| Statement list | **disabled** | |
| Statement detail | **disabled** | When it lands: show **both** the excluded session ids and the lines. A statement that hides what was left off is the failure mode. |
| Deliver / re-send | **disabled** | Re-send must mint a *new* idempotency key; reusing the old one replays the first response and looks like success. |
| Export | **disabled** | `billing.export` gates zero routes today. |
| Rate book — read | **read-only** | Safe to display. |
| Rate book — write | **disabled** | Editing a `TariffDefinition` today silently restates every session ever priced against it, because the ledger stores one mutable id and no unit price. Unlock after WP-22, not before. |
| DSO / retailer catalogue | **read-only** | Genuinely national data; correct to show in full. |
| Cross-tenant session detail | **read-only, platform only** | Now scope-checked. An org member gets 404 for another tenant's session. |

**A disabled control needs a sentence, not a tooltip.** "Available when period
close ships" is useful; a greyed button with no explanation gets filed as a bug
and re-reported monthly.

---

## 3 · Data-quality checklist for billing source rows

Run before trusting any figure. Each query answers a question the schema cannot.

- [ ] **Sessions with no driver.** `charging.sessions.user_id` is nullable. These
      settle but have nobody to bill — expected for guest/native-auth sites, a
      problem anywhere else.
      `SELECT count(*) FROM charging.sessions WHERE user_id IS NULL AND started_at >= :from;`
- [ ] **Sessions with no meter stop.** Become `meter_unresolvable` holds. A high
      count means an ingest problem, not a billing problem.
- [ ] **Sessions where stop < start.** `negative_or_impossible_energy`. Should be
      zero; anything else is a charger or a mapping fault.
- [ ] **Ledger rows with a null cost.** `reports.session_ledger.cost_isk_minor`
      is nullable, so an unpriced session is indistinguishable from a free one.
- [ ] **Ledger rows with no `tariff_definition_id`.** Cannot be explained to a
      customer at all.
- [ ] **Duplicate billing lines per session.**
      `SELECT session_id, factor_code, kind, count(*) FROM agreements.billing_lines
       GROUP BY 1,2,3 HAVING count(*) > 1;` Non-zero means the count-then-insert
      race already fired.
- [ ] **Duplicate rate versions.** The `rate_references` query above. Non-zero
      means "the rate in force at T" is ambiguous *for every session priced
      since*.
- [ ] **Tariff definitions whose `compute_rule` changed after sessions were
      priced against them.** There is no `updated_at`-vs-session comparison
      possible today, which is the finding, not an oversight.
- [ ] **`id_token` values colliding across orgs.**
      `SELECT value, count(DISTINCT org_id) FROM identity.id_tokens
       WHERE status='active' GROUP BY 1 HAVING count(DISTINCT org_id) > 1;`
      Non-zero means the unscoped CDR driver resolution can already have
      misattributed a billable session. **Run this one first.**
- [ ] **Connectors with `status='unknown'`.** The column is mutable with no
      history; anything here is a connector-month you cannot defend.
- [ ] **Sessions on connectors that no longer exist.** `charging_stations` has no
      removed-at column, so a deleted charger's July sessions have no evidence
      trail.
- [ ] **CDR/OCPP energy disagreements already in the ledger.** Today the CDR
      overlays silently; these are bills that moved and nobody was told.

---

## 4 · Operator runbook — regeneration and retry

**None of this is implemented.** Written now so the routes are built to support
it rather than retrofitted.

### "The customer says their statement is wrong"

1. Find the statement: `(period_id, recipient_kind, recipient_id)` is unique.
2. Read `excluded_session_ids` **first**. The commonest complaint is a missing
   session, and the answer is usually that it is held, not lost.
3. If held: read `settlement_holds` for that session. The `reason` is one of
   seven and says which of "we could not read the meter" / "the CDR disagreed" /
   "no rate covered the start" applies.
4. **Do not edit the settlement.** A settled session in a closed period is
   immutable by design. A correction lands as a `correction` line in a *later*
   period, with a `CorrectionReason`.

### "It needs regenerating"

- Regeneration with **identical** content produces the same `statement_key` and
  no second row — safe, idempotent, and a no-op.
- Regeneration with **different** content is refused with
  `already_generated_with_different_content`. That is not a bug: it means the
  underlying sessions changed after the customer was billed, and someone must
  decide whether that is a correction or a mistake.
- A period must be **closed** to generate. If it is open, the answer is to close
  it, and close will tell you what is blocking.

### "The email never arrived"

1. Read `statement_delivery_attempts` for the statement.
2. `outcome_kind = "ack"` with a `provider_message_id` → it left Straumvakt.
   Take the id to the provider.
3. `outcome_kind = "not_configured"` → **it never left, and no provider was
   configured.** Today this case is invisible: `email.ts:45-51` fails open, so a
   missing `RESEND_API_KEY` looks the same as a successful send. This column is
   why the table exists.
4. `state = "retrying"` with a `not_before` in the future → wait; the sweeper
   will take it.
5. `state = "failed"` after `DEFAULT_MAX_DELIVERY_ATTEMPTS` (5) → needs a human.
6. To re-send: **mint a new idempotency key.** Reusing the old one replays the
   first response, which will look like success and send nothing.

### "Close the period" refuses

The refusal names blockers from a closed set of four. `expectedBlockerCount`
protects against closing over a blocker you never saw: if the count moved between
your preflight and your close, the close is refused and you must look again.
Re-reading and re-submitting is correct; overriding the count is not.

### What an operator can never do

- Edit a settled figure in a closed period.
- Resolve a hold without a note. The API rejects an empty or whitespace note.
- Backdate a rate without a reason.
- See another tenant's session detail, as of this run.

---

## 5 · Privacy and security — driver billing material

Driver billing material links **a named person** to **money**, **times**, and
**a location**. Treat it as the most sensitive data Core holds.

**Personal data in the new tables**

| Table | Field | Note |
|---|---|---|
| `session_settlements` | `driver_user_id`, `started_at`/`stopped_at` | who charged, when, and — via connector — where |
| `settlement_holds` | `resolution_note` | free text an operator writes about a customer dispute. Assume it is discoverable. |
| `statements` | `recipient_id` + `total_isk` | a financial record about a person |
| `statement_lines` | `description` | customer-facing prose |
| `statement_delivery_attempts` | `destination` | an email address, captured at send time on purpose — recipients change, the record must not |
| `mutation_receipts` | `response_body` | may contain a statement total |
| `driver_activity_month` | `driver_user_id` | presence of a person in an org in a month |

**Rules**

1. **The driver route takes no `orgId`, ever.** Identity comes from the bearer
   token. A driver naming an org is a cross-tenant hole dressed as a filter.
2. **Never log a `resolution_note` or a `destination`.**
3. **`mutation_receipts` must be purged.** It holds response bodies with money in
   them, and a table with an `expires_at` nothing enforces is exactly the defect
   this design criticises in `events.idempotency_keys`. Purge ships with the
   first writer or neither ships.
4. **Export files contain driver-level financial data.** `statement_exports`
   stores a pointer and a hash; the object needs an R2 lifecycle rule. Unresolved.
5. **`audit.actions.org_id` cascades on org delete.** Deleting an org destroys
   its audit trail — including any record of who read what. That is a
   data-protection question as much as an engineering one.
6. **`/sessions/:id/full?include=raw` serves signed OCMF/723 blobs.** Now
   scope-checked; before this run it was not. Treat raw meter evidence as
   equivalent to the billing data it proves.
7. **Retention has never been decided** for any of it. Icelandic accounting
   retention (7 years) and a driver's erasure request point in opposite
   directions, and this is a real conflict, not a formality.

---

## 6 · Cross-tenant threat model — billing reads and writes

Assets: session-level money, driver identity, meter evidence, rate books.

### T1 · A platform-grant holder reads every tenant's money — **live, unmitigated**

33 of 41 `billing.*` gates pass no `orgIdParam`, which makes them unreachable by
an org member and tenant-wide for anyone with a platform grant — including
`auditor`, `sales_cs` and `finance_internal` via the `platform.tenant.read`
expansion. **No audit row is written.** `resolveOrgScope`'s warning goes to
`console`, so there is no queryable record that a cross-tenant read happened.
*Mitigation:* WP-24, WP-27, WP-29.

### T2 · A vendor-supplied token collides across tenants — **live, unmitigated**

`zaptec-session-sync.ts:186-189` resolves a driver by token value with no org
filter, from strings the vendor controls (UserId, TokenName, UserUserName,
UserEmail). A collision attributes a billable session, and its ledger
`driverUserId`, to a foreign driver. **This one changes who is charged.**
*Mitigation:* WP-03. *Detect now:* the `id_tokens` query in §3.

### T3 · A tariff authored into another organisation — **live, unmitigated**

`billing-tariff-mgmt.ts:44` takes `orgId` from the request **body** under a gate
with no `orgIdParam`. *Mitigation:* WP-26 (URL change).

### T4 · A tariff bound to a site that does not own it — **live, unmitigated**

`sites.ts:63` accepts `dsoTariffId` and passes it through blind. *Mitigation:*
WP-08 adjacent; an ownership check is additive and cheap.

### T5 · A global catalogue endpoint leaking per-tenant rows — **live**

`billing-dso.ts` eagerly includes `tariffDefinitions: { include: { organization } }`,
and `TariffDefinition` is per-tenant. Same shape at `billing-electricity.ts:21`
and `billing-tariff-detail.ts:29`. *Mitigation:* WP-24.

### T6 · Reading a session by id across tenants — **mitigated this run**

`GET /sessions/:id` and `/:id/full` now check the row's org via
`resolveOrgScope` + `orgInScope`. 404, not 403 — a 403 confirms the id exists.

### T7 · A cross-tenant id printed on a customer document — **mitigated by design**

`buildDriverStatement` drops foreign snapshots; `buildStatementRows` additionally
refuses a foreign id in `excluded_session_ids` or on a line. Two independent
checks, because a customer-facing document is the worst place for this to surface.

### T8 · A settlement written under the wrong tenant — **mitigated by design**

`buildSettlementRows` takes `orgId` separately and **compares** it to the
snapshot's own rather than reading it. A mapper that trusts its payload for the
tenant will write another org's session under this org's period the first time a
route forgets to scope.

### T9 · A replayed mutation charging twice — **contract only**

Every mutating contract requires an idempotency key and no route reads an
`Idempotency-Key` header anywhere in the tree. *Mitigation:* WP-14..WP-21 with
`mutation_receipts`, including `request_hash` so the same key with a different
body 409s instead of replaying.

### T10 · Regression — a new unscoped gate — **mitigated**

`check:orgid-param` fails on the 76th, and equally when an allowlisted gate is
fixed and left in the list. Fool-tested in both directions.

### The one that is not a threat but reads like one

An org member cannot currently reach the unscoped billing routes at all — the
membership lookup is skipped, so the verb is unsatisfiable for them. Fixing the
`orgIdParam` omissions therefore *widens* access as a side effect: routes that
were platform-only become reachable by org members with the verb. That is the
intent, and it must be a deliberate step, not a quiet consequence of a
scoping fix.
