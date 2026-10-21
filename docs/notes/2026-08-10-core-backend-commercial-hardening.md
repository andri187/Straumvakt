# Core backend commercial hardening — findings and plan

Date: 2026-08-10
Worktree: `E:\Claude\Straumvakt-core-billing`
Branch: `scratch/claude-a-core-billing-2026-08-10` (from `bb43e72`)
Commits added: `9bcfe5c`, `c4c861b`
Nothing pushed, deployed, migrated or mutated. No DDL. No cloud or DNS change.

Evidence base: a five-agent read-only source census (327 catalogued rows across
pricing integration, billing gates, driver management, the invite path and
period close) plus direct verification of every claim reproduced below. Claims
I re-checked myself are marked **[verified]**; claims resting on the census
alone are marked **[census]** and should be re-read before anyone acts on them.

---

## 0. Three corrections to figures I previously reported

| Previously said | Actually | Source |
| --- | --- | --- |
| 43 `billing.*` gates, 8 org-scoped | **41 executable gates**, 8 org-scoped. Two of the 43 were comments (`billing-contracts.ts:7`, `billing-driver-contracts.ts:8`) | [census] |
| CDR poll window is 30 days | **26 hours** on both cron paths (`ROLLING_WINDOW_MS` at `zaptec-sync-cron.ts:35`). The 30-day default at `zaptec-session-sync.ts:79` is reached only when a caller omits `from`, which only operator-triggered routes do | [census] |
| 13 `member.*` gates lack `orgIdParam` | 13 of **26** total `member.*` gates | [census] |

The 26-hour figure changes the period-close design materially: routine
late-CDR exposure to a closed month is one day, not one month. Thirty days is
the *manual backfill* blast radius, which is a different and more dangerous
thing — see §6.

---

## 1. TF1 — Pricing integration

### 1.1 Delivered

`scripts/check-pricing-ssot.mjs`, wired into `npm run check` as `pricing-ssot`.
Six files call `computeSessionCost`; the allowlist names each with the reason
it is permitted to price. The check does not unify the paths — that is a
migration, not a lint — it closes the set so the seventh is a decision rather
than an accident. 12 tests including three fool tests.

### 1.2 A 100× overcharge on every driver-facing session figure **[verified]**

This is the most serious finding in the census and it is not theoretical.

`apps/api/src/repositories/driver-sessions.ts:93-97`:

```ts
// costIncVatMinor is BigInt currency-minor (ISK has no minor unit, so
// minor === major). Render as a plain number for the app.
function minorToIsk(minor: bigint | null | undefined): number {
  if (minor == null) return 0;
  return Number(minor);
}
```

The premise is false, and two independent parts of the system say so:

- **The writer.** The only writer of `charging.sessions.cost_inc_vat_minor` is
  `zaptec-session-sync.ts:317` and `:358`, storing `breakdown.totalIncVatMinor`
  straight out of `computeSessionCost`. That engine's header
  (`compute-session-cost.ts:12-16`) states minor = 1/100 króna (aurar), and
  explains why the precision is needed: per-kWh rates carry two decimals.
- **The formatter.** `formatIskMinor` (`compute-session-cost.ts:211-219`)
  divides by 100 and renders `X.XX kr.`

So the column holds aurar, and `minorToIsk` returns it unchanged. `GET
/api/driver/sessions/current` and `/sessions/history` report `costIsk` **100×
too large**, and `apps/mobile/lib/screens/active_session.dart:209` prints it
verbatim with a `kr` suffix. A 1,200 kr session is shown to the driver as
120,000 kr. `driver-invoices.ts:69` has the same magnitude [census].

Impact: it is display-only — nothing bills from this path — but it is the
number a driver sees, so it is a trust incident rather than a revenue one.
Fix is one line plus a regression test; it is *not* included in this branch
because it touches a driver-facing response shape and the mobile client
formats the value, so it wants its own reviewed change.

### 1.3 Published tariffs are unpriceable **[verified]**

