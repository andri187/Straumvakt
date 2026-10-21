# Appendix K — Rollback drills, beta rehearsals, production no-gos
> **Superseded in part by [the overnight verification-prep packet](2026-08-09-overnight-verification-prep-packet.md).** That run corrected several findings recorded here: the estate is **29 registered worktrees, not 6**; three worktrees are checked out **at** forbidden commits; the wrangler linter emits **5 L2 / 6 L3**, not 4 / 3; the linter's inheritance model was wrong and is fixed; and the money-unit finding's **mechanism** was wrong — there is no cancelling pair inside the API. See "Corrections" there.


**10 rollback drills · 8 beta rehearsal scenarios · 6 production no-go scenarios.**

Drills are written to be read *during* an incident: detection first, containment
second, diagnosis last. The most common way a rollback goes wrong is that someone
debugs forward while the product is down.

---

# Part 1 — Rollback drills (10)

> **Universal first step, before any rollback.** Capture the evidence: the failing
> response, the error code, the currently active version id. **Rolling back
> destroys the evidence of what went wrong.** Thirty seconds here saves the
> post-mortem.

---

## RD-01 — Bad Worker version

**Detection.** Error rate rises after a deploy; the health endpoint fails; or a user-visible surface breaks. The signal is temporal — it started when the deploy did.

**Immediate containment.** Roll back to the recorded previous version. Do not diagnose first.

**Evidence to capture.** Active version id, previous version id, the failing response body, the deploy timestamp.

**Rollback.** `wrangler rollback --version-id <previous>`, or the dashboard's Deployments tab. **This requires `rollback.workerVersionsBefore` to have been recorded.** No version id has ever been recorded on this estate — until ISS-06 lands, this is not a rollback but a redeploy of an older commit, which is slower and riskier, and the difference must be stated out loud.

**Who approves.** The named approver in AD-16. For a total outage, roll back first and inform after.

**Verification.** Health endpoint responds; one authenticated read succeeds; error rate returns to baseline. Record elapsed time — it populates `restoreTimeMeasuredSec`.

**After-action.** Why did the deploy pass its checks? Add the missed condition to CL-44.

---

## RD-02 — workers.dev disabled

**Detection.** **Cloudflare error 1042** on the pinned host, while a custom domain on the same Worker answers normally. The Worker is healthy; the deploy succeeded; only pinned clients notice.

Distinguish carefully — these look similar and have different fixes:

| Signature | Cause | Fix |
|---|---|---|
| **1042** from Cloudflare's edge | workers.dev disabled for this Worker | Re-enable the toggle |
| DNS resolution failure | Hostname does not exist | Different problem entirely |
| Application 404 | Working normally | **Not a failure** |

**Immediate containment.** Re-enable workers.dev in the dashboard: Worker → Settings → Domains & Routes → workers.dev. This is faster than a rollback and usually sufficient.

**Evidence to capture.** The 1042 response verbatim, the diff that caused it (look for a newly added `routes` array), the workers.dev toggle state.

**Rollback.** Re-enable the toggle. If that does not restore it, roll back the Worker version — the deploy may have removed it structurally.

**Who approves.** Pre-approved. Restoring a hostname that a shipped client depends on is not a judgement call.

**Verification.** The pinned host returns an **application response of any status**. A 404 from the application is a pass.

**After-action.** Declare `workers_dev` explicitly in the config (ISS-01, ISS-02) so it cannot recur, and confirm `lint-wrangler.mjs` L1 would now catch that diff.

---

## RD-03 — Mobile API host broken

**Detection.** Reports of the app failing to load data while the web application works. Possibly no signal at all — app users report slowly and vaguely, which is why the synthetic check in ISS-55 exists.

**Immediate containment.** **Restore the hostname server-side.** There is no client-side fix: the app is shipped, the host is pinned at `apps/mobile/lib/api/client.dart`, and a store release takes days.

**Evidence to capture.** The exact host the app requests, the response it receives, the app version affected.

**Rollback.** Whatever restores the host — re-enable workers.dev (RD-02), reverse a rename (the hostname is derived from the Worker name), or roll back the version.

