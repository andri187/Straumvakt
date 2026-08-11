# Cloudflare / Neon launch checklist

Three columns, deliberately separated: what can be **verified read-only**, what
**requires approval to change**, and what is **blocked** with no path until
something else happens.

---

## A · Read-only verification (safe now, needs a session)

| # | Item | How | Expected |
|---|---|---|---|
| A1 | Worker **version ids** for all three Workers | `GET .../scripts/{name}/versions` | ≥ 2 retained each |
| A2 | **Currently serving version** | `GET .../deployments` — first entry is live | one version at 100% |
| A3 | Worker routes | `GET /zones/{z}/workers/routes` | explicit list, or explicitly empty |
| A4 | Custom domains | `GET /accounts/{a}/workers/domains` | `api.straumvakt.org` active |
| A5 | **workers.dev state per Worker** | dashboard only | enabled for the pinned API host |
| A6 | Queue binding **as deployed** | `GET .../scripts/{name}/settings` | producer present on the gateway |
| A7 | Queue + DLQ depths | dashboard | DLQs empty |
| A8 | DO namespace ids | `GET .../durable_objects/namespaces` | `IDENTITY_DO`, one namespace |
| A9 | Analytics Engine binding | same settings call | **absent today** |
| A10 | Secret **names** | `GET .../scripts/{name}/secrets` | names and types only |
| A11 | R2 buckets + public flag | `GET /accounts/{a}/r2/buckets` | private only |
| A12 | Neon project / branches / protection | Neon read tools | 13 branches, none protected |
| A13 | Neon PITR window | console | believed 7 days |
| A14 | Git integration owner | Builds API `.../builds/workers/{id}/triggers` | `andri187/Straumvakt` |

> **Never run** `GET /accounts/{a}/workers/scripts/{name}` — it downloads the
> Worker's source bundle, not metadata, and would pull production JS into the
> evidence pack.
>
> **Never store the raw `/secrets` response** — the `secret_key` variant carries
> `key_base64` and `key_jwk`.

## B · Requires approval to change

| # | Item | Risk if skipped | Reversible |
|---|---|---|---|
| B1 | Read-only Cloudflare token | Everything in column A stays unknown | yes, instantly |
| B2 | **Declare `workers_dev`** in the API and gateway configs | A routing change removes the host the shipped app pins | yes, until deployed |
| B3 | **Merge `relops-b`** | The heartbeat fix is not in production | yes |
| B4 | Sentry DSN as a Worker secret | No error visibility at beta | yes |
| B5 | Analytics Engine binding | No cost attribution | yes |
| B6 | Neon **production project**, protected from creation | Production has no data home | while empty |
| B7 | Protect the beta Neon branch | Real users' data, two clicks from deletion | yes |
| B8 | Neon org **`require_mfa`** — currently **false** | MFA not required on the org owning the only database | yes |
| B9 | GitHub branch protection | 0 of 16 protected; rulesets empty | yes |
| B10 | Unset 4 mis-tracked local upstreams | A plausible push reaches the deploy pointer | yes, exactly |
| B11 | Cloudflare Access on ops tools | Staff tooling unprotected | yes |
| B12 | Production secrets — **new values, not copies** | One compromise spans both environments | rotate |

## C · Blocked

| # | Item | Blocker |
|---|---|---|
| C1 | **Rollback target** | No Worker version id has ever been recorded, so release-manifest rule R1 rejects every release — correctly |
| C2 | Measured restore time | No Neon restore has been rehearsed |
| C3 | Backup branches | None exist; beyond the 7-day PITR ceiling there is no recovery |
| C4 | Active-session interval | Needs a real charger (M-3) |
| C5 | Deployed queue-binding proof | Needs B1 |
| C6 | Connected-charger count | Not exposed by any surface, so the gateway rollback drill cannot be verified |
| C7 | CPMS deploy-path separation | CPMS declares the same Worker names; needs A14 |

---

## Secrets separation

Production secrets are **new values**, not copies of beta. A real `AUTH_SECRET`
from this project is already public in git history, so the habit of reuse is not
hypothetical. The Neon connection string is a **secret binding**, never a
plaintext variable — a DSN contains a credential.

## Order

**B1 → column A in one 30–45 minute session → B2, B3 → B6…B8 → B9, B10.**

B3 and B10 need no cloud access at all. B10 is four local commands that remove
four failure modes and change nothing on any remote — the cheapest item on this
page.

## The single blocking fact

**C1.** Until a version id is recorded, a bad deploy is undone by rebuilding and
redeploying, during which the product is down. Everything else here is
improvement; that one is the difference between a release and a one-way door.
