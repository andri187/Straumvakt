# Sprint 9 model-lock session note

**Date:** 2026-06-03 evening + 2026-06-04 early morning
**Branch:** `feat/agreement-architecture`
**Outcome:** 2 ADRs landed (0026 + 0031), no schema or production code
changes beyond rollback. Model now firm enough that the next ~6
implementation sessions can build to it without further model
revisions.

## What this session was for

The 2026-06-03 "going public + RFQs" pivot left ~6 strategic
decisions open and a draft ADR 0026 pending (per memory note
`going_public_rescope_pending.md`). Earlier in the same day's session
the operator and I had built `/register` + `/verify-email/[token]`
public pages targeting driver self-signup, on the assumption that
"going public" meant consumer-grade open onboarding.

Mid-session the operator clarified Straumvakt is intended for
**private charging at multi-dwelling residences or companies** — closed
B2B, not consumer-open. That reframing made the self-signup pages
wrong-direction, ENROLL-1/2/3 backend work largely dormant, and
forced a full model re-lock before any more code went down.

Over the next several hours of product conversation the operator
walked through 22+ specific design questions, locking the answers as
they went. This note captures the outcome.

## What's locked

### ADR 0026 — Host-managed driver enrollment + invoice recipient model

12 numbered decisions:

1. Customer = host org (multi-dwelling or company)
2. Host admin manages their own drivers (operator-portal scoped view)
3. Driver enrollment is invite-only — three forms: code, QR, email.
   QR codes have two optional security layers: password key, host-admin
   allow-term. ENROLL-2 access-request inbox reactivates as the
   allow-term backend.
4. Driver identity = email + password + kennitala (Auðkenni later)
5. Driver enrollment surface is the mobile app — empty-state-as-funnel
6. Public `/apply` form on straumvakt.org for lead capture (multi-site)
7. Operator-initiated host create for off-form deals (queued ADR 0027)
8. Straumvakt invoices on behalf of host (billing-agent posture)
9. One driver, multiple installations across hosts is first-class
10A. Kennitala immutable + email mutable with verification; one
    kennitala-many-devices normal, one-device-many-kennitölur is the
    abuse signal. **Carve-out** for dependent children in a group
    context (added per ADR 0031 item 18).
10B. Per-person identity, per-household billing. Household-as-billing-
     unit is the model — what's rejected is conflating multiple humans
     into one User row.
11. Operator-wide `/drivers` admin view for Straumvakt staff

### ADR 0031 — Cost model + money flow

19 locked items:

1. Straumvakt is an agent, never a principal — does not sell
   electricity; only logs, calculates, invoices on behalf
2. Per-kWh always = DSO + ELE (someone always pays); fees layer on top
3. Currency: ISK only
4. Money flow: driver → host (direct, post-paid e-bill) →
   Straumvakt (host-paid separately for service)
5. Settlement monthly
6. No internal credit / wallet
7. Host receives full electricity revenue; Straumvakt invoices host
   separately for SaaS fee
8. Driver non-payment → access disabled until debt cleared
9. Tariff is **driver-bound, not charger-bound** — same driver may
   have different tariffs on different chargers at the same
   installation. Resolution key is `(installation, DriverGroup)`,
   not just `(installation)`.
10. Family / group: group owner's contract rules the conclusion of
    tariffs for all members
11. Free-vend: DSO+ELE still computed (host reporting), no driver-
    facing fees, "Innifalið" badge shown
12. Company-pays: separate sponsor entity (not necessarily the host)
    pays for designated sessions; driver sees badge instead of price
13. Mobile app must surface company-pays / free-vend prominently
14. Mid-session tariff change → cost split at timestamp boundary
15. Metering disputes routed to host; Straumvakt doesn't arbitrate
16. Faulted sessions still billed for kWh delivered; flagged in
    monthly report
17. Post-paid only
18. HOA can add a dependent child without kennitala — group owner
    must have kennitala and receives the full aggregated invoice
19. Free-vend cost visible to driver, clearly marked as covered

### Three open option-picks in 0031 (the only things blocking further code)

1. **Open Q1 — tariff catalogue depth.** Fixed enum vs. open
   namespace vs. fixed + "Other" override. Recommended starting point:
   fixed catalogue + "Other".
2. **Open Q2 — Straumvakt revenue model.** Per-charger SaaS, per-
   driver SaaS, per-session transaction fee, per-kWh markup, or
   hybrid. Recommended: per-charger + per-session hybrid.
3. **Open Q3 — host subscription model.** Fixed tier per host type,
   per-host negotiated, or published price list with volume discounts.
   Recommended: published price list.

These need answers before the tariff catalogue UI, Straumvakt billing
module, or host subscription / contract UI can be built. Five
minutes of decision unblocks ~6 sessions of implementation.

## What got thrown away

- `src/app/register/page.tsx` + `src/app/register/register-form.tsx`
- `src/app/verify-email/[token]/page.tsx`

These were built earlier in the same session against the
self-signup misreading; deleted before commit.

## What got repurposed

- **ENROLL-2 access-request inbox** — built originally for driver
  self-request approvals; now the natural backend for the QR-with-
  allow-term redemption flow (ADR 0026 item 3).
- **middleware.ts** — `isPublicEnrollPath` helper repurposed to
  `isPublicApplyPath`, forward-looking allow-list for the (not-yet-
  built) `/apply` form. (Rule 4 file — named explicitly at edit time.)

## What's still queued (now ordered by what unblocks what)

```
PICK 0031 Q1/Q2/Q3  ───┬──→ Tariff catalogue UI / Straumvakt billing module
                        │
                        ▼
ADR 0027 (host onboarding)  ──→ Operator UI: add customer + host-admin invite
                        │
                        ▼
ADR 0028 (driver invite codes/QR/email)  ──→ Mobile app empty-state + redeem
                        │                       + Straumvakt-staging proof-of-concept
                        ▼
ADR 0029 (child-object model)  ───→ Multi-dwelling billing attribution +
                                    group-owner-null-kennitala schema (0031 item 18)
                        │
                        ▼
ADR 0030 (device registry)  ──→ Install analytics + one-device-many-
                                kennitölur abuse alerts
```

In parallel (don't block on ADRs):
- `/apply` form + `tenancy.host_applications` migration + operator
  inbox
- Operator-wide `/drivers` admin view (ADR 0026 item 11)
- `/me/email-change-request` flow (ADR 0026 item 10A)

## State on disk at end of session

**Uncommitted but on disk:**
- `docs/adr/0026-host-managed-driver-enrollment-and-billing-model.md`
- `docs/adr/0031-cost-model-and-money-flow.md`
- `middleware.ts`
- This note: `docs/notes/2026-06-04-sprint9-model-lock.md`
- Memory: `C:\Users\Andri\.claude\projects\e--Claude-Straumvakt\memory\sprint9_model_locked.md`
- Memory index: `MEMORY.md` updated

**Deleted:** `src/app/register/`, `src/app/verify-email/`

**Type-check:** `npx tsc --noEmit` clean.

**Migration state on staging Neon:** `20260531200000_driver_self_onboarding`
applied (`org_email_domains`, `driver_access_requests`, `virtual_rfid`
enum value all confirmed live). No new migration pending from this
session.

## Suggested next-session opener

1. Read ADR 0026 + ADR 0031.
2. Pick the three open options (Q1 tariff catalogue, Q2 Straumvakt
   revenue, Q3 host subscription) — five-minute decision.
3. Either start ADR 0027 draft (host onboarding) OR begin building
   `/apply` + `tenancy.host_applications` migration + applications
   operator inbox. Either is unblocked by the model-lock; pick based
   on which surface is more urgent.
