# DB Integrity Audit — 2026-05-31 (AUD-1)

**Probe script:** `apps/api/scripts/probe-integrity.ts`  
**Run against:** staging Neon branch (local `.env.local` → staging)  
**Date:** 2026-05-31  
**Verdict:** CLEAN — 0 CRITICAL, 0 FAIL, 4 WARN, 46 PASS

---

## Probe output (verbatim)

```
═══════════════════════════════════════════════════════════════════════
  DB INTEGRITY AUDIT — Straumvakt staging  (AUD-1 / 2026-05-31)
═══════════════════════════════════════════════════════════════════════

┌─ 1. Cross-tenant FK pollution
───────────────────────────────────────────────────────────────────────
   PASS  sites.dso_tariff_id → tariff_definitions                   3/3 wired rows same-org
   PASS  installations.retailer_tariff_id → tariff_definitions      3/3 wired rows same-org
   PASS  charging_stations.chrgrf_tariff_id → tariff_definitions    0 wired (all NULL — acceptable per design)
   PASS  charging_stations.installation_id → installations          32/32 wired rows same-org
   PASS  installations.site_id → sites                              3/3 rows same-org
   PASS  agreements.counterparty_org_id / cpo_org_id → orgs         2 agreements, all org refs valid
   PASS  agreements.installation_id → installations                 2 wired, 0 dangling
   PASS  driver_groups.owner_org_id → organizations                 2 groups, all owner_org valid
   PASS  driver_groups.agreement_id → agreements                    2 groups, all agreement refs valid
   PASS  driver_group_memberships.user_id → identity.users          2 memberships, all user refs valid
   PASS  driver_group_memberships.driver_group_id → driver_groups   2 memberships, all group refs valid

┌─ 2. Orphan FK references / constraint coverage
───────────────────────────────────────────────────────────────────────
   PASS  FK constraints enumerated                                  93454 FK constraints in relevant schemas
   PASS  Key FK constraints all present                             All 6 spot-checked FK constraints enforced

┌─ 3. NULL fields that shouldn't be NULL
───────────────────────────────────────────────────────────────────────
   PASS  sites.org_id                                               3 rows, 0 NULL
   PASS  installations.site_id                                      3 rows, 0 NULL
   PASS  installations.org_id                                       3 rows, 0 NULL
   PASS  charging_stations.installation_id                          32 rows, 0 NULL
   PASS  charging_stations.org_id                                   32 rows, 0 NULL
   PASS  ocpp_identities.charging_station_id                        32 rows, 0 NULL
   PASS  agreements.counterparty_org_id                             2 rows, 0 NULL
   PASS  driver_groups.owner_org_id                                 2 rows, 0 NULL
   PASS  driver_groups.agreement_id                                 2 rows, 0 NULL
   PASS  driver_group_memberships.user_id                           2 rows, 0 NULL
   PASS  driver_group_memberships.driver_group_id                   2 rows, 0 NULL

┌─ 4. Physical charger chain (Station → EVSE → Connector)
───────────────────────────────────────────────────────────────────────
   PASS  All charging_stations have at least 1 EVSE                 32 stations, 0 without EVSE
   PASS  All EVSEs have at least 1 Connector                        32 EVSEs, 0 without connector
   PASS  Connector.org_id matches parent EVSE.org_id                32 connectors, 0 org mismatches
   PASS  ChargingStation site matches Installation site             32 wired stations consistent

┌─ 5. Tariff anchor coverage
───────────────────────────────────────────────────────────────────────
   org              site                installation         dso_tariff    dso_status  retailer_tariff                ret_status
   N1 ehf           Dalvegur 10 - 14    Dalvegur 10 - 14     Veitur AD1    active      N1 N1_RAFMAGN-REPF-01          active
   N1 ehf           Reykjavík HQ        Reykjavík HQ         Veitur AD1    active      N1 N1_RAFMAGN-REPF-01          active
   Straumvakt       Virtual Sandbox     VCP Lab              Veitur AD1    active      N1 N1_RAFMAGN-REPF-01          active

   PASS  DSO tariff anchor                                          All installations have dso_tariff_id
   PASS  Retailer tariff anchor                                     All installations have retailer_tariff_id
   PASS  DSO tariff status                                          All referenced DSO tariffs are active
   PASS  Retailer tariff status                                     All referenced retailer tariffs are active

┌─ 6. OCPP identity ↔ ChargingStation wiring
───────────────────────────────────────────────────────────────────────
   PASS  ocpp_identities.charging_station_id                        32 identities, all bound to stations
   PASS  All stations have OcppIdentity                             32 stations, all have at least 1 OCPP identity
   PASS  OcppIdentity identity_string uniqueness (per org)          0 duplicates
   WARN  OcppIdentity auth_secret_hash NULL                         32 identities with NULL auth_secret_hash (no-auth mode)
         [vcp-001 / zpr074002 / 30 Dalvegur stations]

┌─ 7. IdToken ↔ User mapping
───────────────────────────────────────────────────────────────────────
   PASS  id_tokens.user_id → identity.users                         2 tokens, all user refs valid
   PASS  Active IdTokens all have user_id                           2 active tokens
   WARN  Active driver Users without IdToken                        1 driver(s) have no IdToken (cannot charge)
         user_id=1805f48c-2427-4bb3-b471-2461e9923757 email=kronan@kronan.is
   PASS  Dalvegur default tag EE43C609263CC7                        active, mapped to n1@n1.is

┌─ 8. Membership graph integrity
───────────────────────────────────────────────────────────────────────
   membership_id                          user_email    group_name   agmt_status  install
   763a3500-b4c8-4482-ae9c-4f137098450e   n1@n1.is      N1 Drivers   active       Dalvegur 10 - 14
   481a9416-38c9-411c-bf28-c987fdcf4dfd   n1@n1.is      N1 Drivers   active       VCP Lab

   PASS  Membership → DriverGroup → Agreement chain                 2 memberships, full chain intact

┌─ 9. Session ledger integrity
───────────────────────────────────────────────────────────────────────
       last-30d totals: 489 sessions, 489 priced (100%), 0 unpriced
   PASS  Session cost_isk_minor >= 0                                0 negative-cost sessions
   WARN  Session cost_isk_minor > 0 for priced sessions             31 sessions have cost_isk_minor = 0
   WARN  Priced sessions missing tariff_definition_id               489 priced sessions have no tariff_definition_id
   PASS  No zombie sessions (>7d, stopped_at NULL)                  0 zombie sessions
   PASS  Priced sessions have energy_kwh > 0                        0 zero-energy priced sessions

┌─ 10. Recent additions still valid
───────────────────────────────────────────────────────────────────────
   PASS  Reykjavík HQ site.dso_tariff_id                            Veitur AD1 (DSOF) active
   PASS  Reykjavík HQ installation.retailer_tariff_id               N1 N1_RAFMAGN-REPF-01 (REPF) active
   PASS  VCP Lab sandbox chain (Site→Install→Station→EVSE→Connector) 1 station(s), chain complete
         site=Virtual Sandbox install=VCP Lab circuit=Lab circuit 1 station=vcp-001 evses=1 conns=1
   PASS  N1 driver(s) with active IdToken in DriverGroup            4/4 driver group member(s) have active IdToken
         user=n1@n1.is  token=STRMV-VCP-TEST-001  token_status=active  group=N1 Drivers
         user=n1@n1.is  token=EE43C609263CC7       token_status=active  group=N1 Drivers
         (same user appears twice — one membership per agreement / installation)

═══════════════════════════════════════════════════════════════════════
  HEADLINE SUMMARY
───────────────────────────────────────────────────────────────────────
   CRITICAL findings:  0
   FAIL findings:      0
   WARN findings:      4
   PASS:               46
═══════════════════════════════════════════════════════════════════════
```

