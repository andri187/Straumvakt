# Core UI copy and accessibility fallback review

Status: **Candidate - native review required.** These variants are a terminology handoff, not approved Icelandic product copy. English remains the rendered local-demo language until a native reviewer approves a complete set.

## Icelandic-first / English-supporting candidates

| ID | Context | Icelandic candidate | English support | Review risk |
|---|---|---|---|---|
| COPY-01 | Product | Straumvakt Core | Straumvakt Core | Brand term; keep unchanged. |
| COPY-02 | Scope | Rekstur AC-hleðslu á Íslandi | AC charging operations in Iceland | Confirm MDU/workplace nuance. |
| COPY-03 | Connector charge | 200 kr á virkt tengi á mánuði | 200 kr per active connector per month | Define `virkt` contractually. |
| COPY-04 | Driver charge | 50 kr á virkan ökumann á mánuði | 50 kr per active driver per month | Define access/CDR counting. |
| COPY-05 | Cap | Hámark 450 kr á tengi á mánuði | Capped at 450 kr per connector per month | Make per-org application explicit. |
| COPY-06 | DSO | Dreifiveita / netgjald | DSO / network charge | Validate market terminology. |
| COPY-07 | Retailer | Raforkusali / raforkugjald | Electricity retailer / energy charge | Validate owner wording. |
| COPY-08 | CPO | Álag rekstraraðila | CPO add-on | Avoid implying tax treatment. |
| COPY-09 | Plug time | Stæðisgjald eftir biðtíma | Plug-time fee after grace period | Confirm parking vs connection meaning. |
| COPY-10 | Effective | Gildir frá | Effective from | Always pair with UTC+0 time. |
| COPY-11 | Draft | Drög að uppgjörsgögnum | Draft billing material | Do not translate as invoice. |
| COPY-12 | Ready | Tilbúið til skýrslugerðar | Report ready | Not issued, delivered or paid. |
| COPY-13 | Adjustment | Leiðrétting | Adjustment / correction | Preserve original statement lineage. |
| COPY-14 | Delivery | Afhending í vinnslu | Delivery pending | Not proof of recipient receipt. |
| COPY-15 | Active driver | Virkur ökumaður | Active driver | Billing definition required nearby. |
| COPY-16 | Inactive driver | Óvirkur ökumaður | Inactive driver | Do not imply deleted identity. |
| COPY-17 | Access group | Aðgangshópur | Access group | Scope, not identity attribution. |
| COPY-18 | Invite gate | Boðstengill ekki tiltækur | Invite link unavailable | Explain identity-binding dependency. |
| COPY-19 | Estimate | Áætlun - getur breyst | Estimate - can change | Required during active charging. |
| COPY-20 | Payment | Greiðsla ekki í boði | Payment is not available | Core has no live payment contract. |

## 200% text and zoom review

The 390, 768 and 1280 px screenshots prove the base responsive layout and report no horizontal page overflow. This is not a substitute for device verification at 200% browser zoom or Android/iOS text scaling.

Source review findings:

1. Page structure uses semantic headings, navigation, tables, status notes and labelled regions.
2. Drawer controls have explicit accessible names and the table filter has a visually hidden label.
3. Disabled commands are real disabled buttons with adjacent dependency copy.
4. The new Core contract grid collapses from four to two to one column at 980/860/430 breakpoints.
5. Forced-colors mode now includes the Core contract border.
6. Reduced-motion mode removes the drawer transition.
7. Tables use a named horizontal scroll region, captions and column headers.
8. Most typography uses fixed pixel sizes. Browser zoom should scale it, but text-only scaling behavior needs real-browser and device evidence.
9. Compact 8-10 px metadata may be too small for repeated operational use even when contrast passes; review at normal and 200% zoom.
10. Amounts visually include currency, but future screen-reader semantics must announce amount, currency, owner and provisional state once.

## Second-pass false-claim audit

| Claim surface | Result | Required guard |
|---|---|---|
| Bank integration | Absent | Keep export format `Unknown` until researched. |
| Payment state | Absent | Never infer paid from delivery or period lock. |
| Issued invoice | Absent | Call output billing material or statement until legal contract exists. |
| Live billing | Absent | Every amount remains demo/read-only or provisional. |
| Live telemetry | Absent | Standard telemetry status only; no raw stream claim. |
| Email receipt | Not claimed | Delivery log is fixture state, not provider evidence. |
| Safe invite link | Not claimed | Control stays disabled pending identity-bound backend. |
| Period close | Not claimed | Control stays disabled pending CDR completeness and attribution. |
| Production calculation | Not claimed | Formula and counts are local fixtures with proposed definitions. |
| Premium inclusion | Absent | Premium capabilities remain outside Core navigation. |

## Native-review acceptance

- approve terms as one set, not string by string;
- test sentence case, plurals and long organisation names;
- preserve `ISK`, `kr`, kWh and UTC+0 consistently;
- prohibit invoice/payment synonyms from weakening the product boundary;
- test English support copy against the exact same state machine;
- run screen-reader and 200% text checks after translated strings land.
