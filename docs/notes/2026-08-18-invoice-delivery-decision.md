# Invoice delivery — decision packet

**TASKS.md task 8, first half.** Written 2026-08-18 by `claude-b` in
`E:\Claude\Straumvakt-relops-b`. Companion:
[`2026-08-18-collection-krofuhafi-decision.md`](2026-08-18-collection-krofuhafi-decision.md).

**Every factual claim below carries a basis label.** The four labels are:

| label | means |
|---|---|
| `[repo]` | verified in this repository, path cited |
| `[src: …]` | verified against an external source, source named |
| `[inferred]` | reasoned from something else here, reasoning shown |
| `[confirm: who — question]` | not established; who must answer, and what to ask |

A packet whose confidence is uniform is a packet you cannot act on. Where a
number would have been plausible but unverified, it is a `[confirm:]` line
instead. **There are no unlabelled numbers in this document.**

---

## THE ANSWER — 194 words

**Ship the emailed PDF. Do not contract a PEPPOL access point yet.**

B2B e-invoicing is not mandatory in Iceland and there is no plan to make it so
`[src: EC eInvoicing Country Sheet — Iceland]`. The mandate binds the *public
sector* as receiver and its suppliers as senders — not you billing a private
host `[src: same]`. PDF is legally sufficient for the market line today.

**But two parts of this decision are not reversible, and they are not the
format.** They are:

1. **Invoice numbering.** Iceland requires invoices *"fyrirfram tölusett með
   áprentuð númer í samfelldri töluröð"* — pre-numbered, unbroken sequence
   `[src: Skatturinn, Skráning tekna]`. **Gap-free.** A number you skip is a
   defect you cannot repair later, because the documents are already out.
2. **Header semantics.** Whether the kröfuhafi is stored explicitly or inferred
   from context. PDF will happily render a wrong header; PEPPOL will not.

Build both to the strict standard now, render PDF. PEPPOL then costs an access
point contract and a mapper — **weeks, not a rebuild** — because EN 16931 has a
Payee field (BG-10) that expresses the agent posture correctly
`[src: EN 16931 / PEPPOL BIS 3.0]`.

**Decide the renderer late. Decide numbering and the header now.**

---

## 1. The options, as commitments

Not "what does it do" — *what does choosing it oblige Straumvakt to, forever.*

### Option A — plain PDF by email

| | |
|---|---|
| **Build** | Invoice document model; a PDF renderer; fail-closed delivery. All three are needed by every other option too `[inferred]`. |
| **Buy** | Nothing beyond the existing Resend account `[repo: SERVICES.md:26]`. |
| **Register for** | Nothing `[src: EC country sheet — B2B voluntary]`. |
| **Ongoing obligation** | 7-year retention of the issued document `[src: Basware compliance map — Iceland, 7-year retention]` `[confirm: accountant — is the retention obligation satisfied by retaining the rendered PDF, or must the underlying accounting record be retained in a system meeting the rafrænt bókhald declaration requirement?]`. Gap-free numbering `[src: Skatturinn]`. |
| **Forecloses** | Nothing structural. It does **not** foreclose PEPPOL `[inferred: the ledger is format-agnostic; only the renderer differs — SERVICES.md:67 already says this and it holds]`. |
| **Real risk** | Free text renders anything, including a legally wrong header, and no validator objects. This is why Phase 4 of this run exists. |

### Option B — PDF plus a structured attachment

A PDF carrying an embedded XML payload (the Factur-X / ZUGFeRD pattern).

| | |
|---|---|
| **Build** | Everything in A, plus the XML mapper — i.e. most of the PEPPOL work, without the network. |
| **Buy** | Nothing. |
| **Register for** | Nothing. |
| **Ongoing obligation** | Two representations of one invoice that must never disagree. That is a permanent correctness burden `[inferred]`. |
| **Forecloses** | Nothing. |
| **Verdict** | **Pays the cost of PEPPOL and collects none of its benefit.** No Icelandic counterparty is asking for an embedded payload `[confirm: customer 1 — do you require a structured invoice, and if so in which format?]`. Recommended only if a customer asks for structured data but cannot receive PEPPOL — a case that has not appeared. |

