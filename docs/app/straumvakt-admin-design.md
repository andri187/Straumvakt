# Straumvakt Operator Admin — design rationale

**Date:** 2026-06-04
**Companion mock:** [straumvakt-admin-concept.html](./straumvakt-admin-concept.html)
**Grounded in:** STRAUMVAKT_ARCHITECTURE_V3, ADRs 0006/0008/0010/0011/0012/0014/0019/0020/0026/0029/0031/0032,
the 2026-05-04 Zaptec-Webhooks lockout incident, and the going-public pivot.

> This is the **Straumvakt staff** console — not the host-admin portal
> ([host-portal-concept.html](./host-portal-concept.html)). Two jobs were
> stated: *administer all hosts* and *onboard a host*. But the notes show
> the staff console is really a **transport-agnostic charging-operations**
> tool where onboarding and host-admin are two surfaces among several, and
> the highest-stakes work is **access/auth** and **fault diagnosis**.

---

## 1. What this console actually is

A generic admin UI would model this as a CRM of hosts → drivers → invoices.
That's wrong for Straumvakt. The console reconciles **three orthogonal
lenses over the same charger**, and its hardest moments are operational,
not commercial:

| Lens | Hierarchy | Used for |
|---|---|---|
| **Physical / asset** | Org → Property → Site → Installation → Circuit → Station → EVSE → Connector | onboarding, fleet ops, diagnosis |
| **Control plane** (ADR 0011/0012) | per-install transport: OCPP / Zaptec-Native / Zaptec-Webhooks / Easee API / external CPMS / read-only | what commands + auth Straumvakt actually owns |
| **Commercial / access** (ADR 0019/0020/0029) | Agreement + DriverGroup + BearerRule grid + BillObject | who may charge, and who pays |

The same charger is a *box on a wall* (physical), an *OCPP-or-vendor
endpoint* (control), and a *node in someone's billing + access graph*
(commercial). One tree can't express that — the IA must let staff **pivot
lenses**, not force one hierarchy.

## 2. Principles (each traceable to a note)

