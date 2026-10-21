# Session handover — 2026-08-20

Written by the Cowork coordinator at close. **Read this first next time.**

Companion reading, in order: `FOCUS.md` · `CLAUDE.md` rules 1–4 ·
**`docs/adr/0054-devices-placements-and-effective-dating.md`** ·
`docs/notes/2026-08-19-clean-shell-requirements.md` ·
`docs/agent-prompts/latest.md`.

The previous handover is `docs/agent-runs/2026-08-18/SESSION-HANDOVER.md`. It is
still accurate on round 1–3 mechanics and **materially wrong on framing** — it
was written before the fresh-start and model corrections below.

---

## 1. The one-line state

**Round 3 is complete and clean on both lanes. Round 4 is not written. The
device/placement model is locked as ADR 0054, and items 1–6 of it must land
before the Dalvegur re-onboard.**

---

## 2. Branches

| Branch | Tip | State |
|---|---|---|
| `dev/core-billing-integration` | `8274256` | green, clean — money engine, period lifecycle, 9 API endpoints over ports |
| `dev/market-rails` | `7cc591e` | green, clean — invoice contracts, PDF, onboarding readiness |
| `dev/straumvakt-org-relaunch` | `82c63ac` | canonical, unmoved since 2026-08-10, red on typecheck |

Nothing pushed. Nothing deployed. **No migration applied to any database.**

**The clean shell has never existed in one tree.** A has the money engine and no
PDF/delivery/onboarding; B has those and no `core-billing`. Assembling them is
unscheduled work that has to happen before anything is provable end to end.

---

## 3. Round 3 — complete

| | Claude A | Claude B |
|---|---|---|
| Gates | **22 / 22**, 44m05s | **21 / 21 + 7/7 fallback**, 27m34s |
| Tips | `a84141e → 4a84b5b` | `a81860b → da2d458` |
| Tests | 1.630 → 1.689, 16/16 checks | 888 → 992 root + 176 gateway, checks 13 → 14 |

A's own 7-item fallback queue is **untouched** — the 22-gate table consumed the
round.

**Two blockers it created, both now the critical path:** no store for the
invoice number sequence (migration `0004`, does not exist — A deliberately did
not invent it), and no agreement write surface (`agreements.ts` exports three
functions and all three read).

---

## 4. What changed about the *framing* — read this before trusting older notes

Five corrections from Andri this session. Each invalidates standing analysis.

1. **Fresh start. Nothing legacy is required. No backfill.** Legacy data was
   always meant to be parked as reference, never inherited. This removes the
   parity burden, the harvest protocol's keep-the-old-path-running step, the
   `0002` rollback-window analysis, the `rate_references` dedupe question, and
   the entire evidence base of the active-driver packet.
2. **Why the restart happened:** database hardwiring out of hand, useless APIs,
   and multiple workflows for one purpose. Those are the diagnosis, not gaps to
   be fixed in place. The port pattern is the cure for the first.
3. **The dweller is the billable party — there is no apartment abstraction.**
   The MDU org holds the meter and pays the utility; Straumvakt bills dwellers
   on the org's behalf. Do not resurrect `BillObject` for the MDU line.
4. **Straumvakt never holds money.** The host is the kröfuhafi and Straumvakt
   operates their claims as agent — a per-host onboarding step, not a
   Straumvakt bank registration. No remittance ledger, no client account.
5. **Legacy data is reference data.** The measured fill rates describe a
   *configuration* Andri chose — OCPP auth deliberately off from 13 May to
   4 August, with a per-charger default idTag standing in for drivers. **Do not
   reconstruct a fault from a data gap**, and never size a decision with a
   legacy figure.

Detail: `straumvakt-fresh-start.md`, `straumvakt-model-decisions.md` and
`feedback-straumvakt-data.md` in project memory.

---

## 5. ADR 0054 — locked 2026-08-20

`docs/adr/0054-devices-placements-and-effective-dating.md`, plus a line in
`DECISIONS.md`.

Immortal `device` on a surrogate key holding lifetime stats ·
`device_identities` because the OCPP identity is a credential ·
`placements` as `device × installation × tstzrange` under
`UNIQUE (device_id, period WITHOUT OVERLAPS)` · memberships closed never
deleted · billing counts overlap · sessions sealed with placement, site and
tariff · lifetime data permanent.

**Why the temporal key and not a partial unique index:** the partial index
enforces one *open* row and nothing about closed ones, while billing sums over
overlap — so a backfilled correction invoices two hosts for one charger,
silently.

Thirteen implementation changes are in the ADR. **Items 1–6 land before the
Dalvegur re-onboard**, which writes the first placements.

**Retires D9** (charger-identity access grant — there is no grant model).
**Un-blocks the bill-the-roster option in D1**, which the packet had to reject
because memberships had no window.

**Unaffected:** the money engine, all of `packages/contracts`, the nine-endpoint
route surface, migrations `0002`/`0003`, and the gateway Worker.

---

## 6. Waiting on Andri

Ordered by leverage. The full brief is
`docs/notes/2026-08-19-decision-brief.md` — **re-read D1 in light of §5 above,
and ignore its 50 kr sizing, which came from legacy data.**

1. **The active-driver definition** — still blocks every real period, and the
   option set has changed.
