# S1: OEM image picker and Chargers tabs — Sonnet assignment

Requested by Andri, 2026-11-02. Canonical checkout `E:\Claude\Straumvakt`, branch `codex/core-checkpoint-2026-10-31`, starting HEAD `9f173f3`. Source-only implementation. Preserve all existing dirty and untracked work. Read root `AGENTS.md`, `CLAUDE.md`, and the relevant installed Next guide before code changes. No new model run is authorized by this file alone.

## Outcome

1. **Add installation starts with the model image board.** Adapt the existing local preview `tools/zaptec-test/model-picker.html` into the real `/cpo/installations` flow. It currently has 11 image cards, with Easee Charge and Zaptec Pro highlighted and unsupported models greyed out. Use it as the visual and interaction reference, including narrow screens and keyboard access. Do not make unsupported cards actionable. Clicking an enabled card continues into the existing OEM connection and multi-installation onboarding flow in `src/app/cpo/installations/vendor-onboarding.tsx`. Keep manual installation entry as a clear secondary path. The first picker view should render without waiting for the manual editor's directory, draft and incoming-charger database reads; defer those until their paths need them. Preserve in-progress draft and editor behaviour. Check both the enabled UI and the server's actual vendor readers before marking a model available.

2. **Chargers has two tabs:** Already onboarded (the existing registered/grouped charger list) and Knocking (the existing incoming charger list and its attachment actions). Let the operator switch without losing current selection or triggering unnecessary reads. Show an in-app notification/count when visible knocking chargers have not been onboarded, including on the inactive Knocking tab. Use the existing incoming snapshot and expiry rules; do not count registered, stale or failed-to-load rows as waiting. If incoming data is unavailable, say that instead of displaying zero. No browser/OS push notification, new timer, background polling, service or database table.

## Existing source and constraints

- Current routes: `src/app/cpo/installations/page.tsx` (`?new=1` manual, `?onboard=1` OEM) and `src/app/cpo/chargers/{page,chargers-overview,incoming-table,grouped-table}.tsx`.
- Shared cache and expiry: `src/lib/sync/structural-store.ts`, `src/lib/installations/incoming-window.ts`. Reuse the existing list/incoming requests and auth partition. Preserve truthful loading/error/access-lost states.
- Image reference: `tools/zaptec-test/model-picker.html` and `docs/reference/charger-images/onepole-2026-10-31/`. Andri trusts the current image formatting and wants a lightweight page; check the shipped payload when moving assets into `public/` rather than reprocessing every image by default. The image reference README says reuse rights are unverified. Preserve provenance and flag that release question explicitly; source work may use the local reference.
- Related implementation handoff: `docs/agent-runs/2026-10-31/2026-10-31-direct-oem-onboarding-handoff.md`. The user rejected file-upload onboarding; retain the direct OEM flow.

## Evidence and handoff

Use focused checks for changed navigation, picker availability, tab switching, and the notification count/expiry/error states. One local browser check at desktop and narrow width is useful; avoid repeating the full suite without a concrete failure. Report exact files, checks, remaining gaps, and whether any image rights or live database behaviour remains unverified. Do not push, deploy, migrate, change secrets, or touch real charger settings. Do not claim the currently live site changed.
