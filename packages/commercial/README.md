# @straumvakt/commercial — *home, not yet filled*

**Empty on purpose.** This directory exists so the money engine has a
destination before it is harvested, not so anyone starts writing here.

## Scope, when it is filled

Parties · agreements · clauses · cost factors · cost centres · rate
references · the tariff/resolution engine · invoicing.

The **money engine** — one engine, carrying multiple money lines. It sits at
the top of the domain chain and may read everything below it; nothing below it
may read commercial.

## What arrives here, and from where

The proven resolver already exists and works: it emitted its first priced
billing lines on 2026-08-07 (128 lines, 64 sessions). **It gets harvested,
not rewritten** — that is the whole build model. Its earned correctness
includes bugs already found and fixed that a rewrite would reintroduce:

- the bearer-code case mismatch that silently rejected every clause in the
  database for three months
- two rate references pointing at the wrong supplier org
- the recency window that could never drain a backlog

Sources: `apps/api/src/lib/agreement/*` and the billing repositories.

## Why it is empty right now

**Rule 5.** Billing math, tariff resolution and cost computation are a
stop-and-ask boundary. The harvest is its own approval-gated pass; this pass
only builds the shell.

The vocabulary it will use — `MoneyLine`, `PartyRef`, `MoneyPosture` — is
already in `@straumvakt/contracts/money/lines`, deliberately, so the shape can
be agreed before any math moves.

## What must NOT happen here

- **No second billing path.** There have already been three generations
  (legacy pricing, agreements, and a fourth scaffold that never held a row).
  A fourth — even a "temporary simple" one — is the most expensive shortcut
  available. The flat connector fee is a *degenerate agreement*: one cost
  factor, one rate reference. A row, not a bypass.
- **No re-implementation.** If you find yourself writing a resolver, stop —
  one exists and it works.

## Reading

[FOCUS.md](../../FOCUS.md) rules 1 (harvest protocol), 3 (money lines), 8.
Legacy reasoning: ADR 0048 (which generation survives), ADR 0031 (agent vs
principal), ADR 0019 (agreements architecture).
