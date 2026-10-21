# Appendix J — Issue-ready bodies (80)

Copy-pasteable. Each body is self-contained: a reader who has seen none of the
other documents can act on it. Mutation categories are as defined in Appendix I.

---

### ISS-01 — Declare `workers_dev` explicitly in the API Worker config
**Work item** WDV-01 · **Owner lane** B · **Blocked by** CFD-06

**Summary.** Add `"workers_dev": true` to `apps/api/wrangler.jsonc` so the hostname the shipped mobile app depends on is a declared fact rather than an inferred default.

**Problem.** The config declares neither `routes` nor `workers_dev`. Cloudflare infers `workers_dev = false` the moment a `routes` array appears. A future change that adds a custom domain — a diff that reads as an improvement — would silently remove `hlada-api-staging.straumvakt.workers.dev`.

**Evidence.** `apps/api/wrangler.jsonc` has no `workers_dev` key. `apps/mobile/lib/api/client.dart` pins `https://hlada-api-staging.straumvakt.workers.dev`. By contrast `wrangler.jsonc:67` (web) sets `workers_dev: true` explicitly.

**Proposed action.** Add the key to the relevant environment block. Do not add routes in the same change.

**Exact command / checklist.** Edit the file on a branch, then `npx wrangler deploy --dry-run --config apps/api/wrangler.jsonc` and confirm the output still lists the workers.dev host.

**Mutation / approval.** `LOCAL` to commit. Deploying is `EXT` + `APPROVAL`.

**Tests / validation.** Dry run only. No deploy.

**Rollback.** Revert the commit. The deployed state is unchanged until someone deploys.

**Acceptance.** The key is present; the dry run shows the host retained; the release-manifest validator's rule R4 can now be satisfied for this Worker.

**Risk if ignored.** Every user of the shipped mobile app loses API access at the moment an unrelated routing change is deployed, with no client-side fix available.

---

### ISS-02 — Declare `workers_dev` explicitly in the gateway Worker config
**Work item** WDV-02 · **Owner lane** B · **Blocked by** CFD-07

**Summary.** Same change as ISS-01, for `gateway/wrangler.jsonc`.

**Problem.** The gateway carries the identical latent condition. Its clients are not phones but chargers, and charger configuration is not in this repository, so the recovery path is slower and less certain.

**Evidence.** `gateway/wrangler.jsonc` declares neither `routes` nor `workers_dev`. The Worker terminates OCPP WebSockets.

**Proposed action.** Add `"workers_dev": true`.

**Exact command / checklist.** `npx wrangler deploy --dry-run --config gateway/wrangler.jsonc`.

**Mutation / approval.** `LOCAL`.

**Tests / validation.** Dry run.

**Rollback.** Revert.

**Acceptance.** Key present; dry run retains the host.

**Risk if ignored.** A routing change disconnects the charger fleet. Chargers do not reconnect to a hostname that no longer resolves, and reconfiguring them is a physical or vendor-portal operation.

---

### ISS-03 — Add an offline linter that fails when routes are added without `workers_dev`
**Work item** WDV-03 · **Owner lane** B · **Blocked by** ISS-01, ISS-02

**Summary.** Encode the foot-gun as an automated check rather than as institutional memory.

**Problem.** The risk is a small, reasonable-looking diff approved by a reviewer who has not read this appendix.

**Evidence.** Two of three Worker configs currently exhibit the condition.

**Proposed action.** A Node script beside the manifest validator that parses the three wrangler configs and fails when any environment declares `routes` without an explicit `workers_dev`.

**Exact command / checklist.** `node scripts/analysis/lint/lint-wrangler.mjs --self-test`

**Mutation / approval.** `LOCAL`.

**Tests / validation.** Fixtures for: routes with `workers_dev: true`; routes with `workers_dev: false`; routes with neither (must fail); neither key.

**Rollback.** Delete the script.

**Acceptance.** Self-test passes; running it against the current configs fails until ISS-01 and ISS-02 land, then passes.

**Risk if ignored.** The check exists only in a document, which is where checks go to be forgotten.

---

### ISS-04 — Create a scoped read-only Cloudflare API token
**Work item** CFA-01 · **Owner lane** H · **Blocked by** —

**Summary.** Create one custom token with Read permissions only, scoped to the Straumvakt account, with a 7-day TTL.

**Problem.** Seven control-plane facts are blocked. Without credentials the release programme cannot record a rollback target, and a release without a rollback target is a one-way door.

**Evidence.** `wrangler whoami` returns unauthenticated. No `CLOUDFLARE_*` variable exists in this environment.

**Proposed action.** dash.cloudflare.com → My Profile → API Tokens → Create Token → Custom token. Permissions: Workers Scripts:Read, Workers KV:Read, Workers Tail:Read, Workers R2:Read, Account Settings:Read, D1:Read, Hyperdrive:Read, Zone:Read, DNS:Read, SSL and Certificates:Read. Account Resources → Include → the Straumvakt account only. TTL 7 days.

**Exact command / checklist.** Appendix E CL-01. Verify with `curl -sH "Authorization: Bearer $RO" https://api.cloudflare.com/client/v4/user/tokens/verify`.

**Mutation / approval.** `EXT` + `APPROVAL`. Only Andri can create it.

**Tests / validation.** Verify returns `"status":"active"`. A deliberate `PUT` to a Worker script returns 403.

**Rollback.** Delete the token. Instant, no side effects.

**Acceptance.** Verify passes; the write test is rejected; the token is stored outside every repository.

**Risk if ignored.** All seven facts stay blocked and no production release can be validated.

---

### ISS-05 — Prove the read-only token cannot deploy
**Work item** CFA-06 · **Owner lane** B · **Blocked by** ISS-04

**Summary.** Run one deliberately-failing write call and record the rejection.

**Problem.** The entire safety case for a logged-in evidence session rests on the token being read-only. That is currently an assumption about a form someone filled in.

**Evidence.** Token permissions are chosen by hand and are easy to over-grant.

**Proposed action.** Issue a `PUT` to a Worker script endpoint with no body and observe the failure.

**Exact command / checklist.** `curl -s -o /dev/null -w '%{http_code}\n' -X PUT -H "Authorization: Bearer $RO" "https://api.cloudflare.com/client/v4/accounts/$ACC/workers/scripts/hlada-staging"`

**Mutation / approval.** `RO` in effect — the call is rejected before it changes anything.

**Tests / validation.** Expect 403 with an authentication-class error, not 400.

**Rollback.** None needed.

**Acceptance.** 403 recorded in the evidence bundle with a timestamp.

**Risk if ignored.** An over-granted token in a browser session is one mis-click from a deploy.

---

### ISS-06 — Capture Worker version IDs for all three Workers
**Work item** CFD-02, CFD-03, CFD-04, CFI-02 · **Owner lane** B · **Blocked by** ISS-04

**Summary.** Record the current and previous version identifier for `hlada-staging`, `hlada-api-staging`, and `straumvakt-ocpp-staging`.

**Problem.** No Worker version id has ever been recorded. The release-manifest validator rejects any release with no `workerVersionsBefore`, correctly, because such a release has no rollback target.

**Evidence.** Rule R1 in `validate-release-manifest.mjs`; fixture `no-rollback-target.invalid.json` is rejected with exactly this message.

**Proposed action.** Capture via API and dashboard, save as JSON, hash the file.

**Exact command / checklist.** `curl -sH "Authorization: Bearer $RO" ".../accounts/$ACC/workers/scripts/$NAME/versions" | jq '.result[] | {id, number, created_on}'` for each name.

**Mutation / approval.** `RO`.

**Tests / validation.** Every id matches the 36-character UUID form. A manifest populated from the result passes rule R1.

**Rollback.** None.

**Acceptance.** Three files in the evidence bundle, hashed, and a draft manifest that validates.

**Risk if ignored.** Any deploy that goes wrong cannot be undone except by rebuilding and redeploying, during which the product is down.

---

### ISS-07 — Capture the Git integration owner for each Worker
**Work item** CFD-08, CPS-01 · **Owner lane** B · **Blocked by** ISS-04

**Summary.** Determine which repository and branch, if any, deploys each Worker.

**Problem.** This is the only blocked fact with no CLI equivalent, and it determines whether merging a branch is also a deployment. Until it is answered, `origin/staging` must be treated as a live production deploy pointer.

**Evidence.** CPMS declares the same Worker names (`wrangler.jsonc:3,32`). CPMS renamed `straumvakt` to `hlada` on 2026-04-19; Straumvakt inherited the names on 2026-04-24.

**Proposed action.** Dashboard → each Worker → Settings → Build → Git repository. Record owner, repository, production branch, build command, and whether builds are enabled.

**Exact command / checklist.** Appendix E CL-03. Screenshot required.

**Mutation / approval.** `RO`. Do not disconnect anything.

**Tests / validation.** Each Worker attributed to exactly one repository.

**Rollback.** None.

**Acceptance.** A definitive owner per Worker; a CPMS-owned integration becomes production no-go NG-04.

**Risk if ignored.** A merge in another project silently redeploys this one, or a merge here deploys when nobody expected it to.

---

### ISS-08 — Unset the upstream on `dev/rename-prod-worker`
**Work item** GBS-01 · **Owner lane** H · **Blocked by** —

**Summary.** Remove the tracking relationship between this local branch and `origin/staging`.

**Problem.** The branch tracks `origin/staging` and carries commit `4fe0a95`, which the standing rules forbid from any release candidate. A bare `git push` from that branch would place the forbidden commit on the branch serving the brand domain.

**Evidence.** `git for-each-ref` shows the upstream. `origin/staging` is currently `f53fb55e1229`. The brand domain is live and serving.

**Proposed action.** One command. The branch, its commits, and the remote are all untouched.

**Exact command / checklist.** `git branch --unset-upstream dev/rename-prod-worker`

**Mutation / approval.** `LOCAL` + `APPROVAL`.

**Tests / validation.** `git rev-parse --abbrev-ref dev/rename-prod-worker@{u}` fails. `git ls-remote --heads origin | wc -l` still reports 16.

**Rollback.** `git branch -u origin/staging dev/rename-prod-worker` restores it exactly.

**Acceptance.** No upstream; no remote ref changed; the branch content is byte-identical.

