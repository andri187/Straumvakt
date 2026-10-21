# Appendix E — Operator checklists (60)

These are **pre-planned execution checklists**, not incident runbooks. Incident
response lives in Appendix B (36 runbooks) and Appendix K (10 rollback drills).

Every checklist has the same seven parts: **Preconditions · Steps · Expected
evidence · Stop conditions · Approval gate · Output artifact · Rollback.**

Mutation categories: `RO` read-only · `LOCAL` local mutation · `EXT` external
mutation · `DESTRUCT` destructive · `APPROVAL` requires Andri.

> **Standing stop condition for every checklist in this appendix.** If a step
> reveals something nobody in this project has seen before — an unknown Worker, a
> repository nobody recognises, an account member nobody expected, a production
> resource that should not exist — stop, record it, and do not proceed to the
> next step.

---

## Cloudflare read-only session (CL-01 … CL-06)

### CL-01 — Open a Cloudflare read-only session
**Preconditions.** Read-only token created (ISS-04) and stored outside every repository. Evidence directory created outside `E:\Claude`. The full step list read before logging in — a logged-in session with an unplanned agenda is where accidental clicks happen.
**Steps.** 1. Export the token into the shell for this session only. 2. `curl -sH "Authorization: Bearer $RO" https://api.cloudflare.com/client/v4/user/tokens/verify`. 3. Record `id`, `status`, `expires_on`. 4. `GET /accounts` and record the single account id. 5. `GET /zones?name=straumvakt.org` and record the zone id and nameservers.
**Expected evidence.** `token-verify.json`, `accounts.json`, `zones.json`. Account id is 32 hex; zone `status: active`.
**Stop conditions.** More than one account returned. Token status not `active`. Nameservers do not match the registrar.
**Approval gate.** `RO` — no approval needed once the token exists.
**Output artifact.** Evidence bundle, three files.
**Rollback.** Nothing to undo; close the shell.

### CL-02 — Prove the token cannot write
**Preconditions.** CL-01 complete.
**Steps.** 1. `curl -s -o /dev/null -w '%{http_code}\n' -X PUT -H "Authorization: Bearer $RO" ".../accounts/$ACC/workers/scripts/hlada-staging"`. 2. Record the status and the error body.
**Expected evidence.** HTTP 403 with an authentication-class error. A 400 means the request was accepted for processing and rejected on shape — that is not proof of read-only.
**Stop conditions.** Anything other than 403. **Revoke the token immediately and reissue with narrower permissions.**
**Approval gate.** `RO` in effect — the call is rejected before it changes anything.
**Output artifact.** `token-write-refusal.txt`.
**Rollback.** None needed.

### CL-03 — Capture the Git integration and build owner
**Preconditions.** CL-01 complete. Browser session open — this is the one fact with no CLI equivalent.
**Steps.** For each of `hlada-staging`, `hlada-api-staging`, `straumvakt-ocpp-staging`: 1. Workers & Pages → the Worker → Settings → Build. 2. Record connected repository owner and name, production branch, build command, root directory, and whether builds are enabled. 3. Screenshot each.
**Expected evidence.** Three screenshots and a table. Each Worker attributed to exactly one repository.
**Stop conditions.** A Worker connected to a repository nobody recognises. A Worker connected to the CPMS repository — record it and treat it as production no-go NG-04, but do not disconnect anything.
**Approval gate.** `RO`. **Never click Disconnect.**
**Output artifact.** `git-integration.md` plus screenshots.
**Rollback.** None.

### CL-04 — Capture bindings, Durable Object namespaces, and secret names
**Preconditions.** CL-01 complete.
**Steps.** For each Worker: 1. `GET .../scripts/{name}/settings` — record every binding type, name, and target. 2. `GET .../scripts/{name}/secrets` — record `{name, type}` only. 3. `GET /accounts/{id}/workers/durable_objects/namespaces` — record `{id, name, class, script}`, particularly `IDENTITY_DO`. 4. Dashboard → Settings → Variables and Secrets — record plaintext variable names **and** values; secrets show names with values hidden.
**Expected evidence.** Per-Worker binding list; secret names matching `^[A-Z][A-Z0-9_]*$`; DO namespace ids.
**Stop conditions.** Any captured secret name contains `=`, `:`, `/`, or exceeds 40 characters — that is a value, not a name. Discard the capture and redo it. A plaintext variable whose value looks like a credential — redact it and raise it as a finding.
**Approval gate.** `RO`. **Never click a reveal control if one exists.**
**Output artifact.** `bindings.json`, `secret-names.json`, `do-namespaces.json`.
**Rollback.** None.

### CL-05 — Capture Hyperdrive, Queues, and R2
**Preconditions.** CL-01 complete.
**Steps.** 1. `GET /accounts/{id}/hyperdrive/configs` — record id, origin host, database name, caching mode. The password is not returned; do not work around that. 2. Dashboard → Queues — record name, producer, consumer, backlog depth, dead-letter depth, **with a timestamp**. 3. R2 → Overview — record bucket names and whether any is public.
**Expected evidence.** Hyperdrive origin cross-checked against the intended Neon branch endpoint. Queue depths with a timestamp so a later reading is comparable.
**Stop conditions.** Hyperdrive origin does not match the branch identified in CL-29 — stop and raise it; this is the most invisible possible data bug. Any non-zero dead-letter depth — record it as a production no-go input. Any public R2 bucket.
**Approval gate.** `RO`. **Never purge a queue.**
**Output artifact.** `hyperdrive.json`, `queues.md`, `r2.json`.
**Rollback.** None.

### CL-06 — Close the Cloudflare session
**Preconditions.** All capture checklists complete.
**Steps.** 1. Account → Members — record every member with Administrator or Workers Admin rights. 2. Account → Audit Log — capture the last 30 days; redact anything token-shaped. 3. Write the **not-inspected list**: every dashboard section not opened. 4. Hash every file in the evidence bundle. 5. Delete the read-only token. 6. Re-run the verify call and expect 401.
**Expected evidence.** Membership list, audit log, not-inspected list, `bundle-manifest.txt` of hashes, and a 401 proving revocation.
**Stop conditions.** An account member nobody expected. An unattributable deploy or DNS change in the audit log.
**Approval gate.** Token deletion is `EXT` + `APPROVAL` — but leaving a live token is the larger risk, so this is pre-approved when the session ends.
**Output artifact.** Complete, hashed evidence bundle.
**Rollback.** Reissue the token if more evidence is needed.

---

