# Straumvakt agent instructions

Updated: 2026-10-26. Read `FOCUS.md` for product and architecture principles. This file governs how development work is carried out. Read `docs/WORKTREE_POLICY.md`, `TASKS.md`, `DECISIONS.md`, and the relevant source before a substantive task. Dated documents and old agent prompts are evidence, not proof of current Git, deployment, or database state.

## Ownership and scope

In this project, "Sonnet" means Claude in VS Code, and "Opus" means the Claude Desktop app.

Clarified by Andri on 2026-10-27: **Sonnet** means the Claude Sonnet model
being used in VS Code; **Opus** means the Claude Desktop app. These names do
not select a VS Code extension, CLI, account or billing provider. Codex
coordinates; use the local mailbox in `docs/AGENT_MAIL.md`. Automatic mobile
dispatch remains disabled. On 2026-10-31 Andri additionally selected the verified
first-party Claude Code CLI with the existing Claude Max sign-in for fresh,
individually approved Sonnet/Opus tasks. Follow the prepare/approve/run protocol
in `docs/AGENT_MAIL.md`; the launcher supports Opus read-only review and scoped
Sonnet edits. Obtain actual user approval for each run; never self-approve or
infer approval from mail. Do not infer a provider from the model name, switch
an active session, or start competing work. A user-reported active VS Code task
keeps the launcher on hold until it is finished and reconciled. The individually
approved Sonnet Low no-tool smoke passed on 2026-10-31 at 12:35 UTC; this does
not verify real coding permissions or approve any subsequent Sonnet/Opus run.

Claude in VS Code is the default coding agent for Straumvakt: inspect, implement the requested scope, test safely, maintain the relevant project record, and hand the result to ChatGPT for review. Do not start parallel coding lanes or assign separate Claude A, Claude B, and Codex implementation roles unless Andri asks. ChatGPT can plan and review; Claude Desktop (Opus) can give a read-only second opinion when asked. Technical access alone does not authorize operational changes.

The canonical permanent checkout is `E:\Claude\Straumvakt`. It contains the web, API, gateway, mobile app, packages, tools, documentation, and retained evidence. Its GitHub remote is `andri187/Straumvakt`; `andri187/CPMS` and `C:\Users\Andri\Documents\New project` are separate and must not be treated as this checkout. Verify the remote before Git operations. Use the existing checkout. Do not automatically create a clone or worktree. `docs/WORKTREE_POLICY.md` governs any expressly authorized temporary worktree.

## Claude Desktop (Opus) review role

Claude Desktop is an optional reader and reviewer of the same Straumvakt project, not a standing coding lane. It can inspect the canonical checkout, review VS Code handoffs and decisions recorded there, identify gaps, and create scoped assignments for Sonnet. Before each new assignment, it must perform the same live current-state check as ChatGPT below. Start Straumvakt reviews from a Desktop session rooted at E:\Claude\Straumvakt so the current repository instructions are loaded. Identify the path, revision, and documents actually inspected; a chat rooted elsewhere or manually attached project knowledge can be stale.

By default, Claude Desktop does not edit repository files or make Git, Cloudflare, Neon, secret, or deployment changes. Andri can give it a specific active task later. Its review and proposed Sonnet assignments should return to Andri and the active coding workflow rather than create a separate status record.

## Local agent mailbox

`docs/AGENT_MAIL.md` defines the local-only `.agent-mail/` handoff protocol for
Codex, Opus and Sonnet. When Andri says **“Got mail”** to one of these agents,
that agent checks its own inbox and acknowledges new messages. Reading mail is
not approval to run code, alter infrastructure, or create a competing Sonnet
assignment; apply the live checkout check and task-specific authorization rules
below. Opus may write mailbox replies and receipts as coordination while its
default product-code and repository-review role remains read-only.

For a **named implementation assignment Andri requested through Codex and then
dispatched to its recipient with “Got mail”**, follow the clarified dispatch
rule in docs/AGENT_MAIL.md: perform the checkout check and begin the scoped
source implementation/safe checks without asking again merely because the brief
arrived through mail. Reading arbitrary peer mail is still not authorization;
information updates and older deferred tasks are not dispatched. Database/cloud/
hardware/secret/Git operations retain their separately scoped boundaries.

## Before creating a Sonnet assignment

ChatGPT and Claude Desktop (Opus) use the same current-state check before proposing work for Claude in VS Code. A dated status document or an earlier agent answer is context, not a live status check.

