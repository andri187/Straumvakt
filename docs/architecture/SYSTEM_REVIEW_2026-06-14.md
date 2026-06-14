# Straumvakt — System Review & Gap Check (2026-06-14)

Point-in-time, end-to-end review of the platform: how the web + mobile + API
link together, what is real vs stub, and the gap check toward a public launch.
Companion to `GOING_PUBLIC_CRITICAL_PATH.md` and `TENANT_ISOLATION_AUDIT.md`.
Snapshot — re-run/refresh before any go/no-go.

> Method: parallel read-only review across web portals, mobile apps, API
> backend, billing/agreements/OCPP, and infra/deploy/security.

---

## 1. How it all links (the map)

```
        ┌─ straumvakt.org (landing + unified login)
        │     cascade: POST /api/admin/login → 200 operator/host
        │              401 → driver bearer login
        ▼
  ┌─────────────┬──────────────┬────────────────┐
  │ OPERATOR    │ HOST /host    │ DRIVER /driver  │  ← ONE Next app (hlada-staging)
  │ /(app)      │ cookie auth   │ bearer (local-  │     pure client; host.css system
  │ cookie auth │ persona gate  │ Storage) auth   │
  └──────┬──────┴──────┬────────┴───────┬─────────┘
         └──── HOSTMAP (hostname→API) ───┘
                       ▼
         api.straumvakt.org  (hlada-api-staging, Hono)
            ├─ /api/admin/*            operator (platform.* perms)
            ├─ /api/admin/orgs/:id/*   host (HOST_ADMIN_BUNDLE + orgIdParam)
            ├─ /api/driver/*           driver (bearer) ← SAME API the Flutter app uses
            ├─ /api/internal,/webhooks OCPP gateway + Zaptec
            └─ queues + cron (agreements billing tick, zaptec sync)
                       ▼
   straumvakt-ocpp gateway (DO) → queue → projections → Neon (Hyperdrive)
   Fly.io zaptec-consumer (AMQP) → CDR sync
   apps/driver (Flutter, NFC tap-to-start) → /api/driver/* (staging-pinned)
```

Linking is consistent: mobile app + driver web hit the **same** `/api/driver/*`
bearer API; host + operator share the HMAC cookie; persona routing works; one
hostname→API map drives all clients (defined 3× — minor drift risk).

---

## 2. What's solid ✅

- **Three web portals on real data** — operator console (full CRUD over
  sites/installations/circuits/chargers/orgs/billing); host portal (dashboard,
  Site→Installation→Circuit→Charger tree with dedup + status dots, drivers +
  RFID, invites, agreements read view); driver portal (dashboard, history,
  cost/invoice document, access, redeem).
- **API well-structured** — 43 repositories, clean permission bundles
  (`HOST_ADMIN_BUNDLE`), tight CORS (origin allowlist, not `*`), credential
  encryption (KEK), idempotent OCPP projections, no mock data (Rule 6 clean).
- **Agreement pricing engine** (`apps/api/src/lib/agreement/resolve.ts`) is
  complete + well-tested (27 cases): per-factor cascade, passthrough/markup,
  VAT, audit blob. Real engine behind the model.
- **Mobile driver app** (`apps/driver`, NFC-only) — login, charger list,
  start/stop with real-transaction polling, pricing preview, all on the same API.

---

## 3. Gap check — by severity

### 🔴 Launch blockers

1. **No production environment exists.** `straumvakt.org` points at **staging**
   infra. No `env.production` block for the API worker, no prod queues/DO/R2, no
   prod Neon cutover. All of P5 unstarted.
2. **Billing isn't real.** Legacy tariff chain still prices 100% of sessions and
   writes `reports.session_ledger`; the agreement engine writes
   `agreements.billing_lines` as a **write-only shadow table nothing reads**.
   **No invoice generation engine** (zero `invoice.create`) — every "invoice" is
   derived-on-read from session history. The 2026-06-14 cost model
   (forward-with-markup, ACS/USRF, bearer resolution) needs the **ADR 0025
   cutover + an invoice engine** to become real.