## Cloudflare version capture (CL-07 … CL-10)

### CL-07 — Capture version IDs for `hlada-staging` (web)
**Preconditions.** CL-01 complete.
**Steps.** 1. `GET .../scripts/hlada-staging/versions` — record the last five `{id, number, created_on}`. 2. `GET .../scripts/hlada-staging/deployments` — record the **currently active** version id and any gradual-rollout split. 3. Screenshot the Deployments tab.
**Expected evidence.** At least one version id in 36-character UUID form, and the active one distinguished from the latest — they are not necessarily the same.
**Stop conditions.** No versions returned. A gradual rollout in progress — record the split; a rollback during a rollout is a different operation.
**Approval gate.** `RO`. **Never use the dashboard's rollback control during a capture.**
**Output artifact.** `versions-web.json`.
**Rollback.** None.

### CL-08 — Capture version IDs for `hlada-api-staging` (API)
**Preconditions.** CL-01 complete.
**Steps.** As CL-07 for the API Worker.
**Expected evidence.** Active version id recorded as **the rollback target for the API** — the Worker the shipped mobile app depends on.
**Stop conditions.** As CL-07.
**Approval gate.** `RO`.
**Output artifact.** `versions-api.json`.
**Rollback.** None.

### CL-09 — Capture version IDs for `straumvakt-ocpp-staging` (gateway)
**Preconditions.** CL-01 complete.
**Steps.** As CL-07 for the gateway.
**Expected evidence.** Active version id recorded in the OCPP continuity record. This Worker terminates charger WebSockets; a bad version disconnects the fleet.
**Stop conditions.** As CL-07.
**Approval gate.** `RO`.
**Output artifact.** `versions-gateway.json`.
**Rollback.** None.

### CL-10 — Assemble and hash the evidence bundle
**Preconditions.** CL-01 … CL-09 complete.
**Steps.** 1. `Get-FileHash -Algorithm SHA256 *.json *.md *.txt` into `bundle-manifest.txt`. 2. Run the secret scanner across the bundle. 3. Produce the three-column table: **declared** (wrangler configs) / **deployed** (this evidence) / **delta**.
**Expected evidence.** Every file hashed. Scanner clean. Every delta assigned a work item; zero deltas is itself a recorded result, not an absence of one.
**Stop conditions.** The secret scanner matches anything. A delta nobody can explain.
**Approval gate.** `LOCAL`.
**Output artifact.** `bundle-manifest.txt`, `declared-vs-deployed.md`.
**Rollback.** Delete the bundle.

---

## Route, domain, and certificate capture (CL-11 … CL-13)

### CL-11 — Capture Worker routes and custom domains
**Preconditions.** CL-01 complete.
**Steps.** 1. `GET /zones/{zid}/workers/routes`. 2. `GET /accounts/{id}/workers/domains`. 3. Per Worker, dashboard → Settings → Domains & Routes; record which of {Custom Domain, route, neither} applies. 4. Check `api.straumvakt.org` specifically — the web→API path depends on it being a **Custom Domain**, not a route.
**Expected evidence.** Every route pattern attributed to a Worker. An empty route list recorded as an explicit finding rather than an omission.
**Stop conditions.** `api.straumvakt.org` is a route rather than a Custom Domain — the web→API call may be looping back to the calling Worker. Raise immediately.
**Approval gate.** `RO`.
**Output artifact.** `routes.json`, `custom-domains.json`.
**Rollback.** None.

### CL-12 — Capture zone DNS records
**Preconditions.** CL-01 complete.
**Steps.** 1. `GET /zones/{zid}/dns_records?per_page=100`. 2. Dashboard → DNS → Records; confirm the count matches the API. 3. Record name, type, content, and proxy status for every record.
**Expected evidence.** Every hostname the project uses appears, or is explicitly recorded as absent. Custom Domains appear as proxied records.
**Stop conditions.** A record pointing somewhere nobody recognises. A count mismatch between API and dashboard.
**Approval gate.** `RO`. **Never edit a record during capture.**
**Output artifact.** `dns-records.json`.
**Rollback.** None.

### CL-13 — Capture the edge certificate SAN list
**Preconditions.** CL-01 complete.
**Steps.** 1. Zone → SSL/TLS → Edge Certificates. 2. Record hosts, issuer, expiry, and certificate type. 3. Compare against every hostname in CL-12 and every planned production hostname.
**Expected evidence.** The SAN list verbatim. `www.straumvakt.org` is **known absent** from the apex SAN — confirm whether that is still true.
**Stop conditions.** A production hostname is not covered and no plan exists. A certificate expiring within 30 days.
**Approval gate.** `RO`. Ordering a certificate is `EXT` + `APPROVAL`.
**Output artifact.** `certificates.md`.
**Rollback.** None.

---

## workers.dev preservation (CL-14 … CL-17)

### CL-14 — Preserve workers.dev before any deploy
**Preconditions.** The deploy diff has been read in full. The Worker's current workers.dev state captured (CL-16 or CL-17).
**Steps.** 1. Screenshot the Worker's Domains & Routes page **before**. 2. Read the diff for any addition of a `routes` array. 3. If routes are added, confirm `workers_dev` is **explicitly declared** in the same environment block — adding routes infers `workers_dev = false`. 4. `wrangler deploy --dry-run` and confirm the output still lists the workers.dev host. 5. Deploy. 6. Screenshot the same page **after**. 7. Request the pinned host and confirm an application response, not Cloudflare error 1042.
**Expected evidence.** Two screenshots, a dry-run transcript, and a post-deploy response from the pinned host.
**Stop conditions.** Routes added without an explicit `workers_dev` — **do not deploy**. Post-deploy request returns 1042 — go to drill RD-02 immediately.
**Approval gate.** `EXT` + `APPROVAL` for the deploy itself.
**Output artifact.** Before/after screenshots attached to the release record.
**Rollback.** Roll back to the captured version id, then re-enable workers.dev in the dashboard.

### CL-15 — Rename a Worker with every dependant updated
**Preconditions.** AD-03 decided. A mobile release that no longer pins the old hostname has shipped and the old version's install base is understood.
**Steps.** 1. Update the Worker name in its `wrangler.jsonc`. 2. Update `gateway/wrangler.jsonc:64-65` `MAIN_APP` binding — it targets the API **by name**. 3. Update `apps/mobile/lib/api/client.dart` if it pins the derived host. 4. Update any documentation and any custom domain attachment. 5. `wrangler deploy --dry-run` all three Workers. 6. Deploy in cutover order.
**Expected evidence.** Three passing dry runs; the binding resolves; both old and new hostnames answer during the overlap.
**Stop conditions.** Any dependant not updated in the same change set. The old hostname stops answering while an app version in the field still pins it.
**Approval gate.** `EXT` + `APPROVAL`.
**Output artifact.** One reviewable change set covering config, binding, and client.
**Rollback.** Revert the change set and redeploy the previous versions. Note the hostname changes back with the name.

