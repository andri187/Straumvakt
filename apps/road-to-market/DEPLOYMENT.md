# Straumvakt test frontend — deployment, rebuild, rollback (test app ONLY)

## What was deployed
- **Worker:** `straumvakt-test` — Cloudflare account `1b2fc4c163e8544e9cd472baa5a19c74`.
- **URLs:** https://test.straumvakt.org (custom domain) + https://straumvakt-test.straumvakt.workers.dev
- **Live version:** `05edd489-1d9f-4190-b110-5b63b85032e5`
  (history: `28da2349` initial → `6e9a4e97` custom domain → `05edd489` +workers_dev).
- **Bindings:** only `ASSETS` (static frontend). **No** gateway/queue/cron/R2/email. Secrets:
  `AUTH_SECRET`, `DATABASE_URL` (pooled `straumvakt_test`). External effects are impossible.

## Isolation guarantees (verified 2026-09-11 after deploy)
- `straumvakt.org` → 200, `www.straumvakt.org` → 200, `api.straumvakt.org/api/admin/me` →
  `{"error":"unauthorized"}` — all **unchanged**; no apex/www/api Worker was touched.
- The custom domain only added `test.straumvakt.org`. No other DNS/route changed.
- Cookie is host-only (`straumvakt_test_session`, no Domain) — cannot collide with `*.straumvakt.org`.
- DB is the isolated `straumvakt_test` (branched off `production`, not `staging`) — no live data.

## Rebuild (frontend) & redeploy
```bash
# 1. rebuild the connected console (src -> public/app.js)
cd E:/Claude/Straumvakt-connected-test/apps/road-to-market/frontend
node build.cjs

# 2. deploy worker + assets (uses the Windows-authenticated wrangler OAuth login)
cd ../                      # apps/road-to-market
../../node_modules/.bin/wrangler deploy
```
Secrets are set once (already done):
```bash
printf '%s' "<auth-secret>"      | wrangler secret put AUTH_SECRET
printf '%s' "<pooled-test-conn>" | wrangler secret put DATABASE_URL
```

## Re-provision the test DB (if needed)
```bash
# fresh schema (idempotent): drops non-system schemas, creates citext/btree_gist, applies 0000-0008
TEST_DB_DIRECT="<direct straumvakt_test conn>" node scratchpad/apply-migrations.cjs
# synthetic seed (2 orgs, drivers, chargers, sessions); PBKDF2 at 100000 iters (Workers cap)
TEST_DB_DIRECT="..." node scratchpad/seed.cjs
```

## Rollback (test app only — never affects apex/www/api)
- **Roll back a version:** `wrangler rollback --name straumvakt-test [<version-id>]`
  (e.g. to `28da2349`); or redeploy a prior build.
- **Remove the hostname:** delete the Custom Domain `test.straumvakt.org` for `straumvakt-test`
  in the Cloudflare dashboard (Workers & Pages → straumvakt-test → Settings → Domains), or remove
  the `routes` entry from `wrangler.jsonc` and redeploy.
- **Tear down entirely:** `wrangler delete --name straumvakt-test` (removes the Worker + its
  custom domain), then delete the Neon branch `test-to-market` (`br-royal-recipe-abas9e5u`) in the
  Neon console. Neither affects any production resource.

## Test accounts (synthetic)
Password for all: `Straumvakt-Test-2026!`
- `admin@straumvakt-test.is` — platform operator (super_user) — sees all orgs.
- `host@nordurorka-test.is` — host_admin of **Norðurorka Test** (3 chargers, 2 drivers, 6 sessions).
- `host@vestan-test.is` — host_admin of **Vestan Test** (2 chargers, 1 driver, 3 sessions).
