# PROPOSED C — Wrangler config is the source of truth for routes; the dashboard is not

**Status:** Proposed · **Date:** 2026-08-09 · **Decision owner:** Andri
**Register:** D-3

## Context

`origin/staging` — the deployed configuration — contains no `routes` block and
no `workers_dev` key. The custom domains are live regardless, so they were
attached out of band. The release-candidate lineage does contain the block.

Cloudflare documents that attaching a Custom Domain creates a DNS record and an
Advanced Certificate, and that deleting the domain does not delete the
certificate. It does not document what happens to a live custom domain when a
deploy omits it from configuration.

## Forces

- Config-as-truth makes routing reviewable and diffable in Git.
- Dashboard-as-truth is invisible to review.
- The undocumented case is exactly the one currently in production.

## Options

1. Config is truth: every route and domain declared in `wrangler.jsonc`.
2. Dashboard is truth: config declares no routes.
3. Status quo — ambiguous.

## Recommended

**Option 1**, with a hard precondition: verify in the dashboard whether a deploy
omitting `routes` detaches a live custom domain, before relying on it either
way. Until verified, treat retention as unknown and as a stop condition on any
deploy.

## Consequences

Config-as-truth means a config mistake can move a production hostname. That is
acceptable only alongside branch protection (PROPOSED-A).

## Unresolved

The retention behaviour itself. This ADR cannot be accepted before that check.
