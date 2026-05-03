# Review - OCPP Ingest Current State And Gap Note

**Reviewer date:** 2026-05-01
**Subject:** `2026-05-01-ocpp-ingest-current-state-and-gaps.md`
**Verdict:** Strong. Wire-level, file:line-cited, environment-aware, and traceable to S1. The points below are sharpening, not corrections.

---

## What This Note Does Well

- The TL;DR table sets prod-vs-staging immediately and the "404 on `hlada-api-staging`" sentence is the right one-line summary.
- File:line citations through §2-§5 make the claim auditable. A second engineer can verify each line in minutes.
- The split between "confirmed gaps", "implied gaps (downstream)", and "non-gaps" is the right structure - it stops the reader from thinking the auth path or outbound dispatch is also broken.
- The "quick-fix temptation" section preempts the obvious wrong move (`hlada-api-staging` -> `hlada-staging` binding flip) and explains why it is wrong. That alone is worth keeping.
- Recommendation §1-§8 is concrete enough to start the work without further design.

The note is structurally fine. Everything below is small.

---

## Sharpenings

### 1. Production is not safe forever; say so

The note correctly says production projections fire today because production gateway binds to `hlada` (UI Worker). True today, but the migration direction is for both environments to bind to the API Worker. When production eventually flips, the same gap recurs in production unless S1 has already landed. Add one sentence:

> Production is fine *today* only because the gateway still binds to the UI Worker. When production gateway is migrated to the API Worker (post-S1), this same gap reappears in production if S1 has not yet shipped. S1 must land before that flip, not after.

### 2. The "stays pending" symptom analysis is slightly fuzzy

§5 lists two related causes for the operator complaint. Cause #1 says "we set `status='acked'` ... but the operator-visible UI may still read `pending` if it's looking at stale data." That is a hedge and it makes the diagnosis weaker than the rest of the note.

Either:

- Confirm the actual UI query and show that it reads from a row that *would* be `acked`, in which case cause #1 alone does not produce the "pending" symptom and cause #2 is the dominant explanation. Then say "the symptom maps cleanly to cause #2; cause #1 is a side-effect that hides downstream evidence."
- Or leave it but cite the file:line of the UI read so the reader can verify.

Currently the note is stronger than its weakest paragraph; tightening this paragraph removes the only soft spot.

### 3. Idempotency parity during the port

Recommendation §1 ports `ingestEvent` and §4 adds tests. Worth one explicit line: the API-side port must preserve the exact same idempotency key derivation, transaction boundary, and dedupe TTL as the current UI-Worker `ingestEvent`. Otherwise during a brief overlap window (or after rollback), replays can double-write. Add a test specifically for "same `eventId`, second submission, no double row."

### 4. `ocpp-internal-auth.ts` parity check

§3 of "Confirmed gaps" mentions that the API side already has its own `ocpp-internal-auth.ts` separate from the UI's `ingest-auth.ts`. Recommend an explicit step in the recommendation list:

> Diff `apps/api/src/lib/ocpp/internal-auth.ts` against `src/lib/ocpp/ingest-auth.ts` before porting events; if header verification differs (constant-time vs not, header name casing, secret read source), unify before mounting events.

A subtle mismatch here would silently 401 valid traffic after cutover.

### 5. URL choice in §3 of recommendation

Good recommendation to rename `/api/ocpp/events` -> `/api/internal/ocpp-events` for prefix consistency. Two adds:

- Note that the gateway change is a single line in `gateway/src/ingest-client.ts:43`, so atomicity matters: gateway and API must deploy together. Cite the same atomic-deploy concern referenced at §6.
- Decide whether the old URL on the API Worker should respond at all during/after cutover. Recommend: do **not** mount the old URL on the API Worker. If the gateway is on an old binary still posting to `/api/ocpp/events`, you want a clean 404 (loud failure) rather than a silent acceptance.

### 6. Recommendation §8 - pick one, do not leave both

