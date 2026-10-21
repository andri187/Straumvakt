# Appendix B · 36 operator runbooks

**Written, not executed.** Common preamble for every runbook: **record UTC, who
is acting, and the observed symptom before changing anything.** No runbook
performs a destructive action without a backup or approval gate. **Rollback is
never gated** — a control that delays recovery is a liability.

Severity: **S1** customer-visible or money/data · **S2** SLO breach or latent
data risk · **S3** operational hygiene.

---

## Group 1 · Access and credentials

### RB-01 · Cloudflare auth missing when verification is needed — S3
**Detect:** `wrangler whoami` → not authenticated; MCP account tools absent.
**Diagnose:** no stored OAuth token and no `CLOUDFLARE_API_TOKEN`.
**Recover:** create a **read-only** scoped token (Appendix A §1.3); set it
session-scoped only.
**Do not:** run `wrangler login` if a scoped token suffices — it grants deploy
rights to a read-only task.
**Validate:** `wrangler whoami` names the expected account.
**Cleanup:** `Remove-Item Env:\CLOUDFLARE_API_TOKEN` when done.

### RB-02 · A token turns out to have write scope — S2
**Detect:** a mutating command succeeds in a dry run, or the token summary shows `Edit`.
**Contain:** stop using it; **revoke** rather than "be careful".
**Recover:** issue a Read-only replacement.
**Evidence:** which commands ran while it was live.

### RB-03 · Secret value accidentally displayed or transcribed — S1
**Contain:** do not save, screenshot, paste or commit it. Close the page.
**Evidence:** which secret name, where it appeared, who saw it.
**Recover:** treat as exposed → **rotate**. For `OCPP_CRED_KEK`, rotation implies
re-encrypting derived material.
**Follow-up:** if it reached a file, that file's history is contaminated — do not
merely delete the line.

---

## Group 2 · Deploy and version

### RB-04 · Wrong Worker version serving — S1
**Detect:** body hash differs from the expected build; unexpected version id.
**Contain:** do not deploy again.
**Evidence:** `curl -s <host> | sha256sum`; version id; deployments list.
**Recover:** rollback to the recorded prior version id.
**If no version id was recorded:** you cannot roll back cleanly — record the
current one now and treat this as the lesson.

### RB-05 · Deploy fired unexpectedly — S1
**Detect:** version id changed with **no release manifest**.
**Diagnose:** which integration? **Which repository?** Could be CPMS.
**Contain:** rollback; then find the trigger before deploying again.

### RB-06 · Production Worker accidentally created — S2
**Detect:** `straumvakt-web`/`-api`/`straumvakt-ocpp` appears when it should not.
**Do not delete immediately** — first establish whether anything routed to it.
**Evidence:** creation time, creator, bindings, domains, whether it holds secrets.
**Recover:** if unrouted and empty, deletion is safe **after** recording it.

### RB-07 · Rollback target unavailable — S1
**Detect:** fewer than two retained versions.
**Contain:** **do not deploy.** A release without a rollback target is a one-way door.
**Recover:** none retroactively; deploy a known-good build first to create one.

### RB-08 · Rollback lands on a vulnerable build — S2
**Detect:** the target version predates a security fix.
**Decide:** availability now versus a known flaw. **Prefer restoring service**,
then fix forward immediately.
**Follow-up:** record a minimum-safe-version per Worker.

---

## Group 3 · workers.dev and routing

### RB-09 · workers.dev accidentally disabled — **S1** (fleet or app impact)
**Detect:** the workers.dev hostname returns Cloudflare `error code: 1042`.
**Diagnose:** did a deploy add a `routes` block without `workers_dev: true`?
**Blast radius:** API host → every installed mobile app. **Gateway host → the
entire charger fleet.**
**Recover:** declare `"workers_dev": true` in that environment block, redeploy.
**During recovery:** the fleet is disconnected; expect a reconnect storm on
restoration (RB-15).
**Prevent:** the Tier-0 config lint.

### RB-10 · Custom domain detached after deploy — S1
**Detect:** brand hostname stops serving, or TLS fails.
**Contain:** **re-attach** — fastest path back.
**Note:** deleting a custom domain does **not** delete its Advanced Certificate;
re-attachment may not reuse it cleanly — **verify TLS explicitly**.
**Follow-up:** config is authoritative for routes (documented); a deploy
overrides the dashboard.

