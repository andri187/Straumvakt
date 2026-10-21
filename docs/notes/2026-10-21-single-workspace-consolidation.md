# Single-workspace consolidation

Date: 2026-10-21

## Result

`E:\Claude\Straumvakt` is the only permanent Straumvakt checkout and the only
registered Git worktree. It contains the web product, API and OCPP Workers,
Flutter driver app, shared packages, hardware tooling, product documentation,
release evidence, and preserved historical source.

Canonical branch:

```text
codex/single-workspace-consolidation-2026-10-21
```

No remote branch, deployment, cloud resource, database, DNS record, or secret
was changed.

## Integrated work

The consolidation history includes the connected-test and billing spine, clean
market shell, hardened Flutter driver app, staff/organisation product surfaces,
DSO proof of concept, release-operations validators, backend binding checker,
relaunch history, and staging-catchup documentation.

Two dirty checkouts contained unique uncommitted work:

- 84 changed parked-console files are preserved in
  `archive/adminview-delta-2026-10-21`. Another 117 files were byte-identical
  to the existing console archive and were not duplicated.
- The recovered vehicle-render batch is preserved in
  `archive/vehicle-image-candidates-2026-08-28`. It did not replace the active
  Flutter assets because representative candidates had no alpha channel; the
  canonical assets retain transparent backgrounds.

The generated `/admin/work` repository-health route was removed from the
product and from `npm run check`. Its generator remains a local-only historical
preview tool, and generated output is ignored.

## Recycled checkouts

The following folders were moved to the Windows Recycle Bin, not permanently
deleted:

```text
E:\Claude\Straumvakt-adminview
E:\Claude\Straumvakt-audit-checks
E:\Claude\Straumvakt-beta-production
E:\Claude\Straumvakt-connected-test
E:\Claude\Straumvakt-core-billing
E:\Claude\Straumvakt-core-security
E:\Claude\Straumvakt-diag-p4c
E:\Claude\Straumvakt-driver-access-ui
E:\Claude\Straumvakt-onboarding-domain
E:\Claude\Straumvakt-onboarding-web
E:\Claude\Straumvakt-relaunch-integration
E:\Claude\Straumvakt-release-candidate
E:\Claude\Straumvakt-relops-b
```

Stale registrations for those checkouts and two already-missing temporary
worktrees were pruned after the folders had left the filesystem.

`E:\Claude\CPMS` is a separate legacy repository and was not modified.

## Local branches

Merged and superseded local topic branches were removed. Three local branches
remain:

```text
codex/single-workspace-consolidation-2026-10-21
staging
dev/rename-prod-worker
```

`staging` remains the deploy pointer. `dev/rename-prod-worker` is deliberately
unmerged because changing a Wrangler script name creates a new Worker identity
and the required Cloudflare evidence is absent.

## Verification

- `npm run check`: 16 of 16 checks passed.
- `npm test -- --run`: 136 files passed; 3,907 tests passed; 1 skipped.
- `npm run build`: production Next.js build passed; `/admin/work` absent.
- `npm --prefix tools/zaptec-test run typecheck`: passed.
- `flutter analyze`: no issues.
- `flutter test`: 58 tests passed.
- `flutter build apk --debug`: passed; output at
  `apps/mobile/build/app/outputs/flutter-apk/app-debug.apk`.

The Next build reports the existing middleware-convention deprecation and an
outdated Browserslist dataset; neither blocks the build.

## Future worktrees

The lifecycle and naming rule is in `docs/WORKTREE_POLICY.md`. Temporary
checkouts use `TEMP-Straumvakt-<task>-<YYYYMMDD>`, carry an explicit expiry,
and return to the Recycle Bin after reconciliation.
