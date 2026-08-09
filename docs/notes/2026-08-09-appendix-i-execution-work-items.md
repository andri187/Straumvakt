# Appendix I — Execution work items

**270 non-duplicate work items in 19 groups.** Each is directly actionable by one
person in one sitting. Every item carries a mutation category; nothing in the
`external mutation` or `destructive` categories has been executed.

Mutation categories used throughout:

| Tag | Meaning |
|---|---|
| `RO` | read-only — safe to run now, changes nothing |
| `LOCAL` | local mutation only — touches this machine or this worktree |
| `EXT` | external mutation — changes a control plane; **not executed here** |
| `DESTRUCT` | destructive — deletes or overwrites; **not executed here** |
| `APPROVAL` | requires Andri's explicit approval regardless of category |

Owner lanes: **B** = release ops (this track), **A** = Claude A backend/domain,
**X** = Codex UI, **H** = human (Andri) only.

---

## Group A — Cloudflare read-only access setup (16)

#### CFA-01 — Create a scoped read-only Cloudflare API token
- **Evidence** `wrangler whoami` returns unauthenticated; no `CLOUDFLARE_API_TOKEN` or `CLOUDFLARE_ACCOUNT_ID` in this environment.
- **Scope** One custom token, Read-only permissions only. **Non-goals** no Edit scope, no deploy capability, no account-owned token shared with CI.
- **Do** dash.cloudflare.com → My Profile → API Tokens → Create Token → Custom token.
- **Mutation** `EXT` + `APPROVAL` · **Owner** H · **Deps** —
- **Accept** `GET /client/v4/user/tokens/verify` returns `"status":"active"`; any Edit-class call returns 403.
- **Rollback** Revoke the token from the same page. Instant, no side effects.
- **Impact** none on A/X · **Artifact** Appendix A fact F1

#### CFA-02 — Enumerate the exact permission set the token needs
- **Evidence** Seven blocked facts each name the API path that would answer them.
- **Scope** Account: Workers Scripts:Read, Workers KV:Read, Workers Tail:Read, Workers R2:Read, Account Settings:Read, D1:Read, Hyperdrive:Read. Zone: Zone:Read, DNS:Read, SSL and Certificates:Read. **Non-goals** Workers Scripts:Edit — that permission alone can deploy.
- **Do** Record the list in the token creation form; screenshot before Continue.
- **Mutation** `RO` (planning) · **Owner** B · **Deps** —
- **Accept** Every blocked fact maps to at least one granted permission.
- **Rollback** n/a
- **Impact** none · **Artifact** Appendix D template D-01

#### CFA-03 — Scope the token to the Straumvakt account only
- **Evidence** CPMS declares Worker names identical to Straumvakt's; a broad token would read and could confuse two estates.
- **Scope** Account Resources → Include → specific account. **Non-goals** All accounts.
- **Do** Token form → Account Resources → Include → *Straumvakt account*.
- **Mutation** `EXT` + `APPROVAL` · **Owner** H · **Deps** CFA-01
- **Accept** `GET /accounts` under the token returns exactly one account.
- **Rollback** Revoke and reissue.
- **Impact** none · **Artifact** Appendix A F2

#### CFA-04 — Set a TTL on the read-only token
- **Evidence** No credential in this project currently has an expiry.
- **Scope** TTL of 7 days, matching the evidence-capture window. **Non-goals** a permanent token.
- **Do** Token form → TTL → start today, end +7 days.
- **Mutation** `EXT` + `APPROVAL` · **Owner** H · **Deps** CFA-01
- **Accept** Verify endpoint reports `expires_on` within 7 days.
- **Rollback** Revoke early.
- **Impact** none · **Artifact** AD-01

#### CFA-05 — Store the token outside the repository tree
- **Evidence** A real `AUTH_SECRET` is already committed in `.env.example` in this project's history; the habit exists.
- **Scope** Store in the OS credential store or a file outside `E:\Claude`. **Non-goals** any `.env` inside a worktree.
- **Do** Save to `C:\Users\Andri\.cloudflare\ro-token` with user-only ACL, or a password manager.
- **Mutation** `LOCAL` + `APPROVAL` · **Owner** H · **Deps** CFA-01
- **Accept** `git status` in every worktree shows no new file; `grep -r` for the token prefix across `E:\Claude` returns nothing.
- **Rollback** Delete the file and revoke.
- **Impact** none · **Artifact** Appendix G record P-16

#### CFA-06 — Prove the token cannot deploy
- **Evidence** The whole safety argument for a read-only session rests on this being true, not assumed.
- **Scope** One deliberately-failing write call. **Non-goals** a call that could succeed.
- **Do** `curl -X PUT .../workers/scripts/hlada-staging` with no body and the RO token; expect 403 `Authentication error`.
- **Mutation** `RO` in effect (the call is rejected) · **Owner** B · **Deps** CFA-01
- **Accept** HTTP 403 and `code: 10000`-class error, not 400.
- **Rollback** n/a
- **Impact** none · **Artifact** Appendix D template D-02

#### CFA-07 — Record the account ID as a non-secret fact
- **Evidence** Account ID is required by nearly every API path and is not a credential.
- **Scope** Capture the 32-hex account id. **Non-goals** capturing any token or key alongside it.
- **Do** `curl -H "Authorization: Bearer $RO" .../accounts | jq '.result[] | {id,name}'`.
- **Mutation** `RO` · **Owner** B · **Deps** CFA-01
- **Accept** Exactly one account; id is 32 hex characters; recorded in the evidence ledger.
- **Rollback** n/a
- **Impact** none · **Artifact** Appendix A F1

#### CFA-08 — Record the zone ID for `straumvakt.org`
- **Evidence** Zone-scoped calls for DNS, SSL and routes all need it.
- **Scope** One zone id. **Non-goals** enumerating unrelated zones.
- **Do** `curl .../zones?name=straumvakt.org | jq '.result[] | {id,status,name_servers}'`.
- **Mutation** `RO` · **Owner** B · **Deps** CFA-01
- **Accept** `status: active`; nameservers match the registrar.
- **Rollback** n/a
- **Impact** none · **Artifact** Appendix D template D-03

#### CFA-09 — Decide token versus browser session, and record why
- **Evidence** Fact F2 (Git integration owner) has no CLI equivalent; a dashboard visit is unavoidable.
- **Scope** Use the token for everything scriptable; use the browser only for F2 and screenshots. **Non-goals** doing everything by hand.
- **Do** Record the split in AD-02 before the session starts.
- **Mutation** `RO` · **Owner** B · **Deps** —
- **Accept** Each of the seven blocked facts is tagged token or browser.
- **Rollback** n/a
- **Impact** none · **Artifact** AD-02

#### CFA-10 — Prepare the read-only session script before logging in
- **Evidence** A logged-in session with an unplanned agenda is where accidental clicks happen.
- **Scope** A single script that runs every read call in order and writes one evidence file. **Non-goals** any call that mutates.
- **Do** Assemble from Appendix E checklists CL-01 … CL-06.
- **Mutation** `RO` · **Owner** B · **Deps** CFA-02
- **Accept** Script contains zero `PUT`/`POST`/`PATCH`/`DELETE` verbs; verified by grep.
- **Rollback** n/a
- **Impact** none · **Artifact** Appendix E CL-01

#### CFA-11 — Confirm no CI system already holds a Cloudflare token
- **Evidence** If a deploy token exists in GitHub Actions, a merge could deploy without anyone present.
- **Scope** Repository and organisation secret **names** only. **Non-goals** reading any value.
- **Do** `gh secret list --repo <repo>` and `gh workflow list`.
- **Mutation** `RO` · **Owner** B · **Deps** —
- **Accept** The set of secret names is recorded; any Cloudflare-shaped name is flagged for AD-03.
- **Rollback** n/a
- **Impact** A must know if a deploy path exists · **Artifact** Appendix D template D-30

#### CFA-12 — Verify Wrangler will not silently pick up a stale token
- **Evidence** Wrangler reads `CLOUDFLARE_API_TOKEN` from the environment before its config file.
- **Scope** Environment inspection on this machine. **Non-goals** setting any variable.
- **Do** `Get-ChildItem Env: | Where-Object Name -like 'CLOUDFLARE*'` and inspect `~/.wrangler/config`.
- **Mutation** `RO` · **Owner** B · **Deps** —
- **Accept** No Cloudflare variable is set and no cached OAuth config exists, or both are recorded.
- **Rollback** n/a
- **Impact** none · **Artifact** Appendix A F1

#### CFA-13 — Define the stop condition for the read-only session
- **Evidence** Sessions overrun; a stop condition converts judgement into a rule.
- **Scope** Written trigger list. **Non-goals** an open-ended session.
- **Do** Stop when: an unexpected Worker name appears; a production Worker exists that this project did not create; the Git integration points at a repository nobody recognises.
- **Mutation** `RO` · **Owner** B · **Deps** —
- **Accept** The list is in the checklist header where the operator will see it.
- **Rollback** n/a
- **Impact** none · **Artifact** Appendix E CL-01

#### CFA-14 — Plan token revocation as the last step of the session
- **Evidence** A 7-day TTL is a ceiling, not a plan.
- **Scope** Revoke immediately after evidence capture completes. **Non-goals** leaving it for the TTL.
- **Do** API Tokens page → Delete; then re-run verify and expect 401.
- **Mutation** `EXT` + `APPROVAL` · **Owner** H · **Deps** CFA-01
- **Accept** Verify returns 401 after deletion.
- **Rollback** Reissue if more evidence is needed.
- **Impact** none · **Artifact** Appendix E CL-06

#### CFA-15 — Record what the session did NOT look at
- **Evidence** Absence of evidence has been mistaken for evidence of absence twice in this project.
- **Scope** An explicit not-inspected list. **Non-goals** implying full coverage.
- **Do** After capture, list every dashboard section not opened.
- **Mutation** `RO` · **Owner** B · **Deps** CFA-10
- **Accept** The evidence ledger has a "not inspected" section that is non-empty.
- **Rollback** n/a
- **Impact** none · **Artifact** Appendix A

#### CFA-16 — Write the evidence pack to a location outside `E:\Claude`
- **Evidence** `E:\Claude` is a cleanup target; evidence stored there could be pruned.
- **Scope** One directory under `C:\Users\Andri\Documents`. **Non-goals** anything inside a worktree.
- **Do** Create `cloudflare-evidence-2026-08-09/` and write there.
- **Mutation** `LOCAL` · **Owner** B · **Deps** —
- **Accept** Path is outside `E:\Claude`; the cleanup dry-run script already refuses to write inside it.
- **Rollback** Delete the directory.
- **Impact** none · **Artifact** Appendix G P-17

---

## Group B — Cloudflare dashboard evidence (20)

#### CFD-01 — Capture the Workers & Pages overview list
- **Evidence** The deployed estate is believed to be three beta Workers; belief is not a screenshot.
- **Scope** Names, last-deployed timestamps, and environment labels. **Non-goals** opening each Worker yet.
- **Do** Dashboard → Workers & Pages → Overview.
- **Mutation** `RO` · **Owner** B · **Deps** CFA-09
- **Accept** Exactly `hlada-staging`, `hlada-api-staging`, `straumvakt-ocpp-staging` plus whatever else appears; anything unexpected triggers the CFA-13 stop condition.
- **Rollback** n/a
- **Impact** none · **Artifact** Appendix D D-04

#### CFD-02 — Capture `hlada-staging` deployment history and version IDs
- **Evidence** No Worker version id has ever been recorded; the release manifest rejects a release without one.
- **Scope** Version id, created timestamp, deploy source for the last five deployments. **Non-goals** triggering a rollback from this page.
- **Do** Worker → Deployments tab.
- **Mutation** `RO` · **Owner** B · **Deps** CFD-01
- **Accept** At least one version id captured, 36-character UUID form.
- **Rollback** n/a
- **Impact** none · **Artifact** Appendix D D-05

#### CFD-03 — Capture `hlada-api-staging` deployment history and version IDs
- **Evidence** Same gap; and this Worker is the one the shipped mobile app depends on.
- **Scope** As CFD-02. **Non-goals** none additional.
- **Do** Worker → Deployments tab.
- **Mutation** `RO` · **Owner** B · **Deps** CFD-01
- **Accept** Version id captured and recorded as the rollback target for the API.
- **Rollback** n/a
- **Impact** X must know the API cannot be rolled back until this exists · **Artifact** Appendix D D-05

#### CFD-04 — Capture `straumvakt-ocpp-staging` deployment history and version IDs
- **Evidence** This Worker terminates charger WebSockets; a bad version disconnects the fleet.
- **Scope** As CFD-02, plus the current active version. **Non-goals** restarting the Worker.
- **Do** Worker → Deployments tab.
- **Mutation** `RO` · **Owner** B · **Deps** CFD-01
- **Accept** Version id captured; recorded in the OCPP continuity record.
- **Rollback** n/a
- **Impact** none · **Artifact** Appendix D D-06

#### CFD-05 — Capture the Triggers tab for each Worker
- **Evidence** Custom Domains and routes behave differently and the difference is the whole workers.dev finding.
- **Scope** Custom Domains list, Routes list, and the workers.dev toggle state, per Worker. **Non-goals** changing any toggle.
- **Do** Worker → Settings → Triggers (or Domains & Routes).
- **Mutation** `RO` · **Owner** B · **Deps** CFD-01
- **Accept** For each Worker, one of {Custom Domain, route, neither} is recorded, plus the workers.dev enabled/disabled state.
- **Rollback** n/a
- **Impact** none · **Artifact** Appendix D D-07

#### CFD-06 — Capture the workers.dev subdomain state explicitly for the API
- **Evidence** `apps/api/wrangler.jsonc` declares neither `routes` nor `workers_dev`; the live state is therefore inferred, not declared.
- **Scope** The literal enabled/disabled state shown in the dashboard. **Non-goals** inferring it from a successful curl.
- **Do** Worker → Settings → Domains & Routes → `workers.dev` row.
- **Mutation** `RO` · **Owner** B · **Deps** CFD-05
- **Accept** State recorded as a screenshot, not a sentence.
- **Rollback** n/a
- **Impact** X: the mobile app pins this host · **Artifact** Appendix D D-08

#### CFD-07 — Capture the workers.dev subdomain state explicitly for the gateway
- **Evidence** The gateway carries the identical latent condition and its blast radius is the charger fleet.
- **Scope** As CFD-06 for `straumvakt-ocpp-staging`. **Non-goals** none.
- **Do** Worker → Settings → Domains & Routes.
- **Mutation** `RO` · **Owner** B · **Deps** CFD-05
- **Accept** State recorded; if enabled and undeclared, raise WDV-01 to blocking.
- **Rollback** n/a
- **Impact** none · **Artifact** Appendix D D-08

#### CFD-08 — Capture the Git integration / build configuration owner
- **Evidence** Fact F2. This is the only blocked fact with no CLI equivalent.
- **Scope** Connected repository, branch, build command, and whether builds are enabled. **Non-goals** disconnecting anything.
- **Do** Worker → Settings → Build → Git repository.
- **Mutation** `RO` · **Owner** B · **Deps** CFA-09
- **Accept** Repository owner/name and production branch recorded verbatim.
- **Rollback** n/a
- **Impact** A must know whether a merge deploys · **Artifact** Appendix D D-09

#### CFD-09 — Capture the secret **names** bound to each Worker
- **Evidence** A production cutover needs the name list to reproduce; values must never be captured.
- **Scope** Names only. **Non-goals** clicking any reveal control, if one exists.
- **Do** Worker → Settings → Variables and Secrets. Secrets show names with values hidden.
- **Mutation** `RO` · **Owner** B · **Deps** CFD-01
- **Accept** Every captured name matches `^[A-Z][A-Z0-9_]*$` and contains no `=`, `:`, or `/`.
- **Rollback** n/a
- **Impact** none · **Artifact** Appendix D D-10

#### CFD-10 — Capture plaintext environment variable names and values
- **Evidence** Plaintext vars are not secrets and their values are often the load-bearing configuration.
- **Scope** Name and value for non-secret vars. **Non-goals** anything shown as a secret.
- **Do** Same page, Variables section.
- **Mutation** `RO` · **Owner** B · **Deps** CFD-09
- **Accept** Recorded; any value that looks like a credential is redacted and reported as a finding.
- **Rollback** n/a
- **Impact** none · **Artifact** Appendix D D-11

#### CFD-11 — Capture Durable Object namespace bindings and IDs
- **Evidence** `IDENTITY_DO` is the charger identity store; a namespace id mismatch on cutover loses identity.
- **Scope** Binding name, class name, script name, namespace id. **Non-goals** deleting or migrating a namespace.
- **Do** Worker → Settings → Bindings → Durable Objects; and Workers → Durable Objects.
- **Mutation** `RO` · **Owner** B · **Deps** CFD-01
- **Accept** Namespace id recorded for every DO binding.
- **Rollback** n/a
- **Impact** none · **Artifact** Appendix D D-12

#### CFD-12 — Capture Queue names, consumers, and current depth
- **Evidence** A non-zero DLQ depth is unprocessed work that a cutover would strand.
- **Scope** Queue name, producer, consumer, backlog, DLQ depth. **Non-goals** purging any queue.
- **Do** Workers → Queues.
- **Mutation** `RO` · **Owner** B · **Deps** CFA-09
- **Accept** Depths recorded with a timestamp; a non-zero DLQ becomes a production no-go input.
- **Rollback** n/a
- **Impact** A owns queue semantics · **Artifact** Appendix D D-13

#### CFD-13 — Capture Hyperdrive configuration and its target
- **Evidence** Hyperdrive pointing at the wrong Neon branch is invisible from application code.
- **Scope** Hyperdrive id, origin host, database name, caching mode. **Non-goals** the password.
- **Do** Workers → Hyperdrive → config detail.
- **Mutation** `RO` · **Owner** B · **Deps** CFA-09
- **Accept** Origin host recorded and cross-checked against the intended Neon branch endpoint.
- **Rollback** n/a
- **Impact** A must confirm the branch is the intended one · **Artifact** Appendix D D-14

