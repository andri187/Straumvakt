# Remediation architecture packet — master index

**Status: proposals only. No runtime code, schema, config, or external state was changed.**

| | |
|---|---|
| Worktree | `E:\Claude\Straumvakt-remediation-architecture` |
| Branch | `docs/remediation-architecture-packet` |
| Base | `ed6dc4e` — the completed readiness-audit tip (audit history preserved) |
| Started | 2026-08-09T00:29:08Z |

## Source snapshots this packet is written against

Every proposal below cites one of these. Two are **moving**; findings against
them are timestamped.

| Snapshot | Ref | State at read | Owner |
|---|---|---|---|
| Release candidate | `dev/relaunch-release-candidate` @ **`4b69d0f`** | clean, 0 dirty | Claude 1 — **moving** |
| Mobile product | `dev/mobile-product-to-market` @ **`ae5db26`** | verified, matches handoff | Codex — complete |
| Audit baseline | `docs/overnight-readiness-audit` @ `ed6dc4e` | frozen | me |
| Archived web portal | `archive/straumvakt-org-console-2026-08-08/` | frozen | — |

## Documents in this packet

| # | Document |
|---|---|
| 1 | this index |
| 2 | [P0 remediation specifications](2026-08-09-p0-remediation-specifications.md) |
| 3 | [proposed ADR drafts](../adr-proposed/) |
| 4 | [driver API contract proposals](2026-08-09-driver-api-contract-proposals.md) |
| 5 | [security remediation packet](2026-08-09-security-remediation-packet.md) |
| 6 | [connector capacity model](2026-08-09-connector-capacity-model.md) |
| 7 | [capacity calculation source + CSV](../../scripts/analysis/) |
| 8 | [load and resilience test spec](2026-08-09-load-and-resilience-test-spec.md) |
| 9 | [SLOs and incident runbooks](2026-08-09-slos-and-incident-runbooks.md) |
| 10 | [contractor role model](2026-08-09-contractor-role-model.md) |
| 11 | [remediation issue backlog](2026-08-09-remediation-issue-backlog.md) |
| 12 | [release decision workshop](2026-08-09-release-decision-workshop.md) |

---

## 1. Headline: a money-unit contradiction, and a correction to my own audit

**This is the most important finding of this session, and part of it is that my
previous audit got it wrong.**

### What I claimed in the readiness audit

In `2026-08-09-driver-session-lifecycle.md` §7 I wrote that `costIncVatMinor` is
minor units and that *"for ISK minor == major, so the conversion is an
identity"*, citing the comment in `driver-sessions.ts`. **That was wrong.** I
took a source comment as authority without checking the code that writes the
column.

### What the source actually says

| Source | Statement | Implication |
|---|---|---|
| `apps/api/src/lib/tariff/compute-session-cost.ts:13-21` | *"1/100 króna (i.e. aurar). Aurar are a formally-defined subunit even though no aurar coins circulate today; the math needs that."* `totalIncVatMinor: BigInt — gross total in 1/100 króna` | **The columns are aurar.** This is the code that computes and writes them |
| `compute-session-cost.ts:211-219` `formatIskMinor()` | *"Convert sub-króna minor to króna with 2 decimals"* — `abs / 100n`, renders aurar remainder | Server formatter divides by 100 |
| `archive/…/app/driver/history/page.tsx:23` | *"costIsk is aurar (1/100 króna); ÷100 + 2 decimals (is-IS), matching mobile."* | The **established product-wide convention**: clients divide |
| `apps/mobile/lib/api/types.dart:234, 464` @ `ae5db26` | `(minor / 100).round()` | Codex is consistent with that convention |
| **`apps/api/src/repositories/driver-sessions.ts:93-98`** | *"ISK has no minor unit, so minor === major"*, returns `Number(minor)` **undivided**, under the field name `costIsk` | ❌ **Contradicts all four above** |

### The actual defect

There is **no live money error today**, because two things cancel: the API
emits raw aurar under a króna-shaped name, and every current client divides by
100. The defect is that the contract is **undocumented and mislabelled**, which
makes it a trap:

- **Fixing `minorToIsk()` to divide — the obvious "fix" — instantly makes every
  client show 100× too little.** The comment invites exactly that change.
