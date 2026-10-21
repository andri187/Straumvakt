# Market cloud tool decision register

Eleven decisions. Each carries a **shadow side** — the thing the choice makes
worse — because a register that only lists benefits is a sales document.

Pricing frame throughout: **200 kr/connector + 50 kr/active driver, capped at
450 kr/connector/month.** That cap is the constraint every cost line answers to.

---

### D-01 · Cloudflare Workers — web, API, OCPP as three separate Workers

**Solves.** Isolation of blast radius. A web deploy cannot drop charger sockets.
**Shadow side.** Three deploys, three configs, three sets of bindings to keep in
step — and the estate has already shown that config and deployment can disagree.
**Cost risk.** Low; request-priced.
**Monitor.** Per-Worker version id recorded before every release.
**Launch readiness.** ✅ deployed as three Workers today.

### D-02 · One Durable Object per charger / OCPP identity

**Solves.** Serialised per-charger state without a lock. Identity survives
reconnect. **Uses the WebSocket Hibernation API**, verified in code.
**Shadow side.** A wake-up is a *fresh instance over the same storage*. Anything
cached in memory is gone, and code that forgets this fails only under load.
**Cost risk.** Duration billing if hibernation regresses — invisible until the bill.
**Monitor.** `DO_invocations_estimate`; gate OC12.
**Launch readiness.** ✅ hibernation confirmed at `identity-do.ts:404`.

### D-03 · Cloudflare Queues — meaningful events only

**Solves.** Sub-millisecond accept, retry, DLQ. Decouples the socket from Neon.
**Shadow side.** Silent over-use. Until this week **every** frame including
Heartbeat was enqueued: ~720 ops/connector/month buying nothing.
**Cost risk.** Scales with *frames*, and frames are the one thing a 450 kr cap
cannot absorb.
**Monitor.** `queue_messages_by_type`, `queue_backlog_age`; gates OC1, OC16–OC19.
**Launch readiness.** ⚠️ fix landed on `relops-b`, **not yet merged**.

### D-04 · Neon Postgres — business truth

**Solves.** Relational integrity for billing, which is the part that must be
arguable in front of a customer.
**Shadow side.** Seven-day PITR ceiling. A problem noticed on day eight is
unrecoverable without a deliberate backup branch, and **none exist**.
**Cost risk.** Storage growth from raw frames; connection ceiling under a
reconnect storm.
**Monitor.** `Neon_write_estimate`, connection count vs ceiling.
**Launch readiness.** ⚠️ no production project; no branch protected; `require_mfa` false.

### D-05 · Workers Analytics Engine — connector economics

**Solves.** Per-connector cost attribution without putting telemetry in Postgres.
Cheap, high-cardinality, and it does not compete with business truth for storage.
**Shadow side.** Sampled and time-bounded. It answers "what is this costing", not
"what did this customer owe" — using it for billing would be a category error.
**Cost risk.** Low.
**Monitor.** Itself. Absence of the binding is the failure mode.
**Launch readiness.** ❌ **not present.** Nothing writes metrics today.

### D-06 · Sentry — errors and traces

**Solves.** The failures that never reach a metric: parse errors, invariant
breaches, exceptions inside a DO nobody is watching.
**Shadow side.** A DSN is a credential and an egress path. Payloads can carry
customer data if events are not scrubbed.
**Cost risk.** Event volume during an incident, exactly when you least want a cap.
**Monitor.** Release-regression alerts keyed to Worker version id.
**Launch readiness.** ❌ **not configured.**

### D-07 · R2 — statements, exports, bounded debug bundles

**Solves.** Cheap egress-free object storage for artefacts a customer may ask for
months later.
**Shadow side.** The one place a cutover can silently orphan customer data. A
public bucket is a data incident, not a misconfiguration.
**Cost risk.** Unbounded debug bundles.
**Monitor.** Bucket list + public-access flag at every release.
**Launch readiness.** ⚠️ buckets unverified in the deployed account.

### D-08 · Cloudflare Access — internal and ops tools

**Solves.** Staff tooling protected without building auth for it.
**Shadow side.** Two identity systems. An ops tool behind Access still needs a
tenant-scope check inside the app — Access says *who*, never *which org*.
**Cost risk.** Per-seat.
**Launch readiness.** ❌ not applied to any ops surface.

### D-09 · Cloudflare Workflows — billing/report jobs, only if cost-visible

**Solves.** Durable multi-step execution for monthly close.
**Shadow side.** A second execution model to reason about. Monthly close is a
*burst*, and a burst that retries is a burst that bills twice.
**Cost risk.** Must be measured before adoption, not after.
**Launch readiness.** ⏸ deferred. Not a launch dependency.

### D-10 · D1 rejected for Core business truth

**Why.** Billing needs transactional integrity, real joins, and a restore story.
**Shadow side of the rejection.** Neon adds a network hop Workers-native D1 would
not have, and Hyperdrive to mitigate it — one more thing that can point at the
wrong branch.
**Launch readiness.** ✅ decided; nothing to build.

### D-11 · SiteDO deferred — model `site_id` now

**Why.** Site-level coordination (load balancing across a building) is real but
not a launch requirement. Modelling `site_id` now costs a column; retrofitting it
later costs a migration across billing history.
**Shadow side.** A column nothing enforces drifts.
**Launch readiness.** ✅ as long as `site_id` exists in the schema.

---

## Readiness summary

| Ready | Conditional | **Blocking** |
|---|---|---|
| D-01, D-02, D-10, D-11 | D-03, D-04, D-07 | **D-05 Analytics Engine · D-06 Sentry · D-08 Access** |

The three blockers share a shape: **they are all absent rather than wrong.**
Nothing needs redesigning — they need creating, and none of it can happen without
a Cloudflare session.