### CL-16 — Capture workers.dev state for the API Worker
**Preconditions.** CL-01 complete.
**Steps.** 1. Worker → Settings → Domains & Routes → the `workers.dev` row. 2. Screenshot the literal enabled/disabled state. 3. Confirm `apps/api/wrangler.jsonc` declares neither `routes` nor `workers_dev` — the live state is therefore **inferred, not declared**.
**Expected evidence.** A screenshot, not a sentence. A successful `curl` is not evidence of the toggle state.
**Stop conditions.** Enabled and undeclared — raise ISS-01 to blocking before any routing change.
**Approval gate.** `RO`.
**Output artifact.** `workersdev-api.png` plus a note.
**Rollback.** None.

### CL-17 — Capture workers.dev state for the gateway Worker
**Preconditions.** CL-01 complete.
**Steps.** As CL-16 for `straumvakt-ocpp-staging` and `gateway/wrangler.jsonc`.
**Expected evidence.** As CL-16.
**Stop conditions.** Enabled and undeclared — raise ISS-02 to blocking. **The blast radius here is the charger fleet, not the app**; chargers do not reconnect to a hostname that stops resolving, and reconfiguring them is a physical or vendor-portal operation.
**Approval gate.** `RO`.
**Output artifact.** `workersdev-gateway.png` plus a note.
**Rollback.** None.

---

## Service binding proof (CL-18 … CL-20)

### CL-18 — Review the service binding design
**Preconditions.** SZB-01 path table complete. ISS-24 header audit complete.
**Steps.** 1. Confirm exactly which path is being changed — web→API is the only plain-HTTPS path of the four. 2. Review every Host, Origin, referer, and cookie dependency the API has. 3. Confirm the configuration switch keeps the HTTPS path available. 4. Confirm the change does **not** claim to remove the need for a public hostname — external clients still reach the API over it.
**Expected evidence.** A reviewed diff plus a classification of every header dependency as safe, needs-forwarding, or blocking.
**Stop conditions.** Any blocking dependency unresolved. Any claim in the change description that overstates what a binding solves.
**Approval gate.** `LOCAL`.
**Output artifact.** Review notes attached to the change.
**Rollback.** Do not proceed.

### CL-19 — Prove the service binding locally
**Preconditions.** CL-18 passed.
**Steps.** 1. Run both Workers under `wrangler dev` with the binding configured. 2. Issue a representative authenticated request through the binding. 3. Issue the same request through the HTTPS path with the switch flipped. 4. Compare responses byte for byte where possible. 5. Time both.
**Expected evidence.** Identical responses on both paths. Two timings, recorded with the caveat that local timings do not predict edge timings.
**Stop conditions.** Any response difference, particularly on authenticated requests or `Set-Cookie` headers.
**Approval gate.** `LOCAL`.
**Output artifact.** Local test transcript.
**Rollback.** None.

### CL-20 — Cut over to the service binding behind a flag
**Preconditions.** CL-19 passed. Beta first; production only after the stated soak.
**Steps.** 1. Deploy with the switch still set to HTTPS. 2. Verify normal operation. 3. Flip the switch to the binding. 4. Verify: page loads, an authenticated read succeeds, no error-rate change. 5. Soak for the stated period. 6. Only then consider production.
**Expected evidence.** Verification at each step; a soak with a defined success signal.
**Stop conditions.** Any authenticated request failure after the flip — flip back immediately, no deploy required.
**Approval gate.** `EXT` + `APPROVAL`.
**Output artifact.** Cutover record with the soak result.
**Rollback.** **Flip the switch. No deploy needed** — that is the entire reason for the switch.

---

## OCPP and gateway continuity (CL-21 … CL-24)

### CL-21 — Prove OCPP endpoint continuity
**Preconditions.** The canonical charger endpoint recorded (host, path, protocol, port), or its variants listed with counts.
**Steps.** 1. Attempt a WebSocket upgrade against the endpoint. 2. Record status and headers **only** — send no OCPP payload and never impersonate a charger. 3. Confirm the endpoint string in the release manifest matches what chargers are configured with.
**Expected evidence.** A 101 or a documented rejection. Either is evidence; no response at all is not.
**Stop conditions.** The endpoint in the release differs in any way from the recorded charger configuration. Endpoint variants exist that were not known about.
**Approval gate.** `RO`.
**Output artifact.** `ocpp-endpoint-check.txt`.
**Rollback.** None.

### CL-22 — Verify Durable Object namespace continuity
**Preconditions.** CL-04 complete; `IDENTITY_DO` namespace id recorded.
**Steps.** 1. Compare the namespace id in the target environment against the recorded id. 2. Confirm the release binds the **existing** namespace and does not create a new one. 3. Record the id in the gateway release manifest.
**Expected evidence.** Matching namespace ids before and after.
**Stop conditions.** A new namespace id appears. **Every charger's identity is in the old one**; they will connect and be treated as unknown, requiring re-onboarding in the field.
**Approval gate.** `RO` to verify; the deploy is `EXT` + `APPROVAL`.
**Output artifact.** Namespace continuity record.
**Rollback.** Roll back the gateway version and rebind the original namespace.

### CL-23 — Capture the connected-charger count before and after
**Preconditions.** A readable connected-charger count exists (ISS-53). If it does not, record that this verification **cannot currently be performed** rather than skipping it silently.
**Steps.** 1. Record the count immediately before. 2. Deploy. 3. Record the count at +1, +5, and +15 minutes — reconnection is not instant and the backoff profile matters.
**Expected evidence.** Four numbers. The +15 figure should match the baseline.
**Stop conditions.** The count does not recover by +15 minutes. Any charger that was connected before and is not by +15.
**Approval gate.** `EXT` + `APPROVAL` for the deploy.
**Output artifact.** Charger count series attached to the release record.
**Rollback.** Roll back the gateway version; expect a second reconnect cycle.

