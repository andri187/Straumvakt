# Release evidence ledger

**Read-only. Nothing was deployed, queried from a database, or mutated.**
Single source of truth for *what is known, how, and how confidently*.

| | |
|---|---|
| Worktree | `E:\Claude\Straumvakt-beta-production` |
| Branch | `docs/beta-production-release-architecture` |
| Start tip | `0d076ec` — **verified MATCH** |
| Refreshed | 2026-08-09T11:31–11:33Z |

## Evidence classes

| Class | Definition | May be used to… |
|---|---|---|
| **DF** deployed fact | observed from outside the control plane, timestamped | gate a decision |
| **RF** repository fact | source at a named commit, cited to file:line | gate a decision |
| **INF** inference | consistent with evidence, not proven | shape a plan, never gate one |
| **OD** operator decision | accepted by Andri | treated as given |
| **PR** proposal | mine | requires approval |
| **UNK** unknown | requires access I do not have | **must not be filled with INF** |

## Tip verification — all MATCH at open

| Source | Expected | Observed |
|---|---|---|
| `docs/beta-production-release-architecture` | `0d076ec` | ✅ |
| `docs/infra-release-safety-packet` | `856ebe2` | ✅ |
| `dev/relaunch-release-candidate` | `4b69d0f` | ✅ |
| `docs/remediation-architecture-packet` | `fabc56f` | ✅ |
| `docs/singular-onboarding-domain-packet` | `5111db6` | ✅ |

All five peer worktrees clean (0 dirty). Shared checkout `10c292b`, 21 dirty,
**never edited**.

## Public host evidence — 2026-08-09T11:32:12Z

Content-type is a **stronger discriminator than status code** and is recorded
because it separates three otherwise-similar 404s.

| Host | Code | Content-Type | SHA-256[0:16] | Class | Reading |
|---|---|---|---|---|---|
| `straumvakt.org` | 200 | `text/html` | `4bf6719964446f68` | DF | beta web |
| `www.straumvakt.org` | 200 | `text/html` | `4bf6719964446f68` | DF | beta web, identical |
| `hlada-staging.straumvakt.workers.dev` | 200 | `text/html` | `4bf6719964446f68` | DF | **same body — same Worker** |
| `api.straumvakt.org` | 404 | **`application/json`** | `da660378f25e1778` | DF | beta API |
| `hlada-api-staging.straumvakt.workers.dev` | 404 | **`application/json`** | `da660378f25e1778` | DF | **same body — same Worker** |
| `straumvakt-ocpp-staging.straumvakt.workers.dev` | 404 | `text/plain` | **`907ba78b4545338d`** | DF | **LIVE — own body `not found`** |
| `straumvakt-ocpp.straumvakt.workers.dev` | 404 | `text/plain` | `a4daf148dd64d1a3` | DF | no Worker (`error code: 1042`) |
| `hlada.straumvakt.workers.dev` | 404 | `text/plain` | `a4daf148dd64d1a3` | DF | no Worker |
| `hlada-api.straumvakt.workers.dev` | 404 | `text/plain` | `a4daf148dd64d1a3` | DF | no Worker |
| `straumvakt-web.straumvakt.workers.dev` | 404 | `text/plain` | `a4daf148dd64d1a3` | DF | **proposed name is free** |
| `straumvakt-api.straumvakt.workers.dev` | 404 | `text/plain` | `a4daf148dd64d1a3` | DF | **proposed name is free** |
| `beta.straumvakt.org` | — | — | — | DF | **NXDOMAIN — does not exist** |
| `api-beta.straumvakt.org` | — | — | — | DF | **NXDOMAIN — does not exist** |

> **Measurement artefact, recorded for honesty:** the two NXDOMAIN rows initially
> showed a stale hash because the response body file was not overwritten when
> `curl` failed to resolve. The hash column for those rows is **void**, not
> evidence. Corrected above.

Three distinct 404 signatures — an API JSON 404, a live Worker's plain-text
`not found`, and Cloudflare's `error code: 1042` — are what make the "deployed vs
not deployed" verdict solid rather than assumed.

## DNS and TLS — 2026-08-09T11:32:37Z

| Host | Resolves | Note |
|---|---|---|
| `straumvakt.org` | `2a06:98c1:3120::` | Cloudflare |
| `www.straumvakt.org` | `2606:4700:3031::6815:234e` | **different Cloudflare address than apex** |
| `api.straumvakt.org` | `2a06:98c1:3120::` | same address as apex |
| `beta.straumvakt.org` | **NXDOMAIN** | must be created |

**Certificate on `straumvakt.org`** (DF):

```
subject : CN=straumvakt.org
issuer  : Google Trust Services, CN=WE1
validity: 2026-08-04 → 2026-11-02
SAN     : straumvakt.org, api.straumvakt.org, *.api.straumvakt.org
```

