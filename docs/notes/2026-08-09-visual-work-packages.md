# Straumvakt visual work packages

These forty packages convert the local concept into implementation-sized visual work. Each package remains frontend-only until its named data contract is approved. `B` means backend dependency later; it is not permission to build it now.

| ID | Screen | Goal and interaction | Accessibility and responsive acceptance | B later / rollback |
|---|---|---|---|---|
| A01 | Admin overview | Scan portfolio health and open the task queue. | Ordered headings; 390 px stacks without overflow. | Aggregates / keep demo route only. |
| A02 | Organisations | Compare onboarding state and ownership. | Status text never colour-only; table scroll contained. | Organisation read model / disable row links. |
| A03 | Fleet oversight | Surface systemic charger exceptions. | Stable metrics; keyboard table region. | Fleet aggregate / show unavailable state. |
| A04 | Support context | Explain attributed assistance and expiry. | Warning precedes action; disabled action explained. | Support-context persistence / keep disabled. |
| A05 | Risks | Separate launch, beta, and field risks. | Severity has text; zoom keeps columns readable. | Risk register / static packet link. |
| A06 | Activity | Distinguish product events from audit evidence. | Missing values use an em dash and explanation. | Canonical audit read / no export. |
| A07 | Beta readiness | Present product evidence, owners, and stops. | Checklist labels remain visible at 200%. | Release evidence / printable demo. |
| A08 | Staff tasks | Prioritise by consequence, age, next action. | Current assignment announced; mobile list first. | Task service / no mutation. |
| A09 | Admin mobile nav | Reach every destination with one menu. | Named open/close/scrim; focus order remains logical. | None / retain static navigation. |
| A10 | Admin empty states | Show no organisations, tasks, or evidence honestly. | Empty copy states what can happen next. | Read contracts / fixture toggle. |
| C01 | CPO overview | Summarise one organisation's operations. | Tenant name is first-context signal. | Tenant aggregates / demo tenant. |
| C02 | Chargers | Scan status and enter one asset. | Status has text; columns retain headers. | Charger inventory / read-only table. |
| C03 | Sites | Separate places from electrical installations. | Relationship labels survive mobile stacking. | Site/install model / disable add. |
| C04 | Drivers | Find membership, group, and access state. | No national ID displayed; search is labelled. | Driver roster / no profile link. |
| C05 | Access requests | Approve or deny a specific scope with reason. | Decision controls need labelled confirmation. | Request workflow / keep review disabled. |
| C06 | Sessions | Show live/completed records without invented values. | Provisional and missing values are explicit. | Session reads / no derived telemetry. |
| C07 | Agreements | Read terms and cost factors without assignment. | Read-only state precedes disabled action. | Commercial contract / omit mutation. |
| C08 | Settings | Organise stable tenant profile controls. | Form groups require labels and error summaries. | Settings APIs / present read-only data. |
| C09 | Onboarding | Withhold unsafe bearer invitations visibly. | Safety notice is adjacent to disabled action. | Identity-bound invite / no submission. |
| C10 | CPO empty states | Cover new tenant, no chargers, no drivers. | Each state names owner and next valid action. | Onboarding status / fixtures. |
| D01 | Guest | Explain account value without claiming affiliation. | Sign-in is the sole primary action. | Authentication / local guest remains. |
| D02 | No access | Show registered but unaffiliated state. | Identity and access are distinct in copy. | Relationship read / refresh only. |
| D03 | Invite/access | Show identity-bound joining and pending approval. | Step state announced; no fake completion. | Invite/request contracts / disabled submit. |
| D04 | Chargers | Show availability, price, and distance before action. | Price has units; availability not colour-only. | Entitled charger read / unavailable state. |
| D05 | Active session | Keep energy, observed power, time, and cost together. | Values have labels; provisional cost stated. | Live session / remove absent tiles. |
| D06 | History | Distinguish completed, processing, and settled. | Row status spoken as text; pagination keyboard-safe. | History/detail APIs / empty history. |
| D07 | Account/privacy | Show relationships and governed destructive actions. | Destructive control has confirmation and recovery copy. | Profile/deletion / keep disabled. |
| D08 | Installation code | Present code, passphrase, approval lifecycle. | Fields need visible labels and error summary. | Access-code workflow / concept only. |
| D09 | Help | Route by current session and site context. | Contact owner and expected response are explicit. | Case creation / static guidance. |
| D10 | Driver empty/error | Cover offline, denied, expired, and no-session states. | Recovery action remains reachable at 390 px. | Error envelope / local fixtures. |
| S01 | Service queue | Show assigned work ordered by safety and SLA. | Future label is persistent; urgency uses text. | Assignment model / concept only. |
| S02 | Assigned chargers | Limit assets to explicit assignments. | Scope statement remains in navigation and page. | Contractor authorisation / no fleet browse. |
| S03 | Service case | Combine scope, safety, contact, and evidence. | Safety stop precedes accept control. | Case contract / disabled accept. |
| S04 | Diagnostics | Translate signals while retaining raw codes. | Signal name, value, age, source all labelled. | Diagnostic read / fixture-only. |
| S05 | Site visit | Guide sequential field checks with hard stops. | Checklist works one-handed and at 200%. | Visit workflow / disabled start. |
| S06 | Evidence | Bind media/readings to case and provenance. | Capture alternatives and permission states shown. | Upload/evidence / no file access. |
| S07 | Settlement | Separate labour, material, travel, and driver money. | Currency and ownership labels are explicit. | Service commercial model / placeholder. |
| S08 | Handoff | Transfer responsibility without losing safety state. | New owner and missing evidence are announced. | Handoff contract / disabled request. |
| S09 | Service mobile nav | Keep assignment and safety within thumb reach. | Drawer controls named; no hidden focus trap. | None / static nav. |
| S10 | Service empty/error | Cover unassigned, offline, revoked, and closed cases. | Revoked scope removes sensitive content immediately. | Assignment/error contracts / fixtures. |

## Dependency order

1. Approve persona and tenancy contracts before replacing fixtures.
2. Wire read-only aggregates and lists before enabling any mutation.
3. Prove empty, loading, unavailable, and revoked states with contract tests.
4. Add one mutation at a time with audit attribution, confirmation, and rollback.
5. Keep Service UI behind a future flag until assignment-scoped authorisation exists.
