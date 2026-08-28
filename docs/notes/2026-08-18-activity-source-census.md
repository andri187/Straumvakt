# Activity sources — what can prove a connector or a driver was active

**2026-08-18 · Claude A · branch `dev/core-billing-integration`**

Phase 2/3 of the 2026-08-18 15:40 dispatch. Closes preflight gap 9.6:
`reports.connector_activity_month` and `reports.driver_activity_month` were
created by migration `0002` and had **zero writers**.

---

## 1. The definition, and why the zero-session case decides the invoice

> **A connector is ACTIVE in a month if it existed on Straumvakt at any point
> in that month and we hold evidence it was still installed — whether or not
> anybody charged on it.**

Stated once in source, at the top of
`packages/commercial/src/core-billing/activity-month.ts`.

**The zero-session connector is active.** The locked model prices `200 kr /
active connector / month` and caps at `450 kr / connector / month` — both per
*connector*, neither per session. A host pays for capacity Straumvakt operates
on their behalf: the OCPP connection, the availability, the monitoring, the
readiness to bill. A quiet month is a month that capacity was provided and not
used.

The opposite reading is a plausible mistake with a nasty shape: if "active"
meant "had a session", a host with ten connectors and a quiet February would
owe nothing while we carried all ten, **and the per-connector cap would be
pricing a unit that was not the billable unit**. It under-bills, produces no
error and no complaint, and is discovered by nobody. That is why the reasoning
is in the source file and not only here.

**No proration.** "200 kr / active connector / month" says nothing about
fractions of a month. A connector activated on the 28th counts; so does one
last seen on the 2nd. Day-weighting would be an invention, not an
implementation.

---

## 2. Connector activity — every candidate source

| source | what it proves | what it misses | reliable? | covers the pre-Authorize period? |
|---|---|---|---|---|
| `charging.sessions` (`connector_id`, `started_at`) | a connector existed **and worked** — the strongest evidence there is | **every session whose `connector_id` is NULL**, and every connector nobody used | yes, where present | yes — sessions predate Authorize and still name a connector |
| `events.event_log` where `event_type = 'ocpp.raw.StatusNotification'`, `aggregate_type = 'connector'` (`apps/api/src/lib/ocpp/projections.ts:1087`, handler `onOcppRawStatusNotification` `:766`) | the connector was **talking to us** on a given day | connectors on vendor-native installations that never speak OCPP to our gateway | yes — chargers report status constantly; measured at 426 frames from one site in one day (`projections.ts:643`) | yes, for anything OCPP-connected in that period |
| `assets.connectors` (`created_at`, `status`, `status_updated_at`) | the connector **exists now**, and when its row was made | **when it was removed** — there is no `disabled_at` and no status history | **no, for retrospective questions** | no — a connector removed in February still has its row today |
| `reports.session_ledger` | same as sessions, for the billed subset | everything the billing projection never picked up | yes, but a strict subset of sessions | partial |
| `assets.evses` / `charging_stations` / `site_assets` (the asset chain) | the connector's parent existed | nothing about the connector's own availability | n/a — wrong grain | n/a |
| `charging.live_sessions` / `live_session_samples` | in-flight state | anything historical; these are ephemeral | no, for a closed month | no |

### The finding that changed the design

**`charging.sessions.connector_id` is nullable, and the Zaptec importer writes
`connectorId: null` on every synthetic session it creates**
(`apps/api/src/repositories/zaptec-session-sync.ts:394`).

So a session-only derivation is **structurally blind to every Zaptec-native
installation** — precisely the installations that exist because the charger
does not speak OCPP to us. It would have under-counted an entire installation
type, produced a smaller invoice, and raised nothing.

That is the reason `status_available` is a first-class evidence tier rather
than a fallback, and the reason the derivation cites *the strongest* evidence
per connector rather than only the first it finds.

### The `source` union — typed, not free text

`reports.connector_activity_month.source` is a `text` column. The permitted
values were written in a doc comment on the Drizzle declaration and enforced
nowhere. They are now `CONNECTOR_ACTIVITY_SOURCES`, a typed union:

| value | asserts | derived? |
|---|---|---|
| `session_observed` | a charging session on this connector inside the period | **yes** |
| `status_available` | a connector StatusNotification inside the period | **yes** |
| `manually_asserted` | an operator stated the connector was installed | **never** |

**`manually_asserted` is never derived, and that is the safety property.** A
roster row cannot prove a connector was still installed last March. Inventing
an assertion from `assets.connectors` would bill 200 kr for hardware that may
have been in a skip since February. A connector with no in-period evidence
produces **no row**, the feeder then **holds**, and an operator is asked. There
is no assertion table yet — recorded as preflight delta 9.7.

### The nullable columns, decided per column

| column | this writer | what NULL means here |
|---|---|---|
| `active_days` | **populates** it from distinct UTC days of real evidence | "no evidence-based day count exists" — today only on a `manually_asserted` row. **Never "zero days"**: a derived row exists only because there was at least one day of something, so it always carries `activeDays >= 1`. |
| `cap_applied_isk` | **always NULL** | "not yet settled". The column means *whole ISK actually charged after the 450 cap* — a billing outcome produced by settlement, which runs after this. Writing `0` would state the connector was billed nothing, which is a different and false claim. |

