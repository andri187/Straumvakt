# Agent Completion Artifact Rule

Purpose: stop coordinator state from depending on chat copy/paste. Every Claude
Code, Codex, or GPT agent prompt for Straumvakt work must require a local
completion artifact that can be read later by the coordinator.

## Required Completion File

Each agent must write one completion file at the end of its run:

```text
E:\Claude\Straumvakt\docs\agent-runs\YYYY-MM-DD\<agent>-<short-task-slug>-completion.md
```

If the task is intentionally isolated in a non-canonical worktree, the agent may
also write a copy inside that worktree, but the canonical copy above is the
coordination source of truth.

## Required Fields

The completion file must include:

- Agent/window name.
- Prompt file or prompt title.
- Target worktree(s).
- Branch name(s).
- Start UTC.
- End UTC.
- Actual wall-clock duration.
- Requested/estimated wall-clock duration.
- Whether the duration target was met.
- Start tip(s).
- End tip(s).
- Dirty/clean state at close.
- TL;DR, 5 lines or fewer.
- Human-readable conclusion.
- Files created/changed.
- Commits created.
- Tests/checks run and result.
- Deliverables completed.
- Deliverables skipped or blocked.
- Important corrections to earlier assumptions.
- External state confirmation.
- Cleanup candidates created by the run.
- Next recommended action.

## Machine-Readable Sidecar

When practical, also write:

```text
E:\Claude\Straumvakt\docs\agent-runs\YYYY-MM-DD\<agent>-<short-task-slug>-completion.json
```

Minimum JSON fields:

```json
{
  "agent": "",
  "prompt": "",
  "worktrees": [],
  "branches": [],
  "startUtc": "",
  "endUtc": "",
  "actualWallClock": "",
  "estimatedWallClock": "",
  "durationTargetMet": false,
  "startTips": {},
  "endTips": {},
  "status": "complete|partial|blocked",
  "tldr": "",
  "externalMutation": false,
  "filesChanged": [],
  "commits": [],
  "tests": [],
  "skippedOrBlocked": [],
  "nextAction": ""
}
```

## Prompt Text To Include

Add this block to future prompts:

```text
At the end of the run, do not rely on chat as the only handoff. Write a
completion artifact to:

E:\Claude\Straumvakt\docs\agent-runs\YYYY-MM-DD\<agent>-<short-task-slug>-completion.md

Include TL;DR, conclusion, start/end UTC, actual wall-clock duration, requested
duration, whether the duration target was met, start/end tips, files changed,
commits, tests, skipped/blocked work, external-state confirmation, cleanup
candidates, and next recommended action. If practical, also write the JSON
sidecar described in docs/notes/2026-08-10-agent-completion-artifact-rule.md.
```

## Coordinator Rule

Before concluding that an agent result is missing, the coordinator should scan:

```text
E:\Claude\Straumvakt\docs\agent-runs\
E:\Claude\Straumvakt\docs\memory\
E:\Claude\Straumvakt\docs\notes\
```

and compare recent git tips across active `E:\Claude\Straumvakt*` worktrees.