2. **Authorise `0002` and `0003`** via A's 13-step runbook
   (`docs/notes/2026-08-18-first-invoice-operator-runbook.md`), steps 4 and 5.
3. **Session-data retention** — invoices are the host's to keep; per-driver
   session rows are still undecided.
4. **Which Postgres version Neon serves.** `WITHOUT OVERLAPS` is 18+; below
   that ADR 0054 needs `EXCLUDE USING GIST`.
5. **Rotate `ADMIN_PASSWORD`** on exactly three Workers — `hlada`,
   `hlada-staging`, `hlada-api-staging`. Not `straumvakt-ocpp`: its secrets are
   retired with the dead Worker, never rotated.
6. **Ask customer 1 two questions in one email** — krafa or transfer against a
   PDF, and do they require a structured invoice in procurement.
7. **What "production" means** — recommendation is adopt the `-staging` Workers
   in place, the only option whose first step does not interrupt 21 live
   WebSockets. Strike the rename option.
8. **File the Codex Work dispatch.** Its completion artifact exists at
   `docs/agent-runs/2026-08-10/`; only the index was never updated. It is
   unfiled, **not** stalled.

---

## 7. Round 4 — not dispatched

Suggested cut, unwritten:

| Lane | Work |
|---|---|
| **A** | ADR 0054 items 1–4 (devices, placements, device identities, EVSE/connector hierarchy) + migration `0004`, the invoice sequence store |
| **B** | The agreement write surface, then ADR 0054 items 5–6 |
| **Then** | Assemble the two branches · the Dalvegur re-onboard |

Also outstanding and cheap: `Charger.Active` persisted (item 12), the
`z.Energy ?? 0` refusal, and wiring `liveness-sweeper.ts` to something — it has
266 lines, 31 tests and zero callers, and the AMS module is what should consume
it.

---

## 8. Findings that should not be re-derived

- **The estate:** 20 active chargers at Dalvegur, 15 deactivated, 35 total in
  the Zaptec portal, **30 rows in our database**. The importer reads
  `Charger.Active` and discards it, so per-connector billing would invoice 30
  where 20 exist. Also check pagination — `listChargers` ignores Zaptec's
  `Pages` envelope and 30-of-35 is suspicious.
- **The fleet is `AuthenticationType = 2` (Ocpp) uniformly.** Driver auth is off
  per-charger via `IsAuthorizationRequired`, which is why sessions carry the
  default idTag instead of a person. The lever to change it —
  `updateChargerSettings({"120": "true"})` — is already implemented.
- **The default idTag is just a token.** Register it, put it in a group under
  the installation agreement, set that clause's bearer to `org`. No resolver
  branch, no nullable `userId`. It will count as one active driver; exclude by
  group if that matters.
- **`enforceAuthorize` defaults false** and the gateway replies Accepted
  regardless. It cannot be switched on until the default idTag is registered —
  the two are one change.
- **The gate already enforces the no-contract rule** — `no_contract` and
  `no_billable_clauses`. The CDR import path bypasses it entirely, by
  construction, and needs its own check reusing the same verdicts.
- **Duplication has reproduced inside the clean shell:** two delivery state
  machines, two document models, two active-connector derivations, and ~3.500
  LOC across 13 orphaned modules. Pick one of each before generating the fresh
  schema.
- **The clean shell writes to zero of the 66 baseline tables** and reads three.
  Its footprint is the 13 tables from `0002`/`0003`. The legacy billing
  generation is never created rather than retired.
- **Six things essential and unaccounted** for a real CPMS: the organisation is
  never read (invoice headers come from fixtures) · no payment-status feed ·
  no audit trail · no alert emit path · session retention · and the driver has
  no money surface at all. Detail in the clean-shell requirements doc.

---

## 9. Documents produced this session

| Path | What |
|---|---|
| `docs/adr/0054-devices-placements-and-effective-dating.md` | **The locked model.** Read first |
| `docs/notes/2026-08-19-clean-shell-requirements.md` | What a real CPMS needs, marked against what the restart built |
| `docs/notes/2026-08-19-decision-brief.md` | The open decisions, sorted by who can answer |
| `docs/notes/2026-08-19-mdu-gap-check.md` | Icelandic law, incumbents, the Zaptec fork. **Use with care** — written against the legacy surface before the fresh-start correction, and its §4.1 apartment framing is withdrawn in place |
| `docs/architecture/straumvakt-charge-to-invoice.svg` | The flow: two ingress paths, the gate, the bearer ladder |

The live status board is the Cowork artifact `straumvakt-market-phase-status`,
current through round 3. **Update it rather than rebuilding.**

---

## 10. A note on how this session went

Andri corrected me on six substantive points — the apartment model, the Zaptec
auth mode, the May–August gap being a deliberate setting rather than an outage,
the Dalvegur serials, whether the gate refuses, and special-casing the default
idTag. An adversarial fact-check caught four more before delivery.

The common cause each time: reasoning from legacy data and from a market
framing he did not hold, then writing it up with confidence.

**Two rules that follow, both now in project memory:** the backlog is reference
data and never sizes a decision; and when a data gap looks like a fault, ask
before diagnosing. Fact-check any document with file:line claims against the
sources before delivering it — the pass that caught four errors was worth every
token.
