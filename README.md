# Straumvakt

A charging operating platform. Clean V3 rebuild.

> **This is a fresh workspace.** The prior CPMS workspace is archived under
> `E:\Claude\CPMS`. Infrastructure (Cloudflare Workers `hlada` and
> `hlada-staging`, Neon Postgres) is reused; the codebase is not.

---

## Where to start

| You want to… | Open |
|---|---|
| Understand the architecture | [`docs/architecture/README.md`](./docs/architecture/README.md) |
| See the sprint plan | [`docs/architecture/STRAUMVAKT_V3_DELIVERY_PLAN.md`](./docs/architecture/STRAUMVAKT_V3_DELIVERY_PLAN.md) |
| Know the rules | [`CLAUDE.md`](./CLAUDE.md) |
| Run the app locally | See below |

## Prerequisites

- Node.js ≥ 20
- npm
- A Cloudflare account with access to the `hlada` / `hlada-staging` Workers (for deploy)
- A Neon Postgres project (EU region — Frankfurt recommended) with a staging branch

## Local development

```powershell
# 1. Install dependencies
npm install

# 2. Copy .env.example → .env.local and fill in AUTH_SECRET, ADMIN_EMAIL, ADMIN_PASSWORD.
#    Minimum config required for the login shell to work.
cp .env.example .env.local

# 3. Generate a strong AUTH_SECRET
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
# (paste the output into .env.local as AUTH_SECRET)

# 4. Start the dev server
npm run dev

# Open http://localhost:3000 — you'll be redirected to /login.
# Click "Admin" in the top-right of the login card, sign in with ADMIN_EMAIL / ADMIN_PASSWORD.
```

## Deploy

Staging and production deploys use `@opennextjs/cloudflare`. Cloudflare auto-deploys on push:

- push to `staging` branch → `hlada-staging.straumvakt.workers.dev`
- push to `master` branch → `hlada.straumvakt.workers.dev`

Manual deploy (not via git push):

```powershell
# Deploy to staging (hlada-staging)
npm run deploy:staging

# Deploy to production (hlada)
npm run deploy
```

Before any real deploy, confirm per-worker secrets are set in the Cloudflare
dashboard: `AUTH_SECRET`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`, and (later)
`DATABASE_URL`, `DIRECT_URL`.

## Project layout

```
straumvakt/
├── docs/
│   └── architecture/   ← canonical reference (V3). Read this first.
├── middleware.ts       ← admin session verification, header sanitisation
├── prisma/             ← Sprint 0 lands the V3 schema here
├── public/             ← favicon, logos
├── src/
│   ├── app/
│   │   ├── login/          ← login page
│   │   ├── (app)/          ← authenticated shell (sidebar + dashboard)
│   │   └── api/admin/      ← admin auth endpoints
│   ├── components/     ← UI shell
│   └── lib/            ← admin session, i18n, utilities
├── tailwind.config.ts  ← Straumvakt brand tokens
└── wrangler.jsonc      ← Cloudflare Worker config (hlada + hlada-staging)
```

## Status

Sprint –1 complete: login shell live. The login screen, dashboard, session
auth, and dev/staging/prod wiring are in place. The Prisma schema is
deliberately empty — Sprint 0 lands the full V3 schema in one coherent pass.

Next up: Sprint 0 — Foundation Schema. See the delivery plan.
