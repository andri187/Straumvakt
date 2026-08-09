# Evidence ledger, re-verification and corrections

Phase 0. Every headline claim in this packet was re-tested against source in a
second independent pass. This document records what held, what was **wrong**,
and what the second pass **newly found**.

## 1. Source fingerprints

| Source | Tip | Dirty | Start fingerprint | Role |
| --- | --- | --- | --- | --- |
| `Straumvakt-onboarding-domain` (mine) | `5111db6` | 0 | — | this packet |
| `Straumvakt` (canonical) | `10c292b` | 21 | `471e75e8cfb2` | read-only |
| `Straumvakt-release-candidate` | `4b69d0f` | 0 | `d41d8cd98f00` | read-only |
| `Straumvakt-mobile-hardening` | `4757f5c` | 0 | `d41d8cd98f00` | read-only |
| `Straumvakt-driver-access-ui` (Codex) | `4757f5c` | 15 | `f838b280367e` | read-only |
| `Straumvakt-onboarding-web` (Codex) | `4b69d0f` | 10 | `91cc3349e6fa` | read-only |
| `Straumvakt-remediation-architecture` | `fabc56f` | 0 | `d41d8cd98f00` | read-only |

All tips matched expectation. Close fingerprints are re-recorded in the handoff.

## 2. Confidence legend

`SOURCE-FACT` — read from a named file and line at a named commit ·
`PRODUCT-DECISION` — accepted direction, not derived from code ·
`PROPOSAL` — this packet's design, not implemented ·
`UNKNOWN` — needs a human, a dashboard, a database or a bench.

## 3. Re-test of the three headline findings

### A — bearer organisation-membership grant: **HOLDS**

`SOURCE-FACT` `apps/api/src/routes/public/invites.ts:4-6` @ `4b69d0f` — "gated by
the invite token itself — possession of an unexpired unused invite token is the
only authorisation required". Compare `driver.ts:1203-1207`, which compares
`row.userId !== userId` before any grant.

Confidence: high. Unchanged.

### B — password overwrite: **HOLDS, and is not normalised**

`SOURCE-FACT` `invites.ts:142-147` — `userCredential.upsert({ update: { passwordHash } })`.
No precondition, no authentication of the caller beyond token possession.

The hard stop forbids weakening this finding, and nothing in the second pass
weakens it. The in-code comment calls a pre-existing credential "unusual for an
invite flow, but defensive" — that is a statement about *frequency*, not about
*authority*. A rare path that resets a password on bearer possession is still a
password reset on bearer possession.

Confidence: high. Severity **raised**, see [09](09-adversarial-analysis.md) §2.

### C — discarded kennitala: **HOLDS, and is worse than first reported**

`SOURCE-FACT` `apps/mobile/lib/api/client.dart:97-107` @ `4757f5c` sends
`{token, kennitala, password}`; `invites.ts:36-39` declares a non-strict Zod
object of `{token, password}`; `grep kennitala apps/api/src/routes/public/invites.ts`
is empty.

**New evidence the first pass missed:**

`SOURCE-FACT` `apps/mobile/test/api/client_contract_test.dart:136-146` @ `4757f5c`
— there is a **passing test named `invite consume serializes identity`** that
asserts the request body equals `{token, kennitala, password}`.

`SOURCE-FACT` `archive/straumvakt-org-console-2026-08-08/app/invite/[token]/accept-form.tsx:52`
— the archived **web** client posted `{ token, password }` only.

So the two clients disagree, the server silently accepts both because the schema
is non-strict, and a green test suite actively reinforces the belief that
identity is transmitted and checked. The word "identity" in the test name is the
problem in miniature.

Confidence: high.

## 4. Correction to the prior packet

**Prior claim** (doc 01 §1): "the app calls path 1 … it does not call
`redeem-invite` or `claim-invite` at all", with the implication that the mobile
app is the only client of `invites/consume`.

**Corrected.** A search across all reachable commits, not just `HEAD`, finds:

| Route | Callers found across all branches/archive |
| --- | --- |
| `invites/consume` | mobile `client.dart`, `types.dart`, `redeem_invite.dart`, `client_contract_test.dart`; **archived web** `app/invite/[token]/accept-form.tsx`; `src/app/invite/[token]/accept-form.tsx` on other branches |
| `redeem-invite` | **archived web** `app/driver/redeem/page.tsx` only |
| `claim-invite` | **none, on any branch, ever** |
| `public/register` | none |
| `driver/access-requests` | none |

Two consequences:

1. `invites/consume` has **two** historical clients with **different payloads**.
   Hardening it affects a parked web page as well as the app.
2. **`claim-invite` has never had a client.** The fix that closes the ADR 0053
   deadlock exists only as an API surface. This strengthens
   [04](04-invite-consolidation.md) §3 rather than weakening it: the identity-bound
   path is not merely under-adopted, it is entirely unadopted.

This is exactly why "no in-repo caller" must never be read as "unused".

## 5. Finding D — new: `pendingApproval` is a contract that does not exist

`SOURCE-FACT` `invites.ts:171-176` — the success response is
`{ ok: true, userId, orgId, email }`.

`SOURCE-FACT` `grep -rn pendingApproval apps/api/src` returns **nothing**. The
server never emits the field.

`SOURCE-FACT` `apps/mobile/lib/api/types.dart:160-172` @ `4757f5c` —
`ConsumeInviteResult` declares `this.pendingApproval = false`, commented "True
when the invite was configured with a host-admin allow-term (ADR 0026 §3) — the
membership is not active until the host approves."

`SOURCE-FACT` `client_contract_test.dart:147-155` — the test's **fake server
returns `pendingApproval: true`** and the test asserts the app handles it.

**Therefore:** in production the field is absent, the Dart default makes it
`false` unconditionally, and any "awaiting host approval" branch in the app is
unreachable. The contract test passes because it validates against a server that
does not exist.

**Impact.** If ADR 0026 §3 approval semantics are real, a driver whose
membership is *not yet active* is told they are enrolled. They then attempt to
charge and are refused at the plug, with no explanation the app can give,
because the app believes it saw a successful enrolment.

`UNKNOWN` — whether any invite is currently configured with a host-admin
allow-term. That requires a database read, which is out of scope here.

Severity and full trace in [09](09-adversarial-analysis.md) §12.

## 6. Reconciliation with Codex's frontend contract

`SOURCE-FACT` `Straumvakt-onboarding-web` (dirty WIP) contains
`docs/notes/2026-08-09-onboarding-frontend-contract.md`, written independently.

It converges with this packet on every substantive point: one onboarding
aggregate rather than derived screens; installation code + passphrase granting
**installation or driver-group access, never organisation administration**; no
tenant disclosure before acceptance; hash passphrases, rate-limit, rotate,
revoke, dedupe, audit, avoid enumeration responses; support mode as presentation
of an already-authorised platform action with both identities carried and every
mutation still permission-checked server-side; and a shared technical token that
"may explain how a charger accepted a transaction, but must never be displayed
as the driver".

It also independently identifies the same gap, listing the invited driver's
current path as `/api/public/invites/consume` and the need as "**a unified
authenticated invite path**".

Two independent designs reaching the same architecture is the strongest
available evidence that the architecture is right. **The vocabularies differ,
and that must be resolved before implementation** — see
[10](10-api-contracts.md) §1, which adopts one set of names rather than shipping
two.