#### CFD-14 — Capture R2 bucket list and bindings
- **Evidence** Object storage is the one place where a cutover can silently orphan customer data.
- **Scope** Bucket names, bindings, and whether any is public. **Non-goals** listing objects.
- **Do** R2 → Overview; and each Worker's Bindings section.
- **Mutation** `RO` · **Owner** B · **Deps** CFA-09
- **Accept** Bucket names recorded; any public bucket is a finding.
- **Rollback** n/a
- **Impact** none · **Artifact** Appendix D D-15

#### CFD-15 — Capture zone DNS records for `straumvakt.org`
- **Evidence** Custom Domains create proxied records; their presence or absence is the ground truth for routing.
- **Scope** Name, type, content, proxy status for every record. **Non-goals** editing a record.
- **Do** Zone → DNS → Records.
- **Mutation** `RO` · **Owner** B · **Deps** CFA-08
- **Accept** Every hostname the project uses appears, or is explicitly recorded as absent.
- **Rollback** n/a
- **Impact** none · **Artifact** Appendix D D-16

#### CFD-16 — Capture the edge certificate SAN list
- **Evidence** `www` is confirmed absent from the apex SAN; that is a real gap in a real certificate.
- **Scope** Certificate hosts, issuer, expiry, and type. **Non-goals** ordering a certificate.
- **Do** Zone → SSL/TLS → Edge Certificates.
- **Mutation** `RO` · **Owner** B · **Deps** CFA-08
- **Accept** SAN list captured verbatim; the `www` gap is confirmed or closed.
- **Rollback** n/a
- **Impact** X: a `www` link in the UI would fail TLS · **Artifact** Appendix D D-17

#### CFD-17 — Capture Workers subdomain registration for the account
- **Evidence** The `*.workers.dev` hostname the mobile app pins is account-scoped, not Worker-scoped.
- **Scope** The account's workers.dev subdomain name. **Non-goals** changing it — that is irreversible in practice.
- **Do** Workers & Pages → Subdomain.
- **Mutation** `RO` · **Owner** B · **Deps** CFA-09
- **Accept** Subdomain string matches the host pinned in `apps/mobile/lib/api/client.dart`.
- **Rollback** n/a
- **Impact** X owns the pinned host · **Artifact** Appendix D D-18

#### CFD-18 — Capture whether any production-named Worker exists
- **Evidence** Every production name currently returns error 1042, which is consistent with "not deployed" but does not prove "does not exist".
- **Scope** Presence or absence in the account Worker list. **Non-goals** creating one.
- **Do** Workers & Pages → Overview → search for the production names.
- **Mutation** `RO` · **Owner** B · **Deps** CFD-01
- **Accept** A definitive present/absent per name, replacing the current inference.
- **Rollback** n/a
- **Impact** none · **Artifact** Appendix D D-19

#### CFD-19 — Capture the account membership list
- **Evidence** Who else can deploy is a security fact nobody has recorded.
- **Scope** Member emails and roles. **Non-goals** removing anyone.
- **Do** Account → Manage Account → Members.
- **Mutation** `RO` · **Owner** B · **Deps** CFA-09
- **Accept** Every member with an Administrator or Workers Admin role is listed.
- **Rollback** n/a
- **Impact** none · **Artifact** Appendix D D-20

#### CFD-20 — Capture the audit log for the last 30 days
- **Evidence** The estate's history is currently reconstructed from configuration files, not from what actually happened.
- **Scope** Actor, action, resource, timestamp. **Non-goals** exporting anything containing tokens.
- **Do** Account → Manage Account → Audit Log.
- **Mutation** `RO` · **Owner** B · **Deps** CFA-09
- **Accept** Any deploy or DNS change in the window is attributable to a named actor.
- **Rollback** n/a
- **Impact** none · **Artifact** Appendix D D-21

---

## Group C — Cloudflare API evidence (14)

#### CFI-01 — Script: list Workers via API
- **Evidence** Dashboard screenshots do not diff; JSON does.
- **Scope** `GET /accounts/{id}/workers/scripts`. **Non-goals** any script upload.
- **Do** `curl -sH "Authorization: Bearer $RO" ".../workers/scripts" | jq '.result[].id'`
- **Mutation** `RO` · **Owner** B · **Deps** CFA-07
- **Accept** Output saved as `workers-scripts.json` in the evidence directory.
- **Rollback** n/a
- **Impact** none · **Artifact** Appendix D D-22

#### CFI-02 — Script: list versions per Worker
- **Evidence** Rollback requires a version id and none exists.
- **Scope** `GET /accounts/{id}/workers/scripts/{name}/versions`. **Non-goals** activating a version.
- **Do** Loop over the three Worker names.
- **Mutation** `RO` · **Owner** B · **Deps** CFI-01
- **Accept** Every Worker yields at least one `{id, number, created_on}`.
- **Rollback** n/a
- **Impact** none · **Artifact** Appendix D D-05

#### CFI-03 — Script: read current deployment per Worker
- **Evidence** "Latest version" and "currently deployed version" are not the same thing.
- **Scope** `GET .../scripts/{name}/deployments`. **Non-goals** creating a deployment.
- **Do** Same loop; record `versions[].version_id` and percentage.
- **Mutation** `RO` · **Owner** B · **Deps** CFI-02
- **Accept** Active version id per Worker, plus any gradual-rollout split.
- **Rollback** n/a
- **Impact** none · **Artifact** Appendix D D-05

#### CFI-04 — Script: read bindings per Worker
- **Evidence** Bindings are the actual coupling between Workers; config files show intent, the API shows reality.
- **Scope** `GET .../scripts/{name}/settings`. **Non-goals** patching settings.
- **Do** Record binding type, name, and target for each.
- **Mutation** `RO` · **Owner** B · **Deps** CFI-01
- **Accept** The three service bindings and the one plain-HTTPS gap are confirmed or refuted from live data.
- **Rollback** n/a
- **Impact** A owns binding semantics · **Artifact** Appendix D D-23

#### CFI-05 — Script: read secret names per Worker
- **Evidence** Names are needed; values must not be.
- **Scope** `GET .../scripts/{name}/secrets` returns names and types only. **Non-goals** any endpoint returning a value.
- **Do** Record `{name, type}` pairs.
- **Mutation** `RO` · **Owner** B · **Deps** CFI-01
- **Accept** No captured field contains a value; validator rule R5 passes on the derived manifest.
- **Rollback** n/a
- **Impact** none · **Artifact** Appendix D D-10

#### CFI-06 — Script: list zone DNS records
- **Evidence** Custom Domain status is visible as a proxied DNS record.
- **Scope** `GET /zones/{zid}/dns_records?per_page=100`. **Non-goals** creating a record.
- **Do** Save full JSON.
- **Mutation** `RO` · **Owner** B · **Deps** CFA-08
- **Accept** Record count matches the dashboard count from CFD-15.
- **Rollback** n/a
- **Impact** none · **Artifact** Appendix D D-16

#### CFI-07 — Script: list Worker routes on the zone
- **Evidence** Routes and Custom Domains are stored separately and behave differently.
- **Scope** `GET /zones/{zid}/workers/routes`. **Non-goals** adding a route.
- **Do** Save JSON; expect either an empty list or explicit patterns.
- **Mutation** `RO` · **Owner** B · **Deps** CFA-08
- **Accept** Every route pattern is attributed to a Worker; an empty list is recorded as an explicit finding, not an omission.
- **Rollback** n/a
- **Impact** none · **Artifact** Appendix D D-24

#### CFI-08 — Script: list Worker custom domains
- **Evidence** Web→API is the one Worker-to-Worker path that depends on Custom Domain status.
- **Scope** `GET /accounts/{id}/workers/domains`. **Non-goals** attaching a domain.
- **Do** Save JSON; check `api.straumvakt.org`.
- **Mutation** `RO` · **Owner** B · **Deps** CFA-07
- **Accept** The API hostname is present with `"status":"active"`, or the dependency is confirmed broken.
- **Rollback** n/a
- **Impact** none · **Artifact** Appendix D D-25

#### CFI-09 — Script: list Hyperdrive configs
- **Evidence** Fact F5.
- **Scope** `GET /accounts/{id}/hyperdrive/configs`. **Non-goals** patching origin.
- **Do** Save JSON; the password field is not returned.
- **Mutation** `RO` · **Owner** B · **Deps** CFA-07
- **Accept** Origin host recorded; matched against Neon endpoints.
- **Rollback** n/a
- **Impact** A · **Artifact** Appendix D D-14

#### CFI-10 — Script: list Queues and consumers
- **Evidence** Fact F7.
- **Scope** `GET /accounts/{id}/queues`. **Non-goals** purging.
- **Do** Save JSON including `consumers` and `producers`.
- **Mutation** `RO` · **Owner** B · **Deps** CFA-07
- **Accept** DLQ names identified; depth captured from the dashboard where the API omits it.
- **Rollback** n/a
- **Impact** none · **Artifact** Appendix D D-13

#### CFI-11 — Script: list Durable Object namespaces
- **Evidence** Fact F6.
- **Scope** `GET /accounts/{id}/workers/durable_objects/namespaces`. **Non-goals** deleting a namespace.
- **Do** Save JSON; record `{id, name, class, script}`.
- **Mutation** `RO` · **Owner** B · **Deps** CFA-07
- **Accept** `IDENTITY_DO` namespace id recorded.
- **Rollback** n/a
- **Impact** none · **Artifact** Appendix D D-12

#### CFI-12 — Assemble all API JSON into one evidence bundle with hashes
- **Evidence** Evidence that cannot be shown unchanged is not evidence.
- **Scope** SHA-256 per file plus a manifest. **Non-goals** committing anything containing a secret.
- **Do** `Get-FileHash -Algorithm SHA256 *.json` into `bundle-manifest.txt`.
- **Mutation** `LOCAL` · **Owner** B · **Deps** CFI-01…CFI-11
- **Accept** Manifest lists every file; re-hashing reproduces it.
- **Rollback** Delete the bundle.
- **Impact** none · **Artifact** Appendix D D-26

#### CFI-13 — Diff the API evidence against the checked-in wrangler configs
- **Evidence** The declared configuration and the deployed configuration have never been compared.
- **Scope** Bindings, routes, domains, secret names. **Non-goals** editing configs to match.
- **Do** Produce a three-column table: declared / deployed / delta.
- **Mutation** `RO` · **Owner** B · **Deps** CFI-12
- **Accept** Every delta has a work item; zero deltas is itself a recorded result.
- **Rollback** n/a
- **Impact** A and X both consume the delta table · **Artifact** Appendix D D-27

#### CFI-14 — Convert the evidence bundle into a release-manifest draft
- **Evidence** The validator can only reject what has been written down.
- **Scope** One `release-*.json` populated from live evidence. **Non-goals** performing a release.
- **Do** Fill the schema; run `validate-release-manifest.mjs`.
- **Mutation** `LOCAL` · **Owner** B · **Deps** CFI-12
- **Accept** Validator reports VALID, or the errors it reports become work items.
- **Rollback** Delete the draft.
- **Impact** none · **Artifact** Appendix F

---

## Group D — workers.dev hardening (16)

#### WDV-01 — Declare `workers_dev` explicitly in `apps/api/wrangler.jsonc`
- **Evidence** The file declares neither `routes` nor `workers_dev`; the shipped mobile app pins `hlada-api-staging.straumvakt.workers.dev`.
- **Scope** Add `"workers_dev": true` to the relevant environment. **Non-goals** adding routes in the same change.
- **Do** Edit the config on a branch; do not deploy.
- **Mutation** `LOCAL` (deploying it is `EXT` + `APPROVAL`) · **Owner** B · **Deps** CFD-06
- **Accept** `wrangler deploy --dry-run` shows the workers.dev host retained.
- **Rollback** Revert the commit; the deployed state is unchanged until a deploy.
- **Impact** X: prevents the app losing its host · **Artifact** Appendix E CL-14

#### WDV-02 — Declare `workers_dev` explicitly in `gateway/wrangler.jsonc`
- **Evidence** Identical latent condition, blast radius is the charger fleet rather than the app.
- **Scope** As WDV-01 for the gateway. **Non-goals** touching the OCPP path or DO bindings.
- **Do** Edit config on a branch.
- **Mutation** `LOCAL` · **Owner** B · **Deps** CFD-07
- **Accept** Dry run retains the host.
- **Rollback** Revert.
- **Impact** none · **Artifact** Appendix E CL-14

#### WDV-03 — Add a repository check that fails when routes are added without `workers_dev`
- **Evidence** The foot-gun is a diff that reads as "add a custom domain" and lands as "disconnect the fleet".
- **Scope** A script that parses the three wrangler configs. **Non-goals** running it in CI before the CI question is settled.
- **Do** Implement as an offline linter beside the manifest validator.
- **Mutation** `LOCAL` · **Owner** B · **Deps** WDV-01, WDV-02
- **Accept** Linter fails a fixture with routes and no `workers_dev`; passes the current configs once WDV-01/02 land.
- **Rollback** Delete the script.
- **Impact** none · **Artifact** Appendix F rule L2

#### WDV-04 — Record which external clients pin a workers.dev host
- **Evidence** `apps/mobile/lib/api/client.dart` pins the API host; the gateway's dependants are field devices whose configuration is not in this repository.
- **Scope** An explicit list with the source line for each. **Non-goals** guessing about chargers.
- **Do** Grep the mobile and web sources; mark charger configuration as unknown-by-design.
- **Mutation** `RO` · **Owner** B · **Deps** —
- **Accept** Each pinned host has a file:line citation or an explicit "not determinable from this repository".
- **Rollback** n/a
- **Impact** X owns the mobile pin · **Artifact** Appendix D D-28

#### WDV-05 — Add `workersDevRequired` to every release manifest for pinned Workers
- **Evidence** Schema field already exists; the discipline does not.
- **Scope** Manifest authoring rule. **Non-goals** schema change.
- **Do** Set `true` for API and gateway in every manifest.
- **Mutation** `LOCAL` · **Owner** B · **Deps** WDV-04
- **Accept** Validator rule R4 rejects any manifest that sets it without `workersDevDeclaredInConfig`.
- **Rollback** n/a
- **Impact** none · **Artifact** Appendix F rule R4

#### WDV-06 — Prove the inference behaviour on a throwaway Worker before trusting it
- **Evidence** The inference is documented by Cloudflare, but this project has been wrong about documented behaviour before.
- **Scope** A disposable Worker in a sandbox account. **Non-goals** testing on any Straumvakt Worker.
- **Do** Deploy a hello-world Worker, add a route, observe the workers.dev host.
- **Mutation** `EXT` + `APPROVAL` · **Owner** H · **Deps** CFA-01
- **Accept** Observed behaviour matches the documented inference, or the finding is revised.
- **Rollback** Delete the throwaway Worker.
- **Impact** none · **Artifact** Appendix D D-29

#### WDV-07 — Decide the long-term addressing strategy for the API
- **Evidence** A pinned workers.dev host is a permanent dependency on a Cloudflare convenience feature.
- **Scope** Choose: keep workers.dev forever, or ship a mobile release that moves to a custom domain and keep both live during the overlap. **Non-goals** breaking the shipped app.
- **Do** Record as AD-08.
- **Mutation** `RO` · **Owner** B+X · **Deps** WDV-04
- **Accept** A decision with an overlap window measured in app versions, not days.
- **Rollback** n/a
- **Impact** X owns the client change · **Artifact** AD-08

#### WDV-08 — Measure how long an old mobile version stays in the field
- **Evidence** The overlap window in WDV-07 is unknowable without this.
- **Scope** Install-base by version. **Non-goals** collecting personal data.
- **Do** Read store console or existing telemetry; if neither exists, record that as the finding.
- **Mutation** `RO` · **Owner** X · **Deps** —
- **Accept** A number, or an explicit "we cannot currently tell", which is itself a gap to fix.
- **Rollback** n/a
- **Impact** X · **Artifact** Appendix D D-28

#### WDV-09 — Add a smoke check that the pinned host still answers
- **Evidence** The failure mode is silent: the host stops resolving and only the app notices.
- **Scope** One HTTPS GET to the pinned host asserting a 2xx/4xx application response rather than a Cloudflare error page. **Non-goals** authenticated calls.
- **Do** Add to the post-deploy checklist.
- **Mutation** `RO` · **Owner** B · **Deps** WDV-04
- **Accept** Check distinguishes error 1042 from an application 404.
- **Rollback** n/a
- **Impact** none · **Artifact** Appendix E CL-56

#### WDV-10 — Document the exact failure signature of a disabled workers.dev host
- **Evidence** Operators need to recognise it in seconds, not diagnose it.
- **Scope** HTTP status, Cloudflare error code, and what the app shows. **Non-goals** reproducing it in production.
- **Do** Record error 1042 and its meaning alongside a DNS-failure signature so the two are not confused.
- **Mutation** `RO` · **Owner** B · **Deps** —
- **Accept** Two distinguishable signatures documented.
- **Rollback** n/a
- **Impact** none · **Artifact** RD-02

#### WDV-11 — Make the deploy checklist require a workers.dev screenshot before and after
- **Evidence** The state is only observable in the dashboard for the undeclared Workers.
- **Scope** Two screenshots per deploy. **Non-goals** relying on config alone.
- **Do** Add to CL-14.
- **Mutation** `RO` · **Owner** B · **Deps** WDV-01
- **Accept** Checklist blocks on a missing screenshot.
- **Rollback** n/a
- **Impact** none · **Artifact** Appendix E CL-14

#### WDV-12 — Add a fixture proving the validator rejects an undeclared pinned host
- **Evidence** Rule R4 exists; a rule without a negative fixture is untested.
- **Scope** One invalid fixture. **Non-goals** none.
- **Do** Already present as `pinned-host-undeclared.invalid.json`; extend to the gateway case.
- **Mutation** `LOCAL` · **Owner** B · **Deps** —
- **Accept** Self-test count increases and still passes.
- **Rollback** Delete the fixture.
- **Impact** none · **Artifact** Appendix F fixture F-11