### Option C — PEPPOL BIS Billing 3.0 via an access point

| | |
|---|---|
| **Build** | A UBL 2.1 mapper conforming to EN 16931 `[src: EC country sheet — UBL 2.1 and CII]`, plus handling of access-point responses (transport-level accept/reject is a *different* signal from business acceptance) `[inferred]`. |
| **Buy** | An access point contract — Unimaze, InExchange, Basware, EDICOM, Storecove are the names already on file `[repo: SERVICES.md:62]`. `[confirm: access point vendors — setup fee, monthly minimum, per-document price at ~10–100 documents/month?]` |
| **Register for** | A PEPPOL participant identifier, obtained through the access point `[inferred: this is how PEPPOL onboarding works generally]` `[confirm: access point — is the participant ID issued by you, and does it require anything from Straumvakt beyond a kennitala?]`. The Icelandic PEPPOL Authority is FJS `[src: EC country sheet]`. |
| **Ongoing obligation** | The access-point contract is a recurring cost that exists whether or not you send an invoice that month `[inferred: this is the normal shape of AP contracts]` `[confirm: vendor — is there a monthly minimum?]`. Validation failures become a delivery failure class you must operate. |
| **Forecloses** | Nothing — but it commits you to keeping a mapper conformant as BIS versions roll. Iceland's public sector stopped accepting the older BII formats (TS-136/TS-137) on **2026-07-01**, accepting only PEPPOL BIS 3.0 `[src: CentaraIQ — Iceland drops BII July 2026]`. **That date has already passed.** It is evidence that format versions do get retired on a schedule you do not control. |

### Option D — TS-236 / rafrænn reikningur

TS-236 is **not an alternative to PEPPOL**. It is the Icelandic national
specification *implementing* PEPPOL BIS Billing 3.0, published by Icelandic
Standards, conforming to EN 16931 `[src: EC country sheet; ecosio Iceland]`.

**Correction to how SERVICES.md frames this.** `SERVICES.md:55-56` reads as
though "PEPPOL BIS Billing 3.0 **with** the Icelandic TS-236 specification" are
two things you adopt together — which is nearly right — but the register's
option table at `:62` then lists "PEPPOL via access point" as the single
non-PDF option, and §5 of the prompt asks for TS-236 as a *separate* option.
**It is not a separate option.** Choosing PEPPOL for Iceland *is* choosing
TS-236, because TS-236 is the national extension applied to domestic documents
`[src: EC country sheet]`. There is no third path where you do TS-236 without
PEPPOL transport. This removes one option from the decision rather than adding
one.

### Option E — hybrid

Send PDF by email to every host; additionally send PEPPOL to hosts who ask.

| | |
|---|---|
| **Build** | Both renderers, plus per-recipient delivery-channel configuration and the state to track *two* deliveries of one document `[inferred]`. |
| **Ongoing obligation** | The hard one: **one invoice, two delivery channels, and the question "was it delivered?" now has two answers.** The delivery log must model per-channel outcomes or it will report "delivered" when only the weaker channel succeeded. |
| **Verdict** | The correct *end state*, and the wrong *starting point*. Reach it by adding PEPPOL to A when a customer asks — not by building both now. |

---

## 2. What each option means for the two money lines

The question that decides this section: **can the format carry a claim where
the kröfuhafi is the host and the presenter is Straumvakt?**

| Option | Market line (principal) | Deferred line (agent, "Straumvakt f.h. \<host\>") |
|---|---|---|
| **A — PDF** | Fine. | **Expressible but unenforced.** Free text can render anything. Nothing stops a wrong header. |
| **B — PDF + XML** | Fine. | Same as C for the XML half, same as A for the PDF half — and they can disagree. |
| **C/D — PEPPOL/TS-236** | Fine. | **Expressible and enforced** — see below. |
| **E — hybrid** | Fine. | Inherits both. |

### PEPPOL can express the agent posture, and this is the load-bearing fact

EN 16931 defines **BG-10 Payee**, with **BT-59 Payee name** and **BT-60 Payee
identifier**. BT-59 *shall* be provided when the Payee differs from the Seller;
the standard's own worked example for this is a factoring company — payment
going to a party that is not the seller `[src: EN 16931 / PEPPOL BIS Billing
3.0 documentation]`. In UBL that is `cac:PayeeParty`, and it is omitted
entirely when payee and seller are the same `[src: same]`.

