# Auth-enforcement period labelling — discovery, and why it stops here

**2026-08-08 · read-only · no schema change, no backfill, nothing written.**

## What this is for

For an earlier period, OCPP Authorize was disabled at the Zaptec portal and
the installation did not require authorization. **This is a known historical
operating configuration, not a defect and not an incident.** Its practical
consequence is that sessions from that period will never carry driver
attribution — by design.

Today nothing on a session distinguishes *"attribution is absent because it
was structurally impossible"* from *"attribution is absent because something
is broken."* So the thin-CDR observation keeps being rediscovered and
re-diagnosed as if it were an open question. A label would end that.

**Step 1 was to find a reliable cutover date. There isn't one.** Details below,
so this is not re-searched either.

---

## What was checked, and what it holds

| Source | Holds a config-change history? | What it actually is |
|---|---|---|
| `audit.actions` (23 rows, 2026-04-26 → 07-22) | **No** | 10 distinct actions; **none records an `enforce_authorize` change.** The 7 installation-targeted rows are `zaptec.import` and `installation.ocpp_password.{rotate,disable}` — the OCPP *connection password*, a different concern from Authorize enforcement. No row's metadata mentions `enforceAuthorize`. |
| `properties.installations.enforce_authorize` | **No** | Current state only — `false` on both installations. A boolean column with no history table and no trigger. |
| `assets.charging_stations.vendor_auth_required` · `vendor_authentication_type` | **No** | Current state as last observed. Mixed values across the 31 stations (`false`/`true`, `0`/`2`) but nothing says *when* any of them changed. |
| `assets.charging_stations.vendor_auth_seen_at` | **No** | **All 21 non-null values are 2026-08-08 — today.** It is a *last-observed* stamp written by the sync cron, not a *changed-at* stamp. It is overwritten on every poll, so it can never carry history. |
| `events.event_log` | **No** | The only auth-related type is `ocpp.raw.Authorize` (20 frames) — those are authorization *attempts*, i.e. session data. |
| `ocpp.configuration_keys` | **No** | Dropped 2026-08-07. **It held 0 rows and had no writers** — see below. |
| `reports.command_history` | **No** | Dropped 2026-08-07. **0 rows, no writers.** |
| Zaptec portal config-change record | **Not in this database** | Would live vendor-side. `imported_cdr_refs.raw_payload` carries charging records only — no auth configuration. |

### On the two dropped tables

`ocpp.configuration_keys` and `reports.command_history` were dropped in the
32-table cull on 2026-08-07. **Neither destroyed evidence:** both were measured
at **0 rows with no writers in code** before the drop — they had never
recorded anything. `configuration_keys` was intended to hold
GetConfiguration/ChangeConfiguration round-trips; nothing ever wrote to it.

Worth stating plainly because it is the obvious next question, and the answer
is not "we lost it" — it is "it was never captured."

---

## Why no date was inferred

Session-data patterns were **not** used to derive a cutover, deliberately. A
change in when `id_tag` starts appearing is consistent with several causes —
an enforcement change, a firmware change, a driver changing habits, a charger
being re-provisioned — and a label whose provenance is "we guessed from the
shape of the data" is worse than no label. It would look authoritative and be
unfalsifiable.

---

## What needs operator confirmation before step 2

Two installations. Both currently `enforce_authorize = false`.

| Installation | id | Chargers | Completed sessions | Session range | with `user_id` | with `id_tag` |
|---|---|---:|---:|---|---:|---:|
| **Dalvegur 10 - 14** | `37de71e8-10bc-458e-ab5d-164eaccd75e6` | 30 | 1,616 | 2026-05-04 → 08-07 | 8 | 64 |
| **Reykjavík HQ** | `aa7addb2-d7c1-4df3-9ac9-66d6d0fd0c6e` | 1 | 24 | 2026-05-31 → 08-03 | 0 | 16 |

*The session counts are **scope**, not evidence — they say how many rows a
backfill would touch, not when anything changed.*

**For each installation, please confirm:**

1. **The date (or datetime) Authorize enforcement changed**, if it ever did —
   and in which direction. If it has been not-enforced for the entire period
   these sessions cover, say so; "the whole range" is a complete answer and
   the simplest one to backfill.
2. **Whether there was more than one period** — e.g. enabled, then disabled,
   then enabled. If yes, the schema needs the `installation_auth_period` table
   rather than a single boolean on the session, and I need each boundary.
3. **Where the date comes from** — Zaptec portal audit view, a support ticket,
   an email, or recollection. This gets recorded verbatim in the note; the
   provenance is part of the deliverable and "operator recollection" is a
   perfectly acceptable answer as long as it says so.

---

## Shape once a date exists (not built)

- **Single period per installation** → one nullable boolean on the session
  row, e.g. `auth_enforcement_known boolean`, meaning *"we know authorization
  was not enforced when this session ran."* NULL = not determined.
- **Multiple periods** → `properties.installation_auth_period`
  (`installation_id`, `from`, `to` nullable, `enforced boolean`, `source
  text`), and the session label derived from it at backfill time.

Either way: **descriptive metadata only.** It does not touch `bearer_type`,
rates, `bearer_rules`, the ledger, or any resolver path. Delivered as a
`db:generate:sql` migration, reviewed before applying. `drizzle-kit push`
remains banned.

---

## Follow-up question — NOT decided here

Once the label exists, something has to decide what consumes it. That is a
**Rule 5 decision** and is deliberately left open:

- Should auth-not-enforced sessions be **excluded from attribution-
  completeness metrics**, so "0.5% attributed" stops reading as a failure when
  most of the denominator could never have been attributed?
- Should they be **explicitly ineligible** for agent-line generation, rather
  than sitting as "unresolved" forever in the tick's candidate set?

Both change what the billing path does with a class of sessions. Neither is
decided in this pass, and this pass writes no code that reads the label.

---

## Status

**Stopped at step 1.** No schema change, no migration, no backfill, no
behaviour change. Nothing was written to any database.

Resumes the moment the dates in the table above are confirmed.
