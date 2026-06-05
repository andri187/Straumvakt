# Staging data remediation — orgs / hosts / drivers (2026-06-05)

**Status:** Plan for P2 onboarding ([GOING_PUBLIC_CRITICAL_PATH.md](./GOING_PUBLIC_CRITICAL_PATH.md)).
**Source:** read-only inspection of the staging Neon branch
(`spring-leaf-73019190` / `br-tiny-river-abgpqq37`) on 2026-06-05.
**Why:** the orgs/hosts/drivers on staging are **pre-going-public pilot data**
and do not satisfy ADR 0026 (host model) / 0027 (onboarding) / 0029 (billing
attribution) / 0014 (identity). This is the gap list + the path to correct
entities.

---

## Current state (as found)

**Organizations (8)** — `kind = NULL` on **every** row; company-like orgs have
empty `roles {}`:

| Org | kennitala | kind | roles | status |
|---|---|---|---|---|
| Straumvakt | 0804873129 | — | payment_processor, retailer, installer, vendor, dso, emsp, regulator, tso, service_contractor | active |
| Festi | 0101015522 | — | service_contractor | archived |
| Festi ehf | 5402062010 | — | {} | active |
| Krónan ehf | 7112982239 | — | {} | active |
| N1 ehf | 4110033370 | — | {} | active |
| Elko ehf | 5610003280 | — | {} | active |
| Lyfja | 5310952279 | — | {} | active |
| Klettás ehf | 6008022830 | — | {} | active |

**Installations (3):** `Dalvegur 10 - 14` → **N1 ehf**, `Reykjavík HQ` → N1 ehf,
`VCP Lab` → Straumvakt. All `enforce_authorize = false`.

**Memberships (1):** `n1@n1.is`, `role='driver'` in N1 ehf — anomalous
(drivers don't hold tenancy Memberships, ADR 0014). **0 `host_admin`.**

**Drivers (2)** — shared per-company accounts, not people:
- `Krónan Drivers` (kronan@kronan.is) — kennitala `7112982239` = **Krónan ehf's
  org kennitala** (a company number used as a driver).
- `N1 Drivers` (n1@n1.is) — **kennitala NULL** (not the dependent-child carve-out;
  a shared account).

**Other:** `bill_objects = 0`; agreements = 4 `installation` + 2 `service_cpo`;
driver_groups = 2 (2 memberships); 640 charge sessions.

---

## Gaps vs the intended model

1. **No host orgs.** `kind` must be `multi_dwelling | company` for a host
   (ADR 0026 §1). Zero orgs have it → no org is a valid host.
2. **Onboarding never ran.** No `host_admin` membership, no host Agreement with
   negotiated commercial terms (ADR 0027 §1/§3).
3. **Drivers are the rejected shared-account pattern** (ADR 0026 §10B): one
   account per company, one using the company kennitala, one with null kennitala.
   Must be per-person, invite-created, real unique kennitölur (ADR 0026 §3/§10A).
4. **No billing attribution.** `bill_objects = 0` → no unit/owner billing-homes
   (ADR 0029); multi-dwelling invoicing can't resolve.
5. **Anomalous membership** `role='driver'` (ADR 0014 — drivers attach via
   DriverGroupMembership, not Membership).
6. **Charging gate off** (`enforce_authorize=false` everywhere) — fine for pilot,
   but a going-public decision (Rule 5).

What's salvageable: the agreement/driver-group scaffolding (6 agreements, 2
groups) and 640 real sessions — useful as fixtures, not as the live model.

---

## Open decisions (operator)

- **D1 — Migrate-in-place or wipe-and-reseed?** Staging carries 640 real sessions
  + agreements. Option A: migrate (stamp `kind`/`roles`, create host orgs, convert
  accounts) keeping history. Option B: wipe the tenancy/identity layer and reseed
  clean via the real ADR 0027 flow (cleanest; loses pilot history). **Lean B for a
  trustworthy going-public baseline**, keeping a tagged backup branch.
- **D2 — Is `Dalvegur 10–14` an HOA host or N1's site?** The concepts model it as
  a `Dalvegur Húsfélag` (`multi_dwelling`) host, with N1 a separate `company`
  host/workplace. Staging has it as an installation under N1 ehf. Pick the real
  topology.
- **D3 — Which pilot orgs become real hosts** (set `kind`+`roles`) vs stay
  reference/value-chain (`kind=NULL`, roles only) vs archived?
- **D4 — `enforce_authorize` posture** per installation at go-live.

