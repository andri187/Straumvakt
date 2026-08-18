# Collection — the kröfuhafi packet

**TASKS.md task 8, second half.** Written 2026-08-18 by `claude-b` in
`E:\Claude\Straumvakt-relops-b`. Companion:
[`2026-08-18-invoice-delivery-decision.md`](2026-08-18-invoice-delivery-decision.md).

Basis labels as in the delivery packet: `[repo]`, `[src: …]`, `[inferred]`,
`[confirm: who — question]`. **No unlabelled numbers.**

**A note on source quality, stated up front because it changes how you should
read §1.** Iceland's three retail banks publish their kröfuhafi handbooks as
PDFs whose text layer could not be extracted from this machine — the documents
were retrieved, but they render through custom font encodings that defeated
offline extraction. What follows is therefore built from: the banks' own HTML
service pages, the *searchable* summaries of those handbooks, the verbatim fee
labels recovered from Landsbankinn's published price list, and reasoning marked
as such. **The structural claims are well-founded. The numbers are not, and
they are not guessed.**

---

## TL;DR

**Nothing blocks customer 1.** Bank transfer against an emailed PDF needs a
bank account and an IBAN, both of which exist. That is the do-nothing baseline
and it is a legitimate answer for the first several invoices `[repo:
SERVICES.md:78]`.

**Start the kröfuhafi conversation anyway, this week, because it is the only
clock that does not run on your schedule.** Registration is an agreement you
sign with a bank `[src: Íslandsbanki kröfuhafi handbook]` — the lead time is
theirs, not yours, and it costs nothing to start early.

**The reconciliation contract is the real engineering work, and it is
route-independent.** Built in this run.

---

## §5 (first, because it is the most valuable thing here) — THE BLOCKING QUESTIONS

Ordered. Each has **why it blocks** and **what unblocks on the answer.**
Questions 1–3 are Andri's alone. Questions 4–8 need a bank or an accountant.

### Q1 — Does customer 1 need a krafa at all, or will they pay a transfer against a PDF?

- **Why it blocks:** it decides whether the entire kröfuhafi track is on the
  critical path or is optionality. Everything below changes priority on this
  one answer.
- **What unblocks:** if transfer is acceptable → the market line ships with no
  bank dependency at all, and the kröfuhafi track becomes a background task with
  a comfortable deadline. If they want a krafa → §2's timeline becomes the
  release gate and step 1 must start immediately.
- **Ask:** the host. One sentence.

### Q2 — Which legal entity is the kröfuhafi, and does it already have a business bank account?

- **Why it blocks:** every registration is per legal entity with a kennitala,
  and the bank you already bank with is materially faster than a new one
  `[inferred: onboarding a new corporate customer adds AML/KYC that an existing
  customer has already cleared]`.
- **What unblocks:** names the counterparty for Q4–Q7 and removes an entire
  account-opening step from the timeline if the account exists.
- **Ask:** Andri, from records. No external party needed.

### Q3 — Is any prospective host a public body, a municipality, or municipally owned?

- **Why it blocks:** it flips the *delivery* decision independently of this
  packet — B2G e-invoicing is mandatory and since 2026-07-01 only PEPPOL BIS
  3.0 is accepted `[src: EC country sheet; CentaraIQ]`. It also tends to change
  payment terms and procurement requirements.
- **What unblocks:** if no → PDF confirmed for launch. If yes → PEPPOL becomes
  required for that host and the delivery packet's recommendation flips.
- **Ask:** Andri, from the pipeline.

### Q4 — What exactly must be signed to become a kröfuhafi, and what does the bank need from Straumvakt?

- **Why it blocks:** this is the head of the serial chain in §2. Until it is
  answered, every duration downstream is unknown.
- **What unblocks:** converts §2's step 1 from "unknown" into a date, and tells
  you whether anything is needed that Straumvakt does not yet have.
- **Ask the bank:** *"Hvað þarf til að fyrirtæki verði kröfuhafi og geti stofnað
  kröfur — hvaða samningur eða skilmálar, hvaða gögn, og hversu langan tíma
  tekur það frá umsókn að fyrstu kröfu?"*
- **Known partial answer:** a creditor must sign terms regarding collection
  service with the bank `[src: Íslandsbanki Handbók kröfuhafa 2025]`. What is
  *not* known is the document set, the approval path, or the duration.

### Q5 — Is there a test environment, and is a test cycle mandatory before live claims?

