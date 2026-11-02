<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Codex / ChatGPT token discipline — Andri, 2026-11-01

The owner's priority is reducing **Codex/ChatGPT token use**, not simply reducing Claude's work or test coverage.

- Codex primarily coordinates: concise assignments, targeted review of Claude's results, and separately authorized release actions. Prefer Claude for substantial implementation, investigation and test execution under the existing individually approved model-run workflow.
- Do not start a competing implementation lane while Sonnet is active. A prepared prompt or mail does not authorize another model run. Extra/max effort still needs additional explicit approval.
- Keep answers, progress updates, prompts and tool output short. Reference an existing specification and describe only the follow-up differences instead of repeatedly rewriting the entire task.
- Read only relevant files/diffs and result summaries. Reuse already-read unchanged context; avoid broad inventories, repeated document reads and full passing-test logs unless a concrete issue requires them.
- Review Claude's evidence instead of automatically rerunning its tests/builds or duplicating its investigation. Independently verify critical or questionable claims with the smallest sufficient check; distinguish reported results from independently verified results.
- No background Claude progress watches, transcript polling or heartbeat automations unless Andri explicitly requests them again. Check status/mail on request or when needed for the next authorized action. Lack of new mail is not proof that no work finished; inspect the relevant handoff/task record before concluding.
- Preserve necessary correctness/security checks and existing approval boundaries. Token conservation is not permission to claim unverified completion, skip required validation or alter the real installation. Do not change real charger/installation settings without a new explicit instruction allowing that action.
- These are working instructions, not a hard technical token cap. Do not interrupt an active Claude run merely to repeat this Codex-specific preference.
