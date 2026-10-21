# Legacy endpoint inventory — what does not carry forward

**First pass, by the coordinator, 2026-08-29. Unverified.** Derived by counting
route registrations per file on `dev/core-billing-integration` and classifying
by what the file serves. **A lane must confirm it before it is treated as
authoritative** — the same caveat that applies to the endpoint budget, and for
the same reason.

**Nothing here is to be deleted or moved.** ADR 0056 switches the old
application off whole rather than converting it, and it is serving 21 live
sockets. This is a record, not a work order. Its two jobs are:

1. **Do not recreate.** Nothing on this list reappears in the new build unless
   it earns a line in `docs/notes/2026-08-28-the-new-build-manifest.md`.
2. **The switch-off checklist.** When the old app goes, this says what went
   with it.

---

## Measured

**~249 route registrations across 52 files** — more than the 187 documented
endpoints, because not every registration is a documented endpoint.

| Class | Registrations | Fate |
|---|---|---|
| Serves the replaced billing model | ~55 | gone |
| Debug and evidence surfaces | ~5 | gone |
| Unbudgeted features | ~17 | not in the rehearsal |
| Collapse into fewer resources | ~58 net | rebuilt smaller |
| Carries forward in shape | ~44 | the budget |

**Roughly 200 of 249 do not carry forward — about 80%.** The 44-operation
budget was derived independently from the nine rehearsal steps; the two numbers
agreeing from opposite directions is the strongest evidence either has.

---

## 1 · The replaced billing model — ~55 registrations

The apartment abstraction and the old cost-factor model, both withdrawn.

| File | Registrations |
|---|---|
| `admin/billing.ts` | 10 |
| `admin/properties.ts` | 7 |
| `admin/billing-rate-references.ts` | 6 |
| `admin/bill-objects.ts` | 6 |
| `admin/contracts.ts` | 5 |
| `admin/billing-tariff-mgmt.ts` | 5 |
| `admin/billing-cost-factors.ts` | 5 |
| `admin/billing-summary.ts` | 2 |
| `admin/billing-enrichment.ts` | 2 |
| `admin/billing-driver-contracts.ts` | 2 |
| `admin/billing-tariff-detail.ts` | 1 |
| `admin/billing-electricity.ts` | 1 |
| `admin/billing-dso.ts` | 1 |
| `admin/billing-cost-centers.ts` | 1 |
| `admin/billing-contracts.ts` | 1 |

**Thirteen billing route files for one engine.** `billing-tariff-detail` and
`billing-tariff-mgmt` are the same resource twice. This cluster is the clearest
illustration of why the manifest rule is *name the step it serves*.

## 2 · Debug and evidence — ~5

`admin/agreements-debug.ts` (4) · `admin/agreements-resolve.ts` (1).

They exist because nobody trusted the model. In a build where refusals are
named and rows are provenanced, these are diagnostics, not product.

## 3 · Unbudgeted features — ~17

`public/driver-tap-intent.ts` (6) · `admin/org-email-domains.ts` (4) ·
`admin/vehicles.ts` (3) · `admin/access-requests.ts` (2) ·
`public/driver-charger-pin.ts` (2).

Not wrong — not in the rehearsal. Each returns only if a step needs it.

## 4 · The three that collapse hardest — 72 → ~14

| File | Now | Budget |
|---|---|---|
| `public/driver.ts` | 29 | 5 driver operations |
| `admin/orgs.ts` | 24 | 4 org operations |
| `admin/chargers.ts` | 19 | ~5 across devices and placements |

These are not dead — they are **one resource answered many times**. The same
habit that produced thirteen billing files produced twenty-four org
registrations.

## 5 · Carries forward in shape

`auth` · `me` · `host-applications` · `org-invites` · `sites` ·
`installations` · `circuits` · `groups` · `driver-group-memberships` ·
`onboarding` · `vendor-credentials` · `zaptec` · `pending-discoveries` ·
`active-sessions` · `admin/billing/periods.ts` (12 — the newest and healthiest,
over ports, tenant-scoped, refusing by name) · the three internal OCPP routes ·
`public/invites`, `register`, `password-reset`, `email-verification`.

**The shape carries; the code does not.** ADR 0056: these are rebuilt to the
budget, not copied.

---

## What this is not

Not a deletion plan. Not a refactor. Not a work order for any lane. The old
application keeps running exactly as it is until the rehearsal passes on the
new one, and then it is switched off in one step with this document as the
record of what it contained.
