# Going-Public Critical Path — Sprint Plan

**Date:** 2026-06-04
**Status:** Ratified 2026-06-04 — folded into
[STRAUMVAKT_V3_DELIVERY_PLAN.md](./STRAUMVAKT_V3_DELIVERY_PLAN.md) (top
banner). Execution canon for the going-public tail.
**Anchored on:**
[ADR 0026](../adr/0026-host-managed-driver-enrollment-and-billing-model.md)
(host-managed enrollment),
[ADR 0031](../adr/0031-cost-model-and-money-flow.md) (cost model),
[ADR 0032](../adr/0032-neighbour-helper-and-issue-engine-go-live.md)
(nágrannahjálp — re-placed post-launch here; see Phase 6).

> **Why this exists.** The 2026-06-03 going-public pivot (ADR 0026/0031)
> added an onboarding + billing + mobile-redemption layer the pilot-era
> plan never had, and the pilot-era Sprint 10/11 (observability → *pilot*
> cutover) predates it. This re-sequences the tail of the delivery plan
> toward a **public** launch (real hosts, real drivers, real invoices),
> not a pilot. It operationalises decisions already locked in ADR
> 0026/0031/0032 — it introduces no new scope.

---

## Two tracks, one launch gate

- **Track E — Enablement** (Phases 1–3): onboarding, billing, mobile.
  *Makes us a business.*
- **Track H — Hardening** (Phases 4–5): observability, security, cutover.
  *Makes us safe.* Folds the existing Sprint 10/11 milestones.

Track H can run **in parallel** with Track E (different skill sets).

```
P0 decisions ─► P1 billing ─► P2 onboarding ─► P3 mobile ─┐
                                                          ├─► P5 launch
P4 hardening (parallel, folds old S10) ───────────────────┘
P6 differentiators (ADR 0032 nágrannahjálp) ── post-launch
```

Phase numbers (P0–P6) are the stable identifier; "target sprint" is a
suggestion. Old Sprint 10 (observability) folds into P4, old Sprint 11
(cutover) into P5. Milestones are numbered `P{n}.{m}`; P4/P5 cite the
existing `10.x` / `11.x` IDs they absorb.

### ADR-authoring prerequisites (gate their phase — write before code)

| ADR | Topic | Gates | Status |
|---|---|---|---|
| 0029 | Child-object billing model | P1.5 | named in 0026, **unwritten** |
| 0027 | Host onboarding | P2.2–P2.3 | named in 0026, **unwritten** |
| 0028 | Driver invite mechanism | P2.8–P2.9 | named in 0026, **unwritten** |
| 0030 | Device registry | P6.3 | named in 0026, **unwritten** |

---

## P0 — Decisions & Commit  *(Sprint 9 tail — immediate, blocking, no code)*

**Goal:** unlock the billing track and get accepted ADRs into git.

| # | Milestone | Detail |
|---|---|---|
| P0.1 | ~~Lock ADR 0031 Q1~~ **DONE** | **Option B — open code namespace.** Hosts/staff register factor codes per agreement; stored as data, not a fixed enum. |
| P0.2 | ~~Lock ADR 0031 Q2~~ **DONE** | **Per-host negotiated monthly service fee** (Straumvakt→host) + optional per-OCPP-identity/charger fee, **plus a new driver access fee** (driver→collector-TBD). Driver-access-fee mechanics still open — gate P1.3/P1.6. |
| P0.3 | ~~Lock ADR 0031 Q3~~ **DONE** | **Option B — per-host negotiated.** No published price list / tier table at launch. |
| P0.4 | Commit ADRs + this plan | 0026, 0031, 0032 + this doc; commit on a feature branch, state branch first (Rule 1). |
| P0.5 | (optional) Define **Tengill** | ADR 0032 §5C default service provider — entity vs rate-card. May defer to P6 (only gates §5C escalation code). |
| P0.6 | Ratify sprint renumbering | Approve folding old S10→P4, S11→P5; edit the delivery plan to match (Rule 11). |
| P0.7 | **Pin driver-access-fee mechanics** | New from P0.2: who collects (Straumvakt vs host), cadence (per-session/subscription/flat), free-vend interaction. Gates P1 billing module, not P0 commit. |

