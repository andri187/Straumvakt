# Samgöngustofa Bifreiðatölur — Power BI recon

**Local research only.** Read-only against a public, unauthenticated Power BI
report. Nothing published, deployed, pushed or mutated.

**Verdict: postal × month × drivetrain is answerable, and so is make/model.**
A working extractor exists and has produced real rows.

---

## Source and access

| | |
|---|---|
| Page | `https://bifreidatolur.samgongustofa.is/#nyskraningar` |
| Fleet page (not yet used) | `https://bifreidatolur.samgongustofa.is/#tolfraedi` |
| Cluster host | `https://wabi-europe-north-b-api.analysis.windows.net` |
| Resource key | `fbe0697d-bd90-4f90-a80f-16d048b0d696` |
| Model id | `2897309` |
| Dataset id | `b7ba0181-de36-42b8-83de-62658478c922` |
| Entity | `Query1` — **28 fields**, 6 entities in the schema |
| Header | `X-PowerBI-ResourceKey: <resource key>` |

Conceptual schema and `querydata?synchronous=true` both confirmed working.

---

## Corrections to the working assumptions

Three things in the brief were wrong or incomplete. Each cost a debugging cycle,
so each is recorded.

### 1. The fuel labels are not the assumed forms

The brief listed `Bensín rafmagn tengill`. The report actually emits
**`Bensín /Raf.tengill`** — slash, abbreviation, different spacing. A map built on
the assumed strings maps **nothing**, and every vehicle silently becomes
`UNKNOWN`. The full discovered set, with whole-dataset counts:

| Label | Count | Group |
|---|---|---|
| Dísel | 105,353 | ICE |
| Bensín | 90,842 | ICE |
| **Rafmagn** | **45,117** | **BEV** |
| **Bensín /Raf.tengill** | **28,965** | **PHEV** |
| Bensín /Rafmagn | 20,970 | HYBRID_NON_PLUGIN |
| **Vélarlaus** | **17,631** | **NON_MOTORISED** |
| Óþekkt | 3,502 | UNKNOWN |
| Dísel /Rafmagn | 2,178 | HYBRID_NON_PLUGIN |
| Bensín /Metan | 1,484 | OTHER |
| **Dísel /Raf.tengill** | **1,360** | **PHEV** |
| Metan · Vetni /Rafmagn · Vetni · Bensín /Própan · Dísel /Metan · Metanól /Bensín | 482 | OTHER |
| (null) | 17 | UNKNOWN |

**`Vélarlaus` means engineless — those 17,631 rows are trailers, not vehicles.**
Counting them in a market total would overstate it by roughly 5%. They are now a
distinct `NON_MOTORISED` group rather than being folded anywhere.

### 2. `Top` and `DataReduction` are mutually exclusive

Sending both returns **zero rows** with
`QueryTopWithDataReduction: "Data reduction is forbidden if the top clause is
used."` The row limit must be expressed **only** as a binding window.

### 3. Errors hide behind a key whose *name* contains a dot

The failure above arrived as `dsr.DataShapes[0]["odata.error"]` — a single key
named `odata.error`, not a nested path. Reading it as `?.odata?.error` yields
`undefined`, the call looks successful, and you get an empty result set with no
explanation. **This is the trap most likely to waste someone's afternoon.**

### 4. DSR decoding needs the dictionary name from the row schema

Grouped columns are dictionary-encoded. The dictionary name lives on the first
row's `S` array as `DN` (`"D0"`, `"D1"`), **not** on `descriptor[i].Value`
(`"G0"`, `"G1"`). Key off the descriptor and every label comes back as a bare
integer index — fuel arrives as `0..10` and reads like real data. `R` is a
bitmask of columns *repeated from the previous row*, absent from `C` entirely, so
the read cursor must not advance for them.

---

## Queries that work

| Grouping | Result |
|---|---|
| `P_ZIPCODE` + Count | ✅ postal 101 = 8,494; 102 = 6,054; 103 = 2,087 |
| `Orkugjafi` + Count | ✅ 16 labels + null, counts above |
| `P_ZIPCODE + Nýskránd. + Orkugjafi` + Count | ✅ **the primary extractor** |
| `Tegund` + Count | ✅ make, e.g. `4-STAR`, `ADRIA` |
| `Ökutækisflokkur` + Count | ✅ **available**, e.g. `Dráttarvél3` |
| `P_ZIPCODE + Tegund + Undirtegund + Orkugjafi` + Count | ✅ **make/model by postal and fuel** |

## Queries that fail

| | |
|---|---|
| `Ár - ísl.`, `Mánuður - ísl.` | Present in the schema, unusable in a query — Icelandic helper-column reference handling. **Year and month are derived from `Nýskránd.` instead**, which works. |
| Any query with both `Top` and `DataReduction` | `QueryTopWithDataReduction` |

---

## Answers to the questions asked

| Question | Answer |
|---|---|
| Count by postal code for a selected month/year? | **Yes** |
| BEV/PHEV/ICE ratio by postal × month? | **Yes** |
| Make/model/subtype by postal × month? | **Yes** — `Tegund` + `Undirtegund` group cleanly |
| Is `Ökutækisflokkur` available? | **Yes** |
| Aggregate or vehicle-level? | **Vehicle-level.** `Fastanr` is a per-vehicle key and `Count(Fastanr)` over `P_ZIPCODE + Nýskránd. + Orkugjafi` returns granular rows. That is why arbitrary grouping works at all. |

---

## Rows produced

`out/vehicle_postal_month_drivetrain_sample.csv` — **865 aggregated rows**, 12
columns, 4,027 vehicles, 200 distinct months, **2 postal codes**.

By drivetrain: ICE 3,146 · BEV 281 · PHEV 267 · HYBRID_NON_PLUGIN 162 ·
NON_MOTORISED 126 · OTHER 42 · UNKNOWN 3.

**Only 2 postal codes because the 4,000-row window is exhausted by them.** Rows
come back ordered by postal, and each postal spans ~200 months × up to 16 fuel
labels. This is a deliberate sample proving correctness, not a harvest.

---

## Remaining blockers

1. **Paging is not yet understood.** A full harvest needs either
   `Binding.Primary.Window` with a `RestartTokens` continuation, or per-postal
   filtering. Roughly 160 postal codes × 200 months × up to 16 fuels bounds the
   full set at ~500k grouped rows before aggregation.
2. **Postal-code geometry is absent.** No centroids or polygons, so no map.
3. **Null postal exists** — 3,558 vehicles with no `P_ZIPCODE`. They must be
   reported as a known bucket, never silently dropped.
4. **`#tolfraedi` (fleet stock) is untouched.** Its semantics — stock vs
   registrations — are unproven, so `vehicle_fleet_monthly` stays future work.

## Exact next step

Add filtered extraction: `where P_ZIPCODE = <code>`, looped over the postal list
obtained from a single `P_ZIPCODE`-only query. That sidesteps paging entirely,
keeps every request small, and is the shortest path to a complete dataset.

**A Samgöngustofa export request is not needed.** Everything asked for is
reachable through the public report.

## Attribution

Data © Samgöngustofa, from the public Bifreiðatölur report. Any published figure
must credit Samgöngustofa and link the source page. This extraction is local
research and has not been published.
