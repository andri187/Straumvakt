# Gap check — Straumvakt as a market CPMS for Zaptec MDU installations

Written by the Cowork coordinator, 2026-08-19, from five parallel audits: the
Zaptec integration, the MDU product surface, the metering and attribution
chain, the day-two operations surface, and the external regulatory and
competitive baseline.

**Scope taken from Andri:** MDU first, workplace second, **no public charging.**
The Zaptec connection path was left unanswered, so both are analysed — and it
turns out to be one of the larger findings.

Every repo claim below cites `file:line`. Nothing was executed, no environment
was queried, no file was modified.

**This document has been through an adversarial fact-check** against the same
sources, which found four load-bearing errors in the first draft. All four are
corrected here, and one is left in place as a struck-through note in §4.1 so the
correction is visible rather than silent. Primary sources for the Icelandic
legal claims: [Fjöleignarhúsalög 26/1994](https://www.althingi.is/lagas/nuna/1994026.html) ·
[Act 67/2020](https://www.althingi.is/altext/stjt/2020.067.html) ·
[Reglugerð 1061/2008](https://island.is/reglugerdir/nr/1061-2008) ·
[Raforkulög 65/2003](https://www.althingi.is/lagas/nuna/2003065.html).

---

## 0. The one-paragraph answer

**Yes, something is missing, and it is not on any current list.** The money
path is genuinely good — the refusal discipline is better than most production
billing systems ever get. But it bills *the building's organisation a platform
fee*, and Icelandic law makes *per-owner metering* the statutory default in a
shared MDU installation. The schema has an apartment spine, correctly
designed with move-in/move-out windows, and **nothing in the money engine has
ever heard of it.** Meanwhile every Icelandic incumbent already bills the
resident directly and charges the housing association little or nothing
recurring. Underneath that sits a harder fact: on a Zaptec-native estate the
kWh figure is an unsigned vendor scalar that no one verifies, which is two
tiers below what an Icelandic billing dispute is judged against.

**The three sharpest findings, in order:**

1. **`FOCUS.md` — active canon — contains the words "MDU", "apartment",
   "resident" and "load balancing" exactly zero times.** ("Building" appears
   twice, both as the verb.) The stated market focus is not written down
   anywhere that governs the work.
2. **The apartment can be named and cannot be billed.** Seven separate breaks
   between `BillObject` and an invoice line.
3. **Nothing tells anyone when a charger dies.** Not a missing feature — a
   missing *loop*. It already cost a three-month fleet outage that was found by
   a human reading Zaptec's portal.

---

## 1. What is genuinely right, and should not be re-litigated

Worth stating first, because a gap check that only lists holes is misleading.

- **The refusal discipline is real and extensive.** Twenty-plus guards in the
  money path, each refusing on a named reason rather than defaulting to zero:
  `countFromRows` returns `unavailable` on a row count of 0
  (`activity-source.ts:81-83`); `deriveConnectorActivity` writes `activeDays:
  null` not `0` (`activity-month.ts:341`); `resolveMeterEnergy` holds rather
  than billing a lost StopTransaction as a free charge
  (`meter-energy.ts:145-183`); `validateDraft` refuses a zero-total invoice
  outright — *"issue nothing rather than a zero claim"* (`document.ts:505-511`).
  This is the hard part of billing and it is done.
- **The `BillObject` spine is well designed.** `BillObjectMember` carries
  `effectiveFrom`/`effectiveTo` and the repository correctly closes the old row
  and opens a new one on a change (`bill-objects.ts:145-183`), so past sessions
  stay attributed to whoever paid *then*. It is the only **membership** table in
  the schema with a working validity window — tariffs and contracts have date
  ranges, but no other who-belongs-to-what table does. The problem is that it is
  unwired, not that it is wrong.
- **Leaving load management with Zaptec is the correct call.** More below —
  taking it would cost more than it earns.
- **No AFIR or EPBD compliance surface applies.** MDU-restricted charging is
  outside AFIR because its obligations attach only to *publicly accessible*
  infrastructure — the Commission's own Q&A states that points reserved for a
  limited and determinate group, including residents, are not publicly
  accessible. Neither AFIR
  nor the EPBD recast has been incorporated into the EEA Agreement yet.
  Iceland's `Byggingarreglugerð 112/2012` contains no EV-charging provisions at
  all. That is a genuine saving — there is no card terminal, no €/kWh-only
  pricing rule, no OCPI publication duty and no compliance-reporting product to
  build.
- **Zaptec has deliberately left the billing layer open.** Zaptec Portal
  "currently doesn't support direct user invoicing" and names ~12 payment
  partners and ~40 integrations. The slot Straumvakt is aiming at is a real,
  documented slot.

---

## 2. The strategic gap — the law, and the incumbents

### 2.1 Icelandic law already requires what the product does not do

**`Fjöleignarhúsalög` 26/1994, Articles 33.gr.a–d, inserted by Act 67/2020.**
Article **33.gr.d** is the one that matters:

> *Nota skal búnað sem mælir not hvers og eins eiganda á rafmagni, nema slíkt
> sé bersýnilega óþarft.*
> — equipment measuring **each individual owner's** electricity use shall be
> used, unless that is manifestly unnecessary.

Per-apartment metering in a shared Icelandic installation is not a premium
feature. It is the statutory default, and opting out requires the housing
association to conclude it is *manifestly unnecessary*.

**Note the word is *eigandi* — owner, not tenant.** The statute allocates
between the owners of a multi-owner building. Where a flat is rented, the
owner→tenant leg falls under `Húsaleigulög` 36/1994 instead, which says the
tenant pays for electricity in the leased premises and requires the lease to
record a meter reading only *"when such a meter is separately designated for the
rental unit."* For a product deciding whether the billable party is the owner or
the occupant, that distinction is not free — and the `BillObject` spine can
already express both, which is a point in its favour.

The same articles set the buying moment: a **2/3 majority** of owners where the
installation occupies more than half the shared spaces, **unanimity** above
two-thirds, and a mandatory **úttekt** of the building's future charging need
on any owner's request. Shared electrical works and **load-management
equipment** are common costs of the owners.

**So the demand trigger in Iceland is a housing-association meeting, not a
regulatory deadline.** Anything that helps a board reach a valid 33.gr.c
decision and defend a 33.gr.d cost allocation is closer to the sale than
anything AFIR-shaped.

### 2.2 And there is a metrology duty attached to the meter

**`Reglugerð 1061/2008`, Article 2(9)**, defines a **frádráttarmælir** as a
sales meter measuring part of a single measurement delivered through a **shared
service connection, to sub-users in an owners' association** — the exact fact
pattern. **Article 8:** where deduction meters are used inside a consumer
installation for internal settlement, **the owner of the meters is responsible
for ensuring they are legally verified (löggiltir)**.

And Veitur, the Reykjavík DSO, advises that sub-meters be installed **in the
main distribution board, not at the individual charge points**.

That is an architectural fork the product has not taken a position on:

| Bill from | Speed | Evidential standing in an Icelandic dispute |
|---|---|---|
| Charger-reported kWh | Fast, already built | **Weak** — not a löggiltur meter |
| A verified deduction meter in the main board | Slower, not built at all | What a dispute is actually judged against |

Norway already draws exactly this line and drew it hard. Justervesenet:
shared-cost allocation across a borettslag needs no approved meter, but
**"direct billing per consumer" is a commercial solution requiring MID-approved
meters**. (Separately, meters *sold* after 1 January 2025 for commercial EV
metering must carry MID conformity assessment.)

### 2.3 The incumbents have already priced the platform fee to zero

| Vendor | Who pays the recurring fee | Price |
|---|---|---|
| **ON / Orka náttúrunnar** | the resident | **4.400 kr/month**, no fixed term. The húsfélag pays the electrician and grid work (the *grunnnet*) |
| **HS Orka** | the resident | **from 2.490 kr/month**. Association may apply to Loftslags- og orkusjóður for infrastructure cost |
| **Orkusalan** | **the húsfélag, per charger** — resident on private stalls | **3.410 kr/month per charger**; residents *and guests* then pay per session via the E1 app |
| **Hleðsluvaktin** | nobody, recurring | **no monthly management fee to the húsfélag**; resident picks a fixed fee from 3.690 kr or a 10% markup on the electricity rate |
| **Ísorka** | not published | claims **350 housing associations, 60.000 active users**, explicitly multi-vendor |

Note the Orkusalan row carefully — it is a *per charger* fee to the association,
so a 30-connector building pays roughly 102.300 kr/month. **The set is not
uniform**, and the accurate statement is narrower than "nobody charges the
building": **three of five bill the resident rather than the association, and
the two cheapest options for a húsfélag charge it nothing recurring at all.**

Straumvakt's line is **200 kr/connector/month + 50 kr/driver** to the building's
org. In the MDU shape the product is built for — 30 connectors, 30 enrolled
residents — that is **7.500 kr/month**, or 250 kr per apartment. (The 6.100 kr
figure that appears in the billing packets is the *pilot* case with 2 drivers,
not an MDU.)

So the honest comparison is: **250 kr per apartment per month for software
only**, against 2.490–4.400 kr per resident for software **plus hardware,
installation, operation and support** — or against Hleðsluvaktin, which asks the
association for nothing recurring.

**This is a positioning gap, not a code gap, and it is the most consequential
thing in this document.** On price per apartment the number is not the problem —
it is that every incumbent is selling a bundle and Straumvakt is selling a
layer, to a buyer (a volunteer housing-association board) who is shopping for
the bundle. The flat fee is defensible as *the first invoice*: it needs no
attribution, which is exactly why it ships first. It is harder to defend as
*the product*.

The one visible seam: HS Orka advertises that it can connect to a building's
existing housing-management platform. And nobody in the set produces the
board-facing artefact — see §4.4.

---

## 3. The Zaptec question, which turns out to be a fork in the product

Andri did not answer it, and the audit suggests it is the highest-leverage open
decision on this list.

### 3.1 What we actually run today

Not one integration — **five ingestion paths, three of which write.** OAuth
password grant against `api.zaptec.com` (`zaptec.ts:16-43`), a
one-minute Cloudflare cron re-walking a rolling **26-hour** window
(`zaptec-sync-cron.ts:35`), a Fly.io AMQP consumer (parked), and a webhook
receiver (disabled in production after a P1 lockout).

### 3.2 Zaptec offers two OCPP modes and they are different products

| | **OCPP Cloud** (what we run) | **Box-level OCPP 1.6J** |
|---|---|---|
| Zaptec's phase + load balancing | **kept** — this is the stated point of the mode | **lost** — "does not support Zaptec's proprietary and more advanced phase and load balancing features" |
| OCPP Smart Charging profiles | **not supported at all** | full — TxProfile, stack levels, per-connector limits |
| Zaptec cloud driver auth | bypassed for charging operations | bypassed |
| Zaptec's own caveat | *"has not been designed or implemented to be a full-fledged OCPP 1.6J solution… mainly aimed at external payment operators"* | — |

**A hardware constraint that may settle it — but the evidence is thinner than
an earlier draft of this document claimed.** Zaptec's compliance FAQ gates
box-level OCPP at **Zaptec Pro serial ZPR080000 and up** (plus ZPG), from
**firmware 7.5.3.0**.

**The Dalvegur fleet's serials are not recorded anywhere in this repository.**
The only Zaptec Pro serials in the tree are `ZPR074002` — the single Reykjavík
HQ bench unit, listed *separately* from the 30 Dalvegur stations in the
2026-05-31 integrity audit — and `zpr042727`, from a 2020-era ADR test. An
earlier draft generalised those two into "the fleet is ZPR042xxx/ZPR074xxx" and
concluded the estate cannot move. **That conclusion is withdrawn as unfounded.**

What is true: the importer stores `serialNo` only in its response and
deliberately does not persist it as identity, so the fleet's serials live in the
Zaptec portal and in `charging_stations.serial_number` (written later by the
session sync), not in source. Get them before deciding anything about box-level
OCPP.

### 3.3 What the estate actually looks like, and an unexplained gap

30 connectors at Dalvegur (30 stations × 1 EVSE × 1 connector — the importer
hardcodes one of each). **21** identities were recorded as watched — i.e. not
still `provisioned`, a proxy for "has ever spoken OCPP" — in one observation
(`ocpp-silence-watch.ts:60`, `:117`). **The ~9-station gap is not explained anywhere
in the repo.** Candidates: Zaptec-side `Active=false` rows (a field the importer
reads and then drops), decommissioned units, or chargers that never
reconnected. `apps/api/scripts/probe-dalvegur-charger-counts.ts` would settle it
against the live database.

### 3.4 What we don't consume that Zaptec offers

- **`sendCommand`** — RestartCharger, StopChargingFinal, ResumeCharging,
  UnlockConnector, UpgradeFirmware. Implemented **only** in
  `tools/zaptec-test/`, a scratch app. Zero references in `apps/api`.
- **`/api/session/{id}/priority`** — the one genuine load-influence lever
  Zaptec exposes over REST. Never called.
- **Installation-level `AvailableCurrent`** — sets site headroom and
  immediately triggers Zaptec's rebalancing. Never called. This is the correct
  energy lever for a Zaptec estate and it is one API call.
- **`/api/chargerFirmware/installation/{id}`** — fleet firmware status.
- **A documented ceiling nobody has noticed:** Zaptec allows a **maximum of two
  Service Bus subscriptions per installation simultaneously**. That is a hard
  multi-tenancy limit and appears nowhere in the repo.
- **Rate limits.** Zaptec's published general tier is **10 requests/second per
  account** (burst 15), 1/sec on the token endpoint. Independently, the repo's
  own note names per-charger `/state` polling as the **#1 scaling constraint at
  ~200 chargers** — which is a cadence problem of our own making, not a
  Zaptec-imposed cap.

### 3.5 A live kill switch worth knowing about

On 2026-08-06 the operator disabled OCPP cloud in the Zaptec portal and
**seventeen chargers dropped inside a 53-second window**
(`ocpp-silence-watch.ts:44-52`). The portal remains the control point; the CPMS
is a tenant of it. Not documented by Zaptec anywhere — observed.

---

## 4. The product gaps, ranked by whether they block a paying MDU customer

### Tier 0 — already known, blocks the first invoice

On the round-3 list and in the decision brief: migration `0004` (the invoice
sequence store), the agreement write surface, the active-driver decision, and
`0002`/`0003` unapplied.

**One addition worth having on that list:** `loadFlatFeeRates` in the Drizzle
adapter **returns `[]` unconditionally** (`drizzle-operations-port.ts:230-235`),
so every real period holds with three × `no_rate_at_period_start` independent of
everything else. This is a *deliberate, documented* stub, not a discovery — the
lines above it say an empty list is "the correct behaviour for an org whose
agreement has not been set up." But it is a fourth stop between here and a real
invoice, and it disappears only when the agreement write surface exists.

### Tier 1 — blocks being an MDU product at all

**4.1 · The apartment can be named and cannot be billed.**

> **Corrected by Andri, 2026-08-19, and the correction matters.** The apartment
> is not the billable party — **the dweller is**, and he identifies himself.
> The MDU org holds the electricity meter and pays the utility; Straumvakt's
> intent is to bill the dwellers **on behalf of** the org. That is FOCUS rule
> 3's host↔driver line, agent posture, `Straumvakt f.h. <host>` — already
> canon, already built at the document layer, and marked *"deferred — needs
> attribution."*
>
> So the gap is **driver attribution**, not an apartment abstraction. Read the
> section below as: the resolution machinery exists and is unwired, and the
> unit-shaped parts of it are optional rather than load-bearing. The
> load-bearing part is §4.10 — on Zaptec-native auth the dweller **cannot
> identify himself to us at all**, which makes the intended product impossible
> in that mode. That is the finding; the apartment framing was mine and it was
> over-engineered.

`BillObject` exists with `kind: apartment | unit | stall | company | department
| cost_center | other`, owner, status and parent (`commercial.prisma:592-650`) —
note it is deliberately dual-purpose, so the workplace lane needs it too. Seven
breaks between it and an invoice:

1. `ChargeSession` has no `billObjectId` (`charging.prisma:13-28`).
2. `SessionLedger` denormalises driver, site and station — and no unit
   (`commercial.prisma:297-310`).
3. `BillingLine.costCenterId` is `NOT NULL` and points at the *legacy*
   cost-center generation (`:272`).
4. `grep billObject packages/commercial/src` → **zero hits.** The harvested
   money engine has never heard of it.
5. The invoice cannot address it. `PartyRef` is `org | user | platform`
   (`lines.ts:34-37`); `StatementRecipientKind` is `driver | organisation`
   (`statement.ts:45`). An apartment is not a legal person and
   `PartyIdentity.registeredId` is required, so the document layer would reject
   it. Billing "4B" means billing whoever `BillObjectMember` says lives there —
   and that join is the thing not implemented.
6. Onboarding deliberately skips it. `driver.ts:982-985`: *"BILLING
   (BillObjectMember, ADR 0029) is NOT written here… the driver lands in the
   host's 'Unattributed' bill-object."* **That 'Unattributed' bill-object is not
   created by any code.** So every driver onboarded today has no billing home
   at all, not a default one.
7. It is parented to `Installation` — the entity the target-domain note says
   should dissolve, with the MDU billing unit moving to `Property`. That
   dissolution is parked.

**One smaller defect found on the way:** there is **no unit identifier, only a
free-text label** (`BillObject.label String`). No fastanúmer or matsnúmer, and
`Property.address` is untyped JSON — so a húsfélag's own unit register cannot be
reconciled against this, and "4B" typed twice is two apartments.

*(An earlier draft of this document claimed the owner-exclusivity CHECK
constraint was missing. It is not — `bill_objects_owner_at_most_one` is in
`prisma/migrations/20260604191203_going_public_foundation/migration.sql:127-129`
and the repository resolves user-first, not org-first. Withdrawn.)*

**Why this will not fix itself:** rule 1's "touch it, convert it" only converts
files the two live workstreams touch, and neither touches the bill-object path.
It has to be scheduled.

**4.2 · No move-out.**

`DriverGroupMembership` is `id, driverGroupId, userId, addedAt` with a unique on
`(driverGroupId, userId)` (`commercial.prisma:566-591`). Removal is a hard
delete (`driver-group-memberships.ts:118-120`). The unique constraint **forbids
the closed-row-plus-new-row shape history needs**, so soft delete is not even
available without a migration.

Blast radius: access enforcement reads presence, not validity
(`ocpp-authorize.ts:291-307`) — an ex-resident's row is current forever. Five
other consumers have the same shape. And the correct pattern exists ten lines
away: the org-level `Membership` has `status`, `invitedAt`, `acceptedAt`,
`suspendedAt`, `revokedAt`. The membership that governs whether a resident can
charge has none of it.

*Mitigating:* enforcement is off by default (`enforceAuthorize` defaults false,
shadow mode always replies Accepted), so today deleting a moved-out resident
does not stop them charging either way.

**4.3 · A building admin can do essentially nothing.**

`BUILT_SECTIONS = {overview, profile}` (`org-tenant.ts:204-207`). Chargers,
drivers, invite, sessions and agreements all render as "soon" placeholders.
Their permission bundle *would* allow inviting a resident — the API route
exists — and there is no UI for it. They cannot start, stop, reconfigure,
restart or attach a charger.

**The one working self-service loop in the product is the resident's, not the
manager's.** A resident can start, stop and inspect their own charge from the
Flutter app without touching a human. Their building's manager cannot.

**4.4 · No board-facing statement — and this is white space in the whole
market.**

Zaptec Portal produces a report it explicitly calls an *invoicing basis, not a
bill*. Eways gives operator statistics. Monta gives dashboards and site-host
sub-accounts. **Nothing found in the competitive set produces what an Icelandic
húsfélag treasurer actually needs**: a per-unit statement reconciling the
building's single meter against the sum of deduction-meter readings, with the
shared-cost split under 33.gr.d, in a form that survives an aðalfundur.

Straumvakt's statement generator stops at `driver | organisation` and the
`org/[slug]` page shows whole-building month and lifetime totals only.

**4.5 · The resident cannot see what they owe.**

The Flutter app has 11 screens and **none of them is money** — no cost screen,
no session history, no invoice. The archived web portal had `driver/cost/` and
`driver/history/`; the relaunch moved driver UI to mobile, where those screens
were never built. Every incumbent ships a resident app showing consumption and
cost.

### Tier 2 — blocks operating it safely

**4.6 · Nothing tells anyone when a charger dies.**

- `liveness-sweeper.ts` — 266 lines of complete, correct, latched, site-grouped
  logic with **31 tests and zero callers outside its own test file.**
- `checkOcppSilence` runs every minute and its entire output is a
  `console.error` / `console.warn` into Cloudflare Workers Logs — no logpush, no
  tail consumer, no alert. It also has **no latch**, so one dead charger
  produces ~1.440 log lines a day.
- `gateway/src/metrics.ts` has **no production importer** — only a test-harness
  loader — and the Analytics Engine binding is commented out.
- Sentry: *"No Sentry SDK is imported. The dependency is not present in this
  tree."* No `@sentry/*` in any `package.json`.
- Resend is wired and authenticated. It has **eight** templates — invite,
  verify, password reset, and five around access requests and host
  applications. **None is operational.**

This already cost three months: 13 May – 4 Aug 2026 the whole 20-charger
Dalvegur fleet was off the OCPP gateway and it was found by a human reading a
warning in *Zaptec's* portal.

**4.7 · Reset and unlock exist and cannot be reached.**

Both are mapped in the action table (`dispatch-targets.ts:72-73`) and **no route
enqueues either**. A stuck cable at a building 40 km away is a van.
And **no server-side command can reach a Zaptec-native charger** — the dispatch
registry has exactly one target, the OCPP service binding. (The Flutter app does
have a working BLE reboot path, verified end to end — but that requires someone
standing at the charger, which is the opposite of remote intervention.)

**4.8 · The next web deploy removes support's toolkit.**

Commit `5f810a9` archived the entire operator console — 201 files, pure moves.
The live app is 8 pages. The replacement staff overview is **read-only**: no
charger detail, no session detail, no commands. Today's console (running from
the `staging` branch) still has the good diagnostic surface — connector status
pills with a source tag distinguishing `ocpp` / `vendor` / `none`. As the
branches stand, deploying them takes that away.

**4.9 · Charger identity across orgs** — already on the decision list as D9.
The ops audit ranks it above the missing sweeper: *"a charger's energy is
invoiced to the wrong org and nothing reports it at all."*

### Tier 3 — evidence, and two live bugs

**4.10 · Per-kWh resident billing is not possible today and would not be
defensible.**

The kWh is one unsigned JSON scalar: `const energyKwh = z.Energy ?? 0`
(`zaptec-session-sync.ts:235`). OCMF is parsed for its envelope and **the
signature half is split off and discarded unparsed** (`ocmf.ts:85-88`) — there
is no `crypto.subtle.verify`, no key material, no signature check anywhere in
the tree. The OCMF-derived energy *is* computed and stored, and its only
consumer renders it in an operator UI. **Nothing on the money path reads it and
nothing reconciles it against `z.Energy`.**

Meanwhile `enrichment-drift.ts:8` asserts *"The CDR is canonical for billing
(vendor-signed OCMF)"* — a claim the code does not earn.

On a Zaptec-native estate: no meter start/stop pair, no connector, no driver
(Zaptec strips user data on native auth — every CDR resolves `no_candidates`),
no second source, no verified signature. A resident asking *"prove it was me, at
my connector, for that many kWh"* gets three "we cannot say" answers. ADR 0049
says it itself: *"In a dispute only the second counts."*

**A landmine while we are here:** `charging.imported_cdr_refs` is `ON DELETE
CASCADE` from `charging.sessions`. **Deleting a session destroys the only signed
record of it.**

**4.11 · Two live bugs the audits found that are on no list.**

- **`z.Energy ?? 0`** (`zaptec-session-sync.ts:235`, and again in the webhook
  path at `webhooks/zaptec.ts:270`). A CDR with no `Energy` field prices the
  session at 0 kWh / 0 ISK and writes `energy_wh = 0` rather than null; on the
  synthesise branch it also marks `enrichmentStatus: "complete"` (`:385`). This
  is **precisely** the defect `meter-energy.ts:145-147` was written to prevent —
  on the one path that actually runs.
- **The webhook receiver never checks that the driver belongs to the charger's
  org.** `webhooks/zaptec.ts:493-503` does `idToken.findFirst({ where: { value:
  cardId, status: "active" } })` and writes the result straight to
  `session_ledger.driver_user_id`. The hardened resolver
  (`cdr-driver-resolution.ts:137-202`) requires unanimous candidate resolution,
  a usable token **and org membership at the charger's org**, with five named
  refusal reasons. The webhook path got none of it.

  **Be precise about what this is, because the codebase itself corrects the
  obvious reading.** It is *not* a token collision across tenants:
  `identity.id_tokens.value` is globally unique and the table has no `org_id`
  column at all, so two orgs cannot hold the same value and there is no
  org-scoped lookup to write (`cdr-driver-resolution.ts:22-28`). The reachable
  failure is the other one — a token that resolves to a real person who has **no
  relationship with the host whose charger they used**, and whose energy is then
  attributed to them anyway. The route is mounted (`index.ts:280`) and gated on
  a secret (`:71-73`); whether that secret is set in the live environment was
  not checked.

**4.12 · A trap that will fire the day `0002` is applied.**

`deriveActiveDrivers` — the documented refusal at the centre of the
active-driver decision — has **no non-test importer**. Both real ports route
`driverCount` through `countFromRows`, which returns
`measured(n, "activity_month_table")`. So once `0002` is applied and a period is
sealed, **a live period will produce a measured driver count that is silently
the charging-only lower bound**, labelled with a *source* rather than a
*definition*, and the refusal everyone is waiting to answer will never fire.
The dry run's own header says every real period holds; that is true of the
fixture only.

Sized by the packet at up to **~15,4 % of an MDU bill**.

### Tier 4 — unanswered external questions

**4.13 · Is recharging residents per kWh `raforkuviðskipti`?** `Raforkulög`
65/2003 Art. 18 requires a **ministerial licence** to conduct electricity
trading, with **no de minimis threshold and no express exemption** for onward
sale within a property. No Orkustofnun / Umhverfis- og orkustofnun guidance
exists. `Reglugerð 1061/2008`'s frádráttarmælir regime strongly implies Iceland
regulates this as *metrology* rather than *trading* — and Norway's NVE exempted
charging services from the trading licence outright in 2019 — but no Icelandic
primary source settles it. **One written query to UOS.**

**4.14 · VSK treatment** of a húsfélag billing members for charging. In Sweden
the equivalent triggers mandatory VAT registration. Not established for Iceland.

---

## 5. Load management — the gap that is not a gap

The MDU audit flags it as the largest silent hole: absent from `FOCUS.md`,
`TASKS.md`, both workstreams and the parked table. `SetChargingProfile` appears
four times in the tree — twice in the `zaptec-test` scratch app, once in a
reference table, once in a vendor info file — and **not once as an
implementation**. `Circuit.ampereCeiling` has an operator write path
(`circuits.ts:96`) but is otherwise read only for display; nothing allocates
against it.

**And the correct answer is still to leave it with Zaptec.** Three reasons:

1. Veitur, the DSO, treats it as necessary — and sizes a *managed* apartment
   connection at **33 to 156 vehicles** depending on main breaker. Zaptec's
   balancer already does this for the estate.
2. Taking it means box-level OCPP, which **loses** Zaptec's phase and load
   balancing — a real capability on a Pro estate with mixed 1- and 3-phase
   vehicles — and the Dalvegur serials may not even be eligible.
3. Under OCPP Cloud, Smart Charging profiles are **not supported at all**. There
   is no half-measure available.

**But the honest version has two parts.** The lever we *should* hold and don't
is installation-level **`AvailableCurrent`** via the Zaptec API — enough for
site headroom, DSO capacity limits and spot-price throttling, and it is one
call. And the decision should be *written down*, because right now the absence
of load-management code reads as an oversight rather than a choice.

---

## 6. What I would do about it

Not a plan — a suggested order, for you to overrule.

**Immediately, and cheap:**

1. **Put MDU in `FOCUS.md`.** The market focus is not in active canon, so no
   agent prompt inherits it and every gap in this document was invisible to the
   round system. This is the highest leverage line of text available.
2. **Fix `z.Energy ?? 0`** and **the webhook's unscoped driver lookup**. Two
   small changes; one prevents silent zero-billing, the other closes a
   cross-tenant attribution hole that was already fixed once, elsewhere.
3. **Wire `liveness-sweeper.ts` into the API cron and give it one Resend
   template.** The logic is written and tested; Resend is authenticated. This
   converts detection from theoretical to real in hours, and it is the single
   change that most reduces future support load.

**The decision I would put in front of you next:**

4. **The Zaptec fork.** OCPP Cloud (keep Zaptec's balancing, no smart charging,
   works on the current serials) versus box-level (standards-based control,
   lose the balancing, may need newer hardware). Today the product is *in* OCPP
   Cloud without having chosen it, and 9 of 30 Dalvegur stations have never
   spoken to us at all.
5. **The pricing posture.** Whether the product bills the building a platform
   fee or bills the resident, given five incumbents who bill the resident and
   charge the building nothing recurring.

**The build that follows from the market focus:**

6. **Wire the `BillObject` spine end to end** — session → ledger → priced line
   → statement — and add a unit recipient kind to the invoice. This is the
   apartment product, and it is a scheduled piece of work, not a by-product.
7. **Give `DriverGroupMembership` a status and a `removedAt`**, and drop the
   unique that forbids history.
8. **The board-facing statement.** Genuine white space in the whole competitive
   set, and it is the artefact that maps onto the 33.gr.d cost allocation the
   law already requires.

**Two questions for other people:**

9. **Umhverfis- og orkustofnun** — is per-kWh recharging of residents
   `raforkuviðskipti` under `Raforkulög` Art. 18? Worth pairing with the VSK
   question to an accountant.
10. **Zaptec** — confirm Pro units below serial ZPR080000 cannot move to
    box-level OCPP 1.6J, and ask why StateId 723 (CompletedSession + OCMF) has
    never delivered a single message in three months.

---

## 7. What was not established

- **No environment was queried.** Every figure is from recorded evidence dated
  2026-05-31 to 2026-08-19.
- **The 9-station gap** at Dalvegur — 30 connectors, 21 that have ever spoken
  OCPP. `probe-dalvegur-charger-counts.ts` would settle it.
- **Whether Dalvegur is currently `AuthenticationType` 0, 1, 2 or 3.** Not
  determinable from source. It decides which of §4.11's two bugs is in the live
  chain.
- **Whether `bill_objects` has ever been populated** in production.
- **Whether the Fly AMQP consumer is currently running.**
- **Whether the live webhook secret is set**, which decides whether §4.11's
  second bug is in the live chain.
- **Whether older Zaptec Pro serials can move to box-level OCPP** — the serial
  floor is documented; whether it is absolute is not.
- **The Art. 18 licence question and the VSK treatment** — both need a human
  with a professional qualification, not more searching. *This document reads
  primary sources carefully; it is not legal or tax advice.*
- **DEFA CloudCharge, Virta, Charge Amps and Easee** MDU feature sets could not
  be established from primary sources in this pass.
