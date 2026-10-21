# Meter semantics and CDR billing correctness — verification

Branch `scratch/claude-a-core-billing-2026-08-10`. Verification-first: every
claim below is settled by a read-only aggregate over real data or by a test
that fails when the guard is removed.

**Method note.** Read-only `SELECT` aggregates were run against the Neon
staging branch under the read-only access approved earlier in this session.
No mutation, no row export, no personal data. Everything else is source
reading and local tests.

---

## 1. Meter semantics — DISPROVED as a live bug, FIXED as a latent one

### The claim

`onOcppRawStopTransaction` writes `energyWh = BigInt(meterStopWh)`
(`projections.ts:928`), overwriting the `meterStart` value it wrote at
`:869`. Nothing subtracts. OCPP 1.6 meter values are readings of a
*cumulative* register, so this would bill a charger's lifetime energy as one
session.

### The evidence

1,655 sessions, `charging.sessions.energy_wh`:

| | |
|---|---:|
| median | **9,852 Wh** |
| p95 | 36,946 Wh |
| max | **79,478 Wh** |
| sessions above 200 kWh | **0** |
| sessions above 1,000 kWh | **0** |

`reports.session_ledger.energy_kwh` agrees exactly (max 79.478 kWh).

The discriminating test — a cumulative register grows monotonically per
charger, so session sequence and energy would correlate near +1.0:

| charger | sessions | corr(seq, energy) | min Wh | max Wh | avg Wh |
|---|---:|---:|---:|---:|---:|
| `243cbeb1` | 196 | **−0.075** | 18 | 46,432 | 7,280 |
| `e7211ca8` | 151 | **+0.112** | 11 | 48,977 | 8,916 |
| `3c3e64fa` | 94 | **−0.145** | 28 | 30,659 | 12,024 |

Correlation is noise. Minima of 11–28 Wh recur throughout — 29 sub-1 kWh
sessions on the busiest charger. A cumulative register never returns near
zero, and after 196 sessions averaging 7.3 kWh it would read ~1,400 kWh, not
46 kWh.

**Verdict: the deployed fleet reports per-session values. Billing is correct
today. No customer has been overcharged.**

### Why it was still worth fixing

The code was *accidentally* correct. Nothing asserted the assumption, no test
could detect a violation, and onboarding one cumulative-register charger —
entirely legal under OCPP 1.6 — would have been silent.

The fix is one expression, and it is correct in **both** modes:

```
energy = meterStop − meterStart
```

A per-session charger reports `meterStart = 0`, so the subtraction is a no-op
on today's fleet. That is what makes it safe to land now.

### What shipped

`packages/commercial/src/core-billing/meter-energy.ts` — pure resolver, mode
classifier, plausibility ceiling, and a four-value billing-hold contract with
driver-facing copy. **44 tests.**

Wired into the live writer with a fallback that guarantees no behaviour
change: an unresolvable reading keeps the previous value and warns, rather
than introducing a new unpriced path. `session.energyWh` already held the
`meterStart` and was already selected at `:906`, so no query changed.

**Proof of equivalence:** the existing 25-test projections suite passes
unchanged.

**Proof of effect:** two new projection tests the old suite could not express,
because every existing fixture uses `meterStart: 0` — making `meterStop` and
the delta the same number. Restoring the old expression fails with
`expected 4010000n to be 10000n`: a **401× overcharge**, while the other 26
tests stay green.

## 2. CDR provenance — CONFIRMED, and narrower than claimed

### The evidence

| `verified_source` | `enrichment_status` | rows | disagree with CDR | max delta |
|---|---|---:|---:|---:|
| `cdr` | `complete` | **1,136** | **0** | 0.000 kWh |
| *(null)* | *(null)* | 492 | 0 | — |
| `ocpp` | `pending` | 9 | 0 | — |
| **`cdr`** | **`mismatch`** | **5** | **5** | **12.105 kWh** |

So the overlay is right 1,136 times out of 1,141 and wrong 5 times — 0.4%,
not the blanket failure the earlier note implied. The five are not random:
they are exactly the rows the sync itself flagged `mismatch`, where the
update branch changed the label and not the number.

12.105 kWh at a typical Icelandic AC rate is roughly **170 kr on one
session** — small in isolation, and precisely what a driver disputes.

