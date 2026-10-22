# Mobile prototypes rescued from `E:\Claude\CPMS` — archived 2026-10-22

These three folders sat beside the CPMS repository on disk and were **in no git
repository at all** — no history, no remote, one copy on one drive. They are
archived here before `E:\Claude\CPMS` is deleted.

Nothing here is active. This is a rescue, not a harvest.

## What they are

| Folder | Files | Newest | What it is |
|---|---|---|---|
| `mobile-app/` | 102 | 2026-08-02 | Flutter prototype — `lib/main.dart` is **5,348 lines** |
| `mobile-app-driver/` | 115 | 2026-08-02 | Flutter driver prototype — `lib/main.dart` is **3,926 lines**, plus `ble_scanner.dart`, `nfc_auth.dart` |
| `straumvakt-ui-lab/` | 4 | 2026-04-26 | A static UI sketch from the week Straumvakt was named |

Build output was stripped on the way in — `build/`, `.dart_tool/`, `.gradle/`,
`node_modules/`, `.idea/`. For `mobile-app-driver` that was 4,008 of its 4,123
files, all regenerable. Assets, screenshots and `snapshots/` were kept
deliberately: they are the evidence of what these prototypes looked like.

## Why they were kept rather than dropped

The functionality has been carried forward into `apps/mobile`, which is the
refactored descendant — 38 files and a 252-line `main.dart` against these
multi-thousand-line monoliths. Verified file by file:

| Prototype file | Superseded by | Note |
|---|---|---|
| `nfc_auth.dart` (152 lines) | `apps/mobile/lib/tap_auth/tap_reader.dart` (157) | same implementation, renamed — identical `NfcManager` / `NfcTag` / `NfcTapHit` / `NfcTapReader` symbols |
| `ble_scanner.dart` (200) | `apps/mobile/lib/ble/scanner.dart` + six `zaptec_ble_settings/` files | the successor is substantially larger |
| `api.dart` (263 / 343) | `apps/mobile/lib/api/{client,types,auth_storage}.dart` | split into three |
| `tap_intent.dart` (264) | `apps/mobile/lib/tap_auth/tap_intent.dart` (337) | successor is ahead |

**So why keep them?** File comparison proves the *named* functionality moved
across. It cannot prove that nothing inside a 5,348-line `main.dart` was left
behind in the refactor. That judgement needs a human reading it, and it can
only be made while the code still exists — which is the whole reason this
folder is here rather than in a deleted directory.

Date them from August 2026, which is Straumvakt-era work that merely lived
under the CPMS parent folder. They are not CPMS-era (April) despite the path.

## Related

- `docs/reference/cpms/` — the four scope artifacts harvested from the CPMS
  repository, with its own provenance note
- ADR 0003 — no CPMS backfill; still in force
- ADR 0056 — the to-market product is a new build; nothing here is inherited