`lib/billing/tariff-zod.ts:22` defines the publishable compute-rule kinds as
`flat_per_kwh` and `flat_per_session`. `lib/tariff/resolve-tariff-chain.ts:90`
accepts `kind === "flat"` and nothing else, throwing
`compute_rule_unsupported` otherwise (`:119-122`).

A tariff published through the tariffs-mgmt router therefore makes every
session at that site unpriceable. And because the pricing call at
`projections.ts:987` runs inside the event-log transaction, the throw rolls
the `session.stopped` row back with it [census] — so the failure is not a
null cost, it is a lost event.

Nothing in CI connects the two vocabularies. This is the single highest-value
guard to add after the SSOT check, and it is offline-testable.

### 1.4 Other pricing findings [census]

- **A dead money table with a live reader.** `billing-cost-centers.ts:65` sums
  `billing.billing_lines.amount_inc_vat_minor`, but nothing anywhere writes
  `db.billingLine`. The cost-centre revenue tile is structurally always 0, and
  `CostCenter` is the only schema entity that routes money to a payer.
- **`resolveMeterEnergy` is unreachable.** `projections.ts:31` imports only
  `sessionEnergyWh`; at `:947` it falls back to raw `meterStop` when that
  returns null, so the cumulative-register and implausible-energy holds never
  fire. The meter fix shipped in `1110249` is live; the *hold* logic is not.
- **A second pricing writer inside the live file.** `projections.ts:1072` still
  registers `onSessionStopped` (`:326-473`), a complete second copy of
  resolve-price-write, on an event type the file's own comment at `:635` says
  nothing emits. Any Core change to `onOcppRawStopTransaction` that misses it
  leaves a divergent writer one translator away from waking up.
- **VAT convention gap.** `subscription.ts:118` returns `subtotalExVatMinor`
  with no VAT figure, while `session_ledger.cost_isk_minor` and
  `AgreementBillingLine.amountIncVatMinor` are VAT-inclusive. The 200/50/450
  frame cannot share a statement line with session costs until this is decided.
  **This is a product decision, not a code fix, and it blocks the first real
  Core statement.**

---

## 2. TF2 — CDR provenance

### 2.1 Delivered

`packages/commercial/src/core-billing/provenance-state.ts` — a seven-state
machine (`estimated`, `ocpp_derived`, `cdr_pending`, `cdr_confirmed`,
`cdr_mismatch`, `corrected`, `held_manual_review`) with nine events, 32 tests.
Only `cdr_confirmed` asserts CDR provenance; only `correction_issued` is
admissible against a closed period. `stateFromLegacyColumns` /
`legacyColumnsFromState` keep it readable against today's schema.

### 2.2 Why the state machine is the fix and not a nicety

`SessionLedger` stores provenance as two unconstrained TEXT columns,
`verifiedSource` and `enrichmentStatus` (`commercial.prisma:326-327`). Nothing
requires a writer to set both, or to set them consistently. That is precisely
how the measured corruption arose:

- 1,136 rows `cdr/complete` agree exactly with their CDR energy — 0 disagreements
- **5 rows claim `cdr` provenance while carrying an OCPP figure**, max delta
  12.105 kWh (≈170 kr)
- **492 rows (30%) carry no provenance at all**

And the two writers responsible are identified [census]:
`webhooks/zaptec.ts:380-400` writes cost with *neither* field — the origin of
the 492 — and `zaptec-session-sync.ts:467` promotes `verifiedSource` to `"cdr"`
in its update branch **without re-writing `costIskMinor`** — the origin of the
5. Collapsing two free-text columns into one state column is a prerequisite
for close (§6), not a tidy-up.

One live disagreement to settle: the reconciliation tolerance is 0.05 kWh at
`zaptec-session-sync.ts:295` and 0.001 kWh at `cdr-provenance.ts:64`.

---

## 3. TF3 — Cross-tenant billing reads

### 3.1 The gate table

41 executable `requirePermission` calls on `billing.*` verbs. **8 pass
`orgIdParam`**: three in `routes/admin/orgs.ts` (286, 298, 314) and five in
`routes/admin/bill-objects.ts` (70, 124, 137, 153, 203). The other 33 do not.

