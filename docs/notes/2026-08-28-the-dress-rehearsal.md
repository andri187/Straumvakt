# The dress rehearsal — the target that replaces "the first invoice"

**Decided 2026-08-28 by Andri.** Supersedes the framing of every plan written
before it, including tonight's status board and the nine-step invoice sequence.

---

## 1. The target, in one paragraph

**Run the entire product, in production shape, with no real invoice served.**
The estate is wiped — chargers and charge logs completely — and the same
physical chargers are re-onboarded from nothing through the real pathway.
Every actor in the system is created through a proper onboarding process.
**No actor, no charger, no agreement and no membership is created by hand.**
Some steps between may be mimicked for testing — a confirmation email captured
rather than sent — but the process is walked, not simulated.

**And everything needs a UI.** A step that only exists as a script or a runbook
is a step that has not been built.

---

## 2. The line between real and mimicked

The rule is simple and covers every case: **nothing that leaves the system is
real; everything inside it is.**

| Real | Mimicked |
|---|---|
| Every database write, every state transition | Outbound email — captured to a viewable log, not sent |
| Every screen, every click, every refusal | Invoice delivery — rendered and logged, never served to a customer |
| The Zaptec credential, the installation import, the charger discovery | Payment status — no bank, no claim registered |
| Real OCPP sessions from the real chargers at Dalvegur | Any third-party submission of any kind |
| Driver authorisation switched on, real tokens | |
| Period close, pricing, statement, invoice document, numbering | |

An invoice **is** produced, numbered and rendered. It is simply not delivered to
a human who owes money.

---

## 3. The acceptance test

**No row in the database was created by hand.**

Every row traces to a screen action and an audit entry naming who did it and
when. That is checkable, and it is the whole point: if a single org, charger,
driver, agreement or membership had to be inserted by a script, the product
does not exist yet for that step.

Second criterion: **a second host org exists, onboarded the same way, and
nothing of theirs is visible to the first.** Isolation cannot be proven with
one tenant — with one tenant, everything looks isolated.

Third criterion, and the one most likely to be skipped: **within one CPO, two
installations with disjoint driver sets, and a driver of installation A proven
unable to see or charge at installation B.** See §6 — access is a second
boundary inside the tenant boundary, and a cross-tenant test alone passes while
it is wide open.

---

## 3a. Who the CPO is — settled 2026-08-28

**The named owner of the e-meter at the DSO is always the owner of the monthly
utility bill, and is therefore the CPO.** That is the definition, and it is
externally verifiable at onboarding rather than a matter of who signs up first.

Consequences that fall straight out of it:

- **One installation ≈ one e-meter ≈ one utility bill.** That is why cost
  allocation is per-installation and not per-site or per-org: the installation
  is the thing with a bill attached. A CPO holding several meters holds several
  installations.
- **The Zaptec account belongs to the CPO**, not to Straumvakt. So onboarding an
  installation is a **CPO self-serve step** — they enter their own vendor
  credential — not an admin-only one. At Dalvegur the account is the CPO's.
- **Straumvakt Admin edits and changes things on behalf of the CPO**, and every
  such change is logged as acting-on-behalf-of, naming the admin, the CPO and
  the time. That is what keeps a rate defensible when a resident or an employee
  disputes it: the log answers "who set this".

### Dalvegur is a workplace, not an MDU

**Customer 1 is a workplace.** Its drivers are employees, and its bearer is the
org — which is exactly what the default-token-as-ordinary-group-member design
produces.

**So the first real CDR evidence tests the workplace shape, not the MDU shape.**
The dweller-pays line — the one the MDU market exists on — is not exercised by
Dalvegur at all unless employees are separately billed for personal charging.

**Recommendation: make the second host org an MDU**, not a synthetic copy of the
first. It costs the same to onboard and it makes the rehearsal cover both bearer
shapes — org-pays and driver-pays — which is the difference between testing the
product and testing half of it.

### The multi-company workplace — added 2026-08-28

**One installation, one meter, one utility bill, one CPO — and drivers from
several different companies**, with access to different chargers or different
**circuits** within it.

Cost for this shape is deliberately deferred until the onboarding process is
walked. Two consequences are not deferrable, because both shape the schema
before it is generated:

**1 · Grant scope includes the circuit.** The levels are
`installation | circuit | named chargers`, not just installation-or-chargers.
The circuit already exists in the hierarchy; the grant must be able to name it.

**2 · A bearer can be a third org — not only the host or the driver.** Company
B's employees charge on the CPO's meter, so the money for those sessions belongs
to **Company B**, which is neither the meter owner nor the driver. The existing
shape carries it without invention: an agreement between the CPO and each
participating company, whose clauses grant access to specific circuits or
chargers and name that company as bearer. **What must change is the assumption
that a bearer is host-or-driver.**

Straumvakt's own line is unaffected in principle — the CPO is the customer of
record, being the meter owner — but *whether Straumvakt bills the CPO and the
CPO recharges each company, or Straumvakt bills each company directly,* is part
of the deferred cost decision.

**The open question this creates, which is a privacy question rather than a
billing one:** does the meter owner see *which employee of another company*
charged, and when — or only the company-level total they need in order to
recharge? Session times are personal data. Decide before the first
multi-company installation is onboarded, not after.

**This also makes Dalvegur the harder test, not the easier one.** It exercises
several bearer orgs on one meter, circuit-level access, and isolation *within a
single installation* — two companies' drivers who must not see each other. The
MDU shape remains unexercised, which is what the second org is for.

---

## 4. Every actor, and the screen it needs

Ordered by dependency. **A row on this list without a screen is round 5 work,
not a later polish item.**

### Straumvakt Admin

