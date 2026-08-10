# Driivz — protocol capability assessment

**Assessed:** 2026-08-05
**Claim:** OpenADR 3.0 support, stated in writing.
**Finding:** **OpenADR 2.0b.** The written claim is contradicted by Driivz's own
public documentation.

---

## Evidence (Documented)

From Driivz's public documentation page *Set Up OpenADR Events* (published
2023-06-07, updated 2024-03-26):

```
Ei-Event Payload Guidelines
Accepted SignalName & SignalType (separated by semicolon):
LOAD_DISPATCH ; setpoint
x-gridConnectionLimitMax ; x-loadControlCapacity
units of x-loadControlCapacity are kW
TimeZone=UTC
```

Six markers, all 2.0b, none 3.x:

| Marker | Why it is 2.0b |
|---|---|
| **"Ei-Event"** | `eiEvent` is the OASIS Energy Interoperation element carried in 2.0b's `oadrDistributeEvent`. 3.x has no such object — it has `event` with `payloads`. |
| **`SignalName` / `SignalType`** | 2.0b `eiEventSignal` fields. 3.x replaced them entirely with `payloadType` and `type`. They do not exist in 3.x. |
| **`LOAD_DISPATCH ; setpoint`** | A 2.0b signalName/signalType pair. In 3.x this became `DISPATCH_SETPOINT`. |
| **`x-gridConnectionLimitMax`, `x-loadControlCapacity`** | The `x-` prefix is 2.0b's private-extension convention. Their capacity limit is a **custom extension**, not a standard signal. |
| **`openAdrVenId` / `openAdrVenName` as pre-shared config** | 2.0b registration semantics. In 3.x, identity derives from the OAuth client and object IDs are VTN-assigned. |
| **No `clientID`, no `clientSecret`, no token endpoint in the config list** | 3.x makes VEN configuration of VTN URL **plus** clientID and secret mandatory. A 3.x VEN cannot authenticate without them. |

Configuration parameters published: `openAdrEnabled`, `openAdrVtnId`,
`openAdrVtnUrl`, `openAdrVenId`, `openAdrVenName`,
`openAdrAllowed_ven_ids`, `openAdrAllowedResourceIds`, `openAdrPullPeriod=60`.

---

## Operational limitations — worse than the version (Documented)

Stated in Driivz's own *Limitations* section:

1. **No event prioritisation.** *"The latest event overrides values of older
   events if there is an overlap."* A mandatory DSO limit and a commercial
   activation resolve by arrival order.
2. **Events held in memory.** *"If there is a crash or if the runtime topology
   is refreshed, memory loss may occur. In this case, the event will need to
   be recreated by the VTN."* **The grid limit evaporates rather than failing
   safe.** This is disqualifying for any safety-relevant envelope,
   independent of protocol version.
3. **Restart required** to add a VEN or change any OpenADR configuration;
   initial setup requires restarting the entire environment.
4. **60-second default polling.** Poll-only; no subscriptions or webhooks.
5. **Site limit locked** from editing while an OpenADR event exists for the
   next 48 h.

---

## Usable capability

The valuable part is **not** the protocol layer — it is the **SmartChain
dynamic site limit**, which already exists, enforces at the site grid circuit,
and drives load allocation. That is the connection-point boundary control the
architecture needs.

**Approach: bypass Driivz's OpenADR entirely; drive the site limit via API.**

## Site-limit API — probably yes (Documented, indirect)

From `docs/notes/2026-08-03-driivz-model-comparison.md`, written against their
API gateway spec. A **`Policy`** object attaches to **Property or Site** (not
Circuit) and carries:

| Field | Relevance |
|---|---|
| **`peakShavingInkW`** | **A site power limit in kW.** If writable, this *is* the site-limit API — Path C becomes real without touching their OpenADR layer. |
| **`utilityDataSource`: `INTERNAL` \| `OPEN_ADR` \| `OSCP`** | DSO integration is a *mode on the load-balancing policy*, not a separate subsystem. **OSCP is a first-class option.** |
| `mainInputCircuitResourceId` | Confirms the resource mapping assumed in the OpenADR setup docs |
| `strategy` (`EVEN_SPREAD` / `FIFO`), SoC and plan prioritisation | How the station allocates beneath the ceiling |

Also present: `EnergyStorage` as a first-class entity, and
`POST /sites/{id}/energy-planning/calculate` returning site power usage — a
possible telemetry source for measurement corroboration.

### Why this matters more than the version question

1. **Path C likely exists.** A writable `peakShavingInkW` gives a site-level
   kW ceiling through a plain REST call, bypassing 2.0b entirely.
2. **OSCP is supported.** OSCP is *designed* for DSO→CPO capacity forecasts —
   closer to a dynamic operating envelope than 2.0b's `LOAD_DISPATCH`. It is
   worth asking what their OSCP implementation actually accepts, given the
   Open Charge Alliance no longer actively develops the standard.
3. **Site-level, not circuit-level.** With one station at Vík, Policy-on-Site
   maps to exactly the right thing.

## Pending

| Question | Status |
|---|---|
| **Is `peakShavingInkW` writable via API — which endpoint, what auth?** | **The question that decides Path C.** Spec needed |
| What does their `OSCP` mode accept? Version, message set | Open — possibly a better route than 2.0b |
| Validated OpenADR sample payload | Requested; will confirm 2.0b conclusively |
| Does an applied limit persist across restarts? | Open — their in-memory OpenADR event defect may not apply to a Policy field |

> **The API gateway spec is not in this repository.** Per the model-comparison
> note it sits at `~/Downloads/api-gateway.yml`. Copy it into the workspace to
> settle the `peakShavingInkW` question definitively.

## Leverage note

There is a written 3.0 claim contradicted by published documentation, plus
four documented defects. That is a well-evidenced basis for a commercial
conversation, whether or not a platform change is ever pursued.
