# Session checkpoint — 2026-04-24, deploy paused on infra decision

Status snapshot at the point Thor paused to consult the board on
whether to set up WSL, enable Windows Developer Mode, or provision a
dedicated dev machine. Resumption directions at the end.

## Code state

Sprint 0 + Sprint 1 are feature-complete in code. All work lives on
branch `dev/sprint-01-ocpp-foundation` on
[github.com/andri187/Straumvakt](https://github.com/andri187/Straumvakt).

Tip of branch: `688505a` — `[Sprint 1] 1.5 Control-plane verification`.

Commits in order, oldest first:

| Commit | Subject |
|---|---|
| `aa53e95` | [Sprint 0] V3 foundation schema + hardware catalog + installations |
| `6597fa7` | [Sprint 0] V3 foundation migration + citext extension + Neon-adapter seed |
| `7d6b17a` | [Sprint 0] Login page: version + build time footer |
| `4ddc1d0` | [Sprint 0] Add Sprints 0-1 Gantt timeline SVG |
| `24f0ef3` | [Sprint 1] 1.1 OCPP event ingest — event-log-first + idempotent |
| `0a9d3b1` | [Sprint 1] 1.2 OCPP 1.6J translator + projection handlers |
| `893512a` | [Sprint 1] 1.3 Outbox + dispatcher — one OCPP command end-to-end |
| `3633f86` | [Sprint 1] 1.4 OCPP gateway Worker + real Service Binding dispatch |
| `688505a` | [Sprint 1] 1.5 Control-plane verification (staging-deployable) |

Local verification at last commit:
- Main app — 86 tests / 10 files / tsc clean / build clean
- Gateway — 24 tests / 2 files / tsc clean

`master` branch on the remote is empty (zero commits). All Sprint 0/1
work lives on the feature branch above.

## Cloudflare deploy state

| Worker | URL | Code | Notes |
|---|---|---|---|
| `straumvakt-ocpp-staging` | `straumvakt-ocpp-staging.straumvakt.workers.dev` | Sprint 1.4 + 1.5 — LIVE | `/health` returns 200 `ok`. Real `Source: Upload` deployment at `2026-04-24T23:39:27Z`. |
| `hlada-staging` | `hlada-staging.straumvakt.workers.dev` | Stale (Sprint -1 from `2026-04-23T20:42`) | Build fails on Windows symlink permission during OpenNext bundling. **Blocker.** |
| `hlada` (production) | `hlada.straumvakt.workers.dev` | CPMS production | Untouched. Connected to `andri187/CPMS` repo via Git integration. **Do not modify without intent.** |
| `straumvakt-ocpp` (production, 5d ago) | `straumvakt-ocpp.straumvakt.workers.dev` | CPMS-era | Untouched. 28 requests in last day — actively used. **Investigate before retiring.** |
| `straumvakt` (5d ago) | `straumvakt.straumvakt.workers.dev` | Unknown | Orphan / leftover. Investigate later. |

The `hlada-staging` Git integration was disconnected from CPMS by the
operator during this session.

## Cloudflare account info

- Account: `Andrith187@gmail.com's Account` — id
  `1b2fc4c163e8544e9cd472baa5a19c74`.
- Account subdomain: `straumvakt` (so workers resolve at
  `<worker-name>.straumvakt.workers.dev`).
- Wrangler authenticated locally with full workers + secrets_store
  scopes.

## Cloudflare Secrets state

**`hlada-staging`** (8 entries):
- Set by this session: `AUTH_SECRET`, `ADMIN_EMAIL`,
  `ADMIN_PASSWORD`, `DATABASE_URL`, `DIRECT_URL`, `OCPP_INGEST_SECRET`.
- Pre-existing / operator-set, intentional: `admin@straumvakt.is`,
  `OCPP_ADMIN_SECRET`.

`ADMIN_PASSWORD` was set to a value the operator typed in chat
(redacted from this file 2026-04-25 — value rotated; see
"Outstanding cleanup" §1 below). Should be rotated post-first-use
because the plaintext touched chat history.

**`straumvakt-ocpp-staging`** (1 entry):
- `OCPP_INGEST_SECRET` — same value as on `hlada-staging` (set from
  the same generated secret in one shell).

## Neon DB state

Project `Straumvakt` (id `spring-leaf-73019190`), region eu-west-2.

| Branch | Branch ID | Endpoint | State |
|---|---|---|---|
| `production` | `br-fragrant-bonus-abrc01g6` | (default) | Has CPMS leftover; never received V3 schema. |
| `staging` | `br-tiny-river-abgpqq37` | `ep-quiet-bird-abxartp8` | **V3 schema applied** (migration `20260424090905_v3_foundation`). Hardware catalog seeded (1 vendor `zaptec` + 1 model `zaptec-pro`). Public schema dropped + recreated to clear CPMS leftover from parent. |
| `dev` | `br-restless-tree-abd19drp` | `ep-cold-waterfall-abxxo8w1` | V3 schema applied. Used by local `npm run dev`. Password was visible in terminal output earlier; rotation deferred to operator. |

## What blocks Sprint 1 close-out

The Sprint 1.5 control-plane smoke test (per
[docs/runbooks/1.5-staging-deploy-and-real-charger.md](../runbooks/1.5-staging-deploy-and-real-charger.md))
needs a working `hlada-staging` deploy. The OpenNext build step fails
on Windows with:

```
EPERM: operation not permitted, symlink
'E:\Claude\Straumvakt\node_modules\@prisma\client' ->
'.open-next\server-functions\default\.next\node_modules\@prisma\client-...'
```

Windows blocks symlink creation for non-admin users by default.
OpenNext's Windows compatibility warning explicitly flags this.

## Decision pending — three options for unblock

1. **Windows Developer Mode** — 30 seconds, lets non-admin processes
   create symlinks, immediate unblock. Stays as-is otherwise.
2. **WSL on this machine** — 30–40 minutes setup (install Ubuntu,
   Node, wrangler auth, project access). Long-term cleanest path on
   the existing laptop. Officially recommended by OpenNext.
3. **Dedicated dev machine** — cloud VM (Hetzner ~€10/mo) or
   physical Linux box. Bigger setup, board decision. Best
   isolation, easiest second-engineer onboarding later.

Operator paused on 2026-04-24 to consult the board.

## Resumption directions

When the decision lands, the resume flow is:

1. Provision the chosen environment (one of the three above).
2. From that environment, against this branch:
   ```
   npx opennextjs-cloudflare build
   npx wrangler deploy --env staging
   ```
3. Verify `hlada-staging.straumvakt.workers.dev/api/internal/ocpp-auth`
   returns 401 (not 404). 401 means Sprint 1.4+ code is live.
4. Run the
   [Sprint 1.5 runbook](../runbooks/1.5-staging-deploy-and-real-charger.md)
   from §2 (provision an OCPP identity) onwards. Sections §0 (secrets)
   and §1 (deploy gateway) are already done.
5. After successful real-charger smoke test, write
   `docs/retros/sprint-01.md` and merge `dev/sprint-01-ocpp-foundation`
   → `staging` branch on the remote (operator action — Rule 1).
6. Begin Sprint 2 (OCPI Foundation) per delivery plan §5.

## Outstanding cleanup independent of the deploy decision

- **Rotate dev Neon branch password.** Surfaced in terminal output
  earlier; replace via Neon Console → dev → Roles → reset password.
  Update `.env.local` (operator action — Rule 2). Restart dev server.
- **Rotate `hlada-staging` `ADMIN_PASSWORD`.** Plaintext value passed
  through chat. `npx wrangler secret put ADMIN_PASSWORD --env staging`
  and type a new value at the prompt.
- **Rotate the Zaptec portal password** the operator pasted earlier —
  before Sprint 2 (vendor adapter track) starts using it.
- **SVG diagram update** — flagged in ADR 0002. The architecture SVG
  doesn't yet show the Installation layer or Hardware Catalog inset.
  Not a blocker for any sprint; do during a quiet slot.
- **Investigate the existing `straumvakt-ocpp` (prod, 28 req)
  Worker.** What's hitting it? Is it a CPMS-era OCPP gateway still
  doing real work? Decide whether to retire or migrate.

## What stays safe while paused

- All code is on GitHub.
- Gateway worker is stable on staging (just doesn't have a peer to
  talk to until main-app deploys).
- Dev environment runs locally on `localhost:3001`.
- No timer running, no auto-rollback, no expiring credentials.