- **Why it blocks:** this is the step most likely to be serial, invisible on a
  price list, and measured in weeks. A mandatory certification cycle is the
  difference between a two-week and a two-month timeline.
- **What unblocks:** the largest single variance in the §2 timeline.
- **Ask the bank:** *"Er prófunarumhverfi fyrir B2B vefþjónustuna, og er
  prófunarlota skilyrði áður en fyrstu kröfur fara í kröfupott?"*

### Q6 — What are the actual per-claim fees, and who pays them — kröfuhafi or greiðandi?

- **Why it blocks:** it decides whether a 200 kr/connector/month line survives
  contact with a per-claim fee. **If the per-claim cost is a material fraction
  of a small monthly invoice, monthly billing is the wrong period** — and the
  billing period is a commercial decision, not a technical one.
- **What unblocks:** either confirms monthly billing or forces a quarterly /
  annual / accumulate-to-threshold model. This is the one question in this
  packet that can change the shape of the product.
- **Ask the bank:** *"Hvað kostar að stofna kröfu í gegnum B2B, hvað kostar
  greiðsluseðill rafrænt annars vegar og í pósti hins vegar, hvað kostar
  breyting eða niðurfelling kröfu, og hvað af þessu greiðir kröfuhafi og hvað
  greiðandi?"*
- **What is known:** the fee *lines* exist and are named — see §3.5. The
  amounts were not recoverable and are not guessed.

### Q7 — How does money come back, and at what granularity can a payment be matched to a claim?

- **Why it blocks:** it is the difference between automated reconciliation and
  someone reading a bank statement every month. It determines the shape of the
  reconciliation contract's ingest side.
- **What unblocks:** confirms or corrects the reconciliation contract in §7 and
  the `PaymentEvent` shape built this run.
- **Ask the bank:** *"Hvernig skilar greiðsla sér til baka — kemur hún með
  kröfunúmeri/tilvísun kröfuhafa, og er hægt að sækja greiðslur úr kröfupotti
  fyrir tiltekna dagsetningu í gegnum vefþjónustu?"*
- **Known partial answer:** yes, in principle — creditors can query payments
  from the kröfupottur for a specific date `[src: Landsbankinn B2B technical
  handbook, via search]`. What is unknown is whether the kröfuhafi's own
  reference survives the round trip intact, which is the part that matters.

### Q8 — Does presenting claims on behalf of a host change the registration required?

- **Why it blocks:** it does **not** block the market line — see §4 — but
  answering it late means possibly redoing the registration.
- **What unblocks:** whether the deferred host→driver line can reuse this
  registration or needs a different one (client-account handling, or the host
  registering as their own kröfuhafi with Straumvakt as agent).
- **Ask the bank and the accountant, separately, because they will answer
  different halves:** *"Ef við innheimtum kröfur fyrir hönd viðskiptavina okkar
  — þeir eru kröfuhafar, við sjáum um innheimtuna — þarf það aðra skráningu,
  vörslureikning, eða starfsleyfi?"*
- **Note the leverage:** Landsbankinn publishes a form titled *"Umsókn um aðgang
  innheimtufyrirtækis að innheimtukröfum"* — an application for a **collection
  company's** access to collection claims `[src: landsbankinn.is form 0913]`.
  The existence of a distinct application for that role is evidence that acting
  for others is a recognised, separately-handled category `[inferred]`.

---

## §1 — What the Icelandic bank claim rail requires of a claim originator

### 1.1 The shape of the rail

The domestic rail is the **krafa / greiðsluseðill**, cleared through
**Reiknistofa bankanna (RB)** `[repo: SERVICES.md:71-72]`. The mechanism, in
the banks' own terms: claims created in a bank's collection system or in
corporate online banking are processed in **RB's kröfupottur** (the claims
pool), and from there the claim becomes visible **across all banks and savings
banks and all their online banks** `[src: Landsbankinn collection handbook, via
search]`.

**That last property is the entire product.** The host sees the claim in
*their own* bank regardless of which bank Straumvakt uses. It is why this is
what Icelandic businesses expect and why an emailed PDF feels informal by
comparison `[repo: SERVICES.md:74]`.

### 1.2 Registration and agreements

