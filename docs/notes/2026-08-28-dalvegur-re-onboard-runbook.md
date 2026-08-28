# Dalvegur re-onboard — the runbook

Written 2026-08-28 by `claude-b`, Phase 6 of round 4. **Rehearsed entirely
offline against fixtures: no Zaptec API call, no socket, no database.**

**PRECONDITION, and it is absolute: ADR 0054 items 1–6 must have landed AND
been applied.** This run writes the first placements. Until `devices`,
`placements`, `device_identities`, the EVSE/connector rework, the membership
interval and the session snapshot exist, there is nowhere for a placement to
go and the run cannot start.

Cross-referenced against A's
`docs/notes/2026-08-18-first-invoice-operator-runbook.md` — see the ordering
note at the end.

---

## The estate

| | Count |
|---|---|
| Active chargers | 20 |
| Deactivated | 15 |
| **In the Zaptec portal** | **35** |
| **Rows in our database** | **30** |

**Two things follow, and both were addressed this round.**

### 1. The 30-of-35 gap — pagination is no longer a candidate explanation

`listChargers` in `apps/api/src/lib/zaptec.ts` returned `json?.Data ?? []` and
read **no `Pages` field at all**, while its own docblock claimed pagination was
handled *"via the `Pages` envelope Zaptec returns; default page size is large
enough for typical fleets so we do not paginate yet"* — an assumption nobody
had tested against 35 chargers.

**Fixed this round.** It now walks every page, stops on the **envelope** rather
than on a short page (a short page is also what the last page looks like), caps
at 50 pages against a nonsense count, and returns `pagesRead` and
`reportedPages` so the real number is visible rather than inferred. 17 offline
tests, including one that reproduces the old behaviour returning 20 of 35.

**Stated honestly: this does NOT prove pagination caused the gap.** No API call
was made this round. What is now true is that pagination can no longer be the
explanation, and the next authenticated read will report the real count instead
of silently truncating. **The gap stays open until someone runs step 1 below.**

Other candidate explanations, none excluded: the 15 deactivated chargers may be
filtered by a query we do not control; five may belong to another Zaptec
installation; five may have been created after our last sync.

### 2. The four vendor-config fields are now recorded rather than discarded

`Active` was declared on `ZaptecChargerLite` and thrown away downstream.
`VendorConfigSinkPort` now carries all four — `chargerActive`,
`authenticationType`, `isAuthorizationRequired`, `ocppDefaultIdTag` — each
timestamped, with an identical observation returning `unchanged` rather than
writing a duplicate row, and a never-observed device returning **`unavailable`
rather than a default-shaped object**.

**The fleet is `AuthenticationType = 2` (Ocpp) uniformly, and driver auth is
off per charger via `IsAuthorizationRequired`. That is a SETTING, not a fault.**
Recorded, not diagnosed — framing correction 5. Recording it with a timestamp
is precisely what stops it being rediscovered as an outage a third time.

---

## How many placements the real run writes

**35 device rows, and 20 open placements.**

| Device class | Count | Placement written? |
|---|---|---|
| Active in the portal | 20 | **yes — one open placement each** |
| Deactivated in the portal | 15 | **device row yes, placement no** |

The reasoning, which is ADR 0054 decision 1 and 3: **a device is immortal and a
placement is dated.** A deactivated charger is still a physical unit that
exists and may be re-placed later, so it gets a `devices` row. It is not
currently installed anywhere, so it gets **no open placement** — and writing one
with an immediate close would be inventing history nobody observed.

**If the pagination fix reveals more than 35**, the extra devices are additions
to the device table and the placement count rises only for those that are
active. **Step 1 exists to find that out before anything is written.**

---

## The runbook

**Every step is offline-rehearsed. Steps 1–3 write nothing.**

