# Sprint 3 — Identity Foundation · Retrospective + Closure List

**Dates:** 2026-04-29 → open (closure pending the items below)
**Exit criterion (revised, per [ADR 0015](../adr/0015-sprint-3-scope-swap-ocpi-to-identity.md)):**
The four items in §"Closure list" below are checked. Original exit
("OCPI 2.2.1 CPO endpoints respond to contract tests") deferred to
**Sprint 14 — OCPI Foundation (post-pilot)** per ADR 0015.
**Status:** **In progress.** Code-side identity work is committed (see §What
shipped). Three operational and bookkeeping items must close before Sprint 4
starts.

This retro is unusual in that it lands while Sprint 3 is still open. The
prompt was the 2026-05-02 stocktake conversation where the operator named
the scope drift and asked to reconcile docs before committing more code.
Sprint 3 closes when the closure list checks; the retro's "What shipped"
section is updated as items land.

---

## What shipped

| Tag | Subject | Status | Commit |
|---|---|---|---|
| `[Sprint 3 / ADR 0014]` | Tenants — Groups tab (cross-org listing) | ✅ | `bb9446e` |
| `[Sprint 3 / ADR 0014]` | enrich create-user form — full profile at create time | ✅ | `81c2dc7` |
| `[Sprint 3 / ADR 0014]` | user profile — API-onboarding scaffolding (no OCPP work) | ✅ | `acbfd87` |
| `[Sprint 3 / ADR 0014]` | vendor credentials — reassign to a different org | ✅ | `916cf2f` |
| `[Sprint 3 / ADR 0014]` | sites — move-to-organization cascade | ✅ | `acd63e7` |
| `[Sprint 3 / ADR 0014]` | accounts URL/label rename (Tenants → Accounts) | ✅ | (folded into above) |
| `[Sprint 3 / ADR 0014]` | identity schema migration (`20260502120000_user_profile_enrichment`) | ✅ | (in branch) |
| `[Sprint 3 / ADR 0013]` | sidebar vendor sub-tabs (Alfen / Teltonika); sites tree polish | ✅ | (multiple) |

The shipped work matches ADR 0014's Build-Order §"NOW (Sprint 3 finish)"
items. ADR 0014 itself was authored mid-sprint (2026-05-01) without an
accompanying scope-swap ADR; that gap is what ADR 0015 closes. Per Rule 11
("scope changes require an ADR AND an edit to the delivery plan"),
neither was satisfied during the in-flight swap. ADR 0015 + the delivery
plan §6 rewrite (2026-05-02) close the bookkeeping retroactively.

### Verification at this retro draft

- `npx prisma validate` — clean (last verified 2026-05-02)
- `npx tsc --noEmit` — clean (last verified 2026-05-02)
- `npm run build` — last green build verified 2026-05-02
- Unit tests — green per branch CI

(Re-verify and update at sprint close.)

### Decisions made (ADRs)

- **[ADR 0014](../adr/0014-identity-tenancy-and-authorization.md)** —
  Identity, Tenancy, and Authorization. Authored 2026-05-01. Defines
  the four-layer Identity → Audience → Tenancy → Authorization model,
  trims `OrganizationRole` from 21 values to 13 (OCPI-aligned), introduces
  `MembershipRole` + `PlatformRole` enums, replaces `PlatformAdmin` with
  `PlatformGrant`, and lays out the Sprint 3 → 4 → 5 → 9 build order.
- **[ADR 0015](../adr/0015-sprint-3-scope-swap-ocpi-to-identity.md)** —
  Sprint 3 scope swap. Authored 2026-05-02. Records that ADR 0014 work
  substituted for the original Sprint 3 OCPI Foundation, defers OCPI to
  a new Sprint 14 (post-pilot), and absorbs gbtNotes Sprint S1 into
  Sprint 3 closure.

---

## Closure list — four items must check before Sprint 3 closes

These are the gates between current state and Sprint 4 entry. Sprint 4 may
**not** begin until all four are checked off.

### ☐ 1. Orphan-table write paths

**Problem:** ADR 0014 added `IdToken`, `UserVendorRef`, `VendorUserGroup`,
`VendorUserGroupMembership`, `Vehicle` as DDL. The 2026-05-02 gap check
confirmed none of these tables have repository write paths today. They
are pure orphan tables — schema exists, no logic touches them.

**Required:** at least one repository write path per table that is callable
from a real route. Specifically:
- `IdToken` — admin form at `/people/users/[id]` adds an RFID token to the
  user. Repo function `id-tokens.addToken(userId, { kind, value, label,
  scopeInstallationId? })`. Idempotent (P2002 on duplicate value surfaces
  cleanly).
- `UserVendorRef` — wired alongside `IdToken` (the same form path that
  attaches a Zaptec UUID to a user creates the vendor-ref row).
