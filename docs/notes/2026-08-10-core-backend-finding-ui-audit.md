# Core backend-finding UI audit

Scope: all 31 Core local/demo routes after commit 0714807. This audit converts reported backend findings into UI honesty rules; it is not proof that the backend findings are resolved.

| # | Route | Type | Finding | Required treatment |
|---:|---|---|---|---|
| 001 | admin/core-product | Change | Replace any unconditional meter stop vs delta wording with evidence-state copy. | UI/copy |
| 002 | admin/core-pricing | Change | Replace any unconditional CDR price provenance wording with evidence-state copy. | UI/copy |
| 003 | admin/standard-telemetry | Change | Replace any unconditional statement lifecycle wording with evidence-state copy. | UI/copy |
| 004 | admin/core-readiness | Change | Replace any unconditional additive correction wording with evidence-state copy. | UI/copy |
| 005 | admin/billing-trust | Change | Replace any unconditional export authority wording with evidence-state copy. | UI/copy |
| 006 | admin/ocpp-cost-gate | Change | Replace any unconditional delivery evidence wording with evidence-state copy. | UI/copy |
| 007 | admin/connector-frame-cap | Change | Replace any unconditional manual driver authority wording with evidence-state copy. | UI/copy |
| 008 | admin/tenant-read-boundary | Change | Replace any unconditional active-driver count wording with evidence-state copy. | UI/copy |
| 009 | org/core-pricing | Change | Replace any unconditional cross-tenant reads wording with evidence-state copy. | UI/copy |
| 010 | org/rates | Change | Replace any unconditional heartbeat cost gate wording with evidence-state copy. | UI/copy |
| 011 | org/billing-material | Change | Replace any unconditional connector frame cap wording with evidence-state copy. | UI/copy |
| 012 | org/delivery-log | Change | Replace any unconditional rate version wording with evidence-state copy. | UI/copy |
| 013 | org/monthly-reporting | Change | Replace any unconditional plug-time grace wording with evidence-state copy. | UI/copy |
| 014 | org/access-groups | Change | Replace any unconditional bank format wording with evidence-state copy. | UI/copy |
| 015 | org/pricing-readiness | Change | Replace any unconditional accounting format wording with evidence-state copy. | UI/copy |
| 016 | org/driver-authority | Change | Replace any unconditional legal terms wording with evidence-state copy. | UI/copy |
| 017 | org/export-readiness | Change | Replace any unconditional SLA and DPA wording with evidence-state copy. | UI/copy |
| 018 | org/compliance-later | Change | Replace any unconditional null vs zero wording with evidence-state copy. | UI/copy |
| 019 | driver/monthly-statement | Change | Replace any unconditional estimate vs statement wording with evidence-state copy. | UI/copy |
| 020 | driver/cost-trust | Change | Replace any unconditional invoice boundary wording with evidence-state copy. | UI/copy |
| 021 | driver/report-ready | Change | Replace any unconditional meter stop vs delta wording with evidence-state copy. | UI/copy |
| 022 | driver/statement-final | Change | Replace any unconditional CDR price provenance wording with evidence-state copy. | UI/copy |
| 023 | driver/statement-draft | Change | Replace any unconditional statement lifecycle wording with evidence-state copy. | UI/copy |
| 024 | driver/meter-verification-held | Change | Replace any unconditional additive correction wording with evidence-state copy. | UI/copy |
| 025 | driver/cdr-authority-pending | Change | Replace any unconditional export authority wording with evidence-state copy. | UI/copy |
| 026 | driver/cdr-corrected | Change | Replace any unconditional delivery evidence wording with evidence-state copy. | UI/copy |
| 027 | driver/adjustment-detail | Change | Replace any unconditional manual driver authority wording with evidence-state copy. | UI/copy |
| 028 | driver/export-ready | Change | Replace any unconditional active-driver count wording with evidence-state copy. | UI/copy |
| 029 | driver/export-blocked | Change | Replace any unconditional cross-tenant reads wording with evidence-state copy. | UI/copy |
| 030 | driver/delivery-logged | Change | Replace any unconditional heartbeat cost gate wording with evidence-state copy. | UI/copy |
| 031 | driver/delivery-failed | Disabled/gated | Keep connector frame cap action unavailable until its named authority exists. | Real disabled control |
| 032 | admin/core-product | Disabled/gated | Keep rate version action unavailable until its named authority exists. | Real disabled control |
| 033 | admin/core-pricing | Disabled/gated | Keep plug-time grace action unavailable until its named authority exists. | Real disabled control |
| 034 | admin/standard-telemetry | Disabled/gated | Keep bank format action unavailable until its named authority exists. | Real disabled control |
| 035 | admin/core-readiness | Disabled/gated | Keep accounting format action unavailable until its named authority exists. | Real disabled control |
| 036 | admin/billing-trust | Disabled/gated | Keep legal terms action unavailable until its named authority exists. | Real disabled control |
| 037 | admin/ocpp-cost-gate | Disabled/gated | Keep SLA and DPA action unavailable until its named authority exists. | Real disabled control |
| 038 | admin/connector-frame-cap | Disabled/gated | Keep null vs zero action unavailable until its named authority exists. | Real disabled control |
| 039 | admin/tenant-read-boundary | Disabled/gated | Keep estimate vs statement action unavailable until its named authority exists. | Real disabled control |
| 040 | org/core-pricing | Disabled/gated | Keep invoice boundary action unavailable until its named authority exists. | Real disabled control |
| 041 | org/rates | Disabled/gated | Keep meter stop vs delta action unavailable until its named authority exists. | Real disabled control |
| 042 | org/billing-material | Disabled/gated | Keep CDR price provenance action unavailable until its named authority exists. | Real disabled control |
| 043 | org/delivery-log | Disabled/gated | Keep statement lifecycle action unavailable until its named authority exists. | Real disabled control |
| 044 | org/monthly-reporting | Disabled/gated | Keep additive correction action unavailable until its named authority exists. | Real disabled control |
| 045 | org/access-groups | Disabled/gated | Keep export authority action unavailable until its named authority exists. | Real disabled control |
| 046 | org/pricing-readiness | Disabled/gated | Keep delivery evidence action unavailable until its named authority exists. | Real disabled control |
| 047 | org/driver-authority | Disabled/gated | Keep manual driver authority action unavailable until its named authority exists. | Real disabled control |
| 048 | org/export-readiness | Disabled/gated | Keep active-driver count action unavailable until its named authority exists. | Real disabled control |
| 049 | org/compliance-later | Disabled/gated | Keep cross-tenant reads action unavailable until its named authority exists. | Real disabled control |
| 050 | driver/monthly-statement | Disabled/gated | Keep heartbeat cost gate action unavailable until its named authority exists. | Real disabled control |
| 051 | driver/cost-trust | Backend contract | Require a versioned connector frame cap field, state and error contract. | API design only |
| 052 | driver/report-ready | Backend contract | Require a versioned rate version field, state and error contract. | API design only |
| 053 | driver/statement-final | Backend contract | Require a versioned plug-time grace field, state and error contract. | API design only |
| 054 | driver/statement-draft | Backend contract | Require a versioned bank format field, state and error contract. | API design only |
| 055 | driver/meter-verification-held | Backend contract | Require a versioned accounting format field, state and error contract. | API design only |
| 056 | driver/cdr-authority-pending | Backend contract | Require a versioned legal terms field, state and error contract. | API design only |
| 057 | driver/cdr-corrected | Backend contract | Require a versioned SLA and DPA field, state and error contract. | API design only |
| 058 | driver/adjustment-detail | Backend contract | Require a versioned null vs zero field, state and error contract. | API design only |
| 059 | driver/export-ready | Backend contract | Require a versioned estimate vs statement field, state and error contract. | API design only |
| 060 | driver/export-blocked | Backend contract | Require a versioned invoice boundary field, state and error contract. | API design only |
| 061 | driver/delivery-logged | Backend contract | Require a versioned meter stop vs delta field, state and error contract. | API design only |
| 062 | driver/delivery-failed | Backend contract | Require a versioned CDR price provenance field, state and error contract. | API design only |
| 063 | admin/core-product | Backend contract | Require a versioned statement lifecycle field, state and error contract. | API design only |
| 064 | admin/core-pricing | Backend contract | Require a versioned additive correction field, state and error contract. | API design only |
| 065 | admin/standard-telemetry | Backend contract | Require a versioned export authority field, state and error contract. | API design only |
| 066 | admin/core-readiness | Backend contract | Require a versioned delivery evidence field, state and error contract. | API design only |
| 067 | admin/billing-trust | Backend contract | Require a versioned manual driver authority field, state and error contract. | API design only |
| 068 | admin/ocpp-cost-gate | Backend contract | Require a versioned active-driver count field, state and error contract. | API design only |
| 069 | admin/connector-frame-cap | Backend contract | Require a versioned cross-tenant reads field, state and error contract. | API design only |
| 070 | admin/tenant-read-boundary | Backend contract | Require a versioned heartbeat cost gate field, state and error contract. | API design only |
| 071 | org/core-pricing | Verify | Confirm connector frame cap remains local, scoped and non-final in org/core-pricing. | Regression guard |
| 072 | org/rates | Verify | Confirm rate version remains local, scoped and non-final in org/rates. | Regression guard |
| 073 | org/billing-material | Verify | Confirm plug-time grace remains local, scoped and non-final in org/billing-material. | Regression guard |
| 074 | org/delivery-log | Verify | Confirm bank format remains local, scoped and non-final in org/delivery-log. | Regression guard |
| 075 | org/monthly-reporting | Verify | Confirm accounting format remains local, scoped and non-final in org/monthly-reporting. | Regression guard |
| 076 | org/access-groups | Verify | Confirm legal terms remains local, scoped and non-final in org/access-groups. | Regression guard |
| 077 | org/pricing-readiness | Verify | Confirm SLA and DPA remains local, scoped and non-final in org/pricing-readiness. | Regression guard |
| 078 | org/driver-authority | Verify | Confirm null vs zero remains local, scoped and non-final in org/driver-authority. | Regression guard |
| 079 | org/export-readiness | Verify | Confirm estimate vs statement remains local, scoped and non-final in org/export-readiness. | Regression guard |
| 080 | org/compliance-later | Verify | Confirm invoice boundary remains local, scoped and non-final in org/compliance-later. | Regression guard |
| 081 | driver/monthly-statement | Verify | Confirm meter stop vs delta remains local, scoped and non-final in driver/monthly-statement. | Regression guard |
| 082 | driver/cost-trust | Verify | Confirm CDR price provenance remains local, scoped and non-final in driver/cost-trust. | Regression guard |
| 083 | driver/report-ready | Verify | Confirm statement lifecycle remains local, scoped and non-final in driver/report-ready. | Regression guard |
| 084 | driver/statement-final | Verify | Confirm additive correction remains local, scoped and non-final in driver/statement-final. | Regression guard |
| 085 | driver/statement-draft | Verify | Confirm export authority remains local, scoped and non-final in driver/statement-draft. | Regression guard |
| 086 | driver/meter-verification-held | Verify | Confirm delivery evidence remains local, scoped and non-final in driver/meter-verification-held. | Regression guard |
| 087 | driver/cdr-authority-pending | Verify | Confirm manual driver authority remains local, scoped and non-final in driver/cdr-authority-pending. | Regression guard |
| 088 | driver/cdr-corrected | Verify | Confirm active-driver count remains local, scoped and non-final in driver/cdr-corrected. | Regression guard |
| 089 | driver/adjustment-detail | Verify | Confirm cross-tenant reads remains local, scoped and non-final in driver/adjustment-detail. | Regression guard |
| 090 | driver/export-ready | Verify | Confirm heartbeat cost gate remains local, scoped and non-final in driver/export-ready. | Regression guard |
| 091 | driver/export-blocked | Verify | Confirm connector frame cap remains local, scoped and non-final in driver/export-blocked. | Regression guard |
| 092 | driver/delivery-logged | Verify | Confirm rate version remains local, scoped and non-final in driver/delivery-logged. | Regression guard |
| 093 | driver/delivery-failed | Verify | Confirm plug-time grace remains local, scoped and non-final in driver/delivery-failed. | Regression guard |
| 094 | admin/core-product | Verify | Confirm bank format remains local, scoped and non-final in admin/core-product. | Regression guard |
| 095 | admin/core-pricing | Verify | Confirm accounting format remains local, scoped and non-final in admin/core-pricing. | Regression guard |
| 096 | admin/standard-telemetry | Verify | Confirm legal terms remains local, scoped and non-final in admin/standard-telemetry. | Regression guard |
| 097 | admin/core-readiness | Verify | Confirm SLA and DPA remains local, scoped and non-final in admin/core-readiness. | Regression guard |
| 098 | admin/billing-trust | Verify | Confirm null vs zero remains local, scoped and non-final in admin/billing-trust. | Regression guard |
| 099 | admin/ocpp-cost-gate | Verify | Confirm estimate vs statement remains local, scoped and non-final in admin/ocpp-cost-gate. | Regression guard |
| 100 | admin/connector-frame-cap | Verify | Confirm invoice boundary remains local, scoped and non-final in admin/connector-frame-cap. | Regression guard |

## Totals

- 100 audit rows.
- 30 required UI/copy changes.
- 20 disabled or gated states.
- 20 backend-contract notes.
- 30 verification guards.

## Hard conclusions

1. Meter semantics are verification-held until billed energy is proven to be meter stop minus meter start.
2. A CDR-shaped row cannot claim CDR authority unless the price provenance is explicit.
3. Cross-tenant billing reads need an explicit platform permission and tenant-attributed audit event.
4. Manual driver mutations stay disabled until authority and billing-effective-date semantics exist.
5. Heartbeat cost filtering and per-connector frame caps are backend controls, not operator toggles.
