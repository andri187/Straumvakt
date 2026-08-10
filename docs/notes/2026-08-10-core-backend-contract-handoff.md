# Core UI backend contract handoff

Status: UI contract proposal only. No API, permission, persistence, queue, protocol or billing behavior is implemented by this packet.

## Contract 1: Billing statement states

Invariant: Draft -> verification-held -> statement-ready -> corrected -> delivery-logged. Final is allowed only after evidence gates pass.

| Field | UI need |
|---|---|
| `statementId` | Required, explicit and versioned; unknown remains a valid display state. |
| `organisationId` | Required, explicit and versioned; unknown remains a valid display state. |
| `driverId or unattributed` | Required, explicit and versioned; unknown remains a valid display state. |
| `periodId` | Required, explicit and versioned; unknown remains a valid display state. |
| `state` | Required, explicit and versioned; unknown remains a valid display state. |
| `sourceCdrIds` | Required, explicit and versioned; unknown remains a valid display state. |
| `rateVersion` | Required, explicit and versioned; unknown remains a valid display state. |
| `energyAuthority` | Required, explicit and versioned; unknown remains a valid display state. |
| `cdrAuthority` | Required, explicit and versioned; unknown remains a valid display state. |
| `adjustments` | Required, explicit and versioned; unknown remains a valid display state. |
| `generatedAt` | Required, explicit and versioned; unknown remains a valid display state. |
| `deliveredAt` | Required, explicit and versioned; unknown remains a valid display state. |

Errors must distinguish unavailable, denied, held, incomplete and stale without leaking another tenant's existence.

## Contract 2: Meter anomaly

Invariant: The UI renders billed energy as unavailable when semantics are held; it never substitutes meterStop or zero.

| Field | UI need |
|---|---|
| `meterStart` | Required, explicit and versioned; unknown remains a valid display state. |
| `meterStop` | Required, explicit and versioned; unknown remains a valid display state. |
| `meterUnit` | Required, explicit and versioned; unknown remains a valid display state. |
| `computedDelta` | Required, explicit and versioned; unknown remains a valid display state. |
| `energyAuthority` | Required, explicit and versioned; unknown remains a valid display state. |
| `verificationReason` | Required, explicit and versioned; unknown remains a valid display state. |
| `verifiedAt` | Required, explicit and versioned; unknown remains a valid display state. |
| `verifiedBy` | Required, explicit and versioned; unknown remains a valid display state. |

Errors must distinguish unavailable, denied, held, incomplete and stale without leaking another tenant's existence.

## Contract 3: CDR authority

Invariant: CDR-shaped is not CDR-authoritative. OCPP price provenance must be labelled explicitly.

| Field | UI need |
|---|---|
| `cdrId` | Required, explicit and versioned; unknown remains a valid display state. |
| `priceSource` | Required, explicit and versioned; unknown remains a valid display state. |
| `calculationVersion` | Required, explicit and versioned; unknown remains a valid display state. |
| `rateVersion` | Required, explicit and versioned; unknown remains a valid display state. |
| `authorityState` | Required, explicit and versioned; unknown remains a valid display state. |
| `correctsCdrId` | Required, explicit and versioned; unknown remains a valid display state. |
| `sourceHash` | Required, explicit and versioned; unknown remains a valid display state. |

Errors must distinguish unavailable, denied, held, incomplete and stale without leaking another tenant's existence.

## Contract 4: Manual driver permission

Invariant: Read authority, add authority, deactivate authority and invite authority are separate decisions.

| Field | UI need |
|---|---|
| `actorUserId` | Required, explicit and versioned; unknown remains a valid display state. |
| `organisationId` | Required, explicit and versioned; unknown remains a valid display state. |
| `subjectUserId` | Required, explicit and versioned; unknown remains a valid display state. |
| `requestedTransition` | Required, explicit and versioned; unknown remains a valid display state. |
| `effectiveAt` | Required, explicit and versioned; unknown remains a valid display state. |
| `permission` | Required, explicit and versioned; unknown remains a valid display state. |
| `auditId` | Required, explicit and versioned; unknown remains a valid display state. |