### CL-24 — Choose and open a gateway deploy window
**Preconditions.** Reconnect behaviour understood (backoff, retry interval, worst-case simultaneous connections) or explicitly assumed and stated. Maximum acceptable downtime derived from it.
**Steps.** 1. Confirm the window is a genuine low-usage period, or state the assumption behind believing it is. 2. Confirm no charging session is in progress if that is determinable. 3. Confirm the rollback target version id was captured **minutes** ago, not days. 4. Deploy. 5. Run CL-23.
**Expected evidence.** A stated window with its justification; downtime measured against the ceiling.
**Stop conditions.** Downtime exceeds the stated ceiling. Sessions in progress that would be disrupted, where that is knowable.
**Approval gate.** `EXT` + `APPROVAL`. In-flight sessions are physical events with customers attached.
**Output artifact.** Deploy record with measured downtime.
**Rollback.** Drill RD-04.

---

## GitHub branch safety (CL-25 … CL-28)

### CL-25 — Make local branches safe to push from
**Preconditions.** The full upstream audit run across every worktree.
**Steps.** 1. `git for-each-ref --format='%(refname:short) -> %(upstream:short)' refs/heads` in each worktree. 2. For each branch tracking `origin/staging` or `origin/main`: `git branch --unset-upstream <branch>`. **Known cases: `dev/rename-prod-worker` (carries the forbidden `4fe0a95`) and `dev/secret-hygiene-v2`.** 3. `git config push.default simple`. 4. Re-run the audit.
**Expected evidence.** No branch tracks a deploy-relevant remote branch. `git ls-remote --heads origin | wc -l` still reports 16 — **nothing on the remote changed**.
**Stop conditions.** A branch you did not expect tracks `staging`. Any remote ref count change — that means something was pushed.
**Approval gate.** `LOCAL` + `APPROVAL`.
**Output artifact.** Before/after upstream table.
**Rollback.** `git branch -u origin/staging <branch>` restores the tracking exactly.

### CL-26 — Install the pre-push refusal hook
**Preconditions.** CL-25 complete.
**Steps.** 1. Write a `pre-push` hook that exits non-zero when the destination ref is `refs/heads/staging` or `refs/heads/main`, with a documented override variable for deliberate use. 2. Install via `core.hooksPath` so all worktrees share it. 3. `git push --dry-run origin HEAD:staging` and confirm refusal. 4. `git push --dry-run origin HEAD:some-feature` and confirm it is unaffected.
**Expected evidence.** One refusal, one pass.
**Stop conditions.** The hook blocks ordinary pushes — that will get it deleted rather than fixed.
**Approval gate.** `LOCAL` + `APPROVAL`. A and X share this repository and will encounter it.
**Output artifact.** Hook file plus the two dry-run transcripts.
**Rollback.** Delete the hook or unset `core.hooksPath`.

### CL-27 — Enable GitHub branch protection
**Preconditions.** Current state captured as evidence first (`gh api .../branches` and `.../rulesets`, hashed) — after protection is enabled nobody can show what it was before.
**Steps.** 1. Settings → Rules → Rulesets → New branch ruleset targeting the deploy pointer. 2. Enable: require pull request, block force pushes, restrict deletions, require linear history. 3. Repeat for the trunk. 4. Record the bypass actor list. 5. `git push --dry-run --force origin HEAD:staging` and confirm server-side rejection.
**Expected evidence.** A rule-violation message from the server, not from a local hook.
**Stop conditions.** The bypass list is broad — a ruleset with a broad bypass list is documentation, not protection. Do not remove the owner's own bypass; that can lock the account out.
**Approval gate.** `EXT` + `APPROVAL`. A and X must open pull requests afterwards.
**Output artifact.** Ruleset configuration plus the rejection transcript.
**Rollback.** Disable the ruleset. Instant.

### CL-28 — Repoint the repository default branch
**Preconditions.** The trunk decided and recorded (AD-04). CL-27 complete.
**Steps.** 1. Settings → General → Default branch → change. 2. `gh pr list --json number,baseRefName` — changing the default retargets some pull requests and not others. 3. Confirm every open pull request's base is intentional. 4. Clone fresh into a scratch directory and confirm it checks out the trunk.
**Expected evidence.** A fresh clone on the trunk; a reviewed pull-request base list.
**Stop conditions.** An open pull request now targets a branch its author did not intend.
**Approval gate.** `EXT` + `APPROVAL`.
**Output artifact.** Before/after default branch record.
**Rollback.** Change it back; pull requests retarget again.

---

## Neon metadata and protection (CL-29 … CL-32)

### CL-29 — Capture Neon metadata
**Preconditions.** Neon console or metadata access. **No SQL at any point.**
**Steps.** 1. Record project id, name, region. 2. List all branches with ids, parents, and creation dates. 3. List computes with sizes and autoscaling bounds. 4. Record the **history retention window** in hours. 5. Identify which branch each environment actually uses, by cross-referencing the Hyperdrive origin from CL-05.
**Expected evidence.** Every environment maps to an explicit `br-` identifier. Nothing relies on the project default.
**Stop conditions.** An environment relying on the project default — **the default is an abandoned branch** and this has already caused wrong-branch reads in this project. One project and no production project is expected; more than one unexpected project is not.
**Approval gate.** `RO`. Metadata only.
**Output artifact.** `neon-inventory.md`.
**Rollback.** None.

### CL-30 — Protect the beta Neon branch
**Preconditions.** CL-29 complete; the beta branch identified as `br-tiny-river-abgpqq37`.
**Steps.** 1. Neon console → Branches → the branch → Protect. 2. Attempt deletion and confirm refusal. 3. Screenshot the protected state.
**Expected evidence.** Deletion refused by the console.
**Stop conditions.** The branch believed to be beta is not the one Hyperdrive points at — resolve that first.
**Approval gate.** `EXT` + `APPROVAL`. **This branch holds real users' personal data.**
**Output artifact.** Protection screenshot.
**Rollback.** Unprotect.

### CL-31 — Create the production Neon project or branch
**Preconditions.** AD-05 decided (separate project versus branch). AD-05 also decides whether production starts empty or seeded — **beta personal data does not move**.
**Steps.** 1. Create the project or branch. 2. Protect it immediately, before anything is written. 3. Record the branch id and enter it directly into the production release manifest. 4. Record the compute size, autoscaling bounds, and max connections. 5. Confirm the connection string will be a **secret binding**, never a plaintext variable.
**Expected evidence.** A protected, empty target with its id recorded.
**Stop conditions.** Any proposal to copy beta rows into production.
**Approval gate.** `EXT` + `APPROVAL`.
**Output artifact.** Production data-home record.
**Rollback.** Delete it while it is still empty.

