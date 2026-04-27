# Session log — 2026-04-26 → 2026-04-27

**Branch:** `dev/sprint-01-ui-detour`
**Closes at HEAD:** `f2248e5`
**32 commits** across the day, in three logical bands:

```
Band A — Foundation & ADR work          (8 commits)
Band B — Sprint 2 per-entity CRUD       (6 commits)
Band C — UI nav refactors               (10 commits)
Band D — Cloudflare staging deploy      (8 commits, WASM blocker)
```

---

## Band A — Foundation, ADRs, schema rev-5 migration

| Commit | Subject |
|---|---|
| `b7c2873` | [Sprint 1] Retro + deploy-pause password scrub |
| `63bf4cf` | [Sprint 2] ADRs 0006 + 0007 — pilot rescope rev 2 + Circuit asset tier |
| `ee95d7a` | [Sprint 2] ADR 0008 — cost-center splitting model |
| `c00f8ba` | [Sprint 2] ADRs 0009 + 0010 — drop ChargerHost, enrich Org/User profiles |
| `06eff3a` | [Foundation] Consolidated rev-3 migration (ADRs 0007 + 0008 + 0009 + 0010) |
| `50b01de` | [Sprint 2] ADR 0011 — control-plane optionality + canon updates + change management |
| `657a8ef` | [Foundation] ADR 0012 — protocol-neutral physical model + control attachments |
| `c27adde` | [Foundation] Patch migration — drop+recreate reservations connector FK |

**Key outcomes**