So the agent line maps as:

```
AccountingSupplierParty  = the host        ← the seller, the kröfuhafi, whose VAT this is
PayeeParty (BG-10)       = Straumvakt      ← who receives the money and remits it
AccountingCustomerParty  = the driver / bill object
```

and the market line maps as:

```
AccountingSupplierParty  = Straumvakt      ← seller and payee are the same party,
(PayeeParty omitted)                          so BG-10 is absent, per the standard
```

**This is not a workaround.** It is the modelling the standard was designed
for, and it is stricter than a PDF: a PEPPOL document either names a supplier
with a resolvable identity or fails validation.

**Therefore nothing here disqualifies PEPPOL for the deferred line.** The
prompt asked whether a format that cannot express "Straumvakt f.h. \<host\>"
should be ruled out. **None of the five options fails that test.** The
distinction is weaker and more useful: PDF *permits* the right header, PEPPOL
*requires* it.

### The real constraint on the agent line is not the format

It is the host's identity. A PEPPOL agent-posture invoice needs the **host** to
have a resolvable legal identifier, because the host is the supplier
`[inferred from the mapping above]`. A host with no kennitala on file cannot be
a supplier in any format — and in PDF that failure is silent.

**Consequence, and it is a Phase 3/4 requirement, not a future one:** an
invoice whose kröfuhafi has no registered identity must be **refused at
construction**, not rendered with a blank. That is implemented in this run —
see [`invoice-document.ts`](../../packages/contracts/src/invoice/invoice-document.ts)
and the `header` tests.

### The VAT posture corroborates the split

Icelandic VAT treats commission/consignment sale (*umboðssala*) by who sells
**in whose name**: the party who collects VAT on goods received in umboðssala
and **sells in his own name** is the one who issues the invoice for that sale
`[src: Skatturinn — VAT guidance / RSK 1119]`. Straumvakt presenting *f.h.* the
host is explicitly **not** selling in its own name — so the host issues and
Straumvakt presents, and the host's VAT registration governs.

This is independent confirmation of FOCUS.md rule 3 from the tax side rather
than the architecture side `[repo: FOCUS.md:96-131]`. It also means:

> **The agent line's VAT is the host's, at the host's registration status.**
> A host who is not VAT-registered produces a claim with no VAT on it — which
> is a *different document*, not the same document with a zero. `[inferred]`
> `[confirm: accountant — for a non-VAT-registered host, what must and must not
> appear on a claim Straumvakt presents on their behalf?]`

---

## 3. Legal and tax surface

### 3.1 Is there a structured-format mandate, and whom does it bind?

**B2G: yes. B2B: no.** Regulation 44/2019 transposed EU Directive 2014/55/EU in
January 2020, requiring public entities at national and sub-central level to
receive and process electronic invoices based on TS-236 `[src: EC eInvoicing
Country Sheet — Iceland]`. Receiving is mandatory for contracting authorities;
sending is mandatory for economic operators supplying the public sector
`[src: same]`. **B2B and B2C are not mandatory and there is no plan to make
them so**, though usage is widespread and B2B requires buyer consent
`[src: same]`.

**Who this binds, applied to Straumvakt:**

| Straumvakt's counterparty | Structured invoice required? |
|---|---|
| A private host org (customer 1 and the expected pipeline) | **No** `[src: above]` |
| A municipality, ministry, or state-owned body as a host | **Yes** — Straumvakt becomes a supplier to a contracting authority `[src: above]` `[confirm: Andri — is any prospective host a public body or municipally owned? A single municipal car park flips this.]` |

**Since 2026-07-01, Icelandic public bodies accept only PEPPOL BIS 3.0**, the
BII formats TS-136/TS-137 having been withdrawn `[src: CentaraIQ]`. So the
public-sector path has exactly one format and no fallback.

### 3.2 Sequential numbering — this is the strict one