**Risk if ignored.** One reflexive `git push` publishes a forbidden commit to a branch that may be a deploy trigger.

---

### ISS-09 — Unset the upstream on `dev/secret-hygiene-v2`
**Work item** GBS-02 · **Owner lane** H · **Blocked by** —

**Summary.** As ISS-08, for the second branch with the same configuration.

**Problem.** Identical one-keystroke failure mode.

**Evidence.** Same `for-each-ref` output.

**Proposed action.** `git branch --unset-upstream dev/secret-hygiene-v2`

**Exact command / checklist.** As above.

**Mutation / approval.** `LOCAL` + `APPROVAL`.

**Tests / validation.** Upstream lookup fails; remote ref count unchanged.

**Rollback.** Re-set the upstream.

**Acceptance.** As ISS-08.

**Risk if ignored.** As ISS-08.

---

### ISS-10 — Audit every local branch's upstream across every worktree
**Work item** GBS-03 · **Owner lane** B · **Blocked by** —

**Summary.** Find every branch whose upstream is a deploy-relevant remote branch.

**Problem.** Two were found by inspection. Nobody has checked the rest, and three agents create branches continuously.

**Evidence.** Six active worktrees: release-candidate `4b69d0f`, onboarding-domain `4dea004`, onboarding-web `7a25fa5`, driver-access-ui `ad5d8c7`, n1 `52e3b32`, beta-production `31ce40b`, plus the canonical checkout on `dev/straumvakt-org-relaunch`.

**Proposed action.** Enumerate and flag.

**Exact command / checklist.** `git for-each-ref --format='%(refname:short) -> %(upstream:short)' refs/heads` in each worktree.

**Mutation / approval.** `RO`. Change nothing without approval.

**Tests / validation.** Output covers every branch in every worktree.

**Rollback.** None.

**Acceptance.** A table; every branch tracking `staging` or `main` is listed for an ISS-08-style fix.

**Risk if ignored.** The two known cases are treated as the whole problem.

---

### ISS-11 — Enable branch protection on the deploy pointer branch
**Work item** GBS-07 · **Owner lane** H · **Blocked by** ISS-12

**Summary.** Create a ruleset on `staging` requiring a pull request and blocking force pushes and deletion.

**Problem.** `origin/staging` is treated as a production deploy pointer and has no protection at all. Zero of sixteen branches are protected and the ruleset list is empty.

**Evidence.** `gh api .../branches` shows no protection; `.../rulesets` returns `[]`.

**Proposed action.** Repository → Settings → Rules → Rulesets → New branch ruleset targeting `staging`. Enable: require pull request, block force pushes, restrict deletions, require linear history.

**Exact command / checklist.** Appendix E CL-27.

**Mutation / approval.** `EXT` + `APPROVAL`.

**Tests / validation.** A dry-run force push to `staging` is rejected by the server with a rule-violation message.

**Rollback.** Disable the ruleset. Instant.

**Acceptance.** Force push rejected; the bypass actor list is captured and short.

**Risk if ignored.** The branch that may trigger production deploys can be force-pushed or deleted by anyone with write access.

---

### ISS-12 — Capture the current GitHub protection state as evidence
**Work item** GBS-06 · **Owner lane** B · **Blocked by** —

**Summary.** Save the branch and ruleset API output before changing anything.

**Problem.** The current state is known from a single reading with no artifact behind it.

**Evidence.** The claim "0 of 16 protected" currently exists only as a sentence.

**Proposed action.** Capture and hash.

**Exact command / checklist.** `gh api repos/{owner}/{repo}/branches --paginate > gh-branches.json`; `gh api repos/{owner}/{repo}/rulesets > gh-rulesets.json`; hash both.

**Mutation / approval.** `RO`.

**Tests / validation.** Files parse as JSON; counts match the narrative.

**Rollback.** None.

**Acceptance.** Both files in the evidence bundle with hashes.

**Risk if ignored.** After protection is enabled nobody can show what it was before, which matters if something breaks.

---

### ISS-13 — Decide and record which branch is the trunk
**Work item** GBS-09 · **Owner lane** H · **Blocked by** —

**Summary.** Name one branch as the trunk and state every other branch's relationship to it.

**Problem.** The repository has a stale default branch and a separate deploy pointer. Neither is unambiguously the trunk, so new work branches from whatever the author happened to have checked out.

**Evidence.** Sixteen remote branches; the default is stale; `origin/staging` is the deploy pointer; 29 worktrees are registered across 43 local branches, of which only 16 exist on the remote.

**Proposed action.** Choose the trunk, record the promotion direction as trunk → staging → production with fast-forward only, and state it where A and X will read it.

**Exact command / checklist.** Record in AD-04 and in the repository README.

**Mutation / approval.** `RO` to decide; `EXT` + `APPROVAL` to repoint the default.

**Tests / validation.** A fresh clone checks out the trunk.

**Rollback.** Change the default back; open pull requests retarget automatically.

**Acceptance.** One named trunk; every worktree's ahead/behind count against it recorded.

**Risk if ignored.** Release candidates are assembled from whichever branch someone believes is current.

---

### ISS-14 — Add a pre-push hook that refuses pushes to `staging` and `main`
**Work item** GBS-05 · **Owner lane** H · **Blocked by** —

**Summary.** Local defence against the class of mistake that ISS-08 addresses one instance of.

**Problem.** Unsetting two upstreams fixes two branches. A hook fixes the behaviour.

**Evidence.** Three agents share the repository and create branches continuously.

**Proposed action.** A `pre-push` hook that exits non-zero when the destination ref is `refs/heads/staging` or `refs/heads/main`, with an override environment variable for deliberate use.

**Exact command / checklist.** Write the hook, then `git push --dry-run origin HEAD:staging` and confirm refusal.

**Mutation / approval.** `LOCAL` + `APPROVAL`.

**Tests / validation.** Dry-run push refused; a push to any other branch is unaffected.

**Rollback.** Delete the hook file.

**Acceptance.** Refusal demonstrated; other pushes unaffected.

**Risk if ignored.** Server-side protection (ISS-11) is the only backstop, and it does not exist yet.

---

### ISS-15 — Scrub the committed `AUTH_SECRET` from the working tree
**Work item** GBS-16 · **Owner lane** A · **Blocked by** —

**Summary.** Replace the real value in `.env.example` with an obvious placeholder.

**Problem.** A real `AUTH_SECRET` is committed in a public repository. It has been verified as not live on the API Worker, but that was a point-in-time check and the value remains readable.

**Evidence.** The value is in git history. Login is served by `hlada-api-staging`, not `hlada-staging`.

**Proposed action.** Replace with `AUTH_SECRET=replace-me-generate-with-openssl-rand-base64-32`.

**Exact command / checklist.** Edit the file on a branch; run the secret scan from ISS-16.

**Mutation / approval.** `LOCAL`. History rewriting is a separate decision and is not part of this issue.

**Tests / validation.** The secret scanner no longer matches the working tree; it still matches history, which is the point of the separate decision.

**Rollback.** Revert.

**Acceptance.** Working tree clean; a note recorded that history still contains the value and rotation is the only real remedy.

**Risk if ignored.** The value stays trivially discoverable, and its non-liveness is an assumption that ages.

---

### ISS-16 — Add an offline secret scanner to the linter set
**Work item** GBS-17, RMV-03 · **Owner lane** B · **Blocked by** —

**Summary.** Scan tracked files and generated artifacts for connection strings, tokens, and keys, with the known committed secret as a self-test.

**Problem.** This project has already committed one real secret. The failure class is proven present, not hypothetical.

**Evidence.** `.env.example` in history.

**Proposed action.** A Node script matching `postgres(ql)?://`, `npg_`, bearer-shaped strings, and long base64 runs, with an allowlist for documentation placeholders such as `user:pw@host`.

**Exact command / checklist.** `node scripts/analysis/lint/lint-secrets.mjs --self-test`

**Mutation / approval.** `LOCAL`.

**Tests / validation.** A fixture containing the known secret shape is detected; a fixture containing `postgres://user:pw@host/db` in prose is not.

**Rollback.** Delete the script.

**Acceptance.** Self-test passes; running it across `docs/notes` and `scripts/analysis` reports clean.

**Risk if ignored.** The next secret is committed the same way as the last one.

---

### ISS-17 — Protect the Neon branch that beta actually uses
**Work item** NPR-03 · **Owner lane** H · **Blocked by** ISS-18

**Summary.** Enable branch protection on `br-tiny-river-abgpqq37`.

**Problem.** No Neon branch is protected. The branch carrying real beta data — including real users' personal data — can be deleted from the console in two clicks.

**Evidence.** One project, thirteen branches, none protected, seven-day PITR ceiling.

**Proposed action.** Neon console → Branches → the branch → Protect.

**Exact command / checklist.** Appendix E CL-30.

**Mutation / approval.** `EXT` + `APPROVAL`.

**Tests / validation.** Attempting deletion in the console is refused.

**Rollback.** Unprotect.

**Acceptance.** Protection visible in the console; a screenshot in the evidence bundle.

**Risk if ignored.** An accidental branch deletion loses beta data beyond what a seven-day window can necessarily recover, because recovery also requires noticing within seven days.

---

### ISS-18 — Record which Neon branch each environment actually uses
**Work item** NPR-02 · **Owner lane** B · **Blocked by** ISS-04

**Summary.** Map every environment to an explicit `br-` identifier.

**Problem.** The project's default branch is abandoned. Any tool, script, or connection string that omits a branch identifier reaches the wrong data. This has already caused wrong-branch reads in this project.

**Evidence.** The default-branch trap is a recorded finding; staging uses `br-tiny-river-abgpqq37`.

**Proposed action.** Cross-reference Hyperdrive origin hosts and Worker secret names against the Neon branch endpoint list.

**Exact command / checklist.** Neon console metadata plus Cloudflare Hyperdrive config from ISS-19.

**Mutation / approval.** `RO`. Metadata only, no SQL.

**Tests / validation.** Every environment has an explicit branch id; none relies on the default.

**Rollback.** None.

**Acceptance.** A table; any environment relying on the default is a finding with its own issue.

**Risk if ignored.** A migration or a read lands on the abandoned branch and nobody notices until the data disagrees.