- `Vehicle` — admin form section "Vehicle" added to the user-detail page.
  Repo function `vehicles.create(userId, { make, model, plate, ... })`.
- `VendorUserGroup` and `VendorUserGroupMembership` — **deferred**.
  These are populated by the user-import sync engine (deferred per
  the comment in ADR 0014's schema delta). Sprint 3 closure does not
  require write paths here; Sprint 4 does.

**Test:** hand round-trip — create a user with one RFID token + one
vehicle in `/people/users/new`; both rows visible on the detail page;
revoke RFID works; idempotent re-create surfaces existing row, doesn't
duplicate.

**Owner:** unassigned. Estimated: half a day.

### ☐ 2. gbtNotes Sprint S1 — events-ingest path port

**Problem:** Per [`gbtNotes/2026-05-01-ocpp-ingest-current-state-and-gaps.md`](../../gbtNotes/2026-05-01-ocpp-ingest-current-state-and-gaps.md),
the gateway's `MAIN_APP` service binding routes to `hlada-api-staging` on
staging, but `/api/ocpp/events` is mounted only on the UI Worker
(`hlada-staging`). Result: every OCPP frame on staging 404s after
BootNotification; `ChargeSession` / `MeterValue` / status rows are never
created from real charger traffic on staging.

**Required:** the eight-step fix from the note's "Recommended next step"
section, with the seven sharpenings from
[`gbtNotes/ocpp-ingest-note-review.md`](../../gbtNotes/ocpp-ingest-note-review.md)
folded in. Specifically:
- Port `event-envelope`, `projections`, `bootstrap`, and the events
  repository from `src/lib/ocpp/*` and `src/lib/repositories/events.ts`
  into `apps/api/src/lib/ocpp/*` and `apps/api/src/lib/repositories/events.ts`.
- New Hono handler `apps/api/src/routes/internal/ocpp-events.ts`,
  mounted at `/api/internal/ocpp-events` (renamed for prefix consistency).
- `gateway/src/ingest-client.ts:43` URL update.
- `gateway/wrangler.jsonc` top comment fix per review §1.
- **Delete** `src/app/api/ocpp/events/route.ts` and the UI-Worker-side
  `event-envelope`, `projections`, `bootstrap`, `events.ts` in the same
  change set per review §6.
- Idempotency-parity preserved exactly; auth-parity diff before cutover
  per review §3, §4.
- Tests: missing header, malformed JSON, invalid envelope, idempotent
  replay, fresh event success.
- Atomic deploy: API first, verify mount, then gateway.

**Production cutover deferred to Sprint 4** — Sprint 3 only cuts staging.

**Test:** smoke list per review §7 — `OcppIdentity.lastSeenAt` ticks on
Heartbeat from a real charger; `Connector.status` flips on
StatusNotification; a `ChargeSession` row appears on StartTransaction.

**Owner:** unassigned. Estimated per the note: 2–3 hours including tests
and smoke.

### ☐ 3. OCPP Authorize handler — real or revert

**Problem:** Audit on 2026-05-02 surfaced the unsafe combination of
`gateway/src/identity-do.ts:218–219` returning hardcoded `Accepted` for
every Authorize.req, while Dalvegur was flipped to `AuthenticationType=2`
("OCPP-managed authentication required") earlier the same day for probing.
Customers can charge today only because the stub default-accepts. That's
incidental, not designed.

**Required:** pick one path; do not let the middle persist:

- **(a)** Replace stub with real `IdToken` lookup. Per the design proposed
  during the 2026-05-02 conversation. Includes:
  - `Installation.enforceAuthorize` boolean column added (default false).
  - `gateway/src/identity-do.ts` calls `apps/api/src/routes/internal/ocpp-authorize.ts`.
  - Internal route looks up `IdToken` by `value`, applies status + scope
    rules, returns OCPP-shaped `idTagInfo` plus the per-installation
    `enforceAuthorize` flag.
  - Default false = shadow mode (verdict logged, Accepted returned).
  - Operator flips per-installation when ready.
  - Tests for active / revoked / expired / unknown / scope-mismatch verdicts.

- **(b)** Operator reverts Dalvegur to `AuthenticationType=0` in the
  Zaptec portal. Dev stub stays in the gateway as documented at
  `identity-do.ts:206–207`. Real handler ships Sprint 4 or later.

**Decision deadline:** before Sprint 3 closes. Default to (b) if (a)'s
design isn't approved within the closure window — (b) is fully reversible
and removes operational ambiguity.

**Owner:** operator decides path; engineering implements.

### ☐ 4. Reconciliation docs

**Required:**
- ADR 0015 committed on the working branch.
- Delivery plan §6 rewrite committed.
- This retro committed.
- ADR 0014 `Relates to:` line updated to reference ADR 0015 (forward link).
- Delivery plan §11 (post-pilot timeline) references the new Sprint 14
  OCPI placement.

**Status:** drafted 2026-05-02. Awaiting commit.

---

## What slipped (or shifted)

### 1. The scope swap itself

ADR 0014 was authored 2026-05-01 with build-order text saying *"NOW (Sprint 3
finish)"* — claiming the Sprint 3 slot for identity work. The 18 commits
preceding 2026-05-01 had already been landing under `[Sprint 3]` tags doing
exactly that work. No ADR or delivery plan edit covered the swap until ADR
0015 (2026-05-02). Per Rule 11 this is a documentation drift; the underlying
trade was likely correct (ADR 0014 unblocks more downstream work than OCPI
would have), but the Rule 11 violation is the slip.

