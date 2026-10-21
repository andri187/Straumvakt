# P0 remediation specifications

**Proposals only — nothing here has been implemented.** Each spec is written so
a backend/mobile/infra owner can execute without rediscovering the system.

Source snapshots: RC `4b69d0f`, mobile `ae5db26`. See
[the index](2026-08-09-remediation-architecture-index.md).

---

# P0-A · Driver telemetry truth contract

## Verified problem

`apps/api/src/repositories/driver-sessions.ts` emits, for every active session:

```ts
powerKw:   0,                              // :135 — hardcoded, never measured
energyKwh: whToKwh(r.energyWh),            // :89-91 — null collapses to 0
costIsk:   minorToIsk(r.costIncVatMinor),  // :95-98 — null collapses to 0
status:    "Charging",                     // :133 — literal, not a mapping
```

`apps/api/src/routes/public/driver.ts:593` and `:683` likewise emit `costIsk: 0`
in stop-session responses.

**A numeric `0` is used to mean four different things**: measured zero, not
measured, not yet priced, and genuinely free.

## Impact

- **User:** a driver mid-charge is told "0.0 kW · 0 kr" — nothing is happening,
  and it is free. Both false.
- **Operational:** any consumer that trusts the API cannot distinguish a stalled
  charge from an unmeasured one, so alerting on "0 kW while in progress" is
  impossible.
- **Current mitigation is client-side only.** Codex's `ae5db26` renders
  `Unavailable`/`Pending` (`active_session.dart:240,246`) by treating `0` as
  absent. That is a **workaround in one client**, and it is lossy: a genuinely
  free session is now also shown as "Pending".

## Desired invariant

> A driver-facing numeric field is present **only** when the system has a value
> for it. Absence is represented as `null`, never as `0`. "Free" and
> "not yet priced" are distinguishable without inspecting other fields.

## Options

| # | Option | Assessment |
|---|---|---|
| **1** | **Emit `null` instead of `0`** for unmeasured/unpriced; keep field names | **Recommended.** Smallest change; Codex's client already guards on null; no new endpoint |
| 2 | Add a parallel `availability` object per field | More expressive, larger contract change, more client work |
| 3 | Version the endpoint (`/v2/sessions/current`) | Cleanest but most expensive; nothing else forces a version bump yet |
| 4 | Leave it; keep compensating in clients | Rejected — every new client re-implements the workaround and one will get it wrong |

## Recommended: Option 1, with a narrow availability extension

Two-part contract:

```jsonc
{
  "sessions": [{
    "sessionId": "…",
    "status": "charging",              // real mapping, not a literal
    "startedAt": "2026-08-09T00:12:00Z",
    "energyKwh": 4.219,                // null when unknown
    "power": null,                     // null — never measured today
    "cost": {
      "amountMinor": null,             // null = not yet priced
      "currency": "ISK",
      "exponent": 2,
      "state": "pending"               // pending | priced | free | unpriced
    }
  }]
}
```

`cost.state` is what makes **free** (`amountMinor: 0, state: "free"`)
distinguishable from **not yet priced** (`amountMinor: null, state: "pending"`)
— the distinction Option 1 alone cannot express, and the one Codex's client
currently collapses.

## Components likely affected

| Component | Change |
|---|---|
| `apps/api/src/repositories/driver-sessions.ts` | `whToKwh`/`minorToIsk` return `null` not `0`; drop hardcoded `powerKw`; map real status |
| `apps/api/src/repositories/driver-invoices.ts` | same null semantics (`:22,:80`) |
| `apps/api/src/routes/public/driver.ts` | `:593,:683` stop-session snapshots |
| `apps/mobile/lib/api/types.dart` | consume `cost` object; **remove the `0`-means-absent workaround** |
| Archived web driver portal | if ever restored — it reads `costIsk` directly |
| `driver-sessions.test.ts` | fixtures at `:53,:246,:263` assert `0`/null today |

## Compatibility and old clients

`ae5db26` treats `0` as absent, so **emitting `null` is safe for it** — it
already renders `Unavailable`. An older client that renders `0` verbatim would
start showing empty rather than a false zero, which is the desired direction.

**Monitoring for zero-interpreting clients:** log a counter when a driver
endpoint would have emitted `0` under the old rule, tagged by user-agent, for
one release. If a client population still depends on `0`, it shows up before the
old shape is removed.

## Rollout

1. Land `null` semantics behind the existing shape (additive `cost` object,
   keep `costIsk` for one release).
2. Ship mobile that reads `cost`.
3. Observe the zero-interpretation counter for one release.
4. Remove `costIsk`/`powerKw` scalars.

## Tests and acceptance

