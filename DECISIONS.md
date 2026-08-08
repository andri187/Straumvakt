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
| 2026-08-08 | **`packages/contracts` created — the clean shell spine.** Canonical vocabulary harvested out of `shared` (19 domain modules, 10 input modules) plus two new pieces: the vendor-adapter interface and the money-line shape. `shared` re-exports everything, so none of the 127 consumers changed. `packages/commercial` created as an empty home; its harvest is Rule-5 gated. |
| 2026-08-08 | **Build model = harvest into clean shell (strangler).** Proven code moves into clean packages preserving its earned correctness; old paths retire only after parity; no rewrite, no parity cliff. |
| 2026-08-08 | **Two money lines, one engine** — host↔driver is the *host's* money (Straumvakt is agent, presents the claim on their behalf); Straumvakt↔host is *Straumvakt's* money. The flat connector fee is the second line, which is why it ships first: no attribution, and no handling of anyone else's money. Rule 3 rewritten; it previously blurred the two. |
| 2026-08-08 | **Prisma is not part of the baseline — touch it, convert it.** Anything edited on the way to market moves to Drizzle in the same change. A standing exception to rules 1 and 8, decided once. Discipline unchanged: repository before route; parity or rolled-back-real-DB coverage on the ingest and money paths. |
| 2026-08-07 | **Market-focus pivot** — FOCUS.md is the active canon; the ADR corpus is retired to legacy reference (banner-marked in place, nothing deleted or moved); two active workstreams: onboarding, and CDR→invoice ledger. |