---

### ISS-19 — Capture the Hyperdrive configuration and its origin
**Work item** CFD-13, CFI-09 · **Owner lane** B · **Blocked by** ISS-04

**Summary.** Record Hyperdrive id, origin host, database name, and caching mode.

**Problem.** Hyperdrive sits between the Worker and Postgres. If it points at the wrong Neon branch, application code cannot tell — the queries succeed against the wrong data.

**Evidence.** Blocked fact F4.

**Proposed action.** `GET /accounts/{id}/hyperdrive/configs`. The password is not returned by the API, which is the correct behaviour and must not be worked around.

**Exact command / checklist.** Appendix E CL-05.

**Mutation / approval.** `RO`.

**Tests / validation.** Origin host matches the branch identified in ISS-18.

**Rollback.** None.

**Acceptance.** Config captured; the origin either matches the intended branch or a mismatch issue is opened.

**Risk if ignored.** The most invisible possible data bug: correct code, correct queries, wrong database.

---

### ISS-20 — Capture Queue and dead-letter depths
**Work item** CFD-12, CFI-10 · **Owner lane** B · **Blocked by** ISS-04

**Summary.** Record every queue, its consumer, its backlog, and its dead-letter depth with a timestamp.

**Problem.** A non-zero dead-letter depth is unprocessed work. A cutover strands it, and nobody currently knows whether any exists.

**Evidence.** Blocked fact F7.

**Proposed action.** Dashboard for depths, API for topology.

**Exact command / checklist.** Appendix E CL-05.

**Mutation / approval.** `RO`. Never purge.

**Tests / validation.** Depths recorded with a timestamp so a later reading is comparable.

**Rollback.** None.

**Acceptance.** A per-queue row; any non-zero dead-letter depth becomes a production no-go input.

**Risk if ignored.** A cutover discards work that a customer is waiting on.

---

### ISS-21 — Capture Durable Object namespace identifiers
**Work item** CFD-11, CFI-11, OCG-07 · **Owner lane** B · **Blocked by** ISS-04

**Summary.** Record the namespace id for every Durable Object binding, particularly `IDENTITY_DO`.

**Problem.** Charger identity lives in a Durable Object namespace. A cutover that creates a new namespace rather than binding the existing one loses every charger's identity silently — the chargers connect and are treated as unknown.

**Evidence.** Blocked fact F6; the gateway binds `IDENTITY_DO`.

**Proposed action.** `GET /accounts/{id}/workers/durable_objects/namespaces` plus each Worker's bindings.

**Exact command / checklist.** Appendix E CL-04.

**Mutation / approval.** `RO`. Never delete a namespace.

**Tests / validation.** The `IDENTITY_DO` namespace id is recorded and appears in the gateway release manifest.

**Rollback.** None.

**Acceptance.** Namespace id captured.

**Risk if ignored.** Every charger has to be re-onboarded, in the field.

---

### ISS-22 — Capture the edge certificate SAN list and close the `www` gap
**Work item** CFD-16, PCR-06 · **Owner lane** B · **Blocked by** ISS-04

**Summary.** Record the certificate hosts and decide what to do about `www` being absent from the apex SAN.

**Problem.** `www.straumvakt.org` is not covered. Anyone typing or linking the `www` form gets a TLS error, which reads to a user as the site being compromised rather than merely misconfigured.

**Evidence.** Confirmed absent from the apex SAN.

**Proposed action.** Capture the SAN list; then either add coverage or add a redirect from a covered host.

**Exact command / checklist.** Zone → SSL/TLS → Edge Certificates; screenshot the hosts list.

**Mutation / approval.** `RO` to capture; adding coverage is `EXT` + `APPROVAL`.

**Tests / validation.** `curl -vI https://www.straumvakt.org` before and after.

**Rollback.** Remove the added hostname.

**Acceptance.** SAN list captured; the gap has an owner and a decision.

**Risk if ignored.** A share of visitors see a browser security warning on the brand domain.

---

### ISS-23 — Design the web-to-API service binding
**Work item** SZB-03 · **Owner lane** B + A · **Blocked by** ISS-24

**Summary.** Replace the plain-HTTPS call from the web Worker to the API Worker with a service binding.

**Problem.** Of four Worker-to-Worker paths, three use service bindings and exactly one — web to API — uses plain HTTPS. That one depends on `api.straumvakt.org` being a Custom Domain. If it ever becomes a route on the same zone, the request loops back to the calling Worker instead of reaching the API, and the symptom is a hanging or 500-ing page.

**Evidence.** `gateway/wrangler.jsonc:64-65` binds `MAIN_APP`; the web Worker fetches the API over HTTPS.

**Proposed action.** Add an `API` service binding to the web Worker config and route the call through `env.API.fetch`, behind a configuration switch so the HTTPS path remains available.

**Exact command / checklist.** Local multi-Worker `wrangler dev`; exercise both paths.

**Mutation / approval.** `LOCAL` to build; deploying is `EXT` + `APPROVAL`.

**Tests / validation.** Both paths return identical responses locally. Header, cookie, and origin behaviour is verified explicitly — a binding call is not a browser request.

**Rollback.** Flip the switch back to HTTPS. No deploy required.

**Acceptance.** Binding works locally; the switch is proven in both positions; ISS-24's header audit shows no dependency broken.

**Risk if ignored.** A routing change turns the entire product into a blank page, with a cause that looks nothing like the change that produced it.

---

### ISS-24 — Audit the API's dependency on request Host, Origin, and cookies
**Work item** SZB-04, SZB-05 · **Owner lane** B · **Blocked by** —

**Summary.** Find every place the API reads a request header that a service binding would change.

**Problem.** A service binding call does not traverse the edge and does not look like a browser request. Auth checks, CORS logic, and session cookie handling can all depend on that.

**Evidence.** The binding change in ISS-23 cannot be assessed without this.

**Proposed action.** Grep `apps/api/src` for reads of `host`, `origin`, `referer`, `cf-connecting-ip`, and cookie parsing.

**Exact command / checklist.** Record each hit as file:line with a statement of behaviour under a binding.

**Mutation / approval.** `RO`.

**Tests / validation.** Every hit is classified as safe, needs-forwarding, or blocking.

**Rollback.** None.

**Acceptance.** A complete list; A confirms the classification.

**Risk if ignored.** The binding change appears to work and then fails for authenticated users only.

---

### ISS-25 — Promote OCPP continuity from a warning to an error for gateway releases
**Work item** RMV-01, OCG-03 · **Owner lane** B · **Blocked by** —

**Summary.** Make `ocpp.endpointUnchanged` a required, true-or-explicitly-justified field when the release includes a Worker with role `ocpp`.

**Problem.** Rule R7 currently only warns. The highest-consequence omission in the whole manifest is the one that merely prints a line.

**Evidence.** `validate-release-manifest.mjs` policy function, rule R7.

**Proposed action.** Add rule R3: error when any Worker has role `ocpp` and `ocpp.endpointUnchanged` is not explicitly `true`.

**Exact command / checklist.** `node scripts/analysis/manifest/validate-release-manifest.mjs --self-test`

**Mutation / approval.** `LOCAL`.

**Tests / validation.** A new invalid fixture with a gateway Worker and no OCPP statement is rejected; existing fixtures still pass.

**Rollback.** Revert.

**Acceptance.** Self-test count rises and passes.

**Risk if ignored.** A gateway release proceeds without anyone stating, in writing, that field devices are unaffected.

---

### ISS-26 — Add a rule requiring a measured restore time for production
**Work item** RMV-07 · **Owner lane** B · **Blocked by** ISS-27

**Summary.** `rollback.restoreTimeMeasuredSec` must be present and non-null for production releases.

**Problem.** A rollback plan with an unmeasured duration is an estimate wearing a plan's clothes. During an incident the difference between two minutes and forty is the difference between rolling back and pressing on.

**Evidence.** The field exists in the schema and has never been populated.

**Proposed action.** Add the policy rule; populate the field from the ISS-27 rehearsal.

**Exact command / checklist.** Self-test.

**Mutation / approval.** `LOCAL`.

**Tests / validation.** Production fixture without the field is rejected; beta fixture without it still passes.

**Rollback.** Revert.

**Acceptance.** Rule active with fixtures either side.

**Risk if ignored.** Rollback decisions are made on a guess at the worst possible moment.

---

### ISS-27 — Rehearse a Neon restore and measure it
**Work item** NBK-04, NBK-05 · **Owner lane** H · **Blocked by** ISS-17

**Summary.** On a throwaway branch, apply a harmless migration, restore to before it, and record the elapsed seconds.

**Problem.** The realistic database disaster is a migration, not a disk failure, and nobody has ever performed the recovery.

**Evidence.** `restoreTimeMeasuredSec` has no measurement behind it. PITR is capped at seven days.

**Proposed action.** Create a throwaway branch. Apply a trivial migration. Restore to a point before it. Connect and verify the schema. Record the time. Delete the throwaway branch.

**Exact command / checklist.** Appendix E CL-36. Never against beta or production data.

**Mutation / approval.** `EXT` + `APPROVAL`. Creates and deletes a Neon branch.

**Tests / validation.** Schema returns to its prior state; the application's own health checks pass against the restored branch.

**Rollback.** Delete the rehearsal branch; nothing else was touched.

**Acceptance.** A measured number, and a written note of everywhere the endpoint must be repointed afterwards.

**Risk if ignored.** The first restore is performed for real, under pressure, by someone who has never done it.

---

### ISS-28 — Establish deliberate backup branches as the long-horizon recovery
**Work item** NBK-03, NPR-16 · **Owner lane** B · **Blocked by** —

**Summary.** Adopt a naming convention and require a backup branch before every schema change.

**Problem.** Point-in-time recovery is capped at seven days. Beyond that, only branches created on purpose exist. Neon branches are copy-on-write, so this is nearly free and is the only cheap undo the project has.

**Evidence.** Seven-day retention; thirteen branches, none created as deliberate backups.

**Proposed action.** Convention `backup-YYYY-MM-DD-<reason>`; populate `backupBranchId` in the release manifest; consider promoting rule R9 from warning to error for production.

**Exact command / checklist.** Appendix E CL-35.