**Who approves.** Pre-approved.

**Verification.** A request to the pinned host from outside the network returns an application response.

**After-action.** This is the failure AD-08 exists to prevent permanently. **Do not wait for a store release during an outage** — that is not a mitigation, it is a description of how long the outage lasts.

---

## RD-04 — OCPP gateway unreachable

**Detection.** Connected-charger count drops, or a WebSocket upgrade against the endpoint fails. If no charger count is observable (ISS-53), record that this drill **cannot currently be detected** rather than assuming it can.

**Immediate containment.** Roll back the gateway version immediately. **Do not debug forward** — every minute is chargers offline, and some may have customers mid-session.

**Evidence to capture.** Upgrade response status and headers, the active gateway version, the charger count before and now, and whether `IDENTITY_DO` namespace ids changed.

**Rollback.** Roll back to the recorded gateway version. Expect a **reconnect storm** on recovery — every charger returns at once, on a backoff profile nobody has measured (ISS-52). Check Neon connection headroom before assuming it absorbs cleanly.

**Who approves.** Pre-approved for total loss of connectivity.

**Verification.** Charger count at +1, +5, and **+15 minutes**. Reconnection is not instant. The +15 figure must match the baseline; any charger that was connected before and is not by +15 is an individual investigation.

**After-action.** Was a session in progress? A charger may continue delivering energy while disconnected, and the session must then be reconciled — establish the behaviour from the specification (D-33) rather than from the incident.

---

## RD-05 — Web-to-API same-zone fetch failure

**Detection.** Pages hang or return 500 while the API answers correctly when called directly. The symptom looks like an application bug; the cause is routing.

**Immediate containment.** **Flip the configuration switch** back to the working path. No deploy required — that is the entire reason AD-09 recommends a switch rather than a straight cutover.

**Evidence to capture.** The failing request, whether `api.straumvakt.org` is currently a Custom Domain or a route, and the response the web Worker actually received. If a same-zone route is in play, the request looped back to the calling Worker rather than reaching the API.

**Rollback.** Flip the switch. If no switch exists yet, roll back the web Worker version.

**Who approves.** Pre-approved.

**Verification.** A page loads and an authenticated read succeeds.

**After-action.** If the cause was a route replacing a Custom Domain, that is exactly the failure AD-09 predicts, and it makes the service-binding adoption urgent rather than optional.

---

## RD-06 — Bad migration after a release

**Detection.** Application errors referencing missing or changed columns; or data that reads wrongly rather than failing. The second kind is worse and slower to notice.

**Immediate containment.** Stop writes if that is possible without a worse outage. Every write after the bad migration is a write that a restore will discard.

**Evidence to capture.** The migration that ran, the `_prisma_migrations` state, the error, and **the exact time the bad change took effect** — the restore point depends on it.

**Rollback.** Restore from the backup branch created before the change (CL-35), or via PITR if within the seven-day window. **A restore alone is not the recovery.** A restored branch has a **different endpoint**, and the Workers still point at the old one — every place the endpoint appears must be repointed: the Worker secret, the Hyperdrive origin, and any local tooling.

**Who approves.** The named approver in AD-16. **A restore is irreversible in the sense that discarded writes do not come back** — say the data-loss window out loud before running the command, not after.

**Verification.** Schema version correct; row counts on key tables plausible; one read through the API succeeds. A branch that connects is not the same as a branch the application can use.

**After-action.** Why did CL-34's reference search not catch it? Remember that **a row count of zero is never sufficient evidence for dropping anything** — thirty-two tables were dropped on that reasoning and relation loads hid the references.

---

## RD-07 — Recovery needed beyond the PITR window

**Detection.** A problem is traced to a change older than the retention window — currently seven days.

**Immediate containment.** Stop anything that would compound it. Then be honest about what is available.

**Evidence to capture.** The date the problem originated, the retention ceiling, and the list of deliberate backup branches with their creation dates.

**Rollback.** **Beyond the PITR window, only branches created on purpose exist.** If none covers the needed point, there is no restore — recovery becomes forward repair: identify affected rows, correct them, and accept that some information is gone.