Errors must distinguish unavailable, denied, held, incomplete and stale without leaking another tenant's existence.

## Contract 5: OCPP cost gate display

Invariant: The UI may show readiness only. It never creates a protocol toggle or claims enforcement.

| Field | UI need |
|---|---|
| `routineFilterState` | Required, explicit and versioned; unknown remains a valid display state. |
| `queueBypassState` | Required, explicit and versioned; unknown remains a valid display state. |
| `frameCapState` | Required, explicit and versioned; unknown remains a valid display state. |
| `observedAt` | Required, explicit and versioned; unknown remains a valid display state. |
| `sourceVersion` | Required, explicit and versioned; unknown remains a valid display state. |

Errors must distinguish unavailable, denied, held, incomplete and stale without leaking another tenant's existence.

## Contract 6: Active driver billing count

Invariant: A unique driver is counted once per organisation and period under an approved close rule.

| Field | UI need |
|---|---|
| `organisationId` | Required, explicit and versioned; unknown remains a valid display state. |
| `periodId` | Required, explicit and versioned; unknown remains a valid display state. |
| `driverId` | Required, explicit and versioned; unknown remains a valid display state. |
| `enabledAccessEvidence` | Required, explicit and versioned; unknown remains a valid display state. |
| `cdrEvidence` | Required, explicit and versioned; unknown remains a valid display state. |
| `counted` | Required, explicit and versioned; unknown remains a valid display state. |
| `countReason` | Required, explicit and versioned; unknown remains a valid display state. |
| `snapshotVersion` | Required, explicit and versioned; unknown remains a valid display state. |

Errors must distinguish unavailable, denied, held, incomplete and stale without leaking another tenant's existence.

## Eighty implementation notes

