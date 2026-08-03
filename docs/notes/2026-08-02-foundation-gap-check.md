# 2026-08-02 — Foundation gap check, hardwire check, sanity check

Triggered by: "before we build further, is the foundation sound for what
we intend to put on it." Scope read: `GOING_PUBLIC_CRITICAL_PATH.md`,
`SPRINT_11_TASKS.md`, `P4_TASKS.md`, `SYSTEM_REVIEW_2026-06-14.md`,
`TENANT_ISOLATION_AUDIT.md`, `STRAUMVAKT_ARCHITECTURE_V3.md`, ADR set
0001–0038, and the API/gateway source.

Findings are ordered by whether they *block or corrupt* work already
planned on top — not by how hard they are to fix.

---

## 1. RLS × serving tier — resolved in ADR 0038 §A

**Was:** P4.5 commits to Postgres RLS as the tenant-isolation backstop.
ADR 0038 moves reads out of Postgres. RLS only guards rows read through
Postgres. Neither document referenced the other, so whichever shipped
second would have quietly undermined the first.

**Now:** [ADR 0038 Addendum §A](../adr/0038-read-serving-tier-and-state-propagation.md)
— tenancy enforced twice: RLS at fill time (nothing enters the tier
unfiltered), single-tenant objects at serve time (installation grain, so
there is no query whose scope could be forgotten). Sequencing fixed:
**RLS first, tier second.** `GOING_PUBLIC_CRITICAL_PATH.md` P4.5 now
states this.

**Status:** closed as a design question. Both tracks unblocked.

---

## 2. Two event pipelines were about to be built — resolved in ADR 0038 §B

Architecture V3 §7 already specifies a Push API subsystem with a fixed
event vocabulary, signed POST, idempotency, retry, subscriber registry
and DLQ. Nothing implements it. ADR 0038's Hot tier is the same
machinery with a different transport.

Folded into one spine: V3 §7 owns the event contract, ADR 0038 owns
delivery; internal sockets and external webhooks are two subscriber
shapes on one fanout.

**Owed:** a pointer line in V3 §7 back to ADR 0038. Not written — §7 is
on Rule 5's protected list and another agent is active in the tree.

---

## 3. "SSE is P6.2" was wrong — corrected

`P4_TASKS.md` twice deferred SSE to P6.2. P6.2 is *FCM/APNs push
notifications* — background delivery, a different concern. ADR 0023 had
the split right (push wakes a backgrounded app, SSE serves a foregrounded
one); the task docs lost it.

Corrected in `P4_TASKS.md` (two places). P4.31 (polling backoff) is now
marked explicitly as interim mitigation rather than the fix.

Also corrected: `GOING_PUBLIC_CRITICAL_PATH.md` **P3.6** said "poll
session status post-start." Building that as written would hardcode the
thing ADR 0038 exists to remove, in the sprint immediately before the
tier lands. Now marked "do not build as a poll."

---

## 4. Mobile workspace — four trees, canonical is the emptiest

**Marked, not actioned** — operator has taken workspace cleanup as a
separate priority.

| tree | contents |
|---|---|
| `apps/driver` — *named canonical by the 2026-06-14 review* | `api.dart`, `config.dart`, `main.dart`, `nfc_auth.dart`. **No BLE scanner. No i18n.** |
| `apps/mobile` | `ble/`, `i18n/`, `screens/`, `theme/` — ADR 0024's addendum cites `apps/mobile/lib/ble/scanner.dart` |
| `CPMS/mobile-app-driver` | `api.dart`, **`ble_scanner.dart`** (the field-validated one), `config.dart`, `main.dart`, `nfc_auth.dart`, `tap_intent.dart` |
| `CPMS/mobile-app` | mock/showcase build (`straumvakt_mock1`) |

Consequences to keep in view during cleanup:

- Every Tap & Auth field finding — 37/37 serial capture, the RSSI
  calibration table, the four fixed scan bugs — lives in
  `CPMS/mobile-app-driver/lib/ble_scanner.dart`, i.e. in an
  archive-candidate tree, not in the canonical one.
- `tap_intent.dart` (written 2026-08-02) went into that same tree and
  will need to move with it.