**Who approves.** Andri. This is a business decision about acceptable data loss, not a technical one.

**Verification.** Affected records corrected and spot-checked.

**After-action.** This drill is the argument for AD-05's retention decision and for ISS-28's backup-branch convention. **A problem noticed on day eight is currently unrecoverable**, and that sentence should be uncomfortable enough to produce a decision.

---

## RD-08 — Accidental push to the deploy pointer

**Detection.** An unexpected commit on `origin/staging`; or `git ls-remote` returning a sha nobody recognises.

**Immediate containment.** **First question: did the push trigger a deploy?** Not "how do I undo the push". Until fact F2 is resolved, `origin/staging` must be treated as a live production deploy pointer, so the deploy question determines everything that follows.

**Evidence to capture.** The pushed sha, the previous sha, the pusher, the timestamp, and **whether any Worker's active version changed** in the same window.

**Rollback.** If a deploy fired: roll back the Worker version first (RD-01), then deal with the branch. If not: the branch can be corrected calmly. **A force-push fix is itself dangerous and must not be normalised** — if branch protection is enabled it will be refused, which is the correct outcome.

**Who approves.** The named approver for the Worker rollback; the branch correction needs a second pair of eyes.

**Verification.** Remote sha correct; no unexpected Worker version; `git ls-remote --heads origin | wc -l` still 16.

**After-action.** This is exactly the scenario ISS-08 and ISS-09 prevent — two local branches track `origin/staging`, one carrying the forbidden commit `4fe0a95`. Unset the upstreams, install the pre-push hook, enable server-side protection.

---

## RD-09 — CPMS redeploy collision

**Detection.** A Worker's active version changes with **no corresponding Straumvakt deploy**. The version id is unfamiliar, and the audit log shows an actor or integration this project does not recognise.

**Immediate containment.** Roll back to the last known-good Straumvakt version. Note this is a *contested* Worker — rolling back may conflict with the other project's intent, which is precisely the problem.

**Evidence to capture.** The unexpected version id, the audit log entry, the Git integration configuration for that Worker, and whether the deployed code is Straumvakt's or CPMS's.

**Rollback.** Version rollback, then **disconnect the offending Git integration** — but that is `EXT` + `APPROVAL` and touches another project's deployment path, so it is a conversation, not a reflex.

**Who approves.** Andri. This crosses a project boundary.

**Verification.** Active version matches the Straumvakt release record.

**After-action.** **Distinguish an unexpected deploy from a bad deploy** — a CPMS deploy of working code is still an incident, because it means nobody controls what runs. This is production no-go NG-04 and the reason AD-03 exists.

---

## RD-10 — Cleanup deleted something needed

**Detection.** A preservation check reports `*** MISSING ***`; a build fails on an absent file; or a document cannot be found.

**Immediate containment.** **Stop all cleanup immediately.** Do not attempt to continue and fix afterwards — the next step may destroy the evidence of what the last one took.

**Evidence to capture.** What is missing, which cleanup step preceded it, and the deletion log entry mapping that path to an archive member.

**Rollback.** Extract from the **verified** archive and hash-compare against the manifest. This requires ISS-38 to have been completed — an archive verified by listing rather than by extraction is a hypothesis, and this is the moment it gets tested.

**Who approves.** Pre-approved for restoration from an archive.

**Verification.** File count and hashes match the manifest; the preservation check passes; the failing build or reference works again.

**After-action.** Which record in Appendix G covered it, and why did the ordering not protect it? **Do not rely on the recycle bin** — junction traversal and `git clean` both bypass it entirely.

---

# Part 2 — Beta rehearsal scenarios (8)

Each is tagged **local-only**, **cloud-read-only**, **beta-approved**, or
**mutation**. Run them in the dependency order at the end — several are blocked
by Claude A's fixes, and running them early produces known failures and wasted
effort.

---

## BR-01 — Local UI with backend-gated features disabled
**Tag: local-only.** No approval, no cloud, runnable today.

**Setup.** Start the web app locally with backend gating configured. No connection to beta data.

**Walk.** Every gated surface: organisation creation, driver membership, pricing, charger onboarding.

