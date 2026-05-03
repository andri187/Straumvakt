# Sprint 5 — Queue-Backed Inbound OCPP + Invite Flow MVP · Task List

**Status:** ACTIVE — entry condition: Sprint 4 closure list checked.
**Branch:** `dev/sprint-05-queue-and-invite` (cut from `staging`).

> Scope rescoped per [ADR 0017](../adr/0017-prepilot-rescope-for-4k-charger-target.md).
> Track A (queue-backed inbound OCPP) is the headline; absorbs gbtNotes
> Sprint S2. Track B (invite flow MVP) rides as a parallel track —
> mostly UI + one schema, low scale-path interaction. Driver
> self-registration + impersonation slip to Sprint 8 per ADR 0017.
> Sub-resource route `assertPermission` retrofits also slip to Sprint
> 8 (need invite-issued userIds in sessions before they're load-bearing).

---

## Track A — Queue-backed inbound OCPP events

> The 4k-charger target makes synchronous service-binding writes
> (gateway DO → Prisma → Postgres) untenable at 67–400 events/sec.
> Charger WebSocket replies must stay sub-second when the database is
> slow. Cloudflare Queues + DLQ in front; idempotent consumer keyed
> by `eventId` on the apps/api side.

### Milestone 5.1 — Queue + DLQ binding

> Provision the queue infrastructure, plumb bindings, deploy in a
> consumer-first order so messages produced before the consumer is
> live land in DLQ, not vapor.

- [ ] Cloudflare Queues provisioned: `straumvakt-ocpp-events` (main)
      + `straumvakt-ocpp-events-dlq` (DLQ, max-retries=3 then DLQ).
- [ ] `gateway/wrangler.jsonc` — producer binding `OCPP_EVENTS_QUEUE`
      added to staging + prod env blocks.
- [ ] `apps/api/wrangler.jsonc` — consumer binding pointing at the
      same queue, with `dead_letter_queue` config.
- [ ] Deploy order documented in commit message: **api Worker first
      (consumer live)**, then gateway (producer flips). DLQ replay
      script `apps/api/scripts/replay-dlq.ts` for the deploy-window
      lag bucket.
- [ ] Smoke against staging: drop a synthetic event onto the queue
      via `wrangler queues producer publish`; observe it land in the
      consumer log.

### Milestone 5.2 — Gateway DO enqueues + early reply

> Pull the synchronous `ingestEventInTx` call out of the gateway DO.
> DO writes the OCPP envelope to the queue, replies to the charger
> immediately, never blocks on Postgres.

- [ ] `gateway/src/identity-do.ts` — `ingestEvent()` rewritten:
      enqueue raw envelope to `OCPP_EVENTS_QUEUE`, reply to charger
      with the protocol-mandated CALLRESULT immediately. Don't wait
      on the consumer.
- [ ] `gateway/src/lib/event-envelope.ts` — envelope shape defined
      once, shared via `packages/shared` import. Includes `eventId`
      (deterministic from `chargerId + ocpp.uniqueId + receivedAt`),
      `chargerId`, `installationId`, `payload`, `receivedAt`.
- [ ] Local-dev fallback: `OCPP_EVENTS_QUEUE` may be undefined in
      `wrangler dev --local`; fall back to direct service-binding call
      so simulator dev stays unchanged. Document this in
      `docs/runbooks/queue-ingest-local-dev.md`.
- [ ] Test: gateway DO unit test asserts the producer is called with
      the right envelope shape; it does NOT assert that the consumer
      ran (that's the consumer's tests).

### Milestone 5.3 — Idempotent consumer

> Drain the queue from apps/api. One handler per OCPP event-type.
> Validation failures go straight to DLQ (poison message). DB or
> transient errors throw and let the queue retry policy do its work.
> Same `eventId` arriving twice is a no-op.

- [ ] `apps/api/src/queues/ocpp-events.ts` — Hono-style queue consumer
      `export default { queue(batch, env, ctx) }`. Routes by
      `payload.action` to per-action handlers.
- [ ] Per-action handlers (BootNotification, Heartbeat,
      StatusNotification, Authorize, StartTransaction, MeterValues,
      StopTransaction) call into existing repos under
      `apps/api/src/repositories/`; reuse milestone-3.7's
      `ingestEventInTx` once-per-event idempotency.
- [ ] `eventId` dedupe keyed by a unique index on
      `event_log_raw_protocol(event_id)` (additive migration —
      Rule 4 file, name it explicitly in the commit).
- [ ] Validation failures (invalid OCPP envelope shape, unknown
      action) → throw `ValidationError`; consumer catches → marks
      message for DLQ with `ackWith({error: 'invalid'})`. Schema
      validation runs against `packages/shared/ocpp/zod-schemas.ts`.
- [ ] Test: replay the same event 5 times → 1 row in
      `event_log_raw_protocol`. Test: malformed event → DLQ. Test:
      transient throw → retry once → succeeds → 1 row.

### Milestone 5.4 — Observability (read-only via wrangler tail)

> Full dashboards land Sprint 10. For Sprint 5 it's enough to see
> queue depth + DLQ counts + ingest lag from the CLI.

- [ ] `apps/api/src/queues/ocpp-events.ts` — log line per batch
      `[ocpp-q] consumed batch=<n> lag_ms=<receivedAt → consumedAt>
      dlq_after=<dlq_count_estimate>`.
- [ ] `docs/runbooks/queue-ingest-observability.md` — wrangler tail
      patterns, DLQ inspection commands, replay procedure.
- [ ] No dashboard work — that's Sprint 10.

---

## Track B — Invite flow MVP

> The Sprint 4 permissions infrastructure (Membership, PlatformGrant,
> requirePermission) needs real multi-user sessions to be load-bearing.
> Sprint 5 plants the flag with bootstrap-admin → real User row,
> SessionPayload.userId, and an agent invite endpoint that produces
> token-bearing acceptors.

### Milestone 5.5 — Bootstrap admin → real User row

> Closing the gap before any session-userId work lands. Today's
> bootstrap admin is env-var only; SessionPayload has no `userId`.
> Sprint 5 needs a real User row to anchor the session.

- [ ] Pick: **Option C (login-path upsert)** per ADR 0017's open-
      decision resolution. On bootstrap admin login, upsert User
      row by email; lazily mint PlatformGrant if not present.
- [ ] `apps/api/src/lib/auth/bootstrap-admin.ts` — new helper
      `upsertBootstrapAdminUser(db, email)` runs inside the login
      handler.
- [ ] `SessionPayload` extends with `userId: string` (required after
      this milestone — bootstrap path always produces it).
- [ ] `apps/api/src/lib/auth/require-permission.ts` updated:
      `isBootstrapSession` reframes — bootstrap = "platform-admin
      override via PlatformGrant" rather than "no userId attached".
- [ ] Test: bootstrap admin gets a `userId`; permission resolution
      goes through `effectivePermissions()` against the real
      PlatformGrant rather than the god-mode short-circuit.
- [ ] Test: concurrent logins to bootstrap admin race cleanly via
      `INSERT ... ON CONFLICT (email) DO UPDATE` (no double-row).

### Milestone 5.6 — `UserCredential` polymorphic schema (password + magic_link)

> Sprint 5 only needs `password` (continues working as today) and
> `magic_link` (the invite-token kind). `otp` slips to Sprint 8 with
> driver signup. Passkey + oauth_* slip to Sprint 10.

- [ ] `CredentialKind` enum (`password | magic_link | otp |
      passkey | oauth_google | oauth_microsoft | api_key`). All
      values defined; only `password` + `magic_link` consumed in
      Sprint 5.
- [ ] `UserCredential` extended fields: `kind`, `tokenHash?`
      (for magic_link), `status`, `lastUsedAt?`, `expiresAt?`.
      Existing `passwordHash` stays — migration backfills
      `kind='password'` on existing rows.
- [ ] Migration: backfill existing `UserCredential` rows with
      `kind='password'`. Operator-instructed Rule 4 edit.
- [ ] Repository: `apps/api/src/repositories/user-credentials.ts` —
      `createCredential`, `verifyCredential`, `revokeCredential`.

### Milestone 5.7 — Agent invite flow (admin side)

- [ ] Schema: `Invitation` model in `tenancy` schema —
      `id, orgId, email, role, invitedById, tokenHash, status,
      expiresAt, acceptedAt, createdAt`. Migration is operator-
      instructed Rule 4.
- [ ] Repository: `apps/api/src/repositories/invitations.ts` —
      `createInvitation`, `findByTokenHash`, `markAccepted`,
      `expire`. Constant-time hash compare.
- [ ] Route: `POST /api/admin/orgs/:orgId/invitations` —
      `requirePermission("member.invite", { orgIdParam: "orgId" })`.
      Body: `{ email, role }`. Returns the cleartext token (one-time
      display in the operator UI).
- [ ] UI: `/orgs/[id]/members/invite` form. Operator copies the
      shown URL + emails it manually for staging. Cloudflare Email
      Routing post-pilot.
- [ ] Token TTL: **7 days** per ADR 0016 + ADR 0017 confirmed default.

### Milestone 5.8 — Agent invite flow (recipient side)

- [ ] Public route: `GET /api/public/accept-invite/:token` —
      validates token, returns invitation summary (org name, role,
      inviter email). 404 for invalid/expired.
- [ ] Public page: `/accept-invite/[token]/page.tsx` — landing UI
      with "set password" form. (SSO post-pilot.)
- [ ] Public route: `POST /api/public/accept-invite/:token` — body
      `{ password }`. Creates User + Membership + UserCredential
      (`kind='password'`) in one transaction. Marks invitation
      accepted. Issues admin session cookie with new userId.
- [ ] Rate-limited: 5 attempts per IP per 5 minutes (Cloudflare
      Workers Rate Limiting binding).
- [ ] Tests: happy path, expired token, already-accepted token,
      password-too-short, race on simultaneous accept.

---

## Risks

- **5.1 + 5.2 deploy ordering.** Consumer must be live before
  producer flips. Documented in milestone 5.1's commit message.
  DLQ replay script exists for the deploy-window lag bucket.
- **5.3 idempotency parity** with the existing `ingestEventInTx`
  shape (Sprint 3.7 port). Same idempotency-key derivation + dedupe
  TTL. Test "same eventId twice → no double row" against the new
  consumer path.
- **5.5 race condition** — concurrent logins to the bootstrap admin
  hit `INSERT ... ON CONFLICT` cleanly; verify with a test.
- **5.6 + 5.7 schema migrations** — additive only; named-file
  Rule 4 instruction in each commit.
- **5.7 / 5.8 token security** — invitation tokens are bearers,
  treated like passwords. Hash before storage; constant-time compare.
  Sprint 10 hardens further (rotation policy, expiry sweeper).

## Out of scope (Sprint 6+)

- **Driver self-registration (OTP)** → Sprint 8 parallel track.
- **Impersonation flow** → Sprint 8 parallel track.
- **Sub-resource route `assertPermission` retrofits** (~30 routes
  from Sprint 4.4 carry-forward) → Sprint 8 (rides with tariff once
  invite-issued userIds are in sessions).
- **Sprint 4.5 production-cutover dead-code cleanup** → Sprint 10
  (after observability + security pass).
- **OAuth / passkey / api_key credentials** → Sprint 10.
- **MFA on PlatformGrant** → Sprint 10.
- **Postgres RLS** → Sprint 10.
- **OTP delivery channel** (Twilio / Cloudflare Email / SMS provider)
  → Sprint 8 design summary.
- **Full observability dashboards** → Sprint 10.
