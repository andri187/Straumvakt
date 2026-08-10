# Straumvakt Core UI drift audit

Scope: local `/login-demo`, `/app/admin/*`, `/app/org/*`, `/app/driver/*`, `/visual`, and the read-only Flutter Driver source. Locked frame: Iceland-only AC charging operations for MDUs and workplaces.

## Census

The audit records 80 source-shaped findings: 30 implemented/planned UI changes, 20 Premium boundaries, 20 backend gates, and 10 keep/verify decisions. A visual state is not evidence that its backend contract exists.

| ID | Surface | Finding | Class | Disposition |
|---|---|---|---|---|
| 01 | Login demo | Iceland-only market was not visible at role entry. | Change | Add Iceland / ISK / UTC+0 to Core application views. |
| 02 | Admin nav | No locked Core product destination existed. | Change | Add Core product view. |
| 03 | Admin nav | Connector/driver subscription pricing was absent. | Change | Add Core pricing view. |
| 04 | Admin nav | Standard telemetry had no explicit Core boundary. | Change | Add Standard telemetry view. |
| 05 | Admin nav | Backend readiness mixed product and release language. | Change | Add Core readiness view. |
| 06 | Admin pricing | 200 kr connector rate was absent. | Change | Render read-only formula. |
| 07 | Admin pricing | 50 kr active-driver rate was absent. | Change | Render read-only formula. |
| 08 | Admin pricing | 450 kr per-connector cap was absent. | Change | Render capped and uncapped examples. |
| 09 | Admin pricing | High-driver/low-connector consequence was unclear. | Change | Show Demo North cap application. |
| 10 | Admin pricing | Active connector definition was unstated. | Change | Show proposed backend-gated definition. |
| 11 | Admin pricing | Active driver definition was unstated. | Change | Show unique-driver proposed definition. |
| 12 | Admin pricing | Portfolio examples could drift by screen. | Change | Use one deterministic pricing function. |
| 13 | CPO nav | Organisation subscription price was absent. | Change | Add Core subscription view. |
| 14 | CPO nav | DSO and retailer rates were not grouped. | Change | Add Energy rates view. |
| 15 | CPO rates | CPO add-on ownership was unclear. | Change | Show CPO component separately. |
| 16 | CPO rates | Plug-time fee lacked grace context. | Change | Show fee and grace together. |
| 17 | CPO rates | Effective-date version was absent. | Change | Show ISK version and UTC date. |
| 18 | CPO billing | Monthly bundle did not exist. | Change | Add Billing material view. |
| 19 | CPO billing | DSO/retailer/CPO/plug-time ownership was collapsed. | Change | Add owner-separated lines. |
| 20 | CPO billing | Correction notes were not represented. | Change | Add explicit adjustment line. |
| 21 | CPO billing | Period close state was missing. | Change | Add open/review/locked visual lifecycle. |
| 22 | CPO delivery | Delivery evidence was absent. | Change | Add Delivery log view. |
| 23 | CPO delivery | Unknown export format could look supported. | Change | Show format unknown state. |
| 24 | CPO reports | Monthly Core report was absent. | Change | Add Monthly reporting view. |
| 25 | CPO drivers | Active/inactive billing distinction was weak. | Change | Add counts and proposed definition. |
| 26 | CPO access | Access groups were spread across concepts. | Change | Add Access groups view. |
| 27 | CPO access | Manual add-driver intent was not visible. | Change | Add disabled manual workflow action. |
| 28 | Driver nav | Monthly statement was absent. | Change | Add CDR-backed statement view. |
| 29 | Driver cost | Rate owner breakdown was absent. | Change | Add Cost breakdown view. |
| 30 | Driver trust | Estimate/report/invoice states could blur. | Change | Add Report-ready distinction view. |
| 31 | Core | Faster telemetry must not appear included. | Premium boundary | Keep standard cadence only. |
| 32 | Core | Live-operations streaming is later. | Premium boundary | Hide live-stream controls. |
| 33 | Core | Custom charger integrations are later. | Premium boundary | Do not add integration marketplace. |
| 34 | Core | Advanced accounting integrations are later. | Premium boundary | Keep export format unknown. |
| 35 | Core | Payroll integration is later. | Premium boundary | Do not show payroll allocation. |
| 36 | Core | Contractor/service workflow is later. | Premium boundary | Keep Service outside launch routes. |
| 37 | Core | Long raw protocol retention is later. | Premium boundary | Show Not Core retention. |
| 38 | Core | Vehicle/project split is later. | Premium boundary | Do not add allocation dimensions. |
| 39 | Core | Department split is later. | Premium boundary | Do not add cost-centre controls. |
| 40 | Core | Work-pays-my-bill automation is later. | Premium boundary | Do not show employer reimbursement. |
| 41 | Admin | Cloud controls are not Core UI. | Premium boundary | Keep absent. |
| 42 | Admin | Cross-product custom reports are later. | Premium boundary | Keep monthly standard report. |
| 43 | CPO | Real-time power optimisation is later. | Premium boundary | Keep standard telemetry status. |
| 44 | CPO | Custom settlement adapters are later. | Premium boundary | Show placeholder only. |
| 45 | CPO | Automated bank reconciliation is later. | Premium boundary | Do not show reconciliation. |
| 46 | CPO | Bespoke invoice templates are later. | Premium boundary | Keep material bundle generic. |
| 47 | Driver | Raw OCMF/protocol payload is not Driver Core UI. | Premium boundary | Keep evidence summarized. |
| 48 | Driver | Live telemetry charting is later. | Premium boundary | Show observed values only. |
| 49 | Driver | In-app payment is not Core. | Premium boundary | Show payment unavailable. |
| 50 | Mobile | Service tools do not belong in Driver app. | Premium boundary | Keep role surface separate. |
| 51 | Pricing | Active connector month-boundary semantics are undefined. | Backend gate | Require billing-count contract. |
| 52 | Pricing | Active driver access/CDR semantics are undefined. | Backend gate | Require billing-count contract. |
| 53 | Pricing | Mid-month activation proration is undefined. | Backend gate | Do not calculate proration. |
| 54 | Pricing | Multi-org driver de-duplication needs ownership rules. | Backend gate | Count per organisation only in proposal. |
| 55 | Rates | Authoritative Icelandic DSO source is unverified. | Backend gate | Keep demo label. |
| 56 | Rates | Retailer source and tax handling are unverified. | Backend gate | Keep demo label. |
| 57 | Rates | Effective-date persistence is absent. | Backend gate | Disable create version. |
| 58 | Rates | Settlement rule is undefined. | Backend gate | Show pending placeholder. |
| 59 | Rates | Plug-time clock start event needs contract. | Backend gate | Do not calculate live fee. |
| 60 | Rates | Grace-period override rules need contract. | Backend gate | Keep read-only fixture. |
| 61 | Billing | CDR close/immutability contract is not wired. | Backend gate | Keep period open. |
| 62 | Billing | Invoice issuer and legal document type are undefined. | Backend gate | Call output billing material. |
| 63 | Billing | Adjustment authorisation is undefined. | Backend gate | Show correction note only. |
| 64 | Billing | Period lock command is absent. | Backend gate | Disable lock action. |
| 65 | Delivery | Organisation delivery recipient contract is absent. | Backend gate | Keep demo address out of UI. |
| 66 | Delivery | Resend and idempotency contract is absent. | Backend gate | Disable resend. |
| 67 | Export | Supported Icelandic bank format is unknown. | Backend gate | Show Unknown. |
| 68 | Export | Accounting export schemas are unverified. | Backend gate | Disable export. |
| 69 | Invite | Identity-bound safe invite link is not available. | Backend gate | Keep invite disabled. |
| 70 | Mobile | Statement endpoint and offline cache contract are absent. | Backend gate | Deliver exact mobile spec only. |
| 71 | Login demo | Reserved `.test` fixture identities are honest. | Keep/verify | Preserve. |
| 72 | App shell | Persistent local/no-auth banner is clear. | Keep/verify | Preserve. |
| 73 | Admin support | Assistance is not impersonation. | Keep/verify | Preserve warning. |
| 74 | CPO onboarding | Unsafe bearer invitation remains withheld. | Keep/verify | Preserve disabled state. |
| 75 | Driver active | Observed power is labelled, not inferred from zero. | Keep/verify | Preserve. |
| 76 | Driver active | Current cost is provisional. | Keep/verify | Preserve point-of-use label. |
| 77 | Tables | Captions and scoped headings are present. | Keep/verify | Preserve semantics. |
| 78 | Responsive | 860 px drawer prevents tablet overflow. | Keep/verify | Re-test new screens. |
| 79 | Accessibility | Reduced-motion and forced-colour fallbacks exist. | Keep/verify | Extend to Core panel. |
| 80 | Mobile | Current Driver UI remains untouched by this visual lane. | Keep/verify | Use implementation specification. |

## Audit conclusion

The largest prior drift was not visual polish. It was the absence of the commercial model that defines Core. The new local views make that model reviewable while preserving the more important truth: billing counts, rate sources, period close, document status, delivery, export, and safe invitation still require contracts before any action can be enabled.
