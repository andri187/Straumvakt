# Sprint 0 — Foundation Schema · Retrospective

**Dates:** through 2026-04-24
**Exit criterion:** All V3 schemas created, catalog seeded, tsc clean,
build clean, money as BIGINT minor units.
**Status:** **Met.**

---

## What shipped

| Milestone | Status | Evidence |
|---|---|---|
| 0.1 — Create all V3 Postgres schemas | ✅ | `prisma/schema.prisma` declares 18 schemas: `identity`, `tenancy`, `hosts`, `properties`, `assets`, `hardware`, `ocpp`, `charging`, `billing`, `issues`, `events`, `audit`, `entitlements`, `people`, `vendors`, `roaming`, `energy`, `webhooks`. |
| 0.2 — Core tables per schema | ✅ | ~45 models / ~30 enums landed in one file. Event log + idempotency in place. Installation, HardwareVendor, HardwareModel added late-sprint (ADR 0002). |
| 0.3 — Backfill CPMS data | N/A | Superseded by [ADR 0003](../adr/0003-no-cpms-backfill.md). Straumvakt is a clean rebuild; no data to migrate. |
| 0.4 — Money as BIGINT minor units | ✅ | All monetary columns are `BigInt`. `Decimal` appears only on non-money quantities (lat/lon, kW, voltage, current, SoC). |
| 0.5 — `withOrgContext` data-access layer | ✅ | [src/lib/repositories/_context.ts](../../src/lib/repositories/_context.ts) + 5/5 tests green — missing `orgId` throws, cross-tenant `where` clause throws, correct stamp passes. |
| 0.6 — Hardware Catalog seed (Zaptec + Zaptec Pro) | ✅ | [prisma/seed.ts](../../prisma/seed.ts) — idempotent upsert. Profile intentionally empty; specifics deferred per operator instruction. |

### Verification

- `npx prisma validate` — clean
- `npx tsc --noEmit` — exit 0
- `npm run build` — clean (Next.js 16.2.4 Turbopack, 1.24s compile, 8 pages)
- `npx vitest run` — 1 file, 5 tests, 5 pass

### Decisions made (ADRs)

- **[ADR 0001](../adr/0001-v3-foundation-schema.md)** — V3 Foundation
  Schema (17 schemas, append-only event log, tenancy in schema, money
  as minor units, two-contract commercial model).
- **[ADR 0002](../adr/0002-hardware-catalog-and-installations.md)** —
  Hardware Catalog + Installations. `hardware` schema, Installation
  layer in `properties`, credential-scope driven by model metadata
  (installation / identity / none).
- **[ADR 0003](../adr/0003-no-cpms-backfill.md)** — Milestone 0.3
  superseded. No CPMS data to migrate.

---

## What slipped

Nothing out of the committed scope. Two things adjusted during the
sprint — both properly captured as ADRs rather than silent drift:

1. **Hardware Catalog wasn't in the original V3 architecture.** It
   landed mid-sprint when onboarding-flow thinking surfaced that
   Zaptec/Easee credentials attach per installation while DC credentials
   attach per identity. Better to model it in Sprint 0 than retrofit
   in Sprint 4.
2. **Milestone 0.3 was stale.** The delivery plan assumed CPMS data
   would be ported. The clean-rebuild reality meant the milestone was
   moot. Closed as a no-op with ADR 0003.

---

## What changed in the plan

- Sprint 0 gained milestone **0.6** (catalog seed) in the mid-sprint
  scope edit.
- Sprint 5 milestone **5.5** gained "Hardware nav group" (vendor +
  model catalog pages) in the operator console.
- Schema namespace count: 17 → 18 (added `hardware`).
- Sprint 0 exit criterion updated accordingly (delivery plan §2, §3).

---

## Known follow-ups (carried forward, not blocking Sprint 1)

1. **SVG diagram is stale.** `docs/architecture/straumvakt_architecture_v3.svg`
   still shows the V3 hierarchy without the optional Installation layer
   and does not reflect the Hardware Catalog inset. Coordinate-math
   work — safer as a focused pass than a mid-sprint edit. ADR 0002
   flags this; to be scheduled against a quiet slot before Sprint 2.
2. **Catalog expansion.** Only Zaptec + Zaptec Pro seeded. Easee (AC),
   Kempower/Tritium (DC), Shelly (controller), generic-ocpp (fallback)
   to land as each integration enters scope — Easee in Sprint 1 or 2
   alongside first vendor adapter work, the rest in their respective
   sprints.
3. **Controller/Meter/Modem model catalog link.** Symmetry argues for
   adding `modelId` to `assets.controllers`, `assets.meters`,
   `assets.modems` too. Sprint 0 only linked `assets.chargers` per the
   operator's charger-first focus. Not blocking; file as a small
   hygiene ticket for whichever sprint first adds non-charger assets.
4. **Git remote not yet configured.** The repo is a fresh `git init`
   with no origin. Needs the operator to provision a remote before
   any Cloudflare deploy can happen. Rule 1 stays firm — no pushes
   in this session.
5. **Migration not yet applied to Neon.** Schema is in
   `prisma/schema.prisma` but `prisma migrate dev` / `prisma db push`
   has not been run against a Neon branch in this session. Rule 3
   reserved that for explicit operator instruction.

---

## One thing to carry into Sprint 1

**Rule 4 + Rule 5 vigilance stays up.** Sprint 1 is OCPP-foundation —
the event log becomes live, the domain-event translator is written,
the outbox dispatcher runs. All three are in "edit with instruction"
territory or "fundamental-logic stop" territory. Don't let "while I
was in there" creep in.

---

## Sign-off

Exit criterion met. Concrete has dried. Sprint 1 may begin once:

- The operator has configured a git remote and confirmed the
  branch/push sequence they want for this work.
- The operator has applied migrations to at least the dev Neon branch
  (either via `prisma migrate dev` locally, or an explicit named
  command in this session). The seed upsert will only succeed against
  an applied schema.
