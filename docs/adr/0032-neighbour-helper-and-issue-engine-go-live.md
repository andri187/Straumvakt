# ADR 0032 — Neighbour-helper (nágrannahjálp) + Issue Engine pulled into go-live scope

**Status:** Accepted (2026-06-04)
**Carve-out:** §5C *escalation code* is gated on the ADR 0031 cost
mechanics + formal definition of **Tengill** (the default service
provider) — the routing/cost *rules* are accepted; the escalation
implementation waits on those. Everything else in this ADR is buildable.
**Date:** 2026-06-04
**Sprint:** Targets the going-public production push (re-sequences Tag D
out of the post-pilot backlog — see delivery-plan §1.2b edit accompanying
this ADR).
**Supersedes:** The post-pilot deferral of **Tag D — Issue Engine** as
stated in [ADR 0006](./0006-pilot-scope-rev2-2026-04-25.md) and
[ADR 0005](./0005-pilot-scope-tightening-2026-04-25.md), *for the
narrow slice defined below only*. The advanced slice of Tag D stays
deferred.
**Related:**
[ADR 0008 — Cost-center splitting / owner routing](./0008-cost-center-splitting.md),
[ADR 0014 — Identity, tenancy, authorization](./0014-identity-tenancy-and-authorization.md),
[ADR 0019 — Agreement + DriverGroup architecture](./0019-agreement-and-bearer-architecture.md),
[ADR 0020 — Driver access via DriverGroups](./0020-driver-access-via-driver-groups.md),
[ADR 0026 — Host-managed driver enrollment + billing model](./0026-host-managed-driver-enrollment-and-billing-model.md)

> ADR numbers 0027–0031 are reserved (0027 host onboarding, 0028 driver
> invite, 0029 child-object model, 0030 device registry — all named in
> ADR 0026's follow-up list) or taken (0031 cost-model). This ADR takes
> the next free slot, 0032.

---

## Context

The 2026-06-03 going-public pivot (ADR 0026) moved the product from a
single demonstrable pilot toward real multi-dwelling and company hosts
operating in production. Two consequences for issue handling:

1. **Manual diagnosis stops scaling.** ADR 0006 deferred the entire
   Issue Engine post-pilot and accepted "operator diagnoses by hand from
   the raw `events.event_log`" as the pilot stand-in. ADR 0006 itself
   flagged this as *"manageable at single-pilot-site scale (≤10
   chargers); not manageable at production scale."* Going public crosses
   that threshold — the operator cannot hand-query the event log for
   every fault across many hosts.

2. **Multi-dwelling hosts have an obvious first responder who is not
   staff.** In an HOA or apartment building, the person best placed to
   power-cycle a stuck charger or confirm "it's working again" is a
   **resident** — a neighbour — not Straumvakt staff and not a paid
   contractor. This is the literal *nágrannahjálp* ("neighbour help")
   role. The pilot-era docs lumped this together with paid contractors
   under one "helper role" line item; the going-public model separates
   them.

### The blocker that forced this ADR's shape

The schema carries a legacy `tenancy.MembershipRole.helper` enum value,
but it is explicitly marked *"Pre-ADR-0014 values; deprecated. Sprint 9
RLS rebuild removes them."* The current Sprint 9 RLS rebuild deletes it.
There is **no runtime code** behind it — `helper` maps only to
`TECHNICIAN_BUNDLE` in `permissions.ts`; `Membership.scopeSiteIds` is
never filtered on; `IssueTicket.assignedToContractorId` is never written.

So "scope the helper role" cannot mean "build on the existing `helper`
staff enum" — that enum is being removed. A neighbour is also *not* host
staff: giving residents a `tenancy.Membership` row would hand them RBAC /
tenancy surface (org read, charger config) they must not have. The
neighbour is already modelled correctly elsewhere — as a **driver**, via
`agreements.driver_group_memberships` (ADR 0019/0020). This ADR builds
the capability there.

---

## Decision

### 1. Pull a narrow slice of Tag D into go-live scope

Into go-live scope (re-sequenced out of post-pilot):

- The **five basic deterministic detection rules** (§4 below).
- The **ticket workflow** — `issues.tickets` lifecycle
  `open → triaged → assigned → in_progress → waiting → resolved → closed`,
  `issues.ticket_events` timeline, operator console issue pages.
