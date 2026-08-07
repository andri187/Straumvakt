# ADR 0049 — The CDR is the record; OCPI 2.2.1 is its shape

**Status:** Proposed · 2026-08-07
**Relates to** [ADR 0048](./0048-billing-cutover-resolved-agreements-survives.md)
(which settled *which* pricing generation survives; this settles *where the
result lives*) and [ADR 0012](./0012-protocol-neutral-physical-model.md).

---

## Context

`charging.sessions` has 46 columns and is treated as a Charge Detail Record.
Audited against staging on 2026-08-07, it is not one: it is a thin fact row
with three redundant energy feeds bolted on, a single blended cost number,
and eleven columns that have never held a value.

Everything below is measured, not inferred.

## What is actually in a CDR today

**1,619 completed sessions on staging.**

| group | fill |
|---|---|
| charger / EVSE / site / org FKs, `started_at`, `ended_at`, `energy_wh`, `stop_reason` | 100% |
| `cdr_energy_kwh` / `cdr_stopped_at` (Zaptec REST) | 69% |
| `ocpp_energy_kwh` / `ocpp_stopped_at` (our gateway) | 3.6% |
| `amqp_energy_kwh` (Service Bus) | **0%** |
| `cost_ex_vat_minor` / `cost_inc_vat_minor` | 97% |
| OCMF block (7 columns) | 6.8% |
| `id_tag` | 5.5% |
| `user_id` | **0.5%** |
| `auth_id_*` (5), `ev_plc_*` (3), `pnc_*` (3) | **~0%** |

## Five findings

### F1. The three energy feeds are one fact measured three ways, and they disagree

`ocpp_*`, `cdr_*` and `amqp_*` each carry exactly energy + stop-time. Nothing
else. `enrichment-drift.ts` exists solely to warn when they diverge.

| comparison | both present | agree | **disagree** | worst |
|---|---:|---:|---:|---:|
| energy, tol 0.05 kWh | 49 | 45 | **4 (8%)** | **12.105 kWh** |
| stop time, tol 30 s | 49 | 43 | **6 (12%)** | **57,794 s ≈ 16 h** |

**Only 49 of 1,619 sessions carry two comparable sources.** The reconciliation
layer is blind on 97% of the data, and where it can see, it disagrees.

`amqp_energy_kwh` has one writer that has never fired. Per
[the parking note](../notes/2026-08-03-park-the-azure-bus.md), StateId 723
delivered zero messages in three months.

### F2. 1,497 signed OCMF envelopes are held but unparsed

| | |
|---|---:|
| `imported_cdr_refs` rows holding a `SignedSession` | **1,607** |
| parsed onto the session | 110 |
| **available, never extracted** | **1,497** |

Including **56 of the 64 billable `EE43C609263CC7` sessions** — the ones that
now carry billing lines. The signed record of the only revenue in the system
is present and unread.

`charging.imported_cdr_refs` is `ON DELETE CASCADE` from `charging.sessions`.
**Deleting a session destroys its signed envelope.** Any purge of test data
must run the OCMF backfill first; it is idempotent.

### F3. The connector state machine is captured and thrown away

`events.event_log` holds 4,438 `ocpp.raw.StatusNotification` frames since
2026-05-03:

| status | frames | meaning |
|---|---:|---|
| `Available` | 2,903 | unplugged |
| `Charging` | 555 | drawing |
| `Preparing` | 386 | **plugged, not charging** |
| `SuspendedEV` | 374 | **plugged, car stopped** |
| `SuspendedEVSE` | 189 | plugged, charger stopped |
| `Faulted` | 31 | |

`onOcppRawStatusNotification` writes only to `connectors.status` — the current
value, overwritten on every frame. Nothing lands on the session.

So **plug-in time, plug-out time, charge time and connected-not-charging time
are all reconstructible back to May** and none of them exist as data. This is
the missing basis for any plugtime or idle-penalty fee: `RATE_BASES` already
has `per_minute`, but it would currently measure session duration, not
parking duration.

Zaptec's REST CDR cannot supply this — its payload is `StartDateTime`,
`EndDateTime`, `CommitEndDateTime`, `Energy`, `EnergyDetails`,
`SignedSession`. Plug events are OCPP-only, and we have them.

### F4. Two pricing paths compute the same money and differ 39% of the time

Measured on the test branch over the 64 sessions that now have agreements
billing lines:

| | |
|---|---:|
| priced by both paths | 57 |
| agree | 35 |
| **disagree** | **22 (39%)** |
| legacy `sessions.cost_inc_vat_minor` total | 18,901.04 ISK |
| `agreements.billing_lines` total | 19,264.97 ISK |
| **gap** | **363.93 ISK (1.9%)** |

