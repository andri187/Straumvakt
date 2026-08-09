# Appendix H — Approval decision records (16)
> **Superseded in part by [the overnight verification-prep packet](2026-08-09-overnight-verification-prep-packet.md).** That run corrected several findings recorded here: the estate is **29 registered worktrees, not 6**; three worktrees are checked out **at** forbidden commits; the wrangler linter emits **5 L2 / 6 L3**, not 4 / 3; the linter's inheritance model was wrong and is fixed; and the money-unit finding's **mechanism** was wrong — there is no cancelling pair inside the API. See "Corrections" there.


Written to be answerable in one sitting, without reconstructing context. Every
record recommends — a list of options with no recommendation transfers the whole
analytical burden back, which is how decisions stop being made.

**Legend.** **Blocks** = beta or production. **Reversible** = whether a wrong
answer can be undone, and at what cost. **Evidence age** = when the facts behind
the recommendation were captured; several rest on evidence that has not been
re-verified since.

---

### AD-01 — Create a scoped read-only Cloudflare token
**Blocks** beta and production · **Reversible** yes, instantly (revoke) · **Evidence age** current

**Decision.** Create one custom Cloudflare API token with Read-only permissions, scoped to the Straumvakt account, TTL 7 days.

**Options.** (a) Read-only scoped token. (b) Interactive browser login only. (c) Full-access token. (d) Do nothing.

**Recommendation: (a), with (b) for the one fact that needs it.** A read-only credential makes safety a property of the token rather than of the operator's care. Seven facts are blocked; the Git-integration owner has no CLI equivalent, so one browser visit is unavoidable regardless.

**Consequence of yes.** Seven blocked facts close in roughly thirty minutes. A rollback target becomes recordable for the first time.
**Consequence of no.** No production release can be validated. Rule R1 correctly rejects every manifest, and it is right to.

**Prerequisites.** None. **Evidence required.** None to decide; the token itself produces the rest.

---

### AD-02 — Browser session versus API for evidence capture
**Blocks** beta · **Reversible** yes · **Evidence age** current

**Decision.** Which facts are captured by token and which require a logged-in dashboard.

**Options.** (a) Split: token for everything scriptable, browser for the rest. (b) Browser for everything. (c) Token only.

**Recommendation: (a).** JSON diffs; screenshots do not. But three facts are only observable in the interface — the Git integration owner, the workers.dev toggle state for the two Workers that do not declare it, and queue depths.

**Consequence of yes.** Evidence is mostly reproducible and hashable, with a short, planned interface session.
**Consequence of no.** Either a long interface session with an unplanned agenda — which is where accidental clicks happen — or three facts left blocked.

**Prerequisites.** AD-01. **Evidence required.** None.

---

### AD-03 — Which project keeps the `hlada` Worker names
**Blocks** production · **Reversible** technically, but each rename costs a mobile release · **Evidence age** stale — the collision was established from configuration files, not from the platform

**Decision.** CPMS and Straumvakt both declare `hlada-staging` and `hlada-api-staging`. One must give them up.

**Options.** (a) Straumvakt renames to `straumvakt-*`. (b) CPMS renames. (c) Separate Cloudflare accounts. (d) Leave it.

**Recommendation: (a), sequenced behind a mobile release.** Straumvakt is the project actively heading for production, so it should own the change rather than depend on another party's schedule. But the workers.dev hostname is **derived from the Worker name** — renaming breaks the shipped app exactly as disabling workers.dev would. The rename must follow an app version that no longer pins the old host, with an overlap measured in app versions, not days.

**Consequence of yes.** The collision ends. Cost: one coordinated change touching the config, the gateway's `MAIN_APP` binding, and the mobile client, plus a release cycle of waiting.
**Consequence of no.** A CPMS merge can redeploy Straumvakt's estate. This is production no-go NG-04 and it does not expire.

**Prerequisites.** ISS-07 (Git integration owner). **Evidence required.** D-09 per Worker.

---

### AD-04 — Trunk, branch protection, and default branch
**Blocks** beta · **Reversible** yes · **Evidence age** current

**Decision.** Name one trunk; protect it and the deploy pointer; repoint the repository default.

**Options.** (a) All three together. (b) Protection only. (c) Default repoint only. (d) Nothing.

**Recommendation: (a).** They are one decision wearing three hats. A protected branch nobody branches from protects nothing, and a stale default sends every new clone and every pull request base to the wrong place.