- **Driver-raised assistance** + the **neighbour-helper** capability (§2,
  §3) and the §5 pull / escalation flow, including per-ticket chat (§6).
- **Cost-gated escalation to a contractor** (§5C) — this *activates* the
  previously-stubbed `assigned_to_contractor_id` path, gated on the
  ADR 0031 cost-source dependency.

Staying deferred (post-pilot, unchanged from ADR 0006 Tag D):

- Advanced detection (anomaly + sequence rules), smart multi-tier
  routing **automation** (resolution stays driver-driven per §5, not
  auto-assigned), ML categorization, **helper reputation scoring**,
  charger lifetime-history analytics, and the broader contractor
  operations / marketplace layer (rating, dispatch SLAs, payout flows).
  §5C uses contractor *assignment* only — not the full ops layer.

### 2. Neighbour-helper = capability on `DriverGroupMembership`

A neighbour-helper is an ordinary driver (`identity.users` row with a
`DriverGroupMembership`) who has been elevated by the host admin to act
on issues at the chargers their DriverGroup covers.

- **Does not revive `tenancy.MembershipRole.helper`.** That enum's
  removal in the Sprint 9 RLS rebuild proceeds unchanged. The neighbour
  has **no `tenancy.Membership` row.**
- New additive column on `agreements.driver_group_memberships`:
  `is_helper boolean NOT NULL DEFAULT false`, plus audit columns
  `helper_granted_by_id uuid NULL` (the host-admin User who elevated
  them) and `helper_granted_at timestamptz NULL`.
- **Scope is inherited, not re-declared.** A helper's reach is exactly
  the installations/sites/chargers covered by their DriverGroup's
  `Agreement.scopeFilterJson` (the same lever ADR 0020's resolver
  already walks). No `scopeSiteIds` array, no second scoping mechanism.
  Elevating a member to helper grants action rights *within the access
  they already hold* — never broader.
- A driver may be a helper in one DriverGroup and a plain driver in
  another (per ADR 0026 item 9, one identity spans multiple groups /
  hosts). The capability is per-membership, not per-identity.

### 3. Driver-side authorization is a new, capability-derived path

Drivers have no `Membership`, so they have no entry in the
`Membership.role → permission bundle` table in `permissions.ts`. This ADR
adds a **separate capability set** resolved from driver context (access
scope + the `is_helper` flag) — *not* a new staff bundle. Per the §5
pull model there are three tiers:

```
DRIVER_BASE (any driver, on issues at chargers in their own access scope):
  issue.raise           — create an assistance request (5B.1)
  issue.comment         — chat on their own / claimed issues (§6)
  issue.escalate        — escalate their OWN issue to a technician (5C.1)

PEER_RESPONDER (any driver whose scope covers the SAME charger):
  issue.read            — see in-scope assistance requests (5B.2)
  issue.claim           — pick up a request (sets assigned_to_user_id = self)
  issue.comment         — advise the raising driver via chat

HOST_HELPER (PEER_RESPONDER + the is_helper flag, §2):
  + preferred notification on in-scope requests
  + issue.transition    — open → in_progress → waiting → resolved
  + charger.remote_start / remote_stop / reset  — within scope (OPEN, see below)
```

Explicitly **excluded** from every driver tier: `charger.config`,
billing, driver management, tariff, host org read beyond their own group,
cross-site visibility, ticket `close` / `triage` / reassignment, and
assigning a *contractor* (5C resolution is operator/host-mediated).

