# Core billing — 30 scenarios and 20 API examples

**2026-08-11.** Executable-shaped acceptance criteria for the routes in
`CORE_BILLING_ROUTE_CONTRACTS`, none of which exist yet. Written now because the
behaviour is decided now — every `Then` below is already enforced somewhere in
`packages/commercial` or in `lib/billing/`, and the route's job is not to
re-decide it.

Money in these scenarios is **aurar** (1/100 ISK) unless a line says ISK.

---

## Settlement

```gherkin
Feature: A session becomes a settlement, or it becomes a hold

  Scenario: 1 — a clean session settles at the rates in force at its start
    Given a session started 2026-07-14T18:00Z with meter 1,000,000 → 1,034,000 Wh
    And a DSO rate of 864 aurar/kWh effective from 2026-01-01
    And a retailer rate of 1,047 aurar/kWh effective from 2026-01-01
    When the session is settled
    Then its status is "settled"
    And it has exactly 2 settlement components
    And each component stores its own unit price and effective window

  Scenario: 2 — a rate edited afterwards does not move the figure
    Given a settled session
    When both rates are republished at 9,999 aurar/kWh
    Then the settlement's total is unchanged
    And repricing it under the new rates yields a different number
    # If those two ever agree, locking and coincidence are indistinguishable.

  Scenario: 3 — no rate covering session start goes to review
    Given a session whose only rate became effective after it started
    Then its status is "billing_review_required"
    And a hold exists with reason "no_rate_at_session_start"

  Scenario: 4 — an effective window ending at session start does not cover it
    Given a rate with effectiveUntil equal to the session start instant
    Then that rate is not used
    # effectiveUntil is EXCLUSIVE. The boundary is the whole point of a window.

  Scenario: 5 — a missing meter stop reading holds, it does not bill zero
    Given a session with no meter stop reading
    Then a hold exists with reason "meter_unresolvable"
    And the settlement's energy is null, not 0

  Scenario: 6 — a backwards meter says so specifically
    Given a session whose stop reading is below its start reading
    Then a hold exists with reason "negative_or_impossible_energy"
    And no hold exists with reason "meter_unresolvable"
    # "could not read it" and "read it, answer impossible" are different facts.

  Scenario: 7 — a CDR beyond tolerance holds
    Given a settled-shaped session measuring 34.0 kWh
    And a CDR reporting 40.0 kWh
    Then a hold exists with reason "cdr_mismatch_beyond_tolerance"
    And both figures are stored

  Scenario: 8 — a CDR within tolerance does not hold
    Given a CDR reporting 34.01 kWh against a 34.0 kWh meter figure
    Then the session settles
    # DEFAULT_CDR_TOLERANCE_KWH is 0.05 and is a default, not an agreed policy.

  Scenario: 9 — a held session still gets a settlement row
    Then the settlement exists with status "billing_review_required"
    # Dropping it makes the session invisible rather than blocked, and an
    # invisible session cannot appear in a period's blocker list.

  Scenario: 10 — an unattributed session settles with nobody to bill
    Given a session with no driver
    Then it settles
    And its driver_user_id is null

  Scenario: 11 — settling twice writes one row
    When the same session is settled a second time
    Then there is one row, keyed on session_id

  Scenario: 12 — a settlement for another org is refused
    Given a snapshot for org B
    When it is mapped under a request scoped to org A
    Then the write is refused with "cross_tenant_snapshot"
    And nothing is written
```

## Period close

