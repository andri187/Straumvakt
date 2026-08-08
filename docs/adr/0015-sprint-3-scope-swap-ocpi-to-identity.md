# ADR 0015 — Sprint 3 Scope Swap: OCPI Foundation Deferred, Identity Work Substituted

> **LEGACY — pre-market-focus historical reference. Not active canon. See /FOCUS.md. Load-bearing constraints extracted into the focus rules.**

**Status:** Historical — a past sprint-scope decision, not a proposal awaiting approval. Reclassified 2026-08-04; the sprints it governs are long finished. Kept for the reasoning, not as an open question.
**Date:** 2026-05-02
**Sprint:** Documents an already-in-flight swap. Lands alongside the Sprint 3 closure retro.
**Supersedes (in part):** Sprint 3 milestones 3.1–3.5 in [STRAUMVAKT_V3_DELIVERY_PLAN.md §6](../architecture/STRAUMVAKT_V3_DELIVERY_PLAN.md).
**Relates to:** [ADR 0014](./0014-identity-tenancy-and-authorization.md) (the substituted scope), [ADR 0006](./0006-pilot-scope-rev2-2026-04-25.md) (pilot scope rev 2), [ADR 0013](./0013-split-ui-api-do-queues.md) (UI/API split that began consuming sprints), [`gbtNotes/scale-to-4000-chargers-sprint-plan.md`](../../gbtNotes/scale-to-4000-chargers-sprint-plan.md) (parallel scale plan; S1 absorbs into Sprint 3 closure), [`gbtNotes/2026-05-01-ocpp-ingest-current-state-and-gaps.md`](../../gbtNotes/2026-05-01-ocpp-ingest-current-state-and-gaps.md) (the operational gap S1 closes).

## Context

The written delivery plan §6 names Sprint 3 as **"OCPI Foundation (CPO-only for pilot)"** with five milestones (3.1 CPO endpoints, 3.2 eMSP deferred, 3.3 token translator, 3.4 hub scaffold, 3.5 contract tests). The exit criterion as written: *"OCPI 2.2.1 CPO endpoints respond to contract tests."*

What actually committed under `[Sprint 3 / ADR 0014]` and `[Sprint 3 / ADR 0013]` tags between 2026-04-29 and 2026-05-02:

1. Identity-model schema additions: `UserAudience`, `IdToken`, `UserVendorRef`, `VendorUserGroup`, `VendorUserGroupMembership`, `Vehicle`, plus enums (`IdTokenKind`, `IdTokenStatus`, `VendorRefStatus`).
2. User profile enrichment — name parts, kennitala, phone, locale, timezone, address, photo URL, consent timestamps.
3. Create-form rewrite at `/people/users/new` to capture the enriched profile in one step.
4. Organization profile reshape — kennitala, legal-form codes, registered-address fields per Fyrirtækjaskrá.
5. Vendor credential reassignment to a different org; site move-to-org cascade.
6. `Tenants` → `Accounts` URL/label rename plus a Groups tab listing `VendorUserGroup` rows cross-org.
7. Sidebar prep work (vendor sub-tabs for Alfen / Teltonika; sites tree visual polish).

**Zero commits** to `/ocpi/cpo/2.2.1/locations`, `/sessions`, `/cdrs`, `/tariffs`, `/tokens`, the token translator, or hub-connection scaffold. The work that shipped is real, valuable, and matches ADR 0014's "Build order" §*"NOW (Sprint 3 finish, with the Org reshape ADR work)"* — but ADR 0014 itself was authored on 2026-05-01, **during** Sprint 3, and the prior 18 commits landed without an ADR documenting the swap.

This ADR records the swap retroactively so:
- Future sprints plan from a true delivery state, not from the written-but-unfollowed plan.
- OCPI work has an explicit new home rather than implicit indefinite deferral.
- Rule 11 (*"Scope changes require an ADR AND an edit to the delivery plan"*) is satisfied.
- Cross-references between ADRs stay accurate as Sprint 4 begins.

The trigger for writing this now: the operator named the drift explicitly during the 2026-05-02 conversation ("we are off path, lets pause and ponder"). The drift is real; this ADR closes the bookkeeping gap.

## Decision

### 1. Sprint 3 reframes as "Identity Foundation"

Per ADR 0014's Build-Order §*"NOW (Sprint 3 finish)"*. The exit criterion changes from *"OCPI 2.2.1 CPO endpoints respond to contract tests"* to a closure list (see [docs/retros/sprint-03.md](../retros/sprint-03.md)). The delivery plan §6 is rewritten in the accompanying edit; this ADR is the canonical record of *why*.

### 2. OCPI Foundation defers to post-pilot (new Sprint 14)

Reasons:

- **Pilot is admin-only per ADR 0006 (tag B).** OCPI is a roaming concern. Pilot Go-Live (currently Sprint 10) does not strictly need OCPI for any committed customer — Dalvegur is a closed-network installation, not a roaming-in or roaming-out site.
- **The token translator's substrate is now better.** ADR 0014's polymorphic `IdToken` table (with `kind` discriminator: `rfid | app_jwt | magic_link | zaptec_proxy | ocpi_token | manual`) handles RFID, app JWTs, magic links, and OCPI tokens uniformly. Authorize lookup stays a single index hit on `(status, value)` regardless of token origin. The original Sprint 3.3 token translator was designed for a token registry that doesn't yet exist; it does now.
- **Hub connection scaffold (3.4) had no pilot-blocking customer ask.** It existed to unlock eMSP (3.2), which already deferred per ADR 0005.
- **Re-attempting OCPI mid-pilot would create scope competition** with whatever sprint the work lands in. Better to do it cleanly post-pilot when its own sprint can carry it.

OCPI's new home: **Sprint 14 — OCPI Foundation (post-pilot)**, between Sprint 13 (post-pilot reflection) and Sprint 11 enterprise API. The token translator stays as the primary deliverable; it sits on top of the ADR 0014 IdToken substrate. Schema scaffolding (`roaming.external_properties`, `roaming.cdr_queue`, `roaming.ocpi_tokens`, `roaming.hub_connections`) remains in place from Sprint 0 — additive, zero-cost, future-additive.

### 3. Sprint 3 closure absorbs gbtNotes Sprint S1

The note `gbtNotes/2026-05-01-ocpp-ingest-current-state-and-gaps.md` documents an existing staging breakage: `/api/ocpp/events` is mounted only on the UI Worker (`hlada-staging`) but the gateway's `MAIN_APP` service binding routes to `hlada-api-staging`. Result: every OCPP frame on staging 404s after BootNotification; `ChargeSession` rows are never created from real charger traffic on staging.

The fix is a 2–3 hour file relocation per the note's recommendation, with the seven sharpenings from `gbtNotes/ocpp-ingest-note-review.md` folded in (idempotency parity, auth-secret parity diff, prefix rename to `/api/internal/ocpp-events`, atomic deploy, delete UI-Worker-side route in same change, production cutover sequenced separately).

This work belongs in Sprint 3 closure because:
- It is the foundation under any further work that depends on session/CDR projection (Sprint 4 retention, Sprint 9 audit).
- It is independent of the OCPI swap; it would have shipped in Sprint 3 regardless.
- Closing it inside Sprint 3 prevents Sprint 4 from inheriting unfinished foundation work.

### 4. OCPP Authorize handler decision lands inside Sprint 3 closure

Audit on 2026-05-02 surfaced two compounding facts:
- Gateway DO at `gateway/src/identity-do.ts:218–219` returns hardcoded `Accepted` for every Authorize.req. This is a known dev stub awaiting Sprint 2 (per its comment), not a production-ready handler.
- Dalvegur installation `7d722149-...` was flipped to `AuthenticationType=2` ("OCPP-managed authentication required") earlier in the day for probing purposes.

The combination — a stub default-accepting handler running with auth required against a real installation — is operationally undefined. Customers can charge today only because the stub default-accepts; that's incidental, not designed.

Sprint 3 closure forces a binary choice:
- **(a)** Replace the stub with a real `IdToken` lookup (design proposed 2026-05-02, awaiting approval), OR
- **(b)** Revert Dalvegur to `AuthenticationType=0` until a real handler ships in Sprint 4.

Either resolution closes the unsafe middle. The decision sits with the operator; this ADR mandates resolution before Sprint 3 closes.

### 5. The eight unscoped concerns from gbtNotes/sprint-plan-review

The scale plan review listed eight unscoped concerns: driver/mobile UX, RBAC and tenant administration, PII/GDPR classification, fleet-onboarding tooling, backpressure and overload, cost model, scheduled-jobs story, data backfill for the existing 20 chargers. ADR 0014 already absorbs RBAC into Sprint 4–5–9. The remaining seven get explicit treatment in the delivery plan edit accompanying this ADR — three are pre-pilot (PII classification, scheduled-jobs story, data backfill) and four post-pilot (driver UX, fleet-onboarding tooling, backpressure, cost model). None require a new pre-pilot sprint; all get assigned to existing sprints with milestone-level entries.

## Two parallel sprint numbering systems — reconciled

`gbtNotes/scale-to-4000-chargers-sprint-plan.md` numbers sprints S1–S11. The delivery plan numbers sprints 0–13 (with new 14 added by this ADR). These are not the same sprints. The mapping:

