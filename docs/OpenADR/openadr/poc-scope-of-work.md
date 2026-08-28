# Scope of Work — Proof-of-Concept VTN
## RARIK Business Logic access · Driivz VEN

**Version:** 0.2
**Date:** 2026-08-05
**Target completion:** 2026-09-01
**Audience:** Internal. This is our working scope — it is not issued to RARIK
or Driivz.

> **What RARIK actually receives is the access pack** (D4): UI login, base URL,
> clientID, clientSecret, scope list and worked examples, delivered through
> straumvakt.org. They do not review this document.
>
> Driivz receives the equivalent VEN pack (D5).

---

## 1. Objective

**One charging station, in Vík. RARIK sends an event. Driivz receives it. We
measure that it took effect.**

That is the whole of phase 0. Everything else is deferred.

### The asset

| | |
|---|---|
| **Grid connection** | 630 A — ≈ **436 kW** at 400 V three-phase |
| **Installed today** | Kempower Station Charger, 4 × C500 50 kW modules ≈ **200 kW** pooled, 3 × CCS2, dynamic distribution across the stack |
| **Expansion target** | **400 kW** charging power |

### Why this site is the argument, not just a convenient test

At 400 kW of charging against a 436 kW connection, full simultaneous draw sits
at roughly **92% of the connection**. That is feasible only if the site can be
*guaranteed* never to exceed it — which is exactly what a dynamic envelope
provides and a static contract cannot.

And 630 A is the threshold at which, per the practitioner account in the
technical report §2.1, RARIK applies a return-on-investment assessment against
a binding lease and a 24-hour utilisation forecast. This site has already been
through that machinery.

So the proposition to RARIK is not *"constrain us today."* There is no
constraint today — 200 kW installed against 436 kW available is enormous
headroom, and no envelope will bind. It is:

> **"When we double the charging power, grant it dynamically instead of
> requiring a connection upgrade. Here is proof the control works."**

That reframes the proof from a technical curiosity into the evidence base for
the next connection decision at this specific site — with a quantifiable
alternative (the avoided *kerfisframlag* and reinforcement on a >630 A
upgrade) rather than a hypothetical one.

### Why the hardware suits the test

- **DC, rated in kW** — matches `IMPORT_CAPACITY_LIMIT` units directly. No
  amps-to-kW conversion, no phase arithmetic.
- **Pooled modules with dynamic allocation** — "your ceiling is now X kW" is
  precisely what the station's power management already does. We exercise a
  designed behaviour rather than forcing one.
- **One OCPP identity, one Driivz resource** — three connectors behind a
  single station, so `Main input circuit resource ID` still maps to one thing.
- **200 kW is a visible number.** A limit that bites produces an unambiguous
  drop, not a measurement argument.

This is a good test subject:

- **DC, and rated in kW** — matches `IMPORT_CAPACITY_LIMIT` units directly, no
  amps-to-kW conversion and no phase arithmetic.
- **Pooled modules with dynamic allocation** — "your ceiling is now X kW" is
  precisely the operation the station's power management already performs. We
  are exercising a designed behaviour, not forcing one.
- **One OCPP identity, one Driivz resource** — three connectors sit behind a
  single station, so `Main input circuit resource ID` still maps to one thing.
  No aggregation problem.
- **200 kW is a visible number.** A limit that bites produces an unambiguous
  drop, not a measurement argument.

### The confound that decides the test

**A station limit is only observable if it sits below what the vehicles are
actually drawing.**

A car that negotiates 50 kW is unaffected by dropping the station from 200 kW
to 150 kW — nothing changes, and the test proves nothing. Vehicle-side limits,
state of charge and battery temperature all cap draw well below station
capability most of the time.

**Therefore: the limit is set relative to measured draw at the moment of the
test, not to a number fixed in advance.** Read current station power, then
issue an envelope meaningfully below it. That single decision is the
difference between a conclusive test and an inconclusive one.

### What this proves

- A DSO can issue a power limit through a standard interface and have it reach
  a charger it does not operate
- The limit takes physical effect, verifiably
- The chain RARIK → VTN → Driivz → charger works end to end

