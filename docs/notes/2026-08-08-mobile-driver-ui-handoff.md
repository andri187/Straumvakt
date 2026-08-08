# Straumvakt relaunch → mobile driver UI: handoff for Codex

**Date:** 2026-08-08
**Audience:** an external AI coding tool (ChatGPT / OpenAI Codex) picking up work on the
**mobile driver app**, without any of the context from the web-side relaunch that just happened.
**Purpose:** explain what changed on the web side, why it changed, and what that means for the
scope of mobile work — plus point at everything in the repo that's directly useful reference
material, and flag the one open question that isn't resolved yet.

**Update (same day, later):** the two open questions this document originally flagged have since
been investigated and resolved — see section 3 and section 5. The short version: the
invoices/session-history doc drift was a tooling bug, not a real change (nothing to fix there);
the driver-invite flow genuinely has no mobile caller today, and that's a real, confirmed gap
worth a product decision, not a hunch.

If you only read one section, read "What this means for mobile" and "Confirmed status" (section 5).

---

## 1. What changed (the go-to-market shift)

`straumvakt.org` used to be one monolithic web console: a single root page combined a marketing
hero with login forms for both hosts *and* drivers, and everything else (operator dashboard,
billing, chargers, driver history/cost/settings pages, invite redemption, etc.) lived behind it
as one big app.

That's been reset. The new shape is three separate entry points instead of one console:

1. **A minimal real login** at the root (`straumvakt.org`) — admin auth only, no driver-login
   fallback, no links into the old console. This is the only thing live at the root today.
2. **A Straumvakt-employee landing page** (`/staff`, `/staff/overview`) — internal tooling
   surface for Straumvakt's own staff.
3. **A per-org landing page template** (`/org`, `/org/[slug]`, `/org/[slug]/profile`) — built as
   a reusable template, with N1 ehf as the first real tenant. Tenant identity is resolved from
   the session server-side, never trusted from the URL slug.

Everything that isn't one of those three things — the old operator console, the host-admin
console, the public host-application form, invoice preview routes, org-invite acceptance UI,
and **the entire driver web portal** — was moved verbatim (via `git mv`, zero content changes)
into `archive/straumvakt-org-console-2026-08-08/`. Nothing was deleted. It's parked, not gone,
specifically so it can be read as reference or selectively restored.

**The decision that matters for you:** driver-facing UI is moving fully to the existing mobile
app. There will be no driver web portal going forward. The old one at
`archive/straumvakt-org-console-2026-08-08/app/driver/` is kept around *as UX reference*, not
as something being maintained or restored.

## 2. What this means for mobile

This is a scope statement, not a set of instructions on how to build anything — the point is to
tell you what the mobile app is now responsible for that it may not have been before, and where
to look for the shape of that responsibility.

- The mobile app is now **the only** driver-facing surface. Any driver capability that used to
  exist on the web (or is expected to exist per the backend API) needs to live in the mobile
  app — there is no web fallback to lean on anymore, and none is planned.
- The parked web driver portal (`archive/straumvakt-org-console-2026-08-08/app/driver/`) is a
  reasonable UX reference for *what a driver needs to be able to do*, even though its
  implementation (Next.js web) isn't directly portable. Per its own archive notes it covered:
  login, viewing charge sessions/history, cost, settings, and redeeming an invite code. Treat it
  as a checklist of driver-facing capability to verify mobile already covers, not as code to
  port.
- The backend driver API surface is untouched by any of this — only web UI routes moved or were
  reset. The routes described in section 3 below are live today regardless of what mobile
  currently calls.

## 3. Current backend state relevant to driver/mobile

### Driver invite redemption — ADR 0053 (already shipped, already tested)

`apps/api/src/routes/public/driver.ts` implements identity-bound invite redemption: when a
driver invite is redeemed, the code now compares the invite's `user_tokens.user_id` against the
authenticated redeemer before honoring it, and returns a byte-identical 404 on mismatch (same
response as an unknown/invalid code, to prevent enumeration of which codes are valid vs. simply
not-yours). A mismatch is recorded as a `driver_invite.redemption_rejected` audit action.

There's also a new endpoint, `POST /api/driver/claim-invite`, for the passwordless-invitee case
— bootstrapping real credentials for someone who was invited but doesn't have an account yet.
This is the mechanism mobile should be driving if/when it implements invite redemption as a
first-run flow.

This fix has a full real-database test suite at
`apps/api/test/parity/driver-invite-redemption-parity.test.ts` (107/107 passing across the full
parity suite as of this session) if you need to see the exact contracts being enforced
end-to-end.

**Fuller history, because it explains the shape of the two endpoints and matters for mobile:**
a workflow exercise on 2026-08-08 (`docs/notes/2026-08-08-n1-onboarding-workflow-exercise.md`)
found two live problems in the invite flow, both confirmed end-to-end against a real (scratch)
database, neither patched at the time:

