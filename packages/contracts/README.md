# @straumvakt/contracts — the canonical vocabulary

**The shapes every part of the platform has to agree on.** One home, so the
operator console, the API, the gateway and the driver app cannot drift apart.

Harvested out of `@straumvakt/shared` on 2026-08-08. Nothing was deleted:
`shared` re-exports every path here, so all 127 files importing from it kept
working. New callers should import from `@straumvakt/contracts` directly; old
ones move when they are next touched (FOCUS.md rule 1).

## What is here

| Path | What |
|---|---|
| `./domain/*` | DTO / UI types — 19 modules, pure types |
| `./inputs/*` | Input shapes — zod schemas + their inferred types, 10 modules |
| `./vendor/adapter` | The vendor-adapter **interface**. No vendor code |
| `./money/lines` | The money-line **shape**. No math |

## What is deliberately NOT here

- **The Drizzle schema.** That is the database's source of truth and stays in
  the db package (today `@straumvakt/shared/db/*`). A vocabulary package that
  also owns the schema is a vocabulary package that owns everything.
- **Domain logic.** Types describe; modules decide. Logic is harvested into
  `core` / `commercial`, later.
- **Vendor code.** `packages/vendors/<name>` implements the interface here and
  is the only place a vendor is named.
- **Billing math.** Rule 5. `./money/lines` says *whose money and what our
  role is*; it computes nothing.
- **The OCPP event vocabulary.** The gateway is untouched by this pass; its
  vocabulary is harvested when the gateway is next touched, not speculatively.

## The two new pieces

**`./money/lines`** — a shape, not two constants. The market has two live
concerns (Straumvakt↔host, principal, live; host↔driver, agent, parked) and
three parked ones, and they differ only in `whoseMoney`, `posture` and
`counterparty`. Hardcoding the two would make the third a schema change
instead of a row. `claimHolder()` is derived rather than stored so the
kröfuhafi and the earning party can never disagree.

**`./vendor/adapter`** — the interface an adapter must satisfy. It exists so
"add a vendor" becomes an implementation of something already tested rather
than a porting exercise. The conformance suite that tests against it is a
later pass; 22 dependency-cruiser baseline entries are what it will remove.

## Publishing

Semver'd and export-mapped, so publishing is a flag flip. `private: true`
stands until there is a consumer outside this repo — publishing to a registry
nobody reads is ceremony, and ceremony is what FOCUS.md rule 8 retires.

Linked with `"*"`, npm's workspace linkage. (`workspace:*` is pnpm/yarn and
npm rejects it outright.)