**Pass.** Every gated surface renders a **defined disabled state** — never an error, never an empty page, never a spinner that does not resolve. Screenshot each.

**Why it matters.** This is the cheapest rehearsal available and it covers the failure most likely to be seen by a beta user: a feature that is simply not ready, presented as broken rather than as pending.

**Owner.** Codex. **Blocked by** nothing.

Settle here too, because everything else cites it: **what beta means** — whether real customers, real money, and real energy are involved; the three or four measurable success conditions; and the three or four abort conditions. Any billing discrepancy, any charger left unable to reconnect, and any cross-tenant data exposure are non-negotiable aborts.

---

## BR-02 — Organisation creation against a local database
**Tag: local-only.**

**Setup.** Local Postgres or a throwaway Neon branch. **Never beta data.**

**Walk.** Create an organisation as a beta admin would. Read it back. Attempt to read it as a member of a different organisation.

**Pass.** The organisation exists, is visible to its own members, and is **not** visible across tenants. Tenant isolation was proven for the per-organisation landing route — the URL slug is a selector over the session's own memberships, and 24 API calls were all scoped to the session's organisation, with zero for a foreign slug. This rehearsal confirms the same property on the creation path.

**Owner.** Claude A (domain) and Codex (surface). **Blocked by** nothing.

---

## BR-03 — Charger onboarding dry run
**Tag: local-only.**

**Setup.** Gateway running locally with a simulated OCPP client. **Never the live gateway, never a real charger.**

**Walk.** BootNotification, then Heartbeat, then a deliberate disconnect and reconnect.

**Pass.** The charger appears as onboarded, and **its identity persists across the reconnect**. That is the property `IDENTITY_DO` exists to provide, and the one a namespace change would silently destroy.

**Owner.** Claude A and this track. **Blocked by** nothing.

---

## BR-04 — Driver membership flow
**Tag: local-only.**

**Setup.** Local, full stack.

**Walk.** Issue an invitation, redeem it as the invitee, and confirm membership.

**Pass — today, this must FAIL, and that is the point.** The driver invitation loop is confirmed broken at runtime: an invitee can never redeem, and codes are bearer-only. It is unfixed by choice. **A rehearsal that reproduces the documented failure at the documented point validates the rehearsal itself** — and then becomes the acceptance test for the fix, rather than a test written afterwards to confirm whatever the fix happened to do.

**Owner.** Claude A (fix) and Codex (surface). **Blocked by** nothing to run; blocked by A's fix to pass.

---

## BR-05 — Pricing surface in its disabled state
**Tag: local-only.**

**Setup.** Local, pricing gated off.

**Walk.** Every surface that would display a monetary figure.

**Pass.** **No monetary figure is displayed as final anywhere.** The money-unit contract is unresolved: the costing engine documents aurar, one hundredth of a króna, while a session-repository comment claims the identity conversion. Two mismatches currently cancel, so fixing either alone is wrong by a factor of one hundred. Until AD-15 is settled, a displayed price is a guess with two significant digits of uncertainty in the exponent.

**Owner.** Codex. **Blocked by** ISS-29.

---

## BR-06 — First real charge with an independent cost check
**Tag: mutation.** Real hardware, real energy, possibly a real customer. **Requires explicit approval.**

**Setup.** One charging session. AD-15 resolved first.

**Walk.** Record energy delivered and the applicable tariff. **Compute the expected cost by hand.** Then read the system's figure.

**Pass.** The two agree **to the aurar**.

**Abort.** Any factor-of-one-hundred discrepancy stops the beta programme immediately and is not billed.

**Why by hand.** No test that uses the same conversion the code uses can catch an error *in* that conversion. An independent calculation is the only instrument that works here.

**Owner.** Andri. **Blocked by** ISS-29.

---

## BR-07 — Beta domain change without breaking the mobile app
**Tag: mutation.** Requires approval.

**Setup.** ISS-01 landed first — `workers_dev: true` declared explicitly in the API config.

**Walk.** Attach a custom domain to the API Worker. Then request **both** the custom domain and the pinned workers.dev host.

**Pass.** Both return application responses. Neither returns 1042.

