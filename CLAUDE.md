# CLAUDE.md — persistent rules for Straumvakt

> **ACTIVE CANON: read [/FOCUS.md](./FOCUS.md) first.**
>
> The safety rules below (**Rules 1–4**) remain in force, unchanged.
>
> The planning, sprint-discipline, and ADR-ceremony sections are superseded
> by FOCUS.md for the market phase.

Read this first on every new session. These are not preferences — they are
hard rules. Violating them causes real damage (data loss, accidental
production deploys, pricing bugs). When a rule says "stop and ask,"
actually stop and ask — don't attempt a clever workaround.

---

## Severity conventions

> [!CAUTION]
> **CRITICAL !!!** — Rules marked this way can cause irreversible damage:
> production deploys from the wrong branch, leaked secrets, wiped databases,
> silent billing bugs. If you are about to violate one, **stop immediately**
> and surface the action to the user before proceeding. No exceptions.

> [!IMPORTANT]
> **IMPORTANT** — Rules marked this way enforce discipline. Violating them
> doesn't break production but accumulates debt that becomes expensive to
> unwind. Treat as firm, not negotiable.

---

## Project context

**Straumvakt** — Iceland-focused charging operating platform. Clean V3
rebuild; supersedes the prior CPMS workspace.

**Stack:**
- Next.js 16 (App Router, Turbopack) deployed to Cloudflare Workers via
  OpenNext
- Prisma 7 (Neon adapter) + Neon Postgres EU — lands in Sprint 0
- Separate OCPP gateway worker — lands in Sprint 1
- Two Cloudflare Workers (reused from CPMS infra): main app (`hlada`) and
  OCPP server (`straumvakt-ocpp`, Sprint 1)

**Current state:**
- Sprint –1 complete — login shell live (admin HMAC session, login form,
  empty dashboard, dev/staging/prod Cloudflare wiring)
- Prisma schema deliberately empty — full V3 schema lands in Sprint 0 in
  one coherent migration
- No mock data anywhere — do not reintroduce

**Source of truth for planning:**
- `docs/architecture/README.md` — **index and reading order. Start here.**
- `docs/architecture/STRAUMVAKT_ARCHITECTURE_V3.md` — architecture canon
- `docs/architecture/STRAUMVAKT_V3_DELIVERY_PLAN.md` — execution canon
- `docs/architecture/straumvakt_architecture_v3.svg` — visual map

---

## Deploy environments

Three-tier setup. Know which one you're touching at all times.

| Env | Branch | Worker | URL | Neon branch |
|---|---|---|---|---|
| **Local** | any | — | `localhost:3000` | scratch / local dev |
| **Staging** | `staging` | `hlada-staging` | `hlada-staging.straumvakt.workers.dev` | `staging` |
| **Production** | `master` | `hlada` | `hlada.straumvakt.workers.dev` | primary |

Cloudflare auto-deploys on push:
- push to `staging` → staging Worker rebuilds
- push to `master` → production Worker rebuilds

**Promotion flow:**

```
feature branch ──► merge to staging ──► test on hlada-staging
                                              │
                                              ▼
                                         merge to master ──► hlada (customers)
```

**wrangler.jsonc:**
- Root `vars` = production config.
- `env.staging.vars` = staging config.
- Neither block holds secrets — those are Dashboard-only per Rule 2.

---

## Rule 1 — Branch and deploy safety

> [!CAUTION]
> **CRITICAL !!!** — Violation here can trigger a production Cloudflare
> deploy of half-finished or broken code. There is no "undo deploy"
> button.

**Never commit to `master` directly.** Every change starts on a feature
branch. Branch naming: `dev/<topic>`, `feat/<topic>`, `fix/<topic>`.

**Never push to any remote without stating the branch.** Before
`git push`, print the current branch name and confirm it is not
`master` unless the user explicitly asked you to push master.

**Never open or merge a PR.** That is a user action. You propose, the
user decides.

---

## Rule 2 — Environment and secrets

> [!CAUTION]
> **CRITICAL !!!** — Leaking a connection string or secret into git
> history is irreversible.

**Never modify** `.env.local`, `.env`, `.env.*`, or any file containing
connection strings, API keys, or secrets.

**Never echo** the contents of a connection string, Neon URL, OCPP
webhook secret, or any Cloudflare environment value to the chat.

**Never add entries to `wrangler.jsonc` `vars`** for anything sensitive.
Production environment values live in the Cloudflare dashboard.

### Carve-out A — deterministic non-secret substitution

Claude **may** modify `.env.local` / `.env*` files via a non-interactive
in-place substitution (`sed -i`, single-key Edit, or equivalent) when
**all** of the following hold:

1. **Both** the search and replace operands are non-secret values
   (hostnames, port numbers, path prefixes, schema names, branch IDs,
   endpoint IDs — values that already appear in chat or in public
   documentation).
2. The command does **not** print the file's contents to stdout
   (no `cat`, `head`, `tail`, `grep` of secret-containing lines).