1. **The bearer-only hijack.** `POST /api/driver/redeem-invite` granted membership to whoever
   presented a valid code, with no check against who it was minted for — a different driver
   redeemed a code minted for someone else and got HTTP 200, burning it and leaving the real
   invitee with nothing.
2. **The redemption deadlock.** The invited driver is created as a passwordless placeholder with
   no email sent. They can't redeem (no session — 401), can't log in (no credential — 401), and
   can't self-register their way out (the placeholder already owns their email — 409
   `email_taken`). The invite step locks the invitee out by construction.

ADR 0053 was written and the fix (`3403fa8`) landed about 33 minutes after that exercise was
logged, and it addresses **both** findings at once: the identity-bound check in `redeem-invite`
closes the hijack, and the new `claim-invite` endpoint is exactly the missing bootstrap step —
possession of the code lets the invitee set a password on their own bound placeholder account
(only if it has no existing credential, so it can't be used for takeover), then log in and
redeem normally.

**Worth flagging, not yet resolved:** `DECISIONS.md`, `TASKS.md` (task 13), and
`SOW-market-phase.md` still describe this invite flow as an unfixed `[BLOCKER]` — "deliberately
left unfixed," self-serve onboarding marked BLOCKED — written at 15:03 the same day, before the
15:36–15:37 ADR/fix commits, and never updated afterward. The code-level fix looks complete and
is covered by the parity suite, but nobody has re-run the exact end-to-end workflow exercise
against it or updated the tracking docs to close the blocker. If you're touching this flow,
don't take those three docs' "still broken" framing at face value — verify against the actual
route (`apps/api/src/routes/public/driver.ts`) first, since that's clearly ahead of the docs.

### Invite redemption has no mobile caller today — confirmed, this is real net-new scope

This has been investigated properly and the answer is definitive: **mobile has never called
either `redeem-invite` or `claim-invite`, at any commit.** Instead, mobile's account-creation
flow calls a completely different endpoint, `POST /api/public/invites/consume` (ADR 0026, the
*org*-invite path used for host-side accounts) — not the driver-group invite flow ADR 0053
secured. The web console was the only thing that ever drove `redeem-invite`, and it's now parked.

Practically: **a driver who receives a driver-group invite code today has no way to redeem it**,
because the only client that ever spoke that flow is being retired and mobile speaks a different,
adjacent flow instead. This is not a regression and not a bug in the ADR 0053 fix — the fix is
correct and does exactly what it says. It's a gap in what mobile implements. If driver-group
invites (as opposed to org invites) are a capability the product needs, wiring `claim-invite` →
`redeem-invite` into mobile as a first-run flow is genuinely new mobile work, not a fix.

This also changes how to read the "still broken" language in `DECISIONS.md`/`TASKS.md`/
`SOW-market-phase.md` (see below): the *security* bug those docs describe (the bearer-only hijack)
is fixed. But the *product* acceptance criterion they're gating on — self-serve onboarding
completing an invite end-to-end — is **still not met**, just for a different reason now: nothing
can drive the flow, not that the flow is unsafe. Don't read "the fix landed" as "the blocker is
gone." Both things are true at once: the vulnerability is closed, and the onboarding path is still
incomplete.

### The `docs/reference/api-endpoints.md` two-endpoint question — resolved, no action needed

This has also been investigated properly. Short answer: **it was a generator error from the
start, not a real change, not a regression.** The doc-generation tool matches endpoint paths
against source text with a plain regex — no static analysis, no annotations — and that method has
real failure modes worth knowing about if you ever look at this doc again:

- **False negatives:** it's blind to any URL not written as one contiguous string literal.
- **False positives:** its `:param` pattern doesn't exclude `/`, so a parameterized route can
  swallow a *longer* concrete path. Confirmed live in this exact doc: `GET /api/driver/sessions/:id`
  is tagged as called by mobile purely because mobile calls `sessions/current` — a different,
  unrelated endpoint the pattern happens to also match. Mobile never calls `sessions/:id`.
- It's also comment-blind — a path merely mentioned in a comment counts as a "caller."

So: read this doc as "this literal string appears somewhere in that directory," never as
confirmed product behavior.

For the two endpoints specifically (`GET /api/driver/invoices`, `GET /api/driver/sessions/history`):
`git log -S` across mobile's entire `.dart` tree, at every commit that has ever touched this doc,
turns up **zero occurrences of either path, ever.** The doc claimed "mobile" as a caller at every
one of those commits and was wrong every single time — the generator's logic hasn't changed since
the doc was introduced, so whatever produced that value wasn't reproducible from the actual tree.
Confirming this further: both features exist in the mobile app's own menu as explicit, labeled
stubs — "Charge history" tagged **Phase 2**, "Receipts & invoices" tagged **Phase 4** — each just
shows a "coming soon" toast today. Nothing was removed; nothing needs fixing here. If mobile ever
does implement these (per its own stated phases), it'll be new calls to already-live endpoints,
not restoring dropped ones.

### Everything else backend-side

No other backend changes in this relaunch round touch driver-facing endpoints. The broader
session also did unrelated infrastructure work (Cloudflare Worker naming, a Neon migration
config bug, secret hygiene, a Next.js middleware bug) — none of it changes driver API behavior
or contracts, so it shouldn't affect mobile work, but is available in the fuller process log
(`docs/notes/2026-08-08-relaunch-parallel-session-log.md`) if useful for orientation on the
project's overall state.

## 4. Where to look in the repo

| Path | What it is |
|---|---|
| `apps/api/src/routes/public/driver.ts` | Live driver invite redemption + claim-invite endpoint (ADR 0053); see the long inline comments above each route for the full reasoning and incident history |
| `docs/adr/0053-driver-invites-are-identity-bound.md` | The ADR explaining the security model above |
| `apps/api/test/parity/driver-invite-redemption-parity.test.ts` | Real-DB test suite proving the redemption contract, including the anti-enumeration behavior |
| `docs/notes/2026-08-08-n1-onboarding-workflow-exercise.md` | The exercise that found the hijack + deadlock bugs the ADR 0053 fix addresses — good detail on exact HTTP-level behavior |
| `docs/reference/api-endpoints.md` | Generated endpoint-to-caller map — currently stale in more than one way (see above); the two-endpoint-drop fix lives on unpushed branch `diag/fix-api-endpoints-drift`; it also predates `claim-invite`'s existence entirely |
| `DECISIONS.md`, `TASKS.md` (task 13), `SOW-market-phase.md` | Describe the invite flow as an unfixed blocker — written before the ADR 0053 fix landed, not updated since; treat as stale pending a maintainer re-check |
| `apps/mobile/lib/api/client.dart` | The mobile app's entire HTTP surface — every endpoint it calls, in one file |
| `apps/mobile/lib/screens/menu_drawer.dart` | The 11-item driver menu — 9 are "Soon" stubs; shows the app's own stated phase labels (history = Phase 2, invoices = Phase 4) |
| `archive/straumvakt-org-console-2026-08-08/app/driver/` | The old driver web portal (ADR 0033) — parked, UX reference only. Covers login, chargers/history/cost/settings, redeem-invite page |
| `archive/straumvakt-org-console-2026-08-08/README.md` | Full inventory and rationale for everything parked in this relaunch, including the driver portal |
| `docs/notes/2026-08-08-relaunch-parallel-session-log.md` | Full process log of the relaunch work, for broader orientation if needed |

## 5. Confirmed status: what mobile actually does today

This is the ground truth, derived directly from `apps/mobile/lib/api/client.dart` (the app's
single HTTP surface — everything it calls goes through this one file) and the drawer/menu source.
Treat "works today" as "wired to a real endpoint in source," not as "verified on a handset" — this
is a code-level read, not a device test.

**Works today, end to end:**

- Sign-in
- Invite redemption — via the *org*-invite path (`/api/public/invites/consume`, ADR 0026), not
  the driver-group path described above
- Charger discovery, including BLE proximity detection
- Starting, watching (short-poll), and stopping a charge session
- Tap-to-authorise at a charge point
- BLE-based charger settings (PIN, advanced grant) — this and tap-to-authorise have **no web
  equivalent**; they're genuinely new capability mobile added that the old portal never had
- Language preference (read/write on the user's own profile)

**Not implemented — explicit "Soon" placeholders in the menu, no request issued:** profile, my
vehicle, RFID & tokens, charging access, charge history, receipts & invoices, notifications, help
& support, about. That's 9 of 11 menu items. Compared to the parked web portal (dashboard, login,
redeem, history, cost/invoices, access, settings), mobile has full parity on the live-charging
path and a real gap on the account/history/billing side — that gap has existed since before this
relaunch and isn't something the relaunch caused, but it becomes more visible now that the web
portal (which did cover that ground) is going away.

**The one confirmed, real gap worth prioritizing:** the driver-group invite flow (section 3) has
no mobile implementation at all, and no other client covers it either now that web is parked. If
self-serve onboarding (a driver receiving and accepting an org's invite) needs to work, this is
where that gets built.

**One loose end, not backend-related:** untracked local files matching `charge_history.dart`,
`my_vehicle.dart`, and `profile.dart` were observed in the shared working checkout during this
investigation — not committed on any branch anywhere. This might mean someone is actively
prototyping exactly this gap already. Worth checking with whoever has local changes in that
checkout before starting fresh work on the same screens, so nothing gets duplicated or clobbered.

---

*This document reflects repo state as of 2026-08-08, based on work done in a parallel
multi-session relaunch effort. Branches referenced as "unpushed" had not been pushed to
`origin` or merged as of this writing — check current branch state before assuming any of them
have landed. Revised same day to fold in confirmed findings that resolved this document's
original two open questions.*
