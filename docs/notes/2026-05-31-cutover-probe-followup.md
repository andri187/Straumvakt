# Cutover Probe Follow-Up — CO-1 Findings

**Date:** 2026-05-31
**Sprint:** Sprint 9 — cutover A.10 prep
**Probe script:** `apps/api/scripts/probe-cutover-followup.ts`
**Prior probe:** `apps/api/scripts/probe-billing-cutover.ts`

---

## Summary

Three unknowns from the billing cutover discovery probe are now resolved. Each section below states the finding and its implication for the CO-2 migration script.

---

## Q1. The 2 existing `agreements.agreements` rows

Both rows are `agreement_type = installation`, status `active`, counterparty = **N1 ehf**, `cpo_org_id = null`. Neither has clauses, bearer_rules, or a `default_driver_group_id`. Both are pre-A.10 scaffolding created manually when Dalvegur and the VCP Lab sandbox went live.

| Agreement | Installation | Created |
|---|---|---|
| Dalvegur 10-14 — N1 driver access (pilot) | Dalvegur 10 - 14 | 2026-05-09 |
| VCP Lab — N1 driver access (sandbox) | VCP Lab | 2026-05-10 |

**Key observations:**

- Both have `clauses: 0`, `bearer_rules: 0`. They are bare-access stubs with no pricing logic.
- `default_driver_group_id` is `null` on both despite each having 1 driver_group linked by `agreement_id`. The FK is the child pointing up, not a pointer down. A.10 should populate `default_driver_group_id` as part of the cutover.
- No `cpo_org_id`. ADR 0019 says `cpo_org_id` is required for `service_cpo` type; for `installation` type the counterparty IS the access beneficiary, so this is correct.

**CO-2 recommendation:** Do NOT drop-and-recreate. These rows are the right structure. A.10 should **UPDATE** them: add `agreement_clauses` rows (ELE, DSO at minimum for pilot scope), set `default_driver_group_id` to the linked driver group, and potentially add `cpo_org_id` if Straumvakt itself is the CPO org. The existing `agreement_id` FK on both driver groups makes them easy to resolve.

---

## Q2. `agreements.cost_factors` — actual schema and codes

**Column discovery:** There is no `anchor_tier` column. The prior probe's column list (`probe-billing-cutover.ts` §3) was wrong — it assumed a column that doesn't exist. The actual 8 columns are: `id`, `code`, `display_name_is`, `display_name_en`, `description`, `status`, `created_at`, `updated_at`.

**17 rows, all status=active:**

| Code | English name |
|---|---|
| AGN | Per-agent (contractor) |
| CNR | Per-connector |
| DSO | DSO grid fee |
| ELE | Retailer energy |
| IDL | Idle power loss |
| INT | Price per installation |
| MTR | E-meter daily fee |
| NET | Internet / SIM cost |
| PRM | Premium user fee |
| RNT | Charger rental |
| RVN | % of kWh charges |
| SRF | Service line item |
| TRF | Idle / extra tariff (generic umbrella) |
| TRF_CHG | Charge-time fee |
| TRF_IDLE | Idle-time fee |
| USRF | Per-user-on-installation |
| WRK | Workplace service fee |

**Code overlap analysis:**

- **Legacy codes missing from new catalogue (7):** DSOF, REPF, USRF_PREM, XTRRF, SPVIVF, CHRGRF, WRKPF — these are fully superseded. ADR 0019 §Supersedes documents the intentional break.
- **Pilot-scope codes missing from new catalogue (1):** `TRF_PLUG`. This code is referenced in `pilot-scope.ts` but has no row in `agreements.cost_factors`. Either it was intentionally dropped (superseded by TRF_CHG / TRF_IDLE split on 2026-05-09) or it needs to be seeded. The TRF generic umbrella row notes it was "superseded by TRF_CHG / TRF_IDLE for clause use (2026-05-09 addendum)" — `TRF_PLUG` should be treated as the same class of superseded code. The pilot-scope.ts PILOT_FACTOR_CODES array should be updated to remove `TRF_PLUG` and the TRF umbrella should not appear in new clauses either.
- **New codes not in pilot-scope.ts (10):** AGN, CNR, IDL, NET, PRM, RNT, RVN, SRF, TRF, WRK — these are post-pilot codes, correctly gated by the `PILOT_FACTOR_CODES` array.