Every check is **scope-gated**: the target charger/ticket must resolve
through the actor's `DriverGroupMembership → DriverGroup →
Agreement.scopeFilterJson`. Out of scope → no capability.

> **Decided (2026-06-04):** charger control (`remote_start/stop/reset`)
> is **host-designated helpers only**. Plain peers are **chat-only** —
> they advise the raising driver but cannot actuate the charger. Only a
> `is_helper` user (or staff/contractor) can reset/start/stop.

Every helper authorization check is **scope-gated**: the resolver
confirms the ticket's `subjectId` (or the target charger) resolves
through the helper's `DriverGroupMembership → DriverGroup →
Agreement.scopeFilterJson` before allowing the action. A helper outside
scope is treated as a plain driver (no capability).

### 4. The five basic detection rules

Deterministic, signal-driven, one `issues.detection_rules` row per rule
per org (the model already exists). First release is **read-only
detection producing explainable tickets** — no automated remediation.

| `rule_key` | Fires when | Default `category` | `severity` |
|---|---|---|---|
| `charger_offline` | No heartbeat / status for > 5 min from a charger expected online | `physical` | high |
| `site_connectivity` | ≥ N chargers at one site/installation drop within a short window (correlated → one site ticket, not N) | `connectivity` | high |
| `stuck_session` | A session runs beyond a configurable max with no meter progress | `physical` | medium |
| `auth_failure_burst` | Authorize rejections exceed a threshold rate at an installation | `access` | medium |
| `metering_anomaly` | MeterValues non-monotonic / signature mismatch / implausible delta | `metering` | high |

`config` (JSONB) carries each rule's thresholds. Correlation/dedup groups
by `(subjectType, subjectId, rule_key)` within a time window so a WAN
outage that knocks 20 chargers offline yields **one** `site_connectivity`
ticket, not twenty `charger_offline` tickets.

### 5. Issue origination, assistance, and escalation  *(Rule 5 — fundamental logic)*

> This is an access-grant / routing rule **and** a money-flow decision
> (cost disclosure before paid escalation ties into
> [ADR 0031](./0031-cost-model-and-money-flow.md)). Load-bearing —
> confirmed by the operator on 2026-06-04; stated here as canon.

The model is **driver-initiated and pull-based**, not engine-assigned.
A driver in difficulty drives the flow; helpers respond voluntarily;
the driver decides if and when to pay for a technician.

#### 5A. Two origination paths

| Path | Origin | Audience | Money |
|---|---|---|---|
| **Driver-raised assistance** | A driver creates an issue at a charger and *requests assistance* | Voluntary peer/helper pool (5B) | Free until the driver escalates to a technician (5C) |
| **System-detected** | The §4 detection rules auto-create a ticket | Operator / host-admin / hardware owner | Per host/owner service arrangement |

The two coexist. A driver only ever sees and drives **5B**. The
billing-sensitive system-detected faults a driver cannot judge
(`metering`, `connectivity`, `access`) stay on the **5D** operator path
and are never pushed at a neighbour.

#### 5B. Driver-raised assistance — voluntary pull

1. **The driver chooses.** Raising the issue and *requesting neighbour
   assistance* is the driver's action, never automatic. The issue is an
   `issues.tickets` row with the raising driver recorded (new
   `raised_by_user_id`).
2. **Eligible responders (two classes, both opt-in):**
   - **Peers** — any driver whose access scope covers the *same charger*
     (resolved through the same `DriverGroup → Agreement.scopeFilterJson`
     chain). No flag needed; eligibility is derived from shared access.
   - **Host-designated helpers** — users the host flagged `is_helper`
     (§2) on their DriverGroupMembership.
   Both classes are **notified** of the request and may answer **if they
   like** — there is no assignment, no obligation, no SLA timer. A
   responder who picks it up "claims" it (sets `assigned_to_user_id` to
   themselves) and talks to the driver via the per-ticket chat (§6).
3. **Resolution.** If a responder resolves it, the driver confirms and
   the ticket closes. Helping is unpaid neighbourly assistance — no
   money moves on this path.

#### 5C. Driver-controlled, cost-gated escalation to a technician

1. **The issuer escalates** — only the raising driver decides to escalate
   (on no answer, or an unresolved result). It is never automatic and
   never decided by a helper.
2. **Cost is disclosed first.** Before the escalation commits, the driver
   is shown **the cost they would bear** and must explicitly accept it.
   No surprise charge. The disclosure-before-commit gate is fixed canon.
3. **Technician = contractor, resolved by precedence — and the rate
   follows the same precedence:**
   1. The **host's contracted contractor**, if the host has a service
      SLA with another party — that party's **SLA rates** apply, else
   2. **Tengill** — Straumvakt's default service provider — whose
      **general rate-card** applies as the fallback.
   Assignment uses the existing `assigned_to_contractor_id` column (this
   path *activates* that previously-deferred field). "Tengill" is the
   named pool/default referenced throughout 5C.
4. **Owner-routing (ADR 0008) still informs which contractor owns the
   hardware** — escalation respects `assets.chargers.owner_org_id` when
   resolving the responsible service party.

#### 5D. System-detected routing (path A — unchanged from ADR 0008)

For §4 engine-detected tickets the driver never sees, retain owner-first
routing: `connectivity`/`metering`/`access` → hardware owner
(`ownerOrgId`) → operator; never auto-pushed at a neighbour.

#### Ticket columns

- `assigned_to_user_id` — the peer/helper who **claimed** a 5B request.
- `assigned_to_contractor_id` — **activated** by 5C escalation (was
  deferred); the resolved host/pool contractor.
- New `raised_by_user_id` — the driver who originated a 5B issue (null
  for system-detected). Distinguishes "who needs help" from "who's
  helping."
- Staff vs neighbour vs contractor assignment stays **derivable**; an
  explicit `assignee_kind` discriminator is deferred unless the UI needs
  it.

#### Cost source — decided rule, with remaining ADR 0031 mechanics

**Rule (decided 2026-06-04):** the price shown at escalation follows the
contractor precedence — **host SLA rates** when the host has a service
SLA with another party, else **Tengill's general rate-card** (Straumvakt
default). The disclosure-before-commit gate is fixed.

Still to pin (in / alongside [ADR 0031](./0031-cost-model-and-money-flow.md)),
non-blocking for accepting this ADR but blocking escalation *code*:

- **What "Tengill" formally is** — a Straumvakt service brand, a distinct
  `tenancy.organizations` row with `service_contractor` role, or a
  rate-card construct. New entity; not yet in schema/docs (zero refs as
  of 2026-06-04).
- **Where the general rate-card lives** — a billing/rate table Tengill
  owns; how host-SLA rates are recorded against a host's contractor
  agreement.
- **Who the driver pays + invoice surfacing** — host-as-agent vs
  Straumvakt collection, and how the call-out appears on the post-paid
  invoice (ADR 0031 money-flow).

### 6. Per-ticket chat *(in-app, raising driver ↔ responders)*

The §5 pull model is conversational: the **raising driver** and whoever
responds (a peer, a host-designated helper, and — after 5C escalation —
the contractor / operator) talk it through — *"have you tried
unplugging?"*, *"here's a photo of the error on the screen"*, *"working
again now"*. Chat is **per-ticket**, not a standalone inbox: every
message is bound to one `issues.tickets` row, so the conversation and the
issue stay together. The raising driver is always a participant on their
own issue.

Grounded in the infra audit (2026-06-04) — reuse over reinvention:

- **Data model — new `issues.ticket_chat_messages` table** (greenfield;
  chosen over overloading `ticket_events`, which stays the structured
  *audit* timeline — state transitions, rule-fired, assignment — while
  chat is freeform human messaging with read-state + attachments):
  `id, ticket_id, author_user_id, body text, attachment_refs text[]
  (R2 keys), created_at, read_by uuid[]`. Index `(ticket_id, created_at)`.
  `ticket_events` still gets a lightweight `chat_message` breadcrumb so
  the audit timeline records that a message occurred (not its body).
- **Attachments — reuse R2 `EVIDENCE_BUCKET`** (already bound in
  `apps/api/wrangler.jsonc`). Key scheme mirrors the archive pattern:
  `<orgId>/tickets/<ticketId>/<uuid>.<ext>`. A photo of the broken
  charger is the highest-value attachment for *nágrannahjálp*. Needs a
  presigned-URL helper (not yet in the codebase).
- **Realtime transport — reuse the gateway DO pattern.** The OCPP gateway
  already runs a per-entity Durable Object on the WebSocket Hibernation
  API (`gateway/src/identity-do.ts`). A `TicketChatDurableObject` keyed
  by `ticket_id` is the same shape. **MVP may ship poll-based** on
  `GET .../messages?since=` and add the DO/WS as a fast-follow — the
  table + REST path is the load-bearing part; realtime is an upgrade.
- **Surfaces — dual-screen.** Helper writes from the **Flutter driver
  app** (`apps/mobile`, `/api/driver/*` bearer routes — extend with
  `/api/driver/tickets/:id/messages`). Host-admin/operator read+write
  from the **web console**. Same `ticket_chat_messages` rows underneath.
- **Authorization** rides §3: the raising driver and in-scope responders
  read/post per their tier capabilities (`issue.read` / `issue.comment`),
  scope-gated through their DriverGroup. Operator/host-admin/contractor
  post via their own permissions once in the thread.
- **Notify-on-message — push is greenfield** (no FCM/APNs today). MVP
  relies on in-app unread badges from `read_by`; push delivery is a
  named fast-follow (provider pick + `push_token` on `User` + a send
  queue), not a go-live blocker.

**Participants — resolved:** the raising driver is always in; in-scope
responders (peers + host helpers) join on claim; the contractor/operator
joins on 5C escalation. (Was an open question; the §5 pull model settles
it.)

Open chat decisions (flagged, not yet locked):

1. **Realtime at go-live or fast-follow?** — poll-based MVP vs.
   `TicketChatDurableObject` from day one.
2. **Push provider** — FCM+APNs vs. a managed push service; gates
   notify-on-message.
3. **Attachment limits** — photo-only vs. any file; size cap; virus/EXIF
   handling.

---

## Consequences

### Enabled

- Production-scale fault handling without hand-querying the event log.
- *Nágrannahjálp* becomes real: a resident can power-cycle their
  building's stuck charger and close the loop, without staff dispatch and
  without being granted any staff/tenancy surface.
- Reuses the ADR 0019/0020 access chain wholesale — helper scope is just
  the agreement scope; no parallel scoping model to keep in sync.
- Owner-routing (ADR 0008) and the contractor schema stubs are untouched,
  so the deferred contractor/marketplace layer lands later without
  rework.

### Costs / risks

- **New authorization path.** Driver-capability-derived permissions are a
  genuinely new branch beside the `Membership.role` bundle path; it needs
  its own tests, and every helper action must be scope-gated or a
  resident could act on a charger outside their building. This is the
  primary Rule 5 risk.
- **Detection-rule false positives** auto-creating noise tickets. First
  release is read-only/explainable and thresholds are per-org
  configurable to tune this down.
- **Scope-change discipline (Rule 11).** Re-sequencing Tag D requires the
  accompanying delivery-plan edit (shipped with this ADR) and lands the
  go-live date later than a no-Issue-Engine launch would.

### Schema implications (additive — no renames, no drops)

- `agreements.driver_group_memberships`: add `is_helper`,
  `helper_granted_by_id`, `helper_granted_at`.
- `issues.detection_rules`: seed the five `rule_key` rows per org (data,
  not schema).
- `issues.tickets`: add `raised_by_user_id uuid NULL` (§5 driver-raised
  origination; null for system-detected). Assignment still reuses
  `assigned_to_user_id` (claimed peer/helper) and **activates**
  `assigned_to_contractor_id` (5C escalation).
- `issues`: new `ticket_chat_messages` table (§6) + a `chat_message`
  breadcrumb eventType on `ticket_events`. Attachments reuse the R2
  `EVIDENCE_BUCKET` (needs a presigned-URL helper). Push notify-on-message
  is greenfield, deferred as a fast-follow.
- `tenancy.MembershipRole.helper` removal (Sprint 9 RLS rebuild)
  proceeds; this ADR does **not** depend on it.

---

## Open implementation questions (not blocking this ADR)

- **`category` taxonomy** — `IssueTicket.category` is a free `String`
  today. Routing in §5 needs a closed set. Promote to an enum, or keep
  string + a validated constant list?
- **Detection-rule signal source** — do the rules read live OCPP gateway
  state, the projected `events.event_log`, or a derived health table?
  (Affects detection latency vs. load.)
- **Helper transition UI on mobile vs. operator console** — does a
  neighbour act from the driver mobile app, or a thin web surface? ADR
  0026 makes the mobile app the driver surface; helper actions likely
  belong there.
- **SLA defaults per category** — `slaTargetAt` needs default windows
  before escalation logic is meaningful.
- **`assignee_kind` discriminator** — add now for UI clarity, or stay
  derivable?

## Rejected alternatives

- **Revive `MembershipRole.helper`** — collides head-on with the
  in-flight Sprint 9 RLS rebuild that deletes it, and wrongly models a
  resident as host staff with tenancy surface.
- **New staff role bundle (`neighbor_helper` Membership)** — still makes
  the neighbour staff; grants a `tenancy.Membership` and RBAC surface a
  resident should never hold; duplicates the DriverGroup scope as
  `scopeSiteIds`.
- **Build the full Tag D engine before go-live** — advanced detection,
  smart routing tiers, ML, reputation scoring. Rejected as scope that
  pushes the launch date with no go-live necessity; this ADR pulls
  forward only the slice production actually needs.
- **Route `physical` tickets to a contractor first** — wrong for the
  multi-dwelling case where a present resident resolves a power-cycle in
  minutes; contractor dispatch is the escalation, not the first hop.
