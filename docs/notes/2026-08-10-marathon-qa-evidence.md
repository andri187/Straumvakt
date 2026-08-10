# Marathon Core UI QA evidence index

Evidence root: `C:\Users\Andri\Documents\New project\evidence\core-ui-integration-quality-2026-08-10`

## Verification summary

| Check | Result |
|---|---|
| Marathon-focused Vitest | 1,424 passed / 9 files |
| Full repository Vitest | 2,212 passed, 1 skipped, 1 inherited parse-blocked suite |
| TypeScript | Passed |
| Next.js production build | Passed |
| New integration routes | 22 of 22 returned HTTP 200 |
| Formal visual groups | 40 |
| Page overflow | 0 of 40 |
| Duplicate IDs | 0 of 40 visual groups and 16 accessibility groups |
| Meaningful text clipping | 0 of 16 accessibility groups |
| Stale runtime claims | 0; grep matches occurred only inside negative tests |
| API-call guard | Passed |
| Disabled-action guard | Passed |

The inherited full-suite failure remains `scripts/check-workspace-typecheck.test.mjs: SyntaxError: Invalid or unexpected token`. This UI run did not edit that suite.

## Visual matrix

- Desktop 1280 x 720: all 22 new integration routes.
- Tablet 768 x 1024: nine representative Admin, CPO and Driver routes.
- Mobile 390 x 844: nine representative Admin, CPO and Driver routes.

`visual-audit.json` records route, heading, viewport, page width, overflow, current-navigation label, disabled controls, warning count and duplicate IDs.

Representative inspection covered:

1. heartbeat source implementation versus missing runtime proof;
2. CPO CDR mismatch and disabled period lock;
3. per-session manual review alongside the fixed meter engine;
4. Driver-facing CDR amount mismatch;
5. denied access without tenant disclosure.

## Accessibility and copy fit

`accessibility-copy-fit-audit.json` covers 12 mobile and four desktop structures. It records tabbable labels, headings, table headers, duplicate IDs, document overflow and text clipping.

- Skip link, named navigation, labelled filter and named table-scroll region remain present.
- Focus-visible and filter focus-within treatments remain enforced by source tests.
- Reduced-motion and forced-colors rules remain enforced.
- Disabled controls have adjacent dependency copy.
- No meaningful copy clipping was detected at the captured sizes.

Native 200% browser zoom and device text scaling were not automated. They remain manual checks in the printable guide and are not reported as passing.

## Current-finding reconciliation

- Meter delta fix: credited in engine-level copy.
- Meter anomalies: held per session, never treated as global engine failure.
- Heartbeat fast path: credited in source.
- Gateway suite/toolchain and deployment evidence: incomplete/unverified.
- Queue deployment: unknown, not described as missing or healthy.
- Offline sweep: explicitly not built.
- CDR mismatch/unlabelled provenance: held from final statement state.
- Cross-tenant and manual-driver authority: explicit product/security decisions.

## Evidence hygiene

Screenshots are representative rather than exhaustive viewport permutations. No screenshot, build output or evidence file is tracked by Git. The regenerable `.next` directory is the only repository-worktree cleanup candidate created or expanded by this run.
