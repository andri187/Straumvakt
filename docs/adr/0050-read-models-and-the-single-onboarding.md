# ADR 0050 — Read models, one onboarding, and what "reference" means

> **LEGACY — pre-market-focus historical reference. Not active canon. See /FOCUS.md. Load-bearing constraints extracted into the focus rules.**

**Status:** Proposed · 2026-08-07 · **operator brief, partially verified**
**Relates to** [ADR 0047](./0047-dissolving-installation.md) (Installation
dissolves), [ADR 0048](./0048-billing-cutover-resolved-agreements-survives.md)
(agreements survives), [ADR 0049](./0049-the-cdr-is-the-record.md) (the CDR is
the record).

---

## Why this exists

The operator's read, 2026-08-07: `/sites`, `/installations`, `/circuits` and
`/chargers` show essentially the same data through four different APIs; the
accounts surface is unwired and unfiltered; the billing engine's wiring is
opaque; onboarding exists several times over; the technical read is
overweight and asks three or four sources for the same values.

**Some of that is measured below. Some is not.** The two are kept apart on
purpose — the last time endpoint redundancy was asserted here without
measurement it was wrong (the console called both sides of every duplicate
pair).

## The unifying principle

> **A read should be a stale call to stale variables.**

Today a page load fans out to the vendor API. `/sites` and `/chargers` both
authenticate against Zaptec and call `listChargers` on every request, and
`/sites` additionally calls `getChargerDetail` + `getChargerState` per
charger. That is why the same data arrives four different ways: each view
re-derives it live, from source, with its own rules.

The alternative is one materialised read model per aggregate, written by the
ingest paths (OCPP projections, the Zaptec cron, the state-event feed), and
read by every view. Views become projections of one table instead of four
re-derivations of one vendor.

**This is already half-built.** `charging_stations.lastTelemetryRead` +
`lastTelemetryAt` is exactly this pattern — a cached read with a live
fallback. It is used by one caller.

## VERIFIED

### V1. `/sites` and `/chargers` re-derive the same charger row, twice

| page | endpoint | repository | lines | live Zaptec on page load |
|---|---|---|---:|---|
| `/sites` | `/api/admin/sites/tree` | `site-tree.ts` | 753 | `listChargers`, `getChargerDetail`, `getChargerState` |
| `/chargers` | `/api/admin/chargers` | `chargers.ts` | ~730 | `listChargers` |
| `/installations` | `/api/admin/installations` | `installations.ts` | 171 | — |
| `/circuits` | `/api/admin/circuits` | `circuits.ts` | 144 | — |

`site-tree.ts` and `chargers.ts` independently compute the same six
operator-facing facts per charger: online state against a 12-minute window,
OCPP-vs-vendor liveness, decommissioned-by-omission, lifetime kWh, connector
status, and the vendor/OCPP status reconciliation. Both carry their own copy
of `ONLINE_WINDOW_MS` and their own status-mapping rules.

So the duplication is real, but it is **two**, not four. `installations` and
`circuits` are thin and do not touch the vendor — their redundancy is
structural (ADR 0047 already dissolves Installation), not computational.

### V2. The technical read is 874 lines over five sources

`charger-technical-read.ts`, for one charger: 4 database queries
(`chargingStation`, `idToken`, `driverGroupMembership`, `vendorCredential`
×2), then `getChargerDetail` + `getChargerState` against Zaptec, behind a
`lastTelemetryRead` cache with a live fallback.

The cache is the right instinct. The 874 lines around it are the cost of
having no read model to cache *into*.

### V3. Onboarding exists at least seven times

| path | file | Prisma calls |
|---|---|---:|
| public self-registration | `registration.ts` | 17 |
| org invites | `invites.ts` | 11 |
| host invites | `host-invites.ts` | 6 |
| host applications | `host-applications.ts` | 5 (**0 rows, ever**) |
| onboarding chains | `onboarding-chains.ts` | 9 |
| Zaptec bulk import | `zaptec-import.ts` | 12 |
| credential-driven provisioning | `credential-management.ts` apply path | 14 |

Seven code paths, 74 queries, all reaching the same end state: an org, a
user, and some chargers exist. `tenancy.host_applications` and
`tenancy.org_email_domains` have never held a row.

### V4. The schema is 62% speculative; the API is not

61 of 98 tables have never held a row — whole surfaces (`roaming`,
`webhooks`, `entitlements`, `issues`, `energy`, `people`, `vendors`, 14 of 16
`billing`). But only **76 of 526** remaining Prisma calls (14%) touch them,
and only 5 files touch nothing else.

The speculative work stopped at the migration. It is schema debt, not API
debt, and it is cheap to drop and expensive to keep describing in two ORMs.

## NOT VERIFIED — operator assertion, recorded as such

- **The accounts surface is unwired and unfiltered.** Not measured. Needs the
  same caller + filter audit `/chargers` got.
- **The billing API model may not be valid.** Partially known: four
  generations coexist, and the two that price disagree on 22 of 57 sessions
  (39%, ADR 0049 F4). Whether the *API shape* is right is a separate question
  and is open.
- **The mobile app can be cleared.** Operator states its displayed items are
  legacy demo content. Not audited.
- **"References are just references."** Read as: a `*_ref` column is a
  pointer to a vendor's world, not a domain concept, and must not be modelled
  as one. Consistent with ADR 0047 (`credentialsRef` is a vendor leak) and
  ADR 0049 (a CDR carries a snapshot, not an FK). Recorded as a principle,
  not yet a decision about specific columns.

## Decisions

1. **One read model per aggregate.** Charger state is computed once, on
   ingest, and stored. `/sites`, `/chargers` and the technical read become
   different projections of it. No view calls a vendor API on a page load.
2. **One onboarding.** A single path with steps that may be skipped, not
   seven paths that converge. `host_applications` and `org_email_domains` go
   with the dead schema.
3. **Drop the 59 never-used tables.** Keep `people.vehicles` and
   `agreements.driver_access_requests` — both are 0 rows but both are about
   to be used (ADR 0044; the access flow is due for real-world test).
4. **A reference is a pointer, never a domain object.** Vendor refs live on
   `VendorAssetRef`. Domain tables do not carry them.

## Sequence, and why this order

1. **Finish the Drizzle port.** Not because it is more important, but because
   every item above is a schema or query change, and `prisma/schema/`
   currently *generates* the Drizzle schemas — so today the DB cannot change
   without editing the ORM being removed.
2. **Drop the dead schema** (decision 3). Halves what the port maintains.
3. **Build the charger read model** (decision 1). Collapses `site-tree.ts`
   and the vendor fan-out; makes decision 2 tractable.
4. **Collapse onboarding** (decision 2).
5. ADR 0047 / 0049 structural changes, on top.

## What this does not decide

Whether the accounts surface or the billing API shape are wrong — both need
measurement first. Whether the mobile app's legacy screens are deleted or
rebuilt. Neither is in scope here.