Invoices must be *"fyrirfram tölusett með áprentuð númer í samfelldri
töluröð"* — pre-numbered, printed numbers, **unbroken sequence** — and
numbering generated only at print time by a computer is explicitly **not**
sufficient `[src: Skatturinn — Skráning tekna]`. The seller must keep a copy in
sequence order `[src: same]`. Regulation 50/1993 is the governing instrument
`[src: reglugerd.is nr. 50/1993]`.

**Three design consequences, all implemented in this run:**

1. **Gap-free, not gap-tolerant.** Settled by the source above, not by
   preference. See §"Numbering" in
   [`invoice-number.ts`](../../packages/contracts/src/invoice/invoice-number.ts).
2. **A cancelled invoice consumes its number.** You cannot un-issue a number to
   close a gap; the document is recorded as cancelled and the number stays
   spent `[inferred: a gap and a reused number are both breaks in "samfelld
   töluröð"; only the void-in-place option is neither]`.
3. **Allocation must be transactional with issue.** Allocate-then-fail leaves a
   gap. Tested under concurrency, retry, crash-mid-issue and year rollover.

`[confirm: accountant — does "fyrirfram tölusett … áprentuð" permit a
system-allocated sequence in a bookkeeping system that meets the rafrænt
bókhald conditions, or is a pre-printed physical stock still contemplated for
some issuers? Straumvakt reads it as the former; that reading should be
confirmed once, cheaply, before the first issue.]`

### 3.3 Required invoice content

Required on a sales invoice, including an electronic one: *"Útgáfudagur. Nafn,
kennitala og skráningarnúmer seljanda"* — issue date; seller name, kennitala
and VSK registration number — plus buyer name and identity, description of
goods/services, quantity, unit price, total, and **VAT stated separately by
rate** `[src: Skatturinn — Skráning tekna, quoting the regulation]`.

Mapped onto the document model built in this run: `issuer`, `claimHolder`,
`recipient`, `issueDate`, `lines[].{description, quantity, unitPrice, unit}`,
`lines[].vat`, `totals.byVatRate` — all mandatory, all validated `[repo:
packages/contracts/src/invoice/invoice-document.ts]`.

### 3.4 Retention

**7 years** `[src: Basware compliance map — Iceland: Peppol BIS 3.0 & 7-year
retention]` — consistent with `SERVICES.md:57` `[repo]`. The Skatturinn page
consulted states retention obligations without naming the count `[src:
Skatturinn — Skráning tekna]`, so the 7-year figure rests on the secondary
source and on the repo's prior research, not on a primary text read in this
run.

`[confirm: accountant — 7 years from issue date or from end of the financial
year? This changes the earliest safe deletion date by up to 12 months, and it
is the kind of thing that is cheap to get right on day one and expensive to
reconstruct.]`

### 3.5 Credit notes and corrections

The regulation contemplates correction documents `[src: reglugerd.is nr.
50/1993 — the instrument covers invoice form and content; the specific
correction article was not read in this run]` `[confirm: accountant — must a
correction be a credit note against the original number, or may an invoice be
reissued? Straumvakt's model assumes credit-note-only.]`

**The model implements credit-note-only**, because it is the option that is
safe under both answers: a credit note is valid wherever reissue is, and reissue
is not valid wherever the original has already been delivered `[inferred]`. A
correction therefore emits **two** documents and consumes **two** numbers.

### 3.6 What makes an invoice legally *issued* rather than merely emailed

This is the question that makes fail-closed delivery a legal matter and not a
UX preference.

For an electronic invoice, the requirement for a signed original is treated as
met if a signed printed copy is available to each party to the purchase along
with the statement `[src: reglugerd.is / skattalagasafn — reg. 50/1993 as
summarised in search of the instrument]`. Electronic bookkeeping additionally
requires a declaration — *"yfirlýsing seljanda eða hönnuðar hugbúnaðarins"* —
that the system meets the electronic-bookkeeping requirements `[src: Skatturinn
— Skráning tekna]`.

**That declaration is a task nobody has on a list.** It is not code. It is a
statement Straumvakt or its software author signs about its own system.

`[confirm: accountant — does Straumvakt need to file or hold a "yfirlýsing
seljanda eða hönnuðar hugbúnaðarins" for its invoicing system before issuing
the first invoice, and if so to whom?]` **This is the single cheapest thing in
this packet to get wrong and the single easiest to fix early.**

