# OEM model board and Chargers tabs — handoff (2026-11-02)

Claude Sonnet in VS Code, `E:\Claude\Straumvakt`, branch `codex/core-checkpoint-2026-10-31`, HEAD `9f173f3` before and after. **Nothing committed, pushed, deployed, migrated or sent to Cloudflare, Neon or a charger.** Existing dirty and untracked work preserved. The live site is unchanged. Brief: `docs/agent-prompts/2026-11-02-s1-oem-picker-and-charger-tabs.md`.

## What changed

**Add installation → model board.** `/cpo/installations?add=1` is now what the "Add installation" button opens (the separate "Onboard from OEM" header button is gone; its page `?onboard=1` remains as the destination).
- `model-picker.tsx` is a server component with no client JavaScript. The first view reads no database and makes no API call: it needs only the deployment's enabled-OEM setting.
- A card is a link only when its model maps to a vendor that `enabledVendors(env)` returns, i.e. named in `CPO_VENDOR_CONNECT` **and** having a real reader in `vendor-onboarding.ts`. Easee Charge and Zaptec Pro qualify; a reader that exists but is switched off shows "Not enabled here"; the other 9 show "Not available yet" and are plain `div`s (not links, not focusable). Zaptec Go is deliberately not offered (the reader has been exercised against Pro-class installations only).
- Choosing a card goes to `?onboard=1&model=<vendor>`; `VendorOnboarding` takes `initialVendor` and starts the same connection check its model button does (only for a model the deployment enabled; zero-delay timer so development's double mount runs it once).
- Manual entry is a visible secondary button on the board and keeps `?attach=` ids. The editor's directory/draft/incoming reads still load only on `?new=1`, so they are now deferred until the operator chooses it.
- Model list and availability rule: `src/lib/installations/oem-models.ts`.

**Chargers tabs.** `chargers-overview.tsx`: *Already onboarded* (existing grouped list) and *Knocking* (existing incoming table and attach actions).
- Both panels stay mounted; the inactive one is `hidden`. Switching makes no request and keeps the checkbox selection, opened captures and expiry state. Roving-tabindex arrow-key navigation; `?tab=knocking` opens Knocking and the address is kept in step with `history.replaceState` (no navigation).
- The waiting count is reported by the Knocking table itself from `visibleIncoming()` (new `incoming-visible.ts`; the table now uses it too), so badge, notice and table cannot disagree: state `incoming` only, inside the 30-minute window or with a gateway-reported open socket, never `recovery` rows, nothing counted before the browser clock is read. It adds no read, timer, storage or push; the table's existing single expiry timeout moves the count, also while the tab is inactive.
- Zero shows nothing. If no list could be read the badge is "?" with "waiting count unavailable", and the Already-onboarded tab says the check failed. While loading, no number.

**Pictures.** 11 images from `docs/reference/charger-images/onepole-2026-10-31/images` (originals untouched) as 360 px WebP into `public/oem-models/`: **4,255,876 → 87,898 bytes total**, framing unchanged. Two originals were over 1.2 MB. Added to `PUBLIC_ASSET_PATHS` (`workers/cpo-shell-edge.mjs`) and `SHELL_PUBLIC_ASSETS` (`src/lib/cpo-shell-policy.ts`), which the shell prunes and serves by exact list; the existing edge test keeps those two equal.

## Checks that ran

| Check | Result |
|---|---|
| root `npx tsc --noEmit` | clean |
| `npx vitest run src/lib/installations scripts/cpo-shell-edge.test.mjs src/app/cpo` | 23 files, **417 passed** (includes new `incoming-visible.test.ts`: window boundary, open-socket stay, recovery/unreadable excluded, no-clock render; model availability, no reader ⇒ never a link, every image allow-listed and on disk) |
| `env -u DATABASE_URL npx next build --webpack` | pass |
| Real browser, Chrome, desktop 1280 and 390 px, local rig (`ONLY=picker-tabs node tools/browser-rig/drive.mjs`, 80-charger fixture) | **56 checks, 0 failures**; screenshots and `results.json` in `docs/agent-runs/2026-11-02/browser/` |

Browser facts: the board document load made **0 API requests and 0 database connections**; 11 cards, 2 links; all 11 images `image/webp`, 87,898 B; no horizontal overflow at 390 px; focus ring visible. Chargers: no knocks ⇒ no badge; 4 knocks (1 min, 5 min, 45 min, 29.93 min old) ⇒ badge 3 (the 45-minute one excluded); notice shown on the other tab; tab switches made 0 requests and kept a ticked row; the 29.93-minute row left the count at its deadline with the tab inactive and 0 requests; `?tab=knocking` reload; arrow keys; after a revoked session the page says "Access was lost" and shows neither a 0 nor a count.

Test tooling only: `tools/browser-rig/rig.cts` gained `/__rig/knock` and `/__rig/clear-knocks`; `drive.mjs` gained an `ONLY=picker-tabs` mode (default run unchanged).

## Not verified / remaining

- **Image reuse rights are unverified.** The pictures came from a public bracket-configurator and the images README says so. They are now on the *public* allow-list (served before sign-in). Decide on rights, or replace with OEM press images, before a customer-facing release. Provenance is in `public/oem-models/README.md`.
- The rig gives the Next server **no database**, so the `?onboard=1&model=` page (it reads `contextDirectory`) and the manual editor were not rendered there: only the link target and the board were. The `initialVendor` start is covered by reading and typecheck, not by a rendered pass; check it once against a real database after release.
- "Not enabled here" is shown when `CPO_VENDOR_CONNECT` is unset on a deployment; I did not read the live setting. If the live shell has it unset, no card will be clickable until it is enabled (a deployment setting, not changed here).
- `tools/zaptec-test/connection-check*.mjs` still say "Installations → Onboard from OEM" in a message and its test; left alone (separate untracked tool, test asserts the wording). Update it if that tool is kept.
- Full root/gateway suites and the OpenNext packaging/dry-run were not rerun: no gateway, schema or migration file changed; an artifact rebuild is needed for release because the shell's asset list and pages changed.

## Files
New: `src/app/cpo/installations/model-picker.{tsx,css}`, `src/app/cpo/chargers/charger-tab.ts`, `src/lib/installations/{oem-models,incoming-visible}.ts` (+ `incoming-visible.test.ts`), `public/oem-models/` (11 WebP + README). Changed: `src/app/cpo/installations/{page,vendor-onboarding}.tsx`, `src/app/cpo/chargers/{page,chargers-overview,incoming-table}.tsx`, `chargers.css`, `src/lib/cpo-shell-policy.ts`, `workers/cpo-shell-edge.mjs`, `tools/browser-rig/{rig.cts,drive.mjs}`, `TASKS.md`.