**CO-2 recommendation:** No catalogue changes needed before the migration. The 17 rows are complete and correct. Update `pilot-scope.ts` to remove `TRF_PLUG` from `PILOT_FACTOR_CODES` (it was superseded; using it in a new clause would reference a nonexistent code). For session-stop migration, the pilot clauses to create are: `ELE`, `DSO`, `MTR`, `USRF`, `INT` — all exist in the new catalogue.

---

## Q3. Duplicate "N1 Drivers" DriverGroup

Both groups are **linked to distinct agreements** (one per installation) and contain **the same single member** (`n1@n1.is`). Neither is an orphan.

| Group ID | Agreement | Installation | Member |
|---|---|---|---|
| 4b2b358f | Dalvegur 10-14 (pilot) | Dalvegur 10 - 14 | n1@n1.is |
| 7820a970 | VCP Lab (sandbox) | VCP Lab | n1@n1.is |

**Finding:** This is NOT a duplicate to merge. It is a **correct 1:1 pattern** — one DriverGroup per Agreement, scoped to that installation. The same user (n1@n1.is) is in both because they are the single N1 test driver. The groups have different `agreement_id` FKs, so they are semantically distinct.

The display_name collision ("N1 Drivers") is cosmetic. Both will remain once A.10 adds real clause data.

**CO-2 recommendation:** No action needed on either DriverGroup. Do NOT merge or drop. When A.10 sets `default_driver_group_id` on each Agreement, each should point to its own linked group (Dalvegur Agreement → 4b2b358f, VCP Agreement → 7820a970).

---

## CO-2 migration script safe pattern

Based on the three findings above:

1. **UPDATE existing Agreements** (not drop-and-recreate): set `default_driver_group_id` for each, add `agreement_clauses` for pilot factor codes (ELE, DSO, MTR, USRF, INT).
2. **No catalogue changes** to `agreements.cost_factors` — 17 rows are correct. Update `pilot-scope.ts` to remove `TRF_PLUG`.
3. **Leave both DriverGroups intact** — they are correct. Populate `default_driver_group_id` on each Agreement to point down to its existing group.
4. The Dalvegur Agreement (id=213265ec) maps to installation id=37de71e8 and group id=4b2b358f.
5. The VCP Agreement (id=b6771541) maps to installation id=0909cff6 and group id=7820a970.

---

## Probe output

