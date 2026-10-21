# Appendix D — Evidence-capture templates (42)

Fill these during a read-only session. Each template is designed so that a
completed copy is **evidence** — reproducible, hashed, and containing nothing
that would be dangerous to store.

**Universal redaction rule.** No template in this appendix has a field that can
legitimately hold a secret value. If you find yourself pasting something with an
`=`, a `:`, a `/`, or more than 40 characters into a field marked *name only*,
stop: that is a value, and the capture must be redone.

**Universal screenshot rule.** Where a template says *screenshot required*, the
captured text is not sufficient. Those are the facts where a state is only
observable in the interface, or where the interface's own rendering is the
evidence. Redact the browser's address bar if it contains a session token.

---

## Cloudflare — access and identity

### D-01 — Read-only token permission set
**Fact** The exact permissions granted to the evidence-session token. · **Why** Every blocked fact maps to a permission; an under-granted token wastes the session, an over-granted one can deploy.
**Where** dash.cloudflare.com → My Profile → API Tokens → Create Custom Token, before clicking Continue. · **Screenshot required.**
**Copy** Each permission row as `<scope>:<resource>:<level>`. **Never copy** the token value itself. **Redact** nothing — permissions are not sensitive.
**Expected** Ten rows, all `Read`. **Dangerous** Any row reading `Edit` — `Workers Scripts:Edit` alone can deploy. **Next** If any Edit permission appears, cancel and start the form again.

### D-02 — Token write-refusal proof
**Fact** The token is genuinely incapable of mutation. · **Why** The whole safety case for a logged-in session rests on this, and it is currently an assumption about a form someone filled in.
**Where** `curl -X PUT .../workers/scripts/hlada-staging` with the token. · **Screenshot** optional; the transcript is the evidence.
**Copy** HTTP status and the error `code` and `message`. **Never copy** the `Authorization` header. **Redact** the token from any pasted command.
**Expected** `403` with an authentication-class error. **Dangerous** `400` — the request was accepted for processing and rejected on shape, which is not proof of read-only. **Next** On anything but 403, revoke and reissue with narrower permissions.

### D-03 — Account and zone identity
**Fact** The account id and the `straumvakt.org` zone id. · **Why** Nearly every API path needs them, and neither is a credential.
**Where** `GET /accounts` and `GET /zones?name=straumvakt.org`. · **Screenshot** optional.
**Copy** `id`, `name`, `status`, `name_servers`. **Never copy** anything from `/user`. **Redact** nothing.
**Expected** Exactly one account; 32-hex id; zone `status: active`; nameservers matching the registrar. **Dangerous** More than one account — the token scope is wrong. **Next** Record both ids at the top of the evidence bundle; every later template references them.

### D-20 — Account membership
**Fact** Who can deploy. · **Why** Every protection in this programme assumes a known set of people with access, and that set has never been written down.
**Where** Account → Manage Account → Members. · **Screenshot required.**
**Copy** Email, role, two-factor status, date added. **Never copy** anything from a member's own profile. **Redact** nothing — these are colleagues, not secrets, but keep the file out of any public repository.
**Expected** A small list; every Administrator or Workers Admin expected. **Dangerous** A member nobody recognises, or an Administrator with no two-factor. **Next** Escalate any unexpected member immediately — before continuing the session.

### D-21 — Account audit log (30 days)
**Fact** What actually happened on the control plane, and who did it. · **Why** The estate's history has been reconstructed from configuration files; platform events are the primary source.
**Where** Account → Manage Account → Audit Log. · **Screenshot required** for any entry that will be cited.
**Copy** Actor, action, resource, timestamp. **Never copy** any `newValue` field that could contain a secret. **Redact** token-shaped strings in resource identifiers.
**Expected** Every deploy and DNS change attributable to a named actor. **Dangerous** A deploy nobody can account for — that is the CPMS collision made visible. **Next** Cross-reference unattributed deploys against D-09.

---

## Cloudflare — Workers