**`enrichment_status = 'mismatch'` is not a sufficient answer.** It records
that a difference existed; it does not stop the row asserting CDR provenance,
and a statement generator selecting `WHERE verified_source = 'cdr'` picks up
all 1,141.

A second finding: **492 rows (30%) carry no provenance at all** — the webhook
path writes neither field, so those rows fall into no reconciliation bucket.

### What shipped

`cdr-provenance.ts` — the invariant *a row may claim `cdr` only if it bills
the CDR figure*, plus a resolver returning the two honest outcomes (overlay
the authoritative figure, or downgrade the label). **20 tests**, fixtures
built from the four measured population groups with their real counts.

The one outcome the type system will not produce is keeping both the label
and the wrong number.

## 3. Cross-tenant billing reads — CONFIRMED

| | |
|---|---:|
| `billing.*` permission gates | **43** |
| with `orgIdParam` | **8** |
| **without** | **35** |

Both named functions confirmed to take no organisation argument:

```
billing-cost-centers.ts:41   listCostCenters(db, year, month)
billing-summary.ts:208       getProjectedOrgRevenue(db, year, month)
```

Their routes gate on a bare `requirePermission("billing.read")`. Because
`resolvePermissionsWithProvenance` skips the membership lookup entirely when
`orgId` is null, omitting the param does not merely skip a check — **it makes
membership incapable of satisfying the verb**, so only platform grants pass
and every one of them sees every tenant.

The correct shape exists three files away: `bill-objects.ts:70` passes
`{ orgIdParam: "orgId" }`.

**Fix plan.** Add the org argument to both repository functions and thread
`orgIdParam` through their routes. This is not a pure refactor — it changes
who can call them, and today only platform grants can, so nothing breaks for
current callers. The remaining 33 gates need the same treatment route by
route; a static check asserting *every `billing.*` gate passes `orgIdParam`*
would prevent regression, and belongs in `npm run check`.

## 4. Manual driver management — CONFIRMED, exactly 13 call sites

24 `member.*` gates, **13 without `orgIdParam`**, matching the earlier count:

```
vehicles.ts:24, :42, :83                     member.read
admin-id-tokens.ts:52                        member.read
admin-id-tokens.ts:63, :88, :127             member.write
admin-users.ts:72, :259                      member.read
admin-users.ts:156, :222, :240, :265         member.write
```

With `MEMBER_ADMIN_VERBS` stripping `member.write/invite/remove` from platform
expansion, and the live operator holding a `super_user` grant and **no
membership**, every `member.write` site above denies. Core includes manual
driver management, so this blocks Core.

**Recommended path: give Straumvakt staff real memberships in the
organisations they administer.** It is the only option that makes the
provenance distinction mean anything — a staff member acting as a member is
then genuinely acting as a member, and `satisfiedOnlyByPlatformGrant`
correctly reports false. Adding a platform verb for member administration
restores the shortcut this carve-out existed to remove.

Second choice, if memberships are impractical: gate these routes on an
explicit platform verb *and* require a support context, so the access is
recorded rather than implicit.

## 5. Corrected assumptions

| # | Earlier claim | Corrected |
|---|---|---|
| 1 | "Billing may be overcharging via `meterStop`" | **Disproved.** Fleet is per-session; billing is correct. The defect was latent, not live |
| 2 | "CDR overlay never restates the price" | **Too broad.** It restates correctly 1,136 times; it fails on the 5 rows flagged `mismatch` |
| 3 | Provenance risk framed as label-vs-price only | There is a second shape: **492 rows carry no label at all** |
| 4 | "Only 32 of 165 gates pass `orgIdParam`" (all verbs) | Confirmed and sharpened for billing specifically: **8 of 43** |

## 6. Decisions needed

1. **The 5 mismatched rows** — overlay the CDR figure, or downgrade the label?
   The resolver implements both; the default is overlay. Needs a call before
   any statement is issued.
2. **The 492 unlabelled rows** — promote to `cdr` where the figure already
   matches, or leave unverified?
3. **Staff memberships vs a platform verb** for driver management (§4).
4. **Plausibility ceiling** — 150 kWh, set at roughly double the observed
   maximum. A DC site would need a higher value per site.

## 7. What was NOT done

Phases 2–4 of the brief are complete; §3 and §4 above are **verified fix
plans, not implementations** — changing who can call a billing route is a
permission change with real blast radius and belongs behind an explicit
decision. The fallback queue was not reached.
