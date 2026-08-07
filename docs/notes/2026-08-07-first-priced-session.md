# The agreements ledger prices its first session

**2026-08-07 · test branch (`br-withered-hat-abtc5gzi`) only · nothing applied to staging**

`agreements.billing_lines` held 0 rows for three months while a cron fired
every minute. It now holds 128, for 64 sessions, priced against Veitur and
N1 Rafmagn. This is what was in the way.

---

## Three bugs, stacked

They had to be removed in order. Each one hid the next, and all three
produced the same symptom from outside: an empty table and a quiet log.

### 1. Nothing was attributable — `scanned 0`

The tick requires `user_id` on a session. 8 of 1,619 completed sessions had
one, and the newest was 2026-05-13 — 86 days old, well outside the 30-day
window. So the query matched nothing.

But the sessions carried an RFID. `EE43C609263CC7` belongs to `driver@n1.is`
and `identity.id_tokens` has always known that; the link was simply never
made at session-stop.

```
completed sessions          1,619
...with any id_tag             89
...already attributed           8
...RESOLVABLE right now        56   <- exact id_tokens.value match
...tag unknown                 25
...no tag at all            1,530
```

`backfill-session-user-from-idtag.ts` filled 57. Then
`purge-unattributable-test-sessions.ts` deleted the 1,554 that carried no tag
or a foreign one — permanently, per operator instruction, as logged test
data. 79 sessions remain.

### 2. Every clause failed validation — `scanned 64, errors 64`

With input finally arriving, the resolver rejected all of it:

```
invalid_value at passthrough.splits[0].bearer_type
expected one of "org"|"usr"|"wrk"|"trd"
```

Every `allocation_json` in the database says `"bearer_type": "USR"`.
Uppercase.

ADR 0019 §Allocation writes its JSON examples uppercase, and
`migrate-to-agreements.ts` seeded from those examples. The Postgres enum
`agreements."BearerType"` and the `BEARER_CODES` constant the resolver
validates against are lowercase — as is the sibling column
`default_bearer_type`, on the very same row.

`allocation_json` is JSONB. Nothing in the database constrained it, so the
two halves of one ADR were free to disagree, and did, for three months.

**The resolver rejected every clause it was ever handed.** No test caught it
because no test fed it a real seeded row, and no operator caught it because
bug 1 meant the resolver was never reached.

Fixed on both ends:

- **Reader** (`types.ts`) lowercases before validating. "USR" and "usr" name
  the same bearer, so this is not a semantic change — and it means the rows
  already seeded uppercase resolve without a data migration against staging.
  An unknown code is still rejected; `types.test.ts` pins that.
- **Writer** (`migrate-to-agreements.ts`) emits lowercase from here.

### 3. The money pointed at the wrong parties

The tick then emitted 128 lines — with the recipients wrong on both legs.

| leg | was | is |
|---|---|---|
| **DSO** `VEITUR-AD1` | `supplier_org_id` **NULL** — seeder comment: *"Veitur ohf — not seeded as an Organization row"* | **Veitur**, `f5f003d9`, roles `{dso}` |
| **ELE** `N1-RAFMAGN-REPF-01` | **N1 ehf**, roles `{cpo,site_host}` — the charger host | **N1 Rafmagn**, `e8c0d219`, roles `{retailer}` |

Veitur *is* seeded, and has been. And the retailer leg was crediting the
site host — a different kennitala from the org the rate code is named for.

Distribution revenue went to nobody; energy revenue went to the landlord.
Neither surfaced because no line had ever been emitted to carry the error.

---

## The ledger

```
DATABASE_URL=... npm run script -- run-billing-tick.ts --since 120 --batch 200
  window   120 days
  scanned  64
  emitted  128
  existed  0
  denied   none
```

| factor | paid to | role | paid by | kWh | kr/kWh | ex VAT | VAT 24% | inc VAT |
|---|---|---|---|---:|---:|---:|---:|---:|
| **DSO** | Veitur | `dso` | driver | 889.3 | 8.64 | 7,683.64 | 1,844.06 | **9,527.70** |
| **ELE** | N1 Rafmagn | `retailer` | driver | 889.3 | 8.83 | 7,852.63 | 1,884.64 | **9,737.27** |
| | | | | | | **15,536.27** | **3,728.70** | **19,264.97 ISK** |

All 128 lines resolve to one payer — `driver@n1.is`, 64 sessions, 19,264.97
ISK — under agreement **"Dalvegur 10 - 14 — operating costs"**
(`213265ec`, type `installation`, counterparty N1 ehf, installation
`37de71e8`). 21.66 kr/kWh inc VAT.

The scenario as described is now fully wired: driver → RFID → driver group →
agreement → installation → two clauses → two rate references → two suppliers.

8 of the 64 sessions are 0 kWh and correctly price to zero. Largest is
48.977 kWh.

---

## Two things left open

**`bearer_ref` is NULL on all 128 lines.** `bearer_type` is `usr`, so the
payer is derivable by joining `session_id → sessions.user_id` — which is how
the per-payer total above was produced. It works, but the ledger does not
name its payer on its own row, and any `org`/`trd` bearer would need the ref
populated. Pricing logic; not touched.

**The same three fixes are unapplied on staging.** Staging still has
uppercase allocations (which the reader fix now tolerates), NULL and
mis-pointed suppliers (which it does not), and 1,619 sessions of which 56 are
resolvable. All of it is Rule 5 or a data migration. Needs go-ahead.

---

## Also fixed on the way

`scripts/run.mjs` — none of the operator scripts in `apps/api/scripts/` could
run at all under Node 24. The generated Prisma client exports `PrismaClient`
as both a const and a same-named type; Node's native type-stripper erases the
pair, and the import fails with *"does not provide an export named
PrismaClient"*. Vitest transforms it correctly, which is why `test/parity/`
worked and the scripts did not.

Bundling with esbuild first sidesteps it. `npm run script -- <file.ts>`.

This is the same wall `shadow-compare-resolvers.ts` hits — **CO-3, the
go-gate in [ADR 0048](../adr/0048-billing-cutover-resolved-agreements-survives.md)
step 2.** It should run now.