**Mutation / approval.** `RO` to define; creating branches is `EXT` + `APPROVAL`.

**Tests / validation.** A production manifest without `backupBranchId` warns today and errors once R9 is promoted.

**Rollback.** None needed.

**Acceptance.** Convention recorded; retention rule stated so backups do not become permanent clutter.

**Risk if ignored.** A problem noticed on day eight is unrecoverable.

---

### ISS-29 — Resolve the money-unit contradiction before any billing
**Work item** NPR-17 · **Owner lane** A · **Blocked by** —

**Summary.** Establish one authoritative monetary unit and fix every boundary in a single commit.

**Problem.** `apps/api/src/lib/tariff/compute-session-cost.ts:13-21` documents the unit as aurar — one hundredth of a króna. A comment in the session repository claims ISK has no minor unit and conversion is the identity. **Two mismatches currently cancel. Fixing either one alone breaks everything by a factor of one hundred.** I previously repeated the repository comment's claim in an audit; the costing engine is authoritative and the correction stands.

**Evidence.** The two files above, and the corrected finding recorded in the remediation index.

**Proposed action.** A owns this. Declare the unit once. Change every conversion boundary in one commit. Add a test that fails if either side is changed alone.

**Exact command / checklist.** A's test suite; the test must assert the round trip, not just one direction.

**Mutation / approval.** `LOCAL` for the fix.

**Tests / validation.** A property test over representative tariffs and energies; a deliberate one-sided change must fail it.

**Rollback.** Revert the single commit.

**Acceptance.** One unit declared; a test that cannot pass with a one-sided change; the independent hand calculation in ISS-30 agrees.

**Risk if ignored.** Customers are billed one hundred times too much or too little, and the error is invisible in code review because the two bugs cancel.

---

### ISS-30 — First real charge with an independent cost check
**Work item** BER-07 · **Owner lane** H · **Blocked by** ISS-29

**Summary.** Perform one real charging session and compare the system's cost against a cost computed by hand.

**Problem.** A factor-of-one-hundred unit error cannot be caught by any test that uses the same conversion the code uses. It can only be caught by an independent calculation.

**Evidence.** ISS-29.

**Proposed action.** Record energy delivered, the applicable tariff, the expected cost computed by hand, and the system's figure. Compare to the aurar.

**Exact command / checklist.** Appendix K rehearsal BR-06.

**Mutation / approval.** `EXT` + `APPROVAL`. Real hardware, real energy, potentially a real customer.

**Tests / validation.** The two figures agree exactly.

**Rollback.** Do not bill. Correct and repeat.

**Acceptance.** Agreement to the aurar. Any hundredfold discrepancy stops the beta programme immediately.

**Risk if ignored.** The first evidence of a billing error is a customer complaint.

---

### ISS-31 — Stop rendering `powerKw: 0` as a measurement
**Work item** NPR-18 · **Owner lane** A + X · **Blocked by** —

**Summary.** Either populate the field or remove it from the contract; do not ship a plausible-looking zero.

**Problem.** `apps/api/src/repositories/driver-sessions.ts:135` hardcodes `powerKw: 0`, and lines 89-98 coerce null to zero. A user reading zero kilowatts believes the charger is delivering nothing.

**Evidence.** The two code locations above.

**Proposed action.** A decides whether a real value is available. If it is not, the field is absent or explicitly null and X renders "unavailable" rather than a number.

**Exact command / checklist.** API contract change plus the corresponding UI state.

**Mutation / approval.** `LOCAL`.

**Tests / validation.** A contract test asserting the field is never a fabricated zero.

**Rollback.** Revert.

**Acceptance.** No surface displays zero as a measured power.

**Risk if ignored.** The product tells users something false about physical equipment.

---

### ISS-32 — Copy `docs/OCPP` out and hash-verify before any cleanup
**Work item** CLP-01 · **Owner lane** H · **Blocked by** —

**Summary.** Preserve 128 untracked files containing official OCPP 1.6, 2.0.1, and 2.1 specifications.

**Problem.** They are untracked in a git repository. One `git clean -fdx` removes them permanently, and they are the reference for every protocol decision the project makes.

**Evidence.** 128 files present and untracked in the canonical checkout.

**Proposed action.** Copy to a location outside `E:\Claude`, hash both sides, compare.

**Exact command / checklist.** Appendix E CL-45. `Get-FileHash -Algorithm SHA256` on both trees; compare counts and hashes.

**Mutation / approval.** `LOCAL` + `APPROVAL`. Copy only. Nothing is deleted.

**Tests / validation.** 128 files on both sides; every hash matches.

**Rollback.** The originals are untouched throughout.

**Acceptance.** Counts and hashes match; the copy is outside the tree that cleanup will touch.

**Risk if ignored.** The protocol reference is one careless command from gone, with re-acquisition depending on third-party availability.

---

### ISS-33 — Back up the prompt and evidence folder properly
**Work item** CLP-05 · **Owner lane** H · **Blocked by** —

**Summary.** The folder driving this entire programme has a git repository with zero commits.

**Problem.** `C:\Users\Andri\Documents\New project` contains `.git`, **zero commits, zero tracked files**, and 160 untracked entries at the top level. It has the appearance of version control and none of the substance. It holds the coordinator ledger, 28 prompt documents, and the evidence that drives all three agents. This is a correction to the earlier finding, which recorded the folder as merely unbacked — the truth is worse, because the presence of `.git` invites the assumption that it is safe.

**Evidence.** `git log` reports "your current branch 'master' does not have any commits yet". `git ls-files` is empty. 22,759 files total, of which the load-bearing content is a few dozen markdown documents; the rest is tool caches (`.jadx-1.5.5`, `.zaptec-apk`, `.zaptec-jadx`, `cache/`).

**Proposed action.** Add a `.gitignore` covering the tool caches and binary artifacts, then make the first commit containing the prompts, the coordinator ledger, and the evidence documents.

**Exact command / checklist.** Appendix E CL-48.

**Mutation / approval.** `LOCAL` + `APPROVAL`. Nothing is deleted; the ignore file only affects what git tracks.

**Tests / validation.** `git log --oneline` shows at least one commit; the 28 top-level markdown files are tracked; `git status` reports tens of untracked entries rather than tens of thousands.

**Rollback.** The files are untouched either way; the commit can be discarded.

**Acceptance.** First commit exists and includes the coordinator ledger.

**Risk if ignored.** The programme's own instructions and cross-agent record have no recovery path at all.

---

### ISS-34 — Run the cleanup dry-run and record a baseline
**Work item** CDA-01, CDA-05 · **Owner lane** B · **Blocked by** —

**Summary.** Produce a dated, correct measurement of `E:\Claude` before anything changes.

**Problem.** The first measurement of this tree followed junctions, double-counted shared `node_modules`, and produced impossible figures — negative real content and more reclaimable space than the tree contained. The corrected figures are 43.76 GB total, 41.57 GB regenerable, 2.25 GB real content.

**Evidence.** The correction is recorded in the script header rather than silently applied; sizes deliberately exclude reparse points.

**Proposed action.** Run the script with an output path outside `E:\Claude`. The script refuses an inside path by design.

**Exact command / checklist.** `pwsh -File scripts/analysis/cleanup/cleanup-dryrun.ps1 -OutFile "C:\Users\Andri\Documents\cleanup-manifest-2026-08-09.txt"`

**Mutation / approval.** `RO`. The script contains no delete verb; verify by grep before every run.

**Tests / validation.** Every preservation target reports PRESENT. Figures reproduce the corrected measurement.

**Rollback.** Delete the manifest file.

**Acceptance.** A dated baseline outside the tree; no `*** MISSING ***` line.

**Risk if ignored.** Cleanup proceeds against figures that were wrong the first time.

---

### ISS-35 — Add a non-zero exit code when a preservation target is missing
**Work item** CDA-03 · **Owner lane** B · **Blocked by** —

**Summary.** Make the dry-run script's preservation check impossible to skim past.

**Problem.** It currently prints `*** MISSING ***` inside a long report. A human running it at the end of a session will miss a line.

**Evidence.** The script's section 1 output format.

**Proposed action.** Track missing targets and `exit 1` at the end.

**Exact command / checklist.** Run with a deliberately wrong path in the list and confirm a non-zero exit.

**Mutation / approval.** `LOCAL`.

**Tests / validation.** Exit code 1 with a missing target; 0 when all present.

**Rollback.** Revert.

**Acceptance.** Exit code behaviour demonstrated both ways.

**Risk if ignored.** The tripwire exists but nothing trips on it.

---

### ISS-36 — Verify a regenerable directory actually regenerates
**Work item** CDA-07, CDA-08 · **Owner lane** B · **Blocked by** —

**Summary.** Prove `node_modules` and Flutter build outputs can be rebuilt before treating them as disposable.

**Problem.** 95% of the tree is classified as regenerable. That classification assumes lockfiles resolve and registries are reachable — including for pinned versions that may have been unpublished.

**Evidence.** 41.57 GB of the 43.76 GB total is build output.

**Proposed action.** For one worktree, run a clean install into a temporary location and confirm success. Repeat for the Flutter app.

**Exact command / checklist.** `npm ci` into a copy; `flutter pub get` in a copy. Never delete the original first.

**Mutation / approval.** `LOCAL`.

**Tests / validation.** Install succeeds and the application builds.

**Rollback.** Delete the temporary install.

**Acceptance.** Regeneration demonstrated, or the classification is revised and those directories move to the preservation list.

**Risk if ignored.** "Regenerable" turns out to mean "was regenerable in April".

---

### ISS-37 — Unlink junctions with `rmdir`, never with a recursive delete
**Work item** CLP-11, CLP-12, CDA-09 · **Owner lane** H · **Blocked by** ISS-34

**Summary.** Five cross-worktree junctions must be unlinked before any pruning, using the one command that does not follow them.

**Problem.** `Remove-Item -Recurse` can traverse a junction and delete the target rather than the link. The same following behaviour is what produced the impossible measurement figures, so the failure mode is demonstrated, not theoretical.

**Evidence.** The dry-run script enumerates junctions in required unlink order and prints the warning immediately above the command.

**Proposed action.** `cmd /c rmdir "<junction>"` for each, in the order the script emits, then re-run the dry run.