| Requirement | Basis |
|---|---|
| Sign terms/agreement on collection service with the bank | `[src: Íslandsbanki Handbók kröfuhafa 2025]` |
| Nominate the account claims are paid into | `[src: Landsbankinn — creditors specify the account for payment distribution]` |
| Nominate the account service costs are debited from | `[src: same]` |
| A legal entity with a kennitala | `[inferred: universal for Icelandic business banking]` |
| Anything else — AML/KYC, credit assessment, guarantees, minimum volume | `[confirm: bank — Q4]` |

**The honest state of this section: the *existence* of a signed agreement is
established; its *contents* and *approval path* are not.** That is Q4, and it
is the highest-value call to make.

### 1.3 Identification

Claims identify the payer by **kennitala** `[inferred: this is how Icelandic
claims address a payer; the whole rail is kennitala-keyed]` `[confirm: bank —
is kennitala sufficient to address a claim, or is a claim also keyed to a
specific bank account?]`.

> **This is a data-model consequence for onboarding, and it is not currently
> met.** To issue a krafa to a host org, Straumvakt must hold that org's
> kennitala. `[confirm: Andri — does the org record capture kennitala today,
> and is it required at onboarding?]` If it does not, that is a small
> onboarding change with a long lead time attached to discovering it late.
> **CLAUDE.md rule on secrets applies: a kennitala is never logged, printed or
> committed** `[repo: prompt §1 rule 11]`.

### 1.4 Technical onboarding — the interfaces that exist

| Channel | What it is | Basis |
|---|---|---|
| **Corporate online banking** | Create, modify, delete individual claims by hand | `[src: Landsbankinn service page]` |
| **Excel batch** | Bulk claim creation from a template | `[src: same]` |
| **B2B web service** | Machine integration from an accounting system; hosted at `b2b.fbl.is` for Landsbankinn | `[src: Landsbankinn B2B technical handbook, via search]` |
| **Service bureau** | A third party creates the claims for you — see §3 route B | `[src: kollekta.is / Alskil]` |

**Claim types:** *almennar kröfur* (standard claims) and *valkröfur* /
*valgreiðslur* (optional claims the payer may choose to pay) `[src:
Landsbankinn service page]`.

**Slip handling:** the kröfuhafi can print a PDF slip themselves, or the bank
prints and mails it `[src: same]`. Both appear as separate priced lines — see
§3.5.

**Responses:** the web service returns response files (*svarskrár*) reporting
whether claims were created correctly and whether payment slips should be
printed `[src: Landsbankinn collection handbook, via search]`.

> **That second field is a delivery-log input, and it is easy to miss.** "Should
> a slip be printed" is the rail telling you whether the payer will be reached
> electronically or needs paper. An invoice rail that ignores it will silently
> under-deliver to exactly the payers least likely to notice.

**Dunning is partly built into the rail:** automatic reminders (*sjálfvirkar
ítrekanir*) and automatic escalation of claims to collection agencies
(*framhaldsinnheimta*) are bank features, and creditors may request that
collection companies receive claims past due date or that claims move to
secondary collection after a set number of days overdue `[src: Landsbankinn
collection handbook and service page, via search]`.

> **Design consequence, and it is the most important sentence in §1:** if the
> bank dunning is enabled, **Straumvakt must not also dun.** Two reminder
> schedules against one claim is a customer-visible defect and a support cost.
> The dunning model built this run therefore treats bank-side dunning as a
> *mode* — `externallyManaged` — in which Straumvakt tracks state and emits
> nothing. See [`dunning.ts`](../../packages/contracts/src/invoice/dunning.ts).

### 1.5 Per-claim cost

See §3.5. Structure known, amounts `[confirm: bank — Q6]`.

---

## §2 — Lead time, as a timeline

**Not "weeks, not days"** `[repo: SERVICES.md:84]` **— that is an adjective.**
Here is the sequence, what is serial, and where the unknowns actually sit.

```
  ── SERIAL SPINE (each step needs the previous one) ─────────────────────

  S1  Choose the bank                          duration: hours   [Andri, Q2]
       │
  S2  Apply / sign collection-service terms    duration: UNKNOWN [Q4]
       │                                        ← the single largest unknown
  S3  Receive kröfuhafi credentials + B2B
      access                                   duration: UNKNOWN [Q4]
       │
  S4  Test cycle against the bank's test
      environment, if one is required          duration: UNKNOWN [Q5]
       │                                        ← the second largest, and the
       │                                          one most likely to be missed
  S5  First live claim into the kröfupottur    duration: hours

  ── PARALLEL, AND ALL OF IT CAN START TODAY ─────────────────────────────

  P1  Invoice document model + numbering        ✅ DONE this run
  P2  Reconciliation contract + state machine   ✅ DONE this run
  P3  Fail-closed delivery log                  ✅ DONE this run (contract)
  P4  Capture host kennitala at onboarding      NOT started  [needs Q-kt]
  P5  Decide the billing period against
      per-claim cost                            BLOCKED on Q6
  P6  B2B client implementation                 BLOCKED on S3 (needs the spec)
```

