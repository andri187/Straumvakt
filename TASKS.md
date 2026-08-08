# TASKS — market phase

Tracked checklist for [SOW-market-phase.md](./SOW-market-phase.md).
Rules: [FOCUS.md](./FOCUS.md) · State: [WORKSPACE.md](./WORKSPACE.md) · Log:
[DECISIONS.md](./DECISIONS.md)

**The objective, in one sentence:** get one real organisation to a correct
invoice, from a clean production environment.

---

## How to read this

**Priority order is not strict serial order.** Two tracks run in **parallel**:

```
NOW ──┬──► TRACK A (money) ──────────┐
      │                              ├──► GO-LIVE ──► EXPAND
      └──► TRACK B (environments) ───┘
```

They converge at the **GO-LIVE** gate. Nothing in Track B waits on Track A, or
the reverse.

**Gates** are marked inline and mean *stop and get a decision*:

| marker | meaning |
|---|---|
| `[GATE: design approval]` | Rule 5 — design presented, approved, before code |
| `[GATE: parity green]` | the harness must match before an old path retires |
| `[GATE: deploy go-ahead]` | Rule 1 — no deploy without an explicit yes |
| `[GATE: secret go-ahead]` | Rule 2 — operator sets the value; never written here |
| `[GATE: prod go-ahead]` | production is touched only on an explicit yes |

**By-product work is not a task.** Drizzle conversion of touched files, the
vendor ratchet trending to 0, and per-context harvesting all happen **inside**
the tasks below. There is no porting sprint and no "finish the migration"
item — that is what FOCUS.md rule 1's exception is for.

**Each task runs from its own prompt** and honours its own stops.

---

## NOW — foundation

- [x] **1. Commit the contracts harvest.** Gates verified green: tsc, build,
      dependency-cruiser (baseline still 24, none added), every existing
      `@straumvakt/shared` import resolving through the re-export shim, and the
      two new pieces present — the general money-line shape
      (`{whoseMoney, posture, counterparty}`) and the vendor-adapter interface.

- [~] **2. Housekeeping** — code and docs done; one operator action outstanding.
  - [x] 2a. Admin credential **prepared**. Verified binding-only: no fallback in
        either auth path, no value in any worker config, and `.env.example`
        defaults blanked — that template was the actual source.
        `[GATE: secret go-ahead ✅ cleared]`
        **→ OPERATOR: set `ADMIN_PASSWORD` on hlada · hlada-staging ·
        hlada-api · hlada-api-staging. Then I verify the path on dev.**
  - [x] 2b. Canon reconciled — WORKSPACE.md trued to measured numbers,
        three wrong seed lines recorded.
  - [x] 2c. `SERVICES.md` — full register; invoice rail and Dev-tier cost
        flagged **PENDING**, not picked.
  - [x] 2d. Work view built at `/admin/work`, generated from WORKSPACE.md,
        admin-gated. `[GATE: deploy go-ahead ✅ cleared — option C]`
        No domain wired; ships by normal branch promotion.
  - [x] 2e. straumvakt.org cleanup — **nothing moved**. 66 of 88 assets are
        referenced; the 22 that are not are runtime-loaded Flutter output.
        Repoint deferred to task 10.

---

## TRACK A — money pipeline  *(Rule 5 throughout)*

- [ ] **3. Approve the money-engine design** — harvest plan, invoice ledger,
      flat-fee line, parity plan.
      `[GATE: design approval]`
      *Drafted: `docs/notes/2026-08-08-commercial-harvest-and-invoice-ledger-design.md`.
      One open question in it: add `per_connector` to `RATE_BASES` (recommended)
      vs reuse `per_day`.*

- [ ] **4. Build the parity harness** — 1,621 legacy `session_ledger` rows +
      the 64 test-branch priced sessions (128 lines). Includes a vacuity guard.
      **Built and green before any file moves.**

- [ ] **5. Harvest the resolver into `packages/commercial`** — copy-then-
      strangle; the old path keeps running.
      `[GATE: parity green before retiring the old path]`

- [ ] **6. Build the line-agnostic invoice ledger** — lines carry the money-line
      tag; invoices group by *(claim holder, counterparty, period)*; **lines of
      different posture never share an invoice**, because the header is the
      legal artefact.

- [ ] **7. Build the flat-fee principal line → invoice** — Straumvakt↔host,
      one factor, per-connector × count, monthly. No CDR, no attribution.
      Re-priceable at renewal via a time-boxed rate reference.

- [ ] **8. Scope and wire the invoice delivery + collection rail** — email/PDF
      and/or the Icelandic kröfu claim system.
      **Currently unscoped, and market-critical: the pipeline is not done until
      the host can receive and pay.**

---

## TRACK B — environments  *(parallel with Track A)*

- [ ] **9. Stand up the shared Dev tier** — prove the deploy and migration flow
      end to end.
      `[GATE: deploy go-ahead]`
      *Cost delta (extra Neon branch + Workers + Fly app) is a number to decide
      — see `SERVICES.md` when it lands.*

- [ ] **10. Per-service path-scoped deploys** — a push touching one app
      rebuilds one app. **The gateway's charger-facing hostname is preserved
      (S0)** — 21 chargers hold live WebSockets against it.
      `[GATE: deploy go-ahead]`

- [ ] **11. Clean Prod from migrations + clean seed + data hygiene.**
      `[GATE: prod go-ahead]`

---

## ONBOARDING

- [ ] **12. Admin-onboard customer 1** on the existing surface. Deliberately
      *not* gated on self-serve — the invoice must not wait for it.

- [ ] **13. Self-serve onboarding** — self-enrol → invite users → attach
      chargers → flat-fee agreement. One path, not seven.

---

## GO-LIVE

- [ ] **14. Verify gate** — Track A and Track B both green, delivery rail live,
      admin credential rotated, Prod clean.

- [ ] **15. Send customer 1's first correct invoice from clean Prod.**
      **← the phase is done here.**

---

## EXPAND

- [ ] **16. Un-park attribution** → the metered CDR line (host↔driver, agent
      posture) + self-serve at scale.
      *Un-parked by task 15 and nothing earlier — it is the workplace-pays-for-
      home differentiator, and it arrives through the same resolver into the
      same ledger.*