1. **Statement lifecycle 1:** Statement lifecycle must have an explicit source field before the UI renders a positive state.
2. **Statement lifecycle 2:** Statement lifecycle must preserve unknown separately from numeric zero.
3. **Statement lifecycle 3:** Statement lifecycle must expose loading, empty, denied, unavailable and stale states.
4. **Statement lifecycle 4:** Statement lifecycle must remain tenant-scoped and carry actor attribution.
5. **Statement lifecycle 5:** Statement lifecycle must use immutable version identity for historical material.
6. **Statement lifecycle 6:** Statement lifecycle must block mutation until preview, permission and audit contracts exist.
7. **Statement lifecycle 7:** Statement lifecycle must retain original evidence when a correction is applied.
8. **Statement lifecycle 8:** Statement lifecycle must state whether the value is demo, provisional, held or verified.
9. **Statement lifecycle 9:** Statement lifecycle must have a rollback or safe recovery path before enablement.
10. **Statement lifecycle 10:** Statement lifecycle must be covered by contract, false-claim and responsive tests.
11. **Meter authority 1:** Meter authority must have an explicit source field before the UI renders a positive state.
12. **Meter authority 2:** Meter authority must preserve unknown separately from numeric zero.
13. **Meter authority 3:** Meter authority must expose loading, empty, denied, unavailable and stale states.
14. **Meter authority 4:** Meter authority must remain tenant-scoped and carry actor attribution.
15. **Meter authority 5:** Meter authority must use immutable version identity for historical material.
16. **Meter authority 6:** Meter authority must block mutation until preview, permission and audit contracts exist.
17. **Meter authority 7:** Meter authority must retain original evidence when a correction is applied.
18. **Meter authority 8:** Meter authority must state whether the value is demo, provisional, held or verified.
19. **Meter authority 9:** Meter authority must have a rollback or safe recovery path before enablement.
20. **Meter authority 10:** Meter authority must be covered by contract, false-claim and responsive tests.
21. **CDR provenance 1:** CDR provenance must have an explicit source field before the UI renders a positive state.
22. **CDR provenance 2:** CDR provenance must preserve unknown separately from numeric zero.
23. **CDR provenance 3:** CDR provenance must expose loading, empty, denied, unavailable and stale states.
24. **CDR provenance 4:** CDR provenance must remain tenant-scoped and carry actor attribution.
25. **CDR provenance 5:** CDR provenance must use immutable version identity for historical material.
26. **CDR provenance 6:** CDR provenance must block mutation until preview, permission and audit contracts exist.
27. **CDR provenance 7:** CDR provenance must retain original evidence when a correction is applied.
28. **CDR provenance 8:** CDR provenance must state whether the value is demo, provisional, held or verified.
29. **CDR provenance 9:** CDR provenance must have a rollback or safe recovery path before enablement.
30. **CDR provenance 10:** CDR provenance must be covered by contract, false-claim and responsive tests.
31. **Manual driver authority 1:** Manual driver authority must have an explicit source field before the UI renders a positive state.
32. **Manual driver authority 2:** Manual driver authority must preserve unknown separately from numeric zero.
33. **Manual driver authority 3:** Manual driver authority must expose loading, empty, denied, unavailable and stale states.
34. **Manual driver authority 4:** Manual driver authority must remain tenant-scoped and carry actor attribution.
35. **Manual driver authority 5:** Manual driver authority must use immutable version identity for historical material.
36. **Manual driver authority 6:** Manual driver authority must block mutation until preview, permission and audit contracts exist.
37. **Manual driver authority 7:** Manual driver authority must retain original evidence when a correction is applied.
38. **Manual driver authority 8:** Manual driver authority must state whether the value is demo, provisional, held or verified.
39. **Manual driver authority 9:** Manual driver authority must have a rollback or safe recovery path before enablement.
40. **Manual driver authority 10:** Manual driver authority must be covered by contract, false-claim and responsive tests.
41. **Routine-message cost gate 1:** Routine-message cost gate must have an explicit source field before the UI renders a positive state.
42. **Routine-message cost gate 2:** Routine-message cost gate must preserve unknown separately from numeric zero.
43. **Routine-message cost gate 3:** Routine-message cost gate must expose loading, empty, denied, unavailable and stale states.
44. **Routine-message cost gate 4:** Routine-message cost gate must remain tenant-scoped and carry actor attribution.
45. **Routine-message cost gate 5:** Routine-message cost gate must use immutable version identity for historical material.
46. **Routine-message cost gate 6:** Routine-message cost gate must block mutation until preview, permission and audit contracts exist.
47. **Routine-message cost gate 7:** Routine-message cost gate must retain original evidence when a correction is applied.
48. **Routine-message cost gate 8:** Routine-message cost gate must state whether the value is demo, provisional, held or verified.
49. **Routine-message cost gate 9:** Routine-message cost gate must have a rollback or safe recovery path before enablement.
50. **Routine-message cost gate 10:** Routine-message cost gate must be covered by contract, false-claim and responsive tests.
51. **Connector frame protection 1:** Connector frame protection must have an explicit source field before the UI renders a positive state.
52. **Connector frame protection 2:** Connector frame protection must preserve unknown separately from numeric zero.
53. **Connector frame protection 3:** Connector frame protection must expose loading, empty, denied, unavailable and stale states.
54. **Connector frame protection 4:** Connector frame protection must remain tenant-scoped and carry actor attribution.
55. **Connector frame protection 5:** Connector frame protection must use immutable version identity for historical material.
56. **Connector frame protection 6:** Connector frame protection must block mutation until preview, permission and audit contracts exist.
57. **Connector frame protection 7:** Connector frame protection must retain original evidence when a correction is applied.
58. **Connector frame protection 8:** Connector frame protection must state whether the value is demo, provisional, held or verified.
59. **Connector frame protection 9:** Connector frame protection must have a rollback or safe recovery path before enablement.
60. **Connector frame protection 10:** Connector frame protection must be covered by contract, false-claim and responsive tests.
61. **Active-driver counting 1:** Active-driver counting must have an explicit source field before the UI renders a positive state.
62. **Active-driver counting 2:** Active-driver counting must preserve unknown separately from numeric zero.
63. **Active-driver counting 3:** Active-driver counting must expose loading, empty, denied, unavailable and stale states.
64. **Active-driver counting 4:** Active-driver counting must remain tenant-scoped and carry actor attribution.
65. **Active-driver counting 5:** Active-driver counting must use immutable version identity for historical material.
66. **Active-driver counting 6:** Active-driver counting must block mutation until preview, permission and audit contracts exist.
67. **Active-driver counting 7:** Active-driver counting must retain original evidence when a correction is applied.
68. **Active-driver counting 8:** Active-driver counting must state whether the value is demo, provisional, held or verified.
69. **Active-driver counting 9:** Active-driver counting must have a rollback or safe recovery path before enablement.
70. **Active-driver counting 10:** Active-driver counting must be covered by contract, false-claim and responsive tests.
71. **Export and delivery 1:** Export and delivery must have an explicit source field before the UI renders a positive state.
72. **Export and delivery 2:** Export and delivery must preserve unknown separately from numeric zero.
73. **Export and delivery 3:** Export and delivery must expose loading, empty, denied, unavailable and stale states.
74. **Export and delivery 4:** Export and delivery must remain tenant-scoped and carry actor attribution.
75. **Export and delivery 5:** Export and delivery must use immutable version identity for historical material.
76. **Export and delivery 6:** Export and delivery must block mutation until preview, permission and audit contracts exist.
77. **Export and delivery 7:** Export and delivery must retain original evidence when a correction is applied.
78. **Export and delivery 8:** Export and delivery must state whether the value is demo, provisional, held or verified.
79. **Export and delivery 9:** Export and delivery must have a rollback or safe recovery path before enablement.
80. **Export and delivery 10:** Export and delivery must be covered by contract, false-claim and responsive tests.