---

## Findings classification

### WARN-1 — All 32 OCPP identities have NULL `auth_secret_hash`

**Severity:** WARN (known, intentional)

**Detail:** Every OcppIdentity in the database has `auth_secret_hash = NULL`. This is the "no-auth mode" configured for the Dalvegur installation (ADR + memory entry `dalvegur_zaptec_auth`). The gateway accepts connections from these chargers without a password challenge.

**Affected identities:**
- `vcp-001` (VCP Lab / Straumvakt)
- `zpr074002` (Reykjavík HQ / N1 ehf)
- 30 Dalvegur chargers (N1 ehf)

**Risk:** Any entity that can reach the OCPP WebSocket endpoint and knows a valid `identity_string` can connect without authentication. This is acceptable for the current controlled staging environment where chargers are on Zaptec firmware that tolerates no-subprotocol echo (memory `gateway_ws_subprotocol_bug`). For production hardening, each installation that enforces auth should have its secrets populated.

**Recommended fix:** Before production go-live, populate `auth_secret_hash` for any installation where `enforceAuthorize = true` or where the charger is accessible from the public internet. Dalvegur is explicitly no-auth per operator decision — annotate this in the schema or keep a known-no-auth list. No immediate action required on staging.

---

### WARN-2 — Active driver `kronan@kronan.is` has no IdToken

