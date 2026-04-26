# Post-rev-5 Action List — 2026-04-26

**Generated:** 2026-04-26 after the rev-2 → rev-5 architecture work
landed and pushed to `origin/dev/sprint-01-ui-detour` (8 commits,
`b7c2873` → `85cc91a`).
**Source:** condensed from
[2026-04-26-rev4-checkpoint.md](./2026-04-26-rev4-checkpoint.md) and
the Sprint 2 task list pre-2.0 gate.

This list captures everything that is *unblocked but not yet done*
after the architectural rev. P0 = drop everything. P1 = next session.
P2 = sprint-milestone-tracked (does not need a separate decision now;
just confirmation that we'll do it when the milestone fires).

---

## P0 — drop everything

### P0.1 — Rotate `ADMIN_PASSWORD` on `hlada-staging`

- [ ] **Operator action.** Cloudflare Dashboard → Workers →
      `hlada-staging` → Settings → Variables and Secrets → set new
      `ADMIN_PASSWORD` → save → redeploy.
- **Why:** plaintext value lived in
      `docs/notes/2026-04-24-deploy-pause.md` from commit `21247f9`
      until the scrub at `b7c2873`. The scrub closes head-of-branch
      but the secret is still in git history on
      `origin/dev/sprint-01-ui-detour` and is the live staging password
      right now.
- **Owner:** operator. Claude cannot reach the Cloudflare Dashboard.
- **Done when:** new password works for `hlada-staging` admin login;
      old password rejected.

---

## P1 — next session

### P1.1 — ADR 0012 decision: fold control-plane reshape into foundation migration?

- [ ] **Operator decision.** Pick one:
      - **Branch A (recommended):** Claude drafts ADR 0012 with
        Prisma models for `ChargingStation`, `EVSE`,
        `OcppIdentity`-as-control-attachment, `VendorAssetRef`,
        `ExternalCpmsRef`, `ControlRoutingPolicy`,
        `CapabilityProfile`, `ProtocolTransactionRef`,
        `ImportedCdrRef`. Operator reviews. Claude extends the
        consolidated migration in-place. Operator applies once.
        One migration moment, no follow-up.
      - **Branch B:** apply the existing rev-4 migration as-is, draft
        ADR 0012 + second migration before milestone 2.5 (charger
        CRUD) and before any pilot site goes live. Two migration
        moments, with the second gated on "before pilot data exists".
      - **Wait:** keep migration unapplied while doing other work
        (Easee skeleton, KV scaffolding). Decision deferred.
- **Why:** the consolidated migration at
      [prisma/migrations/20260426120000_rev3_foundation_consolidated/migration.sql](../../prisma/migrations/20260426120000_rev3_foundation_consolidated/migration.sql)
      encodes the OCPP-first hierarchy that ADR 0011 explicitly
      classifies as provisional. Cheapest moment to do the right
      physical model is before any data lives on the wrong one.
- **Owner:** operator decides; Claude executes whichever branch.
- **Done when:** branch chosen + recorded in this file or in a fresh
      ADR.

### P1.2 — Create rollback anchors before any migration apply

- [ ] **Operator action.** Tag current HEAD on
      `dev/sprint-01-ui-detour`:
      ```bash
      git tag pre-host-drop-2026-04-26
      git tag pre-org-enrichment-2026-04-26
      git tag pre-control-plane-optionality-2026-04-26
      git push origin --tags
      ```
- **Why:** Rule 3 gate. ADRs 0009 / 0010 / 0011 each named these
      anchors. None exist on the remote yet.
- **Owner:** operator runs the commands (Rule 1 — Claude doesn't push
      tags without explicit instruction).
- **Done when:** all three tags exist on `origin`.

### P1.3 — Sprint 1.5 staging-deploy runbook

- [ ] **Operator action.** Resolve Windows symlink permission on the
      deploy machine, run `npx wrangler deploy --env staging` against
      `hlada-staging`, confirm a real charger boots and lands events
      in the OCPP gateway event log.
- **Why:** Sprint 1 exit criterion per Rule 11. Sprint 2 doesn't
      formally start until this runs. Pragmatically the rev-3/4/5
      architectural work IS Sprint 2 in spirit; this gate is for the
      staging-deploy half.
- **Owner:** operator. Symlink unblock requires admin shell on the
      deploy host.
- **Done when:** retro updated at
      [docs/retros/sprint-01.md](../retros/sprint-01.md) with the
      runbook output.

### P1.4 — Apply consolidated migration to dev Neon branch

- [ ] **Operator action**, gated on P1.1 + P1.2.
      ```bash
      npx prisma migrate deploy   # explicit per CLAUDE.md Rule 3
      ```
      Apply to dev Neon branch first; verify with
      `prisma migrate status`; then staging.
- **Why:** unblocks Sprint 2 milestones 2.1 / 2.3 / 2.5 / 2.10 /
      2.14. Repos cannot read/write the new ADR 0010 enrichment
      columns, the cost-center tables, or the `ocpp.configuration_keys`
      registry until this applies.
- **Owner:** operator. Rule 3 — Claude must not run
      `prisma migrate deploy` without an explicit operator instruction
      naming that command.
- **Done when:** migration listed under "Applied" in
      `prisma migrate status` against dev + staging Neon branches.

---

## P2 — sprint-milestone-tracked

These are *already on the Sprint 2 task list* under specific
milestones. They don't need a fresh decision; they fire when the
milestone fires. Listed here for visibility only.

| Item | Sprint 2 milestone | Gating |
|---|---|---|
| Easee API client skeleton + KV credential scaffolding | 2.7 | After P1.1 settles (vendor-ref shape depends on ADR 0012). |
| SVG regeneration for ADR 0011 (target physical hierarchy) | 2.15 | After ADR 0012 lands — diagrams should mark "implementation today" vs "target physical model". |
| `data_model_worked_example.svg` regen | 2.6 | After consolidated migration applies; worked example currently has 1 stale `ChargerHost` mention. |
| `prisma_schema_graph.svg` regen | 2.6 | After consolidated migration applies + after ADR 0012 schema if Branch A. |
| Iceland-energy-parties seeded as real Org rows | 2.1 | After consolidated migration applies (depends on ADR 0010 enrichment columns). |

---

## Won't do without explicit instruction

- **Push tags** (P1.2) — Claude lists the commands; operator runs them.
- **`prisma migrate deploy`** (P1.4) — Rule 3.
- **`prisma migrate reset`** — Rule 3.
- **Touch `wrangler.jsonc` `vars` for secrets** — Rule 2.
- **Modify `.env*` files** — Rule 2.
- **Open or merge a PR** — Rule 1.

---

## Status snapshot

- Branch: `dev/sprint-01-ui-detour` — 8 commits ahead of pre-rev work,
  pushed to `origin`.
- Working tree clean except three intentional locals
  (`slideshow_codex_ready.odp`,
  `public/data_model_worked_example.svg`,
  `public/prisma_schema_graph.svg`).
- `npx tsc --noEmit` ✅ · `npm run build` ✅ · `prisma validate` ✅.
- Migration not applied to any Neon branch.
- `iceland-energy-parties.json` exists in `docs/reference/` but no
  Org rows seeded yet.
- Repository + mapper layer (Rule 7) live for Org / User /
  Membership; Property / Site / Installation / Charger / Circuit
  repos pending (milestones 2.3 / 2.4 / 2.5 / 2.6).

---

## When the next session starts

If operator picks **Branch A** at P1.1: Claude reads ADR 0011 + the
existing schema + the cost-center splitting model, drafts ADR 0012,
surfaces the proposed Prisma models for review, waits for approval
per Rule 4 (`prisma/schema.prisma` is edit-with-instruction).

If **Branch B**: Claude does nothing schema-side until P1.4 fires;
parallel work continues on Sprint 2 milestones 2.1 (Org enrichment
UI) / 2.2 (membership invite) / 2.3 (Property/Site CRUD) which only
need the rev-4 columns, not ADR 0012.

If **Wait**: Claude works on Sprint 2.7 (Easee API client skeleton)
or Sprint 2.10 (cost-factor catalog seed file) — both unblocked by
the consolidated migration's columns alone.
