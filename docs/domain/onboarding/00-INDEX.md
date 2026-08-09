# Singular onboarding, access and identity — domain packet

Design packet for one onboarding workflow serving organisation self-onboarding
and Straumvakt-assisted onboarding through the same invariants.

**Nothing in this packet changes runtime behaviour.** It is documentation,
proposals and non-executing test specifications only. No route, repository,
schema, migration, workflow or mobile file is touched.

## Source snapshot

Every claim below was read from source at these exact commits. Re-verify before
relying on any of it.

| Source | Path | Tip | Verified |
| --- | --- | --- | --- |
| Architecture packet (base of this branch) | `Straumvakt-remediation-architecture` | `fabc56f` | yes |
| Release candidate | `Straumvakt-release-candidate` | `4b69d0f` | yes |
| Mobile | `Straumvakt-mobile-hardening` | `4757f5c` | yes |
| Canonical checkout (read-only) | `Straumvakt` | `10c292b`, 21 dirty | not edited |

This branch: `docs/singular-onboarding-domain-packet`, worktree
`E:\Claude\Straumvakt-onboarding-domain`, based on `fabc56f`.

## Evidence legend

Applied throughout. If a statement carries no marker, treat it as **[R]**.

- **[F] Fact** — read directly from source at the snapshot above, with the file
  and line named. Reproducible by anyone.
- **[I] Inference** — follows from facts but was not observed directly.
- **[R] Recommendation** — a design proposal. Not accepted, not implemented.
- **[U] Unknown** — needs a decision, a bench test, or evidence we do not have.

## Artifacts

| # | Document | Phase | Status |
| --- | --- | --- | --- |
| 01 | [Current path inventory and contradictions](01-current-path-inventory.md) | 0 | complete |
| 02 | [The singular onboarding aggregate](02-onboarding-aggregate.md) | 1 | complete |
| 03 | [Unaffiliated identity and the join contract](03-unaffiliated-and-access-code.md) | 2 | complete |
| 04 | [Invitation and driver-creation consolidation](04-invite-consolidation.md) | 3 | complete |
| 05 | [Staff assistance without impersonation](05-staff-assistance.md) | 4 | complete |
| 06 | [Technical idTag versus driver attribution](06-idtag-attribution.md) | 5 | complete |
| 07 | [Work packages and dependency order](07-work-packages.md) | 9 | complete |
| — | API contracts (Phase 6), persistence/migration (Phase 7), full test specs (Phase 8) | 6–8 | **outlined inside 03/04/06/07, not yet standalone** |

Phases 6–8 are represented as contract sketches, invariants and acceptance
criteria embedded in the documents above rather than as three standalone
documents. That is an honest statement of how far this session got, not a claim
that they are done. See the handoff for what remains.

## The three findings that shape everything else

All **[F]**, all verified at `4b69d0f`. Detail and line numbers in document 01.

1. **Two live invite paths disagree about identity.**
   `POST /api/public/invites/consume` is authorised by *possession of the token
   alone*. `POST /api/driver/redeem-invite` is bound to the invited identity
   (ADR 0053). The same product concept, two different security models.

2. **The org-invite path overwrites an existing password.**
   `consume` does `userCredential.upsert(... update: { passwordHash })`, so a
   bearer of the token can reset the bound user's password. The driver path
   refuses the equivalent with `409 already_claimed` and preserves the original
   hash.

3. **The mobile app sends a national ID that the server discards.**
   `apps/mobile/lib/api/client.dart` posts `{ token, kennitala, password }` to
   `consume`. `ConsumeBody` is a non-strict Zod object of `{ token, password }`,
   so `kennitala` is stripped before the handler sees it. Meanwhile
   `POST /api/public/register` *does* validate kennitala and can return
   `kennitala_taken`.

Taken together: the path the Flutter app actually uses today is the weakest of
the three, and it collects an identity proof that is never checked.

## What this packet does not do

- No ADR numbers are claimed. Proposals stay `Proposed`.
- No migration files, no SQL, no schema edits.
- No assumption that the historical N1 onboarding deadlock still exists — it is
  re-derived against the current RC in document 01.
- No secret values, DSNs, personal data or meter payloads.
