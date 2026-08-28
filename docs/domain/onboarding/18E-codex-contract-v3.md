# Appendix 18E — Codex UI enablement contract v3

Completion-rule item 6. Supersedes doc 15 §4 and doc 17 §4.

Six tiers. **Interactive** = real backend, enforced permissions, safe for real
users. **Fixture** = works but exercises a Critical or an unproven flow; local
disposable only. **Read-only** = endpoint exists, no write surface. **Disabled** =
control belongs in the design, backend absent — render it, greyed, with copy.
**Hidden** = no backend and none imminent; do not render at all. **Unsafe** =
must not reach real users.

The difference between *disabled* and *hidden* is intent: disabled tells a user
"this will exist"; hidden makes no promise. Rendering a permanently-hidden thing
as disabled is a roadmap commitment nobody made.

---

## Straumvakt admin

| Area | Tier | Copy | Tests Codex writes |
|---|---|---|---|
| Org CRUD, property/site/installation | **Interactive** | — | happy path + 403 |
| Charger onboarding, OCPP password | **Interactive** | — | rotation audited; password never rendered |
| Remote start/stop | **Interactive** | — | command correlation |
| Membership admin | **Interactive** | — | add/remove |
| Support mode | **Disabled** until C02–C09 | "Support mode isn't available yet." | banner renders when flag on |
| Onboarding progress | **Disabled** | "This isn't tracked yet." | asserts no derived progress |
| Agreements, tariffs | **Read-only** | — | renders, no write control |
| Cost-factor editing | **Hidden** | — | absent from DOM |
| Audit projection | **Hidden** until N03 | — | absent |

## CPO / organisation admin

| Area | Tier | Copy | Tests |
|---|---|---|---|
| Driver list, driver groups | **Interactive** | — | membership add/remove |
| Charger list | **Interactive** | — | list + detail |
| Access-request queue | **Fixture** | "Demo data — not connected to a live system." | approve/reject against fixture |
| Agreements | **Read-only** | — | no write control |
| Cost factors | **Hidden** | — | absent |
| **Charger visibility** | **Hidden — rejected** | "Managed through driver groups." | assert no toggle exists |
| Onboarding wizard | **Disabled** | "This isn't tracked yet." | — |

## Driver app

| Area | Tier | Copy | Tests |
|---|---|---|---|
| Login, charger list, start/stop, active session | **Interactive** | — | happy path |
| Session history | **Read-only** | — | own sessions only |
| Invite redemption | **Unsafe → Fixture** until S2 | "Temporarily unavailable." | disabled-state test |
| Join by code + passphrase | **Fixture** until B03 | demo copy | one generic failure for every cause |
| Pending / rejected access | **Disabled** until B04 | "Not available yet." | state renders |
| Cost breakdown | **Read-only**, never "final" | "Estimated." | no authoritative total |
| Attribution of others' sessions | **Hidden** | — | never names a person |

---

## What Codex must not fake

1. **No stubbing a non-existent endpoint to claim a feature works.** If the
   endpoint is absent, the test asserts the **disabled state**. A green test
   against a stub is the mechanism by which a UI starts lying.
2. **No deriving onboarding progress** from unrelated screens. If the aggregate
   is absent, say so.
3. **No visibility toggle**, even disabled — it is rejected, not pending.
4. **No naming a person** for a session whose attribution is `installation` or
   `unknown`.
5. **No presenting a cost as final** before agreement writes and attribution
   land.
6. **No real-user invite redemption** until S2 ships.

## Fixture safety

- Namespace: `demo-*`, `*@example.test`, `Demo Org`. Lint-enforced.
- Gate: `NEXT_PUBLIC_DEMO_MODE`, **default off**.
- **Kill switch:** the build **fails** if the flag is set in a configuration
  whose API base points at beta or production. Not a warning — a failure.
- Every fixture-backed surface carries the visible string "Demo data — not
  connected to a live system."

A fixture that looks like real data in a screenshot is how a demo becomes a
false claim to a customer. The visible marker is not decoration.

## Promotion path

A surface moves **Fixture → Interactive** when: its endpoint exists and is
permission-gated; its tests pass without stubs; and, where a Critical was
involved, the fix has shipped. Codex should not promote unilaterally — the
backend lane confirms the endpoint is live.

Immediate promotions available on merge of the critical path:
**S2** unlocks driver invite redemption · **C02–C09** unlocks support mode ·
**B03/B04** unlock join-by-code and pending/rejected · **K/L** unlock cost
factors · **N03** unlocks the audit view.