#### WDV-13 — Verify no wrangler config uses `workers_dev: false` implicitly via `routes`
- **Evidence** The inference is triggered by presence of `routes`, not by an explicit false.
- **Scope** All three configs and every named environment within them. **Non-goals** editing.
- **Do** Grep for `"routes"` and `"workers_dev"` per environment block.
- **Mutation** `RO` · **Owner** B · **Deps** —
- **Accept** A per-environment table of declared/inferred state.
- **Rollback** n/a
- **Impact** none · **Artifact** Appendix F rule L2

#### WDV-14 — Establish that the web Worker's `workers_dev: true` is deliberate
- **Evidence** `wrangler.jsonc:67` sets it true; whether that is intent or accident has not been recorded.
- **Scope** One sentence of recorded intent. **Non-goals** changing it.
- **Do** Confirm with Andri; record in the config as a comment.
- **Mutation** `LOCAL` · **Owner** H · **Deps** —
- **Accept** Comment present; intent recorded.
- **Rollback** Revert comment.
- **Impact** none · **Artifact** AD-08

#### WDV-15 — Add workers.dev state to the environment manifest schema
- **Evidence** The environment manifest describes environments; this is an environment property.
- **Scope** One optional boolean per Worker. **Non-goals** breaking existing manifests.
- **Do** Extend `environment-manifest.schema.json` with an optional field.
- **Mutation** `LOCAL` · **Owner** B · **Deps** —
- **Accept** Existing 8 self-tests still pass.
- **Rollback** Revert the schema.
- **Impact** none · **Artifact** Appendix F

#### WDV-16 — Write the one-paragraph explanation a reviewer needs on the PR
- **Evidence** The whole risk is that a reviewer approves a small diff without knowing the inference exists.
- **Scope** A PR template note. **Non-goals** a long document.
- **Do** Add to the repository PR template: "If this diff adds `routes` to a Worker, state explicitly what happens to its workers.dev hostname."
- **Mutation** `LOCAL` · **Owner** B · **Deps** —
- **Accept** Template contains the sentence.
- **Rollback** Revert.
- **Impact** A and X both see it · **Artifact** Appendix E CL-14

---

## Group E — gateway and OCPP continuity (12)

#### OCG-01 — Record the exact OCPP endpoint chargers are configured with
- **Evidence** Continuity can only be proven against a known value; the value lives in charger configuration, not in this repository.
- **Scope** Host, path, protocol, port. **Non-goals** contacting a charger.
- **Do** Read from the gateway config and from any onboarding documentation; mark unknowns explicitly.
- **Mutation** `RO` · **Owner** B · **Deps** —
- **Accept** A single canonical endpoint string, or a list of variants with counts.
- **Rollback** n/a
- **Impact** A owns OCPP semantics · **Artifact** Appendix D D-31

#### OCG-02 — Prove the gateway Worker terminates WebSockets on that endpoint
- **Evidence** The gateway is believed live; the proof is a connection, not a deployment record.
- **Scope** A protocol-level handshake check without authenticating as a charger. **Non-goals** sending any OCPP call.
- **Do** Attempt an upgrade and record the response status and headers only.
- **Mutation** `RO` · **Owner** B · **Deps** OCG-01
- **Accept** 101 or a documented rejection; either is evidence.
- **Rollback** n/a
- **Impact** none · **Artifact** Appendix D D-31

#### OCG-03 — Add `ocpp.endpointUnchanged` to every release manifest
- **Evidence** Field exists; rule R7 currently only warns.
- **Scope** Manifest authoring rule; consider promoting R7 to an error for gateway releases. **Non-goals** blocking web-only releases on it.
- **Do** Set explicitly per release.
- **Mutation** `LOCAL` · **Owner** B · **Deps** —
- **Accept** Rule R3 (new) errors when a gateway Worker is in the release and the field is absent.
- **Rollback** n/a
- **Impact** none · **Artifact** Appendix F rule R3

#### OCG-04 — Record the reconnect behaviour of the charger fleet
- **Evidence** A gateway restart produces a reconnect storm whose size nobody has measured.
- **Scope** Backoff, retry interval, and simultaneous-connection ceiling. **Non-goals** inducing a storm.
- **Do** Read from the OCPP specifications preserved in `docs/OCPP` and from charger vendor documentation.
- **Mutation** `RO` · **Owner** B+A · **Deps** —
- **Accept** A worst-case concurrent-connection figure to size against.
- **Rollback** n/a
- **Impact** A owns capacity · **Artifact** Appendix D D-32

#### OCG-05 — Define the maximum acceptable gateway downtime
- **Evidence** Without a number, "brief" is whatever the deploy took.
- **Scope** A stated ceiling in seconds, tied to charger reconnect behaviour. **Non-goals** a service-level agreement with customers.
- **Do** Derive from OCG-04.
- **Mutation** `RO` · **Owner** B · **Deps** OCG-04
- **Accept** A number that the deploy checklist can be measured against.
- **Rollback** n/a
- **Impact** none · **Artifact** Appendix E CL-24

#### OCG-06 — Separate gateway releases from web and API releases
- **Evidence** One release manifest covering three Workers means one rollback decision for three blast radii.
- **Scope** Gateway gets its own manifest and its own approval. **Non-goals** three separate pipelines.
- **Do** Manifest authoring rule; validator can enforce that a gateway Worker is alone in its manifest.
- **Mutation** `LOCAL` · **Owner** B · **Deps** —
- **Accept** Fixture proving a mixed manifest is flagged.
- **Rollback** n/a
- **Impact** none · **Artifact** Appendix F fixture F-19

#### OCG-07 — Record the DO namespace the gateway depends on
- **Evidence** Charger identity lives in `IDENTITY_DO`; a namespace change loses it silently.
- **Scope** Namespace id and class name. **Non-goals** migrating.
- **Do** From CFD-11 evidence.
- **Mutation** `RO` · **Owner** B · **Deps** CFD-11
- **Accept** Namespace id recorded in the gateway release manifest.
- **Rollback** n/a
- **Impact** A · **Artifact** Appendix D D-12

#### OCG-08 — Establish what happens to in-flight charging sessions during a gateway deploy
- **Evidence** A session in progress is a physical event with a customer attached.
- **Scope** Whether the charger continues delivering energy while disconnected, and how the session is reconciled afterwards. **Non-goals** testing on a live customer.
- **Do** Read the OCPP specification and the gateway's reconnect handling.
- **Mutation** `RO` · **Owner** A+B · **Deps** —
- **Accept** A written statement of behaviour, cited to specification and code.
- **Rollback** n/a
- **Impact** A owns session reconciliation · **Artifact** Appendix D D-33

#### OCG-09 — Choose a deploy window based on charging demand
- **Evidence** The safest gateway deploy is the one with the fewest active sessions.
- **Scope** A recurring low-usage window. **Non-goals** guessing without data.
- **Do** Derive from session data once a read path exists; until then, state the assumption.
- **Mutation** `RO` · **Owner** B · **Deps** —
- **Accept** A window, with the evidence or the explicit assumption behind it.
- **Rollback** n/a
- **Impact** none · **Artifact** Appendix E CL-24

#### OCG-10 — Add a gateway-specific post-deploy verification
- **Evidence** A web smoke test says nothing about whether chargers reconnected.
- **Scope** Connected-charger count before and after. **Non-goals** per-charger commands.
- **Do** Capture the count from whatever telemetry exists; if none exists, that is the finding.
- **Mutation** `RO` · **Owner** B · **Deps** OCG-02
- **Accept** A before/after pair, or an explicit statement that the count is not observable.
- **Rollback** n/a
- **Impact** none · **Artifact** Appendix E CL-58

#### OCG-11 — Write the gateway rollback drill
- **Evidence** Rolling back the gateway is different from rolling back the web app because the clients are physical.
- **Scope** Detection, containment, rollback, verification. **Non-goals** a generic runbook.
- **Do** See RD-04.
- **Mutation** `RO` · **Owner** B · **Deps** OCG-05
- **Accept** Drill exists with a measured rollback time target.
- **Rollback** n/a
- **Impact** none · **Artifact** RD-04

#### OCG-12 — Confirm the gateway's service binding to the API survives a rename
- **Evidence** `gateway/wrangler.jsonc:64-65` binds `MAIN_APP` to `hlada-api-staging` by name; renaming the API Worker breaks it.
- **Scope** The rename plan must update the binding in the same change. **Non-goals** renaming now.
- **Do** Add the binding to the rename checklist as a required simultaneous edit.
- **Mutation** `RO` · **Owner** B · **Deps** —
- **Accept** Checklist names the binding and its file:line.
- **Rollback** n/a
- **Impact** none · **Artifact** Appendix E CL-15

---

## Group F — same-zone fetch and service bindings (12)

#### SZB-01 — Enumerate every Worker-to-Worker call path
- **Evidence** Four paths exist; three use service bindings and one uses plain HTTPS.
- **Scope** Caller, callee, mechanism, and the file:line that establishes it. **Non-goals** changing any.
- **Do** Read the three wrangler configs and grep for cross-Worker fetches.
- **Mutation** `RO` · **Owner** B · **Deps** —
- **Accept** A four-row table with citations.
- **Rollback** n/a
- **Impact** A · **Artifact** Appendix D D-23

#### SZB-02 — Mark the web→API path as the single same-zone risk
- **Evidence** It is the only path whose success depends on `api.straumvakt.org` being a Custom Domain rather than a route.
- **Scope** One explicit risk record. **Non-goals** fixing it in the same step.
- **Do** Record in the execution index as finding F-08.
- **Mutation** `RO` · **Owner** B · **Deps** SZB-01
- **Accept** Risk recorded with its failure mode: the request loops back to the calling Worker instead of reaching the API.
- **Rollback** n/a
- **Impact** X: the user-visible symptom is a hanging or 500-ing page · **Artifact** Execution index F-08

#### SZB-03 — Design the service binding that removes the dependency
- **Evidence** A service binding does not traverse the edge and is therefore immune to route-versus-domain semantics.
- **Scope** Binding name, target Worker, and the call-site change. **Non-goals** deploying it.
- **Do** Propose `API` binding in the web Worker's config plus a fetch through `env.API`.
- **Mutation** `LOCAL` · **Owner** B+A · **Deps** SZB-02
- **Accept** A reviewable diff that compiles.
- **Rollback** Revert.
- **Impact** A owns the API surface · **Artifact** AD-09

#### SZB-04 — Determine whether the API relies on request Host or Origin
- **Evidence** A service binding changes the inbound request's apparent origin; auth and CORS logic can depend on it.
- **Scope** Grep the API for Host, Origin, and referer checks. **Non-goals** relaxing any check.
- **Do** Search `apps/api/src` for header reads.
- **Mutation** `RO` · **Owner** B · **Deps** SZB-03
- **Accept** Every dependency is listed with its file:line and a statement of behaviour under a binding.
- **Rollback** n/a
- **Impact** A must confirm · **Artifact** Appendix D D-23

#### SZB-05 — Determine whether cookies survive the binding path
- **Evidence** Session cookies are domain-scoped; a binding call is not a browser request.
- **Scope** Whether the web Worker forwards credentials explicitly. **Non-goals** changing session handling.
- **Do** Inspect the current fetch call for header forwarding.
- **Mutation** `RO` · **Owner** B · **Deps** SZB-03
- **Accept** Explicit statement of which headers are forwarded today.
- **Rollback** n/a
- **Impact** A · **Artifact** Appendix D D-23

#### SZB-06 — Keep the HTTPS path available behind a flag during transition
- **Evidence** Switching a call path is exactly the kind of change that should be reversible without a deploy.
- **Scope** A configuration switch between binding and HTTPS. **Non-goals** permanent dual paths.
- **Do** Propose an environment variable read at startup.
- **Mutation** `LOCAL` · **Owner** B+A · **Deps** SZB-03
- **Accept** Both paths exercised in a local test.
- **Rollback** Flip the flag.
- **Impact** A · **Artifact** AD-09

#### SZB-07 — Verify the binding works in local development
- **Evidence** Service bindings behave differently under `wrangler dev` than in production.
- **Scope** Multi-worker local dev. **Non-goals** cloud testing.
- **Do** Run both Workers locally with the binding configured.
- **Mutation** `LOCAL` · **Owner** B · **Deps** SZB-03
- **Accept** A request through the binding returns the API's response locally.
- **Rollback** n/a
- **Impact** X can then develop against it · **Artifact** Appendix E CL-19

#### SZB-08 — Record what a service binding does NOT solve
- **Evidence** Bindings remove an edge dependency; they do not remove the need for a Custom Domain for external clients.
- **Scope** An explicit non-goals note. **Non-goals** overselling the change.
- **Do** State that the mobile app and browsers still reach the API over the public hostname.
- **Mutation** `RO` · **Owner** B · **Deps** SZB-03
- **Accept** Note present in AD-09.
- **Rollback** n/a
- **Impact** X · **Artifact** AD-09

#### SZB-09 — Add a validator rule for same-zone route targets
- **Evidence** A manifest that declares a route-based Worker-to-Worker target should not pass silently.
- **Scope** Rule R8 extension: error, not warning, when a caller reaches a callee over a route on the same zone. **Non-goals** blocking Custom Domain targets.
- **Do** Implement as rule R8b.
- **Mutation** `LOCAL` · **Owner** B · **Deps** —
- **Accept** Fixture rejects the unsafe shape.
- **Rollback** Revert.
- **Impact** none · **Artifact** Appendix F rule R8

#### SZB-10 — Measure the latency difference before committing to the change
- **Evidence** A binding is expected to be faster, but "expected" has been wrong here before.
- **Scope** Local measurement only. **Non-goals** production benchmarking.
- **Do** Time both paths locally over a representative request.
- **Mutation** `LOCAL` · **Owner** B · **Deps** SZB-07
- **Accept** Two numbers recorded, with the caveat that local timings do not predict edge timings.
- **Rollback** n/a
- **Impact** none · **Artifact** Appendix D D-23

#### SZB-11 — Decide the adoption order across environments
- **Evidence** Changing beta and production simultaneously removes the ability to compare.
- **Scope** Beta first, soak, then production. **Non-goals** a single big-bang change.
- **Do** Record in AD-09 with a soak period.
- **Mutation** `RO` · **Owner** B · **Deps** SZB-03
- **Accept** A stated soak period with a defined success signal.
- **Rollback** n/a
- **Impact** none · **Artifact** AD-09

#### SZB-12 — Write the rollback drill for a failed binding cutover
- **Evidence** The failure is a total web-to-API outage, which is the worst-looking failure the product can have.
- **Scope** Detection, containment, rollback. **Non-goals** a generic drill.
- **Do** See RD-05.
- **Mutation** `RO` · **Owner** B · **Deps** SZB-06
- **Accept** Drill names the flag flip as the first containment step.
- **Rollback** n/a
- **Impact** none · **Artifact** RD-05

---

## Group G — release manifest and validator (18)

#### RMV-01 — Promote rule R7 from warning to error for gateway releases
- **Evidence** OCPP continuity is the highest-consequence omission and it currently only warns.
- **Scope** Error when any Worker has role `ocpp`. **Non-goals** erroring on web-only releases.
- **Do** Edit the policy function.
- **Mutation** `LOCAL` · **Owner** B · **Deps** OCG-03
- **Accept** New fixture rejected; existing fixtures still pass.
- **Rollback** Revert.
- **Impact** none · **Artifact** Appendix F rule R3

#### RMV-02 — Add rule: production release must not reuse a beta Neon branch
- **Evidence** Already implemented as R6 for one hard-coded id; generalise it.
- **Scope** Any branch id recorded as beta in the environment manifest. **Non-goals** hard-coding more ids.
- **Do** Accept a beta branch list, or keep the explicit id and document why.
- **Mutation** `LOCAL` · **Owner** B · **Deps** —
- **Accept** Fixture with a beta branch in a production manifest is rejected.
- **Rollback** Revert.
- **Impact** A · **Artifact** Appendix F rule R6

#### RMV-03 — Add rule: reject value-shaped strings anywhere, not only in secret names
- **Evidence** R5 currently checks `secretNames` only; a DSN could be pasted into `notes`.
- **Scope** A whole-document scan for connection-string and token shapes. **Non-goals** rejecting ordinary prose containing a colon.
- **Do** Scan string leaves for `postgres://`, `npg_`, long base64, and bearer shapes.
- **Mutation** `LOCAL` · **Owner** B · **Deps** —
- **Accept** Fixture with a DSN in `notes` is rejected; a fixture with an ordinary sentence passes.
- **Rollback** Revert.
- **Impact** none · **Artifact** Appendix F rule R10

#### RMV-04 — Add rule: worker names must be from a known set
- **Evidence** A typo in a Worker name produces a manifest that validates but describes nothing real.
- **Scope** A known-names list maintained beside the schema. **Non-goals** blocking new Workers permanently.
- **Do** Add a `known-workers.json` and check membership, with an override field requiring a reason.
- **Mutation** `LOCAL` · **Owner** B · **Deps** —
- **Accept** Unknown name rejected unless `newWorkerJustification` is present.
- **Rollback** Revert.
- **Impact** none · **Artifact** Appendix F rule R11

#### RMV-05 — Add rule: CPMS integration owner must be captured before a production release
- **Evidence** CPMS declares the same Worker names; a production release while CPMS still owns a deploy path is a collision waiting to happen.
- **Scope** A required field for production manifests recording that the Git integration owner has been verified. **Non-goals** blocking beta.
- **Do** Add `cpmsSeparationVerified` required when `environment === "production"`.
- **Mutation** `LOCAL` · **Owner** B · **Deps** CFD-08
- **Accept** Production fixture without it is rejected.
- **Rollback** Revert.
- **Impact** none · **Artifact** Appendix F rule R12

#### RMV-06 — Add rule: gateway release must be alone in its manifest
- **Evidence** OCG-06.
- **Scope** Error when an `ocpp` Worker appears alongside `web` or `api`. **Non-goals** preventing three manifests in one day.
- **Do** Implement in policy.
- **Mutation** `LOCAL` · **Owner** B · **Deps** OCG-06
- **Accept** Mixed fixture rejected.
- **Rollback** Revert.
- **Impact** none · **Artifact** Appendix F rule R13