**Consequence of yes.** Force pushes and deletions are refused **server-side**. Claude A and Codex must open pull requests, which is a real change to how they work and should be told to them, not discovered.
**Consequence of no.** Zero of sixteen branches protected, rulesets empty, and two local branches tracking the deploy pointer — one carrying the forbidden commit `4fe0a95`.

**Prerequisites.** ISS-12 (capture current state first — after protection is on, nobody can show what it was before). **Evidence required.** D-35.

---

### AD-05 — Production Neon: separate project or branch, and what it starts with
**Blocks** production · **Reversible** while empty; not once it holds customer data · **Evidence age** current

**Decision.** Where production data lives, and whether it starts empty or seeded.

**Options.** (a) Separate project, empty, seeded with reference data only. (b) Branch in the existing project. (c) Reuse a beta branch.

**Recommendation: (a).** A branch inside the beta project shares its compute, its limits, and its blast radius. Production data should not be one console mis-click from a beta operation. **Beta rows do not move** — beta holds real users' personal data gathered in a testing context.

**Consequence of yes.** Real isolation, plus a second project's cost and a second set of secrets to manage.
**Consequence of no.** (c) is rejected outright by validator rule R6. (b) leaves production sharing a compute with beta, discovered under load.

**Prerequisites.** ISS-18 (which branch each environment actually uses). **Evidence required.** D-37, D-38.

Also settle here: **retention**. PITR is capped at seven days, which is shorter than the interval at which some corruption is noticed. Extend it, or accept that deliberate backup branches are the only long-horizon recovery — and then actually create them.

---

### AD-06 — Repoint the Neon project default branch
**Blocks** beta · **Reversible** yes · **Evidence age** current

**Decision.** The project default is an abandoned branch. Repoint it.

**Options.** (a) Repoint to the branch beta actually uses. (b) Leave it and rely on always passing an explicit id. (c) Delete the abandoned branch.

**Recommendation: (a), and do not delete anything.** Relying on discipline has already failed here: the default-branch trap has produced wrong-branch reads in this project. Repointing costs one setting; (c) adds risk for no benefit.

**Consequence of yes.** A tool that omits a branch id reaches the right data instead of the wrong data.
**Consequence of no.** Every script, agent, and console session that forgets the id silently reads an abandoned branch, and the failure looks like stale data rather than a wrong target.

**Prerequisites.** ISS-18. **Evidence required.** D-38.

---

### AD-07 — Production secrets: new values or copies
**Blocks** production · **Reversible** yes, by rotation · **Evidence age** blocked (secret names not yet captured)

**Decision.** Per secret: a fresh value for production, or the beta value reused.

**Options.** (a) New values for everything that grants access. (b) Copy beta values. (c) Mixed, decided per secret with a recorded reason.

**Recommendation: (c) with (a) as the default.** Copying makes one compromise affect both environments, and beta is by nature the less-guarded one. Some provider credentials are genuinely fixed and cannot be duplicated; those get recorded as accepted risk rather than pretended away.

**Consequence of yes.** Beta stops being an attack path into production. Cost: a per-secret decision and a rotation procedure.
**Consequence of no.** A leaked beta value is a production value. This project has already committed a real `AUTH_SECRET` to a public repository.

**Prerequisites.** ISS-44 (capture beta secret **names**). **Evidence required.** D-10.

Settle here too: **the production database connection string is a secret binding, never a plaintext variable.** A DSN contains a credential and several places in this project treat it as configuration.

---

### AD-08 — Long-term addressing: keep workers.dev, or move to custom domains
**Blocks** production · **Reversible** only at the cost of a client release · **Evidence age** current

**Decision.** The shipped mobile app pins `hlada-api-staging.straumvakt.workers.dev`. Keep that permanently, or move the client to a custom domain.

**Options.** (a) Declare `workers_dev: true` everywhere and keep the pinned host indefinitely. (b) Ship a client on a custom domain, keep both live during a long overlap, then drop the pinned host. (c) Move now.

**Recommendation: (b), with (a) done immediately regardless.** (a) is not really an option — it is the *prerequisite*. Declaring `workers_dev` costs nothing and removes the foot-gun today; the addressing decision can then be taken calmly. (c) breaks every installed app.

**Consequence of yes.** A pinned hostname stops being a hidden dependency on a Cloudflare convenience feature. Cost: an overlap window measured in **app versions**, not days — and nobody currently knows how long an old version stays in the field, which is itself a gap.
**Consequence of no.** The product's availability depends on a toggle that two of three configs do not declare, and whose state is only observable in a dashboard.