### What it deliberately does not cover

| Deferred to | What |
|---|---|
| **Phase 0.5** | Fail-safe behaviour on loss of communications — see §12 |
| Later | Envelope revision under load, multi-charger sites, aggregation |
| Later | Avoided capex, tariff or settlement consequences |
| Later | TSO/DSO primacy, export envelopes, V2G |

### Measurement

Three levels of evidence, in increasing strength:

| Level | Evidence | Strength |
|---|---|---|
| 1 | Driivz confirms receipt in their logs or portal | Delivery only. Not sufficient. |
| 2 | Driivz shows the site limit applied — SmartChain grid circuit turns orange | The limit was accepted and is in force |
| 3 | Station power drops, per the charger's own MeterValues | Proves control, self-reported |
| 4 | **Power drop measured by an independent instrument at the connection** | **Proves control, independently.** |

**Planned: a power-quality logger at the connection**, installed primarily for
THD characterisation ahead of the 400 kW expansion. That gives level 4 — the
device under test is not the source of the evidence, which is the difference
between a vendor demonstration and a measurement a DSO can rely on.

> ### ⚠ A voltage logger alone cannot prove this
>
> **Power requires current.** A voltage-only THD logger will show harmonics and
> voltage variation but *not* kW. At 200 kW on a 436 kW connection the voltage
> effect of a limit change is small and confounded by everything else on the
> feeder — it is not evidence.
>
> The instrument must log **current as well as voltage**. At 630 A that means
> **Rogowski / flexible CTs**, not clamp-on jaws. Confirm this before ordering
> or scheduling installation; it is the single point where the measurement
> plan either works or silently doesn't.

### Instrument specification

**Fluke, and specifically Class A.**

| Requirement | Why |
|---|---|
| **Class A per IEC 61000-4-30 Ed.3** — Fluke 1770 series (1773 / 1775 / 1777) | A DSO recognises Class A as *the* compliance standard for power quality measurement. Class A data is measured to the method RARIK's own engineers use — not "our logger said so." The 173x energy loggers measure power but are not Class A. |
| **iFlex flexible current probes** (Rogowski), 1500 A range | 630 A conductors are too large for clamp-on jaws. iFlex wraps. Without current there is no kW — see above. |
| **≤1 s trend logging** | The station ramps rather than steps. Class A 10-cycle (200 ms) aggregation is more than sufficient; a 1-minute average would smear the transition into uselessness. |
| **Time synchronised — GPS if the model supports it** | The evidence chain is *VTN event timestamp → Driivz applied → measured drop*. Drift turns the strongest part of the proof into a timestamp argument. If no GPS, sync to PC immediately before installation and record the offset. |
| **CSV export** via Energy Analyze Plus | The results report needs the trace, not a screenshot. |

Installation at 630 A needs a qualified electrician and safe access — schedule
it as lead time, not as a same-week task.

### Run it as a campaign, not a snapshot

Start logging **days before** the first envelope is issued and continue after.
That gives:

- A **baseline** — normal load shape and harmonic signature at 200 kW, which
  is what the 400 kW expansion case will be argued against
- The envelope test as a **marked interval inside a continuous record**, rather
  than an isolated capture that invites questions about what else was happening
- Before / during / after harmonic comparison in one dataset

Since the logger is being installed for THD characterisation regardless, the
proof costs nothing extra — it becomes one annotated window in a study that
was already going to happen.

### A second deliverable, free

Logging THD across a commanded power transition characterises how the Kempower
stack's harmonic signature behaves as it reduces output. Power quality on a
rural feeder is one of a DSO's genuine concerns about DC fast charging, and it
is the concern that will be raised about the 400 kW expansion.

Offering RARIK harmonic data alongside the envelope proof answers a question
they have not yet asked, using an instrument that is being installed anyway.
Worth capturing deliberately rather than as a by-product.

---

## 2. Architecture and roles

```
  RARIK  ──── Business Logic client ────►  VTN  ────►  VEN  ────►  site
  (defines and owns every envelope)     (hosted)     (Driivz)   (chargers)
                                                                     │
                                                          boundary meter
                                                                     │
  RARIK  ◄──────────── measured response ────────────────────────────┘
```

