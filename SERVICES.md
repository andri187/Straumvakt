# SERVICES — paid services register

What Straumvakt pays for, what it depends on, and what is still unscoped.
Snapshot 2026-08-08.

**Secret NAMES only.** No value appears here, ever. Values live in the
Cloudflare dashboard / Fly secrets (CLAUDE.md Rule 2).

`owner` = the account holder. Fill the blanks; this file does not guess.

---

## Register

| Provider | Use | Tier | Plan / cost | Market | Owner | Secret name(s) |
|---|---|---|---|---|---|---|
| **Cloudflare — Workers** | `hlada` (console), `hlada-api`, `straumvakt-ocpp` (gateway) | Local/Dev/Staging/Prod | Workers Paid **~$5/mo** base + usage | **critical** | *(operator)* | `AUTH_SECRET`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `OCPP_INGEST_SECRET`, `OCPP_CRED_KEK` |
| **Cloudflare — Durable Objects** | one DO per OCPP identity; live WebSocket state | with Workers | included in Workers Paid + usage | **critical** | *(operator)* | — |
| **Cloudflare — Queues** | inbound OCPP events; outbound commands; DLQs | with Workers | included + per-operation | **critical** | *(operator)* | — |
| **Cloudflare — Hyperdrive** | pooled Postgres in front of Neon | with Workers | included | **critical** | *(operator)* | binding `HYPERDRIVE_DB` |
| **Cloudflare — R2** | raw OCPP archive (legacy ADR 0018/0037) | Prod (+Staging) | $0.015/GB-mo, **no egress fee** | deferred — archive not yet writing | *(operator)* | — |
| **Cloudflare — Cron** | billing tick, Zaptec sync, sweeper | all | included | **critical** | *(operator)* | — |
| **Cloudflare — Rate Limiting** | admin-login throttle | all | included | important | *(operator)* | binding `ADMIN_LOGIN_RATE_LIMITER` |
| **Neon** | Postgres, multi-schema. Branches: prod · staging · **dev (new)** · test (parity) | all | see **Dev-tier cost** below | **critical** | *(operator)* | `DATABASE_URL` (per branch) |
| **Fly.io** | `zaptec-consumer` — Azure Service Bus claim-check | one shared app | **~$2–5/mo** (shared-cpu-1x) | important — vendor sync only | *(operator)* | Azure SB connection string, `OCPP_INGEST_SECRET` |
| **Resend** | transactional email — invites, verification, host-application notices | all | free ≤3k/mo, then ~$20/mo | **critical** *(see note)* | *(operator)* | `RESEND_API_KEY` |
| **Observability** | **NONE beyond `wrangler tail`** | — | $0 | **gap** | — | — |
| **Auðkenni** | Icelandic electronic ID | — | **not integrated** | parked | — | — |
| **Card processor** | driver card payments | — | **not integrated** | **parked** (FOCUS.md) | — | — |

### Notes on the register

**Resend is wired.** `RESEND_API_KEY` is read by `apps/api/src/lib/email.ts`;
`host-applications.ts` sends through it, and it **fails open** — a missing key
logs and continues rather than blocking a submit. That is right for an
application notice and **wrong for an invoice**: a silently unsent invoice is
indistinguishable from a sent one. Invoice delivery must fail *closed*.

**Observability is a genuine gap.** No Sentry, no log drain, no uptime check.
Today the only tool is `wrangler tail`, which requires someone to be watching.
Legacy ADR 0018 assumed dashboards land at Sprint 10; they did not. Not
market-blocking on its own, but the first invoice run is a bad moment to
discover it.

---

## INVOICE RAIL — market-critical, choice PENDING

**The pipeline is not done until the host can receive and pay.** Two halves,
each with an open decision.

### Delivery

B2B e-invoicing is **voluntary** in Iceland — there is no mandate forcing a
format. The standard, where used, is **PEPPOL BIS Billing 3.0** with the
Icelandic **TS-236** specification, both conforming to the European norm
**EN 16931**. Statutory retention is **7 years**.

