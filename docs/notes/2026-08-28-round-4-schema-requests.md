# Round 4 — schema requests, Claude B → Claude A

**Channel rule:** one entry per request, appended in order. **Never rewrite an
earlier SR.** Claude A reads this at every phase boundary with

```
git show dev/market-rails:docs/notes/2026-08-28-round-4-schema-requests.md
```

and services or refuses each in writing.

**Claude B does not wait on an SR.** Every phase this round is exercisable over
a port with a fixture adapter, so an unserviced SR delays a Drizzle adapter,
never a deliverable.

Created in Phase 0, deliberately empty. A reads it whether or not it has
content.

---

## Entries

*(none yet)*

### SR-1 — `agreements.clauses` needs an effective-dated interval

**Raised:** Phase 1, 2026-08-28. **Blocked phase:** none — fixture adapter carries it.

**What:** add `period tstzrange NOT NULL` to `agreements.clauses`, with a
temporal key per `(agreement_id, factor_code, period WITHOUT OVERLAPS)`.

**Why:** `ClauseRow` exposes no dating, so a clause today is existence-only and
cannot express "this rate applied in June and a different one from July".
Without it there is no way to change a rate without rewriting what a settled
period cost — which FOCUS rule 4 forbids. The write surface implements
end-and-add against the interval; the column is what makes it real.

**Meanwhile:** `FixtureAgreementStore` carries `period` on the clause row and
all 36 writer tests exercise it, including the settled-period refusal.

### SR-2 — `driver_group_memberships` needs the ADR 0054 item-5 interval

**Raised:** Phase 1, 2026-08-28. **Blocked phase:** none — fixture adapter carries it.

**What:** add `period tstzrange NOT NULL`; drop `UNIQUE (group_id, user_id)`;
add `UNIQUE (group_id, user_id, period WITHOUT OVERLAPS)`.

**Why:** ADR 0054 decision 4 — uniqueness on the interval rather than the pair
is the only thing that makes move-out-then-move-in expressible. `MemberRow`
exposes only `addedAt`, so today a membership is existence-only and Phase 2's
validity check has nothing to read.

**Meanwhile:** the fixture store enforces interval-overlap refusal and the
move-out/move-in case is tested.

### SR-3 — `agreements.mutation_receipts`

**Raised:** Phase 1, 2026-08-28. **Blocked phase:** none — fixture adapter carries it.

**What:** a new table — `idempotency_key text PRIMARY KEY`, `operation text`,
`org_id uuid NOT NULL`, `target_id uuid`, `at timestamptz NOT NULL`,
`replayed boolean NOT NULL DEFAULT false`.

**Why:** every mutating operation on the agreement surface emits a receipt, and
a missing idempotency key is a refusal rather than a generated one. Without the
table a retried month-end operator script writes twice.

**Meanwhile:** receipts live in the fixture store and are asserted per
operation.