---

## Remediation steps (the ADR 0027 happy path)

Per host, produced by the onboarding flow — **not** hand-INSERTs:

1. **Org** — create/stamp the host Organization with `kind` (`multi_dwelling` |
   `company`), legal identity (name, kennitala), and `roles` incl. `site_host`.
2. **Agreement** — attach the host Agreement carrying negotiated commercial terms
   (service fee, per-charger fee, factor-code set) — ADR 0027 §1.
3. **host_admin** — send the host-admin invite (`kind='invite'`, role
   `host_admin`); recipient sets a password → Membership flips `active`.
4. **Sites/installations** — created via Zaptec import (existing), each Site with
   address + DSO, each Installation with its e-meter + electricity provider.
5. **bill_objects** — create the unit/owner billing-homes (apartment/unit/stall
   for multi_dwelling; company/department/cost_center for company) and bind
   drivers to them (ADR 0029).
6. **Drivers** — invite real people (code/QR/email, ADR 0028); each redeems in the
   mobile app, sets password + confirms kennitala. Replace the `*-Drivers`
   shared accounts. Dependent children only via the group carve-out.
7. **enforce_authorize** — flip per the agreement-gate decision (D4).

## Acceptance checks (re-run on staging after remediation)
- Every host org: `kind IS NOT NULL` and `'site_host' = ANY(roles)`.
- Each host has ≥1 active `host_admin` membership + an active Agreement.
- No `tenancy.memberships.role='driver'` rows.
- Every `audience='driver'` user has a unique non-null kennitala, **except**
  dependent children bound to a group whose owner has one.
- `bill_objects` populated for each multi_dwelling host; every active driver maps
  to a billing-home.
- `enforce_authorize` set deliberately per installation.

---

## Applied — N1 (2026-06-05)

Decisions: **D1** migrate-in-place (keep all logs); **D2** N1 ehf is a `company`
host, Dalvegur 10–14 is N1's workplace site (no HOA); **D3** fix N1 only,
onboard the rest via UI later; **D4** leave `enforce_authorize=false` until
real per-driver access is wired (avoids the Zaptec lockout failure mode).

**Rollback snapshot:** branch `backup-2026-06-05-pre-n1-fix`
(`br-damp-hall-ab9xaoqb`), forked from staging `br-tiny-river-abgpqq37`.
(+ Neon 6h point-in-time restore.)

**Writes applied to staging:**
1. `UPDATE tenancy.organizations SET kind='company', roles='{site_host}' WHERE id='b9f6a897…'` — N1 ehf is now a recognised company host.
2. Consolidated the duplicate driver groups: removed the **stale** "N1 Drivers"
   group `7820a970…` (bound to an *expired* agreement on the *VCP Lab*
   installation) + the driver's redundant membership in it.

**Kept / untouched:** the driver user `n1@n1.is`, the **active** "N1 Drivers"
group (`4b2b358f…` → Dalvegur 10–14, active agreement) + its membership, the
**7** driver CDRs (`reports.session_ledger`), **639** `charging.sessions`, and
**617** `imported_cdr_refs`. The stray `tenancy.memberships role='driver'` row
was intentionally **left in place**.

**Verified after:** N1 `kind=company/roles={site_host}`; 1 N1 driver-group;
driver has 1 active membership; CDRs 7 / sessions 639 / imported 617 unchanged.

**Still open (by design):** other orgs unclassified (onboard via UI); no
`bill_objects` yet; drivers still the shared account; `enforce_authorize=false`.

### Redundancy cleanup (same session, operator-approved)
Reference-checked (all 0 inbound refs) and captured-before-delete:
1. **Test `Festi` org** `fa7ae544…` (fake kt `0101015522`, archived, 0 refs across
   memberships/sites/installations/properties/stations/agreements/groups/bill_objects/sessions)
   — the real `Festi ehf` (`5402062010`) is kept.
2. **Expired orphan agreement** `b6771541…` (VCP-Lab/N1 sandbox; 0 clauses, 0
   bearer_rules, 0 billing_lines, 0 groups).
3. **Stray `tenancy.memberships role='driver'`** (n1@n1.is) — now 0 tenancy
   memberships.
Verified after: orgs 8→7, agreements 6→5 (0 expired), memberships 1→0; CDRs (7)
/ sessions (640) unchanged. Full pre-delete row JSON retained for targeted
re-INSERT; snapshot branch `backup-2026-06-05-pre-n1-fix` covers all.
