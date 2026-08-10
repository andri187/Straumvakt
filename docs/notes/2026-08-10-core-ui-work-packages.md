# Straumvakt Core UI integration work packages

One hundred issue-ready packages. A package marked `Approval` changes product/backend behaviour and must not be inferred from the visual implementation.

| ID | Area | Scope | Acceptance | Dependency / gate |
|---|---|---|---|---|
| CORE-01 | Product | Adopt Iceland-only Core scope. | Core and Premium capability lists approved. | Product approval. |
| CORE-02 | Pricing | Adopt connector billing definition. | Month boundary, demo exclusion and status transitions tested. | Approval. |
| CORE-03 | Pricing | Adopt active-driver billing definition. | Access/CDR rule and de-duplication tested. | Approval. |
| CORE-04 | Pricing | Implement shared Core calculator. | 200 + 50 and 450 cap vectors match UI fixtures. | CORE-02/03. |
| CORE-05 | Pricing | Define proration policy. | Mid-month connector and driver examples approved. | Product/legal. |
| CORE-06 | Pricing | Build organisation count snapshot. | Immutable period snapshot with source evidence. | CORE-02/03. |
| CORE-07 | Pricing | Build organisation Core charge read. | Capped/uncapped lines reconcile. | CORE-04/06. |
| CORE-08 | Pricing | Build Admin portfolio pricing read. | Sum uses per-org caps, not aggregate cap. | CORE-07. |
| CORE-09 | Web Admin | Wire Core product read model. | Loading/empty/error/ready states tested. | CORE-08. |
| CORE-10 | Web CPO | Wire subscription explanation. | Organisation-only counts and formula visible. | CORE-07. |
| RATE-01 | Rates | Identify Icelandic DSO source contract. | Owner, units, tax and validity documented. | Research/approval. |
| RATE-02 | Rates | Identify retailer source contract. | Owner, units, tax and validity documented. | Research/approval. |
| RATE-03 | Rates | Define CPO margin semantics. | Inclusive/exclusive tax and rounding approved. | Commercial approval. |
| RATE-04 | Rates | Define plug-time start event. | Plug, charge-end and disconnect examples tested. | Protocol/product. |
| RATE-05 | Rates | Define grace-period semantics. | Boundary minute and override cases tested. | Product approval. |
| RATE-06 | Rates | Define settlement rule enum. | Unknown is valid; unsupported rules rejected. | Billing architecture. |
| RATE-07 | Rates | Persist immutable rate versions. | No overlapping windows; history unchanged. | RATE-01..06. |
| RATE-08 | Rates | Add rate-version preview command. | Diff, validation and actor shown before save. | RATE-07. |
| RATE-09 | Web CPO | Wire rate-stack read. | DSO/retailer/CPO/plug-time owners visible. | RATE-07. |
| RATE-10 | Web CPO | Build rate-version editor. | Disabled until preview and rollback tests pass. | RATE-08, Approval. |
| CDR-01 | Billing | Define closed CDR integrity contract. | Meter, timing, identity and tariff evidence explicit. | Billing architecture. |
| CDR-02 | Billing | Preserve session rate version. | Historical session never changes on new rate. | RATE-07/CDR-01. |
| CDR-03 | Billing | Define unattributed session handling. | Statement can preserve cost without naming driver. | Identity decision. |
| BILL-01 | Billing | Define billing-period state machine. | Open/Review/Locked/Delivered transitions tested. | Approval. |
| BILL-02 | Billing | Build period completeness read. | Missing CDR and dispute counts explain block. | CDR-01/BILL-01. |
| BILL-03 | Billing | Build driver statement projection. | Lines reconcile to CDRs and rate owners. | CDR-02/03. |
| BILL-04 | Billing | Build organisation bundle projection. | Driver statements plus unattributed/adjustments reconcile. | BILL-03. |
| BILL-05 | Billing | Define additive adjustment contract. | Parent, reason, actor, timestamp and sign required. | Approval. |
| BILL-06 | Billing | Implement period lock command. | Idempotent, attributed and refuses incomplete period. | BILL-02/05. |
| BILL-07 | Billing | Define document type and issuer. | Invoice/material terminology legally approved. | Legal/commercial. |
| BILL-08 | Web Admin | Wire billing-readiness gates. | UI shows exact blocking contract/state. | BILL-01..07. |
| BILL-09 | Web CPO | Wire bundle read. | Provisional/locked distinctions accessible. | BILL-04. |
| BILL-10 | Web Driver | Wire statement read. | Null vs zero, owner lines and lifecycle tested. | BILL-03. |
| DEL-01 | Delivery | Define organisation recipients. | Role, consent, language and effective dates explicit. | Identity/commercial. |
| DEL-02 | Delivery | Define delivery-attempt record. | Provider id, outcome, timestamp and material hash. | DEL-01. |
| DEL-03 | Delivery | Implement idempotent send command. | Retries do not duplicate same attempt. | DEL-02. |
| DEL-04 | Delivery | Implement resend command. | New attempt references original and actor. | DEL-03. |
| DEL-05 | Web CPO | Wire delivery log. | Pending/sent/failed/unknown states tested. | DEL-02. |
| EXP-01 | Export | Research Icelandic bank formats. | Supported/unsupported list and sample validators. | Research/approval. |
| EXP-02 | Export | Research accounting formats. | Schema, encoding and decimal conventions documented. | Research/approval. |
| EXP-03 | Export | Define versioned export envelope. | Material hash, format version and generated time. | EXP-01/02. |
| EXP-04 | Export | Implement dry-run validator. | Invalid fixture fails without external delivery. | EXP-03. |
| EXP-05 | Web CPO | Enable export after format support. | Unknown remains disabled; supported format named. | EXP-04, Approval. |
| ACCESS-01 | Access | Adopt singular manual-driver workflow. | Same identity/access state machine as assisted onboarding. | Product/identity. |
| ACCESS-02 | Access | Define active/inactive transitions. | Billing effect date and revocation tested. | CORE-03. |
| ACCESS-03 | Access | Define access-group assignment. | Tenant and installation scope enforced. | Authorization. |
| ACCESS-04 | Invite | Replace unsafe bearer consume path. | Identity-bound claim/redeem end to end. | Security approval. |
| ACCESS-05 | Web CPO | Enable manual add driver. | Error, duplicate, pending and rollback states. | ACCESS-01/02. |
| ACCESS-06 | Web CPO | Enable invite-by-link. | Disabled until ACCESS-04 is deployed and adopted. | ACCESS-04. |
| MOBILE-01 | Flutter | Add monthly statement destination. | Draft/ready/corrected/delivered states at 390 px. | BILL-10 contract. |
| MOBILE-02 | Flutter | Add session cost-owner expansion. | DSO/retailer/CPO/plug-time/adjustment accessible. | BILL-03. |
| MOBILE-03 | Flutter | Separate estimate from statement. | Active polling never becomes invoice truth. | Session + BILL-03. |
| MOBILE-04 | Flutter | Add offline statement cache. | Last verified timestamp and stale state shown. | Mobile data policy. |
| QA-01 | QA | Add pricing vector contract suite. | Boundary, cap, invalid and portfolio vectors green. | CORE-04. |
| QA-02 | QA | Add billing reconciliation suite. | Driver and organisation totals exact. | BILL-03/04. |
| QA-03 | QA | Add responsive commercial UI matrix. | 390/768/1280 no overflow, 200% text. | Web implementation. |
| QA-04 | QA | Add false-claim text guard. | No bank/payment/live/Premium claim enters Core UI. | Product copy list. |
| A11Y-01 | Accessibility | Establish keyboard route matrix. | Every Core route reaches navigation, filter, table, queue and disabled action in logical order. | Web implementation. |
| A11Y-02 | Accessibility | Verify 200% browser zoom. | No content loss or two-axis scrolling at 390, 768 and 1280 px. | QA-03. |
| A11Y-03 | Accessibility | Verify text-only scaling. | Essential labels, amounts and gate explanations remain visible at 200% text. | Browser/device matrix. |
| A11Y-04 | Accessibility | Define money announcement semantics. | Screen readers announce amount, currency, owner and provisional state once. | BILL-03. |
| A11Y-05 | Accessibility | Add table alternatives on narrow screens. | Headers remain associated and horizontal regions are named. | Web implementation. |
| A11Y-06 | Accessibility | Verify forced-colors mode. | Borders, current route, status and warning remain distinguishable. | QA-03. |
| A11Y-07 | Accessibility | Verify reduced-motion mode. | Drawer has no transition and no meaning depends on animation. | Web implementation. |
| A11Y-08 | Accessibility | Add automated contrast checks. | Core text/status combinations meet WCAG AA with recorded exceptions. | Design approval. |
| COPY-01 | Content | Native-review Core product name and scope. | Icelandic primary and English support text preserve the same promise. | Icelandic reviewer. |
| COPY-02 | Content | Native-review active connector definition. | Billing inclusion and month boundary cannot be misread. | CORE-02. |
| COPY-03 | Content | Native-review active driver definition. | Access/CDR rule and once-per-org counting remain explicit. | CORE-03. |
| COPY-04 | Content | Native-review provisional cost language. | Estimate, statement material and invoice are distinct in both languages. | BILL-07. |
| COPY-05 | Content | Native-review rate-owner labels. | DSO, retailer, CPO and plug-time owner remain understandable. | RATE-01..05. |
| COPY-06 | Content | Native-review access states. | Active, inactive, pending, denied and unavailable are not conflated. | ACCESS-02/03. |
| COPY-07 | Content | Native-review delivery states. | Queued, delivered, failed and unknown do not imply receipt or payment. | DEL-02. |
| COPY-08 | Content | Build terminology lint list. | Deprecated invoice/payment/live wording fails copy checks. | QA-04. |
| OBS-01 | Observability | Define Core pricing calculation event. | Inputs, cap decision, version and result are attributable without personal data. | CORE-04. |
| OBS-02 | Observability | Define rate-version lifecycle events. | Draft, schedule, effective and supersede transitions are queryable. | RATE-07. |
| OBS-03 | Observability | Define period-close evidence event. | Completeness counts, actor and immutable material hash are recorded. | BILL-06. |
| OBS-04 | Observability | Define delivery outcome metrics. | Attempt, retry, failure class and latency are measurable without message bodies. | DEL-02/03. |
| OBS-05 | Observability | Define statement-read health metrics. | Empty, denied, unavailable and stale-cache outcomes are distinguishable. | BILL-10/MOBILE-04. |
| OBS-06 | Observability | Add false-zero telemetry alert. | Null-to-zero regressions are caught before driver display. | Standard telemetry contract. |
| SEC-01 | Security | Threat-model rate mutation. | Tenant crossing, replay, stale preview and privilege escalation have controls. | RATE-08/10. |
| SEC-02 | Security | Threat-model period close and correction. | Actor, idempotency, additive history and separation of duties are tested. | BILL-05/06. |
| SEC-03 | Security | Authorize statement reads by subject and tenant. | Cross-driver and cross-org reads return non-disclosing outcomes. | BILL-03/10. |
| SEC-04 | Security | Protect exported billing material. | Expiry, audience, revocation and access logging are defined before download. | EXP-03/05. |
| SEC-05 | Security | Rate-limit access and invite workflows. | Enumeration and credential-stuffing volume are bounded and observable. | ACCESS-04. |
| PERF-01 | Performance | Set Core dashboard read budget. | Portfolio read stays within approved latency at 5k connectors. | Capacity test data. |
| PERF-02 | Performance | Set statement pagination contract. | Large months remain bounded and totals do not depend on loaded pages. | BILL-03. |
| PERF-03 | Performance | Set billing-bundle generation budget. | 16-org fixture and scale profile complete within an approved window. | BILL-04. |
| PERF-04 | Performance | Cache immutable rate history safely. | Cache key includes tenant/version and invalidation is unnecessary for effective history. | RATE-07. |
| PERF-05 | Performance | Bound delivery-log queries. | Cursor pagination and retention prevent unbounded tenant reads. | DEL-02. |
| OPS-01 | Operations | Write pricing mismatch runbook. | Operator can preserve evidence, compare inputs and avoid hand-editing totals. | OBS-01. |
| OPS-02 | Operations | Write rate-version rollback runbook. | Recovery creates a new version and never mutates historical rates. | RATE-07. |
| OPS-03 | Operations | Write incomplete-period runbook. | Missing CDRs block close and retain evidence for repair. | BILL-02/06. |
| OPS-04 | Operations | Write duplicate-delivery runbook. | Provider evidence is checked before retry and duplicates remain attributable. | DEL-03/04. |
| OPS-05 | Operations | Write statement dispute runbook. | Correction is additive and original material remains available. | BILL-05. |
| OPS-06 | Operations | Define Core launch support ownership. | Admin/CPO/Driver escalation paths and response targets are named. | Product/operations approval. |
| DATA-01 | Data | Define Core money representation. | Minor-unit convention, decimal rates and rounding points are explicit. | Billing architecture. |
| DATA-02 | Data | Define monthly count snapshot retention. | Recalculation cannot silently change an issued period. | CORE-06. |
| DATA-03 | Data | Define CDR-to-statement lineage. | Every visible line traces to source CDR, rate version or adjustment. | CDR-01/BILL-03. |
| DATA-04 | Data | Define billing-material retention. | Icelandic legal/commercial requirements and deletion holds are approved. | Legal approval. |
| DATA-05 | Data | Define demo-fixture isolation. | `.test` identities and demo IDs cannot enter production reads or exports. | Release architecture. |

## Suggested first vertical slice

`CORE-02 -> CORE-03 -> CORE-04 -> CORE-06 -> CORE-07 -> CORE-10` proves the subscription model without touching energy settlement or legal billing documents. In parallel, `RATE-01` and `RATE-02` can establish authoritative Icelandic source contracts. Billing and delivery should not be enabled merely because their local screens are visually complete.