```gherkin
Feature: A period closes only when nothing in it is unfinished

  Scenario: 13 — a clean period closes
    Given every session in July is settled with no unresolved hold
    Then preflight reports canClose true with no blockers

  Scenario: 14 — a held session blocks
    Then preflight reports blocker "sessions_held_for_review"
    And the held session id is listed

  Scenario: 15 — an unresolved hold blocks even when the settlement reads settled
    # The two can disagree: an operator may raise a manual hold after pricing.

  Scenario: 16 — a period that has not ended blocks
    Then preflight reports blocker "period_not_yet_ended"

  Scenario: 17 — closing refuses if the blocker count moved
    Given an operator saw 3 blockers and submits expectedBlockerCount 3
    And a fourth session was held in the meantime
    Then the close is refused
    # Closing over a blocker the operator never saw is the failure to prevent.

  Scenario: 18 — closing twice with the same idempotency key closes once
    Then the second request returns the first response
    And the period has one closed_at

  Scenario: 19 — closing twice with the same key but a different body conflicts
    Then the second request is refused with 409
    # request_hash catches what the key alone cannot.

  Scenario: 20 — what was outstanding at close is recorded
    Then blockers_at_close holds the list, not merely a count
```

## Statements

```gherkin
Feature: A statement says what was billed, and what was left off

  Scenario: 21 — the total is the sum of the ROUNDED lines
    Given three lines of 250 aurar each
    Then each line bills 3 ISK and the total is 9 ISK
    And it is not 8 ISK
    # 8 is rounding-of-sum. The customer-facing answer is sum-of-rounded.

  Scenario: 22 — both figures are stored per line
    Then each line carries the unrounded aurar and the billed ISK

  Scenario: 23 — a held session is excluded BY ID, not priced at zero
    Then the statement lists it in excluded_session_ids
    And it has no line
    # Excluding a session and pricing it at zero look identical on a bill.

  Scenario: 24 — a foreign session id can never reach a customer document
    Given an excluded id the caller cannot vouch for
    Then generation is refused with "foreign_excluded_session"

  Scenario: 25 — an empty period produces a statement, not an absence
    Then a statement exists with total 0 and no lines

  Scenario: 26 — regenerating identical content is the same document
    Then the statement key is unchanged and no second row is created

  Scenario: 27 — regenerating DIFFERENT content is detected
    Given a session was added to the period after the first generation
    Then the statement key differs
    And the request is refused with "already_generated_with_different_content"

  Scenario: 28 — a statement cannot be generated for an open period
    Then the request is refused with "period_not_closed"
```

## Delivery

```gherkin
Feature: A delivery is provable, or it is not a delivery

  Scenario: 29 — a successful send records the provider's message id
    Then the attempt is "sent" with outcome_kind "ack" and a provider_message_id
    And the destination address at time of send is recorded

  Scenario: 30 — a missing email binding is NOT a delivery
    Given RESEND_API_KEY is absent
    Then the attempt is "failed" with outcome_kind "not_configured"
    And provider_message_id is null
    # email.ts:45-51 fails OPEN today, so "delivered with no provider" and
    # "delivered to the customer" are currently indistinguishable. This is the
    # single most important scenario on this page.
```

---

# 20 API examples

Paths follow `CORE_BILLING_ROUTE_CONTRACTS`. `{org}` is a UUID; every admin
route takes it in the path so `requirePermission` can see it.

### Valid

**1 · Period preflight**
`GET /api/admin/orgs/{org}/billing/periods/2026/7/preflight`
```json
{ "period": {"orgId":"{org}","year":2026,"month":7},
  "periodStart":"2026-07-01T00:00:00.000Z","periodEnd":"2026-08-01T00:00:00.000Z",
  "state":"open","canClose":false,
  "blockers":["sessions_held_for_review"],
  "explanation":"Blocked by 1 condition",
  "counts":{"billable":120,"estimated":0,"awaitingReconciliation":0,"heldForReview":1},
  "heldSessionIds":["11111111-2222-4333-8444-555555555555"],
  "activeConnectors":20,"activeDrivers":146,
  "subscriptionSubtotalMinor":"1080000","currency":"ISK" }
```

**2 · Close a period**
`POST /api/admin/orgs/{org}/billing/periods/2026/7/close`
```json
{ "orgId":"{org}", "year":2026, "month":7,
  "idempotencyKey":"close-2026-07-a3f9c1", "expectedBlockerCount":0 }
```

**3 · Resolve a hold**
```json
{ "orgId":"{org}", "sessionId":"1111…5555", "resolution":"accept_cdr",
  "note":"CDR verified against the meter export; 0.9 kWh gap is the AC/DC loss",
  "idempotencyKey":"hold-1111-5555-v1" }
```