| Role | Party | Responsibility |
|---|---|---|
| **Business Logic (BL)** | RARIK | Decides envelope values. Creates programs and events. Reads reports. **Retains full authority over every limit issued.** |
| **VTN** | Straumvakt (transitional) | Hosts the OpenADR 3.1.0 resource server. Stores objects, enforces scopes, notifies subscribers. Makes no decisions. |
| **VEN** | Driivz | Consumes events, applies the site limit, returns reports. |
| **Site** | N1 | The Vík charger, its connection, and access for measurement. |

**RARIK hosts nothing.** Business Logic is a *client* of the VTN in the
OpenADR object model; separate hosting is an explicitly valid deployment. This
removes procurement, hosting and infrastructure security review from RARIK's
critical path while leaving envelope authority entirely with them.

The VTN is transitional. Production ownership belongs with the DSO — see §12.

---

## 3. Protocol baseline and the open dependency

**Baseline: OpenADR 3.1.0** (current Final Specification; not backwards
compatible with 3.0.1).

> ### Finding — Driivz is 2.0b, not 3.0
>
> Driivz has stated in writing that they support OpenADR 3.0. Their own
> published documentation indicates **2.0b** — `Ei-Event`, `SignalName` /
> `SignalType`, `LOAD_DISPATCH ; setpoint`, `x-` prefixed extensions,
> pre-shared `venId`, and no client credential configuration. See
> [`vendors/driivz.md`](./vendors/driivz.md).
>
> A validated sample payload has been requested. It confirms which adapter to
> route them to; it does not gate the build.

**Both stacks are being built.** The VTN is a single envelope service with two
protocol adapters — OpenADR 3.1.0 and OpenADR 2.0b — over one canonical
internal model. See [`build-scope-dual-stack.md`](./build-scope-dual-stack.md).

Driivz connects on whichever version it actually speaks.

| Path | Condition | Consequence |
|---|---|---|
| **A — 3.1.0 end to end** | Driivz is genuinely 3.x | Baseline scope as written. |
| **B — Dual stack** | Driivz is 2.0b *(expected)* | VTN serves 3.1.0 northbound to RARIK, 2.0b southbound to Driivz. No schedule impact — the adapter is in scope from the start. |
| **C — Bypass** | 2.0b adapter cannot be validated in time | Drive the Driivz **SmartChain site limit via their API**, skipping their OpenADR layer entirely. |

> **Path C is narrower than it looks.** The "run on chargers we operate"
> variant is **not currently available** — the Straumvakt CPMS has no
> site-limit endpoint and no `SetChargingProfile` support (the dispatcher's
> action map is `remote_start` / `remote_stop` only). That would need CPMS work
> first, tracked separately. Today, Path C means the Driivz site-limit API and
> nothing else — and it depends on that API existing, which is still unconfirmed.

**Under every path the north side is OpenADR 3.1.0.** The DSO-facing interface
must not be set to a legacy standard because of one supplier's implementation
age.

Driivz's two accepted signals — `x-gridConnectionLimitMax` and
`LOAD_DISPATCH ; setpoint` — are both **absolute** primitives, not deltas from
a baseline. Their protocol generation is legacy; the semantics are correct for
a dynamic operating envelope.

---

## 4. Deliverables

| # | Deliverable | Owner |
|---|---|---|
| D1 | VTN service implementing the 3.1.0 subset in §5, containerised, deployed with TLS on a stable URL | Straumvakt |
| D2 | OAuth 2.0 client-credentials issuance; `/auth/server` and `/auth/token` | Straumvakt |
| D3 | **Operator UI on straumvakt.org** — create/edit program, issue an envelope event, list events, view reports. Thin client over the VTN's own API using RARIK's BL credentials | Straumvakt |
| D4 | RARIK BL access pack — UI login, base URL, clientID/clientSecret, scope list, worked `curl` examples | Straumvakt |
| D5 | Driivz VEN pack — VTN URL, credentials, Vík resource ID mapping | Straumvakt |
| D6 | Class A PQ logger installed at the 630 A connection, logging continuously from before the test | N1 (procurement, electrician) |
| D6b | Measurement trace exported and reconciled against event IDs | Straumvakt |
| D7 | Test execution against §7, witnessed | All parties |
| D8 | Results report — measured against acceptance criteria, including failures | Straumvakt |
| D9 | Handover pack — Dockerfile, config reference, what a RARIK-hosted VTN would require | Straumvakt |

