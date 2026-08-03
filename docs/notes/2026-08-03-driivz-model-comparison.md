# 2026-08-03 — Driivz model vs Straumvakt: what to rethink

Read from the Driivz `api-gateway` OpenAPI spec (v0.0.1-development,
~250 operations). This is a **real schema**, not a secondhand note —
worth more than the AMPECO endpoint listing because it shows field
shapes, enums and relations.

> The spec lives outside the repo (`~/Downloads/api-gateway.yml`). If it
> is redistributable it belongs in `docs/reference/integrations/`
> alongside the Zaptec and Nexblue specs. Check terms first.

---

## Their asset hierarchy is *shorter* than ours

```
Driivz:      Property → Site → Charger → EVSE → Connector
Straumvakt:  Property → Site → Installation → Circuit → ChargingStation → EVSE → Connector
```

**They have no Installation and no Circuit tree level.** Instead:

- **Site carries the grid-connection attributes** we put on Installation:
  `ratedVoltage`, `maxCurrent`, `meterNumber`, `utilityCompanyId`,
  `utilityTariffId`.
- **Electrical topology is a referenced graph, not a tree level.**
  Property and Site both carry `electricalTopologyId`, and the energy
  policy references `mainInputCircuitResourceId` — a *resource id*, not a
  position in the asset tree.

### Worth rethinking

Our Circuit-as-tree-level is physically truthful, but it means a
charger's circuit is determined by **where it sits in the tree**. Moving
a charger between circuits is a tree operation; a circuit that spans
sites is unrepresentable.

Driivz's split lets load-balancing topology evolve independently of the
asset tree. Given P4's dynamic load balancing and OSCP work, that
separation may matter more than it looks. **Not a change to make now** —
but worth deciding deliberately rather than by inheritance.

---

## The biggest gap: ChargerGroup

**We have no charger grouping at all.** Driivz's is a whole subsystem:

- **Hierarchical** — `subGroups`, `ancestorGroupId`, folders (`isFolder`)
- **Many-to-many** — a charger belongs to several groups
  (`getGroupsByChargerId` returns a list)
- **Dynamic membership** — `dynamicContentQuery`, e.g.
  `"StationHostID = 219"`. A saved query *is* the membership.
- **Tariffs attach to groups** —
  `/customer-plans/{planCode}/tariffs/charger-groups/{chargerGroupId}`
- **Billing plans attach to groups** — `addBillingPlansToGroup`
- **Card authorisation schema per group** — `DEFAULT` / `APPROVE_ALL` /
  `SPECIFIC_PROVIDERS`, plus named external providers
- Each ChargerHost owns a group subtree (`chargerGroupParentId`)

### Why this matters for P7

Acquiring a fleet means *"take these 800 chargers, put them in a group,
apply this tariff, set this auth policy."* We currently have no noun for
"these 800 chargers" that isn't a tree position. Our tariffs resolve
through agreements + driver groups — grouping the **people**, never the
**hardware**.

This is the single most consequential difference in the spec.

---

## Cards: they model what we call IdToken far more fully

```
type:   RFID | VIRTUAL | VEHICLE_ID | EMAID | PIN_CODE
status: ORDERED · ACTIVE · NOT_ASSIGNED · SUSPENDED · CANCELLED ·
        BLOCKED · EXPIRED · BLACKLISTED · SENT · LOST · STOLEN ·
        INACTIVE · DESTROYED
```

Plus `formFactor`, `brandId`, `expirationDate`, batch import, reassign
to another account, order-a-card, suspend-all-for-account.

**The elegant bit: `VEHICLE_ID` and `EMAID` are card *types*.** Autocharge
and Plug & Charge are not separate mechanisms — they are credentials in
the same table, with the same lifecycle and the same revocation path.

That directly serves [ADR 0042](../adr/0042-real-driver-identity-and-tap-attribution.md),
[0043](../adr/0043-homeless-driver-and-join-paths.md) and
[0044](../adr/0044-driver-side-capabilities-and-their-data-shape.md): one
credential model covering card, virtual RFID, EVCCID and eMAID, rather
than four mechanisms with four revocation stories.

Our `IdToken` is thin by comparison — `value`, `status`, `userId`.

---

## They implement ADR 0031 §18 concretely

We have the group-owner/dependent rule **in prose only** — the schema
audit found `group_owner_user_id` doesn't exist. Driivz ships it:

- `CustomerAccount` with `payingAccountNumber`
- `Member` accounts created **under** a paying account
  (`POST /customer-accounts/{payingAccountNumber}/members`)
- `familyId` linking them; member `role`: `MEMBER` | `FLEET_MANAGER`
- Members suspended/unsuspended individually
- `Vehicle` carries **both** `familyId` and `ownerAccountNumber`

And **sponsored contracts** — `POST /accounts/{n}/customer-contracts/sponsored`
with `sponsorAccountNumber` + `sponsorContractId`. That is ADR 0031 §12's
workplace coverage, as a first-class contract kind.

**Confirmation, not correction:** our model is right, and this is one
worked implementation of it.

---

## Session fields we lack and probably want

Their `EvTransaction`:

