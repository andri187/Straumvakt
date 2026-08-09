# Beta acceptance programme

**A programme to be executed later, by named owners. Nothing here was run.**

Deepens the earlier beta gate into owners, commands, evidence, thresholds and
rollback per case.

## Environment safety classes — no test may silently cross

| Class | Runs against | May write? | Marker |
|---|---|---|---|
| **L** local/offline | fixtures, local build | yes, locally | — |
| **B** beta account | beta Workers + Neon `staging` | yes, **test identities only** | 🅑 |
| **H** real hardware | a physical charger on beta | yes | 🔧 |
| **P** production | real customers | **read-only until launch** | 🔒 |

**Rule: a test states its class in its title.** A case that cannot state its class
is not ready to run. The failure this prevents is a "quick check" run against
production because it was convenient.

---

## A · Singular organisation onboarding 🅑

| # | Case | Owner | Command / action | Expected | Threshold | Rollback |
|---|---|---|---|---|---|---|
| A1 | Create a test organisation through the real path | ops | onboarding UI | org created, flagged **test** | must succeed first attempt | delete the test org |
| A2 | Org appears with correct `kind` and roles | ops | `/org/[slug]` | matches input | exact | — |
| A3 | Duplicate kennitala rejected | ops | repeat A1 | clean validation error | no duplicate row | — |
| A4 | Org branding renders from its own row | ops | `/org/[slug]` | logo/accent from `branding` | — | — |

**Evidence:** org id, screenshots, the request/response pair for A3.

## B · Staff assistance 🅑

| # | Case | Expected | Threshold |
|---|---|---|---|
| B1 | Employee persona reaches `/staff/overview` | renders | — |
| B2 | Employee **cannot** reach `/org/[slug]` as a host | redirected | **must not render another tenant's data** |
| B3 | Staff can locate a driver, their org and their sessions **without database access** | found via UI | ≤ 3 minutes |

**B3 is a product test disguised as an operations one.** If it fails, every
future support incident escalates to an engineer.

## C · Unaffiliated driver 🅑

| # | Case | Expected |
|---|---|---|
| C1 | New driver, no org, signs in | reaches the empty-access funnel, **not** a dead end |
| C2 | Driver sees zero chargers | no other tenant's chargers leak |
| C3 | Driver requests access | request visible to a host admin |

## D · Invitation and installation access 🅑

| # | Case | Expected | Threshold |
|---|---|---|---|
| D1 | Host admin mints an invite | code issued, TTL set | — |
| D2 | Invitee redeems | membership + charger access granted | — |
| D3 | **Code minted for A, presented by B** | **REJECTED** | **on all three consume paths** |
| D4 | Reuse a consumed code | rejected | — |
| D5 | Expired code | rejected | — |
| D6 | Driver with access to 2 installations | picker appears | — |
| D7 | Driver with 1 installation | **no picker** | — |

**D3 must be run three times** — `/api/public/invites/consume`, `/redeem-invite`,
`/claim-invite`. ADR 0053's invariant is only as strong as its weakest path, and
enforcement on two of three is not enforcement.

## E · First real charge 🔧🅑

| # | Case | Evidence | Threshold |
|---|---|---|---|
| E1 | Start from the app | 202 + command id | — |
| E2 | Session row appears | session id | **< 60 s**, or the start-race grace state is wrong |
| E3 | App shows charging | screenshot | — |
| E4 | Kill and reopen the app | session recovered | — |
| E5 | Stop from the app | charger physically stops | **must actually stop** |
| E6 | Session completes | status `completed` | — |
| E7 | Cost projected | cost visible | < 10 min |
| E8 | **Independent cost calculation matches** | hand-calculated vs displayed | **exact** |

**E8 is the single most informative test in this programme.** Compute
kWh × tariff + fees by hand, compare to the app. It requires no new code and it
is the only test that can catch a unit error — the class of defect that type
systems and code review both miss.

## F · Concurrent sessions 🔧🅑