## Product decision cards

### Decision 01 - Meter energy formula

- Question: Confirm meterStop - meterStart, unit and rollover behavior.
- Owner: Billing/product
- Impact: Blocks final statements
- Default until decided: blocked or verification-held; never infer readiness.

### Decision 02 - CDR price authority

- Question: Choose authoritative calculation and label imported OCPP price.
- Owner: Billing architecture
- Impact: Blocks CDR-ready
- Default until decided: blocked or verification-held; never infer readiness.

### Decision 03 - Cross-tenant read permission

- Question: Define platform billing-read permission and audit.
- Owner: Security
- Impact: Blocks Admin wiring
- Default until decided: blocked or verification-held; never infer readiness.

### Decision 04 - Manual driver add

- Question: Define actor, tenant, identity and duplicate behavior.
- Owner: Identity/product
- Impact: Blocks action
- Default until decided: blocked or verification-held; never infer readiness.

### Decision 05 - Manual driver deactivate

- Question: Define effective date and active-session behavior.
- Owner: Identity/billing
- Impact: Blocks action
- Default until decided: blocked or verification-held; never infer readiness.

### Decision 06 - Active-driver close rule

- Question: Choose enabled-access, CDR, or combined rule.
- Owner: Commercial
- Impact: Blocks Core charge
- Default until decided: blocked or verification-held; never infer readiness.

### Decision 07 - Connector active rule

- Question: Define month boundaries and demo exclusion.
- Owner: Commercial
- Impact: Blocks Core charge
- Default until decided: blocked or verification-held; never infer readiness.

### Decision 08 - Heartbeat filter

- Question: Choose pre-queue disposable classification.
- Owner: Infrastructure
- Impact: Cost risk
- Default until decided: blocked or verification-held; never infer readiness.

### Decision 09 - Frame cap

- Question: Set per-connector frame rate and recovery.
- Owner: Infrastructure/security
- Impact: Scale risk
- Default until decided: blocked or verification-held; never infer readiness.

### Decision 10 - Export format

- Question: Research supported Icelandic bank/accounting formats.
- Owner: Finance
- Impact: Blocks export
- Default until decided: blocked or verification-held; never infer readiness.

### Decision 11 - Document type

- Question: Approve statement vs billing material vs invoice.
- Owner: Legal/commercial
- Impact: Blocks download
- Default until decided: blocked or verification-held; never infer readiness.

### Decision 12 - Delivery evidence