| field | what it gives |
|---|---|
| `transactionBillingStatus` | `NOT_BILLABLE` · `TEMP_COST` · `FINAL_COST` · `DICTATED_COST` · `EXCEEDED_BILLING_CALC_TIME_RANGE` · `FREE_CHARGE` |
| `corruptedReasons` | explicit "this row is known-bad", e.g. `CORRUPTED_BY_NEGATIVE_TRANSACTIONS` |
| `startMeterSignedData` / `stopMeterSignedData` | signed meter data as **separate start and stop** fields |
| `chargerPublicKey` | the key to verify them against |
| `authorizationFailureReason` | why an attempt was refused |
| `vehicleSoc`, `smart` | state of charge; whether smart charging applied |

**`transactionBillingStatus` is the one to steal.** We have
`enrichmentStatus` / `verifiedSource`, but no explicit billing lifecycle
— particularly no `TEMP_COST` vs `FINAL_COST` distinction, and nothing
like `EXCEEDED_BILLING_CALC_TIME_RANGE` (a session too old to price).

**`corruptedReasons`** is the honest version of what our probe scripts
find by hand.

**Note they have no `authenticationMethod` on the transaction** — only
`cardId`, with `authenticationMethods` as a *capability* enum on the
charger. ADR 0044 D3's explicit enum is better; a card id only implies
the method, and says nothing for free-vend or remote start.

---

## Charger facets as separate read surfaces

Driivz splits the charger into independently filterable facets:

`profile` · `status` · `network` · `maintenance` · `location` ·
`electrical`

Each has its own `GET /{id}/…` and its own `POST …/filter`. And
`ChargerNetwork` **stores** what our technical-read panel fetches live:
`communicationType`, `macAddress`, `modemSerialNumber`,
`lastReceivedHeartBeat`, `iccid`, `imsi`, `msisdn`, `ipAddress`,
`dynamicIp`.

That is
[the degrade-by-source note](./2026-08-03-technical-read-degrade-by-source.md)
generalised — and it answers the question that note leaves open, by
making the network facet a **stored projection** rather than a vendor
round-trip.

---

## Energy management answers the OpenADR/OSCP question

A `Policy` attached to **Property or Site** (not Circuit):

- `strategy`: `EVEN_SPREAD` | `FIFO`
- `prioritizeByBillingPlan`, `prioritizeBySoc`, `targetSoc`,
  `prioritizeByDriverProfile`, `prioritizeByEnergyRequirement`
- `dropChargePriceThreshold` + `dropChargePercentage`,
  `stopChargePriceThreshold`
- **`utilityDataSource`: `INTERNAL` | `OPEN_ADR` | `OSCP`**
- `peakShavingInkW`, `mainInputCircuitResourceId`
- departure-time defaults, `defaultMinChargeCurrent`

So DSO integration is modelled as a **data source on the load-balancing
policy**, not as a separate subsystem. Cheaper than it sounds.

There is also `EnergyStorage` as a first-class entity with its own
status reporting — and `POST /sites/{id}/energy-planning/calculate`,
which returns per-reservation `requiredEnergyInKwh` vs
`suppliedEnergyInKwh` plus site power usage. That is genuine capacity
planning against **reservations**.

---

## Reservations — an entire subsystem we have nothing of

Reserve-now and reserve-by-date, reservation terms with fee /
cancellation fee / no-show fee, per-plan `allowReserveNow` /
`allowReserveByDate`, connector `reservable` flag, and reservation state
feeding the energy planner.

Not a gap to close now. Worth knowing it is a coherent subsystem, not a
feature bolted onto sessions.

---

## Where our model is better — don't copy these

**Host type as an enum.** Driivz has
`ChargerHost.type: STANDARD | FLEET | MDU | WORKPLACE`. We deliberately
derive an org's role from which `service_*` agreements it holds
(ADR 0031), so one org can be host *and* workplace payer *and*
contractor. Their enum cannot express that.

**Tariff resolution is combinatorial.** Their tariffs key on
plan × charger-group × connectorType × chargerSpeed × dayOfWeek ×
timeRange — hence endpoints like
`deletePlanGroupTariffsByCodeAndConnectorType`. Our agreement/clause/
bearer model is more general and less endpoint-per-axis.

**No OCMF as a concept.** `startMeterSignedData` / `stopMeterSignedData`
are opaque strings. Our OCMF handling — parsing the blob, extracting
EVCCID, treating it as dispute evidence — is more specific and better
suited to *Eichrecht*-adjacent obligations.

**Money.** Their spec uses bare `number` for amounts throughout. We use
`BigInt` minor units with zero `Float` in the schema (verified in the
audit). Do not regress toward theirs.

---

## Ranked, if any of this becomes work

1. **ChargerGroup** — the real gap; P7 needs a noun for "these 800
   chargers". Hierarchical + dynamic membership + tariff attachment.
2. **Unify credentials as card types** — RFID / virtual / vehicle-id /
   eMAID in one model with one lifecycle. Serves 0042–0044 at once.
3. **`transactionBillingStatus` + `corruptedReasons`** on the session —
   cheap, additive, and makes reconciliation state explicit.
4. **Store the network facet** rather than fetching it — closes the
   degrade-by-source question.
5. **`group_owner_user_id`** — schema audit finding 1; Driivz shows the
   shape works in production.
6. **Electrical topology as a referenced graph** — think about it before
   load balancing hardens around the current tree.

Reservations and the full energy-planning stack are product decisions,
not model corrections.
