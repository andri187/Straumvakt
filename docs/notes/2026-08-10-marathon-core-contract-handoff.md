# Marathon Core UI contract and decision handoff

Current-state contract proposal. It supersedes earlier UI wording where the latest supplied findings differ; it does not alter backend behavior.

## Contract 1: UI-backend statement

Invariant: Final statement requires per-session meter evidence plus labelled CDR price authority; invoice and payment remain separate.

| Field | Requirement |
|---|---|
| `statementId` | Explicit, versioned and nullable where authority is unknown. |
| `periodId` | Explicit, versioned and nullable where authority is unknown. |
| `state` | Explicit, versioned and nullable where authority is unknown. |
| `meterAuthority` | Explicit, versioned and nullable where authority is unknown. |
| `cdrAuthority` | Explicit, versioned and nullable where authority is unknown. |
| `rateVersion` | Explicit, versioned and nullable where authority is unknown. |
| `adjustments` | Explicit, versioned and nullable where authority is unknown. |
| `deliveryState` | Explicit, versioned and nullable where authority is unknown. |

Required error states: loading, empty, denied, unavailable, stale, held and conflict.

## Contract 2: Access and driver management

Invariant: Roster read, add, deactivate, invite and support are distinct authorities.

| Field | Requirement |
|---|---|
| `actorUserId` | Explicit, versioned and nullable where authority is unknown. |
| `organisationId` | Explicit, versioned and nullable where authority is unknown. |
| `driverId` | Explicit, versioned and nullable where authority is unknown. |
| `permission` | Explicit, versioned and nullable where authority is unknown. |
| `transition` | Explicit, versioned and nullable where authority is unknown. |
| `effectiveAt` | Explicit, versioned and nullable where authority is unknown. |
| `auditId` | Explicit, versioned and nullable where authority is unknown. |

Required error states: loading, empty, denied, unavailable, stale, held and conflict.

## Contract 3: OCPP cost-gate display

Invariant: Source implementation may be shown, but runtime effectiveness remains unverified until deployment evidence exists.

| Field | Requirement |
|---|---|
| `fastPathSourceState` | Explicit, versioned and nullable where authority is unknown. |
| `gatewaySuiteState` | Explicit, versioned and nullable where authority is unknown. |
| `deploymentEvidenceState` | Explicit, versioned and nullable where authority is unknown. |
| `queueEffectState` | Explicit, versioned and nullable where authority is unknown. |
| `observedAt` | Explicit, versioned and nullable where authority is unknown. |

Required error states: loading, empty, denied, unavailable, stale, held and conflict.

## Contract 4: Export and delivery

Invariant: Internal material readiness, supported format, delivery attempt and recipient acceptance are separate states.

| Field | Requirement |
|---|---|
| `materialId` | Explicit, versioned and nullable where authority is unknown. |
| `formatId` | Explicit, versioned and nullable where authority is unknown. |
| `formatVersion` | Explicit, versioned and nullable where authority is unknown. |
| `materialHash` | Explicit, versioned and nullable where authority is unknown. |
| `attemptId` | Explicit, versioned and nullable where authority is unknown. |
| `providerOutcome` | Explicit, versioned and nullable where authority is unknown. |
| `recipient` | Explicit, versioned and nullable where authority is unknown. |

Required error states: loading, empty, denied, unavailable, stale, held and conflict.

## Contract 5: Active-driver billing

Invariant: Count once per organisation and period under an approved close rule.

| Field | Requirement |
|---|---|
| `organisationId` | Explicit, versioned and nullable where authority is unknown. |
| `periodId` | Explicit, versioned and nullable where authority is unknown. |
| `driverId` | Explicit, versioned and nullable where authority is unknown. |
| `accessEvidence` | Explicit, versioned and nullable where authority is unknown. |
| `cdrEvidence` | Explicit, versioned and nullable where authority is unknown. |
| `countReason` | Explicit, versioned and nullable where authority is unknown. |
| `snapshotVersion` | Explicit, versioned and nullable where authority is unknown. |

Required error states: loading, empty, denied, unavailable, stale, held and conflict.

## One hundred implementation notes

