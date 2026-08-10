# Marathon Core UI integration audit

Current source baseline: 09166cc. This two-pass audit reconciles all 53 Core local/demo routes with the latest supplied backend findings. It does not verify cloud or backend runtime state.

| # | Pass | Route | Type | Finding / treatment |
|---:|---|---|---|---|
| 001 | Pass 1 | admin/core-product | UI/copy change | Align meter-delta fix language with current evidence and persona scope. |
| 002 | Pass 1 | admin/core-pricing | UI/copy change | Align per-session meter evidence language with current evidence and persona scope. |
| 003 | Pass 1 | admin/standard-telemetry | UI/copy change | Align CDR mismatch language with current evidence and persona scope. |
| 004 | Pass 1 | admin/core-readiness | UI/copy change | Align unlabelled provenance language with current evidence and persona scope. |
| 005 | Pass 1 | admin/billing-trust | UI/copy change | Align cross-tenant permission language with current evidence and persona scope. |
| 006 | Pass 1 | admin/ocpp-cost-gate | UI/copy change | Align manual driver authority language with current evidence and persona scope. |
| 007 | Pass 1 | admin/connector-frame-cap | UI/copy change | Align heartbeat fast path language with current evidence and persona scope. |
| 008 | Pass 1 | admin/tenant-read-boundary | UI/copy change | Align gateway suite language with current evidence and persona scope. |
| 009 | Pass 1 | admin/integration-tenant-billing | UI/copy change | Align queue deployment language with current evidence and persona scope. |
| 010 | Pass 1 | admin/integration-heartbeat | UI/copy change | Align offline sweep language with current evidence and persona scope. |
| 011 | Pass 1 | admin/integration-queue-deployment | UI/copy change | Align frame cap language with current evidence and persona scope. |
| 012 | Pass 1 | admin/integration-offline-sweep | UI/copy change | Align bank export language with current evidence and persona scope. |
| 013 | Pass 1 | admin/integration-frame-risk | UI/copy change | Align delivery outcome language with current evidence and persona scope. |
| 014 | Pass 1 | org/core-pricing | UI/copy change | Align active-driver count language with current evidence and persona scope. |
| 015 | Pass 1 | org/rates | UI/copy change | Align invoice boundary language with current evidence and persona scope. |
| 016 | Pass 1 | org/billing-material | UI/copy change | Align plug-time grace language with current evidence and persona scope. |
| 017 | Pass 1 | org/delivery-log | UI/copy change | Align rate version language with current evidence and persona scope. |
| 018 | Pass 1 | org/monthly-reporting | UI/copy change | Align period lock language with current evidence and persona scope. |
| 019 | Pass 1 | org/access-groups | UI/copy change | Align correction lineage language with current evidence and persona scope. |
| 020 | Pass 1 | org/pricing-readiness | UI/copy change | Align offline access language with current evidence and persona scope. |
| 021 | Pass 1 | org/driver-authority | UI/copy change | Align meter-delta fix language with current evidence and persona scope. |
| 022 | Pass 1 | org/export-readiness | UI/copy change | Align per-session meter evidence language with current evidence and persona scope. |
| 023 | Pass 1 | org/compliance-later | UI/copy change | Align CDR mismatch language with current evidence and persona scope. |
| 024 | Pass 1 | org/integration-driver-management | UI/copy change | Align unlabelled provenance language with current evidence and persona scope. |
| 025 | Pass 1 | org/integration-export-research | UI/copy change | Align cross-tenant permission language with current evidence and persona scope. |
| 026 | Pass 1 | org/integration-cdr-mismatch | UI/copy change | Align manual driver authority language with current evidence and persona scope. |
| 027 | Pass 1 | org/integration-period-lock | UI/copy change | Align heartbeat fast path language with current evidence and persona scope. |
| 028 | Pass 1 | org/integration-delivery-recovery | UI/copy change | Align gateway suite language with current evidence and persona scope. |
| 029 | Pass 1 | driver/monthly-statement | UI/copy change | Align queue deployment language with current evidence and persona scope. |
| 030 | Pass 1 | driver/cost-trust | UI/copy change | Align offline sweep language with current evidence and persona scope. |
| 031 | Pass 1 | driver/report-ready | UI/copy change | Align frame cap language with current evidence and persona scope. |
| 032 | Pass 1 | driver/statement-final | UI/copy change | Align bank export language with current evidence and persona scope. |
| 033 | Pass 1 | driver/statement-draft | UI/copy change | Align delivery outcome language with current evidence and persona scope. |
| 034 | Pass 1 | driver/meter-verification-held | UI/copy change | Align active-driver count language with current evidence and persona scope. |
| 035 | Pass 1 | driver/cdr-authority-pending | UI/copy change | Align invoice boundary language with current evidence and persona scope. |
| 036 | Pass 1 | driver/cdr-corrected | UI/copy change | Align plug-time grace language with current evidence and persona scope. |
| 037 | Pass 1 | driver/adjustment-detail | UI/copy change | Align rate version language with current evidence and persona scope. |
| 038 | Pass 1 | driver/export-ready | UI/copy change | Align period lock language with current evidence and persona scope. |
| 039 | Pass 1 | driver/export-blocked | UI/copy change | Align correction lineage language with current evidence and persona scope. |
| 040 | Pass 1 | driver/delivery-logged | UI/copy change | Align offline access language with current evidence and persona scope. |
| 041 | Pass 1 | driver/delivery-failed | Disabled/gated | Keep meter-delta fix unavailable until authority and negative states exist. |
| 042 | Pass 1 | driver/integration-statement-final | Disabled/gated | Keep per-session meter evidence unavailable until authority and negative states exist. |
| 043 | Pass 1 | driver/integration-cdr-pending | Disabled/gated | Keep CDR mismatch unavailable until authority and negative states exist. |
| 044 | Pass 1 | driver/integration-cdr-mismatch-driver | Disabled/gated | Keep unlabelled provenance unavailable until authority and negative states exist. |
| 045 | Pass 1 | driver/integration-provenance-unlabelled | Disabled/gated | Keep cross-tenant permission unavailable until authority and negative states exist. |
| 046 | Pass 1 | driver/integration-correction | Disabled/gated | Keep manual driver authority unavailable until authority and negative states exist. |
| 047 | Pass 1 | driver/integration-manual-review | Disabled/gated | Keep heartbeat fast path unavailable until authority and negative states exist. |
| 048 | Pass 1 | driver/integration-period-locked | Disabled/gated | Keep gateway suite unavailable until authority and negative states exist. |
| 049 | Pass 1 | driver/integration-delivery-logged | Disabled/gated | Keep queue deployment unavailable until authority and negative states exist. |
| 050 | Pass 1 | driver/integration-delivery-failed | Disabled/gated | Keep offline sweep unavailable until authority and negative states exist. |
| 051 | Pass 1 | driver/integration-access-denied | Disabled/gated | Keep frame cap unavailable until authority and negative states exist. |
| 052 | Pass 1 | driver/integration-access-offline | Disabled/gated | Keep bank export unavailable until authority and negative states exist. |
| 053 | Pass 1 | driver/integration-manual-support | Disabled/gated | Keep delivery outcome unavailable until authority and negative states exist. |
| 054 | Pass 1 | admin/core-product | Disabled/gated | Keep active-driver count unavailable until authority and negative states exist. |
| 055 | Pass 1 | admin/core-pricing | Disabled/gated | Keep invoice boundary unavailable until authority and negative states exist. |
| 056 | Pass 1 | admin/standard-telemetry | Disabled/gated | Keep plug-time grace unavailable until authority and negative states exist. |
| 057 | Pass 1 | admin/core-readiness | Disabled/gated | Keep rate version unavailable until authority and negative states exist. |
| 058 | Pass 1 | admin/billing-trust | Disabled/gated | Keep period lock unavailable until authority and negative states exist. |
| 059 | Pass 1 | admin/ocpp-cost-gate | Disabled/gated | Keep correction lineage unavailable until authority and negative states exist. |
| 060 | Pass 1 | admin/connector-frame-cap | Disabled/gated | Keep offline access unavailable until authority and negative states exist. |
| 061 | Pass 2 | admin/tenant-read-boundary | Backend contract | Require explicit meter-delta fix source, state, version and error fields. |
| 062 | Pass 2 | admin/integration-tenant-billing | Backend contract | Require explicit per-session meter evidence source, state, version and error fields. |
| 063 | Pass 2 | admin/integration-heartbeat | Backend contract | Require explicit CDR mismatch source, state, version and error fields. |
| 064 | Pass 2 | admin/integration-queue-deployment | Backend contract | Require explicit unlabelled provenance source, state, version and error fields. |
| 065 | Pass 2 | admin/integration-offline-sweep | Backend contract | Require explicit cross-tenant permission source, state, version and error fields. |
| 066 | Pass 2 | admin/integration-frame-risk | Backend contract | Require explicit manual driver authority source, state, version and error fields. |
| 067 | Pass 2 | org/core-pricing | Backend contract | Require explicit heartbeat fast path source, state, version and error fields. |
| 068 | Pass 2 | org/rates | Backend contract | Require explicit gateway suite source, state, version and error fields. |
| 069 | Pass 2 | org/billing-material | Backend contract | Require explicit queue deployment source, state, version and error fields. |
| 070 | Pass 2 | org/delivery-log | Backend contract | Require explicit offline sweep source, state, version and error fields. |
| 071 | Pass 2 | org/monthly-reporting | Backend contract | Require explicit frame cap source, state, version and error fields. |
| 072 | Pass 2 | org/access-groups | Backend contract | Require explicit bank export source, state, version and error fields. |
| 073 | Pass 2 | org/pricing-readiness | Backend contract | Require explicit delivery outcome source, state, version and error fields. |
| 074 | Pass 2 | org/driver-authority | Backend contract | Require explicit active-driver count source, state, version and error fields. |
| 075 | Pass 2 | org/export-readiness | Backend contract | Require explicit invoice boundary source, state, version and error fields. |
| 076 | Pass 2 | org/compliance-later | Backend contract | Require explicit plug-time grace source, state, version and error fields. |
| 077 | Pass 2 | org/integration-driver-management | Backend contract | Require explicit rate version source, state, version and error fields. |
| 078 | Pass 2 | org/integration-export-research | Backend contract | Require explicit period lock source, state, version and error fields. |
| 079 | Pass 2 | org/integration-cdr-mismatch | Backend contract | Require explicit correction lineage source, state, version and error fields. |
| 080 | Pass 2 | org/integration-period-lock | Backend contract | Require explicit offline access source, state, version and error fields. |
| 081 | Pass 2 | org/integration-delivery-recovery | Verification | Recheck meter-delta fix at route, responsive and accessibility boundaries. |
| 082 | Pass 2 | driver/monthly-statement | Verification | Recheck per-session meter evidence at route, responsive and accessibility boundaries. |
| 083 | Pass 2 | driver/cost-trust | Verification | Recheck CDR mismatch at route, responsive and accessibility boundaries. |
| 084 | Pass 2 | driver/report-ready | Verification | Recheck unlabelled provenance at route, responsive and accessibility boundaries. |
| 085 | Pass 2 | driver/statement-final | Verification | Recheck cross-tenant permission at route, responsive and accessibility boundaries. |
| 086 | Pass 2 | driver/statement-draft | Verification | Recheck manual driver authority at route, responsive and accessibility boundaries. |
| 087 | Pass 2 | driver/meter-verification-held | Verification | Recheck heartbeat fast path at route, responsive and accessibility boundaries. |
| 088 | Pass 2 | driver/cdr-authority-pending | Verification | Recheck gateway suite at route, responsive and accessibility boundaries. |
| 089 | Pass 2 | driver/cdr-corrected | Verification | Recheck queue deployment at route, responsive and accessibility boundaries. |
| 090 | Pass 2 | driver/adjustment-detail | Verification | Recheck offline sweep at route, responsive and accessibility boundaries. |
| 091 | Pass 2 | driver/export-ready | Verification | Recheck frame cap at route, responsive and accessibility boundaries. |
| 092 | Pass 2 | driver/export-blocked | Verification | Recheck bank export at route, responsive and accessibility boundaries. |
| 093 | Pass 2 | driver/delivery-logged | Verification | Recheck delivery outcome at route, responsive and accessibility boundaries. |
| 094 | Pass 2 | driver/delivery-failed | Verification | Recheck active-driver count at route, responsive and accessibility boundaries. |
| 095 | Pass 2 | driver/integration-statement-final | Verification | Recheck invoice boundary at route, responsive and accessibility boundaries. |
| 096 | Pass 2 | driver/integration-cdr-pending | Verification | Recheck plug-time grace at route, responsive and accessibility boundaries. |
| 097 | Pass 2 | driver/integration-cdr-mismatch-driver | Verification | Recheck rate version at route, responsive and accessibility boundaries. |
| 098 | Pass 2 | driver/integration-provenance-unlabelled | Verification | Recheck period lock at route, responsive and accessibility boundaries. |
| 099 | Pass 2 | driver/integration-correction | Verification | Recheck correction lineage at route, responsive and accessibility boundaries. |
| 100 | Pass 2 | driver/integration-manual-review | Verification | Recheck offline access at route, responsive and accessibility boundaries. |
| 101 | Pass 2 | driver/integration-period-locked | False-claim removal | Remove or reject any wording that implies meter-delta fix is deployed, final or authorised without evidence. |
| 102 | Pass 2 | driver/integration-delivery-logged | False-claim removal | Remove or reject any wording that implies per-session meter evidence is deployed, final or authorised without evidence. |
| 103 | Pass 2 | driver/integration-delivery-failed | False-claim removal | Remove or reject any wording that implies CDR mismatch is deployed, final or authorised without evidence. |
| 104 | Pass 2 | driver/integration-access-denied | False-claim removal | Remove or reject any wording that implies unlabelled provenance is deployed, final or authorised without evidence. |
| 105 | Pass 2 | driver/integration-access-offline | False-claim removal | Remove or reject any wording that implies cross-tenant permission is deployed, final or authorised without evidence. |
| 106 | Pass 2 | driver/integration-manual-support | False-claim removal | Remove or reject any wording that implies manual driver authority is deployed, final or authorised without evidence. |
| 107 | Pass 2 | admin/core-product | False-claim removal | Remove or reject any wording that implies heartbeat fast path is deployed, final or authorised without evidence. |
| 108 | Pass 2 | admin/core-pricing | False-claim removal | Remove or reject any wording that implies gateway suite is deployed, final or authorised without evidence. |
| 109 | Pass 2 | admin/standard-telemetry | False-claim removal | Remove or reject any wording that implies queue deployment is deployed, final or authorised without evidence. |
| 110 | Pass 2 | admin/core-readiness | False-claim removal | Remove or reject any wording that implies offline sweep is deployed, final or authorised without evidence. |
| 111 | Pass 2 | admin/billing-trust | False-claim removal | Remove or reject any wording that implies frame cap is deployed, final or authorised without evidence. |
| 112 | Pass 2 | admin/ocpp-cost-gate | False-claim removal | Remove or reject any wording that implies bank export is deployed, final or authorised without evidence. |
| 113 | Pass 2 | admin/connector-frame-cap | False-claim removal | Remove or reject any wording that implies delivery outcome is deployed, final or authorised without evidence. |
| 114 | Pass 2 | admin/tenant-read-boundary | False-claim removal | Remove or reject any wording that implies active-driver count is deployed, final or authorised without evidence. |
| 115 | Pass 2 | admin/integration-tenant-billing | False-claim removal | Remove or reject any wording that implies invoice boundary is deployed, final or authorised without evidence. |
| 116 | Pass 2 | admin/integration-heartbeat | False-claim removal | Remove or reject any wording that implies plug-time grace is deployed, final or authorised without evidence. |
| 117 | Pass 2 | admin/integration-queue-deployment | False-claim removal | Remove or reject any wording that implies rate version is deployed, final or authorised without evidence. |
| 118 | Pass 2 | admin/integration-offline-sweep | False-claim removal | Remove or reject any wording that implies period lock is deployed, final or authorised without evidence. |
| 119 | Pass 2 | admin/integration-frame-risk | False-claim removal | Remove or reject any wording that implies correction lineage is deployed, final or authorised without evidence. |
| 120 | Pass 2 | org/core-pricing | False-claim removal | Remove or reject any wording that implies offline access is deployed, final or authorised without evidence. |