**Exact command / checklist.** Appendix E CL-46.

**Mutation / approval.** `DESTRUCT` + `APPROVAL`, although unlinking a junction is itself reversible.

**Tests / validation.** After each unlink, the target directory still exists with its original file count.

**Rollback.** Recreate the junction with `mklink /J`.

**Acceptance.** All junctions unlinked; every target intact; dry run still reports all preservation targets PRESENT.

**Risk if ignored.** A single recursive delete removes another worktree's dependencies, or worse, another agent's work.

---

### ISS-38 — Produce a verified archive before any deletion
**Work item** CLP-16, CDA-14 · **Owner lane** H · **Blocked by** ISS-32, ISS-33

**Summary.** Archive everything on the preservation list, hash every member, extract it to a temporary location, and confirm the hashes before anything is deleted.

**Problem.** A deletion whose recovery path is "we think we copied it" is not recoverable. An untested backup is a hypothesis.

**Evidence.** Twenty preservation records in Appendix G, several of which exist in exactly one place.

**Proposed action.** Create the archive outside `E:\Claude`, hash every member into a manifest, extract to a scratch location, re-hash, compare, discard the extraction.

**Exact command / checklist.** Appendix E CL-49.

**Mutation / approval.** `LOCAL` + `APPROVAL`.

**Tests / validation.** Every hash in the manifest verifies from the extracted copy.

**Rollback.** The originals are still present at this stage; that is the point of the ordering.

**Acceptance.** A verified archive and a deletion log mapping every future deletion to an archive member.

**Risk if ignored.** Deletion becomes irreversible in practice.

---

### ISS-39 — Retire worktrees with `git worktree remove`, never by deleting the directory
**Work item** CDA-10, CDA-11 · **Owner lane** H · **Blocked by** ISS-38

**Summary.** Only zero-unique, zero-dirty worktrees may be retired, and only with the proper command. Branches are never deleted.

**Problem.** Deleting the directory leaves the worktree registered and the repository in a confusing state. Deleting the branch as well throws away the cheap part to save nothing.

**Evidence.** Six active worktrees; the dry-run script reports which have zero unique commits against the release candidate, alongside their dirty counts.

**Proposed action.** For each candidate: confirm zero unique commits, confirm zero dirty files, then `git worktree remove`. The branch survives and the worktree can be recreated from it.

**Exact command / checklist.** Appendix E CL-50.

**Mutation / approval.** `DESTRUCT` + `APPROVAL`.

**Tests / validation.** `git worktree list` shows no stale entries; `git branch --list` still shows every branch.

**Rollback.** Recreate the worktree from the branch.

**Acceptance.** No branch deleted; no worktree with uncommitted work touched.

**Risk if ignored.** Another agent's uncommitted work disappears, or the repository accumulates stale worktree registrations.

---

### ISS-40 — Write the production wrangler environment blocks
**Work item** PCR-02 · **Owner lane** B · **Blocked by** ISS-41

**Summary.** Add production environments to all three Worker configs, each declaring `workers_dev` explicitly.

**Problem.** No production environment exists in any config. Writing them during a cutover is the worst possible time.

**Evidence.** All production Worker names currently return error 1042.

**Proposed action.** One environment block per Worker, with explicit `workers_dev`, explicit bindings, and no inherited defaults.

**Exact command / checklist.** `npx wrangler deploy --dry-run --env production` for each config.

**Mutation / approval.** `LOCAL`.

**Tests / validation.** All three dry runs succeed.

**Rollback.** Revert.

**Acceptance.** Three dry runs pass; every binding is explicit; no environment relies on inheritance.

**Risk if ignored.** Production configuration is invented under time pressure.

---

### ISS-41 — Decide the production Worker names against the CPMS collision
**Work item** PCR-01, CPS-04 · **Owner lane** H · **Blocked by** ISS-07

**Summary.** Choose production Worker names that no other project declares.

**Problem.** CPMS declares `hlada-staging` and `hlada-api-staging`. Two projects cannot own the same Worker name in one account, and the collision is inheritance rather than coincidence.

**Evidence.** CPMS `wrangler.jsonc:3,32`; the April rename history.

**Proposed action.** Decide which project keeps the `hlada` names. Record the decision. If Straumvakt renames, every dependant changes in one set: the gateway's `MAIN_APP` binding, the mobile client's pinned host, and any documentation.

**Exact command / checklist.** Appendix E CL-15.

**Mutation / approval.** `RO` to decide.

**Tests / validation.** No name is declared by both projects.

**Rollback.** Names can be changed again, but the workers.dev hostname changes with them, so each rename costs a mobile release.

**Acceptance.** One owner per name, recorded.

**Risk if ignored.** A CPMS deploy overwrites a Straumvakt Worker, or the production cutover collides at the worst moment.

---

### ISS-42 — Recognise that renaming a Worker changes its workers.dev hostname
**Work item** CPS-06 · **Owner lane** B · **Blocked by** ISS-41

**Summary.** State prominently in the rename plan that a rename breaks the shipped mobile app exactly as disabling workers.dev would.

**Problem.** The hostname is derived from the Worker name. The rename discussion has been framed as a naming-hygiene question; it is also a client-breaking change.

**Evidence.** `apps/mobile/lib/api/client.dart` pins the derived host.

**Proposed action.** Block the rename on a mobile release that no longer pins the old name, with an overlap window measured in app versions rather than days.

**Exact command / checklist.** Record in AD-08.

**Mutation / approval.** `RO`.

**Tests / validation.** The rename plan names the client change as a prerequisite.

**Rollback.** None needed.

**Acceptance.** Prerequisite recorded.

**Risk if ignored.** A hygiene change ships and every existing app installation stops working.

---

### ISS-43 — Enumerate every production secret before first deploy
**Work item** PCR-03 · **Owner lane** B + A · **Blocked by** ISS-44

**Summary.** Build the list of secret names production requires, from the beta bindings and from every `env.` read in the source.

**Problem.** A Worker that deploys without its secrets fails at first request, not at deploy time, so the failure appears after the cutover looks successful.

**Evidence.** Blocked fact F5 covers the beta secret names.

**Proposed action.** Cross-reference. Names only; values never appear in any artifact.

**Exact command / checklist.** Appendix E CL-04 plus a source grep for `env.` reads.

**Mutation / approval.** `RO`.

**Tests / validation.** Every name read by code appears in the list. Validator rule R5 rejects anything value-shaped.

**Rollback.** None.

**Acceptance.** A complete name list with no value present anywhere.

**Risk if ignored.** Production comes up and immediately 500s on the first authenticated request.

---

### ISS-44 — Capture the secret names bound to each beta Worker
**Work item** CFD-09, CFI-05 · **Owner lane** B · **Blocked by** ISS-04

**Summary.** Record names and types only.

**Problem.** The production secret list cannot be derived without knowing what beta actually has, and this is exactly the capture where a values leak is most likely.

**Evidence.** Blocked fact F5.

**Proposed action.** `GET .../scripts/{name}/secrets` returns names and types; the dashboard shows names with values hidden. Never click a reveal control.

**Exact command / checklist.** Appendix E CL-04, which includes the redaction rule.

**Mutation / approval.** `RO`.

**Tests / validation.** Every captured name matches `^[A-Z][A-Z0-9_]*$` and contains no `=`, `:`, or `/`. Rule R5 passes on the derived manifest.

**Rollback.** None.

**Acceptance.** Names captured; a secret scan of the evidence bundle reports clean.

**Risk if ignored.** Either the production list is guessed, or a value is captured into a document.

---

### ISS-45 — Decide whether production secrets are new values or copies of beta
**Work item** PCR-04 · **Owner lane** H · **Blocked by** ISS-43

**Summary.** Per-secret decision, with a strong default toward new values.

**Problem.** Copying a beta secret into production means one compromise affects both environments, and beta is by nature the less-guarded one.

**Evidence.** A real `AUTH_SECRET` from this project is already public in git history.

**Proposed action.** New values for anything granting access. Shared values only where an external provider forces it, and recorded as an accepted risk.

**Exact command / checklist.** Record in AD-07.

**Mutation / approval.** `RO` to decide; setting them is `EXT` + `APPROVAL`.

**Tests / validation.** No secret name appears with the same value in both environments unless explicitly recorded.

**Rollback.** Rotate.

**Acceptance.** A per-secret decision.

**Risk if ignored.** Beta becomes the attack path into production.

---

### ISS-46 — Define the production cutover order with verification between steps
**Work item** PCR-07, PCR-10 · **Owner lane** B · **Blocked by** —

**Summary.** Database ready, then API, then gateway if changed, then web, then domains — with a check that must pass before each next step.

**Problem.** Deploying the web app before the API means the web app briefly calls an API that is not there, and the resulting errors are indistinguishable from a broken deploy.

**Evidence.** Four Worker-to-Worker paths, one of which is a plain HTTPS call from web to API.

**Proposed action.** Write the order with a named verification per step and a rollback per step.

**Exact command / checklist.** Appendix E CL-44.

**Mutation / approval.** `RO` to write; the cutover itself is `EXT` + `APPROVAL`.

**Tests / validation.** Each step's verification is executable and has a pass condition.

**Rollback.** Each step is individually reversible; rollback runs in reverse order.

**Acceptance.** A checklist where no step can be started without the previous verification passing.

**Risk if ignored.** A cutover that half-works and cannot be cleanly undone.

---

### ISS-47 — Capture the rollback target immediately before cutover, not before that
**Work item** PCR-08 · **Owner lane** B · **Blocked by** ISS-06

**Summary.** Record `workerVersionsBefore` minutes before the cutover, not days.

**Problem.** A version id captured a week earlier may not be the version currently running, and rolling back to the wrong version is worse than not rolling back.

**Evidence.** Rule R1 requires the field; nothing currently requires it to be fresh.

**Proposed action.** Add the capture as the last pre-cutover step, with a timestamp, and make the cutover conditional on the manifest validating.

**Exact command / checklist.** Appendix E CL-51.

**Mutation / approval.** `RO`.

**Tests / validation.** The manifest validates with a capture timestamp inside the cutover window.

**Rollback.** None.

**Acceptance.** Capture timestamp within minutes of the first deploy.

**Risk if ignored.** The rollback target is stale and the rollback makes things worse.

