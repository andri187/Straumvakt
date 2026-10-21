# Straumvakt — Database model: deployed test schema vs. intended new schema

## The test database (what is actually deployed)
- Neon project `spring-leaf-73019190`, branch **`test-to-market`** (`br-royal-recipe-abas9e5u`),
  database **`straumvakt_test`**. Branched off `production` (37 MB, old/abandoned schema) so **no
  staging customer data was copied** (ADR 0055: legacy history is archived, not carried).
- Schema built by applying the harvested Drizzle migrations **`0000`–`0008`** (from
  `apps/api/drizzle`, branch `dev/core-billing-integration`). `0000_baseline` is a full squash
  (66 tables, 18 schemas); `0002`–`0008` add the rest → **85 base tables across 18 domain schemas**.
- Required extension `citext` was created before `0000` (the baseline assumes it; it was installed
  out-of-band on staging). `btree_gist` is created by `0005`.
- **Migration verification limit:** verified only that the 9 Drizzle migrations apply cleanly to a
  fresh DB and the API reads succeed. This is NOT a claim about the live `staging`/`production`
  databases, whose applied state was not altered or inspected destructively.

### Domain model as deployed (the parts the console uses)
- **Tenant** = `tenancy.organizations` (`roles[]` includes `cpo`); every operational row carries `org_id`.
- **Location tree**: `properties.properties` → `sites` → `installations` (the vendor/credential
  anchor, i.e. the CPO's managed grouping) and `circuits`; `site_assets` (polymorphic) → the charger.
- **Charger**: `assets.charging_stations` (PK `site_asset_id`) → `evses` → `connectors` (OCPP status
  vocabulary enforced by check constraint); `ocpp.ocpp_identities` is the protocol credential.
- **People/access**: `identity.users` (+ `user_credentials`, `platform_grants`), `tenancy.memberships`
  (role incl. `host_admin`, `driver`), `agreements.driver_groups` (+ memberships).
- **Charging/commercial**: `charging.sessions` → `reports.session_ledger` (priced) and
  `agreements.billing_lines`; pricing precedence lives in `packages/commercial` `agreement/resolve.ts`
  (pure function; refuses only on `per_connector` ambiguity).
- **Isolation**: `apps/api/src/lib/auth/org-scope.ts` `resolveOrgScope` → `{all}` for platform,
  else `{orgIds:[active memberships]}`. The test Worker's `orgGuard()` implements the same rule.

## Intended new schema (decided, NOT yet built — do not assume present)
Per ADR 0054 (untracked spec), the to-market build reshapes assets before the fresh generation:
- **`devices`** — immortal physical unit on a surrogate PK; lifetime energy/faults follow the asset.
- **`device_identities`** — dated `device × identity_string × [from,until)`; OCPP id is a credential.
- **`placements`** — `device × installation × tstzrange`, **`UNIQUE(device_id, period WITHOUT OVERLAPS)`**
  (or `EXCLUDE USING gist` pre-PG18); billing counts placements *overlapping* the period; a public
  `EVSE.uid` is stable from day one; closing a placement is a state, never a delete.
- **Dated driver-group memberships** (`[from,until)`, uniqueness on the interval — closed rows kept).
- **Sessions** carry snapshotted context (placement/site/tariff at start) and are never re-attributed.

**Gap (confirmed against source):** the deployed test schema is still the **pre-0054** single-table
charger model — `assets.charging_stations` carries `installation_id`/`circuit_id`/`owner_org_id`
directly; there are no `devices`/`device_identities`/`placements` tables; and
`invoice`/`statement`/`delivery-record` tables do not exist in either Prisma or Drizzle. These are
decided-not-built and are gated as "planned" in the console.

## Prisma vs Drizzle
Drizzle (`packages/shared/src/db/*.ts`) is canonical as of ADR 0051/0056 — "the only schema
definition that survives." Prisma is retained downstream to generate a client for un-ported calls.
The test DB was built from the **Drizzle** migrations only.
