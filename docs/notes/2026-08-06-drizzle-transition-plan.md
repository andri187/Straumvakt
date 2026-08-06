# Dropping Prisma — where the transition stands, and what the rest costs

Measured 2026-08-06, mid-transition. Updates as work lands.

## Done

| | |
|---|---|
| Prisma schema split into 7 domain files | `ec2b86e` |
| apps/api schema generated from root, cannot drift | `ec2b86e` |
| Domain boundaries enforced by dependency-cruiser | `31605e1` |
| **All 98 tables declared in Drizzle and verified against the database** | `2bb2493` |
| Parity harness — structural, behavioural, and one end-to-end flow | `7ab5cc6` `1049e40` |
| 6 repositories ported | `1049e40`, this batch |

The declarations are the part that does not need doing again. Every table,
column, type, nullability and default across all seven domains is checked
against `information_schema` by `test/parity/domain-schemas.test.ts`, and it
has already caught four real defects.

## Remaining, measured rather than estimated

```
128 files still import Prisma        32,715 lines
 38 of them are plumbing              5,968   type-only or client-passing
 90 of them run queries              26,747
```

Six repositories are ported. **Ninety files remain.**

## The thing that changes the plan

Porting was scoped domain by domain. That does not survive contact with the
code:

| grouping | files | lines |
|---|---:|---:|
| single-domain | 38 | 6,803 |
| **cross-domain** | **52** | **19,944** |

**Three quarters of the remaining query code touches more than one domain.**
`session-ledger.ts` spans commercial + charging + assets + identity.
`local-auth-list-push.ts` spans protocol + identity + commercial + assets.
Neither can be "the identity batch" or "the charging batch".

### What resolves most of it

Place each file in the **topmost domain it touches**, and the layering rule is
satisfied by construction, because the chain permits reading downward:

```
session-ledger      commercial+charging+assets+identity  -> commercial   legal
org-tariff-chain    assets+commercial                    -> commercial   legal
vehicle-id-sessions charging+assets                      -> charging     legal
charger-zaptec-config assets+vendor                      -> vendor       legal
```

That is a mechanical rule, it needs no new abstraction, and it covers most of
the 52.

### What does not resolve, and needs a decision

**The dependency rule orders four domains out of seven.** `commercial →
charging → assets → identity` is stated; `vendor`, `protocol` and `platform`
have only partial rules — nothing may import vendor, platform imports
nothing. Where `protocol` sits relative to charging and commercial is
undefined, and roughly fifteen files need it answered before they can be
placed:

```
local-auth-list-push   protocol+identity+commercial+assets
zaptec-session-probe   protocol+charging+commercial
onboarding-chains      identity+assets+protocol
host-views             commercial+identity+charging+protocol
ocpp-silence-watch     protocol+platform
```

**Recommendation: `protocol` sits between `charging` and `assets`** — OCPP
produces sessions and addresses chargers, so it reads assets and writes
charging, and nothing above it should be reaching down into wire-level state.
That makes the full order:

```
commercial -> charging -> protocol -> assets -> identity
      with vendor off to the side (imported by nothing)
      and platform at the bottom (importing nothing)
```

*This is the single decision that unblocks the largest amount of the
remainder.* It is cheap to state and expensive to discover later, because the
files placed before it is answered are the ones that would move twice.

## Honest sequencing from here

1. **Answer the protocol/platform ordering above.** Blocks ~15 files.
2. **Answer P4-style composition** for the handful where a repository genuinely
   needs a display field from a higher domain. Two are known:
   `org-email-domains` (identity → agreements.driver_groups) and, already
   resolved by moving it to `vendor`, `vendor-user-groups`.
3. Port the 38 single-domain files. Mechanical; the pattern is established
   and each gets a parity comparison.
4. Port the 52 cross-domain files using the topmost-domain rule.
5. Port the console — `src/lib/repositories` is only 5 files and 481 lines,
   far smaller than the brief implied.
6. **Migration handover.** Prisma still owns `prisma/migrations/` (51 applied).
   drizzle-kit cannot simply take over: `drizzle.config.ts` carries a warning
   against `push`/`generate` because it would offer to drop the ~83 tables it
   has never been told about. The handover is its own piece of work — baseline
   the current state as drizzle's migration zero, then switch.
7. **Remove Prisma.** Dependencies, both generators, and the four custom
   Workers build steps. This is where the 6 MB actually leaves.

## What "done" is worth, measured

Isolated bundles, same node_modules, minified:

| | raw | gzip |
|---|---:|---:|
| `pg` — the floor both share | 79.6 KiB | — |
| Drizzle identity path | 189.1 KiB | 52.0 KiB |
| Prisma client path | 6,302 KiB | 2,045 KiB |

Net of the shared floor: **109.5 KiB against 6,223 KiB — 56.9×.** The API
Worker is 6,955 KiB today and roughly 6.1 MB of that is Prisma.

Nothing of that lands until step 7. Until then the bundle only grows, because
two ORMs weigh more than one — it is up 257 KiB so far, which is the correct
and expected signature of a transition in progress.

## Rules that still bind

- **Commercial is Rule 5 territory.** Billing math, tariff resolution and
  access-grant resolution need stop-and-summarise before code, and ADR 0025's
  D1–D5 are still unanswered. Eleven single-domain commercial files plus most
  of the cross-domain ones sit behind that.
- **No deploys, no staging migrations** without asking.
- Every port carries a parity comparison against real rows, and the fixtures
  are extended whenever a table would otherwise be empty — a green comparison
  over an empty table is not evidence, and this harness has already been made
  to fail twice on purpose to prove it works.