1. **Meter and energy 1:** Meter and energy must name source and authority separately.
2. **Meter and energy 2:** Meter and energy must keep unknown distinct from zero.
3. **Meter and energy 3:** Meter and energy must expose ready, pending, held, denied and unavailable.
4. **Meter and energy 4:** Meter and energy must preserve immutable version identity.
5. **Meter and energy 5:** Meter and energy must remain organisation-scoped.
6. **Meter and energy 6:** Meter and energy must record actor and affected tenant.
7. **Meter and energy 7:** Meter and energy must block mutation until permission and audit exist.
8. **Meter and energy 8:** Meter and energy must retain original evidence through correction.
9. **Meter and energy 9:** Meter and energy must have a negative contract test.
10. **Meter and energy 10:** Meter and energy must use copy that matches runtime evidence.
11. **CDR authority 1:** CDR authority must name source and authority separately.
12. **CDR authority 2:** CDR authority must keep unknown distinct from zero.
13. **CDR authority 3:** CDR authority must expose ready, pending, held, denied and unavailable.
14. **CDR authority 4:** CDR authority must preserve immutable version identity.
15. **CDR authority 5:** CDR authority must remain organisation-scoped.
16. **CDR authority 6:** CDR authority must record actor and affected tenant.
17. **CDR authority 7:** CDR authority must block mutation until permission and audit exist.
18. **CDR authority 8:** CDR authority must retain original evidence through correction.
19. **CDR authority 9:** CDR authority must have a negative contract test.
20. **CDR authority 10:** CDR authority must use copy that matches runtime evidence.
21. **Statement lifecycle 1:** Statement lifecycle must name source and authority separately.
22. **Statement lifecycle 2:** Statement lifecycle must keep unknown distinct from zero.
23. **Statement lifecycle 3:** Statement lifecycle must expose ready, pending, held, denied and unavailable.
24. **Statement lifecycle 4:** Statement lifecycle must preserve immutable version identity.
25. **Statement lifecycle 5:** Statement lifecycle must remain organisation-scoped.
26. **Statement lifecycle 6:** Statement lifecycle must record actor and affected tenant.
27. **Statement lifecycle 7:** Statement lifecycle must block mutation until permission and audit exist.
28. **Statement lifecycle 8:** Statement lifecycle must retain original evidence through correction.
29. **Statement lifecycle 9:** Statement lifecycle must have a negative contract test.
30. **Statement lifecycle 10:** Statement lifecycle must use copy that matches runtime evidence.
31. **Driver access 1:** Driver access must name source and authority separately.
32. **Driver access 2:** Driver access must keep unknown distinct from zero.
33. **Driver access 3:** Driver access must expose ready, pending, held, denied and unavailable.
34. **Driver access 4:** Driver access must preserve immutable version identity.
35. **Driver access 5:** Driver access must remain organisation-scoped.
36. **Driver access 6:** Driver access must record actor and affected tenant.
37. **Driver access 7:** Driver access must block mutation until permission and audit exist.
38. **Driver access 8:** Driver access must retain original evidence through correction.
39. **Driver access 9:** Driver access must have a negative contract test.
40. **Driver access 10:** Driver access must use copy that matches runtime evidence.
41. **Manual driver management 1:** Manual driver management must name source and authority separately.
42. **Manual driver management 2:** Manual driver management must keep unknown distinct from zero.
43. **Manual driver management 3:** Manual driver management must expose ready, pending, held, denied and unavailable.
44. **Manual driver management 4:** Manual driver management must preserve immutable version identity.
45. **Manual driver management 5:** Manual driver management must remain organisation-scoped.
46. **Manual driver management 6:** Manual driver management must record actor and affected tenant.
47. **Manual driver management 7:** Manual driver management must block mutation until permission and audit exist.
48. **Manual driver management 8:** Manual driver management must retain original evidence through correction.
49. **Manual driver management 9:** Manual driver management must have a negative contract test.
50. **Manual driver management 10:** Manual driver management must use copy that matches runtime evidence.
51. **Cross-tenant reads 1:** Cross-tenant reads must name source and authority separately.
52. **Cross-tenant reads 2:** Cross-tenant reads must keep unknown distinct from zero.
53. **Cross-tenant reads 3:** Cross-tenant reads must expose ready, pending, held, denied and unavailable.
54. **Cross-tenant reads 4:** Cross-tenant reads must preserve immutable version identity.
55. **Cross-tenant reads 5:** Cross-tenant reads must remain organisation-scoped.
56. **Cross-tenant reads 6:** Cross-tenant reads must record actor and affected tenant.
57. **Cross-tenant reads 7:** Cross-tenant reads must block mutation until permission and audit exist.
58. **Cross-tenant reads 8:** Cross-tenant reads must retain original evidence through correction.
59. **Cross-tenant reads 9:** Cross-tenant reads must have a negative contract test.
60. **Cross-tenant reads 10:** Cross-tenant reads must use copy that matches runtime evidence.
61. **Heartbeat fast path 1:** Heartbeat fast path must name source and authority separately.
62. **Heartbeat fast path 2:** Heartbeat fast path must keep unknown distinct from zero.
63. **Heartbeat fast path 3:** Heartbeat fast path must expose ready, pending, held, denied and unavailable.
64. **Heartbeat fast path 4:** Heartbeat fast path must preserve immutable version identity.
65. **Heartbeat fast path 5:** Heartbeat fast path must remain organisation-scoped.
66. **Heartbeat fast path 6:** Heartbeat fast path must record actor and affected tenant.
67. **Heartbeat fast path 7:** Heartbeat fast path must block mutation until permission and audit exist.
68. **Heartbeat fast path 8:** Heartbeat fast path must retain original evidence through correction.
69. **Heartbeat fast path 9:** Heartbeat fast path must have a negative contract test.
70. **Heartbeat fast path 10:** Heartbeat fast path must use copy that matches runtime evidence.
71. **Queue deployment 1:** Queue deployment must name source and authority separately.
72. **Queue deployment 2:** Queue deployment must keep unknown distinct from zero.
73. **Queue deployment 3:** Queue deployment must expose ready, pending, held, denied and unavailable.
74. **Queue deployment 4:** Queue deployment must preserve immutable version identity.
75. **Queue deployment 5:** Queue deployment must remain organisation-scoped.
76. **Queue deployment 6:** Queue deployment must record actor and affected tenant.
77. **Queue deployment 7:** Queue deployment must block mutation until permission and audit exist.
78. **Queue deployment 8:** Queue deployment must retain original evidence through correction.
79. **Queue deployment 9:** Queue deployment must have a negative contract test.
80. **Queue deployment 10:** Queue deployment must use copy that matches runtime evidence.
81. **Offline sweep 1:** Offline sweep must name source and authority separately.
82. **Offline sweep 2:** Offline sweep must keep unknown distinct from zero.
83. **Offline sweep 3:** Offline sweep must expose ready, pending, held, denied and unavailable.
84. **Offline sweep 4:** Offline sweep must preserve immutable version identity.
85. **Offline sweep 5:** Offline sweep must remain organisation-scoped.
86. **Offline sweep 6:** Offline sweep must record actor and affected tenant.
87. **Offline sweep 7:** Offline sweep must block mutation until permission and audit exist.
88. **Offline sweep 8:** Offline sweep must retain original evidence through correction.
89. **Offline sweep 9:** Offline sweep must have a negative contract test.
90. **Offline sweep 10:** Offline sweep must use copy that matches runtime evidence.
91. **Export and delivery 1:** Export and delivery must name source and authority separately.
92. **Export and delivery 2:** Export and delivery must keep unknown distinct from zero.
93. **Export and delivery 3:** Export and delivery must expose ready, pending, held, denied and unavailable.
94. **Export and delivery 4:** Export and delivery must preserve immutable version identity.
95. **Export and delivery 5:** Export and delivery must remain organisation-scoped.
96. **Export and delivery 6:** Export and delivery must record actor and affected tenant.
97. **Export and delivery 7:** Export and delivery must block mutation until permission and audit exist.
98. **Export and delivery 8:** Export and delivery must retain original evidence through correction.
99. **Export and delivery 9:** Export and delivery must have a negative contract test.
100. **Export and delivery 10:** Export and delivery must use copy that matches runtime evidence.

