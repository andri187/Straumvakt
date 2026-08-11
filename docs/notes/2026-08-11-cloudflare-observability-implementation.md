# Cloudflare observability — implementation

What this lane built, what it deliberately did not, and what is left that
only a Cloudflare session can do.

The previous run's finding was that Sentry and Analytics Engine were
**absent rather than broken**, and that each became "a one-line static
check the moment the thing exists". This lane made them exist in source,
so those checks now exist too.

---

## What is implemented

| Piece | File | Status |
|---|---|---|
| BootNotification interval, derived not literal | `gateway/src/heartbeat-fastpath.ts` | done |
| Interval wired into the reply | `gateway/src/identity-do.ts` | done |
| Analytics Engine metrics writer | `gateway/src/metrics.ts` | done, binding pending |
| Sentry scrubbing (`beforeSend`) | `gateway/src/sentry-scrub.ts` | done, SDK+DSN pending |
| Env surface for all three | `gateway/src/auth.ts` | done |
| Offline tests, dependency-free | `gateway/src/observability.selftest.mjs` | 32/32 |
| Release gate OB1–OB15 | `scripts/analysis/observability/check-observability.mjs` | 20/20 fixtures |
| Binding placeholders + failing gate | `gateway/wrangler.jsonc` | intentional |

## The interval, and why it is derived

`stubResponseFor` answered BootNotification with the literal `interval:
60` while the cost model, the liveness window and the product frame all
assumed 3600. A charger that honours the reply heartbeats sixty times
more often than every cost figure this project has produced.

The fix is not "change 60 to 3600" — that leaves two independent numbers
free to drift apart again. The advertised interval is now **derived from
`idleHeartbeatIntervalMs`**, the same value the liveness window uses to
decide a charger is offline. They cannot disagree, because there is only
one of them.

An env override, `OCPP_HEARTBEAT_INTERVAL_SECONDS`, exists for the case
the measurement plan anticipates: hardware that proves a different safe
value. It is range-guarded to 60–86400, and anything unparseable or out
of range falls back to 3600 **and logs the rejection** rather than being
clamped silently. `60` remains reachable, but only as a deliberate,
recorded operator decision — never as a default.

> This is still unverified against hardware. Whether Zaptec honours the
> BootNotification interval or uses its own configured value is
> measurement **M-2**, and it remains the highest-value measurement in
> the plan. What changed is that the gateway now asks for the right
> thing.

## Metrics

Nine counters, closed vocabulary, positional blobs. Three properties are
enforced by test rather than convention:

- **No-op safe.** No binding, or a binding that throws, changes nothing.
  A charger does not stop charging because a counter failed.
- **No personal data, structurally.** The write surface has no free-form
  payload field, so an OCPP frame cannot be passed through by accident.
  A runtime guard rejects `idTag`-shaped dimension keys behind that.
- **Pseudonymised identity.** Charger ids are hashed before write.

On the hash: it is FNV-1a with a salt, chosen because the hot path
cannot await `crypto.subtle`. It is **pseudonymisation, not
anonymisation** — with a known salt and a known charger list it is
reversible by brute force in milliseconds. It exists so a leaked
analytics export does not hand over a customer's site inventory in
plaintext. It is not a security control and is not documented as one.

The pair that matters is `heartbeats_received` against
`heartbeats_suppressed`. Their ratio *is* the fast path's health. If
suppression collapses, cost returns to the pre-fix baseline and nothing
else in the system notices.

## Sentry

No SDK is imported. The dependency is not in this worktree and
installing one was out of scope, so what ships is the part that must be
right regardless of SDK version: the `beforeSend` transform.

Scrubbing is **denylist-of-keys plus allowlist-of-payload-fields**, not
one or the other. A denylist alone fails on the next field OCPP adds; an
allowlist alone fails on nested transport metadata. Concretely, an
unknown future field like `driverPhoneNumber` is dropped by default —
there is a test for exactly that.

Also scrubbed: Basic-Auth userinfo in the socket URL (chargers
authenticate that way, so `wss://user:pass@host/...` is a realistic
value), query strings, `user` entirely, and breadcrumbs, bounded to the
last 30. Recursion is depth- and breadth-bounded so a cyclic or hostile
structure cannot turn scrubbing into a hang on the error path — which is
when the system is least able to absorb one.

`kennitala` is in the denylist. This is a domestic Icelandic product and
a national id is personal data.

**No DSN literal is committed**, and gate OB12 fails the build if one
ever is.

## What remains Cloudflare setup

Two bindings are present in `gateway/wrangler.jsonc` as **comments**, not
config, because enabling them changes what a deploy produces and that
needs approval:

- `analytics_engine_datasets` → `OCPP_METRICS`
- `version_metadata` → `CF_VERSION_METADATA`

Gates **OB14** and **OB15** fail while they remain commented, so this
cannot be quietly forgotten. Uncommenting them is the entire change; the
Analytics Engine dataset is created on first write, so no account-side
provisioning is needed. The Sentry DSN is a secret and never enters the
file.

Full procedure: `2026-08-11-sentry-analytics-engine-setup-runbook.md`.

## Gate results

```
observability self-test          20/20 fixtures
observability gate  relops-b     2 errors   (OB14, OB15 — bindings, by design)
observability gate  beta-prod    8 errors   (also OB1,2,5,6,8,11)
gateway observability selftest   32/32
gateway heartbeat selftest       35/35
existing checker suite           168/168 across 7 checkers
OCPP cost  relops-b              3 errors, all OC20 — unchanged baseline
```

The relops-b/beta-production spread is the same story as before: the
cost fix and now the observability slice both live on an unmerged
branch. Until it merges, production is the 8-error profile.

## Rollout order

1. Merge `relops-b`. Nothing below matters until the code is in the tree.
2. Uncomment `version_metadata`, deploy, **record the version id** — this
   is the project's single blocking release gap (C1).
3. Uncomment `analytics_engine_datasets`, deploy, confirm points arrive.
4. Call the metrics writer from the heartbeat fast path (see limitations).
5. Install the Sentry SDK, wire `beforeSend`, set the DSN secret on
   staging only, verify a real payload scrubs, then production.

## Rollback

Steps 2–3 are config; reverting is a redeploy of the previous config.
Step 5 is reverted by deleting the secret — absent DSN disables reporting
by design, so removal is safe and instant. Step 1 is a git revert. None
of the source added here changes OCPP behaviour when the bindings are
absent, which is what makes the order safe to stop at any point.

## Limitations, stated plainly

- **The metrics writer is not yet called from the hot path.** It is
  built, tested and gated, but wiring the counters into `identity-do.ts`
  changes hot-path behaviour, and doing that blind — with no binding to
  observe and no hardware to verify against — is how a fast path
  regresses. It is step 4 above, after the binding exists.
- **Nothing here is verified against a real charger.** M-1 through M-9
  are unchanged.
- **The Sentry SDK is not installed**, so `beforeSend` is proven in
  isolation, not in situ.
- **No cloud state was inspected or changed.** The Cloudflare MCP
  servers in this session are unauthenticated, so even read-only
  verification was unavailable.