**Then reverse it.** Remove the custom domain and **verify the workers.dev host still answers** — removal does not automatically restore what attachment may have disabled, and that asymmetry is worth knowing before it matters.

**Why.** This is the exact change the whole workers.dev finding warns about, and it will eventually be wanted for legitimate reasons. Better to meet it as a rehearsal than as an outage.

**Owner.** Andri. **Blocked by** ISS-01.

---

## BR-08 — OCPP continuity across a web deploy
**Tag: mutation.** Requires approval.

**Setup.** A connected-charger count must be readable (ISS-53). If it is not, this rehearsal **cannot be run** — record that rather than declaring it passed.

**Walk.** Capture the charger count. Deploy the web Worker only. Capture at +1, +5, +15 minutes.

**Pass.** The count is unchanged throughout.

**If it changes.** Deploy independence between the three Workers is assumed everywhere in this programme and demonstrated nowhere. A change here invalidates the cutover order in CL-44 and much of the release model.

**Owner.** Andri. **Blocked by** ISS-53.

---

## Dependency order

**BR-01** → **BR-02** → **BR-03** → **BR-08** → **BR-04** → **BR-05** → **BR-07** → **BR-06**.

The first three need no approval and no cloud. BR-06 is last because it is the
only one that bills a real person, and it depends on the one contract that is
currently known to be contradictory.

---

# Part 3 — Production no-go scenarios (6)

Each is checked **minutes before cutover**, aloud, with the named clearer
present. Three agents commit continuously; a review written a week earlier
describes a system that no longer exists.

**Any single uncleared condition stops the cutover.** A no-go with no owner is
cleared by whoever is most impatient.

---

## NG-01 — No rollback version ID recorded

> **STOP. This release has no rollback target. We are not deploying a change; we are deploying a one-way door. Cutover does not start until a version id is recorded for every Worker in this release.**

**Trigger.** `rollback.workerVersionsBefore` is absent, incomplete, or captured more than a few hours ago.
**Evidence.** Validator rule R1 rejects the manifest with exactly this message. No Worker version id has ever been recorded on this estate.
**Who can clear it.** The release approver, only by producing the ids.
**Required fix.** ISS-06 — capture version ids; then ISS-47 — recapture immediately before cutover, because a stale target is worse than none, as it will be trusted.
**What may continue.** Everything else. This blocks the cutover, not the work.

---

## NG-02 — No production Neon project

> **STOP. Production has nowhere to put data. Deploying now means either an empty database or beta's database, and one of those is a data-protection incident.**

**Trigger.** No production project or branch exists, or it is unprotected, or it is the beta branch.
**Evidence.** One Neon project, no production project, thirteen branches, none protected, seven-day PITR ceiling. Rule R6 rejects a production manifest pointing at the beta branch.
**Who can clear it.** Andri, via AD-05.
**Required fix.** ISS-17 (protect beta), CL-31 (create and protect production), ISS-18 (explicit branch mapping — the project default is abandoned).
**What may continue.** All beta work; all local rehearsals.

---

## NG-03 — Branch protection absent

> **STOP. The branch this release is promoted from can be force-pushed or deleted by anyone with write access, and we cannot prove what we are promoting.**

**Trigger.** The deploy pointer or the trunk is unprotected, or a local branch still tracks either.
**Evidence.** Zero of sixteen branches protected; rulesets `[]`; two local branches tracking `origin/staging`, one carrying the forbidden commit `4fe0a95`.
**Who can clear it.** Andri, via AD-04.
**Required fix.** ISS-12 (capture current state first), ISS-08 and ISS-09 (unset upstreams), ISS-11 (enable protection), ISS-14 (pre-push hook).
**What may continue.** Everything except the promotion.

---

## NG-04 — CPMS still owns a deployment path

> **STOP. Another project can redeploy these Worker names. We do not control what runs in production, and a merge in a repository we do not own could overwrite this release.**