---

## 4a. What RARIK gets access to

| Thing | Form | Restriction |
|---|---|---|
| **VTN API** | `clientID` / `clientSecret`, OAuth2 client credentials | Scoped to `read_all`, `write_programs`, `write_events`. Cannot write reports or impersonate the VEN. |
| **Operator UI** | Web, on straumvakt.org | Thin client over the same API with the same credentials. No separate account system, no extra permissions. |
| **Hosting** | Container, see below | Read access to logs and metrics if wanted |
| **Source** | Dedicated VTN repository | Read-only collaborator, or write-by-pull-request. **Not** a branch of the Straumvakt repo — see §4b. |

### Why the UI matters

A DSO engineer will not POST JSON to create an envelope. The UI is what makes
this usable by RARIK rather than by us on RARIK's behalf, and it is the
difference between a demo we run and a system they operate. It should be thin
— a client over the VTN's own API, using RARIK's BL credentials, with no
separate auth stack behind it.

---

## 4b. Repository access — and the constraint

**Git has no branch-scoped read access.** A token that can pull one branch can
pull every branch and the entire history. Branch protection governs *push*,
not *read*; GitHub, GitLab and the rest are all the same in this respect.

A "VTN branch" of the Straumvakt repository would therefore expose the CPMS,
billing, agreements, driver data models and every historical commit to
whoever holds the token.

**Consequence: the VTN lives in its own repository.** It has no dependency on
Straumvakt's domain model — OpenADR upward, vendor APIs downward — so this
costs nothing and makes RARIK access trivially safe: the repo contains only
VTN code.

Restriction options, in increasing order of openness:

1. **Read-only collaborator** — they can pull, inspect and build. Sufficient
   if the goal is transparency.
2. **Fork + pull request** — they contribute, we merge. Contributions are
   reviewable and their provenance is explicit.
3. **Direct push** — only with a decision on how contributions are licensed.
   A state utility's engineers committing into a privately-owned repository
   raises an ownership question worth answering before it arises.

Recommend (1) for the proof, (2) if they want to contribute.

### Isolation requirement — mandatory

**RARIK developers must have access to VTN project files only. No Straumvakt
platform code, data, credentials or history, under any circumstance.**

A separate repository is necessary but not sufficient. Five conditions, all
required:

| # | Condition | Why |
|---|---|---|
| 1 | **Fresh `git init`.** Never fork, clone or `filter-branch` from the Straumvakt repo. | History travels with a clone. A filtered history can still be recovered from packfiles and reflogs. |
| 2 | **Its own database.** A separate Neon *project*, not a branch of the Straumvakt project. | A connection string reaching the Straumvakt database exposes all 98 models regardless of which schema the service uses. |
| 3 | **No shared packages.** No `@straumvakt/*` imports, no submodules, no private-registry dependencies. | Any of these require registry or repo credentials to build, which defeats the isolation. |
| 4 | **No secrets in the repo.** `.env.example` only. Real values in Fly secrets and CI secrets. | Config files are the most common accidental disclosure. |
| 5 | **Own deployment target.** Its own Fly app, its own credentials, not sharing a Cloudflare account or project. | Platform access is transitive access. |

### Pre-access check

Before granting any RARIK account access, grep the repository for: internal
hostnames, Neon connection strings, `straumvakt` outside of branding,
references to CPMS models or tables, and any credential-shaped string. Then
confirm `git log --all` shows only VTN commits.

The service has no dependency on Straumvakt's domain model — OpenADR upward,
vendor APIs downward — so all five conditions are free. They only become
expensive if the separation is compromised early and has to be unpicked later.

---

## 4c. Hosting — Workers or Fly