### D-04 — Worker inventory
**Fact** Which Workers exist in the account. · **Why** The deployed estate is *believed* to be three beta Workers; belief is not a screenshot.
**Where** Workers & Pages → Overview. · **Screenshot required.**
**Copy** Name, last-deployed timestamp, environment label. **Never copy** nothing sensitive here. **Redact** nothing.
**Expected** `hlada-staging`, `hlada-api-staging`, `straumvakt-ocpp-staging`. **Dangerous** Any Worker this project did not create — that is a standing stop condition. **Next** Any unexpected Worker: stop the session, record it, and resolve ownership before continuing.

### D-05 — Worker version and deployment history
**Fact** The currently active version id per Worker, and the previous one. · **Why** No version id has ever been recorded, and the release validator correctly rejects a release with no rollback target.
**Where** Worker → Deployments; and `GET .../scripts/{name}/versions` plus `.../deployments`. · **Screenshot required.**
**Copy** `version_id`, `number`, `created_on`, source, and any gradual-rollout percentage. **Never copy** nothing sensitive. **Redact** nothing.
**Expected** At least one 36-character UUID per Worker; the **active** version distinguished from the **latest** — they are not necessarily the same. **Dangerous** No versions returned, or a rollout in progress (a rollback during a rollout is a different operation). **Next** Enter directly into `rollback.workerVersionsBefore`.

### D-06 — Gateway version, captured separately
**Fact** The active version of `straumvakt-ocpp-staging`. · **Why** This Worker terminates charger WebSockets; its blast radius is physical equipment, so it gets its own record and its own approval.
**Where** As D-05. · **Screenshot required.**
**Copy** As D-05, plus the Durable Object bindings visible on the same Worker. **Never copy** nothing sensitive. **Redact** nothing.
**Expected** One active version; `IDENTITY_DO` bound. **Dangerous** A DO binding pointing at a namespace id different from D-12's record. **Next** Record in the OCPP continuity record; gateway releases go in their own manifest.

### D-07 — Triggers: routes versus custom domains
**Fact** For each Worker, which of {Custom Domain, route, neither} applies. · **Why** Routes and Custom Domains are stored separately and behave differently, and that difference is the whole workers.dev finding.
**Where** Worker → Settings → Domains & Routes. · **Screenshot required.**
**Copy** Every hostname, its type, and its status. **Never copy** nothing sensitive. **Redact** nothing.
**Expected** `api.straumvakt.org` present as a **Custom Domain**. **Dangerous** It appears as a **route** — the web→API call may be looping back to the calling Worker instead of reaching the API. **Next** If it is a route, raise it before any further capture.

### D-08 — workers.dev enabled state, per Worker
**Fact** The literal enabled/disabled state of each Worker's workers.dev hostname. · **Why** The API and gateway configs declare neither `routes` nor `workers_dev`, so the live state is **inferred, not declared** — and it is only observable here.
**Where** Worker → Settings → Domains & Routes → the `workers.dev` row. · **Screenshot required — a successful `curl` is not evidence of the toggle state.**
**Copy** The state as rendered, plus the full hostname. **Never copy** nothing sensitive. **Redact** nothing.
**Expected** Enabled for the API (the mobile app pins it) and, pending D-31, for the gateway. **Dangerous** Enabled **and** undeclared in config — one routing change disables it silently. **Next** Raise ISS-01 (API) or ISS-02 (gateway) to blocking before any routing change.

### D-09 — Git integration and build configuration
**Fact** Which repository and branch, if any, deploys each Worker. · **Why** This is the only blocked fact with no CLI equivalent, and it determines whether merging a branch is also a deployment.
**Where** Worker → Settings → Build → Git repository. · **Screenshot required.**
**Copy** Repository owner and name, production branch, build command, root directory, builds enabled/disabled. **Never copy** any build-time environment **value**. **Redact** build-time variable values; names only.
**Expected** Each Worker attributed to exactly one repository. **Dangerous** A Worker connected to the **CPMS** repository, or to one nobody recognises. **Next** A CPMS-owned integration is production no-go NG-04. **Never click Disconnect during capture.**

### D-10 — Secret names bound to a Worker
**Fact** The set of secret names, and only the names. · **Why** A production cutover must reproduce the set; a Worker that deploys without its secrets fails at first request, after the cutover already looks successful.
**Where** Worker → Settings → Variables and Secrets (values hidden); and `GET .../scripts/{name}/secrets`. · **Screenshot** optional — and if taken, verify no value is rendered.
**Copy** `name` and `type` only. **Never copy** any value, and **never click a reveal control if one exists**. **Redact** — see the universal rule.
**Expected** Every name matches `^[A-Z][A-Z0-9_]*$`. **Dangerous** A captured "name" containing `=`, `:`, `/`, or over 40 characters — that is a value; discard the capture and redo it. **Next** Feed into the production secret enumeration; validator rule R5 rejects value-shaped entries.