#### RMV-07 — Add rule: `restoreTimeMeasuredSec` required for production
- **Evidence** A rollback plan with an unmeasured duration is an estimate wearing a plan's clothes.
- **Scope** Required, non-null, for production manifests. **Non-goals** beta.
- **Do** Implement in policy.
- **Mutation** `LOCAL` · **Owner** B · **Deps** —
- **Accept** Production fixture without a measured time is rejected.
- **Rollback** Revert.
- **Impact** none · **Artifact** Appendix F rule R14

#### RMV-08 — Add rule: excluded commits must be listed and verified absent
- **Evidence** The standing rules forbid `4fe0a95` in any release candidate; the schema has the field but nothing requires it.
- **Scope** `approval.excludedCommitsVerifiedAbsent` must contain the known-forbidden shas. **Non-goals** hard-coding a growing list in code.
- **Do** Read the forbidden list from a data file beside the schema.
- **Mutation** `LOCAL` · **Owner** B · **Deps** —
- **Accept** A manifest missing a forbidden sha from the verified list is rejected.
- **Rollback** Revert.
- **Impact** A · **Artifact** Appendix F rule R15

#### RMV-09 — Add rule: `betaTestedSince` must precede the release timestamp
- **Evidence** The field can currently be set to any string, including a future instant.
- **Scope** Parse and compare. **Non-goals** timezone gymnastics — require UTC with `Z`.
- **Do** Add a pattern plus an ordering check.
- **Mutation** `LOCAL` · **Owner** B · **Deps** —
- **Accept** Fixture with a future `betaTestedSince` is rejected.
- **Rollback** Revert.
- **Impact** none · **Artifact** Appendix F rule R16

#### RMV-10 — Add a `releasedAt` field so ordering rules have an anchor
- **Evidence** RMV-09 needs something to compare against.
- **Scope** One required UTC instant. **Non-goals** deriving it from the filesystem.
- **Do** Schema addition plus fixture updates.
- **Mutation** `LOCAL` · **Owner** B · **Deps** —
- **Accept** All fixtures updated; self-test passes.
- **Rollback** Revert.
- **Impact** none · **Artifact** Appendix F

#### RMV-11 — Write a manifest for the current beta state as a worked example
- **Evidence** Every rule so far is tested against synthetic fixtures only.
- **Scope** One manifest describing the beta estate as it actually is. **Non-goals** claiming it represents an approved release.
- **Do** Fill from evidence once CFI-12 exists; until then, mark unknown fields explicitly.
- **Mutation** `LOCAL` · **Owner** B · **Deps** CFI-12
- **Accept** The validator's rejections are all real gaps, each with a work item.
- **Rollback** Delete.
- **Impact** none · **Artifact** Appendix F

#### RMV-12 — Add a `--strict` mode that treats warnings as errors
- **Evidence** Production should not be able to proceed on warnings.
- **Scope** A flag. **Non-goals** changing default behaviour for beta.
- **Do** Implement and use in the production checklist.
- **Mutation** `LOCAL` · **Owner** B · **Deps** —
- **Accept** A manifest that passes normally fails under `--strict` when it has warnings.
- **Rollback** Revert.
- **Impact** none · **Artifact** Appendix F

#### RMV-13 — Add machine-readable output for the validator
- **Evidence** Checklists want a pass/fail artifact, not console text.
- **Scope** `--json` emitting `{file, errors[], warnings[]}`. **Non-goals** a reporting service.
- **Do** Implement.
- **Mutation** `LOCAL` · **Owner** B · **Deps** —
- **Accept** Output parses as JSON and is committed as release evidence.
- **Rollback** Revert.
- **Impact** none · **Artifact** Appendix F

#### RMV-14 — Document that the manifest is evidence, not an instruction
- **Evidence** The single most dangerous misreading of this artifact would be for something to start applying it.
- **Scope** A statement in the schema description and at the top of the validator. **Non-goals** building an applier.
- **Do** Already present; keep it and add it to the checklist header.
- **Mutation** `LOCAL` · **Owner** B · **Deps** —
- **Accept** Statement present in three places.
- **Rollback** n/a
- **Impact** none · **Artifact** Appendix F

#### RMV-15 — Add a fixture for a manifest with zero workers
- **Evidence** `minItems: 1` exists; an untested constraint is a hope.
- **Scope** One invalid fixture. **Non-goals** none.
- **Do** Create.
- **Mutation** `LOCAL` · **Owner** B · **Deps** —
- **Accept** Rejected with a `needs >= 1` message.
- **Rollback** Delete.
- **Impact** none · **Artifact** Appendix F fixture F-20

#### RMV-16 — Add a fixture for a manifest with an unexpected top-level property
- **Evidence** `additionalProperties: false` is the strongest anti-typo defence in the schema.
- **Scope** One invalid fixture with a plausible typo such as `enviroment`.
- **Do** Create.
- **Mutation** `LOCAL` · **Owner** B · **Deps** —
- **Accept** Rejected for both the unexpected property and the missing required one.
- **Rollback** Delete.
- **Impact** none · **Artifact** Appendix F fixture F-21

#### RMV-17 — Run both validators from a single command
- **Evidence** Two validators with two self-tests is two chances to forget one.
- **Scope** One script that runs both and exits non-zero if either fails. **Non-goals** a build system.
- **Do** Add `scripts/analysis/manifest/self-test-all.mjs` or document the two commands together.
- **Mutation** `LOCAL` · **Owner** B · **Deps** —
- **Accept** One command, combined count reported.
- **Rollback** Revert.
- **Impact** none · **Artifact** Appendix F

#### RMV-18 — Keep the validator dependency-free and prove it
- **Evidence** The point of a hand-rolled schema subset is that it runs anywhere with no install.
- **Scope** An import audit. **Non-goals** adding a JSON Schema library.
- **Do** Grep for `import` and assert only `node:` builtins appear.
- **Mutation** `RO` · **Owner** B · **Deps** —
- **Accept** Only `node:fs`, `node:path`, `node:url`.
- **Rollback** n/a
- **Impact** none · **Artifact** Appendix F

---

## Group H — GitHub branch safety and protection (18)

#### GBS-01 — Unset the upstream on `dev/rename-prod-worker`
- **Evidence** It tracks `origin/staging` and carries the forbidden commit `4fe0a95`; a bare `git push` from it would put that commit on the branch serving the brand domain.
- **Scope** One `--unset-upstream`. **Non-goals** deleting the branch or the work.
- **Do** `git branch --unset-upstream dev/rename-prod-worker`
- **Mutation** `LOCAL` + `APPROVAL` · **Owner** H · **Deps** —
- **Accept** `git rev-parse --abbrev-ref @{u}` fails for that branch; no remote ref changed.
- **Rollback** `git branch -u origin/staging` restores it.
- **Impact** none · **Artifact** Appendix E CL-25

#### GBS-02 — Unset the upstream on `dev/secret-hygiene-v2`
- **Evidence** Same tracking configuration, same one-keystroke failure mode.
- **Scope** As GBS-01. **Non-goals** none.
- **Do** `git branch --unset-upstream dev/secret-hygiene-v2`
- **Mutation** `LOCAL` + `APPROVAL` · **Owner** H · **Deps** —
- **Accept** As GBS-01.
- **Rollback** Re-set the upstream.
- **Impact** none · **Artifact** Appendix E CL-25

#### GBS-03 — Audit every local branch's upstream across every worktree
- **Evidence** Two were found by inspection; nobody has checked the rest systematically.
- **Scope** All worktrees, all local branches. **Non-goals** changing any without approval.
- **Do** `git for-each-ref --format='%(refname:short) -> %(upstream:short)' refs/heads`
- **Mutation** `RO` · **Owner** B · **Deps** —
- **Accept** A complete table; any branch tracking `staging` or `main` is flagged.
- **Rollback** n/a
- **Impact** A and X both have branches · **Artifact** Appendix D D-34

#### GBS-04 — Set `push.default = simple` and verify it is in effect
- **Evidence** The dangerous behaviour depends on push configuration that nobody has stated.
- **Scope** Repository-level configuration. **Non-goals** global machine changes without asking.
- **Do** `git config push.default simple` then `git config --get push.default`
- **Mutation** `LOCAL` + `APPROVAL` · **Owner** H · **Deps** —
- **Accept** Value reported as `simple`.
- **Rollback** Unset.
- **Impact** none · **Artifact** Appendix E CL-25

#### GBS-05 — Add a pre-push hook that refuses pushes to `staging` and `main`
- **Evidence** Configuration protects against one mistake; a hook protects against the class.
- **Scope** A local hook that exits non-zero for those refs. **Non-goals** a server-side rule, which is GBS-07.
- **Do** Write `.git/hooks/pre-push` in each worktree, or use `core.hooksPath`.
- **Mutation** `LOCAL` + `APPROVAL` · **Owner** H · **Deps** —
- **Accept** A dry-run push to `staging` is refused locally.
- **Rollback** Delete the hook.
- **Impact** A and X share the repository · **Artifact** Appendix E CL-26

#### GBS-06 — Record the current protection state as evidence, not memory
- **Evidence** 0 of 16 branches protected and rulesets empty — captured once, never re-verified.
- **Scope** `gh api` output saved to the evidence directory. **Non-goals** enabling protection in the same step.
- **Do** `gh api repos/{owner}/{repo}/branches --paginate` and `.../rulesets`
- **Mutation** `RO` · **Owner** B · **Deps** —
- **Accept** JSON saved and hashed.
- **Rollback** n/a
- **Impact** none · **Artifact** Appendix D D-35

#### GBS-07 — Enable branch protection on the deploy pointer branch
- **Evidence** `origin/staging` is treated as a production deploy pointer and is unprotected.
- **Scope** Require a pull request, block force pushes, block deletion. **Non-goals** requiring status checks that do not exist yet.
- **Do** Repository → Settings → Rules → Rulesets.
- **Mutation** `EXT` + `APPROVAL` · **Owner** H · **Deps** GBS-06
- **Accept** A force push to `staging` is rejected by the server.
- **Rollback** Disable the ruleset.
- **Impact** A and X must open PRs afterwards · **Artifact** AD-04

#### GBS-08 — Enable branch protection on `main`
- **Evidence** `main` is the nominal default and is equally unprotected.
- **Scope** As GBS-07. **Non-goals** changing the default branch in the same step.
- **Do** Same page.
- **Mutation** `EXT` + `APPROVAL` · **Owner** H · **Deps** GBS-06
- **Accept** Force push rejected.
- **Rollback** Disable.
- **Impact** A and X · **Artifact** AD-04

#### GBS-09 — Decide and record which branch is the trunk
- **Evidence** The repository has a stale default branch and a separate deploy pointer; neither is unambiguously the trunk.
- **Scope** One named trunk with a written rationale. **Non-goals** rewriting history.
- **Do** Record in AD-04.
- **Mutation** `RO` · **Owner** H · **Deps** —
- **Accept** A single branch named, and every worktree's relationship to it stated.
- **Rollback** n/a
- **Impact** A and X branch from it · **Artifact** AD-04

#### GBS-10 — Repoint the repository default branch to the trunk
- **Evidence** A stale default sends every new clone and every PR base to the wrong place.
- **Scope** One setting. **Non-goals** deleting the old default.
- **Do** Settings → General → Default branch.
- **Mutation** `EXT` + `APPROVAL` · **Owner** H · **Deps** GBS-09
- **Accept** A fresh clone checks out the trunk.
- **Rollback** Change it back; open PRs retarget automatically.
- **Impact** A and X · **Artifact** AD-04

#### GBS-11 — Verify no open pull request targets the wrong base
- **Evidence** Changing the default retargets some PRs and not others.
- **Scope** `gh pr list --json baseRefName`. **Non-goals** merging anything.
- **Do** List and compare against the intended trunk.
- **Mutation** `RO` · **Owner** B · **Deps** GBS-10
- **Accept** Every open PR's base is intentional.
- **Rollback** n/a
- **Impact** A and X · **Artifact** Appendix D D-35

#### GBS-12 — Require linear history on the deploy pointer
- **Evidence** Fast-forward-only is already the intended deploy model; the server should enforce it.
- **Scope** Ruleset option. **Non-goals** forbidding merge commits everywhere.
- **Do** Ruleset → Require linear history.
- **Mutation** `EXT` + `APPROVAL` · **Owner** H · **Deps** GBS-07
- **Accept** A non-fast-forward merge to `staging` is rejected.
- **Rollback** Disable the option.
- **Impact** A and X · **Artifact** AD-04

#### GBS-13 — Record who can bypass the ruleset
- **Evidence** A ruleset with a broad bypass list is documentation, not protection.
- **Scope** The bypass actor list. **Non-goals** removing the owner's own bypass, which can lock the account out.
- **Do** Capture from the ruleset detail.
- **Mutation** `RO` · **Owner** B · **Deps** GBS-07
- **Accept** The list is short and every entry is justified.
- **Rollback** n/a
- **Impact** none · **Artifact** Appendix D D-35

#### GBS-14 — Decide the repository visibility
- **Evidence** The repository is public and a real secret has been committed to it in the past.
- **Scope** Public versus private, with the consequence for forks and existing clones. **Non-goals** assuming private makes leaked secrets safe.
- **Do** Record in AD-13.
- **Mutation** `RO` (decision) · **Owner** H · **Deps** —
- **Accept** A decision, plus the recognition that any leaked secret must still be rotated regardless.
- **Rollback** Visibility is reversible; leaked data is not.
- **Impact** none · **Artifact** AD-13

#### GBS-15 — Confirm the committed `AUTH_SECRET` is still not live
- **Evidence** It was verified absent from the API Worker once; that was a point-in-time check.
- **Scope** Re-verify against the captured secret evidence. **Non-goals** reading the live value.
- **Do** Compare the committed value's shape against the Worker's secret names and, where possible, a rotation timestamp.
- **Mutation** `RO` · **Owner** B · **Deps** CFD-09
- **Accept** Restated with a fresh timestamp, or escalated.
- **Rollback** n/a
- **Impact** A owns auth · **Artifact** Appendix D D-10

#### GBS-16 — Scrub the committed secret from the working tree
- **Evidence** It remains in `.env.example`; history rewriting is a separate, larger decision.
- **Scope** Replace with an obvious placeholder. **Non-goals** rewriting git history.
- **Do** Edit the file on a branch.
- **Mutation** `LOCAL` · **Owner** A · **Deps** —
- **Accept** The file contains no value-shaped string; a secret scan passes.
- **Rollback** Revert.
- **Impact** A owns this file · **Artifact** Appendix D D-36

#### GBS-17 — Add a secret scan to the offline linter set
- **Evidence** The project has already committed one real secret; the class of error is proven present.
- **Scope** Scan tracked files for DSN, token, and key shapes. **Non-goals** a network-based scanning service.
- **Do** Extend the offline linter.
- **Mutation** `LOCAL` · **Owner** B · **Deps** RMV-03
- **Accept** The known committed secret is detected by the scanner as a self-test.
- **Rollback** Revert.
- **Impact** A · **Artifact** Appendix F rule L5

#### GBS-18 — Record every remote branch and its last-touched date
- **Evidence** Sixteen remote branches exist and most were described as dead.
- **Scope** Name, tip, author date, and whether it is ahead of the trunk. **Non-goals** deleting any.
- **Do** `git ls-remote --heads` plus `git for-each-ref --sort=-committerdate refs/remotes`.
- **Mutation** `RO` · **Owner** B · **Deps** —
- **Accept** A table; nothing deleted.
- **Rollback** n/a
- **Impact** A and X own some · **Artifact** Appendix D D-34

---

## Group I — staging and default branch hygiene (10)

#### SBH-01 — Establish whether Cloudflare deploys from a branch at all
- **Evidence** `origin/staging` is *treated* as a production deploy pointer pending conclusive verification; the treatment is precautionary, not proven.
- **Scope** Fact F2 resolves this. **Non-goals** assuming either answer.
- **Do** From CFD-08.
- **Mutation** `RO` · **Owner** B · **Deps** CFD-08
- **Accept** A definitive yes or no, with the repository and branch named.
- **Rollback** n/a
- **Impact** A and X: it determines whether a merge is a deploy · **Artifact** Execution index F-02

#### SBH-02 — If a branch deploy exists, record the build command and output directory
- **Evidence** A build configuration nobody has read is a deployment nobody can predict.
- **Scope** Command, root directory, environment variables set at build time. **Non-goals** changing them.
- **Do** From the same dashboard page.
- **Mutation** `RO` · **Owner** B · **Deps** SBH-01
- **Accept** Captured verbatim.
- **Rollback** n/a
- **Impact** A · **Artifact** Appendix D D-09

#### SBH-03 — Compare `origin/staging` with the release candidate
- **Evidence** The release candidate is `4b69d0f`; whether staging is ahead, behind, or divergent has release consequences.
- **Scope** `git rev-list --left-right --count`. **Non-goals** merging.
- **Do** Run in the canonical checkout.
- **Mutation** `RO` · **Owner** B · **Deps** —
- **Accept** Two numbers; a non-zero left side means staging carries commits the candidate does not.
- **Rollback** n/a
- **Impact** A · **Artifact** Appendix D D-34

#### SBH-04 — Verify the forbidden commits are absent from `origin/staging`
- **Evidence** The standing rules name `4fe0a95`, `30fa407`, and `5311cbd`.
- **Scope** `git merge-base --is-ancestor` per sha. **Non-goals** removing them if present, which is a separate decision.
- **Do** Three checks.
- **Mutation** `RO` · **Owner** B · **Deps** —
- **Accept** A per-sha present/absent result recorded.
- **Rollback** n/a
- **Impact** A · **Artifact** Appendix D D-34