**Exit:** 0031 locked (P0.1–3 done) → P1 design unblocked; ADRs in git;
plan ratified. **Gate:** P1.3/P1.6 (billing module) wait on P0.7.

---

## P1 — Money Model & Billing  *(Track E · target Sprint 10)*

**Goal:** a host can be correctly invoiced; multi-dwelling sessions
attribute to the right owner. **Depends:** P0.1–P0.3; **ADR 0029 written**.
**Parallel:** P4. **Builds on:** existing `compute-session-cost.ts`,
`resolve-tariff-chain.ts`, `/billing/*` console (read-only today).

| # | Milestone | Detail / files |
|---|---|---|
| P1.0 | **Write ADR 0029** | Child-object table names, cardinality, `bill_to` owner-resolution chain. Prereq for P1.5. |
| P1.1 | Open factor-code namespace | 0031-Q1 **Option B**: host/staff register factor codes per agreement (data-driven, no fixed enum). `billing` schema; extend tariff/cost-factor models additively. |
| P1.2 | Tariff catalogue UI | Operator registers + composes host factor codes. Extend `/billing/tariffs` (new + edit). |
| P1.3 | Revenue lines | 0031-Q2: **per-host negotiated monthly service fee** + optional per-OCPP-identity/charger fee + **driver access fee** as line types. **Blocked on P0.7** (access-fee mechanics). |
| P1.4 | Per-host negotiated terms | 0031-Q3 **Option B**: per-host negotiated service agreement (no published tier table); captured at host onboarding (P2). |
| P1.5 | Child-object model (ADR 0029) | Schema: unit/stall child objects under Installation + owner-of-record; resolver `sessions → installation → child_object → owner`. |
| P1.6 | Invoice generation engine | Monthly rollup per host / per owner, host-as-agent; supersedes the read-only `billing-shadow/shadow-compare.ts`. New `billing.invoices` + line items. |
| P1.7 | Invoice review UI | Operator + (P2) host-admin view of generated invoices; extend `/billing`. |
| P1.8 | Tests | Invoice math, attribution, discount tiers, VAT — extend the `compute-session-cost` test bank. |

**Exit:** a host receives a correct monthly invoice; a multi-dwelling
session attributes to the unit owner; Straumvakt service fee + subscription
show as lines. Real invoices replace shadow billing.

---

## P2 — Host & Driver Onboarding  *(Track E · target Sprint 11)*

**Goal:** operator onboards a host end-to-end; host-admin invites a driver;
RFQ leads captured. **Depends:** P1 (billing to attach hosts to); **ADR
0027 + 0028 written**. **Parallel:** P4. **Builds on:** existing
`repositories/invites.ts`, `/invite/[token]`, `middleware.ts`
(`isPublicApplyPath` already allow-listed), `access-requests` (ENROLL-2).

| # | Milestone | Detail / files |
|---|---|---|
| P2.0 | **Write ADR 0027 + 0028** | Host onboarding + driver invite (code/QR/email). Prereq for P2.2–P2.9. |
| P2.1 | Host-admin invite mechanism | Extend invite token for a host-admin role/audience (ADR 0027). `repositories/invites.ts`. |
| P2.2 | Operator "create host" page | Operator portal: `kind ∈ {multi_dwelling, company}` + sends host-admin invite. Extend `/accounts/organizations/new`. |
| P2.3 | `/apply` public form | New public route + `tenancy.host_applications` migration + Resend email to operator inbox. Fields per ADR 0026 §6. |
| P2.4 | `/applications` operator inbox | List + status (`new/in_review/offered/won/lost`) + convert-to-host action. |
| P2.5 | `/drivers` operator-wide view | ADR 0026 item 11: columns (kennitala, status, host count, last login…), filters, drill-down, suspend/reactivate/reset/audit. Gated `straumvakt_staff`/`operator`. |
| P2.6 | Driver invite backend | Token `kind='driver'` — code + QR + email; entropy/expiry/single-use; ENROLL-4 (`POST /driver-group-memberships`) is the write target (ADR 0028). |
| P2.7 | QR security layers | Password key + host-admin allow-term, reusing the ENROLL-2 access-request inbox. |
| P2.8 | Host-admin scoped portal | RBAC gate so a host-admin sees only their org's chargers / drivers / billing (per `Membership.role` + scope). |
| P2.9 | `/me/email-change-request` | ADR 0026 item 10A — verified email change; backend (mobile UI in P3). |
| P2.10 | Tests | Invite redemption happy/expiry/abuse paths; host-admin scope isolation. |

