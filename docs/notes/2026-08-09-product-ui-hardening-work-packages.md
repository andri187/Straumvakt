# Product UI hardening work packages

Date: 2026-08-09
Status: issue-ready continuation queue

Every package preserves the same mutation boundary: no production/beta/cloud/database/hardware mutation during UI implementation. Rollback is removal of the scoped UI/test change unless stated otherwise.

| ID | Evidence | Scope | Non-goal | Dependencies | Acceptance and tests | Rollback |
| --- | --- | --- | --- | --- | --- | --- |
| H01 | Charger route had ad hoc loading text | Standard product loading state | API redesign | Existing read route | busy semantics + component test | restore local rendering |
| H02 | Charger errors had no retry affordance | Retry read only | retry create | Charger read contract | error alert and retry test | remove retry button |
| H03 | One-time OCPP secret can be lost | Focus and announce result | secret persistence | Existing create response | focus/live-region test | restore static result |
| H04 | Clipboard can fail | Manual fallback message | server copy service | Browser clipboard | rejected-copy component test | remove convenience action |
| H05 | Create ambiguity risks duplicates | Explicit no-auto-retry warning | idempotency backend | Charger create contract | copy assertion | remove explanatory line |
| H06 | Visibility mutation absent | Disabled contract gate | invent policy | Visibility API | disabled + dependency test | remove gate |
| H07 | Site/install ordering can mislead | Disable installation until site | change model | Existing site reads | form-state test | restore selection behavior |
| H08 | Dense charger identity scanning | Caption, scopes, contained scroll | table redesign | None | semantic table test | restore markup |
| H09 | Driver roster grows beyond scanability | Search and group filter | server search | Existing driver read | filter unit/component tests | remove filters |
| H10 | Filtered roster count was implicit | Live visible/total count | analytics | H09 | announcement test | remove live count |
| H11 | Denial reason could be meaningless | 3-500 chars + help/count | policy wording | Existing deny route | validation tests | restore previous validation |
| H12 | Cancel loses decision context | Restore focus to Deny | modal framework | H11 | keyboard test | remove focus ref |
| H13 | Mutation errors need announcement | Assertive access-decision error | retry automation | Existing mutation | alert test | restore text |
| H14 | Session nulls looked numeric | Unknown/pending format helpers | telemetry source | Existing nullable DTO | 19 helper tests | revert formatter |
| H15 | Session status color was ad hoc | Text + normalized badge | new statuses | Existing status | mapping tests | restore string |
| H16 | Session read failure hid summary state | Error without fabricated metrics | caching | Session endpoint | error-state test | restore local error |
| H17 | Cost assignment contract absent | Unsafe contract gate | assignment API | Future contract | disabled-state test | remove gate |
| H18 | Agreement loading/error inconsistent | Shared product states | contract changes | Existing reads | state tests | restore local states |
| H19 | Bearer invite remains unsafe | No interactive organisation invite | backend consolidation | Identity-bound migration | source guard | restore only after approval |
| H20 | Readiness list is difficult to scan | State/persona/search filters | readiness mutation | Static inventory | filter tests | remove controls |
| H21 | Readiness could expose work-view | Product-only caption and guard | repo health UI | None | source assertion | remove readiness route |
| H22 | Staff support could imply impersonation | Attributed support boundary card | support implementation | platform.support.enter | disabled semantics test | remove card |
| H23 | Audit read is not canonical | Disabled audit action | invent events | Audit read contract | disabled assertion | remove action |
| H24 | Onboarding aggregate absent | Disabled aggregate action | join partial reads | Aggregate API | disabled assertion | remove action |
| H25 | Empty driver QR is decorative | Exclude decorative semantics | scanner redesign | None | semantics tree test | restore icon semantics |
| H26 | Empty state title not a heading | Header semantics | copy rewrite | None | widget semantics test | remove wrapper |
| H27 | Approval state not announced | Single live-region status | notifications | Existing local state | widget test | restore visual-only status |
| H28 | Installation blocker was visual only | Semantic unavailable explanation | enable workflow | Join contract absent | widget test | remove wrapper |
| H29 | Installation result not announced | Live result label | persistence | Submit callback | pending/reject tests | restore visual-only result |
| H30 | Mobile errors not announced | Error live regions | retry policy | Existing local errors | failure test | restore text |
| H31 | Reachable UI could regress to consume | Source boundary guard | delete parked source | Identity migration | four static tests | remove guard only with ADR |
| H32 | Android versions lacked device evidence | API31 real + API35 emulator matrix | hardware claims | APK build/devices | install/open/capture/crash rows | mark cells unverified |

## Dependency order

Start with H19/H31, then shared states H01/H14, operational tables H08/H09, mutation clarity H03/H05/H11/H12, staff boundaries H20-H24, mobile semantics H25-H30, and device evidence H32. Backend teams can unblock H06, H17, H22-H24 and installation access independently; UI must remain disabled until those contracts are reviewed.
