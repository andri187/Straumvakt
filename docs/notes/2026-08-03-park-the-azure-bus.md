# 2026-08-03 — Park the Zaptec Azure Service Bus feed

**Decision:** park it. Not delete, not fix — stop treating it as
production infrastructure until the overlay product decides its fate.

## Why it was introduced

To find out whether Zaptec's Service Bus carried **raw vehicle↔charger
communication frames** (ISO 15118 / PLC), and what extra capability it
might unlock.

**Answered empirically: it does not.** Three months of data, two message
types only:

| StateId | Carries | Rows | Last seen |
|---|---|---|---|
| 553 | cumulative energy (Wh) | 293,890 | 2026-08-02 — live |
| 513 | instantaneous power (W) | 27,154 | **2026-07-31 — stale** |
| **723** | CompletedSession + **OCMF** | **0 — never arrived** | — |

No vehicle↔charger frames. No EVCCID by that route — `ev_plc_mac` is
**0 across all 1,603 sessions**.

## Why parking it costs nothing today

On chargers where we terminate OCPP, everything the bus delivers is a
third copy of data already held twice:

| | bus | already have |
|---|---|---|
| cumulative energy | ✅ | OCPP MeterValues |
| instantaneous power | ✅ | OCPP MeterValues |
| OCMF | ❌ never | OCPP MeterValues |
| liveness | ❌ session-only | OCPP Heartbeat, free |

**`amqp_energy_kwh` = 0 of 1,603 sessions.** Nothing downstream depends
on it.

Against that: a Fly machine, a separate repo, and the worst reliability
record in the stack — two silent 16-hour deaths, 723 never working, 513
stale since 31 July. The least reliable component duplicating the most
reliable one.

## Why it is parked rather than deleted

**Overlay mode** — Straumvakt layered on an installation whose OCPP goes
to a third-party CPMS (AMPECO etc.), where we hold only a Zaptec API
token. The contractor-without-CPMS-access wedge.

There the calculus inverts:

- the REST API is **poll-only and post-hoc**; the bus is the only
  real-time channel
- push costs nothing per charger, while `/state` polling is the #1
  scaling constraint (~200 chargers)
- **723 would be the only path to signed billing evidence**, because
  without OCPP there is no MeterValues to carry OCMF. An overlay
  installation currently bills on Zaptec's *unsigned* CDR figure with
  nothing to produce in a dispute.

That reframes the 723 bug: redundant on our own chargers, **the only
copy** in overlay.

## What parking means

1. **Do not invest in it for our own fleet.** Redundant there; the
   OCPP-first work delivers more.
2. **Do not leave it half-running.** The current state — silently
   dropping message types into a 321,044-row table nothing reads — is
   the worst option: cost and risk without benefit.
3. **The overlay product decision reverses or ends this.** If
   contractor-without-CPMS-access is real, 723 becomes worth fixing and
   the bus comes back. If not, delete the Fly consumer and the feed.

## Known limit of overlay mode, if it is revived

**`id_tag` is OCPP-only.** In overlay that connection belongs to the
third-party CPMS, so we would have the session, the energy and (with
723) the signed reading — **but not the driver**, unless Zaptec's CDR
carries a user reference from their own portal.

Unverified. It decides whether overlay supports **per-driver** billing
or only **per-charger**, which is a product boundary worth knowing
before selling it.

## Diagnostic worth keeping

The consumer is **not dying wholesale — it drops specific message
types.** 553 ran continuously while 513 went stale and 723 never
arrived at all. That is a far more findable bug than "the consumer
died", and it is the thread to pull if the bus is ever revived.
