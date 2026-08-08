# DECISIONS

One line per decision. Newest first.

This replaces the ADR habit for the market phase. The ADR-per-decision
ceremony produced 51 documents that exceeded what anyone could hold, so each
new question got answered fresh instead of looked up — which is how three
billing generations happened. See [FOCUS.md](./FOCUS.md) rule 8.

**How to add an entry:** date, one sentence, and the consequence if it is not
obvious. No template, no status field, no supersession chain.

**When to write an ADR instead:** only when a decision is genuinely
load-bearing *and* irreversible — a schema shape that will carry money, or a
boundary that other people will build against. Expect that to be rare. If you
are reaching for an ADR to think out loud, write the line here instead.

---

| Date | Decision |
|---|---|
| 2026-08-08 | **`.env.example` ADMIN defaults blanked.** It shipped non-empty ADMIN_EMAIL/ADMIN_PASSWORD and is tracked in git — that, not the code, was the source of the weak credential. Auth was already binding-only: no fallback in either path, no value in any of the three worker configs (covering all four workers). Operator sets ADMIN_PASSWORD per env; the old value is compromised via git history. |
| 2026-08-08 | **Work view hosting = option C** — `/admin/work` on the console, decoupled from staging. No domain wired. It ships by normal branch→worker promotion, not a special deploy. |
| 2026-08-08 | **straumvakt.org repoint deferred to WS2** (Track B task 10). It is a `custom_domain` on the STAGING worker; gating an operational page on the staging session is circular while that credential rotates. Env cleanup, not housekeeping. |
| 2026-08-08 | **The 22 unreferenced `/mobile-app-mock/` files stay put.** Flutter build output (`canvaskit/*.wasm`, `flutter.js`, `main.dart.js`) loaded at RUNTIME and therefore invisible to a static scan, while the other 18 files in that directory are referenced. Parking them would break the demo silently. `/mobile-app-mock` is a whole-directory keep/kill decision for later. |
| 2026-08-08 | **straumvakt.org runs on the STAGING worker** — surfaced for WS2 env cleanup. An admin-gated page there would be gated by the staging session and tied to staging's lifecycle, which is circular while the admin credential is being rotated. The work view is deliberately NOT wired to it. |
| 2026-08-08 | **Admin credential prepared; nothing set.** Verified NOT hardcoded — both auth paths read the binding with no fallback and throw if unset, and wrangler.jsonc mentions them in comments only. The weak value comes from `.env.example`, which ships non-empty ADMIN_EMAIL/ADMIN_PASSWORD and is tracked in git. Rotation is an operator action per env; blanking the template needs a Rule 2 decision. |
| 2026-08-08 | **Gated work view generated, not hand-kept** — `/admin/work` is derived from WORKSPACE.md + TASKS.md by `npm run work-view`, with `check:work-view` failing on staleness. A hand-maintained status page is a second source of truth that drifts silently and then lies confidently. Gated by the existing `(app)` layout. **Deploy pending go-ahead.** |
| 2026-08-08 | **SERVICES.md added** — full paid-services register. Two market-critical gaps named: invoice **delivery** (PDF vs PEPPOL/TS-236) and **collection** (bank claim via RB — which bank to register as kröfuhafi), both **PENDING operator decision**, not picked. Dev-tier cost delta ≈ $40–50/mo hot vs ≈ $5–15/mo scale-to-zero; scale-to-zero recommended. Also flagged: no observability, and email fails OPEN (right for notices, wrong for invoices). |
| 2026-08-08 | **WORKSPACE.md reconciled to measured numbers** — Prisma 481 / Drizzle 131 (~21%), baseline 24 (22 vendor), 51 ADRs bannered, packages 3. Three seed lines were wrong and are recorded: `packages/db` does not exist (schema is `packages/shared/src/db/`), packages was 1 not 3, and the ~500 Prisma figure was stale with the Drizzle side uncounted. |
| 2026-08-08 | **`packages/contracts` created — the clean shell spine.** Canonical vocabulary harvested out of `shared` (19 domain modules, 10 input modules) plus two new pieces: the vendor-adapter interface and the money-line shape. `shared` re-exports everything, so none of the 127 consumers changed. `packages/commercial` created as an empty home; its harvest is Rule-5 gated. |
| 2026-08-08 | **Build model = harvest into clean shell (strangler).** Proven code moves into clean packages preserving its earned correctness; old paths retire only after parity; no rewrite, no parity cliff. |
| 2026-08-08 | **Two money lines, one engine** — host↔driver is the *host's* money (Straumvakt is agent, presents the claim on their behalf); Straumvakt↔host is *Straumvakt's* money. The flat connector fee is the second line, which is why it ships first: no attribution, and no handling of anyone else's money. Rule 3 rewritten; it previously blurred the two. |
| 2026-08-08 | **Prisma is not part of the baseline — touch it, convert it.** Anything edited on the way to market moves to Drizzle in the same change. A standing exception to rules 1 and 8, decided once. Discipline unchanged: repository before route; parity or rolled-back-real-DB coverage on the ingest and money paths. |
| 2026-08-07 | **Market-focus pivot** — FOCUS.md is the active canon; the ADR corpus is retired to legacy reference (banner-marked in place, nothing deleted or moved); two active workstreams: onboarding, and CDR→invoice ledger. |