### 3.2 The finding that reframes the whole family **[census, and it matters]**

A gate without `orgIdParam` is **not a weaker check — it is a different one**.
`require-permission.ts:70-72` sets `orgId = null`, and
`effective-permissions.ts:204` calls `getActiveMembership` *only when orgId is
truthy*. Both `HOST_ADMIN_BUNDLE` and `FINANCE_BUNDLE` hold `billing.read`, yet

> no org member can **ever** pass any of the 33 org-blind gates.

They are reachable only through `PlatformGrant` expansion — and then for every
tenant at once. So the 33 gates are simultaneously **too closed** (a finance
user with the right bundle is denied) and **too open** (whoever does get
through sees all tenants). That is one bug with two faces, and it explains why
the live operator hits denials that granting a membership cannot fix.

### 3.3 Scoping is a signature change, not a predicate change

Seven billing repositories take no `orgId` at all: `listCostCenters`
(`billing-cost-centers.ts:41`, whose `findMany` at `:49` has **no where clause
whatsoever** while joining payer display names), `getProjectedOrgRevenue`,
`listRateReferences`, `getTariffDetail`, `listEnrichmentSessions`,
`getSessionDetail`, `getSessionFullDetail`. Adding scoping means changing
signatures and every call site — plan it as such.

### 3.4 Three concrete exposures, ordered by how easy they are to reach

1. **Omitting a query param widens the result.** `GET /billing/contracts`
   (`billing-contracts.ts:34`) and `/driver-contracts` (`:36`) read `?orgId`
   and pass `null` when it is absent — so leaving it off returns *all tenants*
   rather than none. Inverted default.
2. **A pricing oracle behind a read verb.** `POST /agreements/debug-resolve`
   (`agreements-debug.ts:89`) is gated `billing.read` but accepts an arbitrary
   `userId` and `chargingStationId` and returns resolved bearer, recipient and
   per-line amounts. `GET /debug-options` (`:173`) feeds it up to 500 driver
   rows including email via an unfiltered `prisma.user.findMany`.
3. **Target org taken from the request body.** `POST /billing/tariffs-mgmt`
   reads `input.orgId` (`billing-tariff-mgmt.ts:125`) with no cross-check.

### 3.5 The pattern to copy — it already exists here

`bill-objects` is correct and it is **two-layer**: the gate passes
`{orgIdParam: 'orgId'}` *and* `getBillObject` re-checks, returning null when
`row.orgId !== orgId` (`repositories/bill-objects.ts:127`). `orgs.ts:318` does
the equivalent compare in the handler instead — which is exactly why the same
`getSessionFullDetail` repository is fully cross-tenant exposed at
`routes/admin/billing.ts:103`. The lesson is that repository-level re-checking
is what actually contains the exposure; the gate alone did not.

`resolveOrgScope` (`lib/auth/org-scope.ts:38`) is the codebase's existing
row-scoping mechanism, used by 13 handlers across sites/chargers/circuits —
and by exactly **one** billing gate (`billing.ts:180`).

### 3.6 Recommended order

1. Invert the two default-widening params (§3.4.1) — smallest change, largest
   immediate reduction in exposure.
2. Gate or remove `debug-resolve` / `debug-options` (§3.4.2).
3. Introduce `orgId` into the seven repository signatures, `bill-objects`-style
   two-layer, starting with `getSessionFullDetail` (the one with a proven
   cross-tenant route).
4. Only then revisit the 33 org-blind gates, because fixing them without §3.3
   converts "nobody can read" into "everybody can read everything".

**Zero route-level tests exist for any of the 41 gates.** `routes/admin`
contains only `charging-stations.test.ts`, and `require-permission.test.ts`
exercises `orgIdParam` exclusively with `site.write`, never a billing verb.
Any slice here should land with the first ones.

---

## 4. TF4 — Manual driver management

### 4.1 Why the operator is locked out, and why a membership will not help

