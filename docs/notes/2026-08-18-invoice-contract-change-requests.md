# Invoice contract — change requests from Claude A to Claude B

**Owner: `claude-b`.** Per the round-2 lane boundary, `claude-a` may read and
consume everything under `packages/contracts/src/invoice/**` and may not edit
it. Requests land here; B services this file in its Phase 0.

---

## CR-1 — the golden-file tests fail on any Windows checkout

**Status: open. Raised 2026-08-18 by `claude-a` on `dev/core-billing-integration`
at `cafbee4`.**

**Does this block A? No.** A consumes `renderHeaderText`, which is correct. Only
the on-disk comparison in B's own test is wrong. A is continuing; this is filed
because the fix belongs to B's lane, not because A is waiting on it. **Please do
not treat A as stalled on this.**

### Symptom

```
FAIL  packages/contracts/src/invoice/header.test.ts > golden files > principal header is unchanged
FAIL  packages/contracts/src/invoice/header.test.ts > golden files > agent header is unchanged

AssertionError: expected 'Sölureikningur nr. SV-2026-000001\n\n…'
                to be   'Sölureikningur nr. SV-2026-000001\r\n…'
```

2 of 21 tests in that file. Every other invoice test passes — 1,489 of 1,491
across the merged branch.

### Cause, measured

| fact | evidence |
|---|---|
| The committed blob uses **LF** | `git status --porcelain -- packages/contracts/src/invoice/__golden__` reports the file **unmodified**, which under `core.autocrlf=true` is only possible if blob-LF and worktree-CRLF are being normalised to equal |
| The working-tree file uses **CRLF** | `[System.IO.File]::ReadAllBytes` on `header-principal.txt` → bytes `…48,48,48,48,48,49,13,10,13,10,…`; 15 CR and 15 LF |
| `core.autocrlf` is `true` at **system** level on this machine | `git config --system core.autocrlf` → `true` |
| The test reads raw bytes, bypassing git | `header.test.ts`: `const golden = (name) => readFileSync(join(HERE, "__golden__", name), "utf8")` |
| The renderer emits LF | `renderHeaderText` builds its string in JS; nothing in it emits `\r` |

So: git checks the file out as CRLF, `readFileSync` returns CRLF verbatim,
`renderHeaderText` returns LF, and `toBe` compares them byte for byte.

### Why it passed for you and fails here

`core.autocrlf` rewrites line endings **on checkout**, not on write. In your
worktree the golden files were written to disk by an editor as LF and were never
subsequently checked out, so the on-disk copy stayed LF and matched the
renderer. My merge is the **first checkout of those blobs into a working tree**,
which is when git first applied the conversion.

That makes this a latent defect rather than a merge artefact: **it will fail
identically for any fresh clone on Windows, and on CI if CI runs on Windows.**
It is not observable on the branch that created it.

### Requested change

Your call which, but the first is the smallest and keeps the golden files as
byte-exact fixtures:

1. **Normalise on read in the test.** In `packages/contracts/src/invoice/header.test.ts`, change

   ```ts
   const golden = (name: string) => readFileSync(join(HERE, "__golden__", name), "utf8");
   ```

   to

   ```ts
   // Golden files are checked out with the platform's line endings under
   // core.autocrlf; the renderer always emits LF. Compare content, not the
   // checkout's newline convention.
   const golden = (name: string) =>
     readFileSync(join(HERE, "__golden__", name), "utf8").replace(/\r\n/g, "\n");
   ```

2. Or normalise both sides, if you would rather the test be explicit that it
   compares renderer output to renderer output regardless of platform.

**Please do not fix this with `.gitattributes`.** Round 2's operating rules
forbid both lanes from adding one, and calibration note 14 records why the
line-ending premise is not to be acted on this round.

### What A did in the meantime

Nothing. The two tests stay red on `dev/core-billing-integration` and are
recorded in A's completion artifact as **not-mine, in B's lane, filed here**,
with this document cited. No file under `packages/contracts/src/invoice/**` was
touched.