| # | Case | Expected |
|---|---|---|
| F1 | Two sessions for one driver | both listed |
| F2 | Stop the second one | **the second one stops**, not the first |
| F3 | Restart the app mid-two-sessions | selection is stable across polls |
| F4 | Both complete | two independent costs |

## G · Telemetry truthfulness 🔧🅑

| # | Case | Expected | If it fails |
|---|---|---|---|
| G1 | Power display during an active charge | **"Unavailable"**, never `0.0 kW` | launch blocker |
| G2 | Cost before pricing | **"Pending"**, never `0 kr` | launch blocker |
| G3 | A genuinely free session | distinguishable from unpriced | known gap — record it |
| G4 | Energy while unknown | not `0.00 kWh` | — |

## H · Offline and reconnect 🔧🅑

| # | Case | Expected | Threshold |
|---|---|---|---|
| H1 | Charger loses network mid-session | session state honest | no false "completed" |
| H2 | Charger reconnects | resumes; no duplicate session | **no duplicate row** |
| H3 | Charger offline at start | clear failure, not a hang | < 30 s |
| H4 | App offline mid-session | offline state; recovers | — |

## I · Queue backlog and recovery 🅑

| # | Case | Method | Threshold |
|---|---|---|---|
| I1 | Observe steady-state queue depth | dashboard | ~0 |
| I2 | Induce a backlog | pause the consumer **on beta only** | — |
| I3 | Resume | drains | **< 30 min**; no message loss |
| I4 | DLQ stays empty | dashboard | any growth is a finding |

## J · Audit attribution 🅑

| # | Case | Expected |
|---|---|---|
| J1 | BLE PIN release writes an audit row | `charger.ble_pin.released` present |
| J2 | Every audit row attributes a **person**, not just an org | user id present |
| J3 | Invite issuance is attributed | inviter recorded |

## K · Backup and restore rehearsal 🅑

| # | Case | Type | Threshold |
|---|---|---|---|
| K1 | Create a backup branch from `staging` | ⚙️🔒 | — |
| K2 | Restore it to a **throwaway** branch | ⚙️🔒 | — |
| K3 | Verify row counts on the throwaway | read-only | matches the LSN point |
| K4 | Delete the throwaway | ⚙️🔒 | — |
| K5 | Time the whole thing | — | **record it — it is the RTO** |

**K5 produces a number nobody currently has:** how long a restore actually takes.
Until it is measured, every recovery estimate in every runbook is a guess.

## L · Mobile upgrade compatibility 🅑

| # | Case | Expected |
|---|---|---|
| L1 | Previous app version against the current API | works |
| L2 | Current app against the current API | works |
| L3 | Previous app after an additive API change | **still works** |
| L4 | The pinned workers.dev host still resolves | **must** — shipped clients depend on it |

## M · Accessibility and responsive UI (L, offline)

| # | Case | Threshold |
|---|---|---|
| M1 | Text scaling 200% | no clipped text on the session card |
| M2 | Small (5") and large (7") Android | no overflow |
| M3 | Screen reader on the numeric tiles | announces value **and** unit |
| M4 | Contrast on mint-on-midnight CTAs | meets AA |
| M5 | Touch targets | ≥ 48dp |

Runs entirely offline against the built app — **no beta account needed**, so it
can proceed in parallel with everything else.

---

## Beta stop conditions

Halt and fix before continuing if:

1. **D3 fails on any path** — invites are bearer tokens again.
2. **E5 fails** — a stop that does not stop is a safety matter.
3. **E8 disagrees** — money is wrong; treat as Sev-1.
4. **G1 or G2 shows a fabricated zero** — the launch blocker is unresolved.
5. **H2 produces a duplicate session** — ingest is not idempotent.
6. Real customer data appears in beta.
7. Any beta test writes to production.

## Exit criteria

Beta is complete when: A–F pass; G1/G2 pass; H, I, J pass; K5 has produced a
measured restore time; L4 is confirmed; M is complete; **and** the first real
charge (E) has been performed by someone who is not the person who built it.