### D-11 — Plaintext environment variables
**Fact** Non-secret variable names **and** values. · **Why** Plaintext variables are not secrets and are often the load-bearing configuration — feature flags, endpoints, environment names.
**Where** Same page, Variables section. · **Screenshot** optional.
**Copy** Name and value. **Never copy** anything the interface renders as a secret. **Redact** any value that looks like a credential, and report it as a finding rather than storing it.
**Expected** Ordinary configuration. **Dangerous** A credential stored as a plaintext variable — a real `AUTH_SECRET` from this project is already public in git history, so the habit exists. **Next** Any credential-shaped plaintext value becomes an immediate rotation issue.

### D-12 — Durable Object namespaces
**Fact** Namespace id, name, class, and script for every DO binding. · **Why** Charger identity lives in `IDENTITY_DO`. A cutover that creates a new namespace rather than binding the existing one loses every charger's identity **silently** — they connect and are treated as unknown.
**Where** Worker → Settings → Bindings; and `GET /accounts/{id}/workers/durable_objects/namespaces`. · **Screenshot required.**
**Copy** `id`, `name`, `class`, `script`. **Never copy** any object contents. **Redact** nothing.
**Expected** `IDENTITY_DO` present with a stable namespace id. **Dangerous** Two namespaces with similar names — one is probably orphaned and binding the wrong one is catastrophic. **Next** Record the id in the gateway release manifest and verify it is unchanged after every gateway deploy.

### D-13 — Queues, consumers, and depths
**Fact** Queue topology plus backlog and dead-letter depth **with a timestamp**. · **Why** A non-zero dead-letter depth is unprocessed work that a cutover would strand, and it is silent until something downstream is missing.
**Where** Workers → Queues (depths); `GET /accounts/{id}/queues` (topology). · **Screenshot required** for depths.
**Copy** Queue name, producer, consumer, backlog, DLQ depth, capture timestamp. **Never copy** message bodies. **Redact** any message content that appears in a preview — it may contain customer data.
**Expected** Dead-letter depths at zero. **Dangerous** Any non-zero DLQ — a production no-go input. **Next** **Never purge a queue during capture.** Record and escalate.

### D-14 — Hyperdrive configuration
**Fact** Hyperdrive id, origin host, database name, caching mode. · **Why** Hyperdrive sits between the Worker and Postgres. If it points at the wrong Neon branch, application code cannot tell — the queries succeed against the wrong data.
**Where** Workers → Hyperdrive → config detail; `GET /accounts/{id}/hyperdrive/configs`. · **Screenshot required.**
**Copy** `id`, origin host, database, caching settings. **Never copy** the password — the API does not return it, and that is correct behaviour to be respected, not worked around. **Redact** any credential in a displayed connection string.
**Expected** Origin host matching the Neon branch identified in D-38. **Dangerous** An origin that does not match, or one that resolves to the **project default branch** — which is abandoned. **Next** A mismatch is the most invisible possible data bug; raise it before anything else in the session.

### D-15 — R2 buckets and bindings
**Fact** Bucket names, bindings, and public-access state. · **Why** Object storage is the one place a cutover can silently orphan customer data.
**Where** R2 → Overview; and each Worker's Bindings section. · **Screenshot** optional.
**Copy** Bucket name, binding name, public/private, custom domain if any. **Never copy** object keys or contents. **Redact** any object key that appears — keys can embed identifiers.
**Expected** Private buckets only. **Dangerous** A public bucket, or a bucket bound to a Worker but absent from the config. **Next** Any public bucket is a finding to raise the same day.

### D-19 — Presence or absence of production-named Workers
**Fact** Whether the production Worker names exist at all. · **Why** They currently return error 1042, which is consistent with "not deployed" but does **not** prove "does not exist".
**Where** Workers & Pages → Overview → search each production name. · **Screenshot required.**
**Copy** Present/absent per name, plus last-deployed if present. **Never copy** nothing sensitive. **Redact** nothing.
**Expected** Absent. **Dangerous** Present — something deployed under a production name and nobody in this project did it. **Next** A present production Worker is a stop condition; resolve ownership before any cutover planning continues.

