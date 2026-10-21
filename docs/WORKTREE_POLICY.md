# Straumvakt workspace policy

`E:\Claude\Straumvakt` is the only permanent checkout and the source of truth
for the complete Straumvakt product. The web applications, Flutter driver app,
Workers, shared packages, tools, product documentation, and retained evidence
belong in this repository.

## Temporary worktrees

A second checkout is allowed only for genuinely parallel or isolated work.
Its folder name must use this form:

```text
TEMP-Straumvakt-<short-task>-<YYYYMMDD>
```

Every temporary worktree must have a lifecycle record in its task handoff or
completion artifact containing:

- purpose and owner;
- source branch and starting commit;
- creation date and explicit expiry date;
- expected integration target;
- retirement condition.

The default maximum lifetime is seven days. A longer lifetime requires a new
dated decision in `DECISIONS.md`; silently keeping a worktree is not an
extension.

## Retirement

Before retirement:

1. inspect tracked, untracked, ignored, and dirty files;
2. integrate or explicitly reject every unique commit;
3. preserve any unique non-secret artifact in the canonical repository;
4. verify the canonical branch and relevant tests;
5. detach the worktree registration;
6. move the folder to the Windows Recycle Bin; and
7. prune stale worktree metadata.

Never permanently delete a Straumvakt checkout as part of routine cleanup.
Never use a temporary worktree as a deployment pointer or a second source of
truth.
