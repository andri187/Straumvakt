# 2026-08-02 — AMPECO benchmark: change suggestions

Source: [developers.ampeco.com](https://developers.ampeco.com/) API surface
(~400 endpoints, read via `llms.txt` index — detail pages are JS-rendered
and were not readable). Comparison is against the *shape* of a mature
CPMS API, not its semantics.

Context: market conditions may require Straumvakt to absorb another
operator's fleet at short notice (multi-operator, connectors in the
1000s). Items below are ordered by how much they matter under that
scenario, not by AMPECO's ordering.

---

## S-1 — Expose current-state read models as first-class resources

**Status:** suggested, not scheduled.

AMPECO exposes `Charge Point / Latest Hardware Status Log`, `Latest
Network Status Log`, and `Charge Point / Status / Read` as endpoints
*separate from* the log listings they derive from. The current-state
projection is part of the public contract, not an internal cache.

Straumvakt today recomputes state on every read — `listSiteTree` walks
the full hierarchy with aggregates and credential decrypt per request,
uncached.

**Suggested change:**

- Add a `fleet_state` projection table maintained by
  `apps/api/src/lib/ocpp/projections.ts`, keyed by connector, holding
  status + `statusUpdatedAt` + last-seen.
- Back `listSiteTree` and the driver/host list endpoints with it.
- Mirror the AMPECO split in the API: `.../status` (current) vs
  `.../status-log` (history).

Same pattern on the financial side: AMPECO has `Revenues / Listing`,
`Expenses / Listing`, and `Partner Settlement Reports` with nested
`Settlement Records` — materialised entities, not report generators.
Report-shaped projections should follow that shape when the
operator/driver/contractor reporting work starts.

**Relates to:** ADR 0023 (fanout has nothing cheap to invalidate without
this), ADR 0018 (report-ready tables were already named there).

---

## S-2 — Bulk onboarding from vendor credentials

**Status:** confirmed wanted (operator request, 2026-08-02).

AMPECO: `Configuration Template / Apply to Charge Points`, `Bulk Create
Variables`, `EVSE / Bulk Assign Tariff Groups`, `Sync configuration`.

Straumvakt has per-charger claim only. Every operator action is one
charger at a time — the operator-console scaling wall, independent of
the ingest ceiling.

**Suggested change:**

- After a Zaptec (or other vendor) credential is added, list every
  charger visible under it and allow **select-all / select-some →
  claim in bulk**, provisioning identities, installations and circuits
  in one pass.
- Same primitive for the OCPP-native path: bulk-claim from
  `pending_discoveries`.
- Carry forward the UX-2 / UX-3 fixes from the 2026-05-12 note
  (auto-fill vendor/model/serial from identity prefix; respect the
  installation's `enforce_authorize` flag so no-auth installs don't get
  a Basic-Auth password they can't use).

**Why it ranks high now:** under a fleet-acquisition scenario, onboarding
speed is commercially load-bearing. The 30-minute-per-charger flow
documented on 2026-05-13 does not survive contact with a fleet takeover.

---

## S-3 — Split "downtime period" from "issue"

**Status:** suggested, for the Issue Engine evolution.

AMPECO models these as separate resources:

- `Charge Point Downtime Periods` — full CRUD **plus a `Status Log`**
- `EVSE Downtime Periods` — same
- `Issues` — plain CRUD, deliberately thin, no auto-resolution surface

The decomposition:

- A **downtime period** is a *derived fact* about availability, computed
  from status and connectivity observations. It is what SLA and uptime
  reporting read.
- An **issue** is a *workstream* that references one or more downtime
  periods. It has an assignee, a status, and a resolution.

**Suggested change:** derive downtime periods automatically from
connector status + last-seen, and have the Issue Engine reference them
rather than owning availability state itself. Most of what looks like
"auto-resolving an issue" is really "the downtime period closed, so the
issue referencing it can close."

Concrete case already in the notes: N1-1 flapping `WeakSignal` /
`NoError` every 1-30 min through the night. That is a stream of
observations that should roll up into downtime periods automatically,
with an issue raised only when a threshold trips — not 40 issues.

**Caveat noted by the operator (2026-08-02):** Straumvakt is doing
several things no other CPMS does. This split is a suggestion about the
*availability* substrate only; it is not an argument to converge the
Issue Engine on anyone else's model.

---

## S-4 — Per-resource versioning and deprecation, not global

**Status:** suggested as a fix.

AMPECO ships `(deprecated version)` and `(current version)` of all five
Notifications endpoints side by side, lists Authorizations v1 and v2.1
concurrently, and deprecates `Roaming Operators` in favour of separate
CPO/EMSP resources. Platform version is `v3.224.0` on a weekly release
cadence — the major version is decorative; the real contract is
per-endpoint deprecation.

Straumvakt has an unversioned API surface and **a mobile app in the
field that cannot be force-updated**. Today that is survivable because
there are no external consumers. It stops being survivable the moment
another operator's tooling depends on a response shape.

**Suggested change:**

- Adopt per-resource versioning (path or header) for anything the mobile
  apps or an external party consume.
- Run old and new concurrently through a stated deprecation window;
  never break a shape in place.
- Record deprecations in `docs/reference/straumvakt-api-reference.md`
  alongside the endpoint, the way AMPECO lists both versions together.

---

## S-5 — Notification delivery: track failures, expose replay

**Status:** suggested as a fix.

AMPECO's Notifications resource is a managed subscription model
(Subscribe / Listing / Read / Update / Unsubscribe) plus an explicit
**`Resend Failed`** endpoint. That tells us they queue deliveries, record
per-delivery failure, and expose *replay* rather than promising
guaranteed delivery.

This is the same posture ADR 0023 already reaches for ("log-and-drop for
the SSE path, explicit retry queue for the push path") — but ADR 0023
has no notion of a delivery record or an operator-triggered replay.

**Suggested change:** when the push/notification pipeline is built,
persist a delivery record per notification attempt with status, and add
an operator-facing resend-failed action. Cheap to add at design time,
expensive to retrofit once notifications are load-bearing.

---

## Noted, not actioned

**Installation layer.** AMPECO has no equivalent — their hierarchy is
`Location → Charge Point → EVSE → Connector` with Circuit as an
orthogonal attach/detach relation, not a tree level. Straumvakt's
`Site → Installation → Circuit → Charger` is **retained by design**: it
reflects real load-balancing topology and how the circuit is physically
wired (operator, 2026-08-02). Open question parked: whether the OCPP
ingest path needs to know about the tree at all, or whether the tree is
purely a control-plane concern.

**EVSE layer.** AMPECO treats EVSE as a first-class entity between
Charge Point and Connector, with its own downtime periods, status logs,
notes and tariff-group assignment. Straumvakt goes Charger → Connector
directly. OCPP 1.6 tolerates this; OCPI does not — the EVSE ID is the
roaming-visible unit. Already on the operator's list for the coming
schema changes.

**Circuit / Unmanaged Load.** AMPECO exposes
`Circuit / Unmanaged Load / Read` — accounting for non-EV load sharing
the circuit. For MDU/HOA installs on constrained older supply this is
what makes load management correct rather than approximate. Straumvakt's
Circuit has `ampereCeiling` and `phaseCount` but no notion of what else
is on the wire.

**Smart-charging surface.** AMPECO's circuit priorities, SoC priorities,
session boost, session priority, schedules and user priorities are
collectively larger than several Straumvakt sprints. Not a parity
target.