**Exit:** operator creates a host and host-admin via the portal; host-admin
issues a working driver invite (code/QR/email); `/apply` captures a lead
into `/applications`.

---

## P3 — Mobile Redemption & Localization  *(Track E · target Sprint 12)*

**Goal:** a driver self-redeems an invite on mobile, in Icelandic, and
completes a charge with live feedback. **Depends:** P2 (invite backend).
**App:** `apps/mobile` (Flutter, ~70% built; `CPMS/mobile-app-driver`
archived). **Builds on:** existing `client.dart`, `home.dart` empty-state,
`charger_detail_sheet.dart`.

| # | Milestone | Detail / files |
|---|---|---|
| P3.1 | Empty-state → redeem CTA | Wire `home.dart:_EmptyState` to a redemption entry point. |
| P3.2 | Invite redeem screen | Paste code / **scan QR** (add scanner dep) / **email deep link** (URI scheme in AndroidManifest + Info.plist). |
| P3.3 | Kennitala + password capture | Validate kennitala, set password at redemption; wire to the consume endpoint. |
| P3.4 | Mobile API client | Extend `client.dart` for redeem + new endpoints; DTOs in `types.dart`. |
| P3.5 | Icelandic i18n | Flutter localization, extract strings, `is`/`en` from `driver.locale`. **Market blocker today (English-only).** |
| P3.6 | Live session feedback | Poll session status post-start; active-session view (currently set-and-forget). |
| P3.7 | Stop session | UI + `POST /api/driver/stop-session` (missing today). |
| P3.8 | Email-change UI | Consume P2.9 `/me/email-change-request` from the app. |
| P3.9 | Build / release | Signed AAB/APK, Play Console listing + testers (see pending upload note). |

**Exit:** invited driver installs the app, redeems (code/QR/email), sets
kennitala + password, sees Icelandic UI, starts + stops a charge with live
status.

---

## P4 — Production Hardening  *(Track H · target Sprint 13 — folds old Sprint 10, runs PARALLEL to P1–P3)*

**Goal:** observability live, tenant isolation enforced at the DB, MFA on,
access actually gated. **Depends:** P0 only (independent of Track E).

| # | Milestone | Old ID | Detail |
|---|---|---|---|
| P4.1 | Production dashboards | 10.1 | Charger counts, queue depth, ingest lag p50/p99, DLQ, command latency, DB write latency, R2 growth, partition health. |
| P4.2 | Structured logs + correlation IDs | 10.2 | `correlation_id, org_id, station_id, event_id, command_id`. |
| P4.3 | Alert thresholds | 10.3 | 8 scenarios (queue age, DLQ, auth-failure spike, charger drop, DB latency, archive/partition cron, command timeout). |
| P4.4 | Runbooks | 10.4 | 14 named failure scenarios. |
| P4.5 | Postgres **RLS** | 10.5 | Per-tenant tables (sessions, users, memberships, sites, stations, ledger). |
| P4.6 | AuditAction append-only | 10.6 | Revoke UPDATE/DELETE on `audit.audit_actions`. |
| P4.7 | **MFA** on PlatformGrant | 10.7 | Passkey + TOTP mandatory. |
| P4.8 | SMS/OTP provider | 10.8 | Final pick (Twilio / CF-friendly). |
| P4.9 | Tenant-isolation tests | 10.9 | Cross-tenant read attempts fail. |
| P4.10 | Secret-rotation runbooks | 10.10 | `OCPP_INGEST_SECRET`, `OCPP_CRED_KEK`, `AUTH_SECRET`, Neon, R2. |
| P4.11 | **Authorize off shadow-mode** *(new)* | — | Validate per-installation `enforceAuthorize`; ship the IdToken seeding flow (CSV paste) + the pre-flight guard refusing AuthType=Webhooks unless `IdToken.count ≥ 1` (the 2026-05-04 Dalvegur lockout action items). |