### D-22 — Worker script list via API
**Fact** The machine-readable Worker inventory. · **Why** Dashboard screenshots do not diff; JSON does.
**Where** `GET /accounts/{id}/workers/scripts`. · **Screenshot** not applicable.
**Copy** The full JSON response. **Never copy** nothing sensitive in this endpoint. **Redact** nothing.
**Expected** Matches D-04 exactly. **Dangerous** A discrepancy between API and dashboard — one of the two views is filtered. **Next** Save as `workers-scripts.json` and hash it.

### D-23 — Worker bindings and the Worker-to-Worker path map
**Fact** Every binding per Worker, and the resulting call-path map. · **Why** Config files show intent; the API shows reality, and the two have never been compared.
**Where** `GET .../scripts/{name}/settings`. · **Screenshot** optional.
**Copy** Binding type, name, target, per Worker. **Never copy** any secret binding's value. **Redact** per the universal rule.
**Expected** Four Worker-to-Worker paths: three service bindings, and **exactly one plain-HTTPS path** (web→API). The gateway binds `MAIN_APP` to the API **by name**. **Dangerous** A binding target that does not exist, or a fourth service binding nobody documented. **Next** Feed into the declared-versus-deployed delta table; the plain-HTTPS path is the same-zone risk.

### D-24 — Worker routes on the zone
**Fact** Every route pattern and the Worker it targets. · **Why** Adding a route infers `workers_dev = false`; knowing which routes exist is how that inference is predicted.
**Where** `GET /zones/{zid}/workers/routes`. · **Screenshot** optional.
**Copy** Pattern and script name. **Never copy** nothing sensitive. **Redact** nothing.
**Expected** Either an explicit list or an empty one — **an empty list is a finding to record, not an omission to skip**. **Dangerous** A wildcard pattern nobody expected. Note that a wildcard covers exactly one subdomain level, so `*.straumvakt.org` covers `beta.api.straumvakt.org` only if the pattern is written for it. **Next** Cross-check every pattern against D-07.

### D-25 — Worker custom domains
**Fact** Which hostnames are attached as Custom Domains, and their status. · **Why** The web→API path is the one Worker-to-Worker path that depends on Custom Domain status.
**Where** `GET /accounts/{id}/workers/domains`. · **Screenshot** optional.
**Copy** Hostname, zone, service, environment, status. **Never copy** nothing sensitive. **Redact** nothing.
**Expected** `api.straumvakt.org` present with `status: active`. **Dangerous** Absent or pending — the dependency this project relies on is not in place. **Next** If absent, the same-zone risk is live now, not hypothetical.

### D-26 — Evidence bundle hash manifest
**Fact** A SHA-256 per evidence file. · **Why** Evidence that cannot be shown unchanged is not evidence.
**Where** `Get-FileHash -Algorithm SHA256` across the bundle. · **Screenshot** not applicable.
**Copy** Filename and hash. **Never copy** file contents into the manifest. **Redact** nothing.
**Expected** Every file listed; re-hashing reproduces the manifest exactly. **Dangerous** A file present in the directory but absent from the manifest. **Next** Run the secret scanner across the bundle before the manifest is considered final.

### D-27 — Declared versus deployed delta
**Fact** A three-column comparison: what the wrangler configs declare, what the API reports, and the difference. · **Why** These two have never been compared, and the whole release model assumes they agree.
**Where** Derived from D-22 … D-25 and the three `wrangler.jsonc` files. · **Screenshot** not applicable.
**Copy** Per Worker: bindings, routes, domains, secret names, workers.dev state. **Never copy** values. **Redact** per the universal rule.
**Expected** Deltas exist — that is the point. **Dangerous** A delta nobody can explain, particularly a binding present in one view and not the other. **Next** Every delta gets a work item; **zero deltas is itself a recorded result**, not an absence of one.

---

## Cloudflare — hostnames and clients

