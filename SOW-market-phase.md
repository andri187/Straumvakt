# Straumvakt — Market Phase: Scope, Priorities & Statement of Work

**Version:** 2026-08-08 · **Phase:** Market focus
**Companions:** FOCUS.md (rules) · WORKSPACE.md (state) · DECISIONS.md (log) · ENVIRONMENTS.md (runbook)

---

## 1. Objective

Get **one real organisation to a correct invoice, from a clean production
environment.** Every item in this phase serves that sentence. Land on the
flat-fee **principal** line (Straumvakt→host); expand later via attribution.

---

## 2. Scope

### 2.1 In scope

| Area | What |
|---|---|
| **Money pipeline** | Harvest the proven engine into `packages/commercial`; line-agnostic invoice ledger; flat-fee principal line (Straumvakt→host, per connector, monthly); invoice **delivery + collection** rail |
| **Environments** | 4-tier (Local · Dev · Staging · Prod); per-service path-scoped deploys; clean Prod **from migrations**; data hygiene; gateway hostname preserved |
| **Security / access** | Rotate the admin credential (hardcoded → secret); admin-**gated** work view at straumvakt.org |
| **Onboarding** | Admin-onboard customer 1; then self-serve (self-enroll → invite users → attach chargers → flat-fee agreement) |
| **Housekeeping** | Reconcile canon (FOCUS/DECISIONS/WORKSPACE/ENVIRONMENTS); `SERVICES.md`; straumvakt.org cleanup |

### 2.2 By-product — not scheduled workstreams

- **Drizzle conversion** — happens on files you touch (touch-it-convert-it). No porting sprint. "Retire Prisma entirely" is a later residual sweep.
- **Clean-shell harvest** — `contracts` done; `commercial` next; per-context modules as touched.
- **Vendor-at-edge ratchet** — passive; leak count trends to 0.

### 2.3 Out of scope / parked  (un-park trigger)

| Parked | Un-park when |
|---|---|
| **Attribution / `createDriver`** | **FIRST** — immediately after first invoice |
| Metered CDR line (host→driver, agent) | with attribution |
| Full cost-center (DSO-by-address · retailer choice · home reimbursement · contractor 10% · card/premium) | post first-revenue |
| Service vertical · Flex / DER · Issues Engine | future products |
| Installation dissolution (0047) · roaming · OCPP 2.0.1 · BLE · NFC · MFA | launch-gate / later |
| Team-scale split (M2–M4 beyond `contracts`) · custom domains | after revenue / when group friction bites |

---

## 3. Priorities (ordered)

1. **Money pipeline → first invoice.** Rule 5: correctness before speed. Customer 1 is admin-onboarded — don't gate the invoice on self-serve.
2. **A clean environment to ship from.** Parallel with #1; the go-live gate.
3. **Self-serve onboarding.** The scale investment; after the invoice is proven.

**Pivot to expand:** un-park **attribution** the moment the first invoice clears — it turns on the metered line and the workplace-pays-for-home differentiator.

---

## 4. Statement of Work

### WS0 — Governance & foundation *(in flight)*
- Canon pivot: `FOCUS.md`, `DECISIONS.md`, ADRs → legacy, `CLAUDE.md` pointer. *(committing)*
- Clean-shell spine: `packages/contracts` harvested (vocab, money-line shape, adapter interface) behind a re-export shim. *(committing)*
- Housekeeping pass: reconcile canon vs tree; `SERVICES.md`; **rotate admin credential**; gated work view + straumvakt.org cleanup.
- **Acceptance:** canon consistent; services register incl. invoice-rail gap + Dev-tier cost; admin cred from a secret and login works; work view admin-gated and live.

### WS1 — Money pipeline  *(Rule 5 — design-first, parity-harness-first)*
- Harvest the proven agreements resolver + ledger into `packages/commercial` (copy-then-strangle; parity harness over the 1,621 legacy + 64 test rows **before** retiring the old path).
- Invoice ledger: **line-agnostic**; a line carries `{whose money, posture, counterparty}`; invoice **header correct per posture** (principal = own invoice; agent = deferred).
- Flat-fee principal line: Straumvakt↔host agreement, one platform-fee factor, per-connector × count, monthly → ledger → invoice; **re-priceable at renewal**.
- **Invoice delivery + collection rail**: email/PDF and/or the Icelandic *kröfu* claim system (market-critical; currently **unscoped** — scope it here). Card processing stays parked.
- **Acceptance:** a host receives a correct flat-fee invoice on dev/staging; parity harness green; amount, VAT posture, and header correct.

### WS2 — Environments
- 4 tiers (Local per-dev · shared Dev · Staging · Prod); Neon branch per tier.
- Per-service **path-scoped** deploys (web · api · gateway · vendor-sync) replacing the whole-tree trigger.
- Clean Prod built **from migrations** + a clean seed (zero test sessions / legacy CDRs); staging test data never promotes.
- Gateway charger-facing hostname **preserved** (S0 hazard).
- **Acceptance:** Dev proves the deploy + migration flow; clean Prod stands up; an invoice is sendable from Prod.

### WS3 — Onboarding
- **Customer 1:** admin-onboard via the existing admin surface (no self-serve needed for first revenue).
- **Self-serve:** org self-enroll → invite/enroll users → attach existing chargers → set flat-fee agreement (roles admin-set).
- **Acceptance:** an org completes self-enroll to a flat-fee agreement without hand-setup.

---

## 5. Sequence & critical path

1. **Now:** commit `contracts`; run the housekeeping prompt (**admin cred first** — it gates the view).
2. **Parallel:** WS1 (money — design → parity → implement) and WS2 (environments).
3. **Go-live gate** = WS1 + WS2 green **and** invoice delivery rail **and** admin cred rotated **and** clean Prod.
4. **First revenue** = admin-onboard customer 1 + correct invoice from clean Prod.
5. **Expand** = un-park attribution → metered CDR line + self-serve scale.

---

## 6. Definition of done (phase)

One real organisation receives a **correct flat-fee invoice from clean Prod**;
work view gated and live; canon consistent; `SERVICES.md` complete incl. the
invoice rail; admin credential rotated from a secret; health trending (vendor
leaks and Prisma mirrors ↓).

---

## 7. Risks & gates

- **Billing correctness (Rule 5)** — parity harness over the rows that exposed the last three bugs; design-first, approval-gated. The biggest risk in the phase.
- **Gateway hostname (S0)** — never rename the charger-facing endpoint without a deliberate re-point plan; 21 live chargers.
- **Admin credential** — treat `admin01` as compromised in git history; rotate on **every** environment.
- **Invoice delivery/collection rail** — unscoped; the pipeline is not done until the host can receive and pay.
- **Dev-tier cost** — extra recurring Neon/Workers/Fly spend; decide consciously.
- **Rewrite temptation** — harvest, don't rebuild; keep OCPP + billing running throughout (no parity cliff).

---

## 8. Ownership *(fill per team)*

Platform (`contracts`/`db`/`core`) · Commercial (money engine) · Product
(`web`/`mobile`) · Integrations (`gateway`/`vendors`) · Ops (envs/secrets/cutover).
**Operator-only:** secret values (incl. the new admin credential), Neon branch
creation, prod cutover, straumvakt.org deploy.
