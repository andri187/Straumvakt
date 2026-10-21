# Local beta rehearsal

Date: 2026-08-09
Mutation boundary: local UI and connected-device display only

## Purpose

Rehearse the beta product story without live login, cloud mutation, SQL, charging, BLE/NFC writes, or invite consumption. The goal is to find misleading UI before an observed end-to-end pilot.

## Local preview

1. Start the web worktree with `STRAUMVAKT_LOCAL_PRODUCT_PREVIEW=1` on port 3012.
2. Open `/local/product-preview`; confirm the `Local preview` label is visible.
3. Visit Straumvakt admin, organisation admin and Driver tabs at desktop, tablet, phone width and 200% scale.
4. Confirm every fixture is `demo-*` or `.test` and browser network activity contains no application API request.
5. Confirm organisation aggregate, audit, visibility, cost assignment and installation-code dependencies remain unavailable.
6. Restart without the flag and confirm the preview returns 404.

## Authenticated local routes

Only continue if a local, non-customer session already exists. Do not log into beta or production for this rehearsal.

- Staff readiness: filter workflows; verify support context says assistance is not impersonation.
- Chargers: inspect loading/error/empty states; do not submit create unless using an approved local stub.
- Drivers: filter roster; open denial form; verify a reason is required and cancel restores focus.
- Sessions: verify null energy, power and cost remain unavailable/pending.
- Agreements: verify cost assignment remains disabled.
- Invite: verify the unsafe bearer action is absent.

## Driver device

1. Install the normal debug APK; do not clear or replace a real user's data without approval.
2. Open only guest/unaffiliated surfaces that do not trigger network or hardware actions.
3. Confirm the identity-bound invite path is the reachable path.
4. Confirm installation code/passphrase explains its missing contract when disabled.
5. At large text, inspect headings, actions, status announcements and scroll reachability.
6. Check Android crash logs after opening.

## Do not click

Do not submit a live login, invite, installation credential, charger create, approve/deny decision, session start/stop, BLE/NFC action, account deletion, or billing action. Do not treat the preview as proof that an endpoint works.

## Evidence

Capture filename, viewport/device/API, build SHA, route/surface, state, expected result, observed result, and whether any mutation occurred. Redact personal data before sharing.

## Beta blockers

- Cloudflare ownership, Git integration, deployed versions and route retention are verified in the dashboard.
- Beta and production Workers/databases are explicitly separated.
- Migration history is reconciled by an approved operator.
- Driver login rate limiting is implemented and verified.
- The first singular organisation + driver onboarding and real charge are observed end to end.
- Unsafe public invite consumption is removed after reachable clients migrate.
- Installation access-code contracts exist before its controls are enabled.
- Cost is independently reconciled against tariff inputs.