**What is serial:** S1 → S2 → S3 → S4 → S5. Nothing in that chain can be
compressed by working harder, which is exactly the property that made this the
long pole `[repo: prompt §0]`.

**What can overlap:** the whole of P1–P5 runs against the serial spine. P1–P3
are done. **P4 is the one that will bite** — it is a two-line onboarding change
that cannot be made retroactively for orgs already onboarded without going back
and asking them.

**What needs something Straumvakt does not have:**

| Step | Missing thing |
|---|---|
| S2 | Possibly nothing; possibly financial statements or AML documentation `[confirm: bank — Q4]` |
| S4 | A B2B client implementation, which needs the spec from S3 |
| P4 | Host kennitala on the org record `[confirm: Andri]` |
| Live claims | The answer to Q6, if per-claim cost changes the billing period |

**Where the unknowns sit — stated as instructed, "unknown — ask X this
question":**

- **S2 duration: unknown — ask the bank Q4.**
- **S3 duration: unknown — ask the bank Q4.**
- **S4 existence and duration: unknown — ask the bank Q5.** *This is the step
  that turns a fortnight into a quarter, and it is invisible until you ask.*
- **Whether S2 can start before a customer exists: unknown — ask the bank**
  *"Getum við skráð okkur sem kröfuhafa áður en við höfum viðskiptavini að
  innheimta hjá?"* If yes, the entire serial spine can run in the background
  starting today and never appears on the critical path again. **This is the
  highest-leverage question in the packet after Q1.**

---

## §3 — The comparison

### Route A — direct bank claim (krafa via RB)

| | |
|---|---|
| **Setup burden** | The full S1–S5 spine. Serial, externally paced. |
| **Ongoing cost** | Per claim, per slip, per change, per payment — see §3.5. |
| **Reconciliation quality** | **Best available.** Payments queryable from the kröfupottur by date `[src: Landsbankinn B2B handbook, via search]`. |
| **Failure modes** | Claim rejected at creation (svarskrá); wrong kennitala → claim addressed to nobody; claim created twice on retry → **payer sees two claims**; cancellation costs a fee and may be visible to the payer. |
| **Implication for the driver line later** | Best positioned — but see §4 on whether the registration transfers. |

### Route B — a service bureau / claims provider

A third party receives data from your accounting system and **creates the
claims in the bank on your behalf**, handling the banking relationship
`[src: kollekta.is / Alskil]`. They accept UBL NES and BII standards for direct
accounting-system integration, and can put a PDF in the payer's online bank
`[src: same]`.

| | |
|---|---|
| **Setup burden** | **Materially lower** — you integrate with one vendor instead of navigating S2–S4 `[inferred]`. |
| **Ongoing cost** | Their margin on top of bank fees `[confirm: provider — pricing]`. |
| **Reconciliation quality** | As good as their API. `[confirm: provider — do you return payment events with our own claim reference?]` |
| **Failure modes** | A dependency that sits between you and your money. Their outage is your outage; their data model is your ceiling. |
| **Implication for the driver line** | Possibly the *best* route for agent posture, since handling third-party claims is their business rather than a special case `[inferred]`. |

> **This route is under-weighted in `SERVICES.md`, which lists only bank-claim,
> Netgíró and card** `[repo: SERVICES.md:76-81]`. **It deserves a quote.** It is
> the only option that converts an unknown-duration serial chain into a vendor
> conversation, and it is the natural hedge if Q5 comes back with "yes, there
> is a mandatory test cycle."

### Route C — card or direct-debit mandate

| | |
|---|---|
| **Setup burden** | Card is **parked by FOCUS.md** and not on the path to the first invoice `[repo: SERVICES.md:133-134, FOCUS.md parked table]`. Direct debit (*beingreiðsla*) is part of the same bank rail — a claim can be paid by beingreiðsla `[src: Landsbankinn price list line "Krafa greidd í beingreiðslu"]`. |
| **Reconciliation quality** | High — payment is initiated against a known mandate. |
| **Failure modes** | Requires the payer to establish a mandate, which is a per-host onboarding step with a refusal rate `[inferred]`. |
| **Verdict** | Not a separate route. **A payment method *on top of* route A**, worth enabling once route A exists, not worth pursuing alone. |