---

### ISS-48 — Run the go/no-go review immediately before cutover
**Work item** PCR-09 · **Owner lane** H · **Blocked by** ISS-47

**Summary.** Six no-go conditions, checked minutes before, each explicitly cleared or the cutover does not start.

**Problem.** A checklist completed a week earlier describes a system that no longer exists — three agents commit continuously.

**Evidence.** Appendix K's no-go scenarios.

**Proposed action.** Run the list aloud with the named clearer for each condition present.

**Exact command / checklist.** Appendix K, no-go section.

**Mutation / approval.** `RO`.

**Tests / validation.** Every condition has a recorded cleared/not-cleared state and a name against it.

**Rollback.** Not starting is the rollback.

**Acceptance.** All six cleared, or the cutover is postponed with the blocking condition recorded.

**Risk if ignored.** A known blocker is cleared by whoever is most impatient.

---

### ISS-49 — Write and schedule the bad-Worker-version rollback drill
**Work item** RBD-01 · **Owner lane** H · **Blocked by** ISS-06

**Summary.** Roll back a Worker to a previous version on purpose, and measure how long it takes.

**Problem.** No rollback has ever been performed on this estate, and until ISS-06 lands there is no version id to roll back to.

**Evidence.** Rule R1's rejection message: "this release has no rollback target".

**Proposed action.** In a low-usage window: capture the current version, deploy a known-good trivial change, roll back to the captured version, verify, record elapsed time.

**Exact command / checklist.** Appendix K drill RD-01.

**Mutation / approval.** `EXT` + `APPROVAL`.

**Tests / validation.** The health endpoint and one authenticated read pass after rollback.

**Rollback.** Roll forward again.

**Acceptance.** Elapsed time recorded and used to populate `restoreTimeMeasuredSec`.

**Risk if ignored.** The first rollback is attempted during an outage by someone who has never done one.

---

### ISS-50 — Write the workers.dev-disabled rollback drill
**Work item** RBD-02, WDV-10 · **Owner lane** B · **Blocked by** —

**Summary.** Document the failure signature and the recovery so an operator recognises it in seconds.

**Problem.** The failure is silent from the server's perspective: the Worker is healthy, the deploy succeeded, and only the clients pinned to the removed hostname notice.

**Evidence.** Cloudflare error 1042 is the signature. It must be documented alongside a DNS-failure signature so the two are not confused.

**Proposed action.** Write detection (1042 on the pinned host while the custom domain works), containment (re-enable workers.dev), verification (pinned host returns an application response), and after-action (declare `workers_dev` in config so it cannot recur).

**Exact command / checklist.** Appendix K drill RD-02.

**Mutation / approval.** `RO` to write. Do not induce the failure on beta.

**Tests / validation.** The drill distinguishes 1042 from a resolution failure.

**Rollback.** n/a — this is the rollback.

**Acceptance.** Two distinguishable signatures documented with the recovery for each.

**Risk if ignored.** An outage affecting every mobile user is diagnosed as an app bug.

---

### ISS-51 — Write the gateway-unreachable rollback drill
**Work item** RBD-04, OCG-11 · **Owner lane** B · **Blocked by** ISS-52

**Summary.** Rolling back the gateway differs from rolling back the web app because the clients are physical.

**Problem.** A gateway rollback produces a reconnect storm whose size nobody has measured, and in-flight charging sessions are physical events with customers attached.

**Evidence.** The gateway terminates OCPP WebSockets and binds `IDENTITY_DO`.

**Proposed action.** Write detection (connected-charger count drops), containment (roll back the version immediately rather than debugging forward), evidence capture, verification (charger count returns to baseline), and after-action.

**Exact command / checklist.** Appendix K drill RD-04.

**Mutation / approval.** `RO` to write.

**Tests / validation.** The drill includes a reconnect-storm consideration and a maximum acceptable downtime derived from charger backoff behaviour.

**Rollback.** n/a.

**Acceptance.** Drill references a measured or explicitly assumed reconnect profile.

**Risk if ignored.** A gateway incident is handled by debugging while chargers stay offline.

---

### ISS-52 — Measure the charger fleet's reconnect behaviour
**Work item** OCG-04, OCG-05 · **Owner lane** B + A · **Blocked by** —

**Summary.** Establish backoff, retry interval, and worst-case simultaneous connections.

**Problem.** Every gateway deploy decision — window, maximum acceptable downtime, capacity headroom — depends on numbers nobody has.

**Evidence.** The OCPP specifications preserved in `docs/OCPP`, plus vendor documentation.

**Proposed action.** Derive from specification and vendor behaviour. Do not induce a storm to measure it.

**Exact command / checklist.** Documentary analysis; record assumptions explicitly where the answer is not determinable.

**Mutation / approval.** `RO`.

**Tests / validation.** A worst-case concurrent-connection figure with its derivation shown.

**Rollback.** None.

**Acceptance.** A number, or an explicit statement of what cannot be determined and what would be needed to determine it.

**Risk if ignored.** The gateway is sized and scheduled on intuition.

---

### ISS-53 — Expose a connected-charger count
**Work item** OBS-06, OCG-10 · **Owner lane** A · **Blocked by** —

**Summary.** Make the number of connected chargers readable by an operator during a deploy.

**Problem.** Post-deploy verification for the gateway requires a before-and-after count, and nothing currently exposes one. Several checks in this programme are specified but cannot be performed for exactly this reason.

**Evidence.** OBS-12's list of checks blocked by observability.

**Proposed action.** A count, not per-charger detail, with no charger identifiers exposed publicly.

**Exact command / checklist.** A owns implementation; B owns the requirement and consumes it in CL-58.

**Mutation / approval.** `LOCAL` for the implementation.

**Tests / validation.** The count changes as expected when a simulated charger connects and disconnects locally.

**Rollback.** Revert.

**Acceptance.** An operator can read the number during a deploy without a database query.

**Risk if ignored.** Gateway deploys are declared successful without any evidence about chargers.

---

### ISS-54 — Record error 1042 as a first-class alert condition
**Work item** OBS-09 · **Owner lane** B · **Blocked by** ISS-50

**Summary.** Any synthetic check receiving 1042 alerts immediately and distinctly.

**Problem.** 1042 is the exact signature of the hostname failures this programme is built around. Folding it into a generic 5xx alert loses the one piece of information that identifies the cause.

**Evidence.** All production Worker names currently return 1042, which is how their absence was established.

**Proposed action.** Define the alert with 1042 as a distinct condition and a distinct message naming the likely cause.

**Exact command / checklist.** Alert definition in OBS-03's signal list.

**Mutation / approval.** `RO` to specify.

**Tests / validation.** The alert definition distinguishes 1042 from other failures.

**Rollback.** None.

**Acceptance.** Specified precisely enough to implement without further decisions.

**Risk if ignored.** The most diagnostic signal the platform emits is discarded.

---

### ISS-55 — Add a synthetic check for the pinned mobile API host
**Work item** OBS-04, WDV-09 · **Owner lane** B · **Blocked by** ISS-54

**Summary.** Periodically request the workers.dev host the app pins, and distinguish an application response from a Cloudflare error page.

**Problem.** The app is the only thing that notices when the pinned host stops answering, and app users report problems slowly and vaguely.

**Evidence.** `apps/mobile/lib/api/client.dart` pins the host.

**Proposed action.** An unauthenticated request whose success condition is "an application response, of any status" rather than "HTTP 200".

**Exact command / checklist.** Specification; implementation needs an external scheduler.

**Mutation / approval.** `RO` to specify.

**Tests / validation.** The check fails on 1042 and passes on an application 404.

**Rollback.** None.

**Acceptance.** A specification that an implementer can follow without asking questions.

**Risk if ignored.** Total mobile outage is detected by customer complaint.

---

### ISS-56 — Add a synthetic check for the OCPP endpoint
**Work item** OBS-05, OCG-02 · **Owner lane** B · **Blocked by** ISS-52

**Summary.** Attempt a WebSocket upgrade against the gateway endpoint and record the response, without sending any OCPP payload.

**Problem.** Charger connectivity is the highest-consequence signal and the least observable one.

**Evidence.** The gateway is believed live; the proof so far is a deployment record rather than a connection.

**Proposed action.** Upgrade attempt only. Never impersonate a charger or send an OCPP call.

**Exact command / checklist.** Record status and headers only.

**Mutation / approval.** `RO`.

**Tests / validation.** A 101 or a documented rejection; either is evidence, an absence of response is not.

**Rollback.** None.

**Acceptance.** A check that fails when the gateway is unreachable.

**Risk if ignored.** The fleet can be offline for hours without anything noticing.

---

### ISS-57 — Add a rule requiring known Worker names in release manifests
**Work item** RMV-04 · **Owner lane** B · **Blocked by** —

**Summary.** Reject manifests naming a Worker that is not in a maintained list, unless a justification field is present.

**Problem.** A typo produces a manifest that validates perfectly and describes nothing that exists.

**Evidence.** The schema currently only pattern-checks the name format.

**Proposed action.** A `known-workers.json` beside the schema; membership check; an override field requiring a written reason.

**Exact command / checklist.** Self-test.

**Mutation / approval.** `LOCAL`.

**Tests / validation.** Unknown name rejected; unknown name with justification accepted; known name unaffected.

**Rollback.** Revert.

**Acceptance.** Fixtures for all three cases.

**Risk if ignored.** A release is recorded against a Worker that does not exist and nobody notices until rollback is needed.

---

### ISS-58 — Reject value-shaped strings anywhere in a manifest
**Work item** RMV-03 · **Owner lane** B · **Blocked by** —

**Summary.** Extend rule R5 from `secretNames` to every string in the document.

**Problem.** R5 guards the field where a secret is least likely to be pasted. The `notes` field is where it would actually happen.

**Evidence.** The current policy function checks only `w.secretNames`.

**Proposed action.** Walk every string leaf and match connection-string, token, and long-base64 shapes, with an allowlist for obvious documentation placeholders.

**Exact command / checklist.** Self-test.

**Mutation / approval.** `LOCAL`.

**Tests / validation.** A fixture with a DSN in `notes` is rejected; a fixture with `user:pw@host` in prose passes.

**Rollback.** Revert.