**Exit:** dashboards + alerts live; RLS enforced; MFA mandatory; access
gated (not shadow-mode); runbooks reviewed.

---

## P5 — Cutover & Public Launch  *(Track H · target Sprint 14 — folds old Sprint 11)*

**Goal:** public launch on production infra. **Depends:** P1–P4.

| # | Milestone | Old ID | Detail |
|---|---|---|---|
| P5.1 | Domain layout | 11.1 | `app./api./ws.straumvakt.is`. |
| P5.2 | Production CF resources | 11.2 | `hlada-api`, `straumvakt-ocpp`, DO namespace, queues + DLQs, Hyperdrive, R2. |
| P5.3 | Production DB | 11.3 | Neon prod (PITR 14d) + daily backup to R2 + **restore drill executed**. |
| P5.4 | Migration dry-run | 11.4 | All migrations on a fresh prod-shape branch + smoke test. |
| P5.5 | Final 4k load test | 11.5 | Scenario D against production-like config. |
| P5.6 | Rollback paths | 11.6 | UI/API/Gateway + per-migration forward-fix, rehearsed. |
| P5.7 | **Go/no-go signed** | 11.7 | Backup-restore drill, load test, runbooks, secret rotation, on-call, comms plan. |
| P5.8 | First public hosts | — | Real hosts onboarded via P2 flow, billing live via P1. |
| P5.9 | Launch comms + on-call | — | Pilot-customer comms, support rotation. |

**Exit:** **PUBLIC LAUNCH** — real hosts, real drivers, real invoices, on
hardened production infra.

---

## P6+ — Differentiators  *(post-launch · Sprint 15+)*

| # | Milestone | Detail |
|---|---|---|
| P6.1 | **ADR 0032 nágrannahjálp** | The M1–M10 build: schema → driver/helper auth path → 5 detection rules → console + mobile issue/chat surfaces → §5C escalation (after Tengill/0031 pinned, P0.5). |
| P6.2 | Push notifications | FCM + APNs, `push_token` on User, send queue. Lights up notify-on-message for P6.1 chat + session events. |
| P6.3 | Device registry (ADR 0030) | `identity.app_devices`, install telemetry, conversion funnel, one-device-many-kennitölur abuse alerts. |
| P6.4 | Backlog tags | Roaming/OCPI (A), multi-currency (C), OCPP 2.0.1 (A), white-label, enterprise API, advanced detection/ML. |

> **ADR 0032 placement.** Pulled into "go-live" earlier on 2026-06-04; the
> whole-product analysis re-places it **post-launch** — a differentiator on
> top of the onboarding+billing+hardening base. It stays Accepted; only its
> timing moves. Pulling it back to launch inserts it between P3 and P5
> (~+1 sprint). **Operator decision.**

---

## Dependency & parallelism summary

| Phase | Track | Depends on | Parallel with |
|---|---|---|---|
| P0 | — | — | — |
| P1 | E | P0.1–3, ADR 0029 | P4 |
| P2 | E | P1, ADR 0027/0028 | P4 |
| P3 | E | P2 | P4 |
| P4 | H | P0 | P1, P2, P3 |
| P5 | H | P1–P4 | — |
| P6 | — | P5 | — |

**Estimate:** ~5 sprints to public launch with Track H parallel; ADR 0032
adds ~1 sprint if pulled to launch.

## Open items for operator

1. **P0.1–3** — confirm the three ADR 0031 recommendations, or pick others.
2. **ADR 0032 timing** — accept post-launch (P6) or pull to launch (+1 sprint)?
3. **P0.5 Tengill** — define now or defer to P6.
4. **P0.6** — ratify the renumbering + delivery-plan fold.
5. **ADR authoring** — 0027/0028/0029 must be written before their phases
   (P1.0, P2.0); schedule them at each phase's head.