### CL-32 — Repoint the Neon project default branch
**Preconditions.** CL-29 complete. The intended default identified.
**Steps.** 1. Neon console → Branches → Set as default. 2. Run a tool that omits a branch identifier and confirm it reaches the intended branch. 3. Confirm the abandoned branch is **not deleted** — repointing is enough.
**Expected evidence.** A default-omitting connection reaching the right data.
**Stop conditions.** Any tool still reaching the abandoned branch.
**Approval gate.** `EXT` + `APPROVAL`.
**Output artifact.** Default branch record.
**Rollback.** Set it back.

---

## Migrations and schema (CL-33 … CL-37)

### CL-33 — Reconcile migration history
**Preconditions.** Read access to `_prisma_migrations` metadata. **No `migrate deploy` at any point in this checklist.**
**Steps.** 1. List recorded migrations. 2. List migration directory contents. 3. Produce a per-migration applied/pending/divergent table. 4. For each divergence, decide `migrate deploy` or `resolve --applied` **individually, with a written reason**. 5. Record the dual-ORM position — Prisma and Drizzle both exist, and two migration authorities is one too many.
**Expected evidence.** Every divergent row has a named action and a reason. A blanket resolve is not an answer.
**Stop conditions.** A migration recorded as applied whose file no longer exists. A file with no record and no clear origin.
**Approval gate.** `RO` to reconcile; applying anything is `EXT` + `APPROVAL`.
**Output artifact.** Migration reconciliation table.
**Rollback.** Nothing applied, nothing to roll back.

### CL-34 — Schema change precondition check
**Preconditions.** A proposed schema change exists.
**Steps.** 1. For every table or column being dropped, **search the codebase for references** — including relation loads, which do not appear as literal table names. 2. Confirm a backup branch exists (CL-35). 3. Confirm the change is reversible or state plainly that it is not. 4. Confirm the money-unit contract is settled if the change touches monetary fields.
**Expected evidence.** A reference search result per dropped object.
**Stop conditions.** **A row count of zero is never sufficient evidence for dropping anything.** Thirty-two tables were dropped on test and staging on exactly that reasoning; relation loads hid the references.
**Approval gate.** `APPROVAL` for any drop.
**Output artifact.** Drop justification record.
**Rollback.** Restore from the backup branch — which is why CL-35 comes first.

### CL-35 — Create a backup branch before a schema change
**Preconditions.** CL-29 complete.
**Steps.** 1. Create a branch named `backup-YYYY-MM-DD-<reason>`. 2. Record its id in the release manifest's `backupBranchId`. 3. Confirm it is a genuine copy-on-write branch of the target, not of the default. 4. Record the retention rule: how long it lives and who deletes it.
**Expected evidence.** Branch id recorded in the manifest before the change begins.
**Stop conditions.** The branch was taken from the wrong parent. **Beta data includes real personal data** — any branch or export of it carries that data and inherits the obligation.
**Approval gate.** `EXT` + `APPROVAL`.
**Output artifact.** Backup branch record.
**Rollback.** Delete the backup branch after the retention period.

### CL-36 — Rehearse a Neon restore and measure it
**Preconditions.** A throwaway branch. **Never rehearse against beta or production data.**
**Steps.** 1. Create a throwaway branch. 2. Apply a trivial migration. 3. Restore to a point before it. 4. Connect and verify: schema version, row counts on key tables, one read through the API. 5. **Record elapsed seconds.** 6. Write down every place the endpoint appears that must be repointed — a restored branch has a **different endpoint** and the Workers point at the old one. 7. Delete the throwaway branch.
**Expected evidence.** A measured number for `rollback.restoreTimeMeasuredSec`, and a complete endpoint-repoint list.
**Stop conditions.** The restore does not reach the intended point. The application's health checks fail against the restored branch — a branch that connects is not the same as a branch the application can use.
**Approval gate.** `EXT` + `APPROVAL`.
**Output artifact.** Restore rehearsal record with the measured time.
**Rollback.** Delete the rehearsal branch; nothing else was touched.

> **Read before every restore.** A restore to before a bad change also **discards everything written since**. State the data-loss window out loud before running the command, not after.

### CL-37 — Capture connection limits and headroom
**Preconditions.** CL-29 complete.
**Steps.** 1. Record compute size, autoscaling bounds, and max connections for the intended branch. 2. Record whether Hyperdrive pooling is in the path **per Worker** — it changes the connection arithmetic entirely. 3. Compare against expected charger and user concurrency, including the worst-case reconnect storm figure.
**Expected evidence.** Numbers with a stated headroom.
**Stop conditions.** Worst-case concurrency exceeds the connection ceiling. Worker concurrency and Postgres connection limits meet at exactly one place, and it is usually discovered under load.
**Approval gate.** `RO`.
**Output artifact.** Capacity record.
**Rollback.** None.

---

## Production secrets and CPMS (CL-38 … CL-41)

### CL-38 — Enumerate production secrets
**Preconditions.** CL-04 complete (beta secret names).
**Steps.** 1. List every beta secret name. 2. Grep the source for every `env.` read. 3. Produce the union. 4. Mark each as: new value required, provider-fixed, or non-secret configuration.
**Expected evidence.** Every name read by code appears in the list. **No value appears in any artifact.**
**Stop conditions.** A name in code with no corresponding binding — production will 500 on the first authenticated request, after the cutover looks successful.
**Approval gate.** `RO`.
**Output artifact.** Production secret name list.
**Rollback.** None.

### CL-39 — Set production secrets
**Preconditions.** CL-38 complete. AD-07 decided per secret.
**Steps.** 1. For each secret, set a **new value** unless a provider forces sharing — a shared beta value means one compromise affects both, and beta is the less-guarded environment. 2. Never reuse `AUTH_SECRET` — a real one from this project is already public in git history. 3. Set via `wrangler secret put` or the dashboard; never in a config file. 4. Verify by name only: the binding exists, the value is not readable.
**Expected evidence.** Every required name bound. No value in any file, log, or document.
**Stop conditions.** A value appears in a shell history, a config file, or a screenshot.
**Approval gate.** `EXT` + `APPROVAL`.
**Output artifact.** Bound-name list only.
**Rollback.** Rotate.