**4 · Deliver a statement**
```json
{ "orgId":"{org}", "statementId":"stmt_202607_driver_1a2b3c4d",
  "channel":"email", "resend":false, "idempotencyKey":"deliver-stmt-1a2b3c4d-01" }
```

**5 · Re-send after a bounce** — a *new* key, deliberately.
```json
{ "orgId":"{org}", "statementId":"stmt_202607_driver_1a2b3c4d",
  "resend":true, "idempotencyKey":"deliver-stmt-1a2b3c4d-02" }
```

**6 · List driver statements** — `limit` defaults to 50, caps at 100.
`GET /api/admin/orgs/{org}/billing/statements?year=2026&month=7&limit=50`

**7 · A driver's own material** — no `orgId` anywhere.
`GET /api/driver/billing-material?limit=12`

**8 · Export**
`GET /api/admin/orgs/{org}/billing/statements/export?year=2026&month=7&format=csv`

**9 · A future rate, no reason needed**
```json
{ "orgId":"{org}", "kind":"dso", "code":"AD1", "pricePerKwhMinor":"921",
  "effectiveFrom":"2027-01-01T00:00:00Z", "idempotencyKey":"rate-ad1-2027-01" }
```

**10 · A backdated rate WITH a reason**
```json
{ "orgId":"{org}", "kind":"dso", "code":"AD1", "pricePerKwhMinor":"864",
  "effectiveFrom":"2026-07-01T00:00:00Z",
  "reason":"Veitur published a correction to the July AD1 tariff on 2026-08-05",
  "idempotencyKey":"rate-ad1-2026-07-corr" }
```

### Invalid — and what makes each one wrong

**11 · No `orgId`** → 400. Every admin contract requires it; without it
`requirePermission` resolves the tenant to null and skips the membership lookup
entirely.
```json
{ "year": 2026, "month": 7 }
```

**12 · A driver naming an org** → 400, field not in the schema. A cross-tenant
hole dressed as a filter; identity comes from the bearer token.
```json
{ "orgId": "{other-org}", "limit": 12 }
```

**13 · Money as a JSON number** → 400.
```json
{ "pricePerKwhMinor": 864 }
```

**14 · Money with a decimal** → 400. `"8.64"` is krónur; the API takes aurar.
```json
{ "pricePerKwhMinor": "8.64" }
```

**15 · A free date range** → 400. Core bills whole calendar months.
```json
{ "orgId":"{org}", "from":"2026-07-05", "to":"2026-08-04" }
```

**16 · Month 13** → 400.

**17 · A mutation with no idempotency key** → 400. A network blip would
double-charge or double-send.

**18 · A key under 8 characters** → 400 — "Idempotency-Key must be at least 8
characters". A short key collides across unrelated requests.

**19 · A hold resolved with no note** → 400. "Resolved" with no reason is
indistinguishable from a mis-click, and this is the row an auditor reads when a
customer disputes a charge. A whitespace-only note is also rejected.
```json
{ "orgId":"{org}", "sessionId":"1111…5555", "resolution":"accept_cdr",
  "idempotencyKey":"hold-1111-5555-v1" }
```

**20 · A backdated rate with no reason** → 400, "restates history". Backdating
is possible; it is never accidental.
```json
{ "orgId":"{org}", "kind":"dso", "code":"AD1", "pricePerKwhMinor":"864",
  "effectiveFrom":"2026-07-01T00:00:00Z", "idempotencyKey":"rate-ad1-oops" }
```

**Also rejected, worth knowing:** an inverted effective window
(`effectiveUntil` before `effectiveFrom`), a negative price, `"currency":"EUR"`
(Iceland-only for now), an export `format` of `"pdf"` (nobody has specified one),
a list `limit` of 500, and any blocker string outside the four `CloseBlocker`
values — an unknown blocker is rejected rather than passed through, because a
blocker nobody can act on is worse than none.