```
═══════════════════════════════════════════════════════════════════
  CUTOVER FOLLOW-UP PROBE — 3 open questions (CO-1)
═══════════════════════════════════════════════════════════════════

┌─ Q1. Existing agreements.agreements rows
──────────────────────────────────────────────────────────────────
     Found 2 agreement(s):

     ── Agreement 213265ec-c083-4812-88d8-0f03ddfe6698
        agreement_type:    installation
        display_name:      Dalvegur 10-14 — N1 driver access (pilot)
        status:            active
        counterparty_org:  N1 ehf (id=b9f6a897-2401-45a3-9cde-b89d32fdb326)
        cpo_org:           (none) (id=null)
        installation:      Dalvegur 10 - 14 (id=37de71e8-10bc-458e-ab5d-164eaccd75e6)
        default_dg_id:     null
        effective_from:    2026-05-09T23:54:43.658Z
        effective_until:   (open)
        notes:             Pilot access pre-A.10 — bare access, no clauses. Default tag EE43C609263CC7 routes plug-ins to N1 Drivers User for billing attribution. (2026-05-09 addendum / A.11)
        clauses:           0
        bearer_rules:      0
        driver_groups:     1

     ── Agreement b6771541-a4c5-4c8c-8558-4041a34c7335
        agreement_type:    installation
        display_name:      VCP Lab — N1 driver access (sandbox)
        status:            active
        counterparty_org:  N1 ehf (id=b9f6a897-2401-45a3-9cde-b89d32fdb326)
        cpo_org:           (none) (id=null)
        installation:      VCP Lab (id=0909cff6-6a19-490d-b53b-b36204dfecc7)
        default_dg_id:     null
        effective_from:    2026-05-10T10:37:49.658Z
        effective_until:   (open)
        notes:             VCP Lab — N1 driver test access. Default tag STRMV-VCP-TEST-001 routes plug-ins to N1 Drivers User for billing attribution. Sandbox install; not customer-facing.
        clauses:           0
        bearer_rules:      0
        driver_groups:     1

     Raw JSON dump:
     {"id":"213265ec-c083-4812-88d8-0f03ddfe6698","agreement_type":"installation","display_name":"Dalvegur 10-14 — N1 driver access (pilot)","status":"active","counterparty_org_id":"b9f6a897-2401-45a3-9cde-b89d32fdb326","counterparty_org":"N1 ehf","cpo_org_id":null,"cpo_org":null,"installation_id":"37de71e8-10bc-458e-ab5d-164eaccd75e6","installation":"Dalvegur 10 - 14","default_driver_group_id":null,"effective_from":"2026-05-09T23:54:43.658Z","effective_until":null,"notes":"Pilot access pre-A.10 — bare access, no clauses. Default tag EE43C609263CC7 routes plug-ins to N1 Drivers User for billing attribution. (2026-05-09 addendum / A.11)","clause_count":0,"rule_count":0,"group_count":1}
     {"id":"b6771541-a4c5-4c8c-8558-4041a34c7335","agreement_type":"installation","display_name":"VCP Lab — N1 driver access (sandbox)","status":"active","counterparty_org_id":"b9f6a897-2401-45a3-9cde-b89d32fdb326","counterparty_org":"N1 ehf","cpo_org_id":null,"cpo_org":null,"installation_id":"0909cff6-6a19-490d-b53b-b36204dfecc7","installation":"VCP Lab","default_driver_group_id":null,"effective_from":"2026-05-10T10:37:49.588Z","effective_until":null,"notes":"VCP Lab — N1 driver test access. Default tag STRMV-VCP-TEST-001 routes plug-ins to N1 Drivers User for billing attribution. Sandbox install; not customer-facing.","clause_count":0,"rule_count":0,"group_count":1}

──────────────────────────────────────────────────────────────────
┌─ Q2. agreements.cost_factors — actual columns + all rows
──────────────────────────────────────────────────────────────────

     Columns (8):
       column_name                    data_type
       id                             uuid
       code                           text
       display_name_is                text
       display_name_en                text
       description                    text
       status                         USER-DEFINED
       created_at                     timestamp with time zone
       updated_at                     timestamp with time zone

     All rows (17):

     id="f602bd8c-d7af-461d-9c85-011822c5483f"  code="AGN"  display_name_is="Per Contractor Agent access"  display_name_en="Per-agent (contractor)"  description="Per-agent access fee Straumvakt invoices a contractor. Lives on a service_contractor agreement."  status="active"  created_at="2026-05-08T18:10:18.521Z"  updated_at="2026-05-09T23:41:11.991Z"
     id="5f0342a0-0573-40db-a6c4-fe7bcb47d872"  code="CNR"  display_name_is="Tenglagjald"  display_name_en="Per-connector"  description="Per-connector fee Straumvakt invoices the CPO. Lives on a service_cpo agreement."  status="active"  created_at="2026-05-08T18:10:18.521Z"  updated_at="2026-05-09T23:41:11.811Z"
     id="fb48851b-a9c3-4203-b208-25e522a09c01"  code="DSO"  display_name_is="Dreifing"  display_name_en="DSO grid fee"  description="Distribution-system-operator grid fee. Pass-through to the DSO (Veitur, Norðurorka, RARIK). Bound to the DSO rate table."  status="active"  created_at="2026-05-08T18:10:18.521Z"  updated_at="2026-05-09T23:41:12.110Z"
     id="d953db81-8397-47be-b936-afd9ac15fc55"  code="ELE"  display_name_is="Rafmagn"  display_name_en="Retailer energy"  description="Electricity commodity price from the retailer. Pass-through. Bound to the electricity rate table."  status="active"  created_at="2026-05-08T18:10:18.521Z"  updated_at="2026-05-09T23:41:12.171Z"
     id="b2da307a-5cf9-453b-8195-abf30f999340"  code="IDL"  display_name_is="Idlepower"  display_name_en="Idle power loss"  description="Difference between the electrical bill and kWh charged. MDU only — CPO can split with dwellers via Allocation. Null on workplace installations."  status="active"  created_at="2026-05-08T18:10:18.521Z"  updated_at="2026-05-09T23:41:12.531Z"
     id="b0d44d24-4fc8-4fb4-afd8-b2cffe406dc0"  code="INT"  display_name_is="Hleðslukerfagjald"  display_name_en="Price per installation"  description="Flat per-installation fee Straumvakt invoices the CPO. Lives on a service_cpo agreement."  status="active"  created_at="2026-05-08T18:10:18.521Z"  updated_at="2026-05-09T23:41:11.675Z"
     id="78e49c48-889e-4889-9625-07eb2ea03bb8"  code="MTR"  display_name_is="Mælagjald"  display_name_en="E-meter daily fee"  description="Daily fee the DSO charges for the e-meter on the installation. Pass-through. Default bearer ORG (CPO); CPO can split with USR."  status="active"  created_at="2026-05-08T18:10:18.521Z"  updated_at="2026-05-09T23:41:12.234Z"
     id="f42653f7-600a-458d-b81f-6a5952e99d3b"  code="NET"  display_name_is="Internet"  display_name_en="Internet / SIM cost"  description="Cost of internet / 4G modem + SIM at the installation. MDU only. Null on workplace installations."  status="active"  created_at="2026-05-08T18:10:18.521Z"  updated_at="2026-05-09T23:41:12.591Z"
     id="c9ad6ecc-c37d-4d8d-8aa6-d1bc93bd23ff"  code="PRM"  display_name_is="Premium"  display_name_en="Premium user fee"  description="Premium user fee. Straumvakt revenue. Lives on service_cpo agreements; CPO chooses absorb or forward."  status="active"  created_at="2026-05-08T18:10:18.521Z"  updated_at="2026-05-09T23:41:11.938Z"
     id="6b350f0d-2da6-46e8-aa6d-1f6d806d50bb"  code="RNT"  display_name_is="Leiga"  display_name_en="Charger rental"  description="Hardware-rental fee when the charger is rented rather than owned. Default bearer ORG (CPO)."  status="active"  created_at="2026-05-08T18:10:18.521Z"  updated_at="2026-05-09T23:41:12.298Z"
     id="1829c196-54d1-4d49-9f87-f6a136292ef7"  code="RVN"  display_name_is="Veltutengd gjöld"  display_name_en="% of kWh charges"  description="Percent of kWh-priced charges (= pct × kWh × (ELE_rate + DSO_rate)). Lives on service_cpo and service_contractor agreements."  status="active"  created_at="2026-05-08T18:10:18.521Z"  updated_at="2026-05-09T23:41:11.877Z"
     id="9b312e40-4290-40f5-9627-a8dbc55e53ea"  code="SRF"  display_name_is="Þjónustugjald"  display_name_en="Service line item"  description="Service work line item raised by the issues engine. Sum of contractor service costs; Straumvakt takes 5% RVN on each service invoice. Non-session billable_event_type = service_invoice."  status="active"  created_at="2026-05-08T18:10:18.521Z"  updated_at="2026-05-09T23:41:12.653Z"
     id="07396700-295d-4cce-8cb6-8b82b6df5ffc"  code="TRF"  display_name_is="Álag"  display_name_en="Idle / extra tariff"  description="Per-minute idle fees, surge pricing, etc. CPO-set. Generic umbrella — superseded by TRF_CHG / TRF_IDLE for clause use (2026-05-09 addendum)."  status="active"  created_at="2026-05-08T18:10:18.521Z"  updated_at="2026-05-09T23:41:12.361Z"
     id="942f1b74-3ad4-4035-ba16-a6af98aee813"  code="TRF_CHG"  display_name_is="Hleðslutímagjald"  display_name_en="Charge-time fee"  description="Per-minute fee while the car is actively drawing power. CPO-set. Bearer USR."  status="active"  created_at="2026-05-09T23:41:12.421Z"  updated_at="2026-05-09T23:41:12.421Z"
     id="f9307574-be98-4a15-8722-213fcb0a566c"  code="TRF_IDLE"  display_name_is="Biðtímagjald"  display_name_en="Idle-time fee"  description="Per-minute fee while the car is plugged in but not drawing. CPO-set. Bearer USR. Doubles as the SOC-cap proxy."  status="active"  created_at="2026-05-09T23:41:12.472Z"  updated_at="2026-05-09T23:41:12.472Z"
     id="6fa789f7-409c-47e0-8a4c-fe1c303aa3cf"  code="USRF"  display_name_is="Notendagjald"  display_name_en="Per-user-on-installation"  description="Per-user-on-installation fee Straumvakt invoices the CPO. CPO can absorb or forward to drivers. Lives on a service_cpo agreement."  status="active"  created_at="2026-05-08T18:10:18.521Z"  updated_at="2026-05-09T23:41:11.737Z"
     id="968ea53c-8724-4f1d-aac7-1c55abedd2c3"  code="WRK"  display_name_is="Vinnan"  display_name_en="Workplace service fee"  description="Per workplace-covered driver per month. Once per workplace (not duplicated per CPO the workplace covers them at). Lives on a service_workplace agreement."  status="active"  created_at="2026-05-08T18:10:18.521Z"  updated_at="2026-05-09T23:41:12.046Z"

     Code overlap analysis:
       Legacy codes (billing.cost_factors, 8 codes): DSOF, REPF, USRF, USRF_PREM, XTRRF, SPVIVF, CHRGRF, WRKPF
       Pilot codes  (pilot-scope.ts, 8 codes):        USRF, INT, DSO, MTR, ELE, TRF_CHG, TRF_IDLE, TRF_PLUG
       New codes    (agreements.cost_factors, 17 codes): AGN, CNR, DSO, ELE, IDL, INT, MTR, NET, PRM, RNT, RVN, SRF, TRF, TRF_CHG, TRF_IDLE, USRF, WRK

       Legacy codes NOT in new catalogue:  DSOF, REPF, USRF_PREM, XTRRF, SPVIVF, CHRGRF, WRKPF
       Pilot codes  NOT in new catalogue:  TRF_PLUG
       New codes    NOT in legacy:          AGN, CNR, DSO, ELE, IDL, INT, MTR, NET, PRM, RNT, RVN, SRF, TRF, TRF_CHG, TRF_IDLE, WRK
       New codes    NOT in pilot-scope.ts:  AGN, CNR, IDL, NET, PRM, RNT, RVN, SRF, TRF, WRK

──────────────────────────────────────────────────────────────────
┌─ Q3. Duplicate DriverGroup investigation
──────────────────────────────────────────────────────────────────

     All DriverGroups (2):

     ── DriverGroup 4b2b358f-fb81-4b1b-8417-bee6f54e1dc9
        display_name:   N1 Drivers
        owner_org:      N1 ehf (id=b9f6a897-2401-45a3-9cde-b89d32fdb326)
        agreement_id:   213265ec-c083-4812-88d8-0f03ddfe6698
        agreement_type: installation
        created_at:     2026-05-09T23:54:43.658Z
        members:        1
        member_emails:  n1@n1.is

     ── DriverGroup 7820a970-3456-4c38-bd6a-986429fbd26a
        display_name:   N1 Drivers
        owner_org:      N1 ehf (id=b9f6a897-2401-45a3-9cde-b89d32fdb326)
        agreement_id:   b6771541-a4c5-4c8c-8558-4041a34c7335
        agreement_type: installation
        created_at:     2026-05-10T10:37:49.588Z
        members:        1
        member_emails:  n1@n1.is

     Duplicate (display_name + owner_org) pairs:

     display_name="N1 Drivers" owner_org_id=b9f6a897-2401-45a3-9cde-b89d32fdb326
       rows: 2
       ids:  4b2b358f-fb81-4b1b-8417-bee6f54e1dc9, 7820a970-3456-4c38-bd6a-986429fbd26a
       agreement_ids: 213265ec-c083-4812-88d8-0f03ddfe6698, b6771541-a4c5-4c8c-8558-4041a34c7335
       member_emails per group: n1@n1.is / n1@n1.is

       FINDING: Same user (n1@n1.is) in both groups — MERGE by keeping one, dropping the other

═══════════════════════════════════════════════════════════════════
```

*(Note: The probe's automated FINDING text says "MERGE" because both groups contain the same email. This is misleading — see Q3 analysis above. The correct interpretation is that each group is correctly scoped to its own Agreement/Installation; the "merge" signal fires on email equality alone. Do NOT merge.)*