§8 says "remove the UI-Worker-side route ... or leave them in place as a fallback for one sprint, marked deprecated." Pick one in the doc. Both routes accepting traffic is a foot-gun (a misconfigured forwarder, a stale env, or a manual cURL test against the wrong host can produce double ingest). Recommend: delete the UI-Worker route in the same change set. Idempotency on `eventId` would protect against double-writes in theory, but you would rather not rely on it during a cutover.

### 7. Smoke list in this note is better than S1's smoke list

Sprint S1's exit smoke is "BootNotification / Heartbeat / MeterValues persist." This note's smoke (§7 of recommendation) adds `OcppIdentity.lastSeenAt` ticking and `Connector.status` flipping on StatusNotification and `ChargeSession` appearing on StartTransaction. The note's smoke is stronger - it covers the projection chain end-to-end, not just row inserts. Suggestion: copy the note's smoke list into S1 of the sprint plan (one-line PR to `scale-to-4000-chargers-sprint-plan.md`).

### 8. The atomic-deploy reference needs a one-line gloss

§6 of recommendation says "atomic per Cloudflare auto-deploy ordering caveats - see `cf_autodeploy_clobbers` memory." A reader without access to that memory has no idea what to do. Inline the critical claim, e.g.:

> Deploy gateway and API together. If gateway deploys first while API still lacks the new route, the staging fleet 404s for the deploy window; if API deploys first while gateway still posts to the old URL, no harm but also no progress. Coordinate so the gateway flips after the API mount is verified.

### 9. Auth secret on `https://main.internal/...`

Not a current gap, but worth a one-line forward note: the gateway calls `https://main.internal<path>` via the service binding, which never leaves Cloudflare's internal mesh, so `x-straumvakt-ingest` is defense-in-depth rather than the primary boundary. If a future refactor exposes any of these URLs publicly, the shared-secret model becomes the only line and should be revisited (mTLS or per-charger session token). Noted in S9, not in S1, but a one-line breadcrumb here keeps the threat model visible.

### 10. Production cutover sequence is implicit

The recommendation describes the staging cutover (gateway + API together). It does not say when production gateway flips from `hlada` to `hlada-api`. Suggest adding a §9:

> Production cutover (separate change after staging is verified): bind `gateway` root `services[0].service` to `hlada-api` (currently `hlada`). Verify the API Worker has the events route mounted in production. Run the same smoke list against a known production charger. Plan a rollback by reverting the binding only - no schema or code roll-back needed.

---

## Internal Consistency

- §"Confirmed gaps" #3 says "ocpp-internal-auth.ts was already mirrored into apps/api". Good. §"Recommended next step" #1 lists files to port but does not list the auth file (correct, because it is already there). The two are consistent. Just make sure the parity check in §4 above is still done.
- §"Implied gaps" correctly limits each consequence to staging. The wording "this is a staging problem today" is the right framing.
- §"Cross-reference to the scale plan" cites lines 198-227 of `scale-to-4000-chargers-sprint-plan.md`. Verified - those are S1's task list. Good.

---

## Recommended Edits To The Note (Minimal Set)

If you want a low-effort first pass:

1. Add the one-line forward warning about production (§1 above).
2. Tighten the "stays pending" diagnosis or cite the UI read site (§2).
3. Add explicit idempotency-parity and auth-parity steps in the recommendation list (§3-§4).
4. Pick "delete the UI-side route in the same change set" and remove the "or leave it" alternative (§6).
5. Inline the atomic-deploy gloss instead of citing a memory (§8).
6. Add a §9 for the production binding flip (§10).
7. Promote this note's smoke list into the sprint plan's S1 exit criteria.

Everything else is keep-as-is.

---

## Net Recommendation

Ship the note as the canonical baseline for S1. With the seven small edits above it becomes the document the next engineer should read before touching either Worker. Pair it with `sprint-plan-review.md` §S1 notes.
