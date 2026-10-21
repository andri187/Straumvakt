# The six unaccounted essentials — which have a schema consequence, and which do not

§12 backlog item 4. `2026-08-19-clean-shell-requirements.md` names six things
that are essential and unaccounted for. **The question here is narrower than
"should we build them": it is which of them constrain the SHAPE of the schema,
and therefore want deciding while the schema is still young.**

Design and document only. **Nothing here is built this round.**

The test applied to each: *if we build this in six months, does it cost more
than it would today, and is that cost structural?* A missing table is cheap
later. A missing **column on a table that already has rows** is not, and a
missing **identity** is worst of all.

| | essential | schema consequence | verdict |
|---|---|---|---|
| 2.1 | the organisation is never read | **none** | wiring, not schema |
| 2.2 | no remittance ledger | **large, and it is money** | **decide now** |
| 2.3 | cannot receive money | **medium** | decide the identity now |
| 2.4 | no audit trail | **small but load-bearing** | **decide now** |
| 2.5 | nothing watches anything | **none** | wiring |
| 2.6 | retention has no owner | **medium, and it gets worse with rows** | decide now |

## 2.1 — no schema consequence at all

`tenancy.organizations` has the legal name, and `Organization` already carries
what `renderHeader` needs. The clean shell takes them from a fixture because
nothing joined the table, not because the columns are missing. **This is a
join, and it is the cheapest item on the list.**

One caveat worth a column check before it is called free: whether
`organizations` holds a **VAT number** distinct from the kennitala. An Icelandic
sales invoice names both, and they are not the same identifier.

## 2.2 — the remittance ledger, and it is the one that should land first

**The moment one dweller pays, Straumvakt is holding somebody else's money with
no ledger for it.**

The document layer already distinguishes the two money lines — `claimHolder`,
agent posture, `Straumvakt f.h. <host>` — so the *invoice* is right. What is
missing is the **account**: collected-versus-remitted per org, per period, with
a balance a host can ask about.

**Why it is a schema decision and not a later feature.** A remittance ledger is
not derivable from invoices. An invoice says what was *billed*; remittance
needs what was *collected*, what was *remitted*, and *when* — three facts none
of which any current table records. Reconstructing them retroactively from bank
statements is the work the ledger exists to avoid.

**What the shape has to get right on day one**, because these are the parts
that are expensive to change once there are rows:

- **A movement is an entry, never a mutable balance.** A balance column is a
  running total that can drift from its history and cannot be audited. The
  balance is `SUM(entries)`, always.
- **Every entry carries the org whose money it is** — which is *not* always the
  org being invoiced. That is the whole agent posture, and a schema that
  assumes one org per entry cannot express it.
- **Aurar as `bigint`, never a float**, matching the money engine.
- **An entry references the document that caused it**, so "why do you owe me
  this" is a join and not an investigation.

This is also where the accountant's `vörslureikningur` (client-account)
question stops being theoretical — and **that is an answer we need before the
table exists**, because it decides whether collected money is one balance or
two.

## 2.3 — payment: decide the IDENTITY now, defer the rail

The rail (claims, kröfuhafi, a bank file format) is genuinely deferrable — the
do-nothing baseline is a transfer against an emailed PDF, matched by hand.

**The payment REFERENCE is not deferrable.** An incoming transfer carries
whatever the payer typed, and matching it needs an identifier that was on the
document. We already have one: **the document number**, which migration 0004
makes unique per org and gap-free. Nothing else needs to exist for a hand-match
to work, and nothing else should be invented for it.

What *would* be expensive later: discovering that the number an operator
matches against is not the one printed. **It is, and it now provably is** — that
is what 0004 bought, and this item is already paid for.

## 2.4 — the audit trail: small schema, and it is load-bearing

`audit.actions` **already exists in the baseline** and nothing writes to it. So
the schema consequence is not a new table; it is whether the existing one can
carry what an agent-posture CPMS has to answer.

See the companion note, `2026-08-28-asset-audit-trail.md`, which works this
through for the asset model specifically — attach, detach, assert, retire.

**Checked rather than assumed, and the answer is better than expected.**
`audit.actions` already carries `org_id NOT NULL`, `actor_user_id`,
`actor_kind`, `action`, `target_type`, `target_id`, `metadata` and
`occurred_at`. **There is no missing column.**

The structural point survives the correction and is worth stating anyway,
because it is a rule about how the existing column must be USED: an audit row
must record the tenant the target belonged to **at the time**, not the tenant
it belongs to now. A device that moves between hosts would otherwise have its
history silently re-attributed by exactly the read ADR 0054 exists to prevent
elsewhere — and since `org_id` is written at insert time, that rule is free if
the writer never back-fills it and expensive to recover if it does.

## 2.5 — no schema consequence

The sweeper, the metrics writer and the scrubber are written and unwired.
Wiring is code and configuration. A notification *log* would be a table, but it
is not required to make the channel work and can be added when there is one.

## 2.6 — retention: decide the CLASS now, defer the deletion

Two clocks: invoices for 7 years, per-resident session data as personal data
with a presence pattern attached.

**The deletion path is deferrable. The classification is not**, because it is a
property of the row and rows are being written now. Every table that will hold
personal data needs to be answerable about which class it is in — and the
answer is nearly free while the tables are young and impossible to reconstruct
once they are not: you cannot tell, later, which of a million session rows
belonged to a resident who has since left.

**ADR 0054 already made one retention decision and should be read as having
done so:** decision 7 says lifetime device statistics are permanent, explicitly
because they are facts about hardware rather than about a person — and
explicitly leaves per-driver session retention undecided. **That is the
boundary this item has to draw, and half of it is already drawn.**

## What I would decide now, in order

1. **The `vörslureikningur` question** (2.2), because it decides whether
   collected money is one balance or two, and the ledger cannot be shaped
   without it.
2. **The remittance ledger's shape** (2.2) — entries, never balances; the
   owning org on every entry.
3. **Nothing for the audit trail** — `audit.actions` already has every column
   it needs, including `org_id`. What it needs is a writer, which is code.
4. **A retention class per table holding personal data** (2.6).

Everything else is wiring, and wiring is not made harder by waiting.