| | Cloudflare Workers | Fly.io |
|---|---|---|
| Cost | ~$0 marginal | ~$5–15/mo |
| Deploy speed | Fastest; matches existing patterns | Container build |
| **Handover to RARIK** | Cloudflare-specific. Hard to hand over. | **A Dockerfile. Runs anywhere, including RARIK's own infrastructure.** |
| Long-running processes | No | Yes |
| MQTT broker, if ever needed | Impossible | Possible |

**Recommendation: Fly.** The deciding factor is §12 phase 4 — the VTN is
explicitly transitional and ownership transfers to RARIK. A container they can
run themselves makes that a real promise rather than a stated intention, and
it removes any suggestion of lock-in to infrastructure we control. The cost
difference is trivial and the portability is the whole point.

The UI can stay on straumvakt.org regardless; it is a client, not the server.

---

## 5. Interface specification

### Objects (Path A)

**Program** — created once by RARIK BL.

```
programName:  IS-RARIK-DYNAMIC-CAPACITY-POC
attributes:   COUNTRY = IS
              PROGRAM_LONG_NAME = "RARIK dynamic capacity proof of concept"
              BINDING_EVENTS = true
payloadDescriptors:
  - payloadType: IMPORT_CAPACITY_LIMIT
    units: KW
```

**Envelope event** — the working object.

```
programID:    <assigned>
intervalPeriod: { start: <ISO 8601>, duration: <ISO 8601> }
payloadDescriptors:
  - payloadType: IMPORT_CAPACITY_LIMIT
    units: KW
intervals:
  - id: 0
    payloads:
      - type: IMPORT_CAPACITY_LIMIT
        values: [175]
priority: 0          # integer. 0 reserved for mandatory network limits.
```

**Fallback event** — long-duration, sets the default the VEN reverts to on
loss of contact. Standardised behaviour; not a bespoke mechanism.

```
payloads:
  - type: IMPORT_CAPACITY_SUBSCRIPTION
    values: [<agreed kW>]
```

**Report** — VEN → VTN, read by BL.

```
payloadDescriptors:
  - payloadType: READING
    readingType: DIRECT_READ
    units: KW
payloads:
  - type: READING          # measured import at the connection point
  - type: DATA_QUALITY     # OK | MISSING | ESTIMATED | BAD
```

Standard enumerations only. **No private `IS_*` extensions** — the point of
using a standard is that a third party's certified VEN could connect without
bilateral negotiation.

### Scopes

| Client | Scopes |
|---|---|
| RARIK (BL) | `read_all`, `write_programs`, `write_events` |
| Driivz (VEN) | `read_targets`, `read_ven_objects`, `write_reports`, `write_subscriptions`, `write_vens` |

### VTN subset in scope

`/auth/server`, `/auth/token`, `/programs`, `/events`, `/reports`, `/vens`,
`/resources`, `/subscriptions` — full CRUD, pagination, `active` filter on
events. Webhook notification including the mandatory `echo` challenge
handshake on subscription creation.

### Explicitly out of scope

Targeting and object privacy (single VEN — nothing to hide), MQTT notifier
binding, `/notifiers*` endpoints, OpenADR certification, SSRF hardening and
webhook retry/backoff beyond a basic implementation, multi-tenancy, billing.

---

## 6. Assumptions

1. RARIK will nominate a technical counterpart with allocated hours.
2. The Vík station is Driivz-managed, and a Class A PQ logger with current
   measurement is installed at the connection before the test window.
3. Permission exists to vary that charger's power during agreed windows.
4. Driivz will provide VEN-side configuration within the schedule.
5. Envelope values during testing stay within the charger's physically safe
   range; the proof never relies on OpenADR for protection.
6. Test windows avoid periods of customer-critical charging demand — relevant
   at a seasonal site in August.

---

## 7. Acceptance criteria

### Phase 0 — the single-charger proof