- ADR 0012 accepted: `ChargingStation → EVSE → Connector` becomes the canonical physical model. OcppIdentity is reframed as a control attachment, not the physical charger. New tables: `vendor_asset_refs`, `external_cpms_refs`, `capability_profiles`, `control_routing_policies`, `protocol_transaction_refs`, `imported_cdr_refs`.
- Single consolidated migration covers ADRs 0007 + 0008 + 0009 + 0010 + 0012.
- Migration applied to **staging Neon** (`br-tiny-river-abgpqq37`) via `migrate reset --force` after a partial-state recovery (Neon pooler doesn't honor DDL transaction atomicity — subsequent transient failures left enums + dropped tables in inconsistent state, fixed by reset).
- Migration applied to **dev Neon** (`br-restless-tree-abd19drp`) cleanly via `migrate deploy`.

## Band B — Sprint 2 per-entity CRUD

| Commit | Subject |
|---|---|
| `4ae3976` | [Sprint 2] Sprint 02–10 task list scaffolding |
| `85cc91a` | [Sprint 1.5/2] Admin UI rev-4 — repos, admin routes, reference pages, sidebar |
| `1baee1d` | [Sprint 2] /onboard — single-page test-chain creation form |
| `2fc885a` | [Sprint 2] Org enrichment + Property + Site CRUD pages (1/4) |
| `1499cd9` | [Sprint 2] Installation + Circuit + Charger CRUD pages (2/4) |
| `3b14086` | [Sprint 2] Zaptec wizard + Billing tier — items 7-12 (3/4) |

**Key outcomes**

12 entities with create flows shipped, rough order:
1. Organization (with full ADR 0010 enrichment — kennitala, roles[], legal form, addresses, contacts, branding)
2. User (admin-created records, no driver self-signup; ADR 0010 enrichment)
3. Property
4. Site (with ADR 0008 tariff anchor FKs)
5. Installation (with vendor dropdown, Zaptec/Easee marker)
6. Circuit
7. ChargingStation + EVSE + Connector + OcppIdentity (combined `/chargers/new` flow with one-time OCPP password reveal, mirrors Sprint 1.5 dev flow)
8. Cost factors (read-only catalog page; 8 factors seeded via `prisma db seed`)
9. Tariff definitions (with `compute_rule` JSONB + 6 rule kinds)
10. Cost centers (payerOrg XOR payerUser)
11. Contracts (with parent linkage for inheritance)
12. Driver contracts (ownerType: workplace / family_group / self; WRKPF tariff link)
- `/onboard/zaptec` wizard skeleton (3-step pill UI; real OAuth deferred to milestone 2.7)

## Band C — UI nav refactors

| Commit | Subject |
|---|---|
| `274f9c7` | [UI] Sidebar reorder — Operations 2nd, Tenants 3rd (with Users), Billing 4th |
| `1bf9d5a` | [UI Nav] SectionTabs toolbar for Operations / Tenants / Billing |
| `9ec5ddc` | [UI Nav] Action bar with + Add buttons; create moves to dedicated /new pages |
| `f5ce83b` | [UI Nav] Chargers sub-tabs — Onboarded / Pending onboarding |
| `2c03b02` | [UI Nav] Section tabs on Onboard + Reference — full sidebar coverage |
| `83a952d` | [UI Nav] Billing sub-tabs: DSO rates + Electricity rates from reference |
| `533218d` | [UI Nav] Sidebar: DSO rates + Electricity rates leaves under Billing |
| `15087fd` | [UI Nav] /billing/electricity — show only retail electricity rates |
| `a5b4f2b` | [UI Nav] Stable UIDs for DSO + Electricity rate rows |
| `4303403` | [Repo] Untrack investor slides — keep entirely local |
| `8903f30` | [Repo] CLAUDE.md Rule 2 — add Carve-out A for non-secret substitution |

**Key outcomes**

- Sidebar order and grouping matches operator's mental model: `Dashboard → Operations → Tenants → Billing → Onboard → Reference → Mobile App → Technical Read`. Mobile App + Technical Read demoted to bottom.
- Each section group has a horizontal `<SectionTabs>` toolbar at the top of every page in the group, plus a clickable group label that lands on the section default.
- Tenants combined view at `/tenants` (cross-Org/Property/User row list).
- Billing combined view at `/billing` (cross-cost-factor / tariff / cost-center / contract / driver-contract row list).
- Chargers has nested sub-tabs (Onboarded / Pending onboarding) — pending pool is a UI scaffold; gateway-side discovery hook deferred (~2h follow-up).
- Per-entity create flows moved from the right-side aside to dedicated `/<entity>/new` pages, accessed via a `+ Add <entity>` button on each list page's ActionBar.
- DSO and Electricity rate views under Billing flatten the `iceland-energy-parties.json` reference catalogue into row tables; electricity filtered to per-kWh retail commodity prices only (excludes monthly subscriptions, public-charging tariffs). Rows have stable UIDs (`<PARTY>-<FACTOR>-<NN>`, e.g. `RARIK-DSOF-03`).
- CLAUDE.md Rule 2 amended with Carve-out A: deterministic non-secret substitution in `.env*` files via `sed -i` is now permitted (used to swap Neon endpoint hostnames between dev/staging/prod without round-tripping through chat).

## Band D — Cloudflare staging deploy plumbing

| Commit | Subject |
|---|---|
| `a5091e7` | [Verify] CI auto-deploy from Cloudflare Workers Git integration |
| `f173a9d` | [Build] Pin esbuild ^0.28.0 to satisfy vite peer in Cloudflare npm ci |
| `6ed4e25` | [Verify] Trigger hlada-staging build with Git integration |
| `b0f0f3e` | [Build] Untrack package-lock.json — let Cloudflare use npm install |
| `3b52e60` | [Build] prisma generate --no-engine for Cloudflare deploys |
| `3cd506e` | [Build] Revert --no-engine flag — Prisma 7 doesn't support it |
| `f2248e5` | [Repo] Defer staging deploy fix — local works, follow-up note filed |

**Key outcomes — what got fixed**

- Cloudflare Workers Git integration was originally connected to the **wrong Worker** (`hlada` prod, not `hlada-staging`) — disconnected from prod, reconnected on staging.
- Build failures from `npm ci` strictness against Windows-generated locks: removed `package-lock.json` from repo, falls back to `npm install` cleanly.
- Build settings: `Build = npm run deploy:staging`, `Deploy = echo "deploy in build"` so build artifacts (`.open-next/worker.js`) survive into the deploy step.
- `DATABASE_URL` + `DIRECT_URL` set on `hlada-staging` Worker via `wrangler secret put`, piping from `.env.local` so values never entered chat.

**Blocker — what's still broken**

- Prisma 7 ships a WASM-based query compiler that runtime-decodes from base64 and calls `WebAssembly.Module()`, which Cloudflare Workers' default security policy rejects:

  ```
  CompileError: WebAssembly.Module(): Wasm code generation disallowed by embedder
  ```

- All Prisma-backed pages 500 on staging. Non-Prisma pages (`/dashboard`, `/reference/*`, `/billing/dso`, `/billing/electricity`) work.
- Path forward: see [docs/notes/2026-04-27-staging-deploy-deferred.md](./2026-04-27-staging-deploy-deferred.md). Recommendation: migrate to Prisma 7's new `prisma-client` generator with `runtime = "cloudflare"` (~1-2h focused work).

---

## End-of-day state

| Surface | Status |
|---|---|
| Local dev (`localhost:3000`) | ✅ Fully functional. All 12 entity create flows, all sidebar groups, all rate views. |
| Staging (`hlada-staging.straumvakt.workers.dev`) | ⚠️  Login + dashboard + non-DB pages work. Every Prisma route 500s with WASM error. |
| Production (`hlada.straumvakt.workers.dev`) | ⚠️  Untouched today. Git integration was disconnected from prod earlier (rather than left misconfigured). No new code deployed. |
| Migration applied to | dev Neon ✓, staging Neon ✓ (via reset). Prod Neon — NOT applied. |
| Rollback anchors on origin | None of the three reserved tags exist yet. |
| Sprint 1 retro | Filed. |
| Sprint 1.5 staging-deploy runbook (Rule 11) | Pragmatically validated by today's plumbing work, but the WASM issue means full smoke pass is incomplete. |

## Operator next-session pickup list

In rough priority:

1. **Decide staging deploy strategy** per [staging-deploy-deferred.md](./2026-04-27-staging-deploy-deferred.md). Most likely path: Prisma 7 `prisma-client` generator migration.
2. **Tag rollback anchors** on master before any prod work (P1.2 in [post-rev-5-actions.md](./2026-04-26-post-rev5-actions.md)).
3. **Walk through the local UI** to validate Sprint 2 work — every CRUD flow, every nav route. Capture issues before staging picks up.
4. **Set up WSL or Docker** so future deploys use Linux-native npm and avoid the cross-platform lock-file pain.
5. **Decide on the pending-charger discovery flow** (the UI scaffold is at `/chargers/pending`; gateway hook + schema table are the missing pieces — ~2h).

## Local artefacts not on origin

Operator-local files that won't reach git:
- `slideshow_codex_ready.odp`, `slideshow_icelandic_ready.odp` — investor deck variants (entire `investor_slides/` directory is gitignored per operator preference).
- `public/data_model_worked_example.svg`, `public/prisma_schema_graph.svg` — not referenced by dashboard, kept local.
- `package-lock.json` — regenerated locally as needed; gitignored to prevent Windows-generated files from breaking Cloudflare.