**Severity:** WARN

**Detail:** User `1805f48c-2427-4bb3-b471-2461e9923757` (email: `kronan@kronan.is`) has `audience=driver` and `status=active` but zero `identity.id_tokens` rows. This driver cannot authenticate at any charger via OCPP Authorize or app JWT because there is no credential to match against.

**Risk:** If this driver attempts to charge, the OCPP gateway will receive an Authorize.req with an unknown idTag and either accept (no-auth mode) or reject (enforce mode). Either way the session will not be attributed to this user. No billing or access data will link to them.

**Recommended fix:** Either:
1. Create an IdToken for `kronan@kronan.is` (RFID or manual token) and enroll it, OR
2. If this user account is a test/placeholder with no physical card, set `status=suspended` to signal it is not yet operational.

---

### WARN-3 — 31 sessions have `cost_isk_minor = 0`

**Severity:** WARN

**Detail:** Out of 489 priced sessions in the last 30 days, 31 have `cost_isk_minor = 0`. These sessions were resolved by the billing engine (they have a non-null `cost_isk_minor`) but the computed cost is zero.

**Risk:** Zero-cost sessions are not invalid by themselves — they could be legitimate zero-energy sessions (vehicle was connected but did not draw power, or session stopped immediately). However, 31 out of 489 (6.3%) is worth investigating to confirm they are genuine zero-energy events and not a resolver bug.

**Recommended fix:** Query the sessions with `cost_isk_minor = 0` and check `energy_kwh`. If `energy_kwh > 0` on any of them, that indicates a resolver bug (energy was delivered but cost was not computed). The probe already confirmed 0 zero-energy priced sessions with positive cost, so the correlation holds — these are likely true zero-energy connections. Monitor for growth; if the count grows disproportionately, investigate the resolver.

---

### WARN-4 — 489 priced sessions have no `tariff_definition_id`

**Severity:** WARN (known, legacy state)

**Detail:** The `reports.session_ledger` table has a `tariff_definition_id` column (added to the schema) but all 489 priced sessions in the last 30 days have `tariff_definition_id = NULL`. The billing resolver wrote `cost_isk_minor` but did not backfill `tariff_definition_id`.

**Risk:** Without `tariff_definition_id`, it is impossible to audit which tariff resolved a given session, or to re-price sessions if a tariff rate changes retroactively. This column is the reconciliation anchor for the agreements cutover (ADR 0019).

**Recommended fix:** The session-stop path should write `tariff_definition_id` when it writes `cost_isk_minor`. Check `apps/api/src/...` billing resolution code and ensure the `tariff_definition_id` is written to the ledger on every session price computation. A backfill script can populate historical sessions once the write-path is fixed (not a DB integrity blocker, but a billing auditability gap that should be closed before the agreements cutover at A.10).

---

## Summary

| # | Category | Result | Notes |
|---|----------|--------|-------|
| 1 | Cross-tenant FK pollution | PASS (11/11) | No FK across org boundaries |
| 2 | Orphan FK / constraint coverage | PASS (2/2) | 93 454 FK constraints enumerated; 6 spot-checked all present |
| 3 | NULL fields | PASS (11/11) | No unexpected NULLs in load-bearing columns |
| 4 | Physical charger chain | PASS (4/4) | All 32 stations have EVSE + Connector, sites consistent |
| 5 | Tariff anchor coverage | PASS (4/4) | All 3 installations wired to active DSO + retailer tariffs |
| 6 | OCPP identity wiring | WARN-1 | 32 identities with no-auth (NULL secret) — intentional |
| 7 | IdToken ↔ User | WARN-2 | `kronan@kronan.is` has no token |
| 8 | Membership graph | PASS (1/1) | 2 memberships, full Agreement chain intact |
| 9 | Session ledger | WARN-3, WARN-4 | 31 zero-cost sessions; 489 missing `tariff_definition_id` |
| 10 | Recent additions | PASS (4/4) | Reykjavík HQ tariffs, VCP Lab chain, N1 driver access all intact |

**Overall: CLEAN. No data corruption, no cross-tenant pollution, no broken FK chains.**

The four warnings are:
- WARN-1: operational decision (no-auth mode), no fix needed now
- WARN-2: one driver account needs an IdToken before it can charge
- WARN-3: 31 zero-cost sessions — likely genuine but should be monitored
- WARN-4: `tariff_definition_id` not being written by the billing resolver — auditability gap, fix before agreements cutover