| # | Test | Pass criterion |
|---|---|---|
| T1 | BL authenticates, creates the program | 201; program readable by the VEN |
| T2 | VEN authenticates; the Vík charger's resource ID reconciles both sides | Identical mapping; scopes enforced |
| T3 | BL issues an event with a power limit, bounded validity | Driivz retrieves it within one poll interval |
| T4 | Driivz applies the limit | Site limit visible as applied on the Driivz side |
| T5 | **Physical effect** — station is drawing power, limit set below measured draw | **Station power drops to the limit and settles**, within ramp tolerance |

**The proof passes when T1–T5 pass.** T5 is the one that matters; T1–T4 are
the chain that gets you there.

### Measurement notes

- **There is no application-level event acknowledgement in OpenADR 3** — no
  ACK operation exists. T3 is measured by Driivz retrieving the event, not by
  any acknowledgement message.
- **Driivz polls at 60 s by default.** Budget for it, or have them reduce the
  interval for the test.
- **Set the limit relative to measured draw, not to a fixed number.** Read
  station power first, then issue an envelope meaningfully below it. A 150 kW
  limit against a car pulling 50 kW demonstrates nothing.
- **The PQ logger at the connection is the measurement of record.** The
  charger's own `Power.Active.Import` — summed across the three CCS2
  connectors — is useful corroboration and helps explain *how* the stack
  redistributed, but the evidence RARIK relies on is the independent
  instrument. Individual connectors will move unpredictably as the Kempower
  stack reallocates; only the station total should track the envelope.
- **Allow for ramp.** The station will not step instantaneously. Measure after
  settling, and agree the settling window with Driivz beforehand rather than
  arguing about it afterwards.
- **Customer impact is real.** This is a revenue-earning fast charger on the
  ring road in peak season. A binding limit degrades a paying customer's
  charge. Prefer a low-traffic window, keep the limit period short, and have
  someone able to clear the envelope immediately.

### Deferred to phase 0.5 — fail-safe

Not part of this proof, but the immediate next step:

| # | Test | Pass criterion |
|---|---|---|
| F1 | Communications deliberately interrupted | Charger enters the agreed fallback before timeout, enforced locally |
| F2 | Recovery | No uncontrolled step change; explicit resynchronisation |

> **Expect F1 to fail on Driivz.** Their documentation states events are held
> in memory and lost on crash or topology refresh, requiring the VTN to
> re-send. That is a limit which *disappears* rather than falling back to a
> safe value. If it fails, report it as a finding — it is exactly the kind of
> defect a DSO needs to know about before relying on this, and discovering it
> in a controlled test is the point.

---

## 8. Schedule

| Week | Dates | Work | Gate |
|---|---|---|---|
| 0 | Aug 5–8 | Envelope service core + 3.1.0 adapter started. Site and meter confirmed. RARIK counterpart named. Driivz sample payload and test-environment access requested. | Site confirmed; counterpart named |
| 1 | Aug 11–15 | 3.1.0 adapter deployed, credentials issued, D3/D4 packs delivered. 2.0b adapter started. | **GATE 1 — VTN reachable; BL can create a program** |
| 2 | Aug 18–22 | Driivz VEN connected. First envelope end-to-end. Measurement read path wired. | **GATE 2 — T1–T4 pass** |
| 3 | Aug 25–29 | T5 against a charging session. Iterate on failures. Contingency for a second attempt if the window is missed. | **T5 passes** |
| 4 | Sep 1 | Witnessed run. Results report. | **Delivery** |

**Schedule risk:** August is peak holiday season in Iceland. RARIK and Driivz
availability must be confirmed in week 0, not assumed.

---

## 9. Responsibilities

| Activity | RARIK | Straumvakt | Driivz | N1 |
|---|---|---|---|---|
| Envelope values and policy | **Owns** | — | — | — |
| VTN build, host, operate | — | **Owns** | — | — |
| Credential issuance | Receives | **Owns** | Receives | — |
| VEN configuration | — | Supports | **Owns** | — |
| Site, chargers, meter | — | Supports | — | **Owns** |
| Test execution | Participates | **Coordinates** | Participates | Participates |
| Results report | Reviews | **Owns** | Reviews | Reviews |

---