Same root cause as §3.2. Of 26 `member.*` gates, the 13 without `orgIdParam`
resolve `orgId = null`, so `effective-permissions.ts:203-206` skips the
membership lookup entirely. **Granting the operator a membership cannot
restore those 13.** Only the `orgIdParam` gates are membership-restorable.

### 4.2 The restore is deadlocked through the API **[census]**

- `routes/admin/orgs.ts:395` is the only route that inserts a `Membership`,
  and it is gated on `member.invite`.
- `expandPlatformTenantVerbs` explicitly refuses to confer `member.invite`
  (`effective-permissions.ts:110-114`).
- The god-mode escape at `require-permission.ts:56-60` needs a session with no
  `userId`, and `routes/admin/auth.ts:134-137` always attaches
  `resolvedUserId` on both login paths.

Direct SQL is the only remaining entry. **That is a finding, not an
instruction — I have not run it and it needs Andri's approval.**

One flow still works, and it is instructive: `routes/admin/org-invites.ts:66`
and `:174` gate on `platform.tenant.write` rather than `member.invite`, which
is the only reason the operator-invite path functions today.

### 4.3 One-line restoration available now

`routes/admin/driver-group-memberships.ts:156` gates a **pure read**
(`listMembershipsForDriverGroup`) on `member.write`. Changing that to
`member.read` restores group-member listing for the live operator with no
membership and no schema change. This is the cheapest real win in the whole
programme.

### 4.4 Structural gaps in driver management [census]

- **Revocation is unreachable.** `repositories/driver-group-memberships.ts:118`
  `removeMembership` is the only code that deletes a membership row and has
  **zero callers**; the route exposes only POST and GET, despite the file
  header claiming a DELETE endpoint uses it. Access can be granted and never
  withdrawn — which is the same shape as the known local-auth-list revocation
  gap (ADR 0041).
- **Nothing creates a `DriverGroup`** anywhere in `apps/api/src`. Groups must
  be inserted out of band.
- **Three disagreeing driver-creation paths**, while the shared helper
  `createDriver` (`create-driver.ts:143`) has zero importers and sits in
  `.unused-exports-known.json`: `users.ts:239` mints `kind='rfid'`,
  `registration.ts:197` mints `virtual_rfid` from a duplicated derivation, and
  `host-invites.ts:180-184` creates the invitee **with no IdToken at all**.
- **The consumer UI is archived.** Every page calling `/api/admin/users`,
  `/api/admin/tokens` and the driver-group routes lives under
  `archive/straumvakt-org-console-2026-08-08/`. Restoring permissions alone
  restores no user-visible flow.

### 4.5 Recommendation

Prefer **membership-derived authority with `orgIdParam` on every gate** over
widening platform grants. Platform-derived authority is what makes a
successful check tenant-wide, and §3.2 shows the two are not
interchangeable — a platform grant is not "the same permission, obtained
differently", it is a different and wider one. Concretely: add `orgIdParam` to
the 13 org-blind `member.*` gates, then grant the operator a membership, and
ship §4.3 immediately regardless.

---

## 5. TF5 — Safe invite-by-link

### 5.1 What is already safe on this branch **[census, corroborates prior work]**

The S2 hardening is present: `routes/public/invites.ts:168-177` guards on the
`passwordHash` column **before** the token claim at `:181`, backed by 12
assertions in `invites.test.ts` and by `scripts/check-invite-guard.mjs` wired
into `check-all` as `invite-guard`. ADR 0053 identity binding is present at
`driver.ts:1207`, also before the claim at `:1254`. The ordering bug is fixed
and guarded.

### 5.2 The redemption loop is still broken end to end

This corroborates the previously recorded driver-invite finding and adds the
mechanism:

- **No invite is ever delivered.** `host-invites.ts:146-238` returns an
  `inviteUrl` of `/invite/<code>` and calls no mailer. The target does not
  exist either — `src/app` has no invite route; the only `/invite/[token]`
  page is in the archive.