3. **No DB tenant isolation (RLS).** 100% app-layer; ~40 admin repos unscoped
   ("safe-by-accident"); **bootstrap sessions are unconditional god-mode**
   (`require-permission.ts`). No DB backstop for a forgotten `where`.
4. **CDR-vs-OCPP double-count unresolved** — OCPP projection and Zaptec CDR sync
   both write the ledger keyed on different IDs; no reconciliation. (One row was
   hand-corrected 2026-06-14; the class of bug remains.) Must fix before the
   agreement resolver compounds it.

### 🟠 Major (pre-launch)

5. **No MFA** (dormant `totpSecret`, zero enforcement); **rate-limiting login-only
   and fails open**; driver-login limiter declared but route unprotected.
6. **Mobile market blockers** — English-only (Icelandic i18n is the stated
   blocker); History/Cost tabs empty stubs (endpoints exist, app doesn't call);
   **staging-pinned (no prod URL)**; no refresh-token flow; only signed AAB is
   stale (built from the older CPMS predecessor, not `apps/driver`); Play upload
   pending.
7. **Host self-service missing** — "Setja upp stöð" (add charger),
   "Aðgangsbeiðnir" (access requests), "Reikningar" (invoices) all `soon`; host
   **settings is read-only**. A public host can't provision or self-manage.
8. **OCPP ingest trusts envelope `orgId`** — perimeter-secret only, no row guard.

### 🟡 Polish / cleanup

- Operator dashboard is a static HTML mockup (zero fetches); real version
  archived at `docs/app/dashboard-original.tsx`.
- Legacy `billing.contracts` vs `agreements.*` both live with active routes —
  half-migrated by design; cleanup owed (ADR 0025 step 6).
- Mobile tree sprawl — 4 Flutter trees; `apps/driver` canonical, archive the
  other three (`apps/mobile`, CPMS `mobile-app`, CPMS `mobile-app-driver`).
- HOSTMAP defined 3×; `driver/redeem` re-inlines auth; `schema.prisma` has 2
  stale "MDU-only" comments (lines ~776, ~2850); `flutter_blue_plus` unused dep.
- Landing advertises Auðkenni / Nýskráning that don't function.

---

## 4. Critical-path status (P0–P6)

| Phase | Scope | Status |
|---|---|---|
| **P0** Decisions | Lock ADRs | Mostly DONE (driver-access-fee resolved 2026-06-14) |
| **P1** Billing | Factor codes, invoice engine, attribution | Engine exists; **not cutover, no invoicing** ← big build |
| **P2** Onboarding | Host/driver self-service, scoped RBAC | `/apply` RFQ + inbox done; host self-service + scoped portal not |
| **P3** Mobile | Redeem, **i18n**, release | ~70% shell; i18n + redeem + release pending |
| **P4** Hardening | RLS, MFA, audit, runbooks | **~15–20%** (CORS + login limit + cred encryption only) |
| **P5** Cutover | Prod domains/resources/Neon, drills | **0% — nothing exists** |
| **P6+** | nágrannahjálp, push, device registry | Post-launch |

---

## 5. Read on sequencing

Model design is done and solid. The bottleneck is **execution**:

1. **P4 tenant isolation** (RLS + kill god-mode) — non-negotiable safety gate
   before real multi-user host logins.
2. **P1 billing cutover + invoice engine** (ADR 0025: flag → shadow gate → flip
   → invoice run), plus **CDR↔OCPP reconciliation** as a prerequisite.
3. **P5 stand up a real production environment** (the whole public surface runs
   on staging today).
4. **P3 mobile i18n + release** in parallel (market blocker).

---

## 6. Source audits

- `docs/architecture/GOING_PUBLIC_CRITICAL_PATH.md` — phase plan.
- `docs/architecture/TENANT_ISOLATION_AUDIT.md` — RLS / scoping findings (C, D, G).
- `docs/operator/RATE_LIMITER_BINDINGS_TODO.md` — rate-limit fail-open.
- `docs/adr/0025-billing-cutover-from-legacy-to-agreements.md` — **Proposed**, not executed.
- `docs/adr/0019` + `0031` + `0032` — agreement/cost model (amended 2026-06-14).
