# PROPOSED G — "Invoice" is reserved for a document that exists

**Status:** Proposed · **Date:** 2026-08-09 · **Decision owner:** product
**Register:** D-6

## Context

`GET /api/driver/invoices` returns the driver's actual charge sessions from
`charging.sessions` — its own comment says so. No invoice document is generated
anywhere in the system. `/sessions/history` reads a different table
(`reports.session_ledger`, the projected subset), so the two surfaces disagree
in both content and latency: a just-finished session appears in one before the
other.

Codex's `ae5db26` already stopped labelling the list as invoice documents on the
client.

## Options

1. Rename the surfaces: "Charging history" and "Billable sessions".
2. Build real invoice documents and keep the name.
3. Ship as "Invoices".

## Recommended

**Option 1 now, Option 2 when invoicing exists.** Option 3 is a factual
misstatement to a paying customer.

Vocabulary this proposes to fix:
- **billing record** — a chargeable session with a computed cost
- **invoice** — an issued document with a number, period and payable total
- **receipt** — evidence of payment

## Consequences

The API route is still named `/invoices`. Renaming it is a breaking change for
any consumer; the honest interim is that the route name is legacy and the
product surface does not repeat it.

## Unresolved

Which side owns invoice generation, and whether the ledger or the session table
becomes the single driver-facing source (audit P1-3).