- Any *new* consumer that trusts the field name renders **100× too much**.
- The two driver endpoints disagree in style: `/sessions/:id` returns
  `costIskMinor` (honestly named) **plus** a server-rendered `costFormatted`,
  while `/sessions/current` and `/sessions/history` return raw aurar as
  `costIsk`. Codex handled this correctly per-endpoint —
  `session_detail.dart:111` uses `costFormatted`, and only the current/history
  paths divide — but that correctness is undocumented and easily lost.

**This is specified as P0-E.** It is a naming and contract defect, not a
calculation defect, and it must not be "fixed" one side at a time.

---

## 2. Moving-tip reconciliation — audit findings re-checked against `ae5db26`

I re-read source rather than trusting the handoff. All claims verified.

| Audit finding | Status at `ae5db26` | Evidence |
|---|---|---|
| **P0-1** power/cost placeholder rendered as measured | **FIXED (client side)** — `active_session.dart:240` renders `'Unavailable'`, `:246` renders `'Pending'` | verified |
| **Backend still emits `powerKw: 0`** | **OPEN** — `driver-sessions.ts:135` unchanged at `4b69d0f`; also `driver.ts:593,683` emit `costIsk: 0` | **The client now compensates for a backend that still lies.** See P0-A |
| Current-session envelope parsed as one object | **FIXED** — envelope + nullable connector IDs + newest-first fallback | handoff §3, verified by screen inventory |
| history / billing / detail callers absent | **FIXED** — `charge_history.dart`, `session_detail.dart` added | `ls lib/screens/` |
| Session recovery + final detail | **FIXED** — uses `/api/driver/sessions/:id` | `session_detail.dart:111` |
| **P0-4** vehicle/plate fabrication | **FIXED** — `my_vehicle.dart` states no vehicle connected; hero plate overlay removed | handoff §4, screen present |
| "Invoices" mislabelling | **FIXED client-side** — billing records not labelled invoice documents | handoff §4 |
| BLE charger settings in driver IA | **REMOVED from navigation**, source preserved | handoff §4 |
| **P0-3** driver login rate limiting | **OPEN** — backend-only, untouched | `driver.ts:121` |
| **P0-5** Cloudflare control-plane facts | **OPEN** — unchanged | no dashboard access |

**Net:** Codex closed the mobile half of P0-1 and all of P0-4. The **backend
half of P0-1 is still open and is now more urgent, not less** — the app is
currently correct only because it works around a backend that still emits
fabricated zeroes. If the app is ever simplified to trust the API, the lie
returns.

### New contradictions introduced

| # | Contradiction | Resolution |
|---|---|---|
| X1 | Backend comment says ISK has no minor unit; costing engine says it has aurar | Costing engine wins — see §1. **P0-E** |
| X2 | Client renders `Unavailable`/`Pending`; backend still sends `0` | Client compensates. Backend must stop sending `0` — **P0-A** |
| X3 | My audit's §7 money analysis | **Corrected here.** Superseded by §1 |

---

## 3. Audit items carried forward

From the readiness audit, unchanged unless noted.

**P0:** P0-1 *(backend half open)* · P0-2 live-power provenance · P0-3 login
rate limit · ~~P0-4~~ **closed by Codex** · P0-5 Cloudflare facts · **P0-E new**

**P1:** P1-1 *(closed by Codex)* · P1-2 *(closed client-side; API route still
named `/invoices`)* · P1-3 history-vs-billable sources · P1-4 currency field
*(superseded and escalated by P0-E)* · P1-5 connector state literal · P1-6
pending-approval surface · P1-7 pricing preview · P1-8 refresh-token revocation
· P1-9 support/privacy/terms

**P2:** P2-1…P2-8 unchanged.

**Decisions D-1…D-10** carried into [the ADR drafts](../adr-proposed/) and
[workshop packet](2026-08-09-release-decision-workshop.md).

---

## 4. How to read this packet

- **Fact** — verified in source at a named snapshot, cited to file:line.
- **Inference** — consistent with evidence, not proven.
- **Recommendation** — my judgement; the decision owner is named.
- **Unknown** — cannot be resolved without access I do not have.

Proposed ADRs live in [`docs/adr-proposed/`](../adr-proposed/) — a separate
directory from `docs/adr/`, every file prefixed `PROPOSED-`, every front-matter
status `Proposed`. **None is accepted architecture.**