- **The mobile client calls the wrong endpoint.** `client.dart:93-119` posts
  to `/api/public/invites/consume`, which rejects `kind='driver'` at
  `invites.ts:130` with a 404 the client renders as "not recognised". No
  `/api/driver/claim-invite` call exists anywhere in `apps/mobile/lib`, so the
  ADR 0053 loop proven in parity tests has no shipping client.
- **Kennitala is collected and discarded.** `redeem_invite.dart:87-92`
  validates and submits it; `ConsumeBody` is non-strict Zod and strips it — a
  behaviour pinned deliberately by `invites.test.ts:215`.

### 5.3 Three defects that need decisions, not just code

1. **A second-org membership can never be activated.** `invites.ts:202` is the
   *only* writer that sets `Membership.status='active'` (the admin PATCH sets
   role only). Since `createInvite` binds the token to an existing user
   resolved by email, a person who already has a password gets 409
   `already_claimed` and can never join a second org. **Core needs an
   authenticated accept endpoint** — this is a missing feature, not a bug fix.
2. **The two credential guards disagree.** `invites.ts:168` tests the
   *column* (`passwordHash !== null`); `driver.ts:1089` tests *row existence*
   (`credentials !== null`). `clearUserPasswordHash` nulls the column and keeps
   the row — so an admin password clear is recoverable on the org path and a
   **permanent 409 lockout** on the driver path.
3. **An audience-blind find-or-create.** `createDriverInvite`
   (`host-invites.ts:175-184`) resolves the invitee by email with no audience
   filter, so an existing `operator` user becomes the bound driver;
   `driver.ts:158` then refuses login with 403 `wrong_audience`, making that
   invite permanently unredeemable.

### 5.4 Two unguarded surfaces

- `/api/public/invites` is mounted (`index.ts:206`) with **no rate limiter**,
  while `/api/driver/claim-invite`, `/api/public/register` and both
  password-reset routes all carry one. An unauthenticated code-guessing
  surface is the one that most needs it.
- `routes/admin/org-invites.ts:40` builds the emailed invite URL from the
  request's own `origin`/`referer` header, and `:134` returns the token
  plaintext in the 201 body.

### 5.5 A grant with no invite, no approval and no audit

`repositories/registration.ts:451-484` grants a `DriverGroupMembership` to the
bearer of a `magic_link` token with no invite, no approval, and no audit row
(`recordAuditAction` appears zero times in that file). The token is claimed at
`:373` before the grant at `:465`, and the grant is a bare create against a
unique constraint **outside a transaction** — so a duplicate 500s with the
token already spent. This is the same ordering shape as the S2 bug, in a file
that was not covered by the S2 fix.

### 5.6 Recommended order

1. Rate-limit `/api/public/invites` (§5.4) — one line, unauthenticated surface.
2. Reconcile the two credential guards on the *column* reading (§5.3.2), which
   is the recoverable one.
3. Add the audience filter to `createDriverInvite` (§5.3.3).
4. Wrap the `registration.ts` grant in the token-claim transaction (§5.5).
5. Then design the authenticated accept endpoint (§5.3.1) — the only item here
   that is a feature rather than a repair.

Coverage note: there is no `driver.test.ts` for claim/redeem, no
`host-invites.test.ts`, no `repositories/invites.test.ts`, and every block in
the parity test is `describe.skipIf(!hasDb)`.

---

## 6. TF6 — Period close and delivery

### 6.1 Delivered

- `period-close.ts` — half-open UTC month bounds (Iceland is UTC+0, no DST),
  close gating that reports **every** blocker at once, and additive correction
  lines that carry the difference while keeping both figures. Regenerating a
  closed statement is refused. 29 tests.
- `delivery-log.ts` — delivery-attempt ledger, 32 tests, fool-tested.

### 6.2 The ledger resists restatement; `charging.sessions` does not **[census]**