### Two findings that change the cutover plan

1. **`www.straumvakt.org` is NOT in the apex certificate's SAN**, yet serves 200
   from a different address. **INF:** `www` therefore has its own certificate.
   Consequence: apex and `www` are *separate* custom-domain attachments with
   *separate* certificates, so a cutover moves **two** certificate-bearing
   attachments, not one hostname with an alias. Each must be verified
   independently after the move.
2. **The SAN already covers `api.straumvakt.org` and `*.api.straumvakt.org`.**
   **INF:** a beta API hostname under `*.api.straumvakt.org` (e.g.
   `beta.api.straumvakt.org`) may be covered by the existing wildcard, whereas
   `api-beta.straumvakt.org` — the name proposed in the earlier packet — is
   **not** covered and would need fresh issuance.

**PR (revised):** prefer **`beta.api.straumvakt.org`** over `api-beta.straumvakt.org`
for the beta API. It is plausibly already certificate-covered, and it keeps the
`api.` prefix meaningful. This supersedes the naming in the earlier topology
document, and the reason is evidence, not taste.

**UNK:** whether the wildcard is actually attachable to a second Worker — that is
a control-plane question (see the verification kit).

## Repository facts re-verified independently (RC `4b69d0f`)

| Fact | Evidence |
|---|---|
| Root Worker builds the Next app | `wrangler.jsonc:4` `.open-next/worker.js` |
| Worker names: `hlada` / `hlada-staging` | `wrangler.jsonc:3,40` |
| API names: `hlada-api` / `hlada-api-staging` | `apps/api/wrangler.jsonc:3,25` |
| Gateway names: `straumvakt-ocpp` / `straumvakt-ocpp-staging` | `gateway/wrangler.jsonc:3,53` |
| Web → `OCPP_GATEWAY` → gateway | `wrangler.jsonc:70-71` |
| API → `OCPP_GATEWAY` → gateway | `apps/api/wrangler.jsonc:28-29` |
| **Gateway → `MAIN_APP` → the API Worker** | `gateway/wrangler.jsonc:64-65` |
| Durable Object `IDENTITY_DO` / `IdentityDurableObject` | `gateway/wrangler.jsonc:9-17,54-58` |
| Six queues + three DLQs (staging) | `apps/api/wrangler.jsonc:73-116` |
| Rate limiters `ADMIN_LOGIN_RATE_LIMITER`, `DRIVER_LOGIN_RATE_LIMITER` | `apps/api/wrangler.jsonc:144,150` |

**Nothing is service-bound to the web Worker.** Re-confirmed independently of the
prior document's prose.

## Unavailable tools, and the exact fact each blocks

| Tool | State | Blocks |
|---|---|---|
| `wrangler` (authenticated) | **not authenticated** | account id; deployed version ids; Git-integration owner/branch; attached routes; secret names as set; binding values; Hyperdrive target; DO namespace ids; queue consumer config; rollback version availability |
| `gh` CLI | **not installed** | nothing uniquely — public REST substitutes for read-only repo facts |
| Cloudflare MCP | requires interactive OAuth | same as `wrangler` |
| Neon MCP | available, metadata-only | *(not used this session — no database interaction was required)* |
| Public GitHub REST | **available** | — |
| `curl` / `openssl` / `nslookup` | **available** | — |

**Nine control-plane facts remain UNK.** They are enumerated with exact
navigation in the dashboard verification kit. **None is filled with inference.**

## Unresolved claims carried forward from the nine prior documents

| # | Claim | State |
|---|---|---|
| U1 | Which repository's Git integration deploys `hlada-staging` | **UNK** — the highest-value unknown |
| U2 | Whether CPMS retains a live integration to the same names | **UNK** |
| U3 | Active deployment version ids (the rollback target) | **UNK** — none recorded anywhere |
| U4 | Hyperdrive `d2d56ab1…` target branch | **UNK** (INF: staging, from compute activity — not acceptable as a gate) |
| U5 | Whether a deploy omitting `routes` detaches a live custom domain | **UNK** — undocumented by Cloudflare |
| U6 | Cloudflare account identity, and whether CPMS shares it | **UNK** |
| U7 | Secret names actually set per Worker | **UNK** (RF: what config expects) |
| U8 | Whether `www` has a separate certificate | **INF** — strongly implied by SAN + distinct address |
| U9 | Whether `*.api.straumvakt.org` can bear a second Worker's hostname | **UNK** — new this session |

## Ledger discipline

1. A gate may cite **DF** or **RF** only.
2. **INF** may shape a plan; it may never satisfy a checklist item.
3. **UNK** is closed by evidence, never by argument.
4. Every refreshed measurement carries a UTC timestamp; an older measurement is
   superseded, not merged.