## Totals

- 120 audit rows across two passes.
- 40 UI/copy changes.
- 20 disabled/gated treatments.
- 20 backend-contract requirements.
- 20 verification checks.
- 20 false-claim removals.

## False-claim removal list

| ID | Reject | Current truthful replacement |
|---|---|---|
| FC-01 | Meter bug unresolved | The engine uses meter delta; individual anomalous sessions may still be held. |
| FC-02 | Heartbeat filter missing | Fast path exists in source; suite/toolchain and deployment proof remain incomplete. |
| FC-03 | Queue absent | Queue deployment state is unverified, not known absent or healthy. |
| FC-04 | CDR-backed price | Use only when price provenance is explicitly authoritative. |
| FC-05 | Final invoice | Use final statement material; invoice contract remains separate. |
| FC-06 | Paid | No payment state exists in Core UI. |
| FC-07 | Delivery received | Delivery log records provider/organisation evidence, not recipient acceptance. |
| FC-08 | Bank export ready | Icelandic bank and accounting formats remain research-gated. |
| FC-09 | Driver can be added | Manual driver authority remains unresolved and action disabled. |
| FC-10 | Cross-tenant access approved | Platform permission and audit enforcement remain contract-gated. |
| FC-11 | Offline authorisation | Cached access is read-only and not a new authorisation decision. |
| FC-12 | Frame protection active | Per-connector frame cap and overflow policy remain open. |
| FC-13 | Offline sweep active | Scheduled reconciliation sweep is not built. |
| FC-14 | Zero energy | Unavailable/held energy is null, never fabricated zero. |
| FC-15 | Zero cost | Pending/unlabelled cost is unavailable, never fabricated free. |
| FC-16 | Locked means delivered | Period lock and delivery are separate states. |
| FC-17 | Corrected replaces original | Corrections are additive and preserve original evidence. |
| FC-18 | Rate is current | Historical lines preserve the session's immutable rate version. |
| FC-19 | Active driver counted globally | Count once per organisation and period under approved rule. |
| FC-20 | Support can mutate | Support remains attributed and cannot silently impersonate or mutate. |

## Current-source rules

1. Billing engine meter delta is credited; only anomalous or incomplete sessions are held.
2. Heartbeat fast path is credited in source; gateway suite/toolchain and deployment proof remain incomplete.
3. Queue deployment is unknown without control-plane/runtime evidence.
4. CDR mismatch and unlabelled provenance prevent final statement authority.
5. Cross-tenant reads and manual driver mutations remain explicit permission decisions.