| Step | Screen | Exists? |
|---|---|---|
| Sign in | login shell | **yes** — deployed. Binding-based, which is also the bootstrap exception: the first admin cannot be onboarded by a screen and is a Worker binding |
| Receive and approve a host application | host-application review | route exists, unwired |
| Create the host org | org creation with kennitala capture and validation | write path exists (round 3), no screen |
| Enter the vendor credential for that org | Zaptec credential entry | route exists |
| Import the installation and discover chargers | discovery review and accept | `pending-discoveries` exists, predates the placement model |
| Attach a charger to an installation | device attach → **placement** | **new — ADR 0054, landing tonight** |
| Set the host's plan | plan / tariff assignment | engine exists, no screen |
| See everything, across all orgs | admin-scoped views | the only persona that may |

### Host / CPO

| Step | Screen | Exists? |
|---|---|---|
| Apply, be approved, first sign-in | application → invitation → sign-in | partly; identity-bound invites landed |
| Complete the org profile | profile, kennitala, billing identity | capture + validation exist, no screen |
| Sites, installations, circuits | hierarchy management | fixture routes only |
| See their chargers and status | charger list, live state | fixture routes only |
| Create driver groups | group management | **write surface built tonight**, no screen |
| Invite a driver | invite, identity-bound | exists; the bearer defect was fixed |
| Move a driver out | close a membership | **the write surface exists as of tonight; no screen** |
| See the agreement and its clauses | agreement view | reads exist, writes built tonight, no screen |
| See the month's billing material | statement / period view | nine endpoints exist, labelled "backend gated" in the UI |
| See who has paid | payment status | **mimicked** — no bank |

### Driver

| Step | Screen | Exists? |
|---|---|---|
| Redeem an invite | identity-bound redemption | exists |
| Sign in | mobile + portal | exists |
| See what they may charge at | access view | exists, unaffiliated case hardened |
| Charge with authorisation on | the actual session | **blocked** — authorisation is off fleet-wide; every session carries a default token |
| See a session's cost | active session, history | exists — **and renders cost 100× too large** |
| See what they owe and to whom | the driver money surface | **does not exist at all** |

---

## 5. The order of the rehearsal

1. **Wipe.** One dump as rollback insurance, then everything goes — chargers,
   charge logs, users, agreements, memberships.
2. **Admin bootstrap.** The one permitted exception, and it is a binding, not a
   row.
3. **Host org onboarded** — application, approval, invitation, first sign-in,
   profile completed. Through screens.
4. **Vendor credential, installation import, chargers discovered and attached**
   — producing the first placements.
5. **Agreement, clauses, bearer rules, plan.** Through screens.
6. **Drivers invited, redeemed, grouped.** Including the default token,
   registered as an ordinary group member.
7. **Authorisation switched on.** Real sessions, from the real fleet, naming
   real people.
8. **Period closes.** Activity, pricing, statement, invoice document, number
   allocated. Delivery logged, not served.
9. **A second host org onboarded identically, and isolation proven** across
   UI, API and the gateway's identity resolution.

Steps 1–2 need the migrations applied first. Steps 3 onward are the product.

---

## 6. The visibility model — stated, to be enforced and tested

**Confirmed by Andri 2026-08-28.**

- **Straumvakt Admin** sees everything — every org, installation, charger,
  driver and session.
- **A CPO** sees their own stuff, and **a CPO may hold one installation or
  many.** Everything of theirs, nothing of anyone else's, at any layer.
- **Not every driver of a CPO has access to every charger of that CPO.**
  Access is per driver group → clause → installation, not per org. A CPO with
  three installations may have three disjoint sets of drivers.
- **A driver sees only what they have access to, plus information about
  themselves.** Not other drivers, not other installations, not the ones in
  their own building they have no grant to.

**So visibility is two levels, not one, and the second is the one that gets
missed:**

| Level | Boundary | Failure if wrong |
|---|---|---|
| **Tenant** | org | one host sees another host's chargers, drivers or money |
| **Access** | driver group → clause → installation, **valid at a point in time** | a driver of the right org sees or charges at an installation they were never granted |

The intra-org level is the harder test and the realistic one. A cross-tenant
test alone will pass while the second level is wide open.

**This sharpens tonight's defect rather than softening it.** The access check
dates the *agreement* rather than the membership, so a driver who moved out in
March still authorises in July — and with per-installation access, that is not
only a stale membership but a grant to a specific installation that should have
closed. Nine call sites decide access; not all of them ask "valid when?".

### Parked, and not part of the to-market product

**The "helper" module** — one driver assisting another through the Straumvakt
ecosystem via the issues engine. Recorded so it is not rediscovered as a gap:
it is deliberate scope, deferred, and no visibility rule above is to be widened
in anticipation of it.

Known gaps against this today: the cross-tenant org list returns kennitala
(a correct guard with an over-broad payload); the access check dates the
agreement rather than the membership, so **a driver who moved out in March
still authorises in July**; and the UI's 79 routes have no tenancy proof at all,
being fixture-driven.

The second org is assumed **synthetic but properly onboarded** — a test housing
association walked through the identical flow — unless a real second prospect
exists.

---

## 7. What this changes about the plan

- **The UI lane moves to critical path.** It has had one dispatch in eighteen
  days and its branch has been unmerged since 11 August.
- **The re-onboard becomes the acceptance test for the onboarding UI**, not a
  data-migration chore. Doing it with a script would prove nothing and would
  have to be done again.
- **"First invoice" stops being the target** and becomes step 8 of the
  rehearsal.
- **The web branch must merge**, for the same reason the money engine and the
  rails had to: one tree, or the duplication compounds.