## Exact disabled and gated copy

| ID | Action | Exact English copy |
|---|---|---|
| GATE-01 | Driver add | `Manual driver-management authority remains unresolved; no request is sent.` |
| GATE-02 | Driver deactivate | `Deactivation is unavailable until billing-effective-date and active-session behavior are approved.` |
| GATE-03 | Invite link | `Invite-by-link remains unavailable until identity binding is proven end to end.` |
| GATE-04 | Period lock | `Lock is blocked until every mismatch, unlabelled row and open correction is resolved.` |
| GATE-05 | Statement download | `Download remains disabled until document, retention and subject-authorisation contracts exist.` |
| GATE-06 | Export | `No Icelandic bank or accounting format is supported until researched and validated.` |
| GATE-07 | Delivery retry | `Retry remains disabled until provider outcome, recipient and idempotency contracts exist.` |
| GATE-08 | Queue control | `Queue deployment is a control-plane fact; there is no local UI toggle.` |
| GATE-09 | Offline sweep | `The sweep is not built; the UI cannot simulate backend reconciliation.` |
| GATE-10 | Frame cap | `Per-connector limits require backend design and load evidence.` |

## Product decision cards

### Decision 01 - Final terminology

- Question: Statement final or statement ready before legal invoice design?
- Owner: Product/legal
- Default: remain read-only, blocked, held or unknown until approved.

