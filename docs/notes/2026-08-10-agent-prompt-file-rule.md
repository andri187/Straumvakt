# Agent Prompt File Rule

Purpose: make Straumvakt agent work start from local prompt files instead of
chat copy/paste. A Claude Code, Codex, or GPT window should be able to read its
assigned prompt from disk and begin work when Andri says "go".

## Prompt Folder

All durable prompts should live under:

```text
E:\Claude\Straumvakt\docs\agent-prompts\
```

Use one dated subfolder per day:

```text
E:\Claude\Straumvakt\docs\agent-prompts\YYYY-MM-DD\
```

If that folder does not exist yet, create it before writing prompts.

## Filename Convention

Use this format:

```text
YYYY-MM-DD-HHMM-<agent>-<lane>-<short-task-slug>.md
```

Examples:

```text
2026-08-10-2300-claude-a-core-billing-hardening.md
2026-08-10-2300-claude-b-release-ops-cost-gates.md
2026-08-10-2300-codex-a-core-ui-billing-polish.md
```

Agent names should be stable:

- `claude-a`
- `claude-b`
- `claude-c`
- `claude-d`
- `codex-a`
- `codex-b`
- `gpt-coordinator`

## Prompt Header

Every prompt file must start with this header:

```yaml
---
agent: claude-a
lane: core-billing
status: ready
created_utc: 2026-08-10T23:00:00Z
estimated_wall_clock: 4-8h
target_worktree: E:\Claude\Straumvakt-core-billing
completion_artifact: E:\Claude\Straumvakt\docs\agent-runs\2026-08-10\claude-a-core-billing-hardening-completion.md
external_mutation_allowed: false
---
```

Allowed `status` values:

- `draft`
- `ready`
- `running`
- `complete`
- `superseded`
- `cancelled`

## Latest Assigned Prompt Index

Maintain a small index file:

```text
E:\Claude\Straumvakt\docs\agent-prompts\latest.md
```

It should list the current prompt file for each active window:

```markdown
# Latest Agent Prompts

| Agent | Prompt File | Status |
|---|---|---|
| Claude A | `2026-08-10\2026-08-10-2300-claude-a-core-billing-hardening.md` | ready |
| Claude B | `2026-08-10\2026-08-10-2300-claude-b-release-ops-cost-gates.md` | ready |
| Codex A | `2026-08-10\2026-08-10-2300-codex-a-core-ui-billing-polish.md` | ready |
```

## "Go" Rule For Agent Windows

If a Claude Code/Codex window is configured with a local rule for "go", it should:

1. Read `E:\Claude\Straumvakt\docs\agent-prompts\latest.md`.
2. Find the row matching its agent name.
3. Open that prompt file.
4. Confirm the prompt status is `ready`.
5. Change nothing in the prompt unless instructed.
6. Execute the prompt.
7. Write the required completion artifact.
8. Report only a concise TL;DR in chat, pointing to the completion artifact.

## Prompt Body Requirements

Every prompt should include:

- Goal.
- Locked context.
- Target worktree(s).
- Allowed paths.
- Forbidden actions.
- Required deliverables.
- Verification commands.
- Completion artifact path.
- Timing requirement.
- External state confirmation requirement.
- Cleanup rule: no new top-level `E:\Claude` folder, no avoidable
  `node_modules`, `.next`, build output, screenshots, or caches.

## Coordinator Rule

When the coordinator creates a new prompt:

1. Save it to `docs\agent-prompts\YYYY-MM-DD\`.
2. Update `docs\agent-prompts\latest.md`.
3. Add or update the row in `docs\notes\2026-08-09-ai-prompt-history-ledger.md`.
4. Include the completion artifact path inside the prompt.
5. Do not rely on chat as the only prompt copy.
