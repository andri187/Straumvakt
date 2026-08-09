# PROPOSED L — Event and issue ownership must be explicit before 4–5k connectors

**Status:** Proposed · **Date:** 2026-08-09 · **Decision owner:** architecture

## Context

The ingest path is gateway Durable Object → queue → consumer → Postgres, with a
separate archive queue to R2 and a cost projection into `reports.session_ledger`.
At today's scale this is untested but unproblematic. **No production-scale load
test exists**, so nothing below is measured capacity.

## Forces

- OCPP WebSocket ownership is per-charger and lives in a Durable Object.
- Workers mint a database client per request; Hyperdrive pools, but the console
  Worker's config sets `max: 1` per client.
- `cpu_ms: 50` bounds any per-request fan-out.
- Cost projection is what drivers actually see, so its lag is a product SLO, not
  only an infrastructure one.

## Options

1. Keep the current topology; scale consumer concurrency.
2. Shard the issue/alert engine by installation or operator.
3. Split the hot ingest path from the projection path entirely.

## Recommended

**Option 1 until the capacity model's dominant driver is measured**, then Option
3 if projection lag is the binding constraint. Option 2 only if alert-storm
fan-out is demonstrated to be the bottleneck — sharding adds ordering concerns
that are not worth paying for speculatively.

The decision this ADR actually asks for is narrower: **name an owner for each
stage** (connection, ingest, projection, issue engine, alerting) and give each an
SLO, so a lag can be attributed instead of debated.

## Consequences

Without explicit stage ownership, a reconnect storm and a projection backlog
look identical from the driver's side — both present as "my session is wrong".

## Unresolved

Every capacity number. See the capacity model; all values there are assumptions
or targets, none is measured.
