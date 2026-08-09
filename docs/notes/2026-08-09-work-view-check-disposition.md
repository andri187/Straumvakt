# `check:work-view` — disposition

**Analysis and specification only. No script, workflow or route was changed.**

## What it is

`scripts/gen-work-view.mjs` generates a React page from two planning documents:

```
WORKSPACE.md  ─┐
               ├─► src/app/(app)/admin/work/page.tsx
TASKS.md      ─┘
```

- `npm run work-view` regenerates the page.
- `npm run check:work-view` (`--check`) **fails if the file on disk differs from
  what the generator would produce**, printing *"…/page.tsx is stale. Run
  `npm run work-view` and commit the result."*
- Wired into the gate by `c2cbe02` at `scripts/check-all.mjs:40`, whose own
  comment notes it *"was built to gate in CI … but was never wired in here"*.

## Why it is red on the relaunch lineage

**Because the page it checks no longer exists.**

| Fact | Class |
|---|---|
| Generator output path is `src/app/(app)/admin/work/page.tsx` | REPO-DECL (`gen-work-view.mjs:22`) |
| **`src/app/admin` is absent from the RC** — the whole `(app)` console was parked into `archive/straumvakt-org-console-2026-08-08/` | DEPLOYED-FACT (RC `4b69d0f`) |
| The RC web app has **7 route files**, none under `/admin` | DEPLOYED-FACT |
| `--check` reads the output path, finds nothing, and reports "stale" | REPO-DECL (`gen-work-view.mjs:178-180`) |

So the check is not detecting drift. **It is detecting that a route was
deliberately deleted** — and reporting it in the vocabulary of staleness, which
is why it reads as a real failure.

## What it validates — and what it does not

| Validates | Does **not** validate |
|---|---|
| That a derived artefact matches its two sources | Anything about product code |
| That someone re-ran the generator after editing the planning docs | That `WORKSPACE.md` and `TASKS.md` are *internally* consistent |
| — | That the task counts in `WORKSPACE.md` match the tasks in `TASKS.md` |
| — | That the page is correct, useful, or reachable |

**The check's entire value is drift detection between two Markdown files and a
generated copy of them.** That value does not require the copy to be a Next.js
route — which is the observation the whole disposition turns on.

## Cost of each option

### A · Restore `/admin/work`

| Cost | Detail |
|---|---|
| Product | Reintroduces an admin route into an app that was deliberately reduced to 7 routes. It is a *planning dashboard*, not product functionality — the accepted decision says exactly this |
| Security | An `/admin/*` route in the relaunched app needs an auth story. The parked console's gating assumptions do not carry over; `middleware.ts` only recently began compiling at all (`14c1ce2`) |
| Maintenance | Every future planning-doc edit becomes a committed `.tsx` diff |
| **Verdict** | **Rejected** — highest cost, no product benefit |

### B · Remove the gate

| Cost | Detail |
|---|---|
| Process | Loses automated drift detection between planning docs and their derived view |
| **But** | That view no longer exists, so there is nothing left to drift |
| Change size | **One line** — remove `["work-view", "npm run check:work-view"]` from `check-all.mjs:40` |
| **Verdict** | **Recommended** |

### C · Keep the gate, make the generator tolerate a missing route

Change `--check` to pass when the output directory is absent. Rejected: a check
that passes because its subject is missing is worse than no check — it looks
green while validating nothing, which is precisely the failure mode this repo
already hit once (`check:schema-parity` existed and nothing called it).

### D · Repoint the generator at a Markdown artefact

Emit `docs/notes/work-view.md` instead of a `.tsx` page. Keeps the single-source
guarantee, drops the route entirely. **Legitimate**, and strictly better than C —
but it still commits a generated file, and the value is modest.

## Recommendation

**B, plus keep `npm run work-view` as a local command.**

1. **Remove `check:work-view` from `check-all.mjs`** — one line.
2. **Keep `scripts/gen-work-view.mjs` and the `work-view` script.** Do not delete
   the generator. It is harmless, occasionally useful, and deleting it discards
   working code to solve a gating problem.
3. **Retain `WORKSPACE.md` and `TASKS.md` unchanged** — the accepted decision says
   to retain source planning documents, and nothing here touches them.

The pipeline becomes honest: it stops asserting that a deleted route is stale.

## Smallest future RC change

For Claude A or Codex to apply **with approval** — specified, not implemented.

**File:** `scripts/check-all.mjs`
**Change:** remove the single entry at line 40:

```js
  ["work-view", "npm run check:work-view"],
```

**Also update the comment block above it** (lines 35–39), which currently
explains why the check *was* wired in. Leaving a comment that argues for a
removed line is how the next person re-adds it.

**Do not touch:** `scripts/gen-work-view.mjs`, `package.json` scripts,
`WORKSPACE.md`, `TASKS.md`, or `.github/workflows/check.yml`.

**Acceptance:**
- `npm run check` passes without `work-view` in the list;
- `npm run work-view` still runs manually and still writes to its configured path;
- no other check's status changes.

**Effort:** trivial. **Risk:** none — it removes a gate, it does not add one.

## Alternative checks that would actually be worth having

If drift detection between the planning documents is genuinely wanted, check the
**documents against each other** rather than against a generated copy:

| Check | Validates | Why better |
|---|---|---|
| Task-count parity | The health numbers in `WORKSPACE.md` match the tasks parsed from `TASKS.md` | Catches the real drift — the two documents disagreeing — which the current check cannot detect at all |
| Task-status vocabulary | Every task line uses a known marker (`[ ]`, `[x]`, `[~]`) | `c2cbe02`'s sibling fix already had to teach the parser about `[~]`, which means unknown markers were being silently dropped |
| No orphan references | Every ADR/doc referenced by `TASKS.md` exists | Cheap, catches rot |

**All three operate on the Markdown alone** — no generated artefact, no route, no
committed `.tsx`. That is the version of this check that would have survived the
relaunch, and it is what should replace it if anyone wants the guarantee back.

**Not proposed for now.** The accepted decision is that this must not gate
release, and none of these is worth blocking on today.
