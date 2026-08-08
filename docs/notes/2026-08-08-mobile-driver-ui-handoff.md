# Straumvakt relaunch → mobile driver UI: handoff for Codex

**Date:** 2026-08-08
**Audience:** an external AI coding tool (ChatGPT / OpenAI Codex) picking up work on the
**mobile driver app**, without any of the context from the web-side relaunch that just happened.
**Purpose:** explain what changed on the web side, why it changed, and what that means for the
scope of mobile work — plus point at everything in the repo that's directly useful reference
material, and flag the one open question that isn't resolved yet.

If you only read one section, read "What this means for mobile" and "Open question" below.

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

### Invite redemption may currently be web-only — likely new mobile work, not a fix

The generated endpoint-caller doc (`docs/reference/api-endpoints.md`, caveats on its reliability
below) lists `POST /api/driver/redeem-invite`'s only caller as `console` — the old web driver
portal, now parked. `POST /api/driver/claim-invite` doesn't appear in the doc at all, most likely
because the doc predates that route's addition (it was added in the same commit as the ADR 0053
fix) rather than because it has zero callers — the doc is known to go stale on caller lists (see
next section), so treat its absence as "unconfirmed," not "confirmed zero."

Net effect: it looks like the invite-bootstrap-and-redeem flow (`claim-invite` then
`redeem-invite`) may never have had a mobile caller — the web console was carrying it, and the
web console is being retired. If that holds up, this isn't a regression to fix, it's a feature
mobile hasn't implemented yet: a driver who receives an invite code today has no way to redeem it
except through a web surface that's going away. Worth confirming directly (grep the mobile
codebase for calls to these two paths) before assuming otherwise, and worth treating as
likely-necessary net-new mobile scope if confirmed.

### The `docs/reference/api-endpoints.md` drift finding — directly relevant to you

This doc is a generated map of API endpoints to the callers that use them (web, mobile, etc.).
It went stale the moment it was introduced and was silently wrong (a CI bug, since fixed and
verified, unpushed on `diag/fix-api-endpoints-drift`). When it was regenerated correctly, it
showed that **the mobile app no longer appears as a caller of two endpoints**:

- `GET /api/driver/invoices`
- `GET /api/driver/sessions/history`

This was surfaced as a side effect of fixing an unrelated CI bug, and was deliberately **left
alone as an open product question** rather than acted on, because there are three very different
explanations and nobody has checked which one is true:

1. **Intentional** — mobile was already redesigned to not need these (e.g. a different endpoint
   now serves that data, or the feature moved), and the doc is just catching up to reality.
2. **Regression** — mobile used to call these and a change accidentally dropped them; driver
   functionality (viewing invoices, viewing session history) may currently be broken or missing
   in the shipped app.
3. **Generator/detection error** — the doc-generation tooling failed to detect a call site that's
   still actually there (e.g. due to how the mobile codebase structures its API client).

**This is the single most concrete, actionable item in this handoff.** Before doing any new
mobile driver work, it's worth resolving which of the three is true — grep the mobile codebase
for calls to these two paths (or whatever client method wraps them) and check against what the
driver-facing UI currently exposes for invoices and session history. If it's #2 (regression),
this is a bug to fix, likely with priority, since it means real driver-facing functionality
degraded silently. If it's #1, the doc is simply confirming intended state and no action is
needed. As of this writing, a separate investigation into exactly this question has been
dispatched but has **not yet reported back** — so this handoff can't tell you the answer, only
that the question is open and where to look.

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
| `archive/straumvakt-org-console-2026-08-08/app/driver/` | The old driver web portal (ADR 0033) — parked, UX reference only. Covers login, chargers/history/cost/settings, redeem-invite page |
| `archive/straumvakt-org-console-2026-08-08/README.md` | Full inventory and rationale for everything parked in this relaunch, including the driver portal |
| `docs/notes/2026-08-08-relaunch-parallel-session-log.md` | Full process log of the relaunch work, for broader orientation if needed |

## 5. Open questions (flagging explicitly, not resolved as of this document)

1. **Does the mobile app currently call `POST /api/driver/redeem-invite` and
   `POST /api/driver/claim-invite`, or has the entire invite-redemption flow been web-only up to
   now?** This is the higher-priority of the two open questions. If the flow really has no mobile
   caller, a driver who receives an invite today has no working way to accept it once the web
   console is retired — this reads as necessary net-new mobile scope, not a bug fix. See section 3
   above.
2. **Does the mobile app currently call `GET /api/driver/invoices` and
   `GET /api/driver/sessions/history`, and if not, why not?** See section 3's three possible
   explanations. An investigation into this was in flight at the time this document was written
   and had not yet reported a conclusion.

Anyone picking up mobile driver work should check both before building anything new — together
they determine how much of this is "fix a regression" versus "build a flow that was never
mobile's to begin with."

---

*This document reflects repo state as of 2026-08-08, based on work done in a parallel
multi-session relaunch effort. Branches referenced as "unpushed" had not been pushed to
`origin` or merged as of this writing — check current branch state before assuming any of them
have landed.*