#### SBH-05 — Verify the forbidden commits are absent from the release candidate
- **Evidence** The release candidate is the thing that would actually be promoted.
- **Scope** As SBH-04 against `4b69d0f`. **Non-goals** none.
- **Do** Three checks.
- **Mutation** `RO` · **Owner** B · **Deps** —
- **Accept** All three absent, or the candidate is disqualified.
- **Rollback** n/a
- **Impact** A · **Artifact** Appendix F rule R15

#### SBH-06 — Define the promotion direction and write it down
- **Evidence** Promotion should be a fast-forward from a proven branch, not a rebuild from source.
- **Scope** trunk → staging → production, fast-forward only. **Non-goals** allowing cherry-picks into production.
- **Do** Record in AD-04 and enforce via rule R2.
- **Mutation** `RO` · **Owner** B · **Deps** GBS-09
- **Accept** Rule R2 already rejects a production manifest whose `sourceBranch` is not `staging`.
- **Rollback** n/a
- **Impact** A and X · **Artifact** Appendix F rule R2

#### SBH-07 — Prove a promotion would be a fast-forward before approving it
- **Evidence** `verifiedFastForward` is a required manifest field precisely because this is easy to skip.
- **Scope** One `rev-list --left-right --count` with a zero on the left. **Non-goals** forcing it if it is not.
- **Do** Add to the release checklist.
- **Mutation** `RO` · **Owner** B · **Deps** SBH-06
- **Accept** Checklist blocks when the left count is non-zero.
- **Rollback** n/a
- **Impact** none · **Artifact** Appendix E CL-51

#### SBH-08 — Stop treating the stale default branch as meaningful
- **Evidence** It is stale and it misleads every tool that defaults to it.
- **Scope** Either repoint it or archive it with a clear name. **Non-goals** deleting history.
- **Do** GBS-10 covers the repoint.
- **Mutation** `EXT` + `APPROVAL` · **Owner** H · **Deps** GBS-10
- **Accept** No tool defaults to a branch nobody uses.
- **Rollback** Revert the setting.
- **Impact** A and X · **Artifact** AD-04

#### SBH-09 — Record the relationship of every worktree branch to the trunk
- **Evidence** Six active worktrees exist across three agents; their divergence is not tracked anywhere.
- **Scope** ahead/behind counts per worktree. **Non-goals** rebasing anyone's work.
- **Do** Loop the worktrees and compute counts against the trunk.
- **Mutation** `RO` · **Owner** B · **Deps** GBS-09
- **Accept** A table refreshed at the start of each release.
- **Rollback** n/a
- **Impact** A and X read it · **Artifact** Appendix D D-34

#### SBH-10 — Establish a rule for what may be merged during a release freeze
- **Evidence** Three agents are committing concurrently; a release with no freeze is a moving target.
- **Scope** A named freeze window and what may land in it. **Non-goals** stopping all work.
- **Do** Record in AD-16.
- **Mutation** `RO` · **Owner** B · **Deps** —
- **Accept** A written rule that A and X can follow without asking.
- **Rollback** n/a
- **Impact** A and X · **Artifact** AD-16

---

## Group J — Neon production runway (18)

#### NPR-01 — Record the current Neon project inventory as evidence
- **Evidence** One project, no production project, 13 branches, none protected — captured once.
- **Scope** Project id, name, region, branch list. **Non-goals** creating anything.
- **Do** Metadata read only.
- **Mutation** `RO` · **Owner** B · **Deps** —
- **Accept** JSON saved and hashed.
- **Rollback** n/a
- **Impact** A owns the schema · **Artifact** Appendix D D-37

#### NPR-02 — Record which branch each environment actually uses
- **Evidence** The project default branch is abandoned; anything that defaults reaches the wrong data.
- **Scope** Per-environment branch id, explicitly. **Non-goals** repointing.
- **Do** Cross-reference Hyperdrive origin and Worker secrets by name.
- **Mutation** `RO` · **Owner** B · **Deps** CFI-09
- **Accept** Every environment maps to an explicit `br-` id.
- **Rollback** n/a
- **Impact** A · **Artifact** Appendix D D-38

#### NPR-03 — Protect the branch that beta actually uses
- **Evidence** No branch is protected; the one carrying real beta data is the one that matters.
- **Scope** Neon branch protection on `br-tiny-river-abgpqq37`. **Non-goals** protecting all 13.
- **Do** Neon console → Branches → Protect.
- **Mutation** `EXT` + `APPROVAL` · **Owner** H · **Deps** NPR-02
- **Accept** Deleting the branch is refused by the console.
- **Rollback** Unprotect.
- **Impact** A · **Artifact** AD-05

#### NPR-04 — Repoint the project default branch away from the abandoned one
- **Evidence** The default-branch trap has already caused wrong-branch reads in this project.
- **Scope** One setting change. **Non-goals** deleting the abandoned branch.
- **Do** Neon console → Branches → Set as default.
- **Mutation** `EXT` + `APPROVAL` · **Owner** H · **Deps** NPR-02
- **Accept** A tool that omits a branch id reaches the intended branch.
- **Rollback** Set it back.
- **Impact** A · **Artifact** AD-06

#### NPR-05 — Decide whether production gets its own Neon project
- **Evidence** A branch inside the beta project shares its compute, its limits, and its blast radius.
- **Scope** Separate project versus separate branch. **Non-goals** deciding by default.
- **Do** Record in AD-05 with the isolation and cost consequences.
- **Mutation** `RO` · **Owner** H · **Deps** NPR-01
- **Accept** A decision with a stated reason.
- **Rollback** n/a
- **Impact** A · **Artifact** AD-05

#### NPR-06 — Create the production project or branch
- **Evidence** Production currently has no data home at all.
- **Scope** One project or branch, protected from creation. **Non-goals** copying beta data into it.
- **Do** Neon console.
- **Mutation** `EXT` + `APPROVAL` · **Owner** H · **Deps** NPR-05
- **Accept** Branch id recorded and immediately entered into the production release manifest.
- **Rollback** Delete it while it is still empty.
- **Impact** A · **Artifact** AD-05

#### NPR-07 — Decide what production starts with: empty or seeded
- **Evidence** Copying beta data into production carries real customer records from a test context.
- **Scope** Empty schema versus seeded reference data. **Non-goals** copying beta rows.
- **Do** Record with the data-protection consequence stated.
- **Mutation** `RO` · **Owner** H+A · **Deps** NPR-06
- **Accept** A decision, and an explicit statement that beta personal data does not move.
- **Rollback** n/a
- **Impact** A owns the seed · **Artifact** AD-05

#### NPR-08 — Reconcile the migration history before production exists
- **Evidence** `_prisma_migrations` state and the migration directory have diverged before in this project.
- **Scope** Compare recorded migrations against files. **Non-goals** running `migrate deploy` anywhere.
- **Do** Read `_prisma_migrations` metadata only.
- **Mutation** `RO` · **Owner** A · **Deps** —
- **Accept** A per-migration applied/pending table.
- **Rollback** n/a
- **Impact** A owns it · **Artifact** Appendix D D-39

#### NPR-09 — Decide `migrate deploy` versus `resolve --applied` per divergence
- **Evidence** Choosing wrong either re-runs a migration or hides one.
- **Scope** A per-migration decision with a reason. **Non-goals** a blanket resolve.
- **Do** Record in the migration operator pack.
- **Mutation** `RO` · **Owner** A · **Deps** NPR-08
- **Accept** Every divergent row has a named action.
- **Rollback** n/a
- **Impact** A · **Artifact** Appendix E CL-33

#### NPR-10 — Establish the dual-ORM position before production
- **Evidence** Prisma and Drizzle both exist in this codebase; two migration authorities is one too many.
- **Scope** Which owns the schema. **Non-goals** removing the other in the same change.
- **Do** Record; A decides.
- **Mutation** `RO` · **Owner** A · **Deps** —
- **Accept** One named owner of schema truth.
- **Rollback** n/a
- **Impact** A · **Artifact** AD-05

#### NPR-11 — Record connection limits and compute size for the intended branch
- **Evidence** Worker concurrency and Postgres connection limits meet at exactly one place, and it is usually discovered under load.
- **Scope** Compute size, autoscaling bounds, max connections. **Non-goals** load testing production.
- **Do** Neon console metadata.
- **Mutation** `RO` · **Owner** B · **Deps** NPR-02
- **Accept** Numbers recorded and compared against the expected charger and user concurrency.
- **Rollback** n/a
- **Impact** A · **Artifact** Appendix D D-40

#### NPR-12 — Confirm whether Hyperdrive pooling is in the path
- **Evidence** Hyperdrive changes the connection arithmetic entirely, and its presence has not been confirmed for every Worker.
- **Scope** Per-Worker. **Non-goals** enabling it.
- **Do** From CFI-09 and CFI-04.
- **Mutation** `RO` · **Owner** B · **Deps** CFI-09
- **Accept** A per-Worker yes/no.
- **Rollback** n/a
- **Impact** A · **Artifact** Appendix D D-14

#### NPR-13 — Plan the production connection string as a secret, not a config value
- **Evidence** A DSN contains a credential; several places in this project treat it as configuration.
- **Scope** Secret binding only. **Non-goals** any plaintext variable containing a DSN.
- **Do** Record the required secret name; never the value.
- **Mutation** `RO` · **Owner** B · **Deps** —
- **Accept** No captured evidence anywhere contains a DSN; validator rule R10 enforces it.
- **Rollback** n/a
- **Impact** A · **Artifact** Appendix F rule R10

#### NPR-14 — Decide the production database role and its privileges
- **Evidence** Application code running as an owner role can drop tables it should not be able to see.
- **Scope** A least-privilege application role. **Non-goals** creating roles now.
- **Do** Specify the grants; A implements when approved.
- **Mutation** `RO` · **Owner** A · **Deps** NPR-06
- **Accept** A written grant list with no `DROP` on application tables.
- **Rollback** n/a
- **Impact** A · **Artifact** AD-07

#### NPR-15 — Record the 32 dropped tables as a standing caution
- **Evidence** Thirty-two tables were dropped on test and staging on the assumption that empty meant unused; relation loads hid the references.
- **Scope** A rule: emptiness is never sufficient evidence for dropping. **Non-goals** restoring them.
- **Do** Record as a schema-change precondition.
- **Mutation** `RO` · **Owner** B · **Deps** —
- **Accept** Every future drop requires a code-reference search, not just a row count.
- **Rollback** n/a
- **Impact** A · **Artifact** Appendix E CL-34

#### NPR-16 — Require a backup branch before any production schema change
- **Evidence** Neon branches are copy-on-write, so a pre-change branch is nearly free and is the only cheap undo.
- **Scope** One branch per schema change. **Non-goals** relying on PITR alone.
- **Do** Add to the migration checklist; the manifest already has `backupBranchId`.
- **Mutation** `RO` · **Owner** B · **Deps** —
- **Accept** Rule R9 warns when it is absent for production; consider promoting to error.
- **Rollback** n/a
- **Impact** A · **Artifact** Appendix F rule R9

#### NPR-17 — Establish the money-unit contract before any production billing
- **Evidence** The costing engine documents aurar, one hundredth of a króna; a session repository comment claims otherwise. Two mismatches currently cancel, and fixing either alone is wrong by a factor of one hundred.
- **Scope** One authoritative unit statement plus the list of every boundary that converts. **Non-goals** fixing one side in isolation.
- **Do** A owns the fix; both sides change in one commit with a test.
- **Mutation** `RO` here; the fix is A's `LOCAL` · **Owner** A · **Deps** —
- **Accept** A test that fails if either side is changed alone.
- **Rollback** n/a
- **Impact** A owns it; X displays it · **Artifact** Production no-go NG-07

#### NPR-18 — Confirm `powerKw: 0` is not shipped to customers as truth
- **Evidence** `apps/api/src/repositories/driver-sessions.ts:135` hardcodes zero.
- **Scope** Either populate it or mark it explicitly unavailable in the API contract. **Non-goals** inventing a value.
- **Do** A decides; X must not render zero as a measurement.
- **Mutation** `RO` here · **Owner** A+X · **Deps** —
- **Accept** The field is either real or absent; never a plausible-looking zero.
- **Rollback** n/a
- **Impact** X renders it · **Artifact** Production no-go NG-08

---

## Group K — Neon backup, restore and PITR (12)

#### NBK-01 — Record the exact PITR retention window
- **Evidence** Seven days is the current understanding; the plan depends on the number being right.
- **Scope** The configured history retention per project. **Non-goals** changing it.
- **Do** Neon console → Project settings.
- **Mutation** `RO` · **Owner** B · **Deps** —
- **Accept** A number in hours, captured with a screenshot.
- **Rollback** n/a
- **Impact** A · **Artifact** Appendix D D-41

#### NBK-02 — Decide whether to extend retention for production
- **Evidence** Seven days is shorter than the interval at which some classes of corruption are noticed.
- **Scope** Retention versus cost. **Non-goals** unlimited retention.
- **Do** Record in AD-05.
- **Mutation** `RO` · **Owner** H · **Deps** NBK-01
- **Accept** A chosen window with a stated reason.
- **Rollback** n/a
- **Impact** none · **Artifact** AD-05

#### NBK-03 — Establish deliberate backup branches as the long-horizon recovery
- **Evidence** Beyond the PITR ceiling, a branch created on purpose is the only recovery that exists.
- **Scope** A naming convention and a creation cadence. **Non-goals** automating creation before the naming is settled.
- **Do** Specify `backup-YYYY-MM-DD-<reason>`.
- **Mutation** `RO` · **Owner** B · **Deps** NBK-01
- **Accept** Convention recorded; manifest field `backupBranchId` uses it.
- **Rollback** n/a
- **Impact** A · **Artifact** Appendix E CL-35

#### NBK-04 — Measure how long a restore actually takes
- **Evidence** `restoreTimeMeasuredSec` is a manifest field with no measurement behind it.
- **Scope** One rehearsal on a throwaway branch. **Non-goals** rehearsing on beta or production data.
- **Do** Create a branch from a point in time, connect, verify, record elapsed seconds.
- **Mutation** `EXT` + `APPROVAL` · **Owner** H · **Deps** NBK-03
- **Accept** A measured number in the manifest, replacing the estimate.
- **Rollback** Delete the rehearsal branch.
- **Impact** A · **Artifact** Appendix E CL-36

#### NBK-05 — Rehearse restoring to a point before a bad migration
- **Evidence** The realistic disaster is a migration, not a disk failure.
- **Scope** Apply a harmless migration on a throwaway branch, then restore to before it. **Non-goals** touching beta.
- **Do** Rehearsal only.
- **Mutation** `EXT` + `APPROVAL` · **Owner** H · **Deps** NBK-04
- **Accept** The schema returns to its prior state and the elapsed time is recorded.
- **Rollback** Delete the rehearsal branch.
- **Impact** A · **Artifact** RD-06

#### NBK-06 — Establish what a restore does to Worker connections
- **Evidence** A restored branch has a different endpoint; the Workers point at the old one.
- **Scope** The full cutover: restore, then repoint the secret or Hyperdrive, then redeploy or restart. **Non-goals** assuming the restore alone is the recovery.
- **Do** Write the sequence.
- **Mutation** `RO` · **Owner** B · **Deps** NBK-04
- **Accept** The sequence names every place the endpoint appears.
- **Rollback** n/a
- **Impact** A · **Artifact** RD-06

#### NBK-07 — Record the data-loss window a restore implies
- **Evidence** Restoring to before a bad migration also discards everything written since.
- **Scope** An explicit statement that restore is lossy, and how much. **Non-goals** pretending otherwise.
- **Do** Add to every restore checklist as a stop-and-think line.
- **Mutation** `RO` · **Owner** B · **Deps** —
- **Accept** The line appears before the restore command, not after it.
- **Rollback** n/a
- **Impact** A · **Artifact** Appendix E CL-36

#### NBK-08 — Decide who may authorise a production restore
- **Evidence** A restore is irreversible in the sense that the discarded writes do not come back.
- **Scope** One named person. **Non-goals** an on-call rotation that does not exist.
- **Do** Record in AD-16.
- **Mutation** `RO` · **Owner** H · **Deps** —
- **Accept** A name, and what to do when that person is unreachable.
- **Rollback** n/a
- **Impact** none · **Artifact** AD-16

#### NBK-09 — Verify a restored branch passes the application's own health checks
- **Evidence** A branch that connects is not the same as a branch the application can use.
- **Scope** Schema version, row counts on key tables, a read through the API. **Non-goals** writing to it.
- **Do** Add to the restore checklist.
- **Mutation** `RO` · **Owner** B+A · **Deps** NBK-04
- **Accept** A named set of checks that must pass before the restore is declared complete.
- **Rollback** n/a
- **Impact** A · **Artifact** Appendix E CL-36

#### NBK-10 — Confirm backup branches do not multiply cost unexpectedly
- **Evidence** Copy-on-write is cheap until the parent diverges substantially.
- **Scope** Storage attributable to branches. **Non-goals** deleting branches to save money before the retention policy exists.
- **Do** Read project storage metrics.
- **Mutation** `RO` · **Owner** B · **Deps** NBK-03
- **Accept** A figure, and a retention rule that keeps it bounded.
- **Rollback** n/a
- **Impact** none · **Artifact** Appendix D D-41

#### NBK-11 — Write the retention rule for backup branches
- **Evidence** Branches created for safety become clutter that nobody dares delete.
- **Scope** How long each backup branch lives and who deletes it. **Non-goals** automatic deletion.
- **Do** Specify: keep until the change it protects has been live and stable for a stated period.
- **Mutation** `RO` · **Owner** B · **Deps** NBK-10
- **Accept** Rule recorded with an owner.
- **Rollback** n/a
- **Impact** A · **Artifact** Appendix E CL-35

#### NBK-12 — Record that beta data includes real personal data
- **Evidence** Beta has real users; any branch, backup, or export of it carries their data.
- **Scope** A standing caution on every branch and export operation. **Non-goals** a full data-protection programme here.
- **Do** Add the caution to the backup and restore checklists.
- **Mutation** `RO` · **Owner** B · **Deps** —
- **Accept** The caution appears wherever a branch or export is created.
- **Rollback** n/a
- **Impact** A · **Artifact** Appendix G P-19