### RB-11 · Same-zone route fetch failure — S1
**Detect:** web → API calls fail; the error looks like an application bug.
**Diagnose:** was `api.straumvakt.org` converted from **Custom Domain** to a
**route**? Same-zone `fetch()` fails against a route.
**Recover:** restore Custom-Domain status, **or** add a `web → API` service
binding.
**Prevent:** the service binding — it removes the dependency entirely.

### RB-12 · Mobile pinned API host broken — **S1, unrollbackable client**
**Detect:** error rate concentrated on installed app versions; pinned host not serving.
**Contain:** restore the hostname immediately — **a mobile release cannot be rolled back**.
**Do not:** "fix it in the next app release". There may not be one in time.
**Follow-up:** move the app to a configurable base URL.

### RB-13 · `www` serves but apex does not (or vice versa) — S1
**Detect:** one brand hostname works, the other fails.
**Diagnose:** apex and `www` are **separate** custom-domain attachments with
**separate certificates** (`www` is absent from the apex SAN).
**Recover:** treat each independently; fixing one does **not** fix the other.

### RB-14 · Certificate expiry approaching — S2
**Detect:** < 14 days on any brand hostname.
**Check both** apex and `www`.
**Recover:** re-issue via the custom-domain flow; verify per hostname.

---

## Group 4 · OCPP and field

### RB-15 · OCPP reconnect storm — S1
**Detect:** live sockets collapse then spike; queue depth rises; DO wakes spike.
**Contain:** **do not restart the gateway** — that restarts the storm.
**Diagnose:** upstream network, a gateway deploy, or a vendor-side restart.
**Recover:** allow backoff to work. **If reconnects are not backing off, that is
the finding.**
**Validate:** 95% reconnected within 5 minutes.

### RB-16 · Chargers fail to reconnect after an endpoint change — S1
**Contain:** **keep the old endpoint live.**
**Recover:** revert configuration per charger.
**If the old endpoint was retired:** field visit. An offline charger is
**indistinguishable** from a stranded one.

### RB-17 · Session in progress when the gateway is severed — S1, safety
**Impact:** the session cannot be stopped from the app.
**Contain:** tell the driver **plainly** that the session is still live.
**Escalate:** operator, and the site host if a bay is blocked.
**Prevent:** never migrate a charger with an active session; verify per charger
immediately beforehand.

### RB-18 · Durable Object state lost after a gateway change — S2
**Detect:** Authorize verdicts re-fetched for every charger; DO wake volume spikes.
**Explain:** a new Worker's DO namespace starts **empty**; state does not migrate.
**Recover:** it rebuilds from reconnection. Expect elevated API load meanwhile.

### RB-19 · Charger Basic-Auth rejected after a migration — S1
**Detect:** upgrade rejections logged at the gateway.
**Diagnose:** per-charger credentials did not travel with the endpoint.
**Recover:** re-provision per device — a field operation.

---

## Group 5 · Git and branch safety

### RB-20 · A branch was pushed to `staging` accidentally — **S1**
**Detect:** `origin/staging` moved unexpectedly.
**Contain:** **do not force-push it back** — that is itself a production action
and may re-trigger a build. **Roll back the Worker version instead.**
**Evidence:** pushed SHA, who, from which worktree, the upstream configuration.
**Recover:** version rollback, then decide the branch state deliberately.
**Prevent:** `git branch --unset-upstream` on the two branches tracking
`origin/staging`; then branch protection.

### RB-21 · `4fe0a95` reached a deploy branch — S1
**Impact:** the root Worker name changes; a deploy creates an empty Worker with
no bindings and no secrets.
**Contain:** ensure no deploy runs from that ref.
**Recover:** roll the branch pointer decision back through the normal path; never
deploy from it.

### RB-22 · Force-push to a protected-but-unprotected branch — S1
**Reality today:** 0 of 16 branches are protected, so this is possible right now.
**Recover:** reflog on any clone that has the old ref; otherwise the history is
gone from the remote.
**Prevent:** the `non_fast_forward` + `deletion` ruleset — the cheapest control
available.

### RB-23 · A local branch is deleted with unpushed work — S2
**Recover:** `git reflog` in that worktree; `git fsck --lost-found` if the reflog
expired.
**Prevent:** 42 local branches, **16 on origin** — most work exists in exactly
one place.

### RB-24 · Peer worktree modified by another agent — S2
**Detect:** unexpected dirty state or a moved tip in a tree you do not own.
**Contain:** **do not clean or reset it.**
**Recover:** the owner reconciles. Record the observed tip and dirty count only.

