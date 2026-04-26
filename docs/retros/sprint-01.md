# Sprint 1 — OCPP Foundation · Retrospective

**Dates:** 2026-04-24 → 2026-04-25
**Exit criterion (original):** Simulated charger goes end-to-end through
the V3 pipeline; event log is the source of truth; outbound commands
dispatch via outbox.
**Status:** **Code-side complete; runbook-driven verification pending.**
1.5 was reframed mid-sprint from "scripted simulator E2E test" to
"control-plane verification + first-real-charger runbook." That part
is operator-driven and has not yet executed against real hardware.

---

## What shipped

| Milestone | Status | Commit | Notes |
|---|---|---|---|
| 1.1 — OCPP event ingest, event-log-first + idempotent | ✅ | `24f0ef3` | Service Binding header gate (ADR 0004), single-transaction event-log + idempotency + projection dispatch. Replay test green. |
| 1.2 — OCPP 1.6J translator + projections | ✅ | `0a9d3b1` | Translator boundary in `gateway/src/ocpp-frame.ts`; non-`ocpp` modules carry no OCPP vocabulary. Boundary test catches future leaks. |
| 1.3 — Outbox + dispatcher | ✅ | `893512a` | `ocpp.outbound_commands` populated by API; cron + dispatcher route to DO with retry. Forced-crash mid-dispatch produces retry, not loss. |
| 1.4 — Gateway Worker + DO + Service Binding | ✅ | `3633f86` | `gateway/src/identity-do.ts` runs one DO per OCPPIdentity (UUID-keyed); reconnect after hibernation works. |
| 1.5 — Control-plane verification (reframed) | ⚠️ code complete, runbook pending | `688505a` | Provisioning route + `remote-stop` / `get-configuration` / `change-configuration` admin endpoints + [staging-deploy runbook](../runbooks/1.5-staging-deploy-and-real-charger.md). Real-charger verification not yet run. |

### Verification at last commit

- `npx prisma validate` — clean
- `npx tsc --noEmit` — exit 0 (main + gateway)
- `npm run build` — clean
- `npx vitest run` — main 86 tests / 10 files green; gateway 24
  tests / 2 files green

### Decisions made (ADRs)

- **[ADR 0004](../adr/0004-ocpp-transport-service-binding.md)** — OCPP
  transport via Cloudflare Service Binding (constant-time secret
  header) instead of HMAC over the public internet. Replaces the
  earlier "signed webhook" plan. Made because the gateway and main
  app live on the same Cloudflare account, so a Binding is cheaper,
  faster, and harder to misuse.
- **[ADR 0005](../adr/0005-pilot-scope-tightening-2026-04-25.md)** —
  Pilot scope rev 1. Six topical groups (A–F) deferred to
  post-pilot. Pilot reframed as *demonstrable platform*, not
  commercial release.
- **[ADR 0006](../adr/0006-pilot-scope-rev2-2026-04-25.md)** — Pilot
  scope rev 2. New Sprint 2 (Admin Onboarding + Zaptec) and Sprint 4
  (Data Storage Lifecycle) inserted; Driver Experience and Issue
  Engine entire sprints moved to post-pilot. Pilot is now
  admin-functionality only.
- **[ADR 0007](../adr/0007-circuit-asset-tier-back.md)** — Circuit
  asset tier re-added to V3 schema. Additive migration ships in
  Sprint 2 milestone 2.6. Reverses the V3-vs-CPMS divergence on this
  one entity.

---

## What slipped

### 1. Milestone 1.5 reframed mid-sprint

The plan said "scripted simulator end-to-end test." What was needed
turned out to be different — a *real* charger needs to authenticate
against the gateway, the gateway needs to reach the main app via
Service Binding, the main app needs admin-callable endpoints to
issue OCPP commands at the DO. So 1.5 became:

- a `provision-identity` route that lays down Org → Host → Property
  → Site → Charger → OCPPIdentity → Connector in one transaction,
  generating a Basic-Auth password that is revealed exactly once;
- three outbound command routes (`remote-stop`, `get-configuration`,
  `change-configuration`) that exercise the 1.3 outbox end-to-end;
- the [1.5-staging-deploy-and-real-charger runbook](../runbooks/1.5-staging-deploy-and-real-charger.md)
  with five exit checkpoints to walk through against a real charger.

The simulator test the plan called for is a smaller piece of this;
the runbook subsumes it. **Reframe not silent drift** — it's
captured here and the rev 2 delivery plan §4 should be edited in
Sprint 2 to match the actual shape of what shipped.

### 2. Cloudflare deploy paused on Windows symlink blocker

Documented in [docs/notes/2026-04-24-deploy-pause.md](../notes/2026-04-24-deploy-pause.md).
OpenNext bundling fails under Windows for non-admin users because
`@prisma/client` symlink creation is blocked. Three options surfaced
(Developer Mode, WSL, dedicated dev machine) and operator paused to
consult the board. Deploy decision still pending at sprint close.

The gateway worker (`straumvakt-ocpp-staging`) is live on Cloudflare
since 2026-04-24 — the symlink issue only bites the main-app
OpenNext build path, which the gateway doesn't need.

### 3. UI detour during the deploy pause

While waiting on the deploy decision, branch `dev/sprint-01-ocpp-foundation`
was renamed `dev/sprint-01-ui-detour` and four sidebar tabs landed:

| Commit | Subject | Notes |
|---|---|---|
| `ecf01c1` | Sidebar tabs for Mobile App / Reference / Zaptec API | scaffold |
| `21b452a` | Phase A: Mobile fix, sidebar groups, Technical Read scaffold | iframe nav |
| `441649f` | Technical Read: iframe live zaptec-test on :3100 | live integration |
| `07113e0` | Technical Read: hide zaptec-test sidebar via embedded=1 | UX polish |
| `86e031e` | Mobile App: native hero-image carousel, drop Flutter iframe | **reverted** |
| `a02e063` | Revert "[Sprint 1.5 detour] Mobile App: native hero-image carousel..." | rollback |

The native carousel rewrite (`86e031e`) was the wrong call — Flutter
iframe was already working; rewriting it lost the slider feature
entirely. Rolled back same-session per operator instruction
("rollback to previous app view"). The Flutter iframe stays.

These detour commits are not part of any milestone; they're
tooling/UX additions that happened during a wait state. Carry
forward: catalogue them so they're not mistaken for Sprint 2 work.

### 4. Plaintext password in committed file

`ADMIN_PASSWORD` value `TMTNTPower123456!` was committed in
`21247f9` inside `docs/notes/2026-04-24-deploy-pause.md` and pushed
to `origin/dev/sprint-01-ui-detour`. Working-copy redaction landed
2026-04-25 but **history retains the value**. CLAUDE.md Rule 2
violation.

**Mitigation in place:**
- Working copy redacted.
- Rotation flagged in the file's "Outstanding cleanup" section.
- Operator action required: `npx wrangler secret put ADMIN_PASSWORD
  --env staging` with a fresh value. Confirm rotation completes
  before the next staging deploy.

**Carry-forward learning:** never commit a secret-bearing notes file
without a redaction pass first; or better, keep secret-bearing notes
out of git entirely (use a local-only `notes/` directory
gitignored).

---

## What changed in the plan

Two ADR-driven plan rewrites within one sprint — unusual but
documented:

- **Rev 1 (ADR 0005, committed `59a04e1`):** delivery plan
  §1.1/§1.2/§1.3/§2 + per-sprint sections §5/§6/§7/§8/§9/§11/§12/§13
  rewrote pilot scope. Six topical groups (A–F) tagged as deferred.
  New roadmap SVG.
- **Rev 2 (ADRs 0006 + 0007, uncommitted at sprint close):** Sprint
  2 (Admin Onboarding + Zaptec) and Sprint 4 (Data Storage
  Lifecycle) inserted as new sprints; Driver Experience (old Sprint
  3) and Issue Engine (old Sprint 5) entire sprints moved
  post-pilot. Architecture canon §4 + §10 + §11 updated. Roadmap
  SVG replaced with rev 2 layout. Per-sprint sections §5–§13
  rewritten. Sprint task lists landed under
  [`docs/sprints/`](../sprints/) with deep-Sprint-2 + sketch-rest
  format.

Result: the rev 2 task lists are the working tracker for Sprint 2
onward; the delivery plan is the canon they trace back to.

---

## Known follow-ups (carried forward, must close before Sprint 2 starts)

1. **Operator runs the [1.5 runbook](../runbooks/1.5-staging-deploy-and-real-charger.md)
   against staging.** Resolve the Windows symlink blocker first
   (Developer Mode, WSL, or dedicated machine); then deploy
   `hlada-staging`; then walk the 5 exit checkpoints (heartbeat,
   config round-trip, state change, RemoteStop, zero-energy CDR).
   Without this, Sprint 1's exit criterion is not actually met.
2. **Rotate `ADMIN_PASSWORD` on `hlada-staging`.** See §What slipped
   #4 above.
3. **Rotate the dev Neon branch password.** Visible in earlier
   terminal output. Operator action via Neon Console.
4. **Rotate the Zaptec portal password** the operator pasted earlier.
   Before Sprint 2.7 (Zaptec wizard) starts using it.
5. **Commit the rev 2 doc edits + ADRs 0006 + 0007 + sprint task
   lists** on the current branch. Then push (operator action — Rule 1).
6. **Update delivery plan §4 Sprint 1.5 milestone description** to
   match what actually shipped (the runbook-driven control-plane
   verification, not "scripted simulator E2E test"). Either edit in
   place or note that the milestone definition shifted in this retro.
7. **Investigate the existing `straumvakt-ocpp` (production)
   Worker** — 28 requests in last day per
   `docs/notes/2026-04-24-deploy-pause.md`. Decide retire or migrate
   before Sprint 2 changes anything.
8. **SVG diagram update** — `straumvakt_architecture_v3.svg` still
   doesn't show Installation, Hardware Catalog inset, or Circuit
   tier. Carried since Sprint 0 retro. Do during a quiet slot in
   Sprint 2.

---

## One thing to carry into Sprint 2

**The 1.5 reframe is the template for how this kind of sprint
finish-line drift should land.** When a milestone's actual shape
diverges from the plan, capture it as a retro entry + a delivery
plan amendment, not a silent commit. The `[Sprint 1] 1.5
Control-plane verification` commit message did this well — explicit
about what shipped, what was deliberately out of scope (no
MeterValues testing), and what the runbook covers.

For Sprint 2: nine milestones means lots of opportunities for
similar drift. Watch for "while I was in there" creep on Rule 4
files (especially `prisma/schema.prisma` for the Circuit migration
in 2.6) and Rule 5 territory (auth_secret_hash handling stays
exactly as 1.5 left it; the wizard in 2.7 reuses, doesn't rewrite).

---

## Sign-off

- Code-side exit criterion: **met.**
- Runbook-driven exit criterion: **NOT yet met.** Sprint 1 stays open
  until the operator walks the 1.5 runbook against real hardware on
  staging.
- Sprint 2 may **not** begin until the runbook is walked, this retro
  is updated with the runbook outcome, and the carry-forward security
  rotations (#2, #3, #4 above) are complete.