**Trigger.** Any Worker's Git integration belongs to CPMS, or `cpmsSeparationVerified` is not true.
**Evidence.** CPMS declares `hlada-staging` and `hlada-api-staging` at `wrangler.jsonc:3,32`. CPMS renamed `straumvakt` to `hlada` on 2026-04-19; Straumvakt inherited the names on 2026-04-24. Rule R12 rejects a production manifest without the verification.
**Who can clear it.** Andri, after ISS-07 establishes the owner and AD-03 decides the names.
**Required fix.** ISS-07, AD-03, ISS-41, and the brief in ISS-77 — the resolution needs action from a party outside this track.
**What may continue.** All beta work. Beta already runs on these names; the risk is specific to production being a controlled release.

---

## NG-05 — A pinned workers.dev host is not preserved

> **STOP. This release can remove the hostname every shipped mobile app depends on. There is no client-side fix and a store release takes days.**

**Trigger.** Any Worker with `workersDevRequired: true` does not declare `workers_dev` in its config; or the release adds `routes` to such a Worker.
**Evidence.** `apps/api/wrangler.jsonc` and `gateway/wrangler.jsonc` declare neither `routes` nor `workers_dev` — confirmed by `lint-wrangler.mjs`, which reports **five L2 warnings** — apps/api and gateway each at top level and in `env.staging`, plus the web config's own top level. Rule R4 rejects such a manifest. `apps/mobile/lib/api/client.dart` pins the API host.
**Who can clear it.** The release approver, only after the config declares it and `lint-wrangler.mjs` reports no L1 error.
**Required fix.** ISS-01, ISS-02, ISS-03.
**What may continue.** Everything. The fix is a two-line configuration change.

**The gateway case is worse than the API case** and deserves saying separately: its clients are chargers in the field, which do not reconnect to a hostname that stops resolving, and reconfiguring them is a physical or vendor-portal operation.

---

## NG-06 — OCPP endpoint continuity not proven

> **STOP. We cannot state that this release leaves the charger fleet alone. Chargers are physical equipment with customers attached, and we are not finding out during a cutover.**

**Trigger.** A release includes a gateway Worker and `ocpp.endpointUnchanged` is not explicitly `true`; or the endpoint in the release differs from what chargers are configured with; or the `IDENTITY_DO` namespace id has changed.
**Evidence.** Rule R3 rejects it — promoted from warning to error precisely because the highest-consequence omission was the one that only printed a line.
**Who can clear it.** Andri, after the endpoint is verified against charger configuration.
**Required fix.** ISS-51, ISS-52 (reconnect profile), CL-21 (endpoint proof), CL-22 (namespace continuity).
**What may continue.** Web and API work, provided the gateway is not in the release.

---

## NG-07 — Money-unit contract unresolved *(additional; blocks billing, not deployment)*

> **STOP BILLING. The system may be wrong by a factor of one hundred in either direction, and code review cannot see it because two bugs cancel.**

**Trigger.** Any real charge is billed before AD-15 is settled and BR-06 has passed.
**Evidence.** `apps/api/src/lib/tariff/compute-session-cost.ts:13-21` documents aurar — one hundredth of a króna. A session-repository comment claims the identity conversion. I previously repeated that claim in an audit; the costing engine is authoritative and the correction stands.
**Who can clear it.** Andri, after an independent hand calculation agrees to the aurar.
**Required fix.** ISS-29 — both sides in one commit, with a test that fails if either is changed alone.
**What may continue.** Deployment, and all non-billing beta activity, with pricing surfaces in their disabled state (BR-05).

---

## NG-08 — Fabricated measurements shown to users *(additional; blocks beta exposure)*

> **STOP. The product is telling users something false about physical equipment.**

**Trigger.** Any surface displays `powerKw: 0` as a measurement.
**Evidence.** `apps/api/src/repositories/driver-sessions.ts:135` hardcodes zero; lines 89-98 coerce null to zero. A user reading zero kilowatts believes the charger is delivering nothing.
**Who can clear it.** Claude A and Codex jointly — the field is either real or absent.
**Required fix.** ISS-31.
**What may continue.** Everything else.

---

**Six required no-gos are NG-01 … NG-06.** NG-07 and NG-08 are additional and
narrower: they block billing and user-facing exposure respectively rather than
deployment, and are listed separately so that neither gets waived by someone
clearing a deployment gate.
