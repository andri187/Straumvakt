# 2026-08-03 — Technical read should degrade by source, not fail wholesale

Design observation, not a bug. Recorded before it evaporates.

## What prompted it

`https://straumvakt.org/chargers/9e222976…/technical-read` shows:

> **Not linked** — This charger is not linked to a vendor credential —
> onboard via /onboard/zaptec to enable Technical Read.

Operator's question: *could it be the other way around — that OCPP is
unavailable?* Then, on being told technical-read uses the Zaptec REST
API rather than OCPP: **"it should be using both."**

That is the better design, and the panel does not do it.

## The charger in question

`zcs029381` (`9e222976-4151-40aa-9a5c-4bc4a71f67ab`) is **correctly
imported** — not the `zpr074002` case:

| field | value |
|---|---|
| `vendor` | `Zaptec` |
| `vendor_resource_id` | `a5d5041c-0889-4af1-86a7-bfea6b184708` |
| `credentials_ref` (identity) | **NULL** |
| `credentials_ref` (**installation**) | `andrith187@gmail.com` |

The credential it needs is one level up. The committed fallback chain
(`identity → Installation → sole active credential`) resolves it — that
page should come alive on deploy with no data change. `credentials_ref`
is NULL on **all 33 identities**, because the Zaptec importer writes
`vendor` and `vendorResourceId` only, so this is fleet-wide.

## The design point

The panel is **all-or-nothing on the vendor credential**. No credential,
blank page. But most of what a technical read should show already exists
locally, arriving over OCPP:

| Field | Source |
|---|---|
| Vendor, model, firmware version | **OCPP** — `BootNotification` |
| Last seen / online | **OCPP** — `ocpp_identities.last_seen_at` |
| Connector status | **OCPP** — `StatusNotification` |
| Energy / meter readings | **OCPP** — `MeterValues` |
| Signal strength (dBm) | **Zaptec REST only** |
| Communication mode (WiFi / LTE) | **Zaptec REST only** |
| Local auth roster | already unconditional ✅ |

So a charger with no working credential should still show firmware,
last-seen and connector state. It cannot show signal and comms mode.
Today it shows **nothing**, which reads as *"this charger is broken"*
when the truth is *"one of two data sources is unavailable."*

**The roster already works this way.** `withRoster` wraps every failure
path in `charger-technical-read.ts`, so it renders regardless of
credential state. The vendor telemetry simply never got the same
treatment — the pattern is already in the file, applied once.

## Proposed shape

**Degrade by source, not fail wholesale.**

1. Render every field that has a value, whatever its origin.
2. Label each with **where it came from** and **how fresh** — OCPP
   last-seen versus a cached Zaptec read are different claims and should
   not look alike.
3. `linkStatus` explains only the **missing half**, rather than blanking
   the page.

That also makes the badge honest: *"Not linked"* comes to mean **vendor
enrichment unavailable**, not *no data*.

## Why it matters beyond tidiness

- **It is the fleet-wide state, not an edge case.** All 33 identities
  have NULL `credentials_ref`.
- **It hides the OCPP data you already paid to collect.** Every frame is
  in the event log; the panel just refuses to look.
- **It mis-signals during a vendor outage.** Zaptec being down would blank
  a panel for a charger that is online and charging normally — the
  operator sees a dead page for a healthy charger, which is the wrong
  conclusion at the wrong moment.
- **It compounds under multi-operator.** An acquired fleet may have no
  vendor credential at all — native OCPP only. Those chargers would show
  a permanently blank technical read despite being fully observable.

That last point makes this **P7-relevant**, not merely cosmetic: a fleet
onboarded over OCPP with no vendor account is exactly the case ADR 0035
plans for, and today it renders as nothing.

## Scope note

This is a **design change**, distinct from the badge fix committed in
`9ac5c53` (which corrected *which* fault was reported, not *how much*
gets rendered). It wants its own ADR if taken up — the merge rules,
freshness labelling and per-field provenance are decisions, not
implementation detail.

Prerequisite worth noting: some of the OCPP-side fields
(`BootNotification` vendor/model/firmware) are in the event log but not
projected to a queryable current-state row. That is **P4.30 / ADR 0038's
Hot tier** territory — so this is cheapest to build after, or alongside,
the read-model work rather than before it.