### Decision 02 - Meter detail

- Question: Show raw meter registers to Driver or only delta and hold reason?
- Owner: Product/privacy
- Default: remain read-only, blocked, held or unknown until approved.

### Decision 03 - CDR mismatch owner

- Question: Who resolves price-source disagreement?
- Owner: Billing operations
- Default: remain read-only, blocked, held or unknown until approved.

### Decision 04 - Unlabelled provenance

- Question: Reject at ingest or hold in projection?
- Owner: Architecture
- Default: remain read-only, blocked, held or unknown until approved.

### Decision 05 - Cross-tenant permission

- Question: Which platform role may read billing trust?
- Owner: Security
- Default: remain read-only, blocked, held or unknown until approved.

### Decision 06 - Manual add authority

- Question: Which organisation roles can create a driver relationship?
- Owner: Identity
- Default: remain read-only, blocked, held or unknown until approved.

### Decision 07 - Deactivation timing

- Question: Immediate, session-end or period boundary?
- Owner: Billing/product
- Default: remain read-only, blocked, held or unknown until approved.

### Decision 08 - Active driver count

- Question: Enabled access, CDR activity or combined rule?
- Owner: Commercial
- Default: remain read-only, blocked, held or unknown until approved.

### Decision 09 - Heartbeat proof

- Question: What suite and deployed evidence clear readiness?
- Owner: Gateway/operations
- Default: remain read-only, blocked, held or unknown until approved.

### Decision 10 - Queue evidence

- Question: Which control-plane/version signals are authoritative?
- Owner: Infrastructure
- Default: remain read-only, blocked, held or unknown until approved.

### Decision 11 - Offline sweep cadence

- Question: How often and which recovery actions?
- Owner: Operations
- Default: remain read-only, blocked, held or unknown until approved.

### Decision 12 - Frame limit

- Question: Rate, burst, overflow and reconnect behavior?
- Owner: Gateway/security
- Default: remain read-only, blocked, held or unknown until approved.

### Decision 13 - Bank format priority

- Question: Which Icelandic format is researched first?
- Owner: Finance
- Default: remain read-only, blocked, held or unknown until approved.

### Decision 14 - Accounting format

- Question: Which schema/version and encoding?
- Owner: Finance
- Default: remain read-only, blocked, held or unknown until approved.

### Decision 15 - Delivery outcome

- Question: Provider accepted, recipient received or opened?
- Owner: Operations/legal
- Default: remain read-only, blocked, held or unknown until approved.

### Decision 16 - Retry policy

- Question: Who may retry and how is idempotency keyed?
- Owner: Operations
- Default: remain read-only, blocked, held or unknown until approved.