### D-16 — Zone DNS records
**Fact** Every DNS record on `straumvakt.org`. · **Why** Custom Domains manifest as proxied records; the record set is the ground truth for routing.
**Where** `GET /zones/{zid}/dns_records?per_page=100`; and Zone → DNS → Records. · **Screenshot required.**
**Copy** Name, type, content, proxy status, TTL. **Never copy** nothing sensitive. **Redact** nothing.
**Expected** API and dashboard counts match; every hostname the project uses appears, or is explicitly recorded absent. **Dangerous** A record pointing somewhere nobody recognises; a count mismatch between the two views. **Next** Compare against the pre-written expected record set before any domain change.

### D-17 — Edge certificate SAN list
**Fact** Which hostnames the certificate actually covers. · **Why** `www.straumvakt.org` is **known absent** from the apex SAN, and a TLS error reads to a user as compromise rather than misconfiguration.
**Where** Zone → SSL/TLS → Edge Certificates. · **Screenshot required.**
**Copy** Hosts, issuer, type, expiry. **Never copy** any private key material — none should be visible. **Redact** nothing.
**Expected** Every production hostname covered. **Dangerous** A hostname with no coverage and no plan; a certificate expiring within 30 days. **Next** Compare against every planned production hostname before the cutover, not during it.

### D-18 — Account workers.dev subdomain
**Fact** The account's workers.dev subdomain string. · **Why** The hostname the mobile app pins is **account-scoped**, not Worker-scoped, so it is a shared dependency.
**Where** Workers & Pages → Subdomain. · **Screenshot required.**
**Copy** The subdomain string. **Never copy** nothing sensitive. **Redact** nothing.
**Expected** Matches the host pinned in `apps/mobile/lib/api/client.dart`. **Dangerous** A mismatch, or any suggestion of changing it — changing the account subdomain is irreversible in practice and would break every pinned host at once. **Next** Record it as a permanent dependency in the addressing decision.

### D-28 — External clients that pin a hostname
**Fact** Every client that hard-codes a hostname, with a file:line citation. · **Why** The blast radius of a hostname change is exactly this list.
**Where** Source grep across `apps/mobile`, the web app, and any published documentation. · **Screenshot** not applicable.
**Copy** Client, pinned host, file:line. **Never copy** nothing sensitive. **Redact** nothing.
**Expected** `apps/mobile/lib/api/client.dart` pinning `hlada-api-staging.straumvakt.workers.dev`. **Dangerous** A pinned host with no citation — that means it is guessed. Charger configuration is **not determinable from this repository** and must be recorded as such rather than assumed. **Next** Feed into the addressing decision; each pinned host costs a client release to change.

### D-29 — Inference behaviour verification (throwaway Worker)
**Fact** Observed behaviour when a route is added to a Worker with workers.dev enabled. · **Why** The inference is documented, but this project has been wrong about documented behaviour before.
**Where** A disposable Worker in a sandbox account — **never a Straumvakt Worker**. · **Screenshot required.**
**Copy** Before/after workers.dev state and the exact config change that caused it. **Never copy** nothing sensitive. **Redact** nothing.
**Expected** workers.dev becomes disabled when `routes` is added without an explicit `workers_dev`. **Dangerous** Behaviour that differs from the documentation — then the finding needs revising, not the documentation trusting. **Next** Delete the throwaway Worker; record the observation either way.

### D-30 — CI deploy capability
**Fact** Whether any automated system holds a Cloudflare deploy credential. · **Why** If it does, merging a pull request can deploy without anyone present — which changes what branch protection is for.
**Where** `gh secret list`, `gh workflow list`, and any workflow file mentioning Cloudflare or Wrangler. · **Screenshot** not applicable.
**Copy** Secret **names**, workflow names, trigger conditions. **Never copy** any secret value — `gh secret list` returns names only, which is the correct tool for this reason. **Redact** nothing.
**Expected** A definitive yes or no. **Dangerous** A workflow triggered on push to the deploy pointer branch holding a deploy token. **Next** A yes changes the threat model and raises the priority of branch protection.

---

## OCPP, mobile, and product continuity