**Straumvakt's working position, pending that answer** `[inferred]`: issuance is
the act of committing the numbered, immutable document to the ledger —
*delivery is a separate fact with its own state.* An invoice can be legally
issued and undelivered. It must never be delivered and unissued. The model
enforces the second by making the number a construction-time input.

---

## 4. The recommendation

**Emailed PDF for launch. PEPPOL when a customer asks, or on the first public-
sector host — whichever comes first.**

**Reasoning, shown:**

1. No mandate binds the market line `[src: EC country sheet]`, so PEPPOL buys
   compliance you already have.
2. The cost of PEPPOL is not the mapper — it is the access-point contract, a
   recurring cost incurred per month regardless of volume `[inferred]`. At
   customer-1 volume this is the dominant term.
3. The ledger is format-agnostic and the invoice model does not change between
   them `[repo: SERVICES.md:67 — and this run's model was built to hold]`.
4. The genuinely irreversible parts of this decision — numbering and header
   semantics — are being built to the stricter standard **now**, so PEPPOL later
   is a mapper, not a migration.

**Conditions under which it flips — any one is sufficient:**

| Flip condition | Why |
|---|---|
| Customer 1 requires PEPPOL in procurement | Their requirement, not yours; no argument wins it. |
| Any host is a public body or municipally owned | B2G mandate binds you as supplier `[src: EC country sheet]`, and since 2026-07-01 only BIS 3.0 is accepted `[src: CentaraIQ]`. |
| Invoice volume crosses the AP break-even | See §6 — the crossing point is a formula here, not a number. |
| Straumvakt starts presenting host→driver claims at scale | Not because PEPPOL is needed, but because per-host supplier identity stops being optional, and PEPPOL enforces what PDF only permits `[inferred]`. |

**What would raise confidence, in order of value per minute spent:**

1. Ask customer 1 the procurement question. One email. Removes the largest
   single unknown in this packet.
2. Get one access point to quote setup + monthly + per-document. Converts §6
   from a formula into a number.
3. Ask the accountant the four `[confirm: accountant]` questions in §3. They are
   all cheap, and two of them (numbering, the yfirlýsing) touch the first
   invoice.

---

## 5. Reversibility — which half of this decision are you actually making

**This is the section to read if you read only one.**

### Effectively permanent

| Thing | Why it cannot be undone |
|---|---|
| **The number on an issued invoice** | It is in the counterparty's books and in yours. A gap cannot be closed retroactively; a reused number cannot be un-reused `[src: samfelld töluröð requirement]`. |
| **The header on a delivered invoice** | A wrong kröfuhafi on a delivered document is corrected by issuing a credit note and a new invoice — visible to the customer, and consuming two more numbers `[inferred]`. |
| **The VAT treatment applied on an issued document** | Corrected the same way, with a tax consequence attached `[inferred]`. |
| **Whether a legal entity ever appeared as supplier on a claim** | Cannot be retracted from the recipient's records. |

### Changeable in six months at low cost

| Thing | Cost to change |
|---|---|
| **PDF → PEPPOL** | An access-point contract plus a mapper. The document model does not change `[repo: model built format-agnostic this run]`. |
| **Which access point** | A contract change; PEPPOL is a network, not a vendor lock `[inferred: that is the point of a four-corner model]`. |
| **The PDF's visual design** | Trivial — and golden-file tests make a change to it visible in review rather than in a customer's inbox `[repo: this run]`. |
| **Email provider (Resend → other)** | The delivery-log contract is provider-agnostic by construction `[repo: this run]`. |
| **Dunning schedule and thresholds** | Configuration `[repo: this run]`. |

**So: the format is the changeable half. Numbering, header semantics and VAT
posture are the permanent half.** The decision that feels like the decision —
PDF or PEPPOL — is the reversible one. Andri is being asked to decide the
reversible half; the irreversible half is being *built* correctly rather than
decided, which is why it is not on his list.

---

## 6. Cost model

**No ISK figures are quoted for vendor pricing.** They were not obtainable from
this machine, and a plausible wrong number is worse than a formula. What
follows is the shape, with named unknowns.

**Assumptions**, all stated:

- Volume `N` = invoices per month. At customer 1, `N` is single-digit
  `[inferred: one host org, one invoice per period]`.
- Straumvakt is already paying for Resend and Cloudflare `[repo: SERVICES.md]`,
  so email delivery carries **no marginal cost** below the Resend free tier of
  3,000/month `[repo: SERVICES.md:26]`.

| Term | PDF by email | PEPPOL via AP |
|---|---|---|
| **Setup, one-off** | `0` — build cost only | `AP_setup` `[confirm: AP vendor]` |
| **Per month, fixed** | `0` marginal `[repo: SERVICES.md:26]` | `AP_monthly` `[confirm: AP vendor — is there a monthly minimum?]` |
| **Per invoice** | `0` marginal below 3,000/mo `[repo]` | `AP_per_doc` `[confirm: AP vendor]` |
| **Build, one-off** | PDF renderer | UBL mapper + response handling |
| **Operational** | Bounce handling | Bounce handling **plus** validation-failure handling `[inferred]` |

**Where the ranking changes:** PEPPOL never wins on cost at low `N` — its cost
is `AP_monthly + N·AP_per_doc` against approximately zero. It wins on
*eligibility*: the moment a counterparty requires it, price is not the
criterion. The break-even against a **manual** process is different and more
useful:

> PEPPOL beats PDF when `AP_monthly + N·AP_per_doc` < the cost of the human
> minutes PDF delivery consumes at volume `N` — i.e. when invoicing stops being
> automated-with-supervision and starts being someone's afternoon.

`[inferred]` With the fail-closed rail built in this run, PDF's per-invoice
human cost is intended to be zero in the happy path and non-zero only on
exception — so this crossing point is **far out**, and it moves further out the
better the delivery log is.

**The honest summary of §6:** the cost question does not decide this. The
procurement question (§4, flip condition 1) does.

---

## 7. Appendix — what was and was not verified

**Verified against external sources this run:** the B2G/B2B mandate split and
its scope; TS-236's relationship to PEPPOL BIS 3.0 and EN 16931; the
2026-07-01 BII withdrawal; the continuous-numbering requirement and its
verbatim Icelandic wording; required invoice content; the electronic-bookkeeping
declaration; the EN 16931 BG-10/BT-59/BT-60 Payee construction and its UBL
binding; the umboðssala "in his own name" VAT rule; 7-year retention
(secondary source).

**Not verified, and not guessed:** any access-point price; whether customer 1
requires PEPPOL; the retention start date; the credit-note-vs-reissue rule; the
yfirlýsing filing requirement; whether a system-allocated sequence satisfies
"fyrirfram tölusett". Each appears above as a `[confirm:]` line naming who to
ask and what to ask them.

**Sources.**
[EC eInvoicing Country Sheet — Iceland](https://ec.europa.eu/digital-building-blocks/sites/spaces/einvoicingCFS/pages/718735701/2024+Iceland+2024+eInvoicing+Country+Sheet) ·
[Skatturinn — Skráning tekna](https://www.skatturinn.is/atvinnurekstur/virdisaukaskattur/skraning-tekna/) ·
[Reglugerð nr. 50/1993](https://www.reglugerd.is/reglugerdir/allar/nr/050-1993) ·
[Skatturinn — Leiðbeiningar um virðisaukaskatt (RSK 1119)](https://www.skatturinn.is/media/baeklingar/rsk_1119.is.pdf) ·
[Basware compliance map — Iceland](https://www.basware.com/en/compliance-map/iceland) ·
[CentaraIQ — Iceland drops BII, PEPPOL BIS 3.0 only from July 2026](https://centaraiq.com/news/peppol-mandatory-iceland-2026/) ·
[PEPPOL BIS Billing 3.0](https://docs.peppol.eu/poacc/billing/3.0/bis/) ·
[PEPPOL BIS 3.0 — cac:PayeeParty](https://docs.peppol.eu/poacc/billing/3.0/syntax/ubl-invoice/cac-PayeeParty/cac-PartyIdentification/cbc-ID/) ·
[ecosio — E-invoicing compliance in Iceland](https://ecosio.com/en/compliance/iceland/e-invoicing/)