---

## Group L — beta environment rehearsal (14)

#### BER-01 — Define what beta means for this product
- **Evidence** Beta is used to mean both "not production" and "real customers on real hardware", which are very different obligations.
- **Scope** One written definition including whether real money and real energy are involved. **Non-goals** a marketing definition.
- **Do** Record; the answer determines several no-go conditions.
- **Mutation** `RO` · **Owner** H · **Deps** —
- **Accept** A definition that a no-go scenario can cite.
- **Rollback** n/a
- **Impact** A and X · **Artifact** BR-01

#### BER-02 — Run the UI locally with backend-gated features disabled
- **Evidence** The fastest safe rehearsal is the one that needs no cloud at all.
- **Scope** Local dev, gated features off. **Non-goals** pointing local UI at beta data.
- **Do** Start the web app locally with the gating configuration.
- **Mutation** `LOCAL` · **Owner** X · **Deps** —
- **Accept** Every gated surface renders a defined disabled state rather than an error.
- **Rollback** n/a
- **Impact** X owns it · **Artifact** BR-01

#### BER-03 — Rehearse organisation creation against a local database
- **Evidence** Organisation creation is the first real write a beta admin performs.
- **Scope** Local Postgres or a throwaway Neon branch. **Non-goals** beta data.
- **Do** Create, read back, and verify tenant scoping.
- **Mutation** `LOCAL` · **Owner** A+X · **Deps** —
- **Accept** The created organisation is visible only to its own members.
- **Rollback** Drop the local database.
- **Impact** A owns the domain · **Artifact** BR-02

#### BER-04 — Rehearse charger onboarding without a charger
- **Evidence** The onboarding flow can be exercised with a simulated OCPP client.
- **Scope** BootNotification through Heartbeat against a local gateway. **Non-goals** touching the live gateway or a real charger.
- **Do** Run the gateway locally and connect a simulator.
- **Mutation** `LOCAL` · **Owner** A+B · **Deps** —
- **Accept** The charger appears as onboarded and its identity persists across a reconnect.
- **Rollback** n/a
- **Impact** A · **Artifact** BR-03

#### BER-05 — Rehearse the driver membership flow end to end
- **Evidence** The driver invitation loop is confirmed broken at runtime: an invitee can never redeem, and codes are bearer-only.
- **Scope** Reproduce the failure locally and confirm the fix when A lands it. **Non-goals** issuing invitations in beta.
- **Do** Local run; record the exact failure point.
- **Mutation** `LOCAL` · **Owner** A+X · **Deps** —
- **Accept** The rehearsal fails today in the documented way, which validates the rehearsal itself.
- **Rollback** n/a
- **Impact** A owns the fix, X owns the surface · **Artifact** BR-04

#### BER-06 — Rehearse the pricing surface in its disabled state
- **Evidence** The money-unit contradiction means pricing must not be shown as authoritative until NPR-17 is resolved.
- **Scope** A defined disabled presentation. **Non-goals** showing a number that might be wrong by a factor of one hundred.
- **Do** X implements the disabled state; B verifies the rehearsal.
- **Mutation** `LOCAL` · **Owner** X · **Deps** NPR-17
- **Accept** No monetary figure is displayed as final anywhere until the contract is settled.
- **Rollback** n/a
- **Impact** X owns it · **Artifact** BR-05

#### BER-07 — Rehearse a first real charge with an independent cost check
- **Evidence** The only way to catch a hundredfold unit error is to compute the expected cost by hand and compare.
- **Scope** One charge, one hand calculation, one comparison. **Non-goals** billing anyone.
- **Do** Record energy delivered, tariff, expected cost, and the system's cost.
- **Mutation** `EXT` + `APPROVAL` (real hardware, real energy) · **Owner** H · **Deps** NPR-17
- **Accept** The two figures agree to the aurar; any factor-of-one-hundred discrepancy stops the programme.
- **Rollback** Do not bill; correct and repeat.
- **Impact** A owns costing · **Artifact** BR-06

#### BER-08 — Rehearse a beta domain change without breaking the mobile app
- **Evidence** The app pins a workers.dev host; adding a custom domain can disable it.
- **Scope** Add a domain in a way that provably preserves the pinned host. **Non-goals** removing the pinned host.
- **Do** WDV-01 first, then the domain change, then verify both hosts answer.
- **Mutation** `EXT` + `APPROVAL` · **Owner** H · **Deps** WDV-01
- **Accept** Both the custom domain and the workers.dev host return application responses.
- **Rollback** Remove the domain; the pinned host must still answer.
- **Impact** X · **Artifact** BR-07

#### BER-09 — Rehearse OCPP continuity across a web deploy
- **Evidence** A web deploy should not touch chargers at all, and that should be demonstrated rather than assumed.
- **Scope** Connected-charger count before and after a web-only deploy. **Non-goals** deploying the gateway.
- **Do** Capture counts either side.
- **Mutation** `EXT` + `APPROVAL` · **Owner** H · **Deps** OCG-10
- **Accept** The count is unchanged; if it is not, the deploy independence assumption is wrong.
- **Rollback** Roll back the web Worker version.
- **Impact** A · **Artifact** BR-08

#### BER-10 — Define the beta success signal
- **Evidence** Without one, beta ends when someone gets impatient.
- **Scope** A small number of measurable conditions. **Non-goals** a scorecard nobody will fill in.
- **Do** Derive from the rehearsals: charge completes, cost matches, charger reconnects, no unhandled error class.
- **Mutation** `RO` · **Owner** H · **Deps** BER-01
- **Accept** Conditions stated with a measurement method for each.
- **Rollback** n/a
- **Impact** A and X · **Artifact** BR-01

#### BER-11 — Define the beta abort signal
- **Evidence** The counterpart to a success signal; without it, problems get absorbed.
- **Scope** Conditions that stop beta immediately. **Non-goals** a long list nobody remembers.
- **Do** Include: any billing discrepancy, any charger left unable to reconnect, any cross-tenant data exposure.
- **Mutation** `RO` · **Owner** H · **Deps** BER-10
- **Accept** Three or four conditions, each unambiguous.
- **Rollback** n/a
- **Impact** A and X · **Artifact** BR-01

#### BER-12 — Record who is in the beta cohort and what they were told
- **Evidence** Real people are already using this; their expectations are part of the risk model.
- **Scope** Cohort size and the stated expectations. **Non-goals** collecting more personal data than already exists.
- **Do** Record at a level that does not name individuals.
- **Mutation** `RO` · **Owner** H · **Deps** —
- **Accept** A count and a statement of what was promised.
- **Rollback** n/a
- **Impact** X owns the messaging · **Artifact** BR-01

#### BER-13 — Establish a beta feedback path that does not depend on the app working
- **Evidence** The failures most worth hearing about are the ones that stop the app.
- **Scope** An out-of-band channel. **Non-goals** an in-app-only form.
- **Do** Record the channel in the beta materials.
- **Mutation** `RO` · **Owner** H · **Deps** —
- **Accept** A channel that works when the product does not.
- **Rollback** n/a
- **Impact** X · **Artifact** BR-01

#### BER-14 — Schedule the rehearsals in dependency order
- **Evidence** Several rehearsals are blocked by A's fixes; running them early produces known failures and wasted effort.
- **Scope** An order with the blocking work named. **Non-goals** a date-based plan nobody controls.
- **Do** Order: BR-01, BR-02, BR-03, BR-08, BR-04, BR-05, BR-07, BR-06.
- **Mutation** `RO` · **Owner** B · **Deps** BER-01…BER-13
- **Accept** Each rehearsal names what must land first.
- **Rollback** n/a
- **Impact** A and X · **Artifact** Appendix K

---

## Group M — production cutover readiness (14)

#### PCR-01 — Assemble the production Worker name list
- **Evidence** Production names currently return error 1042, consistent with not existing.
- **Scope** Final names, decided rather than inherited. **Non-goals** reusing a CPMS-colliding name.
- **Do** Record the three names and check them against the CPMS declarations.
- **Mutation** `RO` · **Owner** B · **Deps** CFD-18
- **Accept** No name is declared by both projects.
- **Rollback** n/a
- **Impact** A and X · **Artifact** AD-03

#### PCR-02 — Write the production wrangler environment blocks
- **Evidence** Production environments do not exist in the configs today.
- **Scope** One environment per Worker, with `workers_dev` declared explicitly in every one. **Non-goals** deploying them.
- **Do** Edit configs on a branch.
- **Mutation** `LOCAL` · **Owner** B · **Deps** PCR-01, WDV-01
- **Accept** `wrangler deploy --dry-run --env production` succeeds for all three.
- **Rollback** Revert.
- **Impact** A · **Artifact** Appendix E CL-42

#### PCR-03 — Enumerate every production secret that must exist before first deploy
- **Evidence** A Worker that deploys without its secrets fails at first request, not at deploy.
- **Scope** Names only, derived from CFD-09 and the code. **Non-goals** values.
- **Do** Cross-reference the beta secret names with every `env.` read in the source.
- **Mutation** `RO` · **Owner** B+A · **Deps** CFD-09
- **Accept** Every name read by code appears in the list.
- **Rollback** n/a
- **Impact** A · **Artifact** AD-07

#### PCR-04 — Decide whether production secrets are new values or copies
- **Evidence** Copying a beta secret into production means one compromise affects both.
- **Scope** New values for anything that grants access. **Non-goals** copying `AUTH_SECRET`.
- **Do** Record in AD-07.
- **Mutation** `RO` · **Owner** H · **Deps** PCR-03
- **Accept** A per-secret decision.
- **Rollback** n/a
- **Impact** A · **Artifact** AD-07

#### PCR-05 — Plan the DNS records for production hostnames
- **Evidence** Custom Domains create the records; knowing which records should exist afterwards is how the change is verified.
- **Scope** Expected record set after attachment. **Non-goals** creating records by hand.
- **Do** Write the expected state.
- **Mutation** `RO` · **Owner** B · **Deps** CFD-15
- **Accept** Post-change DNS is compared against this list.
- **Rollback** n/a
- **Impact** none · **Artifact** Appendix E CL-43

#### PCR-06 — Confirm certificate coverage for every production hostname
- **Evidence** The apex certificate does not cover `www`; a production hostname could have the same gap.
- **Scope** Each hostname checked against the SAN list. **Non-goals** ordering an advanced certificate before it is needed.
- **Do** Compare PCR-05 against CFD-16.
- **Mutation** `RO` · **Owner** B · **Deps** CFD-16
- **Accept** Every hostname is covered, or the gap has an owner and a plan.
- **Rollback** n/a
- **Impact** X · **Artifact** Appendix E CL-43

#### PCR-07 — Define the cutover order
- **Evidence** Deploying the API after the web app means the web app briefly calls an API that is not there.
- **Scope** A strict order with a verification between each step. **Non-goals** parallel deploys.
- **Do** Order: database ready, API, gateway if changed, web, then domains.
- **Mutation** `RO` · **Owner** B · **Deps** —
- **Accept** Each step has a verification that must pass before the next.
- **Rollback** Each step is individually reversible.
- **Impact** A and X · **Artifact** Appendix E CL-44

#### PCR-08 — Record the rollback target for every Worker before the cutover starts
- **Evidence** Rule R1 rejects a release with no `workerVersionsBefore`, and none has ever been recorded.
- **Scope** One version id per Worker, captured immediately before. **Non-goals** capturing it afterwards.
- **Do** From CFI-03, at cutover time.
- **Mutation** `RO` · **Owner** B · **Deps** CFI-03
- **Accept** The manifest validates; the cutover cannot start otherwise.
- **Rollback** n/a
- **Impact** none · **Artifact** Appendix F rule R1

#### PCR-09 — Define the go/no-go review immediately before cutover
- **Evidence** A checklist completed a week earlier does not describe the system now.
- **Scope** A short review, minutes before, against the six no-go conditions. **Non-goals** repeating the whole programme.
- **Do** Run the no-go list.
- **Mutation** `RO` · **Owner** H · **Deps** PCR-08
- **Accept** Every no-go is explicitly cleared or the cutover does not start.
- **Rollback** n/a
- **Impact** A and X · **Artifact** Appendix K NG section

#### PCR-10 — Define post-cutover verification
- **Evidence** A deploy that succeeds and a system that works are different claims.
- **Scope** A short set of checks covering each Worker and the database. **Non-goals** a full regression suite.
- **Do** Health endpoint, one authenticated read, charger count, and a database round trip.
- **Mutation** `RO` · **Owner** B · **Deps** PCR-07
- **Accept** All four pass within a stated time budget.
- **Rollback** Roll back in reverse cutover order.
- **Impact** A and X · **Artifact** Appendix E CL-58

#### PCR-11 — Define the soak period before beta traffic moves
- **Evidence** Production working for a minute is not production working.
- **Scope** A stated soak with a defined observation. **Non-goals** an indefinite wait.
- **Do** Record the period and what is watched.
- **Mutation** `RO` · **Owner** B · **Deps** PCR-10
- **Accept** A duration and a signal.
- **Rollback** n/a
- **Impact** X · **Artifact** Appendix E CL-58

#### PCR-12 — Plan what happens to beta after production exists
- **Evidence** Two live environments with real users is twice the operational surface.
- **Scope** Beta retired, or kept with a stated purpose. **Non-goals** leaving it undecided.
- **Do** Record in AD-16.
- **Mutation** `RO` · **Owner** H · **Deps** —
- **Accept** A decision with a date or a condition.
- **Rollback** n/a
- **Impact** A and X · **Artifact** AD-16

#### PCR-13 — Record the cutover in the release evidence ledger
- **Evidence** The ledger is the project's memory; a cutover absent from it did not happen as far as future sessions are concerned.
- **Scope** Manifest, evidence hashes, decisions, and outcomes. **Non-goals** the visual status page, which belongs to the coordinator.
- **Do** Append after the soak.
- **Mutation** `LOCAL` · **Owner** B · **Deps** PCR-11
- **Accept** The ledger entry links to the validated manifest.
- **Rollback** n/a
- **Impact** none · **Artifact** Release evidence ledger

#### PCR-14 — Schedule the first rollback drill after cutover, not before
- **Evidence** A drill against a system that has never carried traffic proves less than one against a system that has.
- **Scope** One rehearsed rollback in a low-usage window. **Non-goals** a surprise drill on customers.
- **Do** Schedule with the drill in Appendix K.
- **Mutation** `EXT` + `APPROVAL` · **Owner** H · **Deps** PCR-11
- **Accept** Rollback completes within the measured target.
- **Rollback** Roll forward again.
- **Impact** A and X · **Artifact** RD-01

---

## Group N — CPMS separation (10)

#### CPS-01 — Establish which project the deployed Workers actually belong to
- **Evidence** Both projects declare `hlada-staging` and `hlada-api-staging`; the collision is inheritance, not coincidence.
- **Scope** The Git integration owner per Worker, from fact F2. **Non-goals** disconnecting anything yet.
- **Do** From CFD-08.
- **Mutation** `RO` · **Owner** B · **Deps** CFD-08
- **Accept** Each Worker attributed to exactly one repository.
- **Rollback** n/a
- **Impact** A · **Artifact** Execution index F-10

#### CPS-02 — Record the rename history that produced the collision
- **Evidence** CPMS renamed `straumvakt` to `hlada` on 2026-04-19; Straumvakt inherited the names on 2026-04-24.
- **Scope** A short factual timeline. **Non-goals** apportioning blame.
- **Do** Already established; keep it with the separation plan so the next reader does not re-derive it.
- **Mutation** `RO` · **Owner** B · **Deps** —
- **Accept** Timeline present with dates.
- **Rollback** n/a
- **Impact** none · **Artifact** CPMS separation note

#### CPS-03 — Determine whether CPMS can still deploy over Straumvakt
- **Evidence** If CPMS retains a Git integration to the same Worker names, a CPMS merge redeploys Straumvakt's estate.
- **Scope** The CPMS side of the integration. **Non-goals** editing the CPMS repository, which is out of scope by standing rule.
- **Do** Inspect from the Cloudflare side only.
- **Mutation** `RO` · **Owner** B · **Deps** CPS-01
- **Accept** A yes or no; a yes is a production no-go.
- **Rollback** n/a
- **Impact** none · **Artifact** NG-04

#### CPS-04 — Decide which project keeps the `hlada` names
- **Evidence** Two projects cannot own the same Worker name in one account.
- **Scope** A decision, not a negotiation held implicitly. **Non-goals** renaming both.
- **Do** Record in AD-03.
- **Mutation** `RO` · **Owner** H · **Deps** CPS-01
- **Accept** One owner per name.
- **Rollback** n/a
- **Impact** A · **Artifact** AD-03

#### CPS-05 — Plan the rename with every dependent updated in one change
- **Evidence** The gateway binds `MAIN_APP` to `hlada-api-staging` by name, and the mobile app pins the derived hostname.
- **Scope** Config, binding, and client, changed together. **Non-goals** renaming the Worker first and fixing dependants after.
- **Do** Write the change as one reviewable set.
- **Mutation** `LOCAL` · **Owner** B · **Deps** CPS-04
- **Accept** A dry run of all three Workers succeeds with the new names.
- **Rollback** Revert the set.
- **Impact** X owns the client · **Artifact** Appendix E CL-15

#### CPS-06 — Recognise that a rename changes the workers.dev hostname
- **Evidence** The hostname is derived from the Worker name; renaming breaks the shipped app as surely as disabling workers.dev.
- **Scope** An explicit consequence statement in the rename plan. **Non-goals** renaming before the client can move.
- **Do** State it prominently.
- **Mutation** `RO` · **Owner** B · **Deps** CPS-05
- **Accept** The rename plan blocks on a mobile release that no longer pins the old name.
- **Rollback** n/a
- **Impact** X · **Artifact** AD-08

