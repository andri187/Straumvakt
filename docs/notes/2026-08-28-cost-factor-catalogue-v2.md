# The cost factor catalogue, revised — discussion only

**Status: NOT IMPLEMENTED. Nothing in this note is built, scheduled or
approved.** It records what was worked out on 2026-08-28 so the reasoning is
not lost. Written from the requirements as they stand tonight — the old
catalogue is cited only to say what changed and why.

**Companions:** `docs/notes/2026-08-28-the-dress-rehearsal.md` (the target and
the visibility model) · `docs/architecture/straumvakt-associations.svg` (the
two axes) · ADR 0054 (assets) · ADR 0055 (the clean slate)

---

## 1. The shape error in the old set

The previous eight factors mixed two different kinds of thing and treated them
as symmetric:

- **DSOF and REPF are costs the meter owner incurs.** The owner is fixed by
  definition — the CPO *is* the registered owner of the e-meter, so they are
  the party the utility bills. There is nothing to decide.
- **Everything else is a price someone levies**, whose owner varies.

That is why the old table felt wrong. The market splits the same way — Monta
carries a *cost price* per charge point alongside a *member price* per driver.

Two further errors, both structural:

- **WRKPF was not a factor at all.** It was defined as "all the cost factors
  the workplace might pay" — which is an *ownership arrangement*, not a thing
  being priced. Under per-factor ownership it is expressed by setting the
  owner. Keeping it would double-model exactly what the ownership axis exists
  for.
- **USRF_PREM was a plan, not a factor.** A premium tier is the same factor at
  a different rate. One factor per SKU makes the catalogue grow forever.

---

## 2. The revised catalogue

### 2.1 Cost side — incurred, owner is always the meter owner

Sourced from published tariffs, never derived by dividing a utility bill: a
meter may also serve non-charging load, so **rate × session kWh is the only
figure that survives being checked.**

| code | was | anchor | shape | note |
|---|---|---|---|---|
| `dso_energy` | DSOF | installation | per kWh, time-of-use capable | the distribution energy charge |
| `dso_capacity` | — **new** | installation | per month, driven by measured peak kW | the regulator describes distribution as *"capacity charges, based on peak usage, and energy charges"* — the capacity half had no factor |
| `dso_fixed` | — **new** | installation | per month, flat | fastagjald |
| `retail_energy` | REPF | installation, via a **dated retailer assignment** | per kWh, ToU | the retailer is chosen and switchable; a static field would silently re-price history on a switch |
| `retail_fixed` | — **new** | installation | per month, flat | |

### 2.2 Charge side — levied, owner variable

Owner is the host, another company, or the driver. **One factor, one owner.**

| code | was | anchor | shape | note |
|---|---|---|---|---|
| `energy` | — | session | per kWh | what is charged onward for energy |
| `energy_uplift` | SPVIVF | session | per kWh | the CPO's margin, kept as its **own line**. Technically it could be folded into `energy`; it is not, because "24,50 = 8,10 DSO + 12,40 retailer + 4,00 CPO" is what survives an aðalfundur |
| `idle` | XTRRF | session | per minute after a grace period | OCPI models this natively as `PARKING_TIME` with a `min_duration` restriction |
| `driver_subscription` | USRF | driver × month | per month | USRF was *intended* monthly and *shaped* per-session. Premium is a rate on this factor, not a separate factor |
| `connector_subscription` | CHRGRF | charger × month | per month | unit rental. **MDU sharing is not multi-owner:** the org owns it and recovers from its members through its own statement — the agent pattern that already exists |
| `guest_session` | — **new** | session | flat and/or per kWh | an unrecognised driver at a workplace. Today they are either refused at the charger or their energy lands silently on the org; both are decisions and neither is made |
| `one_off` | — **new** | any party | a single dated charge | installation, hardware, call-out. No shape exists for a non-recurring, non-session charge |
| `credit` | generalises `cap_relief` | any | **negative** | discount, promotion, goodwill, staff rate. The owner is whoever absorbs it |
| `correction` | `correction` | any | signed | a new line, never a rewrite — FOCUS rule 4 |

### 2.3 Reserved — standard dimensions, deliberately unused

| code | why reserved |
|---|---|
| `session_fee` | OCPI `FLAT`. Once USRF moved to monthly, nothing covers a per-session start fee. Decide in or out |
| `charging_time` | OCPI `TIME` — per minute *while charging*, distinct from idle |
| `reimbursement` | money flowing **to** a driver. The whole split-billing category, and the workplace-pays-for-home differentiator. Not built, but the line shape must not forbid a reversed direction |

### 2.4 Deferred

`payment_processing` (needs cards or guests) · `late_fee` / dunning (collection
side) · reservation and roaming (public charging, out of scope).

### 2.5 Not factors

**Minimum spend** is a rule on a factor, not a factor. **Time-of-use,
day-of-week, min/max kWh, power and duration** are *restrictions* — OCPI treats
every one of them that way, and so should we: tiering is a restriction on a
price component, never a new code.

---

## 3. The rules that go with the catalogue

1. **One factor, one owner.** Sharing is expressed as an org owning a factor
   and recovering from its members — never as a factor with several owners.
2. **The catalogue is runtime data, not an enum.** A new factor is a row plus
   an admin step, not a migration. *(The one idea from the old model that was
   right and is kept.)*
3. **Rates are versioned and dated, never overwritten.** A session prices at
   the rate in force when it started, and is sealed with the rate *version*,
   never with copied prices.
4. **A scrape is evidence, not truth.** A scraped tariff proposes a draft rate
   version; a human activates it. Auto-activation means a website redesign
   silently re-prices a month.
5. **A missing rate is a refusal, not a zero.** Named, surfaced, never a
   silent default.
6. **Fixed costs are recovered by fixed charges, variable by variable.** The
   monthly subscriptions exist to cover the fixed and capacity components; per
   kWh covers per kWh. This avoids allocating an unattributable cost across
   sessions, and keeps the per-kWh number auditable against the DSO's own
   published tariff.
7. **Ownership is per driver, defaulting from the group, overridable, dated,
   and sealed at session start.** Access and cost are separate axes; a billing
   difference never forces a new access group.

---

## 4. Three missing *shapes* — the real gap

Naming factors is the easy half. Every factor in the current system is
per-session or per-month, positive, and flows one direction. The market needs
all three broken:

1. **One-off** — a single dated charge against a party.
2. **Negative** — credits and discounts.
3. **Reversed** — reimbursement, money toward a driver.

These are schema properties. Discovering later that every amount is implicitly
positive and recurring is the expensive kind of retrofit.

---

## 5. What is deliberately not decided here

The **rates themselves**, and whether the rehearsal bills the dweller or only
the host. Both wait for real CDRs from real drivers — deciding a price before
that data exists is guessing with extra steps.
