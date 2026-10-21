# Decision brief — the open items after round 3

Written by the Cowork coordinator, 2026-08-19, after round 3 completed.

Every figure here is quoted from the packet or completion artifact that
established it. Nothing was measured, queried or executed to produce this
document — it is a reading of `docs/notes/2026-08-18-*`,
`docs/notes/2026-08-19-*` and `docs/agent-runs/2026-08-18/*-completion.*`.

---

## 0. What round 3 changed

Both lanes complete, both clean, neither pushed. **A: 22/22 gates in 44m05s**,
`a84141e → 4a84b5b`. **B: 21/21 gates plus 7/7 fallback in 27m34s**,
`a81860b → da2d458`. A's fallback queue was untouched — the 22-gate table
consumed the round.

Tests: A **1.630 → 1.689** passing, 16/16 checks, 9 new endpoints (API doc
178 → 187). B **888 → 992** root plus 176 gateway, checks **13 → 14**.
Twelve fool tests between them — A four, B eight. A records all four as caught;
B records the count but not the catch detail.

**Four things moved the decision list.**

**1 · A new engineering blocker, and it is now the last one on the critical
path.** Neither `0002` nor `0003` creates a store for the invoice number
sequence, so `issueDocument` refuses with
`document_sequence_table_not_yet_created`. The numbering *logic* is proven —
gap-free, transactional with issue, crash-safe between allocate and issue — but
has nowhere to persist a counter. **Migration `0004` is required and does not
exist.** A deliberately did not invent it: an unapplied, untested sequence
table guessed at in a round that could not run it would be worse than naming
the gap. That is the right call and it means S5 grew a prerequisite.

**2 · A second engineering blocker, from B, and it is arguably the bigger
one.** An org **cannot** be walked from nothing to invoiceable without
hand-editing the database. Setting the flat-fee agreement has no write surface
at all: `agreements.ts` exports three functions and all three read; no
application file calls `agreement.create`. Four of the five onboarding steps
have an API surface; the fifth does not. B's words: *"the single thing standing
between an operator and a first invoice."* It blocks task 12 and task 13
equally.

**3 · A genuinely new decision for you** — charger-identity cross-org
duplication. `ocppIdentities` is unique on `(orgId, identityString)`, not on
`identityString`; `createCharger` does no existence check; and the gateway auth
lookup is `WHERE lower(identity_string)=lower($1) LIMIT 1` with no org scope
and no `ORDER BY`. Duplicated identities route a charger's energy to an
arbitrary org. **The trigger is an ordinary business event — a charger moving
between orgs.** This needs an access-grant design decision under FOCUS Rule 5,
plus a migration in A's lane. It is new, it lands on money, and it is item D9
below.

**4 · One dispatch premise of mine was wrong, and B corrected it.** I wrote
that nothing captures the host kennitala. It was already there end to end —
column, input schema, repository, routes. What was actually missing was
*validation*: the field carried `/^\d{6}-?\d{4}$/` and nothing else, so any ten
digits passed and a transposed pair was stored silently. B fixed the
validation, and no migration was needed. The item still comes off your list,
but for a different reason than I gave you.

