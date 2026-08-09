# Release-candidate verification — `dev/relaunch-release-candidate`

Local verification record for the relaunch release candidate. Nothing here was
pushed, deployed, or run against a live database. Regenerate the numbers by
re-running the commands below; do not hand-edit them.

Last verified: 2026-08-09, branch `dev/relaunch-release-candidate`.

## What the candidate contains

Six prepared changes on top of `14c1ce2`, in order — secret hygiene
(`174475f`), Prisma migration-path repair (`6b9246e`), API-endpoint doc repair
(`0a2943c`), `check:work-view` wiring (`b2250e5`), custom-domain and CI
credential docs (`d4e2e07`), trunk proposal (`5324241`) — plus the parity
harness repair and the check-hardening work recorded below.

Deliberately excluded, and still absent: `4fe0a95` (Worker rename), `30fa407`,
`5311cbd`.

## Offline verification matrix

Every command below runs with no database, no credential, and no network.

| Command | Result |
| --- | --- |
| `npm run check` | 10 of 11 pass — `work-view` red by decision, below |
| `npx tsc --noEmit` | pass |
| `npm --prefix apps/api run typecheck` | pass (both tsconfigs) |
| per-workspace `tsc --noEmit` — shared, commercial, contracts, gateway, zaptec-consumer | pass |
| `npm test` | 51 files, 676 passed, 1 skipped |
| `npx next build --webpack` | pass — 9 routes, middleware registered |
| `npm --prefix apps/api run test:parity` (no `PARITY_DATABASE_URL`) | 2 files pass, 13 skipped; harness smoke tests run, no connection |
| `git diff --check` | clean |

Generator checks are idempotent: `check:api-endpoints`, `check:deps-graph`,
`check:schema-consistency`, `check:migrations-visible` and
`check:workspace-typecheck` all pass twice in a row, and re-running the
generators leaves the tree clean.

## The one red check: `work-view`

`npm run work-view` writes `src/app/(app)/admin/work/page.tsx`. That file does
not exist on this lineage — the relaunch archived the whole console, 161 files,
to `archive/straumvakt-org-console-2026-08-08/`, including this page.

Regenerating therefore does not repair drift. It resurrects a parked page, and
a build with it present adds a live `ƒ /admin/work` route — verified, then
reverted.

It also changes who can see it. The archived `(app)/layout.tsx` called
`GET /api/admin/me` and routed by persona, redirecting a `host_admin` away.
That layout is archived. On this lineage the only thing above the page is
middleware's `protectedAppRoute`, which proves a session exists but not that it
is an operator — so the page's repo-health internals (task status, ADR counts,
Prisma/Drizzle port progress, vendor-leak counts) would be readable by any
authenticated driver or host admin.

That is a product and access-control decision, not generated drift, so the
check is left red rather than silenced. **Decision required:** either the
console page returns deliberately with its role gate, or `check:work-view` is
scoped out on the relaunch line.

## Running the real-DB parity suite (needs approval)

The parity suite is **not** read-only. It creates and deletes fixtures — org,
property, site, installation, agreement, driver group, users — in a guaranteed
`afterEach`. It must never point at staging or production.

    PARITY_DATABASE_URL=<url-of-an-approved-disposable-branch> \
      npm --prefix apps/api run test:parity

Without that variable the suite skips every database test and still runs the
harness smoke tests, which is what CI and a credential-less laptop get.

## Check-pipeline integrity

All 11 checks are wired into `scripts/check-all.mjs`; there are no orphans.
`check:migrations` is excluded on purpose — it needs a live `DATABASE_URL`.

Three checks were hardened after being shown to pass vacuously or to skip
silently. Each was fool-tested: the mutation is described, was reverted
immediately, and is not in Git.

| Check | Failure it could hide | Fool-test |
| --- | --- | --- |
| `schema-consistency` | both parsers empty compared 0 tables to 0 and printed agreement | empty fixture dirs → now exits 1 |
| `workspace-typecheck` | `--if-present` skips a package with no script, pipeline still says PASS | delete `typecheck` from `packages/shared` → exits 1 naming it |
| `migrations-visible` | no `migrations.path`, so `migrate status` saw nothing and said "up to date" | delete `path:` from `prisma.config.ts` → exits 1 |

`check:deps` was probed for the same weakness and is sound: it exits 1 on a
missing path rather than passing over an empty glob.

The parity harness has its own non-connecting smoke test. Its first version was
wrong — it asserted `new PrismaClient()` constructs, which still passed with
the WASM loader deleted, because the client compiles lazily. Replaced with a
direct assertion on the `?module` import, which does fail under that mutation.

## CI and secret surface

- Two workflows: `check.yml` (push to `**` and `pull_request`) and
  `zaptec-consumer-deploy.yml`.
- No `pull_request_target` anywhere.
- `check.yml` defines **no** `env:` block. Its only `secrets.DATABASE_URL`
  mention is inside a comment block describing the future Tier-1 wiring, so no
  secret reaches the job that runs on every branch and PR.
- `zaptec-consumer-deploy.yml` uses `FLY_API_TOKEN_ZAPTEC_CONSUMER` but never
  triggers on `pull_request` — push to three named branches plus manual
  dispatch only.
- `.env.example` keeps `AUTH_SECRET`, `ADMIN_EMAIL` and `ADMIN_PASSWORD` blank.
- Tracked-tree scan for private keys, tokens, DSNs and connection strings:
  nothing. The one long hex constant in `apps/api/src/routes/public/driver.ts`
  is a dummy PBKDF2 hash used to equalise login timing against user-enumeration
  probes — a defence, not a credential.
- No build output, `.env.local`, `node_modules` or generated client is tracked.

## Approval gates — none of these were executed

1. Merging or pushing this candidate anywhere, including toward
   `origin/staging`, which is still treated as a production deploy pointer.
2. The `work-view` decision above.
3. Reconciling the two pending staging migrations
   (`20260807003000_drop_issues_scaffold`,
   `20260807120000_drop_never_used_tables`), both applied by hand and neither
   recorded.
4. Tier 1 of `CI_MIGRATION_CHECK_CREDENTIAL.md` — a scoped read-only role for
   `check:migrations`. Tier 0 (offline, no credential) is implemented and wired.
5. Any real-DB parity run, per the command above.

## Known non-blocking issue

`next build` warns that the `middleware` file convention is deprecated in
Next 16.2 in favour of `proxy`; the route table already prints
`ƒ Proxy (Middleware)`. It works today. Renaming `src/middleware.ts` to
`src/proxy.ts` is a separate decision, kept out of this candidate so the
relocation stayed a pure move.