## 10. Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Driivz is 2.0b, not 3.x | **High** | *None — mitigated* | Both adapters built. Version becomes a routing decision, not a blocker. |
| 2.0b adapter cannot be validated without a live Driivz VEN | **High** | Schedule | Request test-environment access in week 0 — more important than the sample payload. Path C is the contingency. |
| Driivz requires mTLS with OpenADR PKI certificates | Medium | Schedule | Their published config lists no certificate parameters, implying plain TLS. Confirm early; certificate procurement has lead time. |
| Driivz in-memory event loss fails F1 (phase 0.5) | **High** | Credibility of the fail-safe claim | Report as a finding. Out of scope for phase 0. |
| Vík station idle throughout the test window | Medium | T5 unprovable | Ring road in August — sessions will occur. Week 3 carries a second attempt. |
| Limit set above actual vehicle draw — nothing observable | **High** | T5 inconclusive | Set the envelope relative to measured draw at the moment of test, not to a pre-agreed number. |
| Binding limit degrades a paying customer's charge | Medium | Reputational | Low-traffic window, short limit period, someone able to clear the envelope on the spot. |
| RARIK unavailable in August | Medium | Schedule | Confirm named counterpart in week 0. |
| No site with controllable load and readable meter | Medium | **Blocking** | No usable fallback today — the own-chargers route needs CPMS work that does not exist. Confirm the site in week 0. |
| Driivz has no site-limit API (portal/OpenADR only) | Medium | Removes Path C entirely | Ask this week. It is the only vendor question that still matters. |
| Demo drifts into a proprietary-API demo | Medium | Undermines the standards argument | North side stays 3.1.0 under all paths. |
| Scope creep toward settlement or certification | Low | Schedule | §1 and §5 exclusions are firm. |

---

## 11. Commercial and exposure

**No charge to RARIK.** Nothing is invoiced, so there is no procurement
process to trigger and nothing for RARIK to approve. Hosting cost is
negligible — single-digit euros per month.

Two exposures worth being deliberate about, even with no contract in place:

**Procurement.** Providing this free to a state-owned utility and later
becoming its supplier can create an EEA procurement problem — RARIK may be
obliged to tender the production system, and having built the pilot could cut
either way. The pilot/production boundary should be documented as we go rather
than reconstructed later. Worth an hour with someone who knows Icelandic
public procurement.

**Operational.** RARIK will hold credentials that create events which
(eventually) change physical power at a site. Even without a contract, there
should be a short written note establishing what the credentials do, the
agreed safe range, and who is responsible if an envelope behaves unexpectedly.
One page, sent with the credentials pack — not a contract, but not nothing.

Anything beyond this proof is priced separately and goes through proper
channels.

---

## 12. After the proof

| Phase | Content |
|---|---|
| **0.5 — Fail-safe** | **The immediate next step.** Comms-loss behaviour, fallback value, recovery. F1/F2 in §7. Nothing else should be built on this until a limit fails safe. |
| 1 | Envelope revision under load; sustained operation over days rather than a single window; harmonic characterisation feeding the 400 kW expansion case. |
| 2 | A second site. Aggregation, connection-point level rather than charger level. |
| 3 | Two-sided flexibility — BESS or small generator, export envelopes, paid activation. |
| 4 | **VTN ownership transfers to RARIK.** A regulated function should not run indefinitely on a commercial party's infrastructure. D9 exists to make that transfer straightforward. |

---

## Open items

Blocking:

- [ ] **Does the PQ logger measure current, not just voltage?** Rogowski / flex
      CTs at 630 A. Without current there is no kW and no proof
- [ ] Logger resolution ≤1 s, clock synchronised before installation
- [ ] Electrician and safe access booked for the 630 A installation — lead time
- [ ] Vík station's Driivz resource ID and its OCPP identity
- [ ] RARIK technical counterpart named and available in August

Needed but not blocking:

- [ ] Driivz test-environment access — required to validate the 2.0b adapter
- [ ] Driivz sample payload — confirms adapter routing
- [ ] Confirm Driivz uses plain TLS, not mTLS with OpenADR PKI
- [ ] Fallback kW value per site
- [ ] One-page operational note to accompany the credentials pack
- [ ] Procurement position reviewed
