# PROPOSED D — Protect the real database branches; stop the abandoned one being the default

**Status:** Proposed · **Date:** 2026-08-09 · **Decision owner:** Andri
**Register:** D-4

## Context

Neon project `spring-leaf-73019190`:

| Branch | Role | default | protected | Size |
|---|---|---|---|---|
| `production` | CPMS-era, abandoned | **yes** | **no** | 37 MB |
| `staging` | real data | no | **no** | 595 MB |
| `test` | disposable | no | no | 590 MB |

The default branch's compute was reached at 2026-08-08T20:38:44Z by a call that
omitted a branch id.

The failure mode is silent: `production` carries an older schema, so an
unqualified query fails with `relation "identity.organizations" does not exist`
— which reads as a schema bug rather than a wrong-branch error.

CPMS's `CLAUDE.md` asserts the primary branch is protected. That is no longer
true.

## Options

1. Protect `staging` and `production`; repoint the project default.
2. Protect `staging` only.
3. Discipline only — always pass an explicit branch id.

## Recommended

**Option 1.** Option 3 is not a control, it is a hope. Protection makes the
wrong action fail loudly, which is precisely the property the current silent
failure mode lacks. Discipline is still required in addition, for tooling and
agents.

## Consequences

Protection may block legitimate maintenance and will need a documented
exception path.

## Unresolved

Whether `production` holds anything CPMS still needs before it is repointed or
retired.