**Two corrections worth carrying forward.** A found that **preflight delta 9.7
is structural, not rare** — the earlier framing ("at 21 chargers that is
unlikely") understates it. Every connector on a vendor-native Zaptec
installation produces neither session nor StatusNotification evidence,
permanently and by construction: the Zaptec importer writes `connector_id`
null, and StatusNotification only reaches `events.event_log` from our own OCPP
gateway. That is why the assertion table was necessary rather than merely
convenient, and an operator assertion — who, when, why — is now cited on the
invoice's provenance block beside the derived counts. And B found that
**WinAnsiEncoding is not Latin-1**: the header's en dash would have been
written as byte `0x13`, a device control, in every PDF. Caught only by
generating the golden file and reading it.

**Two things to look at that are not decisions.** A checksum-valid **company**
kennitala is committed in `src/lib/org-tenant.ts` — reported by location, digits
not reproduced, nothing changed, because it is load-bearing for tenant
matching. And kennitala is returned by the cross-tenant org **list** endpoint,
because `toSummary` is shared by `listOrgs` and `getOrgById`. Not an open leak
— the route carries `platform.tenant.read` — but an over-broad payload behind a
correct guard.

Also closed this round, for the record: all three 2026-08-08 invite defects
verified **fixed** — the bearer-only hijack (ADR 0053), the invitee lockout,
and the missing idToken.

---

## 0b. The reframe

Nine decisions now, and they are not nine sittings. Sorted by **who can
answer**, they are five:

| # | Sitting | Covers | Time |
|---|---|---|---|
| **S1** | **You, alone, at the desk** | D1 active-driver · **D9 charger identity (new)** · D7 production naming · D8 Codex dispatch · D3 mobile patch owner · plus kröfuhafi Q2 and Q3 | **~40 min** |
| **S2** | **One email to customer 1** | Krafa-or-transfer (Q1) · procurement/PEPPOL requirement | **5 min to write** |
| **S3** | **One phone call to a bank** — Landsbankinn publishes 410 4000 | Kröfuhafi Q4, Q5, Q6, Q7, Q8-banking-half, and the ninth question | **one call** |
| **S4** | **One message to the accountant** | 5 questions: retention, numbering, corrections, the *yfirlýsing*, non-VAT-registered hosts | **10 min to write** |
| **S5** | **At a terminal, now unblocked** | Migrations `0002` and `0003` — 7 read-only queries, then authorise or not, per A's new 13-step runbook | **~45 min** |

Host kennitala is **off** the list — B closed it, though by fixing validation
rather than by adding capture (see §0).

**What is no longer a decision but is now the critical path**, in order:

1. **Migration `0004`** — the invoice number sequence store. Does not exist.
2. **An agreement write surface** — so an org can be onboarded without a
   hand-edited database row.

Both are A-lane and B-lane engineering respectively, and both are round-4
material. Neither needs a decision from you beyond "yes, next round."

**Operator action, not a decision:** rotating `ADMIN_PASSWORD` on **three
Workers — `hlada`, `hlada-staging`, `hlada-api-staging`.** Outstanding since
2026-08-08, old value compromised via git history. The runbook is written. It
needs doing, not deciding.

Two Workers that look like they belong on that list and do not. `hlada-api`
has never existed. And `straumvakt-ocpp` is the dead top-level gateway: its
`ADMIN_SECRET` and `CHARGER_BASIC_AUTH` are to be **retired with the Worker,
not rotated** — *"do not rotate a secret on a Worker you intend to delete; it
creates a fresh credential on an unmonitored surface."*

---

## S1 — the five you can settle alone

### D1 · Active-driver definition

> **Do we bill "active driver" as charging activity alone, or hold out for the
> locked definition of charging *or reporting* activity?**

`deriveActiveDrivers` returns `unavailable("driver_definition_incomplete")`
today. Reporting activity has **no persisted event of any kind** — "no table,
no column, no log line" — so the locked quantity cannot be computed. **Until
this is answered every period holds and no invoice can be produced at all.**

| Option | What it costs |
|---|---|
| **A — narrow to charging activity** | **minutes.** One line in `flat-fee.ts`, three tests updated (they exist so the narrowing cannot happen by accident), one lying comment at `subscription.ts:10` corrected |
| **B — build reporting capture first** | **~an afternoon.** Invoices wait |
| **C — bill the roster instead** | **a migration and a writer.** Over-bills |
| **D — leave it refusing** | **zero, and nothing ships.** This is the current state, "and it is not a resting place" |

**The money.** At customer 1 (N1 ehf, Dalvegur 10–14, 30 connectors): roster is
2 drivers, charging activity is 1. Charging-only bills **6.050 kr**, roster
bills **6.100 kr** — a gap of **50 kr/month, 0,83 % of the bill**, but **50 %
of the roster**. Ten customers of that shape: 500 kr/month, 6.000 kr/year. In
the MDU shape the product is built for — 30 connectors, 30 enrolled residents,
10 charging in a month — the gap is **1.000 kr/month, 15,4 %**.

**The door.** Not one-way, but it only opens forwards. A settled period can
never be re-priced — `settlement_components` stores unit price and effective
window as *copies*, structurally. And the evidence for a widened definition
will not exist retroactively: whichever capture you build, it starts recording
the day it ships. The trigger is **issuing an invoice for a period under the
narrow definition**. Remedy if the past matters is a `correction` line in a
*next* period, never a quiet reissue.

**Recommendation — A now, B next.** Narrowing under-bills, which is recoverable
and produces no complaint. The roster over-bills, which needs a credit note and
*does* produce a complaint. If you must be wrong, be wrong in the direction
that needs no apology.

**Read the counter-argument before you answer.** The packet writes it against
itself: an enrolled resident with a working RFID is being provided a service all
month whether or not they plug in — which is exactly the capacity-not-utilisation
logic already accepted for connectors, where a zero-session connector is billed.
Capacity for connectors and utilisation for drivers is inconsistent. The packet
still declines that path on mechanics: `driver_group_memberships` has **only
`added_at`** — no status, no `removed_at` — so the roster cannot be intersected
with a billing month at all. A driver removed in February still looks enrolled
in August. If you find the capacity argument persuasive, the decision is not
"narrow to charging" but "add `removed_at` and a status, then bill the roster."

> This is exactly the defect chunk 1 found on `assets.connectors`, which has no
> `disabled_at` and no status history … Two of the three tables billing depends
> on record only creation, never removal.

**Whichever way you go, record the gap on the first invoice's review notes** so
nobody finds it later and thinks it was hidden.

**Round 3 did not change this.** A's artifact lists it unchanged from A2b:
`deriveActiveDrivers` still refuses, and option A is still one line. It remains
the decision that blocks every real period.

---

### D9 · Charger identity across orgs — **new this round**

> **When the same charger identity exists in two orgs, whose energy is it — and
> what should the gateway do about it?**

Three facts that only matter together:

- `ocppIdentities` is unique on **`(orgId, identityString)`** — not on
  `identityString` alone.
- `createCharger` does **no existence check**.
- The gateway auth lookup is
  `WHERE lower(identity_string) = lower($1) LIMIT 1` — **no org scope, no
  `ORDER BY`**.

So two orgs can hold the same charger identity, and the gateway will resolve it
to whichever row the database hands back first. **A charger's energy is routed
to an arbitrary org.**

**Why this is not theoretical.** B's words: the trigger is *"an ordinary
business event — a charger moving between orgs."* Nobody has to make a mistake
for two rows to exist; the schema permits it and nothing checks.

**It lands on money.** It is the same *shape* as the cross-tenant CDR hole found
earlier: the lookup never asks whether the identity belongs to the org whose
meter it is about to credit. B reports it as an access-grant finding and does
**not** rule on whether it is also a tenancy defect — that judgement is part of
what you are deciding.

**What is actually being decided.** Not "fix the query" — that part is
mechanical. The decision is the **access-grant model under FOCUS Rule 5**: when
a physical charger moves between orgs, is that a transfer of ownership, a
grant, or a new asset? The answer determines whether the unique constraint
becomes global, whether identity rows carry a validity window, and what the
gateway does when it finds two — refuse, or pick by an explicit rule.

It needs a design decision from you, then a migration in A's lane. **Refusing
is safe; picking arbitrarily is not.** An unroutable charger is visible
immediately; energy billed to the wrong host is visible at the invoice, or
never.

*Adjacent, and lower stakes:* charger attach takes `orgId` from the request
body and never checks it against the caller. B verified this is **not** a
tenant escalation — `requirePermission(charger.write)` has no `orgIdParam`, so
the route is platform-staff-only. It is an operator-error surface. Correct for
task 12, and fatal for task 13 self-serve, which is a separate item.

---

### D7 · What "production" means

> **Do we adopt the `-staging` Workers as production in place, build fresh
> top-level Workers and cut over, or rename?**

Production already exists and is called staging. All three public hostnames
serve traffic and all three bind to `-staging` Workers. Two of the three —
`ws.straumvakt.org → straumvakt-ocpp-staging` and
`api.straumvakt.org → hlada-api-staging` — are proven by **tail-and-probe**,
not inferred; the third rests on a config declaration plus an HTTP probe.
Top-level `straumvakt-ocpp` is unreachable and served **zero requests in a
25-second tail**.

> The single most dangerous fact: `wrangler deploy --env staging` on the gateway
> or the API **deploys to the live production system.** The command that reads
> as "deploy to staging" is the production deploy.

| Option | WebSockets its first step touches | Verdict |
|---|---|---|
| **(a) adopt staging in place** | **zero** | Recommended |
| **(b) build fresh, cut over** | zero at step 1, **all 21 at step 8** | A project, not this week |
| **(c) rename** | **21, plus a trap** | Strike it from the list |

**Why (c) must be struck.** Changing `name` in a wrangler config does not
rename a Worker — it deploys a *new* Worker under the new name and leaves the
old one running. Secrets do not follow. Durable Object namespaces do not
follow. Option (c) is option (b) wearing a disguise, with the added risk that
someone believes it is a rename and skips (b)'s secret-recreation and
DO-migration steps.

**What a cutover actually costs.** Repointing `ws.straumvakt.org` terminates
all 21 charger WebSockets, and because a different Worker script means a
different DO namespace, liveness history, frame-cap windows and in-flight
command state are **gone** for all 21. Rolling back costs a *second* outage.
The hostname itself is in 21 devices' config and the shipped Flutter client has
no fallback host — changing it is a truck roll.

**Recommendation — (a), and it is not close.** It is the only option whose
first step does not interrupt 21 live WebSockets. Its expensive-sounding part —
building a real lower environment — is work you must do under all three
options, because today there is nowhere to test. And what it doesn't fix is a
Worker *name*: no customer, charger or client ever sees it.

**The one question that flips it:** does anything outside engineering —
contracts, audit, procurement — inspect infrastructure resource names? If no,
take (a) and stop thinking about it. "It's confusing for engineers" is not
sufficient: confusion is fixed by docs and by the config declaring reality; an
outage is not fixed by anything.

**Do first under every option** — declare `ws.straumvakt.org` and
`api.straumvakt.org` as `custom_domain` routes in config. Two of the three
production hostnames exist **only in the dashboard**; if those bindings were
lost, nothing in the repository would restore them, and nothing records that
they exist. *(This one is already done — item 5.1.)*

Lower-environment cost, when you build it: **≈$5–15/mo scale-to-zero** vs
**≈$40–50/mo hot**. Recommendation on file is scale-to-zero.

---

### D3 · The mobile money-unit patch — assign it

> **Who applies the §5.2–5.4 Flutter patch, and when?**

This is not really a choice — it is an unowned patch with a deploy hazard
attached.

**What is broken in production right now:** the driver app's **active-session
screen** (`active_session.dart:208` and `:290`) renders in-flight cost **100×
too large**. The history screen is correct — but only because the server was
wrong in the compensating direction. The client was never uniformly
compensating; it was inconsistent with itself.

The API-side fix is on `dev/core-billing-integration`: rename the wire field to
`costAurar`, emit integer aurar, let the client convert. Chosen over
divide-on-the-server because a stale client reading a missing `costIsk` gets
`null` and renders the existing "Not priced" state — visible and non-financial
— whereas server-side division would make every history amount **100× too
small (6 kr instead of 650 kr)** with no error raised anywhere. That
alternative was actually tried as a fool test: **23 tests across 2 files
failed.**

**The ordering rule, both directions, and it is the whole point:**

> Until this lands, do not point a build at an environment running
> `dev/core-billing-integration`, and do not deploy that branch's API to an
> environment your builds talk to.

The packet's own framing is that the two halves *should* land together — a
recommendation, not a hard gate. Treat it as one anyway: the failure mode of
getting it wrong is every driver money screen falling back to "Not priced."

**What you decide:** who owns `apps/mobile`. The patch author didn't touch that
tree because canonical carries ~2.857 lines of another lane's uncommitted work.
That work needs an owner regardless.

Also on the record for the second time: `getDriverActiveSessions` returns
`costAurar: 0` for an uncosted in-flight session where it should return `null`.
Specified on 2026-08-09, unactioned. It rides with a patch that updates every
driver surface at once — not smuggled into the unit fix.

---

### D8 · The Codex Work dispatch

> **Confirm it or supersede it.**

**Correction to the handover, and to what I told you earlier.** Both said this
dispatch has no completion artifact and is therefore stalled under calibration
note 10. **That is wrong.**
`docs/agent-runs/2026-08-10/codex-work-market-core-ui-productization-completion.md`
exists — 114 lines, end tip `6e7076e`. The run happened. What is actually wrong
is index hygiene: `latest.md` still shows the prompt as `ready` nine days after
it completed, so every reader concludes a lane is hung when it is merely
unfiled.

I carried that claim from `latest.md` into the handover without checking the
runs directory beside it. Worth a calibration note of its own: **the index is
not evidence of a run's state; the runs directory is.**

Its lane is Market Core UI productization for Admin, CPO, Driver. Given where A
and B have since taken the backend, that prompt was written against a different
map.

**Recommendation — mark it complete in `latest.md`, then decide the lane
separately.** Either park it, or let me cut a fresh round-4 prompt against the
current backend once you have read A's and B's artifacts.

---

### Also in this sitting — two kröfuhafi questions that are yours alone

**Q2 — which legal entity is the kröfuhafi, and does it already have a business
bank account?** Every registration is per legal entity with a kennitala, and
the bank you already bank with is materially faster than a new one — an
existing corporate customer has already cleared AML/KYC. Answering this names
the counterparty for S3 and may remove an entire account-opening step.

**Q3 — is any prospective host a public body, a municipality, or municipally
owned?** This flips the delivery decision independently of everything else:
B2G e-invoicing is mandatory, and since **2026-07-01** only PEPPOL BIS 3.0 is
accepted. **A single municipal car park flips it.** If no, PDF is confirmed for
launch.

---

## S2 — one email to customer 1

Two questions, one message. Between them they remove the two largest unknowns
in the whole collection and delivery track.

1. **Krafa, or a bank transfer against an emailed PDF?** This decides whether
   the entire kröfuhafi registration track is on the critical path or is
   background optionality. If transfer is acceptable, the market line ships
   with **no bank dependency at all**.
2. **Do you require a structured invoice in procurement — and if so, in which
   format?** This is the single condition most likely to flip the delivery
   recommendation. Their requirement, not yours; no argument wins it.

**Nothing blocks customer 1 today.** A transfer against a PDF needs a bank
account and an IBAN, and both exist.

---

## S3 — one phone call to a bank

The registration chain is serial and externally paced: choose the bank → sign
collection-service terms → receive kröfuhafi credentials and B2B access →
test cycle if required → first live claim. Only the first and last are measured
in hours; the middle three are **unknown**, and "nothing in that chain can be
compressed by working harder, which is exactly the property that made this the
long pole."

Ask these, in this order. The Icelandic wording is from the packet.

**The ninth question first — the highest-leverage one after customer 1's:**

> *Getum við skráð okkur sem kröfuhafa áður en við höfum viðskiptavini að
> innheimta hjá?*

If yes, the entire serial spine runs in the background starting today and never
appears on the critical path again.

**Q4 — what must be signed, and what do you need from us?**

> *Hvað þarf til að fyrirtæki verði kröfuhafi og geti stofnað kröfur — hvaða
> samningur eða skilmálar, hvaða gögn, og hversu langan tíma tekur það frá
> umsókn að fyrstu kröfu?*

**Q5 — is a test cycle mandatory?** The step most likely to be serial,
invisible on a price list, and measured in weeks. It is the largest single
variance in the timeline — a mandatory certification cycle is the difference
between two weeks and two months.

> *Er prófunarumhverfi fyrir B2B vefþjónustuna, og er prófunarlota skilyrði
> áður en fyrstu kröfur fara í kröfupott?*

**Q6 — the fees, and who pays them.** *This is the one question in the packet
that can change the shape of the product.* A single-connector host is a
**200 kr** invoice. If claim creation plus slip plus payment fee is a
double-digit percentage of that, monthly billing is the wrong period.

> *Hvað kostar að stofna kröfu í gegnum B2B, hvað kostar greiðsluseðill
> rafrænt annars vegar og í pósti hins vegar, hvað kostar breyting eða
> niðurfelling kröfu, og hvað af þessu greiðir kröfuhafi og hvað greiðandi?*

The fee *lines* are known and catalogued verbatim from Landsbankinn's price
list (23. apríl 2026) — *stofnun kröfu*, *breyting/niðurfelling*, *prentun
greiðsluseðils*, *póstsending*, *greiðslugjald*, *innheimtuviðvörun* and the
rest. **No amounts.** The price list's column alignment could not be recovered
from its text layer, and a plausible wrong fee is worse than a blank. Two
things follow from the labels alone: **a correction is charged twice** — once
to cancel, once to create the replacement — and electronic vs paper presentment
are separately priced, so the svarskrá's "should a slip be printed" field is a
cost signal as well as a delivery signal.

**Q7 — how does money come back, and can it be matched?** The difference
between automated reconciliation and someone reading a bank statement every
month. Creditors can query payments from the kröfupottur for a given date; what
is unknown is whether **your own reference survives the round trip**, which is
the part that matters.

> *Hvernig skilar greiðsla sér til baka — kemur hún með kröfunúmeri/tilvísun
> kröfuhafa, og er hægt að sækja greiðslur úr kröfupotti fyrir tiltekna
> dagsetningu í gegnum vefþjónustu?*

**Q8 — does collecting on behalf of hosts change the registration?** Does not
block the market line, but answering it late means possibly redoing the
registration. Landsbankinn publishes a form titled *"Umsókn um aðgang
innheimtufyrirtækis að innheimtukröfum"* — the existence of a distinct
application for a collection company's access is evidence that acting for
others is a recognised, separately-handled category.

> *Ef við innheimtum kröfur fyrir hönd viðskiptavina okkar — þeir eru
> kröfuhafar, við sjáum um innheimtuna — þarf það aðra skráningu,
> vörslureikning, eða starfsleyfi?*

**The hedge worth pricing in the same week.** A service bureau (kollekta.is /
Alskil were the names found) creates the claims in the bank on your behalf and
handles the banking relationship. It converts an unknown-duration serial chain
into a vendor conversation. It deserves a quote — and it is the natural hedge
if Q5 comes back as "yes, mandatory test cycle." Ask them one extra thing: *do
you return payment events with our own claim reference?*

**What is already safe.** The data model is route-independent and already
agent-shaped: `claimHolder` is required, explicit, and never inferred. The
remaining cost of the deferred host→driver line is a registration conversation
and a remittance ledger, not a rebuild.

**One design rule to carry into the call:** if the bank's own dunning is
enabled, **Straumvakt must not also dun.** Two reminder schedules against one
claim is a customer-visible defect and a support cost. That is already modelled
as `externallyManaged`.

---

## S4 — one message to the accountant

Five questions. None is expensive to ask and one of them is a task nobody
currently has on a list. *(These are accounting and legal questions — the
packets' readings are careful but they are readings, and the point of this
sitting is to have someone qualified confirm them once, cheaply, before the
first invoice exists.)*

1. **Retention.** Is the 7-year obligation satisfied by keeping the rendered
   PDF, or must the underlying accounting record be kept in a system meeting
   the *rafrænt bókhald* declaration requirement? And is it 7 years from issue
   date or from end of financial year — that moves the earliest safe deletion
   date by up to 12 months.
2. **Numbering.** Iceland requires invoices *"fyrirfram tölusett með áprentuð
   númer í samfelldri töluröð"* (Regulation 50/1993). Does that permit a
   system-allocated sequence in a bookkeeping system meeting the *rafrænt
   bókhald* conditions? Straumvakt reads it as yes; confirm the reading once
   before the first issue.
3. **Corrections.** Must a correction be a credit note against the original
   number, or may an invoice be reissued? The model assumes **credit-note-only**
   — chosen because it is safe under both answers. Note the consequence: a
   correction emits two documents and consumes two numbers, and a cancelled
   invoice consumes its number. You cannot un-issue a number to close a gap.
4. **The declaration nobody has on a list.** Does Straumvakt need to file or
   hold a *"yfirlýsing seljanda eða hönnuðar hugbúnaðarins"* for its invoicing
   system before issuing the first invoice, and if so, to whom? *The cheapest
   thing in the packet to get wrong and the easiest to fix early.*
5. **Non-VAT-registered hosts.** For a claim presented on a host's behalf, what
   must and must not appear? Under *umboðssala*, the party selling **in his own
   name** issues the invoice; Straumvakt presenting *f.h.* the host is
   explicitly not selling in its own name, so the host issues and the host's
   VAT registration governs. A host who is not VAT-registered produces a claim
   with **no VAT on it** — a different document, not the same document with a
   zero.

**Delivery format recommendation, for context:** ship the emailed PDF, do not
contract a PEPPOL access point yet. No mandate binds the market line, so PEPPOL
buys compliance you already have; its cost is not the mapper but the
access-point contract, a recurring monthly charge regardless of volume, which
at customer-1 volume is the dominant term. **TS-236 is not a third option** —
it is Iceland's national specification *implementing* PEPPOL BIS 3.0. Choosing
PEPPOL for Iceland *is* choosing TS-236.

The reversible/permanent split is the thing to hold onto:

| Permanent | Changeable in six months |
|---|---|
| The number on an issued invoice | PDF → PEPPOL (a mapper plus a contract) |
| The header on a delivered invoice | Which access point |
| The VAT treatment applied | The PDF's visual design |
| That a legal entity appeared as supplier | Email provider |

> Numbering, header semantics and VAT posture are the permanent half. The
> decision that feels like the decision — PDF or PEPPOL — is the reversible
> one.

And separately, from the same packet's reasoning: the irreversible parts are
being built to the stricter standard now, so PEPPOL later is a mapper, not a
migration.

---

## S5 — migrations `0002` and `0003`

**Now unblocked.** A's round closed preflight deltas 9.7 and 9.8 and generated
**`0003_handy_stranger`** — 2 `CREATE TABLE`, 2 `CREATE UNIQUE INDEX`, 2
`CREATE INDEX`, natural-key unique, **generated and unapplied**. It holds
`billing.period_transitions` — the recorded transition that makes
`activityJobHasRun` a derived fact rather than a boolean a caller hands in —
and `billing.connector_assertions`, the operator-assertion table that delta 9.7
turned out to require structurally. Both migrations are unapplied; both are
`CREATE`-only with no lock on any populated table.

**Use A's runbook, not the raw preflight.** It wrote
`docs/notes/2026-08-18-first-invoice-operator-runbook.md` — 13 steps, with an
explicit stop point at each irreversible one and a hold-reason section. The
apply is its steps 4 and 5. The `0002` preflight pack below is unchanged and
still the reference for *what* you are applying and *why each guard exists*.

**And know before you start: applying both still does not produce an invoice.**
`0004` — the invoice number sequence store — does not exist yet. Applying
`0002` and `0003` is worth doing on its own terms, because it is reversible
right up until the first generation run and because everything downstream needs
the tables to exist. But the first real invoice waits on `0004`, on the
agreement write surface, and on D1.

**What `0002` is:** 11 types · 11 tables · 26 indexes (10 unique, 16 plain).
**48 statements, all `CREATE`.** Zero `ALTER`, zero `DROP`, zero `TRUNCATE`,
zero DML, zero `GRANT`. No foreign keys to existing tables, so no lock on
`charging.sessions` or anything else populated. Estimated well under one second
— but the load-bearing point is the lock surface, not the duration: **a
concurrent charging session, CDR import or OCPP write cannot be blocked by
it.** Safe to apply during the day.

The ten unique indexes are the interesting part — each one makes a specific
disaster impossible: two open periods for one org-month, double-counting a
connector, double-counting a driver, replaying a mutation, two invoices for one
recipient for one month, sending the same statement twice, two line-3s on one
document.

**The rollback window is: from the apply until the first generation run.** Up
to that point a transactional drop of 11 tables and 11 types plus removing the
journal row is a clean undo. After the first settlement row lands, that same
drop destroys money records rather than empty tables — the frozen price, the
audit copies of unit price and effective window, the documents the customer was
sent, the record that a claim was presented, and the replay guard. From then on
the correct recovery is a *forward* migration plus correction lines.

**Two traps worth naming before you start.** The Neon default branch is
abandoned — staging is `br-tiny-river-abgpqq37`. Applying to the default branch
achieves nothing **and looks like success**. And the packet's own step 9: do
not run a generator in the same sitting.

**Delta 9.6 is closed.** Both `reports.*_activity_month` tables had zero
writers when the packet was written; A2a and A2b built them, and round 3
derived `activityJobHasRun` from a recorded transition rather than a boolean a
caller hands in. That gap is gone. The remaining ones are named above.

**Run the seven read-only queries yourself first** — the packet is explicit
that these are yours, not an agent's. They check for duplicate legacy billing
lines, duplicate ledger rows, duplicate rate references, table and type name
collisions, and whether `0001` is applied. Name collisions must be zero or
`0002` fails; duplicates do not block it but change what the follow-up costs.

**Kept deliberately out of `0002`:** the `rate_references` unique index. Today
two rate rows can claim the same window for the same factor, and `pickActiveRate`
takes `matches[0]` — so which of two prices a customer gets depends on row
order. It is a separate `CONCURRENTLY` migration because `0002` is currently
*unfailable* and a unique index on a populated table can fail. If duplicates
exist, the dedupe is a product decision and not a script: two rows with the same
key and different prices mean somebody was charged one of two prices and nobody
knows which. **A rate row is evidence of what somebody was charged.**

---

## Suggested order for the sitting

1. **D8** — supersede the Codex dispatch. Thirty seconds, clears the index.
2. **D7** — answer the one flip question, take (a). Two minutes.
3. **D3** — name the mobile owner. Two minutes.
4. **Q2 and Q3** — from records and the pipeline. Five minutes.
5. **D1** — read the counter-argument, then decide. Ten minutes, and it is the
   one that unblocks every real period.
6. **D9** — the access-grant model. The longest think in this list, and the
   only item where the wrong answer bills the wrong customer silently.
7. Write **S2**'s email and **S4**'s message. Both go out the same day.
8. Book **S3**'s call.
9. **S5** at a terminal, following A's runbook.

Items 1–5 are about twenty minutes. D9 deserves its own sitting.

---

## Round 4, when you want it

Not decisions — the queue, so it is written down somewhere.

| Lane | Work |
|---|---|
| **A** | Migration `0004`, the invoice sequence store — last engineering item on the critical path. Then A's untouched round-3 fallback queue: the parity harness at the new ledger, census row 104, the 22 remaining missing-`orgIdParam` gates |
| **B** | The agreement write surface — the one thing standing between an operator and a first invoice |
| **Either** | The D9 migration, once you have decided the access-grant model |

Two seams to close when the lanes next merge, both flagged by the agents
themselves and neither urgent: `period-repository.ts` sits in `lib/billing/`
because the round-3 boundary put it there and belongs in
`repositories/period-store.ts`; and A added two lines to `apps/api/src/index.ts`
to mount the new router, which is where a trivial conflict with B would land.
**B** also notes the invoice validator **has still never run against a generated
invoice** — A's branch carries no generated invoice document, so B's validator
and A's generator have not yet met.