### D-31 — OCPP endpoint as chargers are configured
**Fact** The exact host, path, protocol, and port chargers connect to. · **Why** Continuity can only be proven against a known value, and that value lives in charger configuration rather than in this repository.
**Where** Gateway config, onboarding documentation, and vendor portal. · **Screenshot required** where the vendor portal is the source.
**Copy** The full endpoint string, and variant counts if more than one exists. **Never copy** any charger credential or identity token. **Redact** charger serial numbers where they identify a customer site.
**Expected** A single canonical endpoint. **Dangerous** Variants nobody knew about — the continuity proof then covers only some of the fleet. **Next** Record in the gateway release manifest; the release must state that this string is unchanged.

### D-32 — Charger reconnect profile
**Fact** Backoff, retry interval, and worst-case simultaneous connections. · **Why** Every gateway deploy decision — window, downtime ceiling, capacity headroom — depends on numbers nobody currently has.
**Where** The OCPP specifications preserved in `docs/OCPP`, plus vendor documentation. · **Screenshot** not applicable.
**Copy** Backoff algorithm, interval bounds, fleet size, derived worst-case concurrency. **Never copy** nothing sensitive. **Redact** nothing.
**Expected** A worst-case figure **with its derivation shown**. **Dangerous** Deriving it by inducing a reconnect storm — do not. **Next** Feeds the downtime ceiling, the deploy window, and the Neon connection headroom.

### D-33 — In-flight session behaviour during a gateway outage
**Fact** Whether a charger continues delivering energy while disconnected, and how the session is reconciled afterwards. · **Why** A session in progress is a physical event with a customer attached.
**Where** The OCPP specification and the gateway's reconnect handling code. · **Screenshot** not applicable.
**Copy** The behaviour, cited to specification section and to file:line. **Never copy** any live session data. **Redact** customer identifiers if any example session is referenced.
**Expected** A written statement with both citations. **Dangerous** No specification-level answer — then the behaviour is vendor-specific and must be established per charger model. **Next** Determines whether a gateway deploy window needs to avoid active sessions.

### D-42 — Observability inventory and gaps
**Fact** What telemetry exists per Worker, and what does not. · **Why** Several verifications in this programme end with "if none exists, that is the finding" — this template turns that into a list.
**Where** Worker settings, and any reporting integration in the source. · **Screenshot** optional.
**Copy** Logs, metrics, traces, error reporting, retention, per Worker. **Never copy** any log content — logs are the easiest place for customer data to leak. **Redact** all sample log lines.
**Expected** Named gaps. **Dangerous** Logs that only exist while someone is watching a tail — those are not logs. **Next** Any check that cannot be performed for want of telemetry is marked **blocked-by-observability** and shown at the go/no-go review, never silently skipped.

---

## GitHub

### D-34 — Branch and upstream inventory
**Fact** Every local branch's upstream, across every worktree, plus every remote branch's tip and age. · **Why** Two branches were found tracking the deploy pointer by inspection; nobody has checked the rest, and three agents create branches continuously.
**Where** `git for-each-ref --format='%(refname:short) -> %(upstream:short)' refs/heads` per worktree; `git ls-remote --heads origin`. · **Screenshot** not applicable.
**Copy** Branch, upstream, tip, ahead/behind against the trunk, dirty count. **Never copy** nothing sensitive. **Redact** nothing.
**Expected** 16 remote branches; **no local branch tracking `staging` or `main`** after remediation. Known cases: `dev/rename-prod-worker` (carries the forbidden `4fe0a95`) and `dev/secret-hygiene-v2`. **Dangerous** A branch you did not expect tracking the deploy pointer. **Next** Unset the upstream; the branch and its commits are untouched by that.

### D-35 — Branch protection and ruleset state
**Fact** Protection configuration, rulesets, and the bypass actor list. · **Why** After protection is enabled nobody can show what it was before, which matters if something breaks.
**Where** `gh api repos/{owner}/{repo}/branches --paginate` and `.../rulesets`. · **Screenshot** optional.
**Copy** Per branch: protected true/false, required checks, force-push allowed, deletion allowed. Per ruleset: rules and bypass actors. **Never copy** nothing sensitive. **Redact** nothing.
**Expected** Currently **0 of 16 protected** and rulesets `[]` — capture this before changing it. **Dangerous** A ruleset with a broad bypass list, which is documentation rather than protection. **Next** Hash both files into the evidence bundle before enabling anything.