#### CPS-07 — Confirm CPMS files are never edited by this track
- **Evidence** A standing rule forbids touching `E:\Claude\CPMS\CPMS\`.
- **Scope** A verification, not a promise. **Non-goals** any edit.
- **Do** `git status` in the CPMS checkout at the end of every session.
- **Mutation** `RO` · **Owner** B · **Deps** —
- **Accept** No modification attributable to this track.
- **Rollback** n/a
- **Impact** none · **Artifact** Appendix G P-15

#### CPS-08 — Preserve CPMS as provenance rather than treating it as clutter
- **Evidence** CPMS is where the `hlada` name and much of the OCPP design originate.
- **Scope** A preservation record, not a cleanup target. **Non-goals** archiving it away from reach.
- **Do** Record as P-15.
- **Mutation** `RO` · **Owner** B · **Deps** —
- **Accept** CPMS appears in the preservation manifest, not the deletion candidates.
- **Rollback** n/a
- **Impact** none · **Artifact** Appendix G P-15

#### CPS-09 — Record the separation as a production precondition
- **Evidence** A production cutover while another project can redeploy the same names is not a controlled release.
- **Scope** One no-go condition. **Non-goals** blocking beta work.
- **Do** Record as NG-04 and enforce via rule R12.
- **Mutation** `RO` · **Owner** B · **Deps** CPS-03
- **Accept** The production manifest cannot validate without `cpmsSeparationVerified`.
- **Rollback** n/a
- **Impact** none · **Artifact** Appendix F rule R12

#### CPS-10 — Write the one-page brief for whoever owns CPMS
- **Evidence** The separation needs action from a party outside this track.
- **Scope** What is shared, what breaks, and what is being asked. **Non-goals** instructing them how to run their project.
- **Do** One page, factual.
- **Mutation** `RO` · **Owner** B · **Deps** CPS-04
- **Accept** A brief that can be sent without further context.
- **Rollback** n/a
- **Impact** none · **Artifact** CPMS separation note

---

## Group O — cleanup preservation (18)

#### CLP-01 — Copy `docs/OCPP` out before anything else happens
- **Evidence** 128 untracked files containing official OCPP 1.6, 2.0.1, and 2.1 specifications; untracked means one `git clean` from gone.
- **Scope** Copy, hash, verify. **Non-goals** deleting the originals.
- **Do** Copy to a location outside `E:\Claude`, then `Get-FileHash` both sides.
- **Mutation** `LOCAL` + `APPROVAL` · **Owner** H · **Deps** —
- **Accept** File counts and hashes match; 128 files on both sides.
- **Rollback** The originals are untouched.
- **Impact** A uses these · **Artifact** Appendix G P-02

#### CLP-02 — Decide whether OCPP specifications are committed or archived
- **Evidence** They are third-party documents; committing them has licensing implications, leaving them untracked has preservation implications.
- **Scope** Commit, archive externally, or both. **Non-goals** leaving them untracked and unbacked.
- **Do** Record in AD-14.
- **Mutation** `RO` · **Owner** H · **Deps** CLP-01
- **Accept** A decision; the current state is not one of the options.
- **Rollback** n/a
- **Impact** A · **Artifact** AD-14

#### CLP-03 — Copy `Straumvakt-parked` out
- **Evidence** 38 files of OpenADR and dynamic-grid research; not a git worktree, so nothing is recoverable from a remote.
- **Scope** Copy, hash, verify. **Non-goals** deleting.
- **Do** As CLP-01.
- **Mutation** `LOCAL` + `APPROVAL` · **Owner** H · **Deps** —
- **Accept** 38 files, hashes match.
- **Rollback** Originals untouched.
- **Impact** none · **Artifact** Appendix G P-01

#### CLP-04 — Capture the canonical checkout's untracked and modified files
- **Evidence** The canonical checkout is dirty and its dirt is other agents' in-progress work.
- **Scope** A list plus a copy of anything untracked. **Non-goals** committing or reverting anyone's work.
- **Do** `git status --porcelain` then copy the `??` entries.
- **Mutation** `LOCAL` · **Owner** B · **Deps** —
- **Accept** Every untracked entry is copied and hashed.
- **Rollback** Originals untouched.
- **Impact** A and X own the changes · **Artifact** Appendix G P-03

#### CLP-05 — Back up the prompt and evidence folder properly
- **Evidence** `C:\Users\Andri\Documents\New project` has a git repository initialised with **zero commits and zero tracked files** — 160 untracked entries at the top level. It has the appearance of version control and none of the substance.
- **Scope** Either make the first commit or copy the folder out. **Non-goals** committing tool caches and binary artefacts indiscriminately.
- **Do** Add a `.gitignore` for `.jadx*`, `.zaptec-*`, `cache/`, and lock files; then commit the documents.
- **Mutation** `LOCAL` + `APPROVAL` · **Owner** H · **Deps** —
- **Accept** `git log` shows at least one commit and the 28 top-level markdown prompts are tracked.
- **Rollback** The files are untouched either way.
- **Impact** A and X are driven by these prompts · **Artifact** Appendix G P-04

#### CLP-06 — Separate the prompt documents from the tool caches
- **Evidence** The folder holds 22,759 files, of which the load-bearing content is a few dozen markdown documents.
- **Scope** Ignore rules that keep the ratio sane. **Non-goals** deleting the caches.
- **Do** Write the `.gitignore`; do not delete anything.
- **Mutation** `LOCAL` · **Owner** B · **Deps** CLP-05
- **Accept** `git status` shows tens of untracked entries, not tens of thousands.
- **Rollback** Delete the ignore file.
- **Impact** none · **Artifact** Appendix G P-04

#### CLP-07 — Preserve the coordinator ledger
- **Evidence** `coordinator-ledger-straumvakt-2026-08-09.md` is the cross-agent record and lives in the same unbacked folder.
- **Scope** Included in CLP-05. **Non-goals** editing it — it belongs to the coordinator.
- **Do** Ensure it is in the first commit.
- **Mutation** `LOCAL` · **Owner** B · **Deps** CLP-05
- **Accept** Tracked.
- **Rollback** n/a
- **Impact** all three agents · **Artifact** Appendix G P-05

#### CLP-08 — Preserve the visual status page without editing it
- **Evidence** The visual status HTML belongs to the coordinator and this track must not update it.
- **Scope** Preservation only. **Non-goals** any edit.
- **Do** Include in the backup; record that it is not this track's to change.
- **Mutation** `RO` · **Owner** B · **Deps** —
- **Accept** Present in the backup, unmodified.
- **Rollback** n/a
- **Impact** coordinator owns it · **Artifact** Appendix G P-06

#### CLP-09 — Enumerate every worktree and its branch before any retirement
- **Evidence** Retiring a worktree is safe only when its branch is preserved; that must be verified per worktree.
- **Scope** Worktree path, branch, tip, dirty count, unique commits. **Non-goals** removing any.
- **Do** `git worktree list` plus per-worktree status.
- **Mutation** `RO` · **Owner** B · **Deps** —
- **Accept** A complete table.
- **Rollback** n/a
- **Impact** A and X own worktrees · **Artifact** Appendix G P-07

#### CLP-10 — Identify worktrees with zero unique commits
- **Evidence** These are the only ones whose working copy can be removed without losing anything.
- **Scope** `rev-list --count <rc>..HEAD` per worktree. **Non-goals** removing them.
- **Do** The cleanup dry-run script already reports this.
- **Mutation** `RO` · **Owner** B · **Deps** CLP-09
- **Accept** A list, with dirty counts alongside — a zero-unique worktree with uncommitted changes is not safe to retire.
- **Rollback** n/a
- **Impact** A and X · **Artifact** Appendix G P-07

#### CLP-11 — Enumerate junctions and their targets
- **Evidence** Five cross-worktree junctions exist; `Remove-Item -Recurse` can traverse one and delete the target.
- **Scope** Junction path, target, and whether it crosses worktrees. **Non-goals** unlinking any yet.
- **Do** The dry-run script reports this in required unlink order.
- **Mutation** `RO` · **Owner** B · **Deps** —
- **Accept** Every junction listed with its target.
- **Rollback** n/a
- **Impact** none · **Artifact** Appendix G P-12

#### CLP-12 — Record the correct unlink command and why the obvious one is wrong
- **Evidence** The measurement error that produced impossible figures came from the same cause: tools follow junctions.
- **Scope** `cmd /c rmdir "<junction>"` only. **Non-goals** any recursive removal near a junction.
- **Do** Already in the dry-run script; repeat it in the checklist.
- **Mutation** `RO` · **Owner** B · **Deps** CLP-11
- **Accept** The warning appears immediately above the command in every checklist.
- **Rollback** n/a
- **Impact** none · **Artifact** Appendix E CL-46

#### CLP-13 — Re-measure the estate with reparse points excluded
- **Evidence** The first measurement followed junctions and produced negative real content and more reclaimable space than the tree contained.
- **Scope** The corrected measurement: 43.76 GB total, 41.57 GB regenerable, 2.25 GB real content. **Non-goals** trusting the original figures.
- **Do** Run the dry-run script.
- **Mutation** `RO` · **Owner** B · **Deps** —
- **Accept** Figures reproduce; the correction is recorded rather than silently applied.
- **Rollback** n/a
- **Impact** none · **Artifact** Appendix G

#### CLP-14 — Inspect any `_to_delete` folder before believing its name
- **Evidence** A folder named for deletion is a claim made by a past session, not a verified fact.
- **Scope** Contents listed and checked against the preservation list. **Non-goals** deleting on the strength of the name.
- **Do** List, hash, compare.
- **Mutation** `RO` · **Owner** B · **Deps** —
- **Accept** Either confirmed regenerable, or promoted to a preservation record.
- **Rollback** n/a
- **Impact** none · **Artifact** Appendix G P-13

#### CLP-15 — Verify every preservation target is present before any deletion
- **Evidence** The dry-run script checks this and stops on a missing target.
- **Scope** All records in Appendix G. **Non-goals** proceeding on a partial pass.
- **Do** Run the dry-run; require every target PRESENT.
- **Mutation** `RO` · **Owner** B · **Deps** CLP-01…CLP-14
- **Accept** No `*** MISSING ***` line in the output.
- **Rollback** n/a
- **Impact** none · **Artifact** Appendix G

#### CLP-16 — Produce an archive with checksums before deleting anything
- **Evidence** A deletion whose recovery path is "we think we copied it" is not recoverable.
- **Scope** One archive plus a manifest of hashes. **Non-goals** an archive stored inside `E:\Claude`.
- **Do** Create the archive outside the tree; hash every member.
- **Mutation** `LOCAL` + `APPROVAL` · **Owner** H · **Deps** CLP-15
- **Accept** Every hash in the manifest verifies from the archive.
- **Rollback** The originals are still present at this point.
- **Impact** none · **Artifact** Appendix G P-18

#### CLP-17 — Decide where the archive lives
- **Evidence** An archive on the same disk as the original protects against `git clean`, not against disk loss.
- **Scope** A location and a rationale. **Non-goals** assuming a cloud backup exists.
- **Do** Record in AD-11.
- **Mutation** `RO` · **Owner** H · **Deps** CLP-16
- **Accept** A location that survives the failure the archive is meant to protect against.
- **Rollback** n/a
- **Impact** none · **Artifact** AD-11

#### CLP-18 — Keep deletion as a separate, later, explicitly approved step
- **Evidence** Nothing in `E:\Claude` has been deleted, moved, or modified, and the standing rules forbid it.
- **Scope** Deletion happens only after archive verification and only with explicit approval. **Non-goals** bundling deletion into the same session as preservation.
- **Do** Keep the dry-run script free of delete verbs; it has none.
- **Mutation** `DESTRUCT` + `APPROVAL` when it eventually happens · **Owner** H · **Deps** CLP-16
- **Accept** A separate session, a separate approval, a verified archive.
- **Rollback** Restore from the archive.
- **Impact** A and X · **Artifact** AD-11

---

## Group P — cleanup dry-run and archive flow (14)

#### CDA-01 — Run the dry-run script and save its output outside `E:\Claude`
- **Evidence** The script refuses to write its manifest inside the tree it measures.
- **Scope** One run, one output file. **Non-goals** running it with any modification.
- **Do** `pwsh -File cleanup-dryrun.ps1 -OutFile "C:\Users\Andri\Documents\cleanup-manifest.txt"`
- **Mutation** `RO` · **Owner** B · **Deps** —
- **Accept** Manifest produced; the script's own refusal is exercised if an inside path is attempted.
- **Rollback** Delete the manifest.
- **Impact** none · **Artifact** Appendix G

#### CDA-02 — Audit the dry-run script for delete verbs before every run
- **Evidence** Safety by construction only holds if the construction is re-checked.
- **Scope** Grep for `Remove-Item`, `rmdir`, `del`, `rd`, `Clear-`, `Move-Item`, `worktree remove`, `branch -d`. **Non-goals** trusting the header comment.
- **Do** Grep and confirm matches appear only inside comments and strings.
- **Mutation** `RO` · **Owner** B · **Deps** —
- **Accept** Zero executable delete statements.
- **Rollback** n/a
- **Impact** none · **Artifact** Appendix F rule L6

#### CDA-03 — Add a preservation-list check that fails loudly
- **Evidence** The script currently prints `*** MISSING ***`; a human can miss a line in a long report.
- **Scope** A non-zero exit code on any missing target. **Non-goals** making it delete anything.
- **Do** Add an exit code.
- **Mutation** `LOCAL` · **Owner** B · **Deps** —
- **Accept** Removing a target from the list in a test causes a non-zero exit.
- **Rollback** Revert.
- **Impact** none · **Artifact** Appendix F rule L7

#### CDA-04 — Add P4 to the automated checks
- **Evidence** The prompt and evidence folder is currently reported as `MANUAL` because it lives outside the measured root.
- **Scope** Check its presence and, once CLP-05 lands, its commit count. **Non-goals** copying it from within the script.
- **Do** Extend the preservation list with an absolute path outside `$Root`.
- **Mutation** `LOCAL` · **Owner** B · **Deps** CLP-05
- **Accept** P4 reports PRESENT with a file count.
- **Rollback** Revert.
- **Impact** none · **Artifact** Appendix G P-04

#### CDA-05 — Record a baseline measurement before any change
- **Evidence** Reclaimed space can only be demonstrated against a baseline.
- **Scope** One dated measurement. **Non-goals** re-measuring after each small change.
- **Do** Save the CDA-01 output with a date.
- **Mutation** `LOCAL` · **Owner** B · **Deps** CDA-01
- **Accept** A dated file outside `E:\Claude`.
- **Rollback** Delete it.
- **Impact** none · **Artifact** Appendix G

#### CDA-06 — Separate regenerable from irreplaceable in the report
- **Evidence** 95% of the tree is regenerable; conflating the two categories is what makes cleanup feel risky.
- **Scope** The report already splits total, reclaimable, and content. **Non-goals** a single headline number.
- **Do** Keep the three columns.
- **Mutation** `RO` · **Owner** B · **Deps** —
- **Accept** Every worktree row shows all three.
- **Rollback** n/a
- **Impact** none · **Artifact** Appendix G

#### CDA-07 — Verify a regenerable directory actually regenerates before deleting it
- **Evidence** `node_modules` is regenerable only if the lockfile resolves and the registry is reachable.
- **Scope** One worktree, `npm ci` into a temporary location. **Non-goals** deleting the original first.
- **Do** Test the regeneration path before relying on it.
- **Mutation** `LOCAL` · **Owner** B · **Deps** —
- **Accept** A clean install succeeds; if it does not, `node_modules` is not regenerable and the plan changes.
- **Rollback** Delete the temporary install.
- **Impact** A and X · **Artifact** Appendix G P-20

#### CDA-08 — Check Flutter build outputs regenerate too
- **Evidence** `.dart_tool` and `build` are assumed regenerable on the same reasoning.
- **Scope** `flutter pub get` in a copy. **Non-goals** deleting first.
- **Do** Test.
- **Mutation** `LOCAL` · **Owner** B · **Deps** —
- **Accept** Dependencies resolve; pinned versions still available.
- **Rollback** n/a
- **Impact** X · **Artifact** Appendix G P-20

#### CDA-09 — Order the cleanup so junctions go first
- **Evidence** Deleting a target while a junction still points at it leaves a broken link that later tools follow.
- **Scope** Unlink, then verify, then prune. **Non-goals** pruning first.
- **Do** The dry-run script emits the required order.
- **Mutation** `RO` · **Owner** B · **Deps** CLP-11
- **Accept** The order is in the checklist.
- **Rollback** Junctions can be recreated.
- **Impact** none · **Artifact** Appendix E CL-46

#### CDA-10 — Retire worktrees with `git worktree remove`, never by deleting the directory
- **Evidence** Deleting the directory leaves the worktree registered and the repository in a confusing state.
- **Scope** The proper command, and only for zero-unique, zero-dirty worktrees. **Non-goals** removing anything with uncommitted work.
- **Do** Record the command; do not run it.
- **Mutation** `DESTRUCT` + `APPROVAL` · **Owner** H · **Deps** CLP-10
- **Accept** `git worktree list` afterwards shows no stale entries.
- **Rollback** Recreate the worktree from the branch, which still exists.
- **Impact** A and X · **Artifact** AD-12

#### CDA-11 — Never delete a branch as part of cleanup
- **Evidence** A branch is the cheap part; the working copy is the expensive part. Retiring one does not require the other.
- **Scope** Worktrees only. **Non-goals** any `git branch -d`.
- **Do** State it as a rule.
- **Mutation** `RO` · **Owner** B · **Deps** —
- **Accept** The rule appears in every cleanup checklist.
- **Rollback** n/a
- **Impact** A and X · **Artifact** AD-12

#### CDA-12 — Re-run the dry-run after every cleanup step
- **Evidence** The preservation check is the tripwire; running it once at the start does not protect the later steps.
- **Scope** After each step. **Non-goals** a single run at the end.
- **Do** Add to the checklist between steps.
- **Mutation** `RO` · **Owner** B · **Deps** CDA-03
- **Accept** Every step is followed by a passing preservation check.
- **Rollback** n/a
- **Impact** none · **Artifact** Appendix E CL-47

#### CDA-13 — Keep a record of what was deleted and when
- **Evidence** Recovery starts with knowing what is missing.
- **Scope** A deletion log with paths, sizes, and the archive member that covers each. **Non-goals** a log stored only inside the tree being cleaned.
- **Do** Write it beside the archive.
- **Mutation** `LOCAL` · **Owner** B · **Deps** CLP-16
- **Accept** Every deleted path maps to an archive member.
- **Rollback** n/a
- **Impact** none · **Artifact** Appendix G P-18

#### CDA-14 — Verify the archive restores before the originals are gone
- **Evidence** An untested backup is a hypothesis.
- **Scope** Extract to a temporary location and hash-compare. **Non-goals** extracting over the originals.
- **Do** Extract, hash, compare, discard the extraction.
- **Mutation** `LOCAL` · **Owner** B · **Deps** CLP-16
- **Accept** Every hash matches; only then may deletion be approved.
- **Rollback** n/a
- **Impact** none · **Artifact** AD-11

---

## Group Q — observability and alerts (12)

#### OBS-01 — Establish what telemetry exists today
- **Evidence** Several checks in this programme end with "if none exists, that is the finding".
- **Scope** Logs, metrics, traces, and error reporting, per Worker. **Non-goals** buying a product.
- **Do** Inspect Worker settings and the source for any reporting integration.
- **Mutation** `RO` · **Owner** B · **Deps** CFD-01
- **Accept** A per-Worker inventory, with gaps named.
- **Rollback** n/a
- **Impact** A · **Artifact** Appendix D D-42

#### OBS-02 — Decide whether Workers Logs or a tail consumer is the log path
- **Evidence** Logs that only exist while someone is watching a tail are not logs.
- **Scope** Persistent log storage with a retention period. **Non-goals** logging request bodies.
- **Do** Record the choice and its retention.
- **Mutation** `RO` · **Owner** B · **Deps** OBS-01
- **Accept** A choice with a retention number.
- **Rollback** n/a
- **Impact** A · **Artifact** AD-16

#### OBS-03 — Define the four signals that would have caught past incidents
- **Evidence** The known failure modes are: workers.dev disabled, wrong Neon branch, charger disconnection, and a money-unit error.
- **Scope** One detectable signal per failure mode. **Non-goals** a generic dashboard.
- **Do** Specify each signal and where it would be observed.
- **Mutation** `RO` · **Owner** B · **Deps** OBS-01
- **Accept** Each of the four has a signal and an owner.
- **Rollback** n/a
- **Impact** A · **Artifact** Appendix D D-42

#### OBS-04 — Add a synthetic check for the pinned mobile API host
- **Evidence** The app is the only thing that notices when the pinned host stops answering.
- **Scope** A periodic unauthenticated request distinguishing error 1042 from an application response. **Non-goals** authenticated synthetic traffic.
- **Do** Specify; implementation requires an external scheduler.
- **Mutation** `RO` here · **Owner** B · **Deps** WDV-09
- **Accept** A specification precise enough to implement without further decisions.
- **Rollback** n/a
- **Impact** X · **Artifact** Appendix D D-28

#### OBS-05 — Add a synthetic check for the OCPP endpoint
- **Evidence** Charger connectivity is the highest-consequence signal and the least observable.
- **Scope** A WebSocket upgrade attempt with no OCPP payload. **Non-goals** impersonating a charger.
- **Do** Specify.
- **Mutation** `RO` here · **Owner** B · **Deps** OCG-02
- **Accept** A check that fails when the gateway is unreachable and passes otherwise.
- **Rollback** n/a
- **Impact** A · **Artifact** Appendix D D-31

#### OBS-06 — Expose a connected-charger count
- **Evidence** Post-deploy verification needs a before and after number; none is currently observable.
- **Scope** A count, not per-charger detail. **Non-goals** exposing charger identifiers publicly.
- **Do** A owns the implementation; B owns the requirement.
- **Mutation** `RO` here · **Owner** A · **Deps** OCG-10
- **Accept** A number readable by an operator during a deploy.
- **Rollback** n/a
- **Impact** A · **Artifact** Appendix E CL-58

#### OBS-07 — Alert on Neon connection exhaustion
- **Evidence** Worker concurrency and Postgres connection limits meet under load, usually unpleasantly.
- **Scope** A threshold alert. **Non-goals** autoscaling changes.
- **Do** Specify the threshold from NPR-11.
- **Mutation** `RO` here · **Owner** B · **Deps** NPR-11
- **Accept** A threshold with a stated headroom.
- **Rollback** n/a
- **Impact** A · **Artifact** Appendix D D-40

#### OBS-08 — Alert on queue and dead-letter depth
- **Evidence** A growing DLQ is silent until something downstream is missing.
- **Scope** Depth thresholds per queue. **Non-goals** auto-purging.
- **Do** Specify from CFD-12.
- **Mutation** `RO` here · **Owner** B · **Deps** CFD-12
- **Accept** A threshold per queue.
- **Rollback** n/a
- **Impact** A · **Artifact** Appendix D D-13

#### OBS-09 — Record error 1042 as a first-class alert condition
- **Evidence** It is the exact signature of the workers.dev and hostname failures this programme is built around.
- **Scope** Any synthetic check that receives 1042 alerts immediately. **Non-goals** treating it as a generic 5xx.
- **Do** Specify.
- **Mutation** `RO` · **Owner** B · **Deps** WDV-10
- **Accept** 1042 is distinguished from other failures in the alert definition.
- **Rollback** n/a
- **Impact** none · **Artifact** RD-02

#### OBS-10 — Decide who receives alerts and how
- **Evidence** An alert with no recipient is a log line.
- **Scope** One channel and one person. **Non-goals** a rotation that does not exist.
- **Do** Record in AD-16.
- **Mutation** `RO` · **Owner** H · **Deps** —
- **Accept** A named recipient and a channel that reaches them.
- **Rollback** n/a
- **Impact** none · **Artifact** AD-16

#### OBS-11 — Ensure no alert or log carries personal data
- **Evidence** Beta has real users; logs are the easiest place for their data to leak.
- **Scope** A redaction rule for identifiers and payloads. **Non-goals** disabling logging.
- **Do** Specify what may never be logged.
- **Mutation** `RO` · **Owner** B+A · **Deps** —
- **Accept** A rule that the code can be checked against.
- **Rollback** n/a
- **Impact** A · **Artifact** Appendix G P-19

#### OBS-12 — Record observability gaps as explicit release inputs
- **Evidence** Several verifications in this programme cannot currently be performed because nothing observes the thing.
- **Scope** A list of checks that are specified but not yet possible. **Non-goals** pretending they pass.
- **Do** Mark each such check as blocked-by-observability.
- **Mutation** `RO` · **Owner** B · **Deps** OBS-01
- **Accept** The go/no-go review sees the list.
- **Rollback** n/a
- **Impact** A and X · **Artifact** Appendix K

---

## Group R — rollback drills (10)

#### RBD-01 — Write and schedule the bad-Worker-version drill
- **Evidence** No rollback has ever been performed on this estate and no version id exists to roll back to.
- **Scope** Capture a version, deploy a known-good change, roll back, measure. **Non-goals** deploying a deliberately broken version to beta.
- **Do** See RD-01.
- **Mutation** `EXT` + `APPROVAL` · **Owner** H · **Deps** PCR-08
- **Accept** Rollback completes and the elapsed time is recorded in the manifest.
- **Rollback** Roll forward.
- **Impact** A and X · **Artifact** RD-01

#### RBD-02 — Write the workers.dev-disabled drill
- **Evidence** This is the foot-gun the whole programme is organised around.
- **Scope** Detection by 1042, containment by re-enabling, verification by the pinned host answering. **Non-goals** inducing it on beta.
- **Do** See RD-02.
- **Mutation** `RO` to write · **Owner** B · **Deps** WDV-10
- **Accept** Drill exists with a recognisable signature and a re-enable step.
- **Rollback** n/a
- **Impact** X · **Artifact** RD-02

#### RBD-03 — Write the mobile-host-broken drill
- **Evidence** The shipped app cannot be changed quickly; the fix must be server-side.
- **Scope** Restore the hostname rather than ship an app update. **Non-goals** waiting for store review during an outage.
- **Do** See RD-03.
- **Mutation** `RO` to write · **Owner** B · **Deps** WDV-04
- **Accept** Drill names the server-side restoration as the only fast path.
- **Rollback** n/a
- **Impact** X · **Artifact** RD-03

#### RBD-04 — Write the gateway-unreachable drill
- **Evidence** The clients are physical and their reconnect behaviour is not yet measured.
- **Scope** Detection, rollback, and reconnect verification. **Non-goals** commanding chargers.
- **Do** See RD-04.
- **Mutation** `RO` to write · **Owner** B · **Deps** OCG-04
- **Accept** Drill includes a reconnect-storm consideration.
- **Rollback** n/a
- **Impact** A · **Artifact** RD-04

#### RBD-05 — Write the same-zone fetch failure drill
- **Evidence** The web-to-API path is the one that depends on Custom Domain status.
- **Scope** Detection, flag flip, verification. **Non-goals** debugging in production.
- **Do** See RD-05.
- **Mutation** `RO` to write · **Owner** B · **Deps** SZB-06
- **Accept** Drill's first containment step is the flag, not a redeploy.
- **Rollback** n/a
- **Impact** A · **Artifact** RD-05

#### RBD-06 — Write the bad-migration drill
- **Evidence** The realistic database disaster is a migration.
- **Scope** Detection, backup-branch restore, endpoint repoint, verification. **Non-goals** a restore without repointing.
- **Do** See RD-06.
- **Mutation** `RO` to write · **Owner** B+A · **Deps** NBK-06
- **Accept** Drill names every place the endpoint appears.
- **Rollback** n/a
- **Impact** A · **Artifact** RD-06

#### RBD-07 — Write the beyond-PITR drill
- **Evidence** Seven days is a hard ceiling; beyond it only deliberate branches exist.
- **Scope** What recovery looks like when PITR cannot reach the needed point. **Non-goals** pretending a recovery exists.
- **Do** See RD-07.
- **Mutation** `RO` to write · **Owner** B · **Deps** NBK-03
- **Accept** Drill states honestly what is unrecoverable.
- **Rollback** n/a
- **Impact** A · **Artifact** RD-07

#### RBD-08 — Write the accidental-push-to-staging drill
- **Evidence** Two branches track `origin/staging` and one carries a forbidden commit.
- **Scope** Detection, containment, and the recognition that a force-push fix is itself dangerous. **Non-goals** normalising force pushes.
- **Do** See RD-08.
- **Mutation** `RO` to write · **Owner** B · **Deps** GBS-01
- **Accept** Drill's first step is to determine whether the push triggered a deploy.
- **Rollback** n/a
- **Impact** A and X · **Artifact** RD-08

#### RBD-09 — Write the CPMS-redeploy-collision drill
- **Evidence** If CPMS retains a Git integration, a merge there redeploys Straumvakt's Workers.
- **Scope** Detection by unexpected version change, containment by rollback, resolution by separation. **Non-goals** editing CPMS.
- **Do** See RD-09.
- **Mutation** `RO` to write · **Owner** B · **Deps** CPS-03
- **Accept** Drill distinguishes an unexpected deploy from a bad deploy.
- **Rollback** n/a
- **Impact** none · **Artifact** RD-09

#### RBD-10 — Write the cleanup-deleted-something-needed drill
- **Evidence** The whole preservation programme exists because this is plausible.
- **Scope** Detection, archive restore, hash verification. **Non-goals** relying on the recycle bin.
- **Do** See RD-10.
- **Mutation** `RO` to write · **Owner** B · **Deps** CLP-16
- **Accept** Drill restores from the verified archive, not from memory.
- **Rollback** n/a
- **Impact** A and X · **Artifact** RD-10

---

## Group S — approval and decision records (12)

#### APR-01 — Write every decision so it can be answered in one sitting
- **Evidence** Andri is frequently away; a decision requiring context reconstruction does not get made.
- **Scope** Decision, options, recommendation, consequences, reversibility, prerequisites, evidence. **Non-goals** a discussion document.
- **Do** Appendix H format.
- **Mutation** `RO` · **Owner** B · **Deps** —
- **Accept** Each record fits on one screen.
- **Rollback** n/a
- **Impact** none · **Artifact** Appendix H

#### APR-02 — Mark each decision reversible or irreversible explicitly
- **Evidence** The reversible ones can be made quickly; conflating them slows everything down.
- **Scope** One field per record. **Non-goals** hedging.
- **Do** State it plainly, including the cost of reversal where it is non-zero.
- **Mutation** `RO` · **Owner** B · **Deps** APR-01
- **Accept** Every record has the field.
- **Rollback** n/a
- **Impact** none · **Artifact** Appendix H

#### APR-03 — Give every decision a recommendation, not a menu
- **Evidence** A list of options with no recommendation transfers the whole analytical burden back.
- **Scope** One recommended option per record with a reason. **Non-goals** false balance.
- **Do** Recommend.
- **Mutation** `RO` · **Owner** B · **Deps** APR-01
- **Accept** Every record recommends.
- **Rollback** n/a
- **Impact** none · **Artifact** Appendix H

#### APR-04 — State the prerequisites so a yes is actionable
- **Evidence** An approved decision that cannot be executed for another week is not progress.
- **Scope** What must be true before the yes can be acted on. **Non-goals** hiding blockers.
- **Do** List them.
- **Mutation** `RO` · **Owner** B · **Deps** APR-01
- **Accept** Every record lists prerequisites or states there are none.
- **Rollback** n/a
- **Impact** none · **Artifact** Appendix H

#### APR-05 — State the evidence required before the decision is sound
- **Evidence** Several decisions depend on facts that are still blocked.
- **Scope** Which evidence, and from which capture template. **Non-goals** deciding without it.
- **Do** Cross-reference Appendix D.
- **Mutation** `RO` · **Owner** B · **Deps** APR-01
- **Accept** Every record names its evidence or states that none is needed.
- **Rollback** n/a
- **Impact** none · **Artifact** Appendix H

#### APR-06 — Separate decisions that block beta from those that block production
- **Evidence** Treating them as one queue stalls beta on production-only questions.
- **Scope** A tag per record. **Non-goals** a priority number that means nothing.
- **Do** Tag each.
- **Mutation** `RO` · **Owner** B · **Deps** APR-01
- **Accept** The beta-blocking set is small.
- **Rollback** n/a
- **Impact** A and X · **Artifact** Appendix H

#### APR-07 — Record decisions once made, in the ledger and nowhere else
- **Evidence** Decisions recorded in three places diverge.
- **Scope** The release evidence ledger. **Non-goals** the visual status page, which belongs to the coordinator.
- **Do** Append the outcome and date.
- **Mutation** `LOCAL` · **Owner** B · **Deps** —
- **Accept** One authoritative location.
- **Rollback** n/a
- **Impact** coordinator · **Artifact** Release evidence ledger

#### APR-08 — Identify the decisions only Andri can make
- **Evidence** Some are technical and delegable; some involve money, customers, or irreversible external state.
- **Scope** A short list marked H-only. **Non-goals** escalating everything.
- **Do** Mark them.
- **Mutation** `RO` · **Owner** B · **Deps** APR-01
- **Accept** The H-only list is genuinely short.
- **Rollback** n/a
- **Impact** none · **Artifact** Appendix H

#### APR-09 — Record what happens if a decision is not made
- **Evidence** Indecision is itself a choice with consequences that are rarely stated.
- **Scope** The default outcome per record. **Non-goals** pressure tactics.
- **Do** State the consequence of no, honestly.
- **Mutation** `RO` · **Owner** B · **Deps** APR-01
- **Accept** Every record has a consequence-of-no.
- **Rollback** n/a
- **Impact** none · **Artifact** Appendix H

#### APR-10 — Establish who owns the production no-go
- **Evidence** A no-go with no owner is cleared by whoever is most impatient.
- **Scope** One named person per no-go condition. **Non-goals** a committee.
- **Do** Record in AD-16.
- **Mutation** `RO` · **Owner** H · **Deps** —
- **Accept** Every no-go names a clearer.
- **Rollback** n/a
- **Impact** A and X · **Artifact** AD-16

#### APR-11 — Keep a record of decisions that were reversed
- **Evidence** A reversed decision usually means the evidence was wrong, and that is worth knowing.
- **Scope** The reversal and its reason. **Non-goals** blame.
- **Do** Append to the ledger.
- **Mutation** `LOCAL` · **Owner** B · **Deps** APR-07
- **Accept** Reversals are visible, not overwritten.
- **Rollback** n/a
- **Impact** none · **Artifact** Release evidence ledger

#### APR-12 — Re-check decisions whose evidence has since changed
- **Evidence** Several decisions here rest on facts captured once and never re-verified.
- **Scope** A staleness date per record. **Non-goals** re-litigating settled questions.
- **Do** Record when each record's evidence was captured.
- **Mutation** `RO` · **Owner** B · **Deps** APR-05
- **Accept** Every record shows the age of its evidence.
- **Rollback** n/a
- **Impact** none · **Artifact** Appendix H

---

## Count

| Group | Items |
|---|---|
| A Cloudflare read-only access setup | 16 |
| B Cloudflare dashboard evidence | 20 |
| C Cloudflare API evidence | 14 |
| D workers.dev hardening | 16 |
| E gateway / OCPP continuity | 12 |
| F same-zone fetch / service bindings | 12 |
| G release manifest and validator | 18 |
| H GitHub branch safety / protection | 18 |
| I staging / default branch hygiene | 10 |
| J Neon production runway | 18 |
| K Neon backup / restore / PITR | 12 |
| L beta environment rehearsal | 14 |
| M production cutover readiness | 14 |
| N CPMS separation | 10 |
| O cleanup preservation | 18 |
| P cleanup dry-run and archive flow | 14 |
| Q observability and alerts | 12 |
| R rollback drills | 10 |
| S approval and decision records | 12 |
| **Total** | **270** |

Requirement was 220. Every group meets or exceeds its stated minimum.