- Unit: `getDriverActiveSessions` returns `null` for absent energy/cost; never `0`.
- Unit: a genuinely zero-cost session returns `state: "free"`, `amountMinor: 0`.
- Contract: no driver DTO contains a numeric `0` for an unmeasured quantity.
- Acceptance: **AC-22…AC-25** in the launch acceptance plan flip to pass.

## Observability

Metric `driver_session_field_absent_total{field,reason}`. Alert if
`power` is absent for 100% of active sessions for >24h — that is the signal
that P0-B (provenance) was never done.

## Rollback

Additive; revert the repository change. No schema, no migration.

## Out of scope

Sourcing an actual power value — that is **P0-B**. This spec makes the absence
honest, not the value present.

## Approvals

Backend owner. No product decision needed — this removes a false claim.

---

# P0-B · Live power provenance

## Verified problem

There is **no power source at all**. `driver-sessions.ts:108` claims *"the app
polls `/sessions/current` and reads live power from the charger-status surface"*
— no such call exists in `apps/mobile/lib/api/client.dart` at either `29c3317`
or `ae5db26`. The comment describes a design that was never wired.

## Options

| # | Option | Cost | Notes |
|---|---|---|---|
| 1 | **Ship without live power** | none | Legitimate once P0-A lands. Remove the tile rather than show "Unavailable" forever |
| 2 | Derive from meter values | medium | `MeterValue` rows exist; needs a latest-per-session read and a freshness stamp |
| 3 | Read charger status surface | medium | Requires the surface the comment imagines |
| 4 | Compute from energy delta | low | `Δenergy/Δt` between polls — **an estimate**, and must be labelled one |

**Recommendation:** Option 1 for launch, Option 2 as the real answer. Option 4
is tempting and cheap but produces a number that looks measured and is not —
the exact failure mode this packet exists to remove.