### D-36 — Committed-secret status
**Fact** Whether the known committed `AUTH_SECRET` is still present, and whether it is live. · **Why** It was verified not live once; that was a point-in-time check and the value remains publicly readable.
**Where** `.env.example` in the working tree and in history; cross-referenced against D-10's secret names and any rotation timestamp. · **Screenshot** not applicable.
**Copy** File path, presence in working tree, presence in history, and the **shape** of the value. **Never copy** the value itself into any artifact. **Redact** the value everywhere.
**Expected** Present in history; scrubbed from the working tree after remediation. **Dangerous** The same shape appearing as a live binding name-and-value pair anywhere. **Next** Scrubbing the working tree does not remove it from history — **rotation is the only real remedy**, and that is a separate decision.

---

## Neon

### D-37 — Neon project inventory
**Fact** Projects, branches, computes, regions. · **Why** One project and no production project is the current state; the plan depends on that being accurate.
**Where** Neon console metadata. **No SQL at any point.** · **Screenshot** optional.
**Copy** Project id, name, region; every branch with id, parent, creation date, protection state; every compute with size and autoscaling bounds. **Never copy** any connection string — it contains a credential. **Redact** any DSN that appears in the interface.
**Expected** One project, 13 branches, **none protected**, no production project. **Dangerous** A project nobody recognises. **Next** Save as `neon-inventory.md` and hash it.

### D-38 — Environment-to-branch mapping
**Fact** Which `br-` identifier each environment actually uses. · **Why** The project default branch is **abandoned**; anything that defaults reaches the wrong data, and this has already caused wrong-branch reads here.
**Where** Cross-reference D-14's Hyperdrive origin against the Neon branch endpoint list. · **Screenshot** optional.
**Copy** Environment, branch id, endpoint host, how it is configured (secret name, Hyperdrive, or default). **Never copy** the connection string. **Redact** credentials in any endpoint string.
**Expected** Every environment maps to an **explicit** `br-` id. Staging is `br-tiny-river-abgpqq37`. **Dangerous** Any environment relying on the project default. **Next** Explicit ids go into every release manifest; `data.neonBranchId` is required and pattern-checked for exactly this reason.

### D-39 — Migration history state
**Fact** Recorded migrations versus migration files. · **Why** These have diverged before in this project, and choosing wrongly between `migrate deploy` and `resolve --applied` either re-runs a migration or hides one.
**Where** `_prisma_migrations` metadata and the migration directory. **Metadata reads only — no `migrate deploy`.** · **Screenshot** not applicable.
**Copy** Per migration: name, applied timestamp, checksum, file present yes/no. **Never copy** any row data. **Redact** nothing.
**Expected** A per-migration applied/pending/divergent table where **every divergence has a named action and a written reason**. **Dangerous** A migration recorded as applied whose file no longer exists; a blanket resolve proposed instead of per-migration decisions. **Next** Also record the dual-ORM position — Prisma and Drizzle both exist, and two migration authorities is one too many.

### D-40 — Connection limits and headroom
**Fact** Compute size, autoscaling bounds, max connections, and whether Hyperdrive pooling is in the path per Worker. · **Why** Worker concurrency and Postgres connection limits meet at exactly one place, and it is usually discovered under load.
**Where** Neon console; D-14 for Hyperdrive. · **Screenshot** optional.
**Copy** All four numbers plus the per-Worker pooling answer. **Never copy** nothing sensitive. **Redact** nothing.
**Expected** Stated headroom against expected user concurrency **and** the worst-case charger reconnect storm from D-32. **Dangerous** Worst-case concurrency exceeding the ceiling. **Next** Sets the connection-exhaustion alert threshold.

### D-41 — Retention, PITR, and branch storage
**Fact** History retention in hours, and storage attributable to branches. · **Why** Seven days is the current understanding, and the entire long-horizon recovery plan depends on that number being right.
**Where** Neon project settings and storage metrics. · **Screenshot required** for the retention setting.
**Copy** Retention hours, storage per branch, total. **Never copy** nothing sensitive. **Redact** nothing.
**Expected** Seven days, confirmed by screenshot rather than by recollection. **Dangerous** A problem noticed on day eight is unrecoverable by PITR — beyond the window, only **deliberately created backup branches** exist. **Next** Set the retention decision and the backup-branch naming convention from this number.

---

