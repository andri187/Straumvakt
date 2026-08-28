# PROPOSED E — A CI migration-status credential must be SQL-created and environment-gated

**Status:** Proposed · **Date:** 2026-08-09 · **Decision owner:** Andri
**Register:** D-5 · **Related:** `docs/operator/CI_MIGRATION_CHECK_CREDENTIAL.md`

## Context

`npm run check:migrations` needs a live `DATABASE_URL`. `check.yml` triggers on
`push: branches: ["**"]` and on `pull_request`.

The decisive constraint: Neon roles created via console, CLI or API are granted
`neon_superuser`, carrying `pg_read_all_data` and `pg_write_all_data`. Creating
the CI role that way yields full read *and write* access to everything — worse
than reusing the existing credential. Only a SQL-created role is least-privilege.

## Options

1. SQL-created least-privilege role plus GitHub Environment gating.
2. Reuse the existing credential.
3. Drop the CI migration check and run it only in the release runbook.

## Recommended

**Option 1**, subject to all of:

- `CONNECT` on the database, `USAGE` on one schema, `SELECT` on
  `_prisma_migrations` only
- a negative test proving a business table is unreachable for this role
- a GitHub Environment with deployment-branch rules
- no `pull_request_target`
- validated first on a throwaway Neon branch
- an explicit branch-scope decision: Neon roles duplicate into child branches, so
  creating it on `staging` propagates it to every future `test` reset and every
  backup branch
- the job restricted to trunk/RC rather than `["**"]`, or reviewers are prompted
  on every branch push and start ignoring the prompt

## Consequences

A SQL-created role is outside the Neon console's management surface, so its
existence and grants must be documented or it becomes invisible infrastructure.

## Unresolved

Whether the check justifies a standing credential at all, versus Option 3.