| gbtNotes Sx | Delivery plan home | Notes |
|---|---|---|
| S1 — Fix Runtime Split | **Sprint 3 closure** | Events ingest port to `apps/api`. Operational gap. |
| S2 — Queue-Backed Inbound OCPP | Sprint 4 | Aligns with retention machinery. |
| S3 — Data Platform / ORM Decision | Sprint 4 | Feeds retention design. |
| S4 — Hot Ingest / Retention / Projections | Sprint 4 | Core lifecycle work. |
| S5 — Report Export Pipeline | Sprint 6 (or 7) | Pre-pilot scale, post-Commercial-Model. |
| S6 — Outbound Command Hardening | Sprint 8 | Continues Sprint 1.3 outbox. |
| S7 — Load Test Harness | Sprint 8 (or pre-Sprint 10) | Pilot-readiness gate. |
| S8 — Observability and Operations | Sprint 9 | Security hardening overlap. |
| S9 — Security / Tenancy / Secrets | Sprint 9 | RLS + audit append-only. |
| S10 — Production Cutover Readiness | Sprint 10 | Matches Pilot Go-Live framing. |
| S11 — Enterprise API and Agreements | Sprint 11 | Unchanged. |

Net effect: scale plan items don't introduce new pre-pilot sprints. They refine what each existing delivery sprint must include. The gbtNotes numbering becomes a parallel checklist that the delivery plan absorbs section-by-section — not a competing canon. The existing `gbtNotes/` markdown stays as the design substrate; the delivery plan §-by-§ becomes the authoritative milestone text.

## Consequences

### Positive

- Sprint 3 has a real and recorded scope. Sprint 4 planning starts from truth.
- ADR 0014 has a specified close-out window inside Sprint 3 instead of indefinite drift.
- OCPI's deferral is intentional, with a documented re-entry sprint.
- The gbtNotes scale plan is no longer a parallel canon competing with the delivery plan — it's an enrichment of the existing sprint sections.
- The orphan-table problem (per the 2026-05-02 gap check) gets a forced resolution inside Sprint 3 closure: each new identity table gets at least one write path or it's not done.
- The OCPP Authorize stub gets a forced resolution inside Sprint 3 closure: real handler or auth-revert; the middle ground closes.
- Permission to close Sprint 3 and start Sprint 4 (membership + permissions per ADR 0014's build order) is re-established.

### Negative

- Pilot loses one of three charger-path options. Native OCPP works; OEM-API overlay (Zaptec) works; OCPI roaming-partner is deferred. No customer is asking for OCPI today — this cost is theoretical.
- Any post-pilot customer asking for OCPI ahead of Sprint 14 will need an emergency ADR similar to this one to re-promote it.
- Two retroactive ADRs in the project (this one + the as-yet-unwritten ADR for ADR 0013's scope creep into Sprint 2) suggests a pattern. Carry-forward into Sprint 4 retro: name the next sprint's scope at sprint-start so retroactive bookkeeping isn't required.

### Out of scope

- Re-evaluation of ADR 0014's own scope. Already covered there.
- A cross-cutting "what does pilot mean" rewrite. ADR 0006 already does this; ADR 0015 does not re-litigate.
- The four post-pilot concerns from sprint-plan-review (driver UX, fleet-onboarding tooling, backpressure, cost model). They go into Sprint 12+ in the delivery plan edit; this ADR only confirms they're not pre-pilot.

## Open questions

1. **OCPP Authorize resolution** (decision 4 above) — operator picks (a) ship real handler or (b) revert Dalvegur to anonymous. Either is fine; *not* picking is not fine. Sprint 3 doesn't close otherwise.
2. **Sprint numbering hygiene** — should we converge fully on the delivery plan numbering and retire the `gbtNotes/Sx` numbering in note titles to avoid future ambiguity? Recommend yes; existing `gbtNotes/` files keep their names for git history but new notes use delivery-plan sprint numbers.
3. **OCPI re-promotion trigger** — what specific signal would cause Sprint 14 to move earlier? Suggest: a signed customer requiring roaming, or eMSP requirement from a hub partner. Add explicitly to Sprint 14's "entry criteria" when that section is drafted.

## References

- [ADR 0006 — Pilot Scope Rev 2](./0006-pilot-scope-rev2-2026-04-25.md) (driver experience post-pilot, the precedent for sprint substitution)
- [ADR 0011 — Control-Plane Optionality](./0011-control-plane-optionality.md)
- [ADR 0014 — Identity, Tenancy, and Authorization](./0014-identity-tenancy-and-authorization.md) (the substituted scope)
- [`gbtNotes/scale-to-4000-chargers-sprint-plan.md`](../../gbtNotes/scale-to-4000-chargers-sprint-plan.md) (the parallel scale plan)
- [`gbtNotes/sprint-plan-review.md`](../../gbtNotes/sprint-plan-review.md) (the review surfacing the eight unscoped concerns)
- [`gbtNotes/2026-05-01-ocpp-ingest-current-state-and-gaps.md`](../../gbtNotes/2026-05-01-ocpp-ingest-current-state-and-gaps.md) (the S1 fix this ADR pulls into Sprint 3 closure)
- [`gbtNotes/ocpp-ingest-note-review.md`](../../gbtNotes/ocpp-ingest-note-review.md) (the seven sharpenings folded into Sprint 3 milestone 3.3)
