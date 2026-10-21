# Membership call sites, the resolution chain, and the enforceAuthorize switch

Written 2026-08-28 by `claude-b`, Phases 2 and 3 of round 4.

Basis labels: `[repo]` verified with a citation · `[inferred]` · `[confirm:]`.

---

## Phase 2 — the membership call-site census

### The count is not five. It is nineteen, of which nine decide something.

The dispatch says *"Five other call sites share the shape"* and invites a
correction. Measured `[repo]`, excluding generated Prisma clients and tests:

**19 references to `driverGroupMembership` across 14 files.** They are not one
population, and treating them as one is why the count has been slippery.

| Class | Count | What it is |
|---|---|---|
| **A — decides access or price** | **9** | `findFirst`/`findUnique` whose result gates a verdict or a rate |
| B — lists for a screen | 6 | `findMany` feeding a page or an export |
| C — writes | 2 | `create` on the registration and access-request paths |
| D — counts | 1 | `count()` for a summary tile |
| E — the new adapter | 1 | this round's `agreements-write.ts` |

**Class A is what item 9 is about**, and it is **9 sites — the primary plus
eight**, not the primary plus five.

### Class A, enumerated

| # | Site | What it decides | Dated today? |
|---|---|---|---|
| 1 | `routes/internal/ocpp-authorize.ts:277` | **the authorize verdict** — the primary | agreement dated; **membership not** |
| 2 | `lib/agreement/persist.ts:189` | which membership a priced line attaches to | no |
| 3 | `repositories/driver-access-requests.ts:200` | whether a request duplicates an existing grant | no |
| 4 | `repositories/driver-access-requests.ts:516` | same, on the approve path | no |
| 5 | `repositories/driver-access-requests.ts:577` | same, on the redeem path | no |
| 6 | `repositories/driver-pricing.ts:469` | **whether the driver may be priced at all** | no |
| 7 | `repositories/local-auth-list-push.ts:167` | whether the token goes in the charger's local list | no |
| 8 | `repositories/tap-intents.ts:365` | whether a tap is authorised | no |
| 9 | `routes/public/driver-charger-pin.ts:76` | whether the PIN unlocks the charger | no |

**Eight of the nine ask "does a row exist?" with no instant at all.** The
ninth — the primary — dates the *agreement* (`effectiveFrom <= now`,
`effectiveUntil > now`) but **not the membership**, and it uses
`const now = new Date()` `[repo: ocpp-authorize.ts:276]`.

### Two findings this census produced

**F2-A — the primary's date filter is on the wrong row.** Dating the agreement
and not the membership means a driver who moved out in March still authorises
in July, as long as the *agreement* is live. The interval that matters is the
one that does not exist yet — SR-2.

**F2-B — `new Date()` is correct for authorize and wrong for pricing.**
Authorising asks "may this person charge *now*", so `now` is right. Pricing
asks "was this person a member when the session *started*", and ADR 0054
decision 6 seals the session. Sites 2 and 6 are pricing-shaped and both use
the current instant. **`membershipForSession` exists so the two questions stop
sharing a call.**

### What was converted, and what was not

**Converted:** the port itself and everything that can be exercised offline —
`MembershipValidityPort` with the locked signature, `membershipForSession`,
the interval algebra, and a fixture adapter. **27 tests**, including a driver
who left mid-period, one who joined mid-period, one who **left and rejoined**,
the boundary instant, and an unresolvable membership producing `unavailable`.

**Not converted: the eight non-primary call sites.** Two reasons, both stated
plainly rather than worked around:

1. **The column does not exist.** A membership has no interval until SR-2
   lands, so a converted adapter would have nothing to filter on and would
   have to fall back to existence — converting the call sites without changing
   the answer, which is worse than not converting them, because it looks done.
2. **Ownership.** `driver.ts` is A's file outright, and
   `driver-pricing.ts`, `tap-intents.ts` and `local-auth-list-push.ts` are
   repositories the round-4 boundary does not assign to me.

**The port is the deliverable; the conversion is one line per site once SR-2
lands** — replace the `findFirst` with `port.isMemberAt(groupId, userId, at)`
and pick `at` from the table above. That mapping is why the census names the
instant each site should use, rather than only naming the site.

---

## Phase 3 — the resolution chain

### Implemented over the locked port

`PlacementResolverPort.resolveIdentity(identityString, at)` → identity → open
`device_identity` → device → open `placement` → installation. **One more hop,
the same verdicts** — the verdict set is untouched, as required.

`FixturePlacementResolver` implements it. 11 tests, including resolution at an
instant inside a **closed** placement (resolving to the host who held it
*then*), an identity present on two devices, the same identity reused at one
site across a swap, and a device moved between orgs.

### Ambiguity is refused, never arbitrated