**Prerequisites.** ISS-01, ISS-02. **Evidence required.** D-08, D-18, D-28.

Note also: the web Worker sets `workers_dev: true` at `wrangler.jsonc:67`. Whether that is intent or accident has never been recorded — record it as a comment either way.

---

### AD-09 — Adopt a service binding for web → API
**Blocks** neither, but removes a live risk · **Reversible** yes, by a flag flip with no deploy · **Evidence age** current

**Decision.** Replace the plain-HTTPS call from the web Worker to the API Worker with a service binding.

**Options.** (a) Service binding behind a configuration switch, beta first, soak, then production. (b) Keep HTTPS and rely on `api.straumvakt.org` remaining a Custom Domain. (c) Binding with no fallback.

**Recommendation: (a).** Three of four Worker-to-Worker paths already use bindings; this is the one that does not, and its correctness depends on a routing detail nobody controls day to day. A binding does not traverse the edge, so it is immune to route-versus-domain semantics.

**Consequence of yes.** One class of total-outage failure disappears. Cost: an audit of every Host, Origin, and cookie dependency, because a binding call is not a browser request.
**Consequence of no.** If `api.straumvakt.org` ever becomes a route on the same zone, the request loops back to the calling Worker and the product goes blank — with a cause that looks nothing like the change that produced it.

**Prerequisites.** ISS-24 (header audit). **Evidence required.** D-23, D-25.

**What this does not solve, stated so it is not oversold:** external clients — browsers and the mobile app — still reach the API over its public hostname. A binding removes an internal dependency, not the need for a hostname.

---

### AD-10 — Promote OCPP continuity to a hard gate
**Blocks** production · **Reversible** yes · **Evidence age** current

**Decision.** Whether a gateway release may proceed without an explicit statement that the OCPP endpoint is unchanged.

**Options.** (a) Hard error for any release containing a gateway Worker. (b) Warning. (c) Nothing.

**Recommendation: (a) — already implemented.** Rule R3 now errors rather than warns. The clients are physical equipment that does not reconnect to a hostname that stops resolving, and reconfiguring them is a field or vendor-portal operation.

**Consequence of yes.** Someone must state, in the manifest, that no field device is affected. That is the entire point.
**Consequence of no.** The highest-consequence omission in the release process was the one that merely printed a line.

**Prerequisites.** None. **Evidence required.** D-31 (the endpoint chargers are actually configured with).

---

### AD-11 — Where the cleanup archive lives
**Blocks** cleanup · **Reversible** yes (move it) · **Evidence age** current

**Decision.** The archive location, and explicitly which failure it protects against.

**Options.** (a) Same machine, different disk. (b) Off-machine or cloud. (c) Both.

**Recommendation: (c), and say which is which.** An archive on the same disk protects against `git clean` and against a wrong `Remove-Item`. It does not protect against disk loss. Both risks are real here; only one is currently mitigated at all.

**Consequence of yes.** 2.25 GB of irreplaceable content has a recovery path that survives the failure it is meant to survive.
**Consequence of no.** The backup fails in the same event as the original, which is the classic way backups fail.

**Prerequisites.** ISS-38 (archive verified by extraction, not by listing). **Evidence required.** D-43.

---

### AD-12 — Retiring worktrees
**Blocks** cleanup · **Reversible** yes — the branch survives · **Evidence age** current

**Decision.** Whether zero-unique-commit worktrees may be retired, and how.

**Options.** (a) `git worktree remove`, only when zero unique commits **and** zero dirty files. (b) Delete the directories. (c) Keep all six.

**Recommendation: (a).** Deleting the directory leaves the worktree registered and the repository confused. The branch is never deleted — it is the cheap part, and keeping it makes the retirement fully reversible.

**Consequence of yes.** Disk reclaimed with an exact undo: `git worktree add` from the surviving branch.
**Consequence of no.** Twenty-eight working copies of a repository whose build output is 95% of a 43.76 GB tree.

**Prerequisites.** ISS-38. **Evidence required.** D-47 — and note a zero-unique worktree with **dirty files** is not a candidate; that is another agent's work.

---

### AD-13 — Repository visibility and the committed secret
**Blocks** production · **Reversible** visibility yes; the leak, no · **Evidence age** stale — the "not live" check was a point-in-time reading

**Decision.** The repository is public and a real `AUTH_SECRET` is in its history.

**Options.** (a) Scrub the working tree, rotate the secret, leave history and visibility alone. (b) Also make the repository private. (c) Rewrite history. (d) Nothing.