---

## Group 6 · Database

### RB-25 · Neon default branch reached by mistake — S2
**Detect:** `relation … does not exist`, or implausibly little data.
**Read it as a wrong-branch signal first** — the abandoned branch's older schema
makes it look like a schema bug.
**Recover:** re-run with an explicit branch id. **If a write occurred, escalate**
— that branch is unprotected.

### RB-26 · PITR needed beyond 7 days — **S1, unrecoverable**
**Reality:** history retention is **604,800 s = 7 days**.
**Recover:** only from a **deliberately created backup branch**. If none exists
for that point in time, **the data is not recoverable**.
**Prevent:** backup branches before every schema change; they are branches, so
they persist beyond the retention window.

### RB-27 · Hyperdrive points at the wrong branch — S1
**Contain:** **stop writes.** A wrong-branch write is worse than downtime.
**Evidence:** Hyperdrive target host prefix **and** the branch's compute id — two
sources.
**Recover:** repoint (approval-gated); validate with a known-good read.

### RB-28 · Migration recorded but DDL never ran — S2
**Cause:** `resolve --applied` used where `deploy` was needed.
**Recover:** run the SQL by hand — **re-deploying will not re-run a recorded
migration**.
**Prevent:** never `resolve` a migration with outstanding statements.

### RB-29 · Migration checksum mismatch — S2
**Cause:** a recorded migration file was edited.
**Do not:** edit further to "fix" it.
**Recover:** reconcile deliberately; the checksum is pinned per migration.

### RB-30 · Production Neon project created prematurely — S3
**Detect:** a second project appears.
**Do not delete reflexively** — establish whether anything connected to it.
**Recover:** if empty and unconnected, deletion is safe after recording it.

---

## Group 7 · Cleanup and preservation

### RB-31 · Cleanup deletion near-miss — S2
**Detect:** a delete command targeted a path holding untracked material.
**Contain:** **stop.** Do not run the second command.
**Verify:** is the target in the preservation manifest (P1–P5)?
**Recover:** if it ran, check the Recycle Bin — `Remove-Item` **bypasses it**, so
usually there is nothing there.

### RB-32 · Untracked OCPP specs lost — **S1, unrecoverable locally**
**Impact:** 128 files of official OCPP 1.6 / 2.0.1 / 2.1 specifications, untracked.
**Recover:** re-download from the Open Charge Alliance — **requires an account and
possibly membership**; errata and edition-specific archives may not be trivially
re-obtainable.
**Prevent:** commit them, or copy them outside `E:\Claude` **before** any cleanup.

### RB-33 · A junction was deleted through, not unlinked — S2
**Cause:** `Remove-Item -Recurse` traversed a junction and deleted the **target**.
**Impact:** the shared `node_modules` is destroyed, breaking four worktrees.
**Recover:** `npm install` — recoverable, but only because the target was
regenerable. **Had it pointed at source, it would not be.**
**Prevent:** **always `cmd /c rmdir <junction>`**, never `Remove-Item -Recurse`.

### RB-34 · Prompt/evidence files lost — S2
**Impact:** `C:\Users\Andri\Documents\New project` holds every prompt and handoff
driving this programme, **outside any repository**.
**Recover:** none locally.
**Prevent:** copy into the canonical repo or a backup — **not yet done**.

---

## Group 8 · Product surfaces

### RB-35 · Support cannot answer "why did my charge fail" — S2
**Detect:** every incident escalates to an engineer.
**Diagnose:** support lacks a driver → org → session view.
**Recover (immediate):** an engineer answers.
**Fix:** the support-context surface is a product requirement disguised as an
operations one.

### RB-36 · A cost is displayed wrongly by ~100× — **S1, trust and billing**
**Detect:** a driver disputes an amount; a figure is off by two orders of magnitude.
**Diagnose:** the aurar/króna coupling — the API emits aurar under a króna-shaped
field name and clients divide. **Correcting either side alone breaks the other.**
**Contain:** roll back the client or the field, whichever moved.
**Do not:** "fix" `minorToIsk` to divide while the field name stays.
**Recover:** correct the projection; **notify affected drivers** — do not quietly fix.

---

## Cross-cutting rollback triggers

Any of these authorises an **immediate, ungated** rollback:

- a brand hostname not serving, or invalid TLS
- the mobile-pinned API host not serving
- the charger fleet disconnected and not recovering
- production reading beta data
- money displayed wrong by an order of magnitude
- a deploy that no release manifest explains
