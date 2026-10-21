# Environment manifests

**Proposed manifests. Nothing applies them — a manifest is documentation of
intent, not an apply-able artefact.** No resource was created or configured.

## Machine-checkable form

| Artefact | Path |
|---|---|
| Schema | `scripts/analysis/manifest/environment-manifest.schema.json` |
| Offline validator | `scripts/analysis/manifest/validate-manifest.mjs` |
| Fixtures | `scripts/analysis/manifest/fixtures/` (2 valid, 6 invalid) |

```
node scripts/analysis/manifest/validate-manifest.mjs --self-test
node scripts/analysis/manifest/validate-manifest.mjs <file.json>
```

**Validator safety properties**, deliberate and inspectable: it imports only
`node:fs` / `node:path`; there is **no** `fetch`, no `http`/`https`, no
`child_process`, no dynamic import. It reads the files it is given and writes to
stdout. It cannot reach a network and cannot mutate anything. No dependency —
the JSON Schema subset is hand-rolled so it runs with zero install.

**Self-test result:** `8 passed, 0 failed`. The six *negative* fixtures are the
point — a validator that cannot reject is decoration.

### Policy checks beyond the schema

| # | Rule | Rejects |
|---|---|---|
| P1 | `secretNames` may not contain anything value-shaped | a connection string smuggled into the repo |
| P2 | `real-customer` data may not allow test identities | beta identities in production |
| P3 | a `deployed` production Worker must record a `versionId` | **a release with no rollback target** |
| P4 | production may not use the beta Neon branch | shared-database mistake |
| P5 | warns when renaming a Worker pinned by a shipped client | the mobile-pin trap |
| P6 | warns when a service binding targets an undeclared Worker | typo'd bindings |
| P7 | warns when `deployed` is omitted rather than `null` | "unknown" silently reading as "no" |

**P3 is the one that would have caught today's state.** No version id is recorded
for any Worker anywhere.

### `null` means UNKNOWN

The schema makes `deployed`, `versionId`, `workersDev`, `protected` and every
Neon id **nullable on purpose**. `null` means *"requires control-plane
evidence"* — it is never a guess and never "none". **IDs are never invented**;
the production manifest carries `null` for its Neon project because that project
does not exist yet.

---

## Beta manifest — current, `status: deployed`

Full form: `fixtures/beta-current.valid.json`.

| Field | Value | Class |
|---|---|---|
| Git branch | `staging`, fast-forward-only | OD |
| `protected` | **false** | DF |
| Web | `hlada-staging`, domains `straumvakt.org` + `www`, workers.dev on | DF |
| API | `hlada-api-staging`, domain `api.straumvakt.org`, workers.dev on | DF |
| OCPP | `straumvakt-ocpp-staging`, `IDENTITY_DO` | DF |
| Data | `beta-test`, Neon `staging` (`br-tiny-river-abgpqq37`) | RF/OD |
| Hyperdrive | `d2d56ab1…` — **target UNK** | RF |
| **Version ids** | **`null` × 3 — no rollback target exists** | **UNK** |
| Alerting | engineering | PR |

**Two `pinnedByExternalClient: true` entries** — the API (mobile) and the gateway
(chargers). The validator warns on both.

## Beta manifest — target

Deltas only:

| Field | From | To | Gate |
|---|---|---|---|
| Web name | `hlada-staging` | `straumvakt-web-beta` | free rename — no inbound binding |
| API name | `hlada-api-staging` | `straumvakt-api-beta` | **after** a mobile release moves off the pinned host |
| OCPP name | `straumvakt-ocpp-staging` | **unchanged** | device configuration — see the OCPP packet |
| Web domain | brand domains | `beta.straumvakt.org` | additive first |
| API domain | `api.straumvakt.org` | **`beta.api.straumvakt.org`** | possibly covered by the existing `*.api` wildcard |
| Brand domains | on beta | moved to production | the one customer-visible step |

## Production manifest — proposed, `status: proposed`

Full form: `fixtures/production-target.valid.json`.

| Field | Value |
|---|---|
| Git branch | `production`, fast-forward-only, **1 approval** |
| Web | `straumvakt-web` — **name verified free** (DF: 1042) |
| API | `straumvakt-api` — **name verified free** (DF: 1042) |
| OCPP | `straumvakt-ocpp` — **name verified free**, created fresh for production chargers |
| Domains | `straumvakt.org`, `www`, `api.straumvakt.org` |
| workers.dev | **`false`** on both — production should not be reachable by an incidental hostname |
| Data | `real-customer`, **separate Neon project**, ids `null` until created |
| Test identities | **`false`** — enforced by policy P2 |
| Retention | `ADR-0018-decision-3` |
| Alerting | **page** |

### Secret-name parity, values never shared

| Name | Beta | Production |
|---|---|---|
| `AUTH_SECRET` | ✅ | ✅ **different value** |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | ✅ | ✅ different |
| `OCPP_INGEST_SECRET` | ✅ | ✅ different |
| `OCPP_CRED_KEK` | ✅ | ✅ **different — see below** |
| `DATABASE_URL` / `DIRECT_URL` | declared, unused by `src/` | **do not carry forward** |

> `OCPP_CRED_KEK` derives the key that decrypts stored vendor charger passwords.
> A shared KEK would make a beta compromise a production compromise **for real
> customer chargers**. It must differ, and re-encryption is therefore part of any
> charger data that ever moves between environments — which is a further argument
> for the accepted no-backfill decision.

## Ownership

| Resource | Owner | Approver |
|---|---|---|
| Worker config / bindings | engineering | Andri |
| Secrets | Andri | — |
| Domains / DNS | Andri | — |
| Neon projects/branches | Andri | — |
| Queues, R2 | engineering | Andri |
| Git branches / protection | engineering | Andri |
| Release promotion | release owner | Andri (production only) |

## Unknowns the manifests carry as `null`

| Field | Closes with |
|---|---|
| every `versionId` | dashboard A3 |
| `hyperdriveId` target | dashboard A7 |
| production Neon ids | creation |
| `protected` on Git branches | GitHub settings |
| workers.dev on production | creation |

**The manifests are honest about what is not known.** That is the property that
makes them safe to hand to an operator: a `null` is an instruction to go and
look, not an invitation to assume.