**Recommendation: (a), and treat (b) as separate.** **Rotation is the only real remedy** — the value has been publicly readable and must be assumed compromised regardless of what happens to the repository afterwards. Making the repository private does not un-leak it, and history rewriting breaks every clone and every open pull request for a value that should be rotated anyway.

**Consequence of yes.** The exposure ends at the rotation, not at the scrub.
**Consequence of no.** A publicly readable secret whose non-liveness is an assumption that ages every day.

**Prerequisites.** None for rotation. **Evidence required.** D-36, and re-verification of the "not live on the API Worker" finding with a fresh timestamp.

---

### AD-14 — OCPP specifications: committed or archived
**Blocks** cleanup · **Reversible** yes · **Evidence age** current

**Decision.** 128 untracked files of official OCPP specifications.

**Options.** (a) Commit them. (b) Archive externally and keep them untracked. (c) Both. (d) Leave as-is.

**Recommendation: (b), plus a tracked index recording exactly which versions were obtained and from where.** They are third-party documents, so committing them has licensing implications this project should not take on casually. But (d) is not an option — untracked and unbacked means one `git clean -fdx` from gone, and re-acquisition depends on the standards body.

**Consequence of yes.** The protocol reference survives, and the repository does not redistribute third-party material.
**Consequence of no.** The reference for every protocol decision is one careless command from disappearing.

**Prerequisites.** ISS-32 (copy and hash first). **Evidence required.** D-43.

---

### AD-15 — First real charge, and the money-unit contract
**Blocks** beta and production · **Reversible** no — a wrong bill reaches a customer · **Evidence age** current

**Decision.** Whether a real charging session may be billed before the monetary-unit contradiction is resolved.

**Options.** (a) Resolve the unit contract first, then one charge with an independent hand calculation. (b) Charge now, verify later. (c) Charge with billing disabled.

**Recommendation: (a); (c) is acceptable in the interim.** The costing engine documents **aurar**, one hundredth of a króna. A session-repository comment claims ISK has no minor unit and conversion is the identity. **Two mismatches currently cancel, so fixing either alone breaks everything by a factor of one hundred.** I previously repeated the repository comment's claim in an audit; the costing engine is authoritative and that correction stands.

Only an independent calculation catches this — no test that uses the same conversion the code uses can, because the bug is in the conversion.

**Consequence of yes.** The first bill is verified to the aurar before anyone is charged.
**Consequence of no.** A customer is billed one hundred times too much or too little, and the error is invisible in code review because the two bugs cancel.

**Prerequisites.** ISS-29. **Evidence required.** A hand calculation alongside the system's figure, agreeing exactly. Any hundredfold discrepancy stops the beta programme.

Related and separate: `powerKw: 0` is hardcoded at `apps/api/src/repositories/driver-sessions.ts:135`. A user reading zero kilowatts believes the charger is delivering nothing. Either populate it or remove it from the contract — never ship a plausible-looking zero.

---

### AD-16 — Ownership: who clears a no-go, who approves a rollback, who calls a freeze
**Blocks** production · **Reversible** yes · **Evidence age** current

**Decision.** Names against the operational roles this programme assumes exist.

**Options.** (a) Andri named for all, with a written fallback for unreachability. (b) A rotation. (c) Leave implicit.

**Recommendation: (a).** (b) describes a team that does not exist. (c) is the current state, and its failure mode is specific: **a no-go with no owner is cleared by whoever is most impatient.**

Settle in one place: who clears each of the six production no-gos; who authorises a production database restore, which is irreversible in the sense that discarded writes do not come back; who declares and lifts a release freeze, and how Claude A and Codex learn of it without asking; who receives alerts, and through a channel that works when the product does not; and what happens to beta once production exists.

**Consequence of yes.** Decisions get made during incidents instead of being discovered afterwards.
**Consequence of no.** Three agents commit continuously into a release process with no named decision-maker, and a review written a week earlier describes a system that no longer exists.

**Prerequisites.** None. **Evidence required.** None — this is a decision, not a finding.

---

## Answer order

**Beta-blocking, answerable now, no evidence needed:** AD-01, AD-02, AD-04, AD-16.
**Beta-blocking, small evidence dependency:** AD-06, AD-08, AD-14, AD-15.
**Production-blocking:** AD-03, AD-05, AD-07, AD-10, AD-13.
**Cleanup:** AD-11, AD-12.
**Risk reduction, not blocking:** AD-09.

Four of these — AD-01, AD-02, AD-04, AD-16 — need nothing but a decision, and
three of the four unblock most of the rest.