### CL-40 — Verify CPMS separation
**Preconditions.** CL-03 complete.
**Steps.** 1. Confirm which project each Worker's Git integration belongs to. 2. Determine whether CPMS retains a deploy path to any Worker name Straumvakt uses. 3. Record the result in the production manifest's `cpmsSeparationVerified`.
**Expected evidence.** A definitive yes or no per Worker.
**Stop conditions.** CPMS retains a deploy path — **production no-go NG-04**. A CPMS merge would redeploy Straumvakt's estate.
**Approval gate.** `RO`. **Never edit anything under `E:\Claude\CPMS\CPMS\`.** Confirm with `git status` in that checkout at session end.
**Output artifact.** Separation verification record.
**Rollback.** None.

### CL-41 — Send the CPMS brief
**Preconditions.** CL-40 complete. AD-03 decided.
**Steps.** 1. State what is shared: the Worker names, inherited when CPMS renamed `straumvakt` to `hlada` on 2026-04-19 and Straumvakt adopted the names on 2026-04-24. 2. State what breaks if both projects deploy. 3. State the specific action requested. 4. Do **not** instruct them how to run their project.
**Expected evidence.** A one-page brief sendable without further context.
**Stop conditions.** The brief attributes blame rather than describing a collision.
**Approval gate.** `RO` to write; sending it is Andri's call.
**Output artifact.** CPMS brief.
**Rollback.** None.

---

## Production environment and domains (CL-42 … CL-44)

### CL-42 — Author production wrangler environments
**Preconditions.** Production Worker names decided (AD-03), checked against CPMS declarations.
**Steps.** 1. Add a production environment block per Worker. 2. **Declare `workers_dev` explicitly in every one** — no inherited defaults. 3. Declare every binding explicitly, including the gateway's `MAIN_APP` target and every Durable Object namespace. 4. `wrangler deploy --dry-run --env production` for all three.
**Expected evidence.** Three passing dry runs; no binding inherited implicitly.
**Stop conditions.** Any dry run fails. Any environment relies on inheritance — writing production configuration during a cutover is the worst possible time to discover an implicit default.
**Approval gate.** `LOCAL`. Deploying is a separate gate.
**Output artifact.** Three production environment blocks.
**Rollback.** Revert.

### CL-43 — Set up beta or production domains
**Preconditions.** CL-14 read in full. Certificate coverage confirmed for every hostname (CL-13). Expected post-change DNS record set written down in advance.
**Steps.** 1. Confirm `workers_dev` is explicitly declared for every affected Worker **before** touching domains. 2. Attach the Custom Domain. 3. Confirm the DNS record appears as expected. 4. Confirm the certificate covers the hostname. 5. **Confirm the workers.dev host still answers.** 6. Confirm the new hostname returns an application response.
**Expected evidence.** Both hostnames answering simultaneously; DNS matching the pre-written expectation.
**Stop conditions.** The workers.dev host returns 1042 after the change — every shipped mobile app has just lost API access. Go to drill RD-02.
**Approval gate.** `EXT` + `APPROVAL`.
**Output artifact.** Domain attachment record with both host checks.
**Rollback.** Remove the Custom Domain; **then re-verify the workers.dev host still answers** — removal does not automatically restore it.

### CL-44 — Execute the production cutover in order
**Preconditions.** CL-55 no-go review passed **minutes** ago. Rollback targets captured minutes ago (CL-51). Release manifest validates under `--strict`.
**Steps.** In strict order, with the named verification passing before the next step begins: 1. **Database ready** — branch protected, migrations reconciled, backup branch recorded. 2. **API deployed** — health endpoint responds. 3. **Gateway deployed if changed** — CL-21 and CL-23 pass. 4. **Web deployed** — page loads, one authenticated read succeeds. 5. **Domains attached** — CL-43 per hostname.
**Expected evidence.** A verification transcript per step.
**Stop conditions.** Any verification fails — **stop and roll back that step before proceeding**. Deploying web before API means the web app briefly calls an API that is not there, and the resulting errors are indistinguishable from a broken deploy.
**Approval gate.** `EXT` + `APPROVAL` at each step.
**Output artifact.** Cutover transcript.
**Rollback.** Reverse order, using the captured version ids.

---

## Cleanup (CL-45 … CL-50)

### CL-45 — Capture preservation targets
**Preconditions.** Nothing under `E:\Claude` has been deleted, moved, or modified. A destination outside `E:\Claude` chosen.
**Steps.** 1. Copy `E:\Claude\Straumvakt\docs\OCPP` — **128 untracked files**, official OCPP 1.6 / 2.0.1 / 2.1 specifications. 2. Copy `E:\Claude\Straumvakt-parked` — **38 files**, OpenADR and dynamic-grid research, not a git worktree so nothing is recoverable from a remote. 3. Copy every untracked entry from the canonical checkout. 4. `Get-FileHash -Algorithm SHA256` on both sides and compare. 5. Confirm CPMS is on the preservation list, not the deletion list — it is the provenance for the `hlada` name and much of the OCPP design.
**Expected evidence.** Matching file counts (128 and 38) and matching hashes.
**Stop conditions.** Any count or hash mismatch. Any preservation target missing.
**Approval gate.** `LOCAL` + `APPROVAL`. **Copy only. Nothing is deleted in this checklist.**
**Output artifact.** Preservation copy with a hash manifest.
**Rollback.** The originals are untouched throughout.

### CL-46 — Unlink junctions
**Preconditions.** CL-45 complete and verified. The dry-run script has emitted the junctions in required unlink order.
**Steps.** For each junction, in the emitted order: 1. `cmd /c rmdir "<junction>"`. 2. Confirm the **target** directory still exists with its original file count. 3. Re-run the dry run.
**Expected evidence.** Every junction removed; every target intact.
**Stop conditions.** Any target's file count changes.
**Approval gate.** `DESTRUCT` + `APPROVAL`, though unlinking is itself reversible.
**Output artifact.** Junction unlink log.
**Rollback.** `mklink /J` recreates the junction.

> **Never use `Remove-Item -Recurse` on or near a junction.** It can traverse the junction and delete the **target** rather than the link. The same following behaviour is what produced impossible measurement figures — negative real content and more reclaimable space than the tree contained — on the first attempt at measuring this estate. The failure mode is demonstrated, not theoretical.

### CL-47 — Re-verify after every cleanup step
**Preconditions.** A cleanup step just completed.
**Steps.** 1. Run `cleanup-dryrun.ps1`. 2. Confirm **every** preservation target reports PRESENT. 3. Confirm no `*** MISSING ***` line. 4. Record the new measurement against the baseline.
**Expected evidence.** A passing preservation check after each step, not only at the start.
**Stop conditions.** Any missing target — **stop all cleanup immediately** and go to drill RD-10.
**Approval gate.** `RO`.
**Output artifact.** Per-step verification record.
**Rollback.** Restore from the verified archive.

### CL-48 — Give the prompt and evidence folder real version control
**Preconditions.** None. This is the least protected and most load-bearing asset in the project.
**Steps.** 1. Confirm the current state: `C:\Users\Andri\Documents\New project` has a `.git` directory with **zero commits and zero tracked files**, 160 untracked entries at the top level, and 22,759 files in total. 2. Write a `.gitignore` covering the tool caches — `.jadx-1.5.5/`, `.jadx-config/`, `.zaptec-apk/`, `.zaptec-jadx/`, `cache/`, `.~lock.*` — and binary artifacts. 3. `git add` the documents. 4. Confirm the **28 top-level markdown prompts** and `coordinator-ledger-straumvakt-2026-08-09.md` are staged. 5. Commit. 6. Confirm `git status` now shows tens of untracked entries, not tens of thousands.
**Expected evidence.** `git log --oneline` shows at least one commit; the coordinator ledger is tracked.
**Stop conditions.** The commit would include a secret or personal data — run the secret scanner over the staged set first. The visual status page belongs to the coordinator: **preserve it, do not edit it**.
**Approval gate.** `LOCAL` + `APPROVAL`. Nothing is deleted; `.gitignore` only affects what git tracks.
**Output artifact.** First commit in the prompt repository.
**Rollback.** Discard the commit; the files are untouched either way.

### CL-49 — Create and verify the cleanup archive
**Preconditions.** CL-45 and CL-48 complete. Archive location decided (AD-11) with a stated understanding of which failure it protects against — an archive on the same disk protects against `git clean`, not against disk loss.
**Steps.** 1. Create the archive outside `E:\Claude`. 2. Hash every member into a manifest. 3. **Extract to a scratch location.** 4. Re-hash the extraction. 5. Compare against the manifest. 6. Discard the extraction. 7. Create the deletion log mapping every future deletion to an archive member.
**Expected evidence.** Every hash verifies **from the extracted copy**, not from the archive listing.
**Stop conditions.** Any hash mismatch. An untested backup is a hypothesis.
**Approval gate.** `LOCAL` + `APPROVAL`.
**Output artifact.** Verified archive plus hash manifest plus deletion log.
**Rollback.** The originals are still present at this stage — that is the point of the ordering.

### CL-50 — Retire a worktree
**Preconditions.** CL-49 verified. The worktree has **zero unique commits** against the release candidate **and zero dirty files** — a zero-unique worktree with uncommitted changes is not safe to retire.
**Steps.** 1. `git rev-list --count 4b69d0f..HEAD` → must be 0. 2. `git status --porcelain` → must be empty. 3. `git worktree remove <path>`. 4. `git worktree list` → no stale entries. 5. `git branch --list` → **the branch still exists**.
**Expected evidence.** Worktree gone, branch intact, no stale registration.
**Stop conditions.** Non-zero unique commits or any dirty file — that is another agent's work.
**Approval gate.** `DESTRUCT` + `APPROVAL`.
**Output artifact.** Retirement log.
**Rollback.** Recreate the worktree from the branch, which still exists.

> **Never delete a branch as part of cleanup.** The branch is the cheap part; the working copy is the expensive part. Retiring one does not require the other.

---

## Release manifest and rollback (CL-51 … CL-56)

### CL-51 — Create a release manifest
**Preconditions.** Evidence bundle complete. Version ids captured **minutes** ago, not days — a stale rollback target is worse than none, because it will be trusted.
**Steps.** 1. Fill the schema. 2. `commit.sha` must be the **full 40 characters** — a seven-character sha is not an identity proof. 3. `rollback.workerVersionsBefore` for every Worker in the release. 4. `data.neonBranchId` explicit, never defaulted. 5. `commit.verifiedFastForward` set from an actual `git rev-list --left-right --count`, showing zero on the left. 6. `approval.excludedCommitsVerifiedAbsent` covering `4fe0a95`, `30fa407`, `5311cbd`, each verified with `git merge-base --is-ancestor`. 7. `workersDevRequired` true for any Worker with a pinned host.
**Expected evidence.** A manifest that validates.
**Stop conditions.** Any required field unknown. **Mark it unknown; do not fill it plausibly.**
**Approval gate.** `LOCAL`.
**Output artifact.** `release-YYYY-MM-DD.json`.
**Rollback.** Delete the draft.

### CL-52 — Validate a release manifest
**Preconditions.** CL-51 complete.
**Steps.** 1. `node scripts/analysis/manifest/validate-release-manifest.mjs <file>`. 2. For production, add `--strict` so warnings become errors. 3. Run both validators' self-tests first, so a validator regression is not mistaken for a manifest problem. 4. Attach the `--json` output as release evidence.
**Expected evidence.** `VALID`, or every error mapped to an open issue. Self-tests passing.
**Stop conditions.** Any error. In particular *"no workerVersionsBefore — this release has no rollback target"* means **the release cannot proceed**, not that the message should be waived.
**Approval gate.** `LOCAL`.
**Output artifact.** Validator output, committed with the manifest.
**Rollback.** None.

### CL-53 — Check rollback readiness before deploying
**Preconditions.** CL-52 passed.
**Steps.** 1. Confirm a version id exists for every Worker in the release. 2. Confirm the measured restore time is recorded for database changes. 3. Confirm the backup branch id is recorded. 4. Confirm **who** approves a rollback and that they are reachable now. 5. Confirm the rollback path has been rehearsed at least once.
**Expected evidence.** Five yes answers.
**Stop conditions.** Any no. A rollback plan with an unmeasured duration is an estimate wearing a plan's clothes — during an incident the difference between two minutes and forty is the difference between rolling back and pressing on.
**Approval gate.** `RO`.
**Output artifact.** Readiness record.
**Rollback.** Do not deploy.

### CL-54 — Execute a rollback
**Preconditions.** A decision to roll back has been made by the named approver.
**Steps.** 1. **Capture evidence first** — the failing response, the error code, the version currently active. Rolling back destroys the evidence of what went wrong. 2. Roll back Workers to their captured version ids, in reverse cutover order. 3. If a database change is involved, follow CL-36's endpoint-repoint list — a restore alone is not the recovery. 4. Run CL-58. 5. Record elapsed time.
**Expected evidence.** Evidence captured before the rollback; verification after; a measured duration.
**Stop conditions.** No captured version id — then this is not a rollback but a redeploy of an older commit, which is slower and riskier, and the difference must be stated plainly.
**Approval gate.** `EXT` + `APPROVAL`.
**Output artifact.** Rollback record with evidence and timing.
**Rollback.** Roll forward again once the cause is understood.

### CL-55 — Production no-go review
**Preconditions.** Immediately before cutover — minutes, not days. Three agents commit continuously, so a review written a week ago describes a system that no longer exists.
**Steps.** Check each condition aloud, with the named clearer present: 1. Rollback version ids recorded? 2. Production Neon project or branch exists and is protected? 3. Branch protection enabled on the deploy pointer? 4. CPMS no longer owns any deploy path? 5. `workers_dev` explicitly preserved for every pinned host? 6. OCPP endpoint continuity proven?
**Expected evidence.** Six explicit cleared/not-cleared states, each with a name against it.
**Stop conditions.** **Any single not-cleared condition stops the cutover.** A no-go with no owner is cleared by whoever is most impatient.
**Approval gate.** `APPROVAL`.
**Output artifact.** Signed no-go review.
**Rollback.** Not starting is the rollback.

### CL-56 — Pinned-host smoke check
**Preconditions.** Any deploy, domain change, or rename just completed.
**Steps.** 1. Request the workers.dev host the mobile app pins. 2. Confirm an **application response of any status** — a 404 from the application is a pass; error 1042 is a failure. 3. Repeat for the gateway endpoint if the gateway was touched.
**Expected evidence.** An application response, with the distinction from 1042 recorded explicitly.
**Stop conditions.** 1042 — every shipped mobile app has lost API access, and there is no client-side fix. Go to drill RD-02 immediately.
**Approval gate.** `RO`.
**Output artifact.** Smoke check transcript.
**Rollback.** Re-enable workers.dev; roll back the version if that does not restore it.

---

## Close-out (CL-57 … CL-60)

### CL-57 — Declare a release freeze
**Preconditions.** A release window is being opened. Three agents — this track, Claude A on backend and domain, Codex on UI — commit concurrently.
**Steps.** 1. Record the freeze start and expected end. 2. State what may land during it. 3. Signal it somewhere A and X will see without asking — the coordinator ledger. 4. Record every worktree's tip at freeze time.
**Expected evidence.** Tips recorded for every worktree; a visible freeze signal.
**Stop conditions.** A or X cannot determine the freeze state without a conversation — then the signal is not working.
**Approval gate.** `RO`.
**Output artifact.** Freeze record with tips.
**Rollback.** Lift the freeze and record that too.

### CL-58 — Post-cutover verification
**Preconditions.** CL-44 complete.
**Steps.** 1. Health endpoint on each Worker. 2. One authenticated read through the web app. 3. Connected-charger count matches the pre-cutover baseline — or record that this **cannot currently be performed** rather than skipping it silently. 4. One database round trip. 5. The pinned mobile host returns an application response (CL-56). 6. Soak for the stated period, watching the defined signal.
**Expected evidence.** Five checks with pass conditions, plus a soak result. Production working for a minute is not production working.
**Stop conditions.** Any check fails — roll back rather than debug forward.
**Approval gate.** `RO` to verify.
**Output artifact.** Verification transcript.
**Rollback.** CL-54.

### CL-59 — Update the release evidence ledger
**Preconditions.** A release, cutover, decision, or cleanup step has completed.
**Steps.** 1. Append: what happened, when, the validated manifest, the evidence hashes, the decisions made, and the outcome. 2. Record decision **reversals** visibly rather than overwriting — a reversed decision usually means the evidence was wrong, and that is worth knowing. 3. Record the age of the evidence each decision rested on.
**Expected evidence.** One authoritative location. Decisions recorded in three places diverge.
**Stop conditions.** None.
**Approval gate.** `LOCAL`. **Do not update the visual status HTML — that belongs to the coordinator.**
**Output artifact.** Ledger entry.
**Rollback.** None.

### CL-60 — Close a session and confirm external state
**Preconditions.** Session work complete.
**Steps.** 1. `git status` in every worktree — record dirty counts. 2. `git ls-remote --heads origin | wc -l` — confirm the count is unchanged. 3. `git ls-remote origin refs/heads/staging` — confirm the sha is unchanged. 4. Confirm your own branch was never pushed. 5. Hash the live brand domain response and compare against the session-start hash. 6. `git status` in the CPMS checkout — confirm untouched. 7. Confirm nothing under `E:\Claude` was deleted, moved, or modified. 8. State explicitly what changed externally, or that nothing did.
**Expected evidence.** Remote ref count, staging sha, and brand-domain hash all unchanged; peers' work preserved.
**Stop conditions.** Any remote ref changed unexpectedly — determine immediately whether it triggered a deploy, before doing anything else.
**Approval gate.** `RO`.
**Output artifact.** Session close record.
**Rollback.** Depends on what changed; the deploy question comes first.

---

**Count: 60 operator checklists**, covering all 21 required groups.

| Group | Checklists |
|---|---|
| Cloudflare read-only session | CL-01 … CL-06 |
| Cloudflare version capture | CL-07 … CL-10 |
| Cloudflare secret-name capture without values | CL-04, CL-38 |
| Cloudflare Worker bindings capture | CL-04 |
| Worker route / custom-domain capture | CL-11 … CL-13 |
| workers.dev preservation before deploy | CL-14 … CL-17 |
| Service binding proof | CL-18 … CL-20 |
| OCPP / gateway continuity | CL-21 … CL-24 |
| GitHub branch upstream safety | CL-25, CL-26 |
| GitHub branch protection setup | CL-27, CL-28 |
| Neon metadata capture | CL-29, CL-37 |
| Neon production project creation | CL-31, CL-32 |
| Neon backup / restore rehearsal | CL-35, CL-36 |
| Migrations and schema | CL-33, CL-34 |
| Production secrets | CL-38, CL-39 |
| CPMS separation | CL-40, CL-41 |
| Cleanup preservation capture | CL-45, CL-47, CL-48 |
| Cleanup archive creation | CL-49 |
| Cleanup safe delete later | CL-46, CL-50 |
| Beta / production domain setup | CL-42, CL-43 |
| Production cutover and no-go review | CL-44, CL-55 |
| Release manifest creation and validation | CL-51, CL-52 |
| Rollback readiness and execution | CL-53, CL-54, CL-56 |
| Post-cutover verification and close-out | CL-57 … CL-60 |
