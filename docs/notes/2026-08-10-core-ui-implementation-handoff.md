# Straumvakt Core UI implementation handoff

Status: local visual contract. Iceland-only. No live authentication, pricing persistence, billing, invoice issue, payment, export, or delivery is wired.

## Sixty implementation notes

1. Treat Core as AC charging operations for Icelandic MDUs and workplaces.
2. Display market context as `Iceland / ISK / UTC+0` on commercial views.
3. Keep the subscription formula in one shared code contract.
4. Connector charge is `200 kr x active connectors x month`.
5. Driver charge is `50 kr x active drivers x month`.
6. Total is capped at `450 kr x active connectors x month`.
7. Show uncapped and capped totals together when the cap applies.
8. Never imply that connector or driver counts are already billable facts.
9. Label both count definitions as proposed until backend semantics are approved.
10. Count a driver once per organisation in the visual proposal.
11. Do not invent proration for mid-month activation.
12. Do not aggregate organisation caps by multiplying portfolio totals.
13. Calculate each organisation independently before portfolio aggregation.
14. Keep rate version identifiers immutable once effective.
15. Display effective timestamps in UTC+0.
16. Keep DSO/network and retailer/electricity lines separate.
17. Display the CPO add-on as its own owner-attributed component.
18. Display plug-time fee and grace period together.
19. State the event that starts plug-time charging once the contract exists.
20. Keep settlement rule visible as `Pending` rather than guessing.
21. Mark every fixture rate as demo data.
22. Do not add a Save button before rate persistence exists.
23. A future rate editor needs preview, validation, effective date, and rollback.
24. A rate version change must never rewrite historical CDR material.
25. Driver session lines must retain the rate version used at session time.
26. Call organisation output `billing material` until legal document type is approved.
27. Call driver output `statement material` until invoice ownership is approved.
28. A billing period begins Open and may move to Review, Locked, then Delivered.
29. Lock must be an explicit server command with actor attribution.
30. Lock must refuse incomplete or disputed CDR material.
31. Corrections must be additive adjustment lines, not silent history edits.
32. Every adjustment needs reason, actor, timestamp, amount, and parent line.
33. DSO, retailer, CPO, and plug-time ownership must survive export.
34. Driver totals must reconcile to their visible line items.
35. Organisation totals must reconcile to all driver statements and adjustments.
36. Delivery is separate from period lock.
37. Delivery log needs attempt id, recipient, channel, outcome, and timestamp.
38. Resend must be idempotent and create a new delivery attempt.
39. Do not claim email delivery until a provider result exists.
40. Keep supported Icelandic bank/export format as Unknown.
41. Do not show bank account, payment button, or paid status in this visual lane.
42. Monthly Core reporting includes connectors, drivers, sessions, energy, and billing-material state.
43. Faster telemetry and live operations remain Premium/later.
44. Long raw protocol retention remains Premium/later.
45. Custom accounting, payroll, and settlement integrations remain Premium/later.
46. Vehicle, project, and department allocation remain Premium/later.
47. Contractor/service workflows remain outside launch routes.
48. Driver manual management must distinguish Active and Inactive visibly.
49. Inactive drivers do not contribute to the proposed active-driver count.
50. Access groups define scope; they do not identify a session driver.
51. Manual add-driver remains disabled until the singular onboarding contract is selected.
52. Invite-by-link remains disabled until identity binding is proven end to end.
53. Never reuse an unsafe bearer invite as password recovery.
54. Active charging shows an estimate, not statement or invoice truth.
55. Closed CDR-backed material may become report-ready after integrity checks.
56. A report-ready statement is still not proof of invoice issue or payment.
57. Missing measurements render as unavailable, never numeric zero.
58. Money values carry `Demo / read only` or `provisional` at point of use.
59. Every disabled action needs adjacent dependency copy.
60. Production wiring starts with read contracts and error states, one mutation at a time.

## Rate-control UI contract

Required read model:

| Field | Type | UI rule |
|---|---|---|
| `versionId` | immutable string | Always visible. |
| `effectiveFromUtc` | timestamp | Render UTC+0 and preserve historical value. |
| `networkRateIskPerKwh` | decimal | Label DSO/network owner. |
| `retailerRateIskPerKwh` | decimal | Label electricity retailer owner. |
| `cpoMarginIskPerKwh` | decimal | Label organisation/CPO owner. |
| `plugTimeFeeIskPerMinute` | decimal | Display with grace period. |
| `gracePeriodMinutes` | integer | Display human duration and raw minutes later. |
| `settlementRule` | explicit enum | Render Unknown/Pending until designed. |
| `state` | draft/scheduled/effective/superseded | Never derive from current date alone. |

Future mutation acceptance: preview before save, no overlapping effective windows, immutable effective history, actor attribution, rollback by new version, and tests proving old CDRs keep their original version.

## Billing statement contract

Required statement envelope:

- statement id and organisation id;
- driver id or explicit unattributed state;
- billing period id and state;
- source CDR ids;
- rate version per session;
- energy quantity and owner-separated cost lines;
- plug-time duration, grace and fee line;
- additive adjustments with reason and actor;
- provisional/report-ready/corrected/delivered status;
- generated and delivered timestamps;
- currency fixed to ISK for Core;
- totals that reconcile exactly to visible lines.

Do not include a payment status until Straumvakt owns a real payment contract. Do not call the material an invoice until issuer, tax, numbering, correction, retention, and legal requirements are approved.

## Mobile Driver statement requirements

The Flutter worktree remains read-only for this task. A future mobile slice must implement these exact states:

1. Drawer destination `Monthly statement` after History.
2. Month selector with current draft and prior delivered periods.
3. Summary: sessions, kWh, provisional/report-ready total, and document state.
4. Session rows with place, closed time, kWh, total, and rate-version link.
5. Expandable ownership breakdown: DSO, retailer, CPO, plug time, adjustment.
6. Active-session estimate must say `Estimate - can change`.
7. Closed CDR line must say `Report ready` only after integrity success.
8. Draft, corrected, delivered, offline, denied, unavailable, and empty states.
9. No payment button, card UI, bank claim, or raw telemetry livestream.
10. No statement endpoint call until a versioned mobile contract is approved.
11. Offline cache may show the last verified statement with its sync timestamp.
12. Accessibility: semantic amounts, owner labels, 200% text, and screen-reader order.
13. Screenshot tests at 360, 390, and 430 logical pixels.
14. Contract tests must distinguish null cost from zero cost.
15. Currency minor-unit convention must be explicit and tested before parsing.

## Premium boundaries

Premium/later is represented by absence, not upsell cards: faster telemetry, live operations, custom integrations, advanced accounting/payroll, service/contractor workflows, long raw retention, vehicle/project/department split, and work-pays-my-bill automation.

## Exact disabled and gated copy

- Rate version: `Rate changes are unavailable until versioning, validation and effective-date persistence are approved.`
- Period close: `Closing a period is unavailable until CDR completeness, adjustment and actor-attribution contracts exist.`
- Organisation export: `Supported Icelandic bank and accounting formats are not yet verified.`
- Delivery resend: `Resend is unavailable until recipients, provider outcomes and idempotency are defined.`
- Driver download: `Statement download is unavailable until the document contract and retention policy are approved.`
- Manual driver: `Manual driver creation is unavailable until the singular identity and access workflow is selected.`
- Invite link: `Invite-by-link remains unavailable until identity binding is proven safe end to end.`
- Payment: `Payment is not available in Straumvakt Core UI.`
- Invoice: `This is billing material, not an issued invoice.`
- Telemetry: `Standard telemetry only. Faster live operations are not included in Core.`