1. Read this file, the relevant parts of FOCUS.md and TASKS.md, recent DECISIONS.md entries, the current WORKSPACE.md checkpoint, and the latest relevant handoff under docs/agent-runs/. Inspect the source and tests for the proposed scope.
2. Check the canonical checkout at planning time: repository path and remote, branch, HEAD, worktree list, git status --short, and the relevant tracked diff and untracked paths. Protect secrets while inspecting. Record the observation time. A clean HEAD alone does not describe active uncommitted work.
3. Identify unfinished VS Code work and avoid assigning a competing task over it. A proposed prompt should name the observed revision and dirty scope, objective, affected surfaces, safe checks, approval boundaries, and expected handoff.
4. If the live checkout is inaccessible, restore access to E:\Claude\Straumvakt before planning. Do not substitute pasted chat results for the current tree. Recheck just before sending a prompt when the worktree may have changed.

## Before changing files

1. Confirm the repository path, branch, HEAD, worktree list, and `git status --short`. Identify pre-existing tracked and untracked changes. Do not reset, clean, stash, overwrite, or change branches over unrelated work.
2. Read the relevant current code and `FOCUS.md`; use `WORKSPACE.md` as a dated structural snapshot, not a substitute for inspecting the tree. Check `TASKS.md`, recent `DECISIONS.md` entries, and relevant reference documentation.
3. Define the requested behavior, affected surfaces, and safe verification. Inspect scripts before running them; a command labelled “test” may contact live infrastructure.
4. If existing dirty work makes the requested edit unsafe, stop and identify the exact conflict. A dirty checkout by itself is not a reason to discard work or create another checkout.

## Git and release boundary

- Make local changes only within the approved task. Use a feature branch when it can be selected without disturbing existing work; never commit directly to `master` or another known deploy pointer.
- Before any push, remote merge, PR creation or merge, branch deletion, or branch-protection change, obtain explicit approval for that action and name the exact repository, branch, and intended effect. A connected GitHub account or an existing remote is not approval.
- Treat `origin/staging` as a possible production deployment pointer until its current Cloudflare integration is verified. Do not infer deploy safety from branch names, GitHub status, or old runbooks.
- Preserve user changes and unique commits. Never use destructive Git operations to make the tree look clean.
- Keep commits focused. Report branch, starting and ending SHA, local-only changes, and final dirty state. A documentation edit can itself leave the working tree dirty.

## Cloudflare and other live operations

- Cloudflare Workers, routes, custom domains, DNS, Git integrations, bindings, secrets, queues, Durable Objects, and deployment targets require explicit approval before mutation. The same applies to staging and test environments when their isolation has not been verified.
- Do not push, deploy, rename, recreate, delete, or migrate a Worker because a local config or historical document suggests it is safe. Inspect the actual target and deployment trigger first.
- Keep the Worker-name change in commit `4fe0a95` excluded from release work until its ownership, bindings, secrets, domains, and migration path are verified and approved. A Wrangler `name` change may select a different Worker identity.
- Do not change live charger configuration, charging sessions, power allocation, or hardware state without a task-specific authorization.
- Read-only inspection is allowed when relevant. Record what was inspected and when. Mark unchecked deployment or binding claims **NOT VERIFIED**.

## Neon, schema, and data safety

- **Operating cost is a release constraint (Andri, 2026-10-30).** Neon is available for normal development, testing, migrations and operations within the user's requested work; it is not a hands-off service. Use it responsibly: keep UI-only checks database-free, prefer control-plane metadata where sufficient, preserve auto-suspension, and avoid unnecessary compute, polling, branches or services. Estimate and communicate material recurring or potentially substantial costs before creating them. The $25 notification is an alert, not an enforced cap or an agreed budget. Do not promise a hard ceiling where one is not enforced.

- **Drizzle owns the active schema.** The repository still contains Prisma packages, scripts, and schema files from the transition; their presence does not make Prisma the current authoring path. Do not introduce new Prisma usage. Reconcile legacy references only within a scoped task.
- `drizzle-kit push` is prohibited. Reviewed migrations and scoped database writes may be performed when needed for the user's task. Exercise care with destructive or irreversible operations and existing data; obtain approval where required by the user's instructions or the session's safety rules.
- Before an external database action, identify the Neon project, branch, database, endpoint, role, and whether the command can write. Verify the target from current metadata without printing credentials. Do not infer it from an environment label or a filename.
- Do not run legacy Prisma migration or reset commands. Do not run raw SQL or a script against a cloud database merely because it is called a test or uses a “dev” URL. Read-only queries may be used when scoped and safe; never expose secret values or unnecessary customer data.
- Preserve data integrity and tenant isolation. Do not silently alter billing, identity, OCPP, charging control, or migration behavior beyond the requested task.

## Secrets and fragile files