There is no constraint tying them. This is the CO-3 comparison ADR 0048
step 2 made a hard go-gate, and it fails.

### F5. Location is a foreign key, so history rewrites itself

The CDR references `site_id`, `charging_station_id`, `evse_id`. Rename a site,
re-address a property or move a charger and **every historical CDR silently
changes**. A settlement record whose contents depend on today's asset table is
not evidence.

## Decision

**The CDR is the transaction's record of truth, and its shape is OCPI 2.2.1.**

Four consequences, in order of dependency:

1. **The CDR carries a snapshot, not references.** Location — postal address,
   city, postcode, coordinates, `evse_uid`, connector standard/format/power
   type — is copied onto the record at close and frozen, per OCPI
   `cdr_location`. Same for tariff identifiers.
2. **The CDR carries its own time.** `connected_at` and `disconnected_at`
   projected from `event_log`, plus `total_time`, `total_charging_time` and
   `total_parking_time`. One `timestamptz` per instant remains the source of
   truth; a **stored generated** date column serves period grouping. Date and
   time are not authored as separate columns — two writable columns can
   disagree, and F1 shows what that costs.
3. **The breakdown hangs off the CDR, not beside it.** `agreements.billing_lines`
   become the CDR's charging periods — child rows that MUST sum to the parent
   total, enforced. OCPI's `CdrDimension` vocabulary (`ENERGY`, `TIME`,
   `PARKING_TIME`, `FLAT`, `MAX_CURRENT`, `STATE_OF_CHARGE`, …) is the
   cost-factor axis. The second, independent cost path in
   `sessions.cost_*_minor` retires once they reconcile.
4. **Identity follows OCPP; attestation follows OCMF.** The canonical field is
   OCPP 2.0.1's `IdToken { idToken, type }` with its closed vocabulary
   (`ISO14443`, `ISO15693`, `eMAID`, `EVCCID`, `MacAddress`, `KeyCode`,
   `Local`, `Central`, `DirectPayment`, `NoAuthorization`). The `auth_id_*`
   columns stay alongside it — they are **OCMF** fields (`IS`/`IL`/`IT`/`ID`/`IF`,
   SAFE e.V.), and they answer a different question: not *who we think
   charged* but *what the meter cryptographically attested*. In a dispute only
   the second counts. They coexist; they do not merge.

## Where the standards stop

OCPP is charger↔CPO and deliberately thin on commerce — OCPP 1.6's
`StopTransaction` gives `meterStop`, `timestamp`, `reason`, `idTag` and
nothing more. OCPI is CPO↔eMSP and is the CDR and tariff standard.

**Neither models what Straumvakt sells.** OCPI assumes the CPO owns the tariff
and settles with an eMSP. The DSO/retailer pass-through — Veitur's grid fee
and N1 Rafmagn's energy price as separate bearers with independent recipients
and markup — has no OCPI equivalent.

So OCPI supplies the CDR envelope and the dimension vocabulary; `agreements`
remains the resolution engine (ADR 0019, ADR 0048); the mapping to OCPI's
tariff object happens **on export**, not by bending the model inward.

## Columns with no standard behind them

| block | origin | status |
|---|---|---|
| `auth_id_*` (5) | OCMF spec | real standard, keep — see decision 4 |
| `ev_plc_*` (3) | Zaptec StateId 953, vendor-proprietary | 0 rows; the Autocharge drop, parked |
| `pnc_*` (3) | ours — no protocol defines these names | 0 rows; we do not terminate ISO 15118 |
| `amqp_energy_kwh` | Service Bus | 0 rows, writer never fires; bus parked |
| `completed_session_raw_json` | AMQP 723 | 0 rows |
| `ocmf_blob_ref` | AMQP 723 | 0 rows |

Not dropped by this ADR. Named so the next audit does not re-derive them.

## Sequencing

1. **Backfill the 1,497 OCMF envelopes** (F2). Idempotent, and they are
   destroyed by any session delete — so this precedes any purge.
2. **Then** decide the fate of the 1,530 unattributable sessions.
3. Project `connected_at` / `disconnected_at` and the three durations from
   `event_log` (F3).
4. Snapshot location onto the CDR (F5).
5. Reconcile and retire the second cost path (F4) — this is CO-3, and Rule 5.

Steps 3–5 are schema migrations against a database 21 chargers write to
continuously. Each needs explicit go-ahead; none is pre-authorised.

## What this does not decide

Whether the fourth billing scaffold survives (ADR 0048 D3), where
`agreements.installation_id` points (ADR 0047 D2), and whether the parked
Autocharge and OpenADR work resumes. All out of scope.