| Option | What it takes | Fits |
|---|---|---|
| **Emailed PDF** *(MVP)* | render + attach + send. Legally valid for B2B. | customer 1, and probably the first several |
| **PEPPOL via access point** | contract an access point — Unimaze, InExchange, Basware, EDICOM, Storecove — and map to BIS 3.0 / TS-236 | scale, and any customer whose AP procurement requires it |

> **[DECISION PENDING — PDF vs PEPPOL for launch]**
> Not picked here. What it hinges on: whether customer 1 asks for PEPPOL. If
> not, PDF ships weeks earlier and the ledger is format-agnostic either way —
> the invoice model does not change, only the renderer.

### Collection

The domestic rail is the **bank claim** — *krafa* / *greiðsluseðill* — cleared
through **Reiknistofa bankanna (RB)**. Straumvakt registers as **kröfuhafi**
with a bank; the claim appears in the host's online bank and they pay it there.
This is how Icelandic businesses expect to be billed.

| Option | Effort | Fits |
|---|---|---|
| **Bank transfer + emailed invoice** | none — a bank account and an IBAN on the PDF | **customer 1**, immediately |
| **Bank claim (krafa via RB)** | register as kröfuhafi with a bank; claim file format + reconciliation | the real rail; expected by hosts at any volume |
| Netgíró | third-party invoice-credit | consumer-leaning; not the B2B fit |
| Card | — | **parked** (FOCUS.md) |

> **[DECISION PENDING — which bank for kröfuhafi registration]**
> Not picked here. This is the longer lead time of the two — bank onboarding
> is measured in weeks, not days, so **starting it early is free optionality**
> even if customer 1 pays by transfer.

**Status: options researched; rail choice pending operator decision.**

**Sources:** PEPPOL BIS Billing 3.0 (OpenPEPPOL); TS-236 (Icelandic technical
specification for e-invoicing); EN 16931 (European standard on electronic
invoicing); Reiknistofa bankanna (the Icelandic banks' clearing house).
*Provided as research input to this task; the standard names are citable, the
specific vendor pricing is not verified here.*

---

## DEV-TIER COST DELTA

What a shared Dev tier adds on top of today.

| Line | Always-hot | Scale-to-zero |
|---|---|---|
| Neon compute — 0.5 CU | **≈ $39/mo** | **a few $/mo** |
| Neon storage | $0.35/GB-mo | same |
| Neon branches | **free** beyond compute | free |
| Cloudflare Workers | ~$5/mo base (already paid — **no delta**) | no delta |
| Fly — extra app | ~$2–5/mo | ~$2–5/mo |
| **Delta** | **≈ $40–50/mo** | **≈ $5–15/mo** |

Neon rates: Launch **$0.106/CU-hr**, Scale **$0.222/CU-hr**; storage
**$0.35/GB-mo**; branches billed on compute only.

**Recommendation: scale-to-zero on Dev.** A shared dev branch is idle most of
the day, and the cold-start cost lands on developers rather than on chargers —
Dev has no charger traffic. It turns a ~$45/mo line into a ~$10/mo one for a
few seconds of latency nobody is paged about.

> **[INPUT NEEDED — which Neon plan is active (Launch or Scale)?]**
> The delta above is rate-sensitive; Scale is ~2.1× Launch per CU-hour.
>
> **[INPUT NEEDED — should Dev be always-hot?]**
> Only worth it if something automated must reach Dev on a schedule.

---

## Gaps worth naming

1. **Invoice delivery + collection — unscoped, market-critical.** Both
   decisions above. The collection half has the longer lead time.
2. **Observability — none.** No error tracking, no log drain, no uptime check.
3. **Email fails open.** Correct for notices, wrong for invoices.
4. **Card processing — parked**, deliberately, and not on the path to the first
   invoice.
