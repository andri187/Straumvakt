# Straumvakt at a glance

Measured 2026-08-06, not recalled. Regenerate before trusting after a big change.

## Deployables

| Service | Runtime | Name | Prisma |
|---|---|---|---|
| Console | Workers · Next.js 16 / OpenNext | `hlada` | none |
| API Worker | Workers · Hono | `hlada-api` | **89 files, 659 calls** |
| OCPP Gateway | Workers · Durable Object | `straumvakt-ocpp` | none, ever |
| Zaptec consumer | Fly.io | `…-consumer-staging` | none |
| Driver app | Flutter (Android) | — | n/a, HTTP only |

## Code

| Area | Files | LOC |
|---|---:|---:|
| API Worker | 229 | 55,175 |
| Console | 224 | 43,541 |
| Driver app | 32 | 12,952 |
| Migrations | 45 | 4,779 |
| Shared | 37 | 4,421 |
| **Gateway + DO** | **10** | **3,689** |
| Zaptec consumer | 6 | 953 |

## API surface

177 distinct endpoints across 44 mounts.
`admin` 140 · `driver` 19 · `public` 8 · `internal` 6 · `webhooks` 3.
GET 83 · POST 64 · PATCH 15 · DELETE 14 · PUT 1.

## Data

Neon Postgres (eu-west-2) via Hyperdrive.
**20** schemas · **98** models · **59** enums.
Branches: `staging` 540 MB (live) · `test` · `production` 37 MB (abandoned April fork) · 5 backups.

## Bindings

| Worker | Hyperdrive | DO | Queues | R2 | Services |
|---|---|---|---|---|---|
| Console | ✅ | | | | ✅ |
| API | ✅ | | ✅ | ✅ | ✅ |
| Gateway | | ✅ | ✅ | | ✅ |

## Tooling

Hono · Next 16 · React 18 · Tailwind · Zod · `pg` · Vitest (60 files: 656 unit + 35 parity) ·
dependency-cruiser (24 baselined) · Wrangler / OpenNext / Fly · GitHub Actions.
ORM: Prisma 7.8 outgoing, Drizzle 0.45 incoming — **98 tables declared, 10 files ported (~5%)**.

## Open discrepancies

- **45 migration folders on disk, 51 rows in `_prisma_migrations`.** Six applied
  migrations are not in the repo. `prisma migrate status` cannot be trusted, and
  a drizzle-kit handover needs a known baseline.
- **`SCOPE_2026-08-04.md` says 14 driver endpoints; there are 19.** S4 plans
  against the smaller number.
- **`production` branch predates everything** and has no `agreements` schema.
  Always pass an explicit `branchId`.

## Counting notes (why earlier figures were wrong)

- `grep … | grep -v generated` filters matched TEXT, not files — it counted the
  generated Prisma client and inflated calls ~4×.
- Ported code wraps: `await db\n  .select(…)`. Any pattern requiring `db.select(`
  contiguous misses most Drizzle calls. Collapse whitespace, allow `\s*` at dots.