If Option 2: the contract needs `power: { kw, observedAt, source }` so a stale
reading is visibly stale. Specified in
[contract 3A](2026-08-09-driver-api-contract-proposals.md#3a).

## Acceptance

No UI element implies a measurement the system does not hold. If a value is
shown, it carries `observedAt` and the UI degrades it after a freshness bound.

## Approvals

**Product decision** — Andri. This is the one P0 that is a product choice, not a
correctness fix.

---

# P0-C · Driver login rate limiting

## Verified problem

`apps/api/src/routes/public/driver.ts:121` — `publicDriver.post("/login", …)`
has **no middleware**. Meanwhile `:1029-1036` rate-limits `/claim-invite` at
10/min by IP using a binding literally named **`DRIVER_LOGIN_RATE_LIMITER`**.
Admin login is throttled via `ADMIN_LOGIN_RATE_LIMITER`
(`apps/api/src/routes/admin/auth.ts`).

**Inference (high confidence):** the limiter was written for `/login` and landed
on the wrong route. The name is the evidence.

## Design

Reuse the existing `rateLimit()` helper (`apps/api/src/lib/rate-limit`) — no new
mechanism.

| Dimension | Proposal | Rationale |
|---|---|---|
| Keys | **Two independent limiters**: by IP (coarse) and by `sha256(lowercased email)` (fine) | IP-only lets a botnet spread; account-only lets one IP walk many accounts |
| Limits | IP 20/min burst 40; account 5/5min burst 5 | Admin parity: match `ADMIN_LOGIN_RATE_LIMITER` unless it is looser |
| Backoff | Exponential per account after 3 failures, capped ~15 min | |
| Response | **`429` with identical body for throttled-existing and throttled-unknown accounts** | Enumeration resistance — the response must not distinguish |
| Privacy | Key on a **hash** of the email, never the address; never log the address on failure | Rate-limit keys are observable in logs |
| Distributed | Cloudflare rate-limiting bindings are per-colo-approximate. Accept approximation for IP; for account use a Durable Object if strict counting is required | **Unknown:** whether the existing binding is strictly counted — verify before promising a number |
| Audit | Emit `driver.login.throttled` with hashed key + colo, never the credential | |

### Naming mismatch

Either rename the binding to reflect `/claim-invite`, or — better — add a
second, correctly named binding and leave the existing one where it is.
**Do not simply move it**; `/claim-invite` legitimately needs throttling too.

## Tests

- 429 after threshold, per IP and per account, independently.
- Identical response shape/timing for unknown vs. existing account under throttle.
- A throttled account recovers after the window.
- **Negative:** a legitimate driver on a shared corporate NAT is not locked out
  by another user's failures — this is the main false-positive risk.

## Rollout

Config (binding) then code, since a missing binding must fail safe. Confirm the
helper's behaviour when the binding is absent — the admin path documents a
dev-environment fallback; **verify it fails open or closed before relying on it.**

## Rollback

Remove the middleware; no data change.

## Approvals

Backend owner + infra for the binding. Blocks launch.

---

# P0-D · Multiple active sessions policy

## Verified problem

Multiple concurrent sessions are supported **end to end and by accident of
design, not by decision**:

- `getDriverActiveSessions` returns an array ordered `startedAt desc`.
- `/sessions/current` returns `{ sessions: [...] }`.
- `stop-session` requires an explicit `sessionId` (uuid) and resolves ownership
  in the query predicate — **so stopping is already deterministic**.
- `ae5db26` tracks a selected session across multiple rows.

Nothing prohibits it; nothing designs for it.

## Options

| # | Option | Where enforced | Consequences |
|---|---|---|---|
| 1 | **Prohibit** — one active session per driver | `start-session`: reject with `409 already_charging` | Simplest UI. **But is it true?** A driver with two cars, or a household sharing an account, breaks. Also races: a stale in-progress row blocks a legitimate start |
| 2 | **Allow, require explicit selection** | UI-only; API unchanged | Matches current implementation. Cost: every screen must handle N>1, including notifications and billing attribution |
| 3 | **Allow, nominate a primary** | API adds `primarySessionId`; deterministic rule (most recently started, tie-break by id) | Best UX for the common N=1 case while remaining correct for N>1. Cost: a rule that must be stable across polls |

## Recommendation

**Option 3**, with Option 2's contract as the substrate — the array stays
authoritative, and `primarySessionId` is a hint the UI may follow. Reasons:

- It does not require a backend prohibition whose correctness depends on session
  cleanup being perfect. **Option 1's failure mode is "driver cannot start
  charging", which is worse than any N>1 UI awkwardness.**
- Stop safety is already solved (explicit `sessionId`).
- It gives notifications and deep links a single deterministic target.

## Coverage

| Concern | Under Option 3 |
|---|---|
| Stop safety | Unchanged — explicit id, ownership in predicate |
| UI recovery | Cold start resumes the primary; a switcher exposes the rest |
| Notifications | Address the primary; N>1 raises a "2 sessions active" affordance |
| Billing | Unaffected — attribution is per session row already |
| Concurrency | Primary must be computed from a stable ordering, not client state |
| Charger ownership | Unchanged — access is checked per charger at start |
| Migration | None. Current behaviour is a strict subset |

## Acceptance

**AC-17** passes: two sessions, both listed, stop targets the chosen one. Plus:
primary selection is stable across consecutive polls with no state change.

## Approvals

**Product decision** — Andri. Note that **silence ships Option 2**, because the
implementation already allows N>1.

---

# P0-E · Money-unit contract (new — supersedes audit P1-4)

## Verified problem

See [index §1](2026-08-09-remediation-architecture-index.md) for the full
evidence chain. Summary:

- The cost columns are **aurar (1/100 króna)** — stated by the code that writes
  them (`compute-session-cost.ts:13-21`) and by the server formatter
  (`formatIskMinor`, `:211-219`).
- `driver-sessions.ts:93-98` `minorToIsk()` returns them **undivided** under the
  field name **`costIsk`**, with a comment asserting *"ISK has no minor unit"* —
  which contradicts the costing engine.
- Every current client divides by 100 (`ae5db26` `types.dart:234,464`; archived
  web portal `history/page.tsx:23` documents the convention explicitly).

**No live error** — two mismatches cancel. **But the comment invites a fix that
would break every client at once.**

## Desired invariant

> Any transported monetary value carries its unit explicitly. No field name
> implies a unit, and no client infers one.

## Recommended

```jsonc
"cost": { "amountMinor": 149900, "currency": "ISK", "exponent": 2, "state": "priced" }
```

`amountMinor` + `exponent` is unambiguous and multi-currency-ready
(`Organization.defaultCurrency` already exists). Clients render
`amountMinor / 10^exponent`.

## Immediate, zero-risk sub-task

**Before any refactor:** correct the comment at `driver-sessions.ts:93-98` and
rename the internal helper. The comment is currently a booby trap — it is the
single cheapest defect to remove in the whole packet, and leaving it while other
work proceeds is the likeliest way to cause a real money incident.

## Compatibility

Ship `cost` alongside `costIsk` for one release; clients migrate; remove the
scalar. **Do not change `minorToIsk`'s return value without removing the field
in the same release** — that is the 100× break.

## Tests

- Golden test: a known aurar value renders identically in server `formatIskMinor`,
  mobile, and (if restored) the web portal.
- Contract test: **no driver DTO exposes a bare monetary number**.
- Regression: a test asserting `costIsk` is *undivided aurar*, so the trap
  cannot be re-introduced silently.

## Approvals

Backend owner. **Coordinate with Codex** — a backend-only change here breaks
`ae5db26`.