1. **Three lenses, one charger.** Every charger view shows its asset
   path, its control plane, and its access/billing coverage — and lets you
   jump to any lens. *(ADR 0011/0012; the synthesis's "three orthogonal
   dimensions".)*

2. **Safety rails on dangerous transitions.** The two ways to brick a site
   are flipping `enforceAuthorize=true` before DriverGroups are populated,
   and switching Zaptec `AuthType` to Webhooks with an empty IdToken table
   (the 2026-05-04 Dalvegur lockout). These must be **guarded workflows
   with pre-flight checks**, not raw toggles. The safe path is the default;
   the lockout risk is shown inline. *(ADR 0020; incident 2026-05-04.)*

3. **Transport-awareness everywhere.** Every charger/installation wears a
   control-plane badge (OCPP / Zaptec-N / Zaptec-WH / Easee / external /
   read-only) and the UI only offers commands that transport actually
   supports. Free-vend (`acceptsVendorDefault`) and `vendor_default`
   IdTokens are first-class, not edge cases. *(ADR 0011/0012/0020.)*

4. **Diagnosis is first-class — now.** The Issue Engine is post-pilot
   (ADR 0006 tag D), so staff diagnose **by hand**: fleet health →
   charger technical-read → raw `events.event_log` → session detail. This
   is a *primary* surface, not a footnote. The going-public Issue Engine +
   **nágrannahjálp** (ADR 0032) slot into this surface later. *(ADR 0006/0032.)*

5. **Multi-role orgs — "Hosts" is a lens, not an object.** One org row is
   operator + asset-owner + payer + retailer-ref + DSO-ref (ADR 0010, 13
   roles). A **host** is just the customer facet (`kind ∈
   {multi_dwelling, company}`, ADR 0026). The UI tags which role is in play
   and never conflates them; "Hosts" filters orgs, it isn't a new entity.

6. **Owner ≠ operator ≠ payer.** Service/tickets route to the hardware
   **owner** (`chargers.owner_org_id`); sessions cost to the **payer**
   (resolved at stop); the SaaS tenant is the **operator**. Charger detail,
   billing, and (later) Issue-Engine routing surface all three. *(ADR 0008.)*

7. **Onboarding is two-phase.** *Business* onboarding (org + `kind` + terms
   + host-admin invite, ADR 0026/0027) is the easy half. The real work is
   *technical* onboarding: vendor credential → discover → map → create →
   **seed IdTokens → verify access → go-live (enforce auth)**. The mock's
   first version only had the business half; the danger lives in the
   technical half.

8. **Billing is a resolver, not a price list.** Agreement + BearerRule grid
   (scope × audience) + RateReference versions + cost-centers, resolved at
   session-stop into BillingLines — with a **resolver-debug** to answer
   "why did this driver get billed this?" The going-public layer (BillObject
   owner-of-record, agent billing, per-household) sits *on top*; the driver
   **access-fee mechanics (P0.7)** and the **invoice engine** are the open
   gates. *(ADR 0008/0019/0029/0031.)*

## 3. Information architecture

Organised by operator job + lens, not by table:

- **Operations** — health-first home (online/offline/faulted, queue/DLQ
  lag, sessions, energy), "needs-me-now" (hosts/chargers/applications),
  cross-host live sessions.
- **Hosts** *(customer lens)* — orgs filtered by `kind`; **host detail**
  rolls up drivers + billing-homes + sites + host-admins + contract.
- **Onboarding** *(two-phase workspace)* — host create / convert-from-apply
  · vendor import (discover → map) · **Go-live** (guarded: seed IdTokens →
  verify DriverGroups → enforce auth / free-vend, with pre-flight + lockout
  warnings).
- **Fleet** *(physical + control-plane lens)* — Org→Site→Installation→
  Circuit→Charger with transport badges + auth-mode state; charger detail =
  diagnosis hub (technical-read, commands gated by transport, config,
  sessions, event-log jump).
- **Access & Auth** *(the high-stakes surface)* — IdToken universe,
  DriverGroups, per-install `enforceAuthorize` / `acceptsVendorDefault`
  state across the fleet, with the safety pre-flight. Its own home because
  this is where lockouts happen.
- **Diagnostics** *(manual now; Issue Engine later)* — fleet technical-read
  grid · event-log query · session inspection. ADR 0032 tickets +
  nágrannahjálp land here.
- **Billing** *(commercial lens)* — Agreements + BearerRule grid +
  cost-factors + tariffs/rate-refs + cost-centers + driver-contracts +
  resolver-debug + shadow billing + (going-public) BillObjects + host
  invoices.
- **Drivers** *(operator-wide, ADR 0026 §11)* — every driver across hosts.
- **Platform** — PlatformGrant staff + MFA, observability/health, deploys,
  reference catalogue (DSO/retailer/vendor APIs).

## 4. What changed from the first mock

| First mock | Deeper design |
|---|---|
| Host CRM (hosts → drivers → invoices) | Operations console with 3 lenses |
| Onboarding = business only | Two-phase: business + **vendor import + guarded go-live** |
| Auth implicit | **Access & Auth** as a first-class, safety-railed surface |
| No diagnosis | **Diagnostics** primary (manual now, Issue Engine later) |
| Fleet = flat list | Fleet with **control-plane badges + auth-mode** |
| Billing = price list | Billing as **resolver** (BearerRule grid + cost-centers + debug) |
| Org = host | **Multi-role org**; Host is a lens; owner≠operator≠payer |

## 5. Open design questions (operator's call)

1. **Primary spine** — lead with *Operations* (health) or *Hosts*
   (customers)? (Leaning Operations: the dangerous + frequent work is ops.)
2. **Access & Auth** as its own section vs. folded into Fleet? (Leaning
   own section — lockout prevention deserves prominence.)
3. **Go-live wizard** — one guided flow (import → seed → verify → enforce)
   vs. discrete toggles on installation pages? (Leaning guided.)
4. **Issue Engine slot** — when ADR 0032 lands, does nágrannahjálp surface
   under Diagnostics, Hosts, or its own section?
5. How much of the deep billing resolver (BearerRule grid) belongs to
   *staff* vs. stays SQL/debug-only for pilot?