**Acceptance.** Both fixtures behave as specified.

**Risk if ignored.** A release manifest becomes the document that leaks a production DSN.

---

### ISS-59 — Require excluded commits to be verified absent
**Work item** RMV-08, SBH-05 · **Owner lane** B · **Blocked by** —

**Summary.** A release manifest must list the known-forbidden commits in `approval.excludedCommitsVerifiedAbsent`.

**Problem.** The standing rules forbid `4fe0a95` from any release candidate and require care with `30fa407` and `5311cbd`. The schema has the field; nothing requires it to be used.

**Evidence.** The field exists and is optional.

**Proposed action.** Read the forbidden list from a data file beside the schema and require every entry to appear in the verified list.

**Exact command / checklist.** `git merge-base --is-ancestor <sha> <release-sha>` for each, plus the validator rule.

**Mutation / approval.** `LOCAL`.

**Tests / validation.** A manifest missing a forbidden sha from the verified list is rejected.

**Rollback.** Revert.

**Acceptance.** Rule active; the release candidate `4b69d0f` is checked against all three shas and the result recorded.

**Risk if ignored.** A forbidden commit reaches production because nobody re-checked.

---

### ISS-60 — Add a `--strict` mode that treats warnings as errors
**Work item** RMV-12 · **Owner lane** B · **Blocked by** —

**Summary.** Production releases run the validator in strict mode.

**Problem.** Several important checks are warnings by design so that beta is not blocked. Production should not be able to proceed on a warning.

**Evidence.** Rules R7, R8, and R9 currently warn.

**Proposed action.** A flag that promotes warnings to errors; the production checklist uses it.

**Exact command / checklist.** `node validate-release-manifest.mjs --strict release-*.json`

**Mutation / approval.** `LOCAL`.

**Tests / validation.** A manifest that passes normally fails under `--strict` when it has warnings.

**Rollback.** Revert.

**Acceptance.** Demonstrated both ways.

**Risk if ignored.** Production ships with an unstated OCPP impact and no backup branch.

---

### ISS-61 — Emit machine-readable validator output
**Work item** RMV-13 · **Owner lane** B · **Blocked by** —

**Summary.** A `--json` flag producing `{file, errors[], warnings[]}`.

**Problem.** Checklists need an artifact to attach as release evidence, not console text someone retypes.

**Evidence.** The validator currently prints human-readable lines only.

**Proposed action.** Add the flag; commit the output alongside the manifest.

**Exact command / checklist.** Self-test plus a JSON parse check.

**Mutation / approval.** `LOCAL`.

**Tests / validation.** Output parses as JSON; exit code is unchanged.

**Rollback.** Revert.

**Acceptance.** JSON output attached to a release record.

**Risk if ignored.** Release evidence is a screenshot of a terminal.

---

### ISS-62 — Run both validators from one command
**Work item** RMV-17 · **Owner lane** B · **Blocked by** —

**Summary.** One self-test entry point covering the environment-manifest validator and the release-manifest validator.

**Problem.** Two validators with two self-tests is two chances to run only one.

**Evidence.** `validate-manifest.mjs` (8 tests) and `validate-release-manifest.mjs` (7 tests) are invoked separately.

**Proposed action.** A wrapper that runs both and exits non-zero if either fails, reporting a combined count.

**Exact command / checklist.** One command in the release checklist.

**Mutation / approval.** `LOCAL`.

**Tests / validation.** Combined count reported; a deliberate failure in either propagates.

**Rollback.** Revert.

**Acceptance.** One command, one number.

**Risk if ignored.** The less-used validator quietly rots.

---

### ISS-63 — Write a release manifest describing the beta estate as it actually is
**Work item** RMV-11 · **Owner lane** B · **Blocked by** ISS-06

**Summary.** Populate a manifest from real evidence rather than synthetic fixtures.

**Problem.** Every rule so far is tested only against fixtures written to exercise it. The first real manifest is where the rules meet reality.

**Evidence.** Seven fixtures, all synthetic.

**Proposed action.** Fill from the evidence bundle; mark unknown fields explicitly rather than plausibly.

**Exact command / checklist.** `node validate-release-manifest.mjs releases/beta-current.json`

**Mutation / approval.** `LOCAL`.

**Tests / validation.** Every rejection the validator produces is a real gap and gets a work item.

**Rollback.** Delete the draft.

**Acceptance.** Either it validates, or every error maps to an open issue.

**Risk if ignored.** The validator is a well-tested artifact that has never described the system.

---

### ISS-64 — Capture the account audit log for the last 30 days
**Work item** CFD-20 · **Owner lane** B · **Blocked by** ISS-04

**Summary.** Record actor, action, resource, and timestamp for recent control-plane changes.

**Problem.** The estate's history has been reconstructed from configuration files. What actually happened, and who did it, is unrecorded.

**Evidence.** The CPMS rename timeline was derived from repository history, not from platform events.

**Proposed action.** Export or screenshot the audit log; redact anything token-shaped.

**Exact command / checklist.** Account → Manage Account → Audit Log.

**Mutation / approval.** `RO`.

**Tests / validation.** Every deploy or DNS change in the window is attributable to a named actor.

**Rollback.** None.

**Acceptance.** A log covering the window, with any unattributable change flagged.

**Risk if ignored.** An unexplained deploy cannot be traced, and the CPMS question stays speculative.

---

### ISS-65 — Capture the account membership list
**Work item** CFD-19 · **Owner lane** B · **Blocked by** ISS-04

**Summary.** Record who can deploy.

**Problem.** Every protection in this programme assumes a known set of people with access. That set has never been written down.

**Evidence.** No membership record exists in the project.

**Proposed action.** Account → Manage Account → Members. Record every member with Administrator or Workers Admin rights.

**Exact command / checklist.** Appendix E CL-06.

**Mutation / approval.** `RO`. Remove nobody.

**Tests / validation.** The list is complete and each privileged member is expected.

**Rollback.** None.

**Acceptance.** A list; any unexpected member is escalated immediately.

**Risk if ignored.** Branch protection and read-only tokens protect against accidents while an unknown account holds full access.

---

### ISS-66 — Confirm whether any CI system holds a Cloudflare deploy credential
**Work item** CFA-11 · **Owner lane** B · **Blocked by** —

**Summary.** List repository and organisation secret names and workflow files.

**Problem.** If a deploy token exists in GitHub Actions, merging a pull request can deploy without anyone present — which changes what branch protection is for.

**Evidence.** Fact F2 covers the Cloudflare-side integration; this covers the GitHub side.

**Proposed action.** `gh secret list` and `gh workflow list`, then read any workflow that mentions Cloudflare or Wrangler.

**Exact command / checklist.** Names only; never a value.

**Mutation / approval.** `RO`.

**Tests / validation.** Every workflow with deploy capability is identified.

**Rollback.** None.

**Acceptance.** A definitive yes or no on automated deploy capability.

**Risk if ignored.** Branch protection is designed against the wrong threat model.

---

### ISS-67 — Compare `origin/staging` against the release candidate
**Work item** SBH-03, SBH-07 · **Owner lane** B · **Blocked by** —

**Summary.** Establish whether staging is ahead of, behind, or divergent from `4b69d0f`.

**Problem.** Promotion is supposed to be a fast-forward. Whether that is currently possible has not been measured.

**Evidence.** `origin/staging` is `f53fb55e1229`; the release candidate is `4b69d0f`.

**Proposed action.** `git rev-list --left-right --count origin/staging...4b69d0f`.

**Exact command / checklist.** Appendix E CL-51.

**Mutation / approval.** `RO`. Merge nothing.

**Tests / validation.** A non-zero left count means staging carries commits the candidate does not, and those commits must be accounted for.

**Rollback.** None.

**Acceptance.** Two numbers recorded, and `verifiedFastForward` in the manifest set from them rather than assumed.

**Risk if ignored.** A promotion that is not a fast-forward is performed as if it were, silently dropping or duplicating work.

---

### ISS-68 — Verify the forbidden commits are absent from the release candidate
**Work item** SBH-05 · **Owner lane** B · **Blocked by** —

**Summary.** Check `4fe0a95`, `30fa407`, and `5311cbd` against `4b69d0f`.

**Problem.** The standing rules forbid the first outright and require the other two not to be included unchanged. The check has been asserted but not recorded as evidence.

**Evidence.** The standing rules; the release candidate tip.

**Proposed action.** `git merge-base --is-ancestor <sha> 4b69d0f` for each; record the exit status.

**Exact command / checklist.** Three commands, three recorded results.

**Mutation / approval.** `RO`.

**Tests / validation.** All three absent, or the candidate is disqualified and a new one is chosen.

**Rollback.** None.

**Acceptance.** Results recorded and carried into `approval.excludedCommitsVerifiedAbsent`.

**Risk if ignored.** A forbidden commit ships because everyone assumed someone had checked.

---

### ISS-69 — Establish what beta means for this product
**Work item** BER-01 · **Owner lane** H · **Blocked by** —

**Summary.** Write down whether beta involves real customers, real money, and real energy.

**Problem.** "Beta" is used to mean both "not production" and "real customers on real hardware". Those carry very different obligations, and several no-go conditions cannot be written until it is settled.

**Evidence.** Beta has real users and a live brand domain.

**Proposed action.** One definition, plus a success signal and an abort signal.

**Exact command / checklist.** Record in Appendix K rehearsal BR-01.

**Mutation / approval.** `RO`.

**Tests / validation.** Every no-go condition can cite the definition.

**Rollback.** None.

**Acceptance.** A definition, three or four measurable success conditions, and three or four unambiguous abort conditions.

**Risk if ignored.** Beta ends when someone gets impatient rather than when it has demonstrated anything.

---

### ISS-70 — Rehearse the UI locally with backend-gated features disabled
**Work item** BER-02 · **Owner lane** X · **Blocked by** —

**Summary.** Run the web app locally with every backend-gated feature in its disabled state.

**Problem.** The fastest safe rehearsal needs no cloud at all, and several features depend on backend work that has not landed. A gated feature that errors rather than showing a defined disabled state is a bug that will surface in front of a beta user.

**Evidence.** Several backend gates are open: the driver invitation loop is broken at runtime, and pricing is blocked on the money-unit contract.