---

## 3. Driver activity — every candidate source

| source | what it proves | what it misses | reliable? | pre-Authorize? |
|---|---|---|---|---|
| `reports.session_ledger` (`driver_user_id`) | the driver **charged** in the period | drivers who did not charge but were active by the locked definition | yes | **no** — pre-Authorize sessions are structurally unattributable (ADR 0049 amendment); they carry no driver |
| `charging.sessions` (`user_id`) | the same, one step upstream | same, plus sessions the ledger projection never took | yes | no, same reason |
| **reporting activity** | — | **there is no source. No table, no column, no event.** | n/a | n/a |
| `identity.memberships` (roster) | the driver is *enrolled* | whether they did anything | not a measure of activity | n/a |

### The `source` union

| value | asserts | derived? |
|---|---|---|
| `charging_session` | the driver had a session in the period | **yes** |
| `reporting_access` | the driver used a reporting surface | **no — nothing persists this** |
| `roster_membership` | the driver was on the org's roster | **never** — enrolment is not activity |

Every row this writer produces carries `charging_session`, so a reader can tell
at a glance that the count is the **charging-only lower bound** and not "active
drivers" as the commercial model defines it.

### One-driver-per-org, deliberately

The derivation keys on `(orgId, driverUserId)`. A driver who charges at two
hosts is a billable driver for **each** of them. Collapsing them to one person
would under-bill every host but one, at 50 kr a month each, invisibly.

---

## 4. Where the work runs — the hot-path split (FOCUS rule 7)

Rule 7 puts Drizzle on the control plane and raw SQL on the hot path. This job
straddles them, so it is **split** rather than assigned:

- **Evidence aggregation → raw SQL.** It scans `events.event_log`, the
  highest-volume table in the system, and reduces to one row per
  (connector, day) *inside Postgres*.
- **The upsert → Drizzle.** At most one row per connector per month: small,
  keyed, worth the type safety.

The arithmetic that justifies it:

| | today, 21 chargers | at 4,000 chargers |
|---|---|---|
| connectors | ~42 | ~8,000 |
| sessions / month | < 1,000 (census: 1,619 completed sessions **in total**) | ~120,000 |
| StatusNotification frames / month | ~1e4–5e4 (426 from one site in one day, measured) | ~1e6–1e7 |
| **rows the JS side sees** | **≤ 42** | **≤ 8,000** |

Raw input grows ~200×; derived output grows by ~8,000 rows. Pulling frames into
JS to group them would be a month-long table scan marshalled row by row. This
is why the pure derivation is *specified* to take already-reduced observations:
the expensive reduction can never accidentally migrate into JS.

---

## 5. Upsert semantics

Conflict target: the unique index `(org_id, period_year, period_month,
connector_id)` from `0002`. **That index is the idempotency mechanism** — a
re-run collides rather than duplicating.

**Overwritten on conflict** — recomputed from the same evidence, and a later
run has strictly more of it:
`source`, `session_count`, `active_days`, `charging_station_id` (COALESCE, so a
learned value is not replaced by a null), `last_seen_at` (GREATEST).

**Preserved on conflict:**

- `id` — the row's identity; anything referencing it stays valid.
- `created_at` — when this connector-month was first observed.
- `first_seen_at` — **LEAST** of old and new. A later run over a narrower
  window must not move the start of the month forward.
- **`cap_applied_isk` — the load-bearing one.** Settlement writes it *after*
  this job runs. A routine re-aggregation that reset it to NULL would erase the
  record of what a connector was actually billed, silently, on a table nobody
  watches. It is absent from the `SET` clause, and a test asserts that absence.

`driver_activity_month` has no settled-figure column, so its preserved set is
just `id`, `created_at` and the earliest `first_seen_at`.

---

## 6. Tests

`packages/commercial/src/core-billing/activity-month.test.ts` — 25, on the pure
derivation: empty period; one connector one session; **one connector zero
sessions**; both evidence kinds; mid-period activation; mid-period
deactivation; connector moved between stations; a null station id filled later;
two orgs not mixing; one connector under two orgs throwing; out-of-period
observations counted not swallowed; period boundaries start-inclusive
end-exclusive; `manually_asserted` never derived; an explicit assertion with
`activeDays` null; determinism under shuffled evidence; multiple sessions on
one connector; `capAppliedIsk` never populated; a period containing
pre-Authorize sessions. Plus 7 driver cases.

`apps/api/src/repositories/activity-month.test.ts` — 19, on what the repository
adds: in-scope writes; platform writes; **out-of-scope throws rather than
writing nothing quietly**; empty allow-list throws; no evidence writes nothing;
out-of-period reported; the conflict target has four columns; **`capAppliedIsk`
absent from the SET**; the overwrite set is exactly the recomputable six;
LEAST/GREATEST on the timestamps; identical evidence produces an identical
payload; more evidence produces larger counts; reads are scoped too.

**Fool test:** `assertOrgInScope` made a no-op → **4 of 19 failed**. Restored.