- **P3.5 (Icelandic i18n) is a stated market blocker** and the existing
  i18n work is in `apps/mobile`. Fixing the blocker in a tree that is
  about to be archived doubles the work.
- The review's "canonical = `apps/driver`" call was made on repository
  location. By *content*, `apps/mobile` and `CPMS/mobile-app-driver`
  each hold more shipped work. Worth re-confirming the choice on
  content before porting.

**Recommendation:** consolidate before P3.5, not after.

---

## 5. Hardwire check — what new work would bind to

Tap-to-charge (scoped 2026-08-02) binds to three things that are not
solid. The modules are correct in isolation; the wiring is what must
wait.

| dependency | state | consequence |
|---|---|---|
| `enforceAuthorize` | default-off everywhere; **P4.11 unshipped** (the flip, IdToken seeding, and the pre-flight guard from the 2026-05-04 Dalvegur lockout) | tap-to-charge is an authorize-path feature; until the gate is real, wiring it proves nothing |
| ledger attribution | **launch blocker #4** — OCPP projection and Zaptec CDR sync both write the ledger on different keys, no reconciliation; one row hand-corrected 2026-06-14 | tap attribution adds a third path by which a session acquires a driver identity, on top of an unreconciled ledger |
| read tier | none exists | tap intent is Hot-tier data currently living in Postgres |

**Decision:** do not wire the resolver hook until P4.11 lands. The
repository interface (`matchAndConsumeTapIntent`) is the seam for moving
the store behind the DO later, so nothing is wasted by waiting.

---

## 6. Gaps confirmed still open (tracked elsewhere, not re-litigated here)

From `SYSTEM_REVIEW_2026-06-14.md` §3 and the tenant audit:

- 🔴 **No production environment.** `straumvakt.org` points at staging;
  all of P5 unstarted.
- 🔴 **Billing isn't real.** `agreements.billing_lines` is a write-only
  shadow nothing reads; zero `invoice.create`.
- 🔴 **No DB tenant isolation.** 100% app-layer, ~40 unscoped admin
  repos "safe-by-accident", bootstrap sessions unconditional god-mode.
- 🔴 **CDR-vs-OCPP double-count** — see §5. **This one compounds while
  open**; every week adds rows someone reconciles by hand. Argues for
  priority over the rest of P4.
- 🟠 OCPP ingest trusts envelope `orgId` (perimeter secret only).
- 🟠 No MFA; rate-limiting login-only and fails open.

---

## 7. Documentation integrity

- **Duplicate ADR 0021 — closed.** Docs side was resolved earlier on
  2026-08-02 (autocharge → 0036, per ADR 0035 F20). The *code* citations
  were still split: 26 autocharge references across 13 files moved to
  0036 in this pass; the 5 genuine rate-reference-propagation citations
  in `billing-tariff-mgmt.ts` and `routes/admin/billing.ts` correctly
  remain 0021. `P4_TASKS.md` item ticked.
- **ADR 0030 is missing.** P6.3 cites "Device registry (ADR 0030) —
  `identity.app_devices`, install telemetry, one-device-many-kennitölur
  abuse alerts", but no such ADR exists; 0030 is the only gap in
  0001–0038. It is also the natural home for per-device driver identity,
  including the device-handle design sketched in the Tap & Auth note — that
  work should land there rather than growing a parallel model.

---

## 8. Suggested order

1. **Ledger reconciliation** (blocker #4) — compounds while open, and
   everything financial sits on it.
2. **P4.5 RLS** — now explicitly ahead of the serving tier.
3. **ADR 0038 tier + event spine** — also the prerequisite for P4.21's
   Neon CU-hour measurements meaning anything.
4. **Mobile consolidation** — before P3.5 i18n.
5. **P4.11** — then, and only then, wire tap-to-charge.
6. **Write ADR 0030** before more per-device identity work.

---

## Changed in this pass

- `docs/adr/0038-…md` — addendum §A–§E (RLS × tier, one event spine,
  P6.2 correction, proposed invariants I-1/I-2, related gaps)
- `docs/architecture/GOING_PUBLIC_CRITICAL_PATH.md` — P3.6, P4.5
- `docs/sprints/P4_TASKS.md` — ADR 0021 item ticked; two SSE/P6.2
  corrections
- 13 source/schema files — autocharge ADR citations 0021 → 0036