**Proposed action.** Start locally with gating configured; walk every gated surface.

**Exact command / checklist.** Appendix K rehearsal BR-01.

**Mutation / approval.** `LOCAL`.

**Tests / validation.** Every gated surface renders a defined disabled state, never an error or an empty page.

**Rollback.** None.

**Acceptance.** A walk-through with a screenshot per gated surface.

**Risk if ignored.** Beta users meet raw errors where a feature is simply not ready.

---

### ISS-71 — Rehearse the driver membership flow and confirm the known failure
**Work item** BER-05 · **Owner lane** A + X · **Blocked by** —

**Summary.** Reproduce the broken invitation loop locally, then confirm the fix when it lands.

**Problem.** The driver invitation loop is confirmed broken at runtime: an invitee can never redeem, and codes are bearer-only. It is currently unfixed by choice.

**Evidence.** Runtime confirmation recorded in the project findings.

**Proposed action.** Run the flow locally and record the exact failure point. A rehearsal that fails in the documented way validates the rehearsal itself.

**Exact command / checklist.** Appendix K rehearsal BR-04.

**Mutation / approval.** `LOCAL`. Do not issue invitations in beta.

**Tests / validation.** The failure reproduces at the expected point.

**Rollback.** None.

**Acceptance.** Failure point recorded; the rehearsal becomes the acceptance test for A's fix.

**Risk if ignored.** The fix is verified against a rehearsal written after the fact, which tends to verify the fix rather than the requirement.

---

### ISS-72 — Rehearse a beta domain change without breaking the mobile app
**Work item** BER-08 · **Owner lane** H · **Blocked by** ISS-01

**Summary.** Add a custom domain in a way that provably preserves the pinned workers.dev host.

**Problem.** This is the exact change the whole workers.dev finding warns about, and it will eventually be wanted for legitimate reasons.

**Evidence.** The inference behaviour; the pinned host in the mobile client.

**Proposed action.** Land ISS-01 first. Then add the domain. Then verify both hosts answer with application responses.

**Exact command / checklist.** Appendix K rehearsal BR-07.

**Mutation / approval.** `EXT` + `APPROVAL`.

**Tests / validation.** Both the custom domain and the workers.dev host return application responses, not 1042.

**Rollback.** Remove the domain; the pinned host must still answer afterwards, which is itself worth verifying.

**Acceptance.** Both hosts live simultaneously, demonstrated with captured responses.

**Risk if ignored.** The first custom domain addition is also the first total mobile outage.

---

### ISS-73 — Rehearse OCPP continuity across a web-only deploy
**Work item** BER-09 · **Owner lane** H · **Blocked by** ISS-53

**Summary.** Demonstrate that deploying the web Worker does not disturb chargers.

**Problem.** Deploy independence between the three Workers is assumed everywhere in this programme and demonstrated nowhere.

**Evidence.** Three Workers; three service bindings; one plain-HTTPS path.

**Proposed action.** Capture the connected-charger count before and after a web-only deploy.

**Exact command / checklist.** Appendix K rehearsal BR-08.

**Mutation / approval.** `EXT` + `APPROVAL`.

**Tests / validation.** The count is unchanged.

**Rollback.** Roll back the web Worker version.

**Acceptance.** Counts match. If they do not, the independence assumption is wrong and much of the cutover plan changes.

**Risk if ignored.** A routine web deploy takes chargers offline and nobody expects it to.

---

### ISS-74 — Write the accidental-push-to-staging drill
**Work item** RBD-08 · **Owner lane** B · **Blocked by** ISS-07

**Summary.** What to do in the first sixty seconds after a push to `staging` that should not have happened.

**Problem.** Two branches track `origin/staging` and one carries a forbidden commit. The first question is not how to undo the push but whether the push triggered a deploy.

**Evidence.** The tracking configuration; fact F2 unresolved.

**Proposed action.** Detection, then determine deploy status, then contain — and recognise that a force-push fix is itself dangerous and must not be normalised.

**Exact command / checklist.** Appendix K drill RD-08.

**Mutation / approval.** `RO` to write.

**Tests / validation.** The drill's first step is a deploy-status check, not a git command.

**Rollback.** Depends on the deploy answer, which is why it comes first.

**Acceptance.** Drill written with the deploy question first.

**Risk if ignored.** The reflexive response is a force push, which may compound the problem.

---

### ISS-75 — Write the cleanup-deleted-something-needed drill
**Work item** RBD-10 · **Owner lane** B · **Blocked by** ISS-38

**Summary.** Recovery from a cleanup mistake, using the verified archive rather than memory.

**Problem.** The entire preservation programme exists because this outcome is plausible. A drill that assumes the recycle bin is not a drill.

**Evidence.** 128 untracked OCPP files, 38 parked research files, and a prompt folder with zero commits.

**Proposed action.** Detection (a preservation check fails, or a tool reports a missing file), containment (stop all cleanup immediately), recovery (extract from the verified archive and hash-compare), verification.

**Exact command / checklist.** Appendix K drill RD-10.

**Mutation / approval.** `RO` to write.

**Tests / validation.** The drill's recovery step requires the archive verification from ISS-38 to have been completed beforehand.

**Rollback.** n/a.

**Acceptance.** Drill written and its prerequisite made explicit.

**Risk if ignored.** Recovery is attempted from an unverified copy, or from nothing.

---

### ISS-76 — Decide the archive location
**Work item** CLP-17 · **Owner lane** H · **Blocked by** ISS-38

**Summary.** Choose where the preservation archive lives, and state which failure it protects against.

**Problem.** An archive on the same disk as the original protects against `git clean`. It does not protect against disk loss, and the difference is rarely stated when the archive is created.

**Evidence.** No off-machine backup of `E:\Claude` or of the prompt folder has been confirmed to exist.

**Proposed action.** Pick a location whose failure modes are independent of the original's.

**Exact command / checklist.** Record in AD-11.

**Mutation / approval.** `RO` to decide.

**Tests / validation.** The chosen location survives the failure the archive is meant to protect against.

**Rollback.** Move the archive.

**Acceptance.** A location and an explicit statement of what it does and does not protect against.

**Risk if ignored.** A backup that fails in the same event as the original.

---

### ISS-77 — Write the one-page brief for whoever owns CPMS
**Work item** CPS-10 · **Owner lane** B · **Blocked by** ISS-07

**Summary.** A factual page explaining the shared Worker names and what is being asked.

**Problem.** The separation needs action from a party outside this track, and this track must not edit the CPMS repository.

**Evidence.** CPMS `wrangler.jsonc:3,32`; the April rename timeline.

**Proposed action.** State what is shared, what breaks if both projects deploy, and what specific action is requested. No instruction on how they should run their project.

**Exact command / checklist.** One page, sendable without further context.

**Mutation / approval.** `RO`.

**Tests / validation.** A reader with no Straumvakt context can act on it.

**Rollback.** None.

**Acceptance.** Brief written; CPMS files remain untouched, verified by `git status` in that checkout.

**Risk if ignored.** The collision is discussed internally and never raised with the party who can resolve it.

---

### ISS-78 — Record cleanup as three separate, separately-approved sessions
**Work item** CLP-18 · **Owner lane** H · **Blocked by** ISS-38

**Summary.** Preservation, archive verification, and deletion happen in three sessions, never one.

**Problem.** Bundling them means the deletion happens while the archive verification is still fresh in someone's optimism.

**Evidence.** Nothing under `E:\Claude` has been deleted, moved, or modified, and the standing rules forbid it without explicit approval.

**Proposed action.** Three sessions. The dry-run script stays free of delete verbs — it currently has none, verified by grep, with delete verbs appearing only inside comments instructing the operator.

**Exact command / checklist.** Appendix E CL-45, CL-49, CL-50 as three separate checklists.

**Mutation / approval.** The third session is `DESTRUCT` + `APPROVAL`.

**Tests / validation.** Each session ends with a passing preservation check.

**Rollback.** Restore from the verified archive.

**Acceptance.** Three checklists, three approvals, and a deletion log mapping every path to an archive member.

**Risk if ignored.** 2.25 GB of irreplaceable content is deleted alongside 41.57 GB of genuinely regenerable build output.

---

### ISS-79 — Establish the release freeze rule for three concurrent agents
**Work item** SBH-10 · **Owner lane** B · **Blocked by** ISS-13

**Summary.** Define what may land during a release window.

**Problem.** Three agents commit continuously. A release assembled from a moving target is not reproducible, and the go/no-go review in ISS-48 describes a system that changed while the review was being written.

**Evidence.** During this run alone, two peer worktrees advanced: onboarding-web `d228f53` → `7a25fa5` and driver-access-ui `75beb3c` → `ad5d8c7`, both going from dirty to clean.

**Proposed action.** A named freeze window, a rule for what may land in it, and a way for A and X to know it is in effect without asking.

**Exact command / checklist.** Record in AD-16; announce via the coordinator ledger.

**Mutation / approval.** `RO`.

**Tests / validation.** A and X can determine the freeze state without a conversation.

**Rollback.** Lift the freeze.

**Acceptance.** A written rule and a visible signal.

**Risk if ignored.** Release candidates are stale before they are approved.

---

### ISS-80 — Add the prompt folder to the automated preservation check
**Work item** CDA-04 · **Owner lane** B · **Blocked by** ISS-33

**Summary.** Make P4 a checked target rather than a `MANUAL` line in the report.

**Problem.** The prompt and evidence folder is the least protected and most load-bearing asset in the project, and it is the one target the dry-run script does not verify, because it lives outside the measured root.

**Evidence.** The script prints `P4  MANUAL` with an instruction rather than a check. The folder has a git repository with zero commits.

**Proposed action.** Extend the preservation list with an absolute path outside `$Root`, checking presence, file count, and — once ISS-33 lands — commit count.

**Exact command / checklist.** Run the script and confirm P4 reports PRESENT with a count.

**Mutation / approval.** `LOCAL`.

**Tests / validation.** Pointing the check at a non-existent path produces the missing-target failure from ISS-35.

**Rollback.** Revert.

**Acceptance.** P4 checked automatically, including its commit count.

**Risk if ignored.** The one asset with no recovery path is also the one the tripwire does not watch.

---

**Count: 80 issue-ready bodies.**