All four ledger writers narrow their upsert update branch so `costIskMinor`
survives. But `zaptec-session-sync.ts:306-332` **unconditionally overwrites**
`endedAt`, `energyWh`, `costExVatMinor` and `costIncVatMinor` on the CDR
overlay branch with no date or period guard. The only thing preventing repeat
restatement is the unique `(sourceKind, sourceCdrId)` lookup at `:140-146` —
**that is idempotency, not immutability.** A first-seen CDR for a closed month
restates it.

### 6.3 The widest door is an operator route, not the cron

`POST /api/admin/vendor-credentials/:id/sync-sessions?from=&to=`
(`vendor-credentials.ts:150-226`) accepts any ISO window, fans out across every
installation, is gated only on `platform.tenant.write`, and writes no audit
row. Its own header advertises sweeping April plus May. **A close design must
gate this route, not just the projection writers** — the 26-hour cron window
(§0) is not the exposure; this is.

### 6.4 What close still needs

- **A state column.** `checkPeriodClose` counts rows by
  estimated / awaitingReconciliation / heldForReview / billable. Those counts
  can only come from the state machine in §2. Two free-text columns cannot
  produce them.
- **Storage for corrections exists already.** `AgreementBillingLine
  .billableEventType` (`commercial.prisma:761-764`) defaults to `'session'`,
  is indexed, and its comment reserves `'manual_adjustment'` — with zero
  readers or writers repo-wide. That is the cheapest path from
  `buildCorrectionLine` to persistence, and it needs no migration.
- **Nothing imports any of this yet.** `grep core-billing` outside
  `packages/commercial` returns zero hits. All seven modules are pure and
  wired to nothing — deliberate for this branch, and the next branch's job.
- **No statement surface exists.** The only statement-shaped read is `GET
  /admin/billing/sessions` — a paged ledger list with no period identity, no
  totals block, no recipient, no issued document. No CSV or PDF export exists
  anywhere in `apps/api/src`.
- **`getPeriodTotals` is not org-scoped** despite its file header claiming so
  (`billing-summary.ts:25-43` filters on `startedAt` only).

### 6.5 Landmines for whoever implements this

Five orphan enums survive their dropped tables and will mislead an implementer
into thinking an invoicing model exists: `InvoiceStatus`, `BalanceType`,
`PlanCategory`, `TerminationBehavior`, `BillingTxType` — mirrored again as
Drizzle enums. `billing.invoices`, `billing.invoice_lines`,
`billing.statements` and `reports.billing_period_summary` were all dropped in
the 2026-08-07 migration. Delete the enums or document them as dead.

---

## 7. State of this branch

| | |
| --- | --- |
| Modules in `packages/commercial/src/core-billing` | 8 |
| Tests there | 241, all passing |
| Repo guards added | 1 (`pricing-ssot`), wired into `npm run check` |
| `tsc(commercial)` | clean |
| Runtime behaviour changed | **none** — nothing in `apps/api` imports these |
| External state changed | none |

The one runtime change from earlier in this programme (`1110249`, session
energy = meterStop − meterStart) remains the only live code change, and the
census confirms its hold logic is still unreachable (§1.4).

## 8. What I would do first

1. **§4.3** — one-line `member.write` → `member.read`. Restores a real flow today.
2. **§1.2** — the 100× driver-facing figure. Small, and it is what users see.
3. **§1.3** — a guard connecting the publishable compute-rule vocabulary to the
   resolver's. Offline-testable, and today a published tariff loses events.
4. **§3.4.1** — invert the two default-widening `?orgId` params.
5. **§6.3** — gate `sync-sessions` before designing close around the cron.

Items 1–4 are each small enough to land with a test in a single reviewed
change. Item 5 is the one that must precede any period-close implementation.

## 9. Open decisions for Andri

- **VAT on the Core subscription** (§1.4). Blocks the first Core statement.
- **Reconciliation tolerance**: 0.05 kWh or 0.001 kWh (§2.2).
- **Membership vs platform grant** for driver management (§4.5) — I recommend
  membership-derived with `orgIdParam`, but it is a larger change.
- **Direct SQL to break the membership deadlock** (§4.2) — not run, needs
  approval.
- Whether the second-org accept endpoint (§5.3.1) is in Core scope.