- Question: Define provider outcome and recipient meaning.
- Owner: Operations
- Impact: Blocks resend
- Default until decided: blocked or verification-held; never infer readiness.

### Decision 13 - Correction authority

- Question: Define who may create additive adjustments.
- Owner: Billing/security
- Impact: Blocks correction
- Default until decided: blocked or verification-held; never infer readiness.

### Decision 14 - Period lock

- Question: Define completeness and idempotency rules.
- Owner: Billing
- Impact: Blocks close
- Default until decided: blocked or verification-held; never infer readiness.

### Decision 15 - Retention

- Question: Define statement, CDR and audit retention.
- Owner: Legal
- Impact: Blocks download
- Default until decided: blocked or verification-held; never infer readiness.

### Decision 16 - DPA

- Question: Approve data-processing obligations.
- Owner: Legal
- Impact: Later
- Default until decided: blocked or verification-held; never infer readiness.

### Decision 17 - SLA

- Question: Approve service commitments and exclusions.
- Owner: Commercial
- Impact: Later
- Default until decided: blocked or verification-held; never infer readiness.

### Decision 18 - Null and zero

- Question: Adopt explicit money and telemetry semantics.
- Owner: API
- Impact: Blocks trustworthy UI
- Default until decided: blocked or verification-held; never infer readiness.

### Decision 19 - Driver delivery copy

- Question: Choose 'delivered by organisation' language.
- Owner: Product/content
- Impact: Driver trust
- Default until decided: blocked or verification-held; never infer readiness.

### Decision 20 - Final-state name

- Question: Choose statement-ready vs final terminology.
- Owner: Product/legal
- Impact: State machine
- Default until decided: blocked or verification-held; never infer readiness.

## Icelandic-first / English-supporting candidates

| ID | Context | Icelandic candidate | English support | Status |
|---|---|---|---|---|
| COPY-01 | Verification held | Staðfesting í bið | Verification held | Native review required |
| COPY-02 | Meter meaning pending | Merking mæligilda óstaðfest | Meter semantics pending | Native review required |
| COPY-03 | Billed energy unavailable | Reiknuð orka ekki tiltæk | Billed energy unavailable | Native review required |
| COPY-04 | CDR authority pending | Uppruni hleðsluskrár í bið | CDR authority pending | Native review required |
| COPY-05 | Corrected CDR | Leiðrétt hleðsluskrá | Corrected charge record | Native review required |
| COPY-06 | Statement draft | Drög að yfirliti | Statement draft | Native review required |
| COPY-07 | Statement ready | Yfirlit tilbúið | Statement ready | Native review required |
| COPY-08 | Adjustment present | Leiðrétting skráð | Adjustment present | Native review required |
| COPY-09 | Export blocked | Útflutningur ekki tiltækur | Export blocked | Native review required |
| COPY-10 | Delivery logged | Afhending skráð | Delivery logged | Native review required |
| COPY-11 | Delivery failed | Afhending mistókst | Delivery failed | Native review required |
| COPY-12 | Manual add blocked | Handvirk skráning ekki tiltæk | Manual add unavailable | Native review required |
| COPY-13 | Authority required | Heimild vantar | Authority required | Native review required |
| COPY-14 | Routine filter missing | Síun reglulegra boða vantar | Routine-message filter missing | Native review required |
| COPY-15 | Frame cap missing | Hámark boða á tengi vantar | Per-connector frame cap missing | Native review required |
| COPY-16 | Format research pending | Rannsókn á sniði ólokið | Format research pending | Native review required |
| COPY-17 | Not an invoice | Ekki útgefinn reikningur | Not an issued invoice | Native review required |
| COPY-18 | No payment state | Engin greiðslustaða | No payment state | Native review required |
| COPY-19 | Demo fixture | Sýndargögn | Demo fixture | Native review required |
| COPY-20 | Native review required | Yfirferð íslenskumælandi aðila nauðsynleg | Native review required | Native review required |

The Icelandic strings are candidates, not approved translation. Rendered UI remains English until native review lands as one coherent terminology set.