3. The operator has named the substitution explicitly in the current
   message (e.g., "swap `ep-A-pooler` for `ep-B-pooler` in the
   DATABASE_URL host").
4. After the substitution, Claude verifies via the redacting grep
   pattern already permitted: `grep <KEY>= .env.local | sed -E
   's|(://)[^@]+@|\1<creds>@|'`.

This carve-out **does not** permit:

- Inserting or replacing a secret value (passwords, tokens, keys).
- Reading or echoing the password component of a connection string.
- Writing a freshly-generated secret to disk via this path
  (regenerated `AUTH_SECRET` / `OCPP_INGEST_SECRET` etc. remain
  operator-only).

If a swap requires changing both a non-secret component and a secret
component (e.g., Neon branches with different role passwords), Carve-out
A covers only the non-secret half — the operator handles the secret
half.

---

## Rule 3 — Database operations

> [!CAUTION]
> **CRITICAL !!!** — A wrong `DATABASE_URL` combined with `migrate
> reset --force` wipes the target database with no confirmation.

**Never run `prisma migrate deploy`** unless the user explicitly names
that command in their current message.

**Never run `prisma migrate reset`** without first stating which
database it will target (host extracted from `DATABASE_URL`) and
waiting for go-ahead.

**Never run raw SQL** (`prisma db execute`, `psql`, `pg_dump`, etc.)
against a connection string that does not clearly resolve to
`localhost` or a user-confirmed dev branch.

---

## Rule 4 — Fragile-infrastructure files

> [!IMPORTANT]
> **IMPORTANT** — Edit-with-instruction files.

The following files require an explicit instruction naming the file
before you edit them:

- `middleware.ts`
- `wrangler.jsonc`
- `open-next.config.ts`
- `src/lib/admin-session.ts`
- `prisma/schema.prisma` — additive changes only, no renames, no drops,
  no reshaping existing models

"While I was in there" is not a valid reason to edit any of these.

---

## Rule 5 — Fundamental-logic stops

> [!CAUTION]
> **CRITICAL !!!** — Silent changes to billing math, tariff resolution,
> or access precedence can corrupt closed sessions, mis-invoice drivers,
> or leak data across tenants.

Before writing code for any change that would alter:

- OCPP handler semantics
- Billing math or cost computation
- Tariff resolution (CustomerPlan, ChargerServicePlan)
- Access-grant resolution or routing precedence
- Issue Engine routing precedence
- OCPI tariff / CDR translation
- Any rule in `docs/architecture/STRAUMVAKT_ARCHITECTURE_V3.md`

...stop and summarise what the change does, what breaks, and why you
think it's correct. Wait for approval before writing code.

---

## Rule 6 — No mock data, ever

> [!IMPORTANT]

- No fixture arrays in `src/`.
- No `isMock ? mockData : realQuery()` branches.
- No `([] as T[]).find(() => false)` stand-ins.
- No in-memory stores on `globalThis`.
- No hardcoded placeholder strings in pages. Empty state = empty state.

---

## Rule 7 — Repository + mapper pattern

> [!IMPORTANT]

Pages and API routes **do not use Prisma types directly**. All data
access goes through `src/lib/repositories/*.ts` with mappers to UI
types.

- Every repository function takes tenant (`org_id`) as its first
  argument.
- Every repository function has a typed return.
- Page components consume the UI types, not Prisma types.

---

## Rule 8 — Commit discipline

> [!IMPORTANT]

- One logical change per commit.
- Commit message format: `[Sprint NN] concise summary`
  (e.g. `[Sprint 0] V3 foundation schema + tenant-scoped repositories`).
- Never bundle unrelated changes into one commit.
- Never commit while `npx tsc --noEmit` is red, except where a sprint
  milestone explicitly says "may leave tsc red, fixed in next milestone"
  — in those cases the commit message must say "intentional WIP — next
  milestone follows."
- Never commit generated files (`.open-next/*`, `.next/*`, `.prisma/*`).

---

## Rule 9 — Pre-session verification

> [!IMPORTANT]

At the start of any non-trivial session, before writing code, run:

```powershell
git status                # confirm clean starting point
git branch --show-current # confirm feature branch, not master
npx tsc --noEmit          # baseline type-check
npx prisma validate       # baseline schema check (once Sprint 0 lands)
```

Do not start from a dirty working tree or a broken baseline.

---

## Rule 10 — End-of-session verification

> [!IMPORTANT]

Before calling any non-trivial session "done":

```powershell
npx tsc --noEmit          # must be clean
npm run build             # must succeed
git status                # confirm expected files changed
git diff --stat           # confirm expected scope
```

If anything fails, do not commit. Fix first.

---

## Rule 11 — Sprint discipline

> [!IMPORTANT]

- Do not start Sprint N+1 until Sprint N's exit criterion in
  `STRAUMVAKT_V3_DELIVERY_PLAN.md` is met.
- Scope changes require an ADR in `docs/adr/NNNN-title.md` AND an edit
  to the delivery plan.
- End-of-sprint retrospective in `docs/retros/sprint-NN.md` is mandatory.

---

## If you're unsure

> [!CAUTION]
> **CRITICAL !!!** — When a rule's application is ambiguous, the
> default is always stop-and-ask. Never guess your way through a
> **CRITICAL !!!** rule.

---

## Quick reference

| Rule | Severity | What breaks if violated |
|------|----------|--------------------------|
| 1 — Branch and deploy safety | **CRITICAL !!!** | Unintended production deploy |
| 2 — Environment and secrets | **CRITICAL !!!** | Leaked credentials in git |
| 3 — Database operations | **CRITICAL !!!** | Wiped production DB |
| 5 — Fundamental-logic stops | **CRITICAL !!!** | Silent billing / access corruption |
| If unsure | **CRITICAL !!!** | Guessing through a critical rule |

Rules 4, 6, 7, 8, 9, 10, 11 are **IMPORTANT** — firm discipline.