## Cleanup and local estate

### D-43 — Preservation target presence and hashes
**Fact** That every irreplaceable artifact is present and copied. · **Why** Several exist in exactly one place, untracked, one `git clean` from gone.
**Where** `cleanup-dryrun.ps1` section 1, plus `Get-FileHash` on both sides of each copy. · **Screenshot** not applicable.
**Copy** Path, file count, hash manifest. **Never copy** nothing sensitive, but keep the copies outside `E:\Claude` — the tree is itself a cleanup target. **Redact** nothing.
**Expected** `docs/OCPP` **128 files**; `Straumvakt-parked` **38 files**; all preservation targets PRESENT; hashes matching on both sides. **Dangerous** Any `*** MISSING ***` line, or a count mismatch. **Next** A missing target stops all cleanup immediately.

### D-44 — Prompt and evidence folder version-control state
**Fact** Whether the folder driving this programme has any real version control. · **Why** **Correction to an earlier finding:** it was recorded as merely unbacked. The truth is worse — it has a `.git` directory with **zero commits and zero tracked files**, which invites the assumption that it is safe.
**Where** `C:\Users\Andri\Documents\New project` — `git log`, `git ls-files`, `git status`. · **Screenshot** not applicable.
**Copy** Commit count, tracked file count, untracked count, total file count, top-level markdown count. **Never copy** file contents. **Redact** nothing.
**Expected** After remediation: at least one commit, the **28 top-level markdown prompts** and the coordinator ledger tracked, and `git status` showing tens of untracked entries rather than tens of thousands. **Dangerous** Current state — 0 commits, 0 tracked, 160 untracked at top level, 22,759 files in total, most of them tool caches (`.jadx-1.5.5`, `.zaptec-apk`, `.zaptec-jadx`, `cache/`). **Next** Add a `.gitignore` for the caches, then commit the documents. The visual status page is preserved here but **belongs to the coordinator — do not edit it**.

### D-45 — Estate measurement, reparse points excluded
**Fact** Total, regenerable, and irreplaceable size of `E:\Claude`. · **Why** The first measurement followed junctions, double-counted shared `node_modules`, and produced impossible figures — negative real content and more reclaimable space than the tree contained.
**Where** `cleanup-dryrun.ps1` section 4. · **Screenshot** not applicable.
**Copy** Per directory: total GB, reclaimable GB, content MB. **Never copy** nothing sensitive. **Redact** nothing.
**Expected** **43.76 GB total, 41.57 GB (95%) regenerable, 2.25 GB real content.** **Dangerous** Any measurement that includes reparse points — it will be wrong in the same way as the first attempt. **Next** Save as a dated baseline **outside** `E:\Claude`; the script refuses an inside path by design.

### D-46 — Junction inventory and unlink order
**Fact** Every junction, its target, and whether it crosses worktrees. · **Why** `Remove-Item -Recurse` can traverse a junction and delete the **target** rather than the link — the same following behaviour that produced the impossible measurement.
**Where** `cleanup-dryrun.ps1` section 3. · **Screenshot** not applicable.
**Copy** Junction path, target path, cross-worktree flag, required unlink order. **Never copy** nothing sensitive. **Redact** nothing.
**Expected** Five cross-worktree junctions. **Dangerous** Any plan that prunes before unlinking, or that uses a recursive delete near a junction. **Next** Unlink with `cmd /c rmdir "<junction>"` only, then confirm each target's file count is unchanged.

### D-47 — Worktree retirement candidacy
**Fact** Per worktree: tip, branch, dirty count, and unique commits against the release candidate. · **Why** A worktree is safe to retire only when it holds nothing that exists nowhere else — and a zero-unique worktree with uncommitted changes is **not** safe.
**Where** `cleanup-dryrun.ps1` section 5, plus `git status --porcelain` per worktree. · **Screenshot** not applicable.
**Copy** Path, branch, tip, dirty count, `rev-list --count 4b69d0f..HEAD`. **Never copy** nothing sensitive. **Redact** nothing.
**Expected** Retirement candidates have **both** zero unique commits and zero dirty files. **Dangerous** Any dirty file — that is another agent's in-progress work. **Next** Retire with `git worktree remove`, never by deleting the directory; **never delete the branch**, which is the cheap part.
