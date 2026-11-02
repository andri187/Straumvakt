# Sonnet task: separate active Drizzle tooling from legacy checks

Requested by Andri, 2026-11-02. Recommended model: Sonnet High. This brief queues work; it does not authorize a CLI model run.

## Starting evidence

Canonical checkout verified at `E:\Claude\Straumvakt`, remote `andri187/Straumvakt`, branch `codex/core-checkpoint-2026-10-31`, HEAD `9f173f3` at task preparation. The completed OEM picker / charger tabs increment is being reviewed and pushed separately; recheck HEAD and preserve all unrelated untracked files. No additional worktree or project copy.

GitHub run 41511202835, job 125503186691, failed on that commit during `npm install --no-audit --no-fund` with `Cannot read properties of null (reading 'edgesOut')` (Node 22.23.3 / npm 10.9.9). Tests never ran. Do not claim Prisma caused this installer failure: the cause remains unproven.

Verified mixing: `.github/workflows/check.yml` still runs `db:generate`; root `package.json` maps that to Prisma generation for root and `apps/api`. `scripts/check-all.mjs` mixes active checks with Prisma mirror, migration visibility and legacy binding checks. Root package-lock is ignored for historical Windows/Linux reasons. Adopted Drizzle schema/migrations and `check:adopted-schema` already exist. The retired Zaptec deployment workflow is deliberately disabled; keep it disabled.

Read AGENTS.md, CLAUDE.md, current FOCUS.md, WORKSPACE.md and the relevant completion/release evidence. Reuse existing findings; do not perform another whole architecture review.

## Required result — minimal tooling repair

1. Trace the active build/test/deployment dependency boundary, including shared modules still used from older directories. Classify checks as active, retained legacy, or obsolete using actual imports/configuration, not folder names. Historical source existing on disk is not evidence it executes in production.
2. Diagnose the clean-install failure from available npm evidence. Establish a reproducible, pinned install using a committed compatible lockfile and `npm ci` where feasible; validate Linux and Windows dependency resolution, including native optional packages. Do not blindly regenerate all dependencies or upgrade application frameworks. Do not weaken verification with `--force` or blanket peer-dependency suppression. If exact reproduction is unavailable, distinguish the demonstrated repair from an unproven root cause.
3. Repair the existing check workflow and root scripts so the active Drizzle/S1 checks are an honest gate. Remove mandatory Prisma generation only after proving the active paths do not need it. Preserve required transitional dependencies until safely separated. Give retained legacy checks an explicit entry point; do not silently disable active security, financial, tenancy, schema or binding checks to make CI green.
4. Check the adopted schema/migration ownership, active shell and gateway build/config targets, typechecks and test selection. Use the existing checks and offline resource evidence; no live schema access or migrations. Avoid accidentally switching to legacy wrangler targets or creating a second billing engine, API or pipeline. Keep the retired deployment disabled and pushes free of automatic deployments.
5. Update the deprecated GitHub action versions using supported, verified versions; pin the runner if appropriate for reproducibility. Distinguish action runtime Node from the application Node version. Update stale workflow comments and relevant instructions to match the final commands.
6. Add a short active-versus-legacy tooling map to the existing project documentation. Preserve research, migration history and archives. No wholesale folder moves/deletions or Prisma-to-Drizzle application rewrite in this task. If a live dependency blocks separation, name the exact import and smallest required follow-up instead of hiding it.

## Acceptance / evidence

- A clean dependency install succeeds without relying on the developer's existing node_modules; document OS, Node/npm versions and lockfile behavior. Use disposable install output inside this checkout if needed, not another checkout/worktree, and do not damage local tools or services.
- Active root/gateway typechecks, adopted-schema check and appropriate tests run through the corrected workflow commands. Run a single integrated suite when ready; repeat only affected checks after fixes. Reuse unchanged browser/Flutter evidence unless the dependency changes invalidate it.
- Legacy-only failures are explicitly attributed and isolated; actual active failures remain blocking. No credentials required by PR checks; no DB/cloud/hardware writes or production load tests.
- Supply a source-only handoff with changed files, clean-install evidence, command results, unresolved limitations and push/CI verification instructions. Local workflow-equivalent checks are not a remotely passing Actions run. No commit, push, deploy, secret changes or real-installation commands are authorized by this task.

Keep output compact. Do not broaden into new features or infrastructure. This is tooling separation and reproducibility, not a new architecture.