Today the gateway resolves with
`WHERE lower(identity_string) = lower($1) LIMIT 1` — no org scope, no
`ORDER BY` `[repo: routes/internal/ocpp-auth.ts:82-91]`. Two orgs holding one
serial makes the winner undefined, and that winner's `orgId` is what the
session, the CDR and the invoice line are attributed to.

The resolver returns `unavailable("ambiguous_identity")` and
`unavailable("ambiguous_placement")` instead. **Until A's temporal key lands,
nothing in the database prevents two open rows, so the adapter refuses rather
than picking** — tested explicitly, and fool-test G shows the `LIMIT 1`
version picking arbitrarily.

---

## The `enforceAuthorize` switch — verified, not assumed

The dispatch flagged this as the round's likely-wrong premise and asked me to
verify the default and the gateway's behaviour myself. **I did, and the
handover is right on both counts, with one correction to the coordinator.**

| Claim | Verdict | Evidence |
|---|---|---|
| `enforceAuthorize` defaults **false** | **CONFIRMED** | `packages/shared/src/db/assets.ts:139` — `.notNull().default(false)`; `prisma/schema/assets.prisma:177` — `@default(false)` |
| The gateway replies `Accepted` regardless when it is false | **CONFIRMED** | `gateway/src/identity-do.ts:93-96` — *"Gateway honours `verdict` only when … false, gateway logs the verdict but always replies Accepted"* |
| *"one of which sets it `true` on a path"* | **WRONG** | `repositories/agreements.ts:201` is a Prisma **`select` projection**, not an assignment. **Nothing in the codebase assigns `enforceAuthorize = true`.** |

**One thing the handover did not say, and it matters:** the flag *is*
settable through the API — `packages/contracts/src/inputs/installations.ts:37`
accepts `enforceAuthorize` as an optional boolean on the installation update.
**So flipping it is a route call, not a migration**, which makes the sequence
below reversible in seconds rather than in a deploy.

**A second nuance worth recording:** the gateway *fails closed* on the access
gate when the verdict cannot be reached `[repo: identity-do.ts:28]`. So the
risk of switching on is not "unreachable API silently accepts" — it is the
opposite, and it is the reason step 4's abort condition is what it is.

### The ordered, reversible sequence — DESIGNED AND UNEXECUTED

**Nothing below was run. No `updateChargerSettings` call was issued, no live
setting was changed, and no socket was opened.**

```
 PRECONDITION — the default idTag exists as an ordinary group member.
   Phase 1's write surface expresses this with no special case:
     membership.add(group = the installation's group, userId = the token's user)
     clause bearer = "org"
   Verify: the group has the token as a member for an interval covering now.

 1. REGISTER THE TOKEN as a user + idToken row.
    Verify: the token resolves to a userId, and its status is active.
    ABORT IF: the token already belongs to a different org — that is the
    cross-org identity problem, not a registration step.
    REVERSIBLE: yes, trivially — the row is unused while step 4 is off.

 2. PUT IT IN THE GROUP under the installation agreement.
    Verify: membershipsOverlapping(group, now) includes it.
    ABORT IF: the agreement carries no billable clause — an installation whose
    agreement is empty would Accept here and produce a silent zero-cost
    invoice at session-stop, which is the GAP-2 shape already commented in
    ocpp-authorize.ts.
    REVERSIBLE: yes — close the membership interval.

 3. SET THE CLAUSE BEARER to `org`.
    Verify: the clause's bearerType is `org` and it covers the period.
    ABORT IF: the clause priced a settled period — the write surface refuses
    this by design; the remedy is end-and-add.
    REVERSIBLE: yes, by superseding.

 ── STOP. Everything above is invisible to a charger. Below is not. ──

 4. FLIP enforceAuthorize = true on ONE installation.
    PATCH the installation; it is an input-schema field, not a migration.
    Verify, in this order:
      a. an authorised driver still starts a session
      b. the default idTag still starts a session
      c. an unknown token is now Blocked with reason `no_contract`
    ABORT IF: any authorised driver is Blocked, OR the API is unreachable —
    the gateway fails CLOSED on the access gate, so an unreachable API with
    the flag on stops charging.
    REVERSIBLE: PATCH it back to false. Seconds, no deploy.

 5. WATCH one full charging cycle before the second installation.
    ABORT IF: any Blocked verdict names a driver who should be authorised.
```

**What an operator sees if it goes wrong:** a driver plugs in and the charger
refuses to start. The verdict is `Blocked` with `reason: "no_contract"` and it
is logged with the idToken id `[repo: ocpp-authorize.ts:305]`. The recovery is
step 4's reverse, and it takes one API call.

**Why one installation at a time:** `enforceAuthorize` is per installation
`[repo: assets.ts:139]`, so the blast radius of a mistake is one site rather
than the fleet. There is no global switch to get wrong.
