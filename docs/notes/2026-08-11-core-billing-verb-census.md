# Second census pass — by permission verb

**2026-08-11.** The first pass walked files and asked "is this scoped". This one
walks the verb catalogue and asks "which routes claim this verb, and does any of
them name a tenant". Different axis, so it finds what the first could not.

Computed mechanically over `apps/api/src` (excluding `generated/` and tests),
matching `requirePermission(...)` and `assertPermission(c, ...)` with their
options object, and attributing each gate to the route registration within three
lines above it.

## Totals

| | |
|---|---|
| Gates found | **165** across 37 files |
| Verbs in the catalogue (`lib/auth/permissions.ts`) | **40** |
| Verbs that actually gate a route | **23** |
| Verbs declared but gating **nothing** | **17** |
| Verbs used but **not** in the catalogue | 0 |
| Gates passing `orgIdParam` | 32 |
| Gates passing no options object | 133 |

The 133 is not directly comparable to the 75 in `check:check-orgid-param`: the
guard counts only *per-tenant* verb prefixes (`billing.`, `member.`, `tariff.`,
`site.`, `charger.`, `property.`), because a `platform.*` verb correctly has no
tenant parameter. 133 is every gate; 75 is every gate that should have named a
tenant and did not.

## Finding A — seven verbs are used under BOTH conventions

This is the finding the file-axis pass could not see, because it only shows up
when you group by verb.

`billing.read`, `billing.write`, `charger.read`, `member.read`, `member.write`,
`property.read`, `site.read` each appear **both** with `{ orgIdParam: "orgId" }`
and without.

That means the same permission means "rows in the org named in the path" at one
call site and "rows in every org" at another. A role bundle grants the verb once;
what the holder can actually reach depends on which handler they hit. There is no
way for someone reading the role catalogue to know that.

It also means the fix is not uniform: for these seven, a correct call site already
exists in the codebase and can be copied. `bill-objects.ts` is the template for
`billing.*`.

## Finding B — 17 of 40 catalogued verbs gate nothing

```
audit.read                        platform.grant.read
billing.export                    platform.grant.write
contract.write                    platform.impersonate
platform.audit.read               platform.migration.run
platform.feature_flag.read        platform.support.action
platform.feature_flag.write       platform.tariff_catalogue.read
platform.finance.read             platform.tariff_catalogue.write
platform.finance.write            tariff.read
platform.grant.read               tariff.write
```

Three of these matter directly to Core billing:

- **`billing.export`** — the export route does not exist. `statement-zod.ts`'s
  `CORE_BILLING_ROUTE_CONTRACTS` is its **first declared caller**.
- **`tariff.read` / `tariff.write`** — the 14 rate/tariff authoring routes that
  *do* exist all reuse `billing.write` instead. So a role granted `billing.write`
  to let someone correct a bill can also republish a tariff. The Core rate-book
  contract is the first declared caller of `tariff.write`.
- **`audit.read`** — matches the census finding that `audit.actions` has exactly
  one reader in the whole tree (`installation-ocpp.ts`) and no read or export
  route. The verb exists for a surface nobody built.

The rest are platform-staff verbs for surfaces that are planned or parked. Worth
knowing before someone assumes a granted role is constrained by them:
**`platform.impersonate` and `platform.support.action` gate nothing**, which is
consistent with the census finding that `SUPPORT_CONTEXT_REQUIRED` is declared
and referenced nowhere and no `support_contexts` table exists. The support-context
story is absent at every layer, not just at the gate.

## Finding C — no verb is used that the catalogue does not declare

Zero. The catalogue is complete with respect to usage, which is worth stating
because it means the 17 unused verbs are aspiration, not drift — nobody is gating
on a string that was never registered.

## Per-verb table
| Verb | Gates | Scoped | Unscoped | Files | Verdict |
|---|---|---|---|---|---|
| `billing.read` | 26 | 6 | 20 | 14 | **MIXED — same verb, both conventions** |
| `billing.write` | 15 | 2 | 13 | 5 | **MIXED — same verb, both conventions** |
| `charger.config` | 4 | 0 | 4 | 1 | no gate names a tenant |
| `charger.read` | 8 | 2 | 6 | 3 | **MIXED — same verb, both conventions** |
| `charger.remote_start` | 1 | 0 | 1 | 1 | no gate names a tenant |
| `charger.remote_stop` | 1 | 0 | 1 | 1 | no gate names a tenant |
| `charger.write` | 5 | 0 | 5 | 2 | no gate names a tenant |
| `contract.read` | 3 | 3 | 0 | 1 | every gate names a tenant |
| `member.invite` | 2 | 2 | 0 | 1 | every gate names a tenant |
| `member.read` | 11 | 5 | 6 | 4 | **MIXED — same verb, both conventions** |
| `member.remove` | 1 | 1 | 0 | 1 | every gate names a tenant |
| `member.write` | 12 | 3 | 9 | 5 | **MIXED — same verb, both conventions** |
| `org.read` | 2 | 2 | 0 | 2 | every gate names a tenant |
| `org.write` | 3 | 3 | 0 | 2 | every gate names a tenant |
| `platform.tenant.delete` | 2 | 0 | 2 | 2 | no gate names a tenant |
| `platform.tenant.read` | 25 | 0 | 25 | 15 | no gate names a tenant |
| `platform.tenant.write` | 19 | 0 | 19 | 11 | no gate names a tenant |
| `property.delete` | 1 | 0 | 1 | 1 | no gate names a tenant |
| `property.read` | 2 | 1 | 1 | 2 | **MIXED — same verb, both conventions** |
| `property.write` | 2 | 0 | 2 | 1 | no gate names a tenant |
| `site.delete` | 3 | 0 | 3 | 3 | no gate names a tenant |
| `site.read` | 8 | 2 | 6 | 4 | **MIXED — same verb, both conventions** |
| `site.write` | 9 | 0 | 9 | 3 | no gate names a tenant |

### Declared in the catalogue, gating nothing (17)

- `audit.read`
- `billing.export`
- `contract.write`
- `platform.audit.read`
- `platform.feature_flag.read`
- `platform.feature_flag.write`
- `platform.finance.read`
- `platform.finance.write`
- `platform.grant.read`
- `platform.grant.write`
- `platform.impersonate`
- `platform.migration.run`
- `platform.support.action`
- `platform.tariff_catalogue.read`
- `platform.tariff_catalogue.write`
- `tariff.read`
- `tariff.write`