### Decision 17 - Period lock

- Question: What exact blockers prevent lock?
- Owner: Billing
- Default: remain read-only, blocked, held or unknown until approved.

### Decision 18 - Correction role

- Question: Who may create additive adjustments?
- Owner: Security/billing
- Default: remain read-only, blocked, held or unknown until approved.

### Decision 19 - Retention

- Question: How long for statements, CDRs, attempts and audit?
- Owner: Legal
- Default: remain read-only, blocked, held or unknown until approved.

### Decision 20 - Offline access

- Question: What cached state may be shown without authorising?
- Owner: Mobile/security
- Default: remain read-only, blocked, held or unknown until approved.

### Decision 21 - Support boundary

- Question: What can staff explain or coordinate without mutation?
- Owner: Product/security
- Default: remain read-only, blocked, held or unknown until approved.

### Decision 22 - SLA

- Question: Which Core availability commitments exist?
- Owner: Commercial
- Default: remain read-only, blocked, held or unknown until approved.

### Decision 23 - DPA

- Question: Which data-processing obligations block production?
- Owner: Legal
- Default: remain read-only, blocked, held or unknown until approved.

### Decision 24 - Translation owner

- Question: Who approves Icelandic terminology as one set?
- Owner: Product/content
- Default: remain read-only, blocked, held or unknown until approved.

## Icelandic-first / English-supporting candidates

| ID | Context | Icelandic candidate | English support | Status |
|---|---|---|---|---|
| COPY-01 | Fast path exists | Hraðleið fyrir regluleg boð er til | Heartbeat fast path exists | Candidate |
| COPY-02 | Deployment unverified | Keyrsla óstaðfest | Deployment unverified | Candidate |
| COPY-03 | Queue state unknown | Staða biðraðar óþekkt | Queue state unknown | Candidate |
| COPY-04 | Offline sweep missing | Sjálfvirk yfirferð ótengdra stöðva vantar | Offline sweep missing | Candidate |
| COPY-05 | Meter delta verified | Mismunur mæligilda staðfestur | Meter delta verified | Candidate |
| COPY-06 | Session evidence held | Gögn hleðslulotu í bið | Session evidence held | Candidate |
| COPY-07 | CDR pending | Útreikningur hleðsluskrár í bið | CDR pending | Candidate |
| COPY-08 | CDR mismatch | Misræmi í hleðsluskrá | CDR mismatch | Candidate |
| COPY-09 | Source unlabelled | Uppruni ómerktur | Source unlabelled | Candidate |
| COPY-10 | Statement final | Yfirlit fullgert | Statement final | Candidate |
| COPY-11 | Not an invoice | Ekki útgefinn reikningur | Not an issued invoice | Candidate |
| COPY-12 | Period locked | Tímabil læst | Period locked | Candidate |
| COPY-13 | Delivery logged | Afhending skráð | Delivery logged | Candidate |
| COPY-14 | Delivery failed | Afhending mistókst | Delivery failed | Candidate |
| COPY-15 | Access denied | Aðgangi hafnað | Access denied | Candidate |
| COPY-16 | Access offline | Aðgangsathugun ótæk án nets | Access check unavailable offline | Candidate |
| COPY-17 | Manual support | Handvirk aðstoð | Manual support | Candidate |
| COPY-18 | Driver not counted | Ökumaður ekki talinn | Driver not counted | Candidate |
| COPY-19 | Counted once | Talinn einu sinni | Counted once | Candidate |
| COPY-20 | Export research pending | Rannsókn á útflutningssniði ólokið | Export research pending | Candidate |
| COPY-21 | Correction retained | Leiðrétting varðveitt | Correction retained | Candidate |
| COPY-22 | Retry blocked | Endursending ekki tiltæk | Retry unavailable | Candidate |
| COPY-23 | Permission required | Heimild vantar | Permission required | Candidate |
| COPY-24 | Native review required | Yfirferð íslenskumælandi aðila nauðsynleg | Native review required | Candidate |

All Icelandic strings require native review as one terminology system before they replace rendered English copy.