**Carry-forward learning:** name a sprint's actual scope at sprint-start.
If the scope shifts mid-sprint, write the swap ADR within 24 hours of the
divergence becoming clear, not at the next stocktake.

### 2. Schema additions outpaced code wiring

`IdToken`, `UserVendorRef`, `Vehicle`, `VendorUserGroup` all landed as
DDL with no repository write paths in the same commits. The migration
moved fast; the wiring didn't catch up. The 2026-05-02 gap check
described these as "orphan tables." Closure item 1 above forces the wiring
to catch up before Sprint 3 closes.

**Carry-forward learning:** schema additions ship paired with at least
one write path. If the write path can't ship in the same commit, the
migration commit gets a deferred-wiring note in its body.

### 3. The Zaptec API discovery rabbit hole

Significant Sprint 3 conversation context (2026-05-02) was spent probing
Zaptec's API surface for user enumeration. Conclusion: at the OAuth ROPC
tier we hold, the API ceiling is the 15-user charge-history slice via
`/api/installation/{id}?DetailLevel=1`. The portal's full ~50-user list
is gated behind partner-tier access we don't have. This was useful
discovery (recorded in conversation memory and forward-references for
import design) but it didn't advance Sprint 3 deliverables.

**Carry-forward learning:** time-box discovery loops. Two probe rounds
before deciding to defer the work or commit to it.

### 4. Documentation system has two parallel sprint numberings

`gbtNotes/scale-to-4000-chargers-sprint-plan.md` numbers sprints S1–S11
in parallel to the delivery plan's Sprint 0–13(+14). ADR 0015 reconciles
the mapping in a table; the gbtNotes numbering becomes a checklist
absorbed into existing delivery sprints rather than a competing canon.

**Carry-forward learning:** new design notes use delivery-plan sprint
numbers in titles. Existing `gbtNotes/Sx` files keep their names for git
history but the parallel numbering doesn't extend further.

---

## Carry-forward into Sprint 4

These items don't block Sprint 3 closure but the Sprint 4 plan should pick
them up:

1. **Production cutover for the events-ingest path** (closure item 2 only
   does staging). Per the gbtNotes review §10, production gateway flips
   from `hlada` to `hlada-api`. Plan a separate change after staging is
   verified. Smoke list re-runs against a known production charger.
2. **`MembershipRole` + `MembershipStatus` enums and lifecycle fields.**
   ADR 0014 Build-Order Sprint 4. Plus the `requirePermission` middleware
   migration replacing `requireAdmin` route-by-route.
3. **`PlatformGrant` rename + role bundling.** Backfill all `PlatformAdmin`
   rows as `role = 'platform_admin'`. Drop the old table.
4. **Sidebar restructure.** Operations / Tenants / Platform per ADR 0014's
   navigation section. UI work pairs with the permissions migration so
   role-aware visibility tests in one place.
5. **`VendorUserGroup` + membership write paths.** Deferred from Sprint 3.2.
   Tied to whatever import strategy lands (see #6).
6. **User-import strategy decision.** The 2026-05-02 conversation surveyed
   four options (full Zaptec API import, lookup-key partner registration,
   browser-side bookmarklet scrape, OCPP-driven organic discovery).
   The ceiling on the public API rules out option 1 alone. Sprint 4
   picks one for pilot — likely option 4 (organic) backed by manual
   admin entry per closure item 1.
7. **gbtNotes scale-plan items S2–S4.** Queue-backed inbound OCPP, data
   platform decision, hot ingest / retention / projection implementation.
   These align with the original Sprint 4 retention work and can land
   together as a combined sprint (per the framing sketched in the §6
   rewrite, "Membership + Permissions + Data Storage Lifecycle").

---

## Sign-off

- Code-side exit criterion: **partially met** (ADR 0014 schema and form
  work shipped; orphan-table write paths and S1 events-ingest port pending).
- Operational exit criterion: **NOT met** (Dalvegur Authorize handler
  decision pending).
- Bookkeeping exit criterion: **partially met** (ADR 0015 + delivery plan
  §6 rewrite + this retro drafted; commits pending).
- Sprint 4 may **not** begin until all four closure items above are
  checked and this retro is updated with the closure outcome.
