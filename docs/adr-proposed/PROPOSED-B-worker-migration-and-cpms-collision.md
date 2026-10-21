# PROPOSED B — Migrate the console Worker off a name CPMS also claims

**Status:** Proposed · **Date:** 2026-08-09 · **Decision owner:** Andri
**Register:** D-2

## Context

`E:\Claude\CPMS\CPMS\wrangler.jsonc` declares `name: "hlada"` (line 3) and
`env.staging.name: "hlada-staging"` (line 32) — the same two Worker names this
repository uses, in the same Cloudflare account. CPMS's `CLAUDE.md` documents
both as auto-deploying on push to `staging` / `master`.

`hlada-staging` currently serves `straumvakt.org`. `hlada` returns Cloudflare
error 1042 and appears not to be deployed.

Commit `4fe0a95` renames the root name to `straumvakt-console` and leaves
`env.staging.name` untouched — it addresses the Worker that is not deployed and
leaves the collision on the one that is.

## Forces

- A Worker script name is its identity; there is no rename operation. Verified:
  the only `rename*` symbol in wrangler 4.84.1 is `renameWorkerNamespace`, which
  acts on Workers-for-Platforms dispatch namespaces.
- CPMS is dormant (last commit 2026-04-23) — latent, not imminent.
- Secrets, custom domains, Git integration and deployment history are per-Worker
  and do not transfer to a new name.

## Options

1. Migrate Straumvakt to a distinct name.
2. Retire or repoint CPMS.
3. Leave it and rely on CPMS staying dormant.

## Recommended

**Option 2 first, then Option 1.** Option 2 removes the live hazard cheaply;
Option 1 is the durable fix. Option 3 is a bet that nobody pushes to a
repository that still exists and still documents auto-deploy.

The migration must cut over at the custom-domain layer — the only atomic and
reversible point — and must not delete `hlada-staging`, which is both the
rollback target and a name CPMS would recreate anyway.

## Consequences

Accepting adds a multi-step control-plane migration with a customer-visible
cutover window. Rejecting leaves a second repository able to overwrite
production.

## Unresolved

Whether CPMS Git integrations are still connected — dashboard only.