### Route D — bank transfer against an emailed PDF (do-nothing baseline)

| | |
|---|---|
| **Setup burden** | **None.** A bank account and an IBAN on the PDF `[repo: SERVICES.md:78]`. |
| **Ongoing cost** | Zero marginal `[inferred]`. |
| **Reconciliation quality** | **Worst, and this is the whole objection.** An incoming transfer carries whatever reference the payer chose to type. Matching is manual or heuristic. |
| **Failure modes** | Unmatched payments accumulate; partial payments are invisible until someone reads a statement; a payer who pays the wrong invoice is discovered late. |
| **Implication for the driver line** | Does not scale to it at all — presenting many small claims for many hosts against free-text references is not a rail. |
| **Verdict** | **Correct for customer 1. Wrong as a destination.** Its cost is not fees; it is the reconciliation debt it silently accrues. |

### 3.5 The cost taxonomy — what you pay for, verbatim

Recovered from Landsbankinn's published price list `[src: Verðskrá
Landsbankans, gildir frá 23. apríl 2026]`. **Labels are verbatim; amounts are
not reproduced because the price list's column alignment could not be recovered
reliably from its text layer, and a plausible wrong fee is worse than a blank.**

| Fee event | Icelandic line label (verbatim) |
|---|---|
| Create a claim | *Stofnun kröfu* · *Stofnun kröfu (í netbanka fyrirtækja, B2B eða félagaþjónustu)* · *Stofnun kröfu í útibúi* · *Stofnun kröfu í tölvudeild (með Excel skjali)* |
| Change or cancel a claim | *Breyting/niðurfelling á kröfu* · *… (í netbanka fyrirtækja eða B2B)* · *… í útibúi* · *Niðurfelling valkröfu (gert af greiðanda)* |
| Print a slip | *Prentun greiðsluseðils* · *Prentun greiðsluseðils (sótt í útibú)* · *Prentun og útsending ítrekunar* |
| Post a slip | *Póstsending greiðsluseðils (Greiðsluveitan sendir)* · *Póstsending greiðsluseðils (útibú sendir)* |
| Send electronic documents | *Sending rafrænna skjala* |
| Receive a payment | *Greiðslugjald* · *Krafa greidd í beingreiðslu* · *Krafa innágreidd í banka* · *Greiðsla erlendrar kröfu* |
| Escalate | *Krafa send í framhaldsinnheimtu* · *Krafa flutt í framhaldsinnheimtu* · *Handvirk kröfubreyting/niðurfelling kröfu* |
| Dun | *Innheimtuviðvörun / viðvörunargjald* · *Ítrekun á innheimtuviðvörun* |
| Set up electronic presentment | *Stofngjald fyrir uppsetningu á rafrænni birtingu í birtingakerfi* |
| B2B queries | *Beinlínufyrirspurnir í B2B* |
| Custom work | *Sérstakar aðlaganir, endurgjald á klukkustund* |

**Three conclusions that follow from the taxonomy alone, without knowing a
single amount** `[inferred]`:

1. **A correction is charged twice** — once to cancel or change, once to
   create the replacement. This aligns with, and independently argues for, the
   credit-note-only correction model in the delivery packet §3.5: if you are
   paying per document either way, pay for the one that is legally safe.
2. **Electronic presentment and paper are separately priced**, so the
   svarskrá's "should a slip be printed" field is a **cost** signal as well as
   a delivery signal.
3. **Per-claim fees make monthly billing of a 200 kr/connector line a real
   question.** A single-connector host is a 200 kr invoice. If claim creation
   plus slip plus payment fee is a double-digit percentage of that, the billing
   period is wrong. **This is Q6 and it can change the product.**

---

## §4 — The agent-posture problem, addressed head on

**First, the thing that must not get lost:**

> **This does not block the market line.** The flat connector fee is
> Straumvakt's own money, on its own invoice, with Straumvakt as kröfuhafi. It
> needs no client account, no remittance, and no third-party-claims permission
> `[repo: FOCUS.md rule 3; prompt §6.4]`. **Everything in this section is about
> the deferred line only.**

### Which requirements belong to which line

| Requirement | Market line (Straumvakt → host) | Deferred line (host → driver) |
|---|---|---|
| Kröfuhafi registration in Straumvakt's own name | **Yes** | Not sufficient on its own |
| Straumvakt's kennitala as claim originator | **Yes** | The **host** is the kröfuhafi `[repo: FOCUS.md rule 3]` |
| Client / segregated account for money that is not yours | **No** | **Likely yes** `[confirm: accountant + bank — Q8]` |
| Remittance obligation and schedule | **No** | **Yes** `[repo: FOCUS.md rule 3 — "and remits"]` |
| Host must hold VAT registration | No | **Yes, and it governs the VAT on the claim** `[src: Skatturinn umboðssala rule — see delivery packet §2]` |
| Possible permission/licence to collect for others | **No** | **Unknown** `[confirm: Q8]` |
| Host's kennitala on file | Yes (as payer) | Yes (as **kröfuhafi**) |

### The three ways the deferred line can be built, and what each implies

1. **Straumvakt is kröfuhafi and remits.** Simplest technically. Puts other
   people's money through Straumvakt's account, which is the case most likely
   to need a client account and possibly a permission `[confirm: Q8]`.
2. **The host is kröfuhafi; Straumvakt operates their claims as an agent.**
   Matches FOCUS rule 3 exactly and matches the VAT rule — the host sells in
   their own name, so the host invoices `[src: Skatturinn]`. Landsbankinn's
   separate *"Umsókn um aðgang innheimtufyrirtækis að innheimtukröfum"* form
   suggests this is a supported, named arrangement `[src: landsbankinn.is form
   0913]`. **Most likely correct, and it is a per-host onboarding step rather
   than a one-time Straumvakt registration** — which is a product-design fact
   worth knowing a year early.
3. **A service bureau does it** (route B). Third-party claims are their
   business rather than an exception `[inferred]`.

### What choosing route A *now* costs the deferred line later

**Less than it looks, provided one thing is true in the data model:** that the
claim's originator is an explicit field and not "always Straumvakt".

That is precisely the guarantee built this run — `claimHolder` is a required,
explicit, never-inferred field on the invoice document, and a document may
carry exactly one posture `[repo:
packages/contracts/src/invoice/invoice-document.ts]`. **So the model is already
route-2-shaped.** The remaining cost of the deferred line is a registration
conversation and a remittance ledger, not a rebuild.

**Do not, however, let this section delay Q1–Q7.** The market line does not
need any of it.

---

## §6 — What can start today, before any decision

Named precisely. Nothing here waits on a bank, an accountant, or Andri.

| # | Action | Status |
|---|---|---|
| 1 | Invoice document model with explicit kröfuhafi and single-posture enforcement | ✅ **done this run** |
| 2 | Gap-free, tenant-scoped, retry-idempotent document numbering | ✅ **done this run** |
| 3 | Delivery-log contract with fail-closed semantics and the delivered / unknown / failed distinction | ✅ **done this run** |
| 4 | Dunning lifecycle, including the `externallyManaged` mode that prevents double-dunning against bank reminders | ✅ **done this run** |
| 5 | Reconciliation state machine — §7 | ✅ **done this run** |
| 6 | Offline validator returning why a document is not issuable | ✅ **done this run** |
| 7 | Header render rules for both postures, golden-file tested | ✅ **done this run** |
| 8 | **Capture host kennitala at onboarding** | ❌ **not started — the one remaining zero-dependency task, and the one with a retroactive cost** |
| 9 | Ask Q1, Q2, Q3 | ❌ Andri, minutes |
| 10 | Ask Q4–Q7 of one bank | ❌ one phone call — Landsbankinn publishes 410 4000 `[src: landsbankinn.is]` |

**Item 8 is the recommendation of this section.** Every other unstarted item is
someone else's clock. That one is Straumvakt's, it is small, and its cost rises
with every org onboarded without it.

---

## §7 — The reconciliation contract

Route-independent, and built this run:
[`reconciliation.ts`](../../packages/contracts/src/invoice/reconciliation.ts).

### What comes back from any rail, mapped to statement state

| Rail event | Statement state | Terminal? | Notes |
|---|---|---|---|
| Claim created / accepted | `presented` | no | The rail acknowledged it. **Not** payment. |
| Claim rejected at creation | `presentation_failed` | no | Retryable after correction. Must never read as delivered. |
| Paid in full | `settled` | **yes** | Only terminal-good state. |
| Partially paid | `part_settled` | no | Carries `outstanding`; dunning continues on the remainder only. |
| Overdue | `overdue` | no | Derived from due date + payments, never stored as fact `[inferred: a stored overdue flag goes stale the moment a payment lands]`. |
| Disputed | `disputed` | no | **Freezes dunning.** Requires operator action. |
| Cancelled by originator | `cancelled` | **yes** | Number stays spent — see delivery packet §3.2. |
| Returned / reversed | `returned` | no | Re-opens `outstanding`. The state people forget. |
| Overpaid | `overpaid` | no | **Not** `settled`. A credit exists and someone is owed money. |
| Escalated to framhaldsinnheimta | `in_collection` | no | Straumvakt stops dunning; the rail owns it `[src: §1.4]`. |

### Three invariants the contract enforces

1. **`settled` requires payments to equal the total exactly.** Over and under
   are distinct states, not rounding. An overpayment silently treated as
   settled is money owed to a customer that nobody knows about.
2. **A payment can arrive against a `cancelled` claim.** The rail is
   asynchronous; cancellation and payment can cross. The state machine accepts
   it and routes to `overpaid`/refund rather than rejecting the fact.
3. **Nothing in reconciliation writes to the invoice document.** The document
   is immutable after issue `[repo: FOCUS.md rule 4 — money derived from the
   record, never destructively]`. Payment state lives beside it.

---

## §8 — What was and was not established

**Established `[src:]`:** RB's kröfupottur as the clearing mechanism and
cross-bank visibility; that a signed collection-service agreement with a bank is
required; that creditors nominate a payout account and a fee-debit account; the
four interface channels including the B2B web service at `b2b.fbl.is`; claim
types almennar/valkröfur; svarskrá semantics including the print-slip flag;
bank-side automatic reminders and framhaldsinnheimta escalation; payment query
from the kröfupottur by date; the complete fee-line taxonomy verbatim; the
existence of a distinct application route for collection companies; the
service-bureau route and that it accepts UBL NES/BII.

**Not established, and not guessed:** every ISK amount; the S2/S3/S4 durations;
whether a test cycle is mandatory; whether registration can precede having
customers; whether the kröfuhafi's own reference survives the payment round
trip; whether agent-posture collection needs a different registration, a client
account, or a permission; whether the org record holds kennitala today.

**Each of those appears above as a numbered blocking question or a `[confirm:]`
line, with the exact wording to use.**

**Sources.**
[Landsbankinn — Innheimtuþjónusta](https://www.landsbankinn.is/fyrirtaeki/greidslur/innheimtuthjonusta) ·
[Landsbankinn — Handbók netbanka fyrirtækja: Innheimta](https://www.landsbankinn.is/Uploads/Documents/Netbanki/handbaekur/Handbok_netbanka_fyrirtaekja_Innheimta.pdf) ·
[Landsbankinn — B2B tæknihandbók](https://www.landsbankinn.is/Uploads/documents/FyrirtaekiFelog/landsbankinn_b2b_landsbankastadall.pdf) ·
[Landsbankinn — Umsókn um aðgang innheimtufyrirtækis að innheimtukröfum (form 0913)](https://www.landsbankinn.is/uploads/documents/form/0913_Umsokn_um_adgang_innheimtufyrirtaekis_ad_innheimtukrofum.pdf) ·
[Landsbankinn — Verðskrá, gildir frá 23. apríl 2026](https://www.landsbankinn.is/uploads/documents/verdskra/verdskra-2026-04-23.pdf) ·
[Íslandsbanki — Handbók um innheimtuþjónustu / Handbók kröfuhafa 2025](https://cdn.islandsbanki.is/image/upload/v1/documents/Handbok-krofuhafa-2025.pdf) ·
[Arion banki — Leiðbeiningar fyrir Innheimtuþjónustu](https://www.arionbanki.is/themes/arionbanki/arionbanki/documents/03_Fyrirtaeki/thjonusta/Innheimtuthjonusta/Notendahandb%C3%B3k_innheimtukrofur_arion%20banki_HO.pdf) ·
[Alskil / Kollekta — Greiðslumiðlun](https://www.kollekta.is/Grei%C3%B0slumi%C3%B0lun/) ·
[Skatturinn — Leiðbeiningar um virðisaukaskatt (RSK 1119)](https://www.skatturinn.is/media/baeklingar/rsk_1119.is.pdf)
