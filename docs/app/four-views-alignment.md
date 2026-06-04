# Four views ↔ the Straumvakt build — alignment & gap check

**Date:** 2026-06-04
**Views:** [straumvakt-admin](./straumvakt-admin-concept.html) (staff) ·
[host-portal](./host-portal-concept.html) (host-admin) ·
[driver-portal](./driver-portal-concept.html) (driver) ·
[technician-support](./technician-support-concept.html) (contractor — in progress)
**Method:** mockups read in full; DB/user-model, mobile↔driver-API, and
technician backing verified against the codebase.

---

## 1. The spine — one persona, one data backing, one view

| View | Persona | Data backing (verified) | Backing complete? |
|---|---|---|---|
| **straumvakt-admin** | Straumvakt staff | `PlatformGrant` (PlatformRole: super_user, platform_admin, support_agent, sales_cs, finance_internal, auditor) + MFA/expiry | ✅ complete |
| **host-portal** | Host-admin | `Membership.role = host_admin` (ADR 0027) + `HOST_ADMIN_BUNDLE` | ✅ complete |
| **driver-portal** + **mobile** | Driver | `User.audience='driver'` + `DriverGroupMembership` (access) + `BillObjectMember` (billing-home) + `IdToken` | ✅ identity/access/billing; ⚠️ Issues/Helper/Family need more |
| **technician-support** | Contractor / Tengill | *intended:* `Membership.role=technician` / `OrganizationRole.service_contractor` / `is_helper` | ❌ **NOT backed** (see §4) |

**Design system is already aligned** — all four share the same palette,
cards, badges, and the switcher pattern (admin = host switcher, host =
installation switcher, driver = Home/Work billing-context switcher). Keep
that. The gaps are in *data backing* and *scope*, not visual language.

## 2. DB architecture / user-model check

The identity/tenancy/billing schema is **solid and internally consistent**
(User audience, Membership roles incl. `host_admin`, PlatformGrant,
Organization `kind`+roles[], DriverGroup/Membership, BillObject/Member,
IdToken, UserToken `kind='driver'`, host_applications all present and
correct). Two real problems:

### ⚠️ DB-1 — Dual-schema drift on `IdTokenKind`
Root `prisma/schema.prisma` (migration source) carries more enum values
(incl. `virtual_rfid` from ADR 0022, `zaptec_proxy`, `ocpi_token`,
`evccid`…) than the **apps/api mirror**. The API worker's generated client
therefore can't reference values that exist in the staging DB. This is the
dual-schema maintenance risk biting — the two copies must be reconciled
(and a guardrail added so they can't silently diverge).

### ❌ DB-2 — ADR 0032 schema entirely unapplied
ADR 0032 is **Accepted** but its migration was never created. Missing
everywhere: `driver_group_memberships.is_helper` (+ helper_granted_*),
`issues.tickets.raised_by_user_id`, the `issues.ticket_chat_messages`
table, and the `issue.*` permission verbs. **This unbacks the entire
technician view and the driver Issues/Helper screens.**

> Note: the foundation migration (0026/0027/0028/0029) *is* applied to
> staging; only 0032 is outstanding.

### Family / dependent model (driver Family screen)
ADR 0031 item 18 (dependent child without kennitala, billed via the
group-owner's billing-home) is a *concept*; there's no dedicated schema
beyond BillObjectMember + the kennitala-nullable carve-out. The driver
"Family" screen needs this pinned.

## 3. Per-view gap check (mock vs build)

**straumvakt-admin** — mock now mirrors the live nav; existing surfaces
real, additions tagged `new`. Gaps are *features not yet built* (Hosts
lens, Diagnostics, Access&auth go-live, Applications UI, Host invoices),
not schema gaps. Backing exists for all except the Issue-Engine bits.

**host-portal** — matches `host_admin` capabilities well. Its "Units &
owners" = BillObject; "Drivers" = DriverGroupMembership; "Invoices" =
agent billing. All backed *except* invoices (P0.7) and the issue/helper
cards (ADR 0032 unbuilt). Good alignment otherwise.

**driver-portal** — identity/access/billing/charging screens are backed.
**Unbacked:** Issues + Helper (ADR 0032 schema missing), Family
(dependent model unpinned), and several screens need driver-API endpoints
that don't exist (see §4). The Home/Work **billing-context switcher** is
schema-ready (multiple DriverGroupMemberships) but has no API.

**technician-support** — depicts a real ADR 0032 future, but **0% backed
today**: no `is_helper`, no `issue.*` permissions, no Issue-Engine
routes/repos, no `ticket_chat_messages`, no escalation flow, and "Tengill"
isn't a defined entity (P0.5 open). It also depends on ADR 0031 cost
mechanics (P0.7). This view is *aspirational* until the ADR 0032 build
lands. Keep it as the design target; don't imply it's near.

## 4. Mobile app ↔ driver web ↔ driver API (alignment)

**Coherence today ≈ 40%.** The app is a working MVP (login · charger list
· BLE nearby · start-session). The driver-portal web mock is ~100%
designed. The API sits between (~60%). To make them one experience:

### Missing on BOTH app and API (build these)
- **Stop session** — `POST /api/driver/stop-session` + UI.
- **Live session** — `GET /api/driver/sessions/current` (poll) + an
  active-session screen with the live gauge the web mock shows.
- **Session history** — `GET /api/driver/sessions/history` + screen.
- **Profile edit + i18n** — `PATCH /api/driver/me` (displayName, locale)
  + an in-app language toggle (app currently can't change locale).

### API has, app doesn't use (wire them)
- `GET /api/driver/installations`, `GET /api/driver/chargers/:id/pricing`
  (cost transparency), `POST /api/driver/access-requests` (empty-state).

### Going-public blocker (ADR 0026)
- **Invite redemption** — code / QR / email + **kennitala capture** +
  empty-state funnel. The API has `/invites/consume`; the **app has no
  redemption flow and no QR scanner**. This is the #1 driver blocker.

### Web-vs-app scope drift to resolve
The web mock shows **Issues, Helper, Family, multi-context** — none exist
in the app and most aren't backed. Decision: the **mobile app is the
canonical driver surface** (ADR 0026 §5 makes redemption mobile-only);
the **driver *web* portal should mirror the app**, not lead it. Trim the
web mock to what the app will actually do at launch (charging + cost +
access + redeem), and stage Issues/Helper/Family behind the ADR 0032 /
0031 builds — same as the app.

## 5. Streamlining — make the four coherent

> **Status (2026-06-04):** mock-level streamlining items 1, 2 and the
> status-legend pass are **done** in the four `docs/app/*.html` mockups
> (see ✅ below). Items that depend on shipping code (3 switcher refactor
> in the real app, 4 schema work, 5 mobile parity) remain open — they are
> not mock edits.

1. ✅ **Lead with the persona's data — done (tagging pass).** A shared
   `.tag`/`.newtag` convention now spans all four mocks: green `new`
   (backed, newly surfaced) and amber `soon` (not backed yet, ADR/P-gated).
   - **driver**: `Family` (`soon · ADR 0031`), `Issues`/`Mín mál` and
     `Helper`/`Verða hjálpari` (`soon · ADR 0032`), and the home↔work
     **billing-context switcher** (`soon`) are tagged in nav, headings, and
     the two aspirational dashboard cards, with "háð kerfi" sub-notes.
   - **technician**: tagged **whole-view aspirational** — a persistent
     amber banner at the top of `.content` (0% backed; gated on ADR 0032 +
     Tengill P0.5 + access-fee P0.7), plus `soon` chips on the sidebar
     section and dashboard heading.
   - **host**: `Invoices`/`Reikningar` tagged `soon · P0.7` in nav and
     heading. (No issue/helper cards exist in the host mock, so nothing
     else to stage there.)
2. ✅ **One vocabulary across all four — done.** Each mock now carries a
   **Status legend** footer that fixes the mapping: **billing-home** (IS
   **eining**) = BillObject · **access group** (IS **aðgangshópur**) =
   DriverGroup · **host type** (IS *tegund* — Fjölbýli/Fyrirtæki) =
   Organization.kind. The host portal's "Einingar & eigendur" heading now
   glosses "· billing-home" so it visibly equals the driver/admin term. The
   admin legend prints the canonical control-plane badge set
   (`OCPP 1.6J` / `ZAPTEC·N` / `ZAPTEC·WH` / `EASEE` / `EXT·CPMS`); the
   technician keeps the same `OCPP 1.6J` wording. (Host deliberately hides
   plane badges by altitude — unchanged.)
   - Status-legend footer added to **all four** mocks (item 4 of the brief).
3. ⏳ **The switcher is the shared interaction.** Host-scope (admin),
   installation-scope (host), billing-context (driver), assigned-scope
   (technician) are the same pattern at different altitudes. Standardise
   it (topbar dropdown + scope bar + row filtering). *(Real-app refactor —
   not a mock edit; the driver billing-context switcher is also `soon`.)*
4. ⏳ **Reconcile the dual schema (DB-1)** and **apply ADR 0032 (DB-2)**
   before the driver/technician mocks can be more than aspirational.
5. ⏳ **Mobile = source of truth for the driver experience**; the web portal
   mirrors it. Build the missing session-lifecycle + invite-redemption
   first (they unblock both surfaces).

## 6. Prioritised actions

| # | Action | Unblocks | Type |
|---|---|---|---|
| 1 | Reconcile root↔apps/api schema (IdTokenKind etc.) + add a parity guard | correctness everywhere | DB hygiene |
| 2 | Build driver session-lifecycle API (stop / current / history) + `PATCH /me` | mobile + web driver parity | API |
| 3 | Mobile invite-redemption (code/QR/email + kennitala + empty-state) | going public (ADR 0026) | mobile |
| 4 | Apply ADR 0032 migration (is_helper, raised_by_user_id, ticket_chat_messages, issue.*) | driver Issues/Helper + **all** of technician view | DB + ADR |
| 5 | Pin Tengill (P0.5) + access-fee (P0.7) | escalation, invoices, contractor settlement | decision |
| 6 | Trim/stage the driver + technician mocks to match backing; unify vocabulary | coherence | design |

**Bottom line:** staff + host-admin + driver(core) are real and aligned.
The **driver Issues/Helper, the whole technician view, and host invoices**
are aspirational — gated on **applying ADR 0032**, **pinning Tengill/P0.7**,
and **building the driver session-lifecycle + invite-redemption**. And the
dual schema needs reconciling now.