```
 0. PRECONDITION CHECK — items 1..6 landed AND applied.
      npm run check:migrations        # expect: no pending migrations
      Confirm the tables exist: devices, placements, device_identities.
    ⛔ ABORT IF any is missing. There is nowhere to put a placement.

 1. READ THE REAL FLEET — read-only, no writes.
      Call listChargers with a valid token and record BOTH numbers:
        pagesRead, reportedPages, and value.length
    VERIFY: value.length equals what the portal shows.
    ⛔ ABORT IF value.length is still 30 against a portal showing 35 — then
       pagination was NOT the cause and the gap is something else. Do not
       proceed to write placements on an estate you cannot enumerate.

 2. RECORD THE VENDOR CONFIG for every device returned.
      For each: chargerActive, authenticationType, isAuthorizationRequired,
      ocppDefaultIdTag -> VendorConfigSinkPort.record()
    VERIFY: every device has an observation; count the `recorded` results.
    NOTE: expect authenticationType = 2 across the fleet and
      isAuthorizationRequired = false. That is the known setting. Record it.
    ⛔ ABORT IF authenticationType is NOT 2 on some charger — that charger
       authorises natively and our verdict would be decoration on it.

 3. DRY-RUN THE MAPPING — still no writes.
      For each active device, compute the placement it WOULD get:
      device x installation x [from, ) with from = the observed install date.
    VERIFY: exactly 20 placements proposed, and no device appears twice.
    ⛔ ABORT IF any device would get two open placements. The temporal key
       would reject it at write time; better to find it here.

 ── STOP 1. Everything above is read-only. Below writes. ──

 4. WRITE THE DEVICE ROWS — 35 of them.
    VERIFY: 35 rows; (vendor, serial) unique where both are present.
    REVERSIBLE: yes, while no placement references them.

 ── STOP 2. Confirm 35 device rows before any placement. ──

 5. WRITE THE OPEN PLACEMENTS — 20 of them.
    VERIFY: 20 open placements; the temporal key accepted every one.
    ⛔ ABORT IF the constraint rejects any write — that means two open
       placements for one device, which is the exact ambiguity item 8 fixes.
       Do not force it.
    REVERSIBLE IN EFFECT ONLY: a placement can be closed, never deleted
    (decision 13). A wrong placement leaves a closed interval behind
    permanently, so this is the first genuinely irreversible step.

 ── STOP 3. THE ONE-WAY DOOR. Confirm every placement before continuing. ──

 6. WRITE THE DEVICE IDENTITIES — one open row per charger identity.
    VERIFY: resolveIdentity(identityString, now) returns exactly one
      placement for every charger, and `ambiguous_identity` for none.
    ⛔ ABORT IF any identity resolves ambiguously. That is round 3's
       cross-org finding arriving for real.

 7. RECONNECT CHECK — the chargers are live throughout.
      Watch that every charger still authorises.
    ⛔ ABORT IF any charger stops authorising: roll back by closing the
       placements written in step 5 and re-opening the previous mapping.

 8. ONLY THEN: consider flipping enforceAuthorize, per
    docs/notes/2026-08-28-validity-census-and-authorize-switch.md.
    That is a separate procedure with its own five steps and its own aborts.
```

---

## Ordering against A's operator runbook — no contradiction

A's `2026-08-18-first-invoice-operator-runbook.md` governs **closing a period
and issuing an invoice**. This governs **writing the placements that period
will count**.

**The two meet at one rule and they agree on it:** ADR 0054 decision 5 says
billing counts placements *overlapping* the period, not placements current at
billing time. So:

> **The re-onboard must complete before the first period it affects is closed,
> and must not run during a close.**

A device that gains its first placement halfway through a close would be
counted by one run and not the other. **Nothing in either document says
otherwise; this states the joint constraint explicitly so neither drifts.**

**One asymmetry worth naming:** A's runbook can be re-run — closing a period
twice is idempotent by design. **This one cannot.** Step 5 writes intervals
that can only be closed, never removed. That is why steps 1–3 are read-only
and why STOP 3 exists.