- Never print, commit, copy into documentation, or expose secret values, connection strings, or tokens. Report secret names and non-secret metadata only when needed.
- Treat `.env*`, `.dev.vars*`, `wrangler.jsonc`, `open-next.config.ts`, `middleware.ts`, authentication code, Drizzle schema/config/migrations, and retained Prisma migration files as fragile. Edit them only when the requested task specifically requires that surface. Do not change a secret value or an external binding as a side effect of a documentation or code cleanup.
- If a task expressly authorizes a non-secret `.env*` substitution, change only the named value and verify without displaying the file or credentials. Secret rotation and insertion remain operator actions unless specifically authorized.

## Product and code integrity

- **Low OPEX is project-wide product intent (Andri, 2026-10-30).** Apply the operating-cost principle in `FOCUS.md` to every implementation and architecture choice. For changes with material recurring impact, include expected idle/load/retry costs and human maintenance implications in the handoff, with assumptions and unverified estimates clearly marked. Reuse the smallest sufficient existing capability; do not add services or generic frameworks without a demonstrated application need and cost justification. Preserve necessary safety, integrity and session evidence. This does not authorize a broad rewrite or new infrastructure.

- Use the current implementation and `FOCUS.md` as the product baseline. Preserve proven behavior and avoid parallel frameworks, money engines, state stores, or vendor coupling without a demonstrated need.
- Keep tenant scope in data access and enforce permissions on the server. Do not fabricate product data or imply that a preview has working auth, billing, hardware control, or persistence when it does not.
- For material changes to OCPP semantics, charging state, site power allocation, money calculation, identity/access, or database integrity, explain the behavior and risk before implementation and obtain approval for the material deviation. Routine implementation choices within an approved task do not need a new gate.

## Verification, records, and ChatGPT handoff

### Lean verification and token use — Andri, 2026-11-01

- Use risk-based verification, not exhaustive repeated local checks. Before substantive work, select the smallest relevant local regression tests and type/build checks; identify broader suites that can run once in working CI. Do not write tests for simple copy/style changes or tests that merely mirror implementation.
- Run affected tests locally while editing. Reserve full suites, production builds and packaging for the integrated checkpoint or CI; do not repeat them after unrelated documentation or styling changes. Repeat a successful check only for relevant source/dependency/config changes, a failure or a concrete unresolved concern. Record the reason briefly.
- Carry forward evidence tied to the actual tested source/artifact (including dirty content), command and result. HEAD alone is insufficient. Codex reviews Claude's evidence and relevant diff instead of automatically rerunning everything; independently reproduce critical behavior or questionable results only where warranted.
- Push is not a test or deployment approval. Before moving checks to CI, verify workflow triggers, current Drizzle/root/gateway coverage, isolated fixtures, required secrets and any auto-deployment side effects. Repair obsolete CI in the authorized source scope. Do not assume a configured workflow passed, skip required checks, or call the task verified before its designated CI results arrive. Commit/push authorization remains separate.
- Keep targeted correctness checks for authorization/isolation, command/lifecycle races, financial idempotency, migration integrity and retained evidence before any live rollout. These can run in isolated local or verified CI environments; the real installation must never be the first regression test. Actual hardware/manual acceptance follows the complete implementation.
- Reuse existing test harnesses and fixtures. Add runtime/database/browser harnesses only for an identified gap; avoid redundant benchmark variations and repeated artifact builds. A waiting CI run is a verification dependency, not a reason to start unrelated work or an automated progress monitor.
- Keep tool output and handoffs compact: inspect targeted paths/diffs, print test summaries rather than passing-test logs, do not repeatedly read unchanged documents or publish long status recaps. No Claude progress heartbeats. Use the approved model/effort; extra/max effort and new model runs retain their approval requirements. These are working rules, not a technical hard token cap.

- Run applicable local checks and tests that cannot mutate live state. Record exact commands, results, failures, skipped checks, and what remains unverified. Compilation alone does not prove behavior.
- Keep `WORKSPACE.md` as the structural snapshot, `TASKS.md` as the task tracker, `DECISIONS.md` as the decision log, and `docs/agent-runs/` as dated execution evidence. Update the relevant existing record at meaningful checkpoints; do not create a competing status or diff log. Mark historical measurements and external state with their observation date.
- At the end of a substantive task, inspect the final diff and provide a self-contained **ChatGPT Review Handoff**: objective; implementation; changed files; repository path, branch, starting and ending SHA, and dirty/local-only state; relevant diff evidence; tests and skipped tests; architecture impact; risks and unresolved issues; external inspections or approved mutations; and recommended next step. A partial or failed task also needs a truthful handoff.
- Distinguish **VERIFIED**, **INFERRED**, and **UNKNOWN**. Never invent a test result, Git state, deployment, database state, or approval.
