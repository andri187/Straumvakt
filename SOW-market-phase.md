# Straumvakt — Market Phase: Statement of Work

**Version:** 2026-08-28 · **v4 — the new build.** Supersedes v1 (2026-08-08),
v2 and v3 in full.
**Governed by:** ADR 0054 (assets) · ADR 0055 (the clean slate) · ADR 0056 (the
new build) · `FOCUS.md`
**Bounded by:** `docs/notes/2026-08-28-the-new-build-manifest.md` — **anything
not traceable to a line in the manifest is not built.**

---

## 1. Where we are

| | State |
|---|---|
| **The live path** | Chargers → Zaptec Cloud → gateway Worker → queue → API → legacy Postgres. 21 sockets, running for months. Sessions land, project and store. **Nothing prices them.** |
| **The money engine** | Built and proven offline: pricing, period lifecycle, gap-free numbering, refusals by name, one invoice rendered twice byte-identical. **Never run against a database.** 1,882 tests. |
| **The database** | Five migrations generated, **none applied anywhere**. The legacy 66-table schema is the only one with rows in it, and a cron still writes billing lines into it through Prisma. |
| **The surfaces** | 79 classified web routes, fixture-driven, on a branch unmerged since 11 August. A Flutter app with four competing versions and no money surface. **The only path to an invoice is a 13-step runbook at a terminal.** |
| **The decision** | The product is a **new build**. Old chargers, orgs, drivers and CDRs are archived, never migrated. The old application is switched off whole, not converted. |

## 2. Where we are going

**Run the entire product in production shape, through its own screens, with no
invoice served to anyone.** The estate is re-onboarded from nothing through the
real pathway. Nothing that leaves the system is real; everything inside it is.

**Done means all three:**

1. **No row in the database was created by hand.** **Enforced, not merely
   verified:** no person holds a write credential, and anything deciding money
   or access is dated and closed rather than mutated — so the history is the
   record. A provenance query *reports* this; access control and the temporal
   model *guarantee* it. *(Narrow, named exception: platform reference data —
   see 1.4.)*
2. **A second host org exists, onboarded identically, and nothing of theirs is
   visible to the first** — UI, API and gateway.
3. **Within one CPO, two installations with disjoint driver sets, and a driver
   of A proven unable to see or charge at B.**

---

## The path — ten milestones

A milestone is a **demonstrable state**, not a set of finished tasks. Each one
is something you could be shown.

| | Milestone | You know it is reached when | Workstreams |
|---|---|---|---|
| **M1** | **Decisions closed** | All seven answered; nothing downstream waits on a person. ✅ *reached 2026-08-28* | WS-0, WS-1 |
| **M2** | **The shell stands** | An empty application builds green, a user signs in, a request without a resolved tenancy scope cannot reach a handler — and it serves zero business endpoints | WS-2 |
| **M3** | **A database of its own** | The schema is applied to a fresh branch from one initial migration, the catalogue is seeded, and a restore has been proven once | WS-3 |
| **M4** | **The engine runs in the new house** | Every harvested suite is green inside the new app, and nothing was improved on the way in | WS-4 |
| **M5** | **Money knows its owner** | One session carries three different factor owners, and one continuous run goes from an onboarded org to a numbered document | WS-5 |
| **M6** | **Access is explainable** | *Can driver X charge at charger Y at time T* resolves down one path and returns the reason — group, grant, since when | WS-6 |
| **M7** | **The product is reachable** | Every rehearsal step can be walked through a screen. Nothing requires a terminal | WS-7, WS-8 |
| **M8** | **The fleet is on the new build** | A real charger authenticates against the new application and a real session lands in the new database | WS-9 |
| **M9** | **The rehearsal passes** | All three acceptance criteria: no row by hand, a second host invisible to the first, and two installations with disjoint drivers | WS-10 |
| **M10** | **One system** | The old application is off, the legacy database is read-only, and there is one schema definition and one money writer | WS-11 |

**M7 is the one that changes the product's nature.** Before it, an invoice is
produced by an operator at a terminal. After it, the product exists.

---

## WS-1 · Decisions before code — **ANSWERED 2026-08-28**

All seven closed. Nothing in WS-2 onward is blocked.

| # | Decision | Answer |
|---|---|---|
| 1.1 | How a host or participant user signs in | **Email as username, password created by admin, forced change on first sign-in.** Workers has no native bcrypt or argon2 — use PBKDF2-HMAC-SHA256 through WebCrypto at OWASP-grade iterations, decided once in the shell. The initial password is shown once to the admin, who conveys it, because email is captured rather than sent. Sessions reuse the HMAC-signed pattern already proven for admin |
| 1.2 | The application's name and layout | **`RoadToMarket`** — the build's name: the folder (`apps/road-to-market`), the branch, this document. **Kept out of Worker and environment names**, which are named for the product and the environment, because those outlive any codename — `hlada` and `straumvakt-ocpp` are what that costs. Same monorepo, so harvested packages are a path import |
| 1.3 | The PostgreSQL version | **Default to `EXCLUDE USING GIST (device_id WITH =, period WITH &&)` with `btree_gist`.** Identical guarantee to `WITHOUT OVERLAPS`, works on every version, no lookup needed. A generated both forms. If someone later confirms 18, switching is a one-line migration |
| 1.4 | Platform reference data | **Both: the initial cost-factor catalogue is seeded with the schema, and an admin screen creates anything added later.** Zero hand-created rows, reproducible from empty, and the screen is needed in production anyway |
| 1.5 | What "production" means | **A protected branch and environment nobody touches directly, because real customers are on it.** Deploys reach it only by promotion. The new build names its environments correctly from day one, so the current mess — three public hostnames on Workers called `-staging` — **dies with the old application** rather than needing a migration |
| 1.6 | Does the rehearsal bill the dweller | **Both money lines.** Dalvegur is a workplace so its bearer is the org; the MDU second host gives dweller-pays. **One Dalvegur driver is set to self-pay** so the person-pays case is proven before the MDU exists |
| 1.7 | Mid-month proration | **Full fee to both hosts.** The connector was on your installation during the period. To be revisited once real CDRs exist. **The agreement must state that the sum across hosts exceeds one fee per charger in a month where a charger moves** — a host who learns that from an invoice feels cheated |

---

## WS-2 · The shell

| # | Task | Acceptance |
|---|---|---|
| 2.1 | Scaffold the application — build, lint, test harness, CI | green build, zero business endpoints |
| 2.2 | Config and bindings | every binding declared, none optional-by-accident |
| 2.3 | **Auth per 1.1** — sign in, sign out, session expiry, revocation | a session can be created, ended and revoked |
| 2.4 | **Tenancy middleware** — org scope on every request; participant scope; act-on-behalf recorded as impersonation | a request without a resolved scope cannot reach a handler |
| 2.5 | **Refusal conventions** — every refusal named, never a silent default; absent is `unavailable`, never zero | a fool test proves an unnamed refusal fails review |
| 2.6 | Observability — metrics, Sentry with the scrubbing module | no idTag, kennitala or token can reach a third party |
| 2.7 | Scheduler and queue bindings, no jobs yet | bindings exist and are exercised by a no-op |
| 2.8 | **Read-only human credentials to every environment** — only the application writes | no person holds a write role. Removes the ability rather than detecting the act |
| 2.9 | **Trigger-written audit for mutable tables only**, actor set per transaction | a row in a mutable table cannot be inserted without an audit entry |

**Acceptance:** it builds green, serves zero business endpoints, and is deployed
nowhere.

---

## WS-3 · A schema and a database of its own

| # | Task | Acceptance |
|---|---|---|
| 3.1 | **Re-base the migration line** — one fresh initial migration carrying only the new schema, `0002`–`0008` folded in. `0000_baseline` describes the 66-table world and cannot be the start | the new line creates the schema from nothing |
| 3.2 | Pick the constraint form per 1.3 — `WITHOUT OVERLAPS` or `EXCLUDE USING GIST` | one form, stated |
| 3.3 | New Neon branch; apply; verify | a database containing the schema and nothing else |
| 3.4 | **Platform reference data** per 1.4 — the cost factor catalogue, plans | seeded or screen-created, and named as the exception |
| 3.5 | Backups and connection pooling | a restore proven once |

---

## WS-4 · Harvest inward

**Nothing is improved on the way in.** FOCUS rule 1 applies inside the new
build.

| # | Task | Note |
|---|---|---|
| 4.1 | `packages/shared/src/db` | the only surviving schema definition |
| 4.2 | `packages/commercial` | the money engine |
| 4.3 | `packages/contracts` | document, PDF, delivery log, agreement writes |
| 4.4 | OCPP projections | frames → rows |
| 4.5 | Zaptec adapter, at the edge | one vendor adapter, generic core |
| 4.6 | **The agreements resolver, untouched** | three attempts, three months of silent failure; none of it visible in the source |
| 4.7 | Queue and ingest path | the gateway's existing route in |

**Acceptance:** every harvested suite green inside the new app.

---

## WS-5 · The structural fixes

| # | Task | Acceptance |
|---|---|---|
| 5.1 | **Seal the owner on the session**, resolved at seal time, carried on each component | one session with three different factor owners |
| 5.2 | **An org statement addresses any org**, agent posture with the host as issuer when the recipient is not the host | a claim to a participant renders `Straumvakt f.h. <host>` |
| 5.3 | **`issueInvoiceFromStatement`** — onboarding and invoicing share no org, period or sequence today, and both allocate `SV-2026-000001` | one continuous run from an onboarded org to a numbered document |
| 5.4 | **Unattributed energy reconciliation** — consumed, attributed, and what the host is absorbing, with a reason per session, against the meter | a session nobody can attribute raises an exception, never a silent hold |
| 5.5 | `charging_time` as a factor, and duration-tiered rates | an escalating overstay priced by restriction, not by a new factor |
| 5.6 | **Data rights — export and erasure**, designed against sealed sessions and issued documents | a driver takes a copy and asks to be erased; the issued invoice survives it. **Cheap now, awkward later** |
| 5.7 | **Temporal by default** — cost ownership dated and closed like placements, memberships and clauses already are | nothing that decides money or access is ever mutated in place |
| 5.8 | **Transaction time** alongside valid time on those tables | a backdated correction reads as a correction, not as history that always looked that way |

---

## WS-6 · The access model

| # | Task | Acceptance |
|---|---|---|
| 6.1 | **ADR 0057** — group-to-group grants, written before coded (CLAUDE.md rule 5) | the decision exists on a branch |
| 6.2 | Charger groups, dated membership, scoped to one installation | a charger leaves a group by closing a row |
| 6.3 | Driver groups, dated membership | move-out then move-in is expressible |
| 6.4 | Grants, union resolution, **ambiguous bearer refused** | two grants naming different bearers refuse rather than guess |
| 6.5 | **The "why" query** — which group, which grant, since when | answers *can X charge at Y at time T* and *who can charge here* |
| 6.6 | **Terms acceptance** at invite redemption — version and timestamp | a penalty can cite the version the driver accepted |

---

## WS-7 · The endpoints, to budget

**22 resources, 44 operations.** An addition is an edit to the manifest first,
naming the rehearsal step it serves.

| # | Group | Resources |
|---|---|---|
| 7.1 | Identity | session, invites, **messages** — invites *and* user notifications: charging complete, statement ready, payment overdue. Distinct from AMS alerting, which is operational |
| 7.11 | **Reports and export** | consumption per period, per driver, per installation — **and CSV.** A statement is a claim; a report is what a board takes to an aðalfundur. Closer to the product than the invoice is |
| 7.2 | Organisations | host applications, orgs, plans |
| 7.3 | Hierarchy | sites, installations, circuits |
| 7.4 | Vendor | credentials, import, discoveries |
| 7.5 | Assets | devices and placements — list, attach, detach |
| 7.6 | Access | charger groups, driver groups, grants |
| 7.7 | Commercial | agreements and clauses, cost ownership |
| 7.8 | Operations | sessions, periods, statements |
| 7.9 | Governance | audit, act-on-behalf |
| 7.10 | Internal | `ocpp-auth`, `ocpp-authorize`, ingest |

**Every endpoint: over a port, tenant-scoped, refusing by name, idempotent on
every mutation.**

---

## WS-8 · The screens *(starts in parallel with WS-4, not after WS-7)*

This lane has been the tail every round. If it waits for the endpoints it will
be the tail again.

| # | Task | Note |
|---|---|---|
| 8.1 | Design system and app shell | one money formatter per surface; Icelandic formatting — `7.564,00 kr` |
| 8.2 | **The grants matrix** | *who can charge here*, and **why** — group, grant, since when |
| 8.3 | **The held period** | which period, the named reason, what would change it. The screen an operator actually reaches for |
| 8.4 | Admin | applications, org creation, plan, attach/detach, audit, act-on-behalf banner, **the captured mailbox** |
| 8.5 | Host | profile, hierarchy, chargers, groups, invites, agreement and clauses, cost ownership, billing material |
| 8.6 | Participant | sign-in, own roster, own sessions and costs, own statement |
| 8.7 | Driver | redeem, where I may charge, active session, history, **what I owe and to whom** |
| 8.8 | States | priced · not yet priced · never priced · unavailable · running — visually distinct, and **none of them a zero** |
| 8.9 | Reports and export | the board's view, and the CSV button a treasurer actually came for |

---

## WS-9 · Re-point the gateway

| # | Task | Acceptance |
|---|---|---|
| 9.1 | Service binding to the new app | the gateway is **not rebuilt** |
| 9.2 | Auth resolves against the new identity tables | **an identity with no stored hash refuses**, closing the no-auth path |
| 9.3 | Require a credential at each charger, by whatever means the vendor supports, and record how it was verified | generic capability, Zaptec as one adapter |
| 9.4 | Offline current at 0 A, verified per charger | recorded at onboarding, not assumed |
| 9.5 | **Cutover plan for 21 live sockets**, with rollback and a named abort | a live operation, not a config change |

---

## WS-10 · The rehearsal

| # | Step | |
|---|---|---|
| 10.1 | Admin bootstrap | the one permitted exception — a binding, not a row |
| 10.2 | Host onboarded | application → approval → invitation → first sign-in → profile |
| 10.3 | Installation and chargers | their vendor credential, import, discovery, attach — **the first placements** |
| 10.4 | Agreement, clauses, tariff | without it, step 10.7 has nothing to price against |
| 10.5 | Drivers, groups, grants | including the station token as an ordinary group member |
| 10.6 | Authorisation on | vendor requires a credential first, shadow mode absorbing; then arm our gate, one installation at a time |
| 10.7 | The period closes | activity → pricing → statement → document → number. **Delivery logged, served to nobody** |
| 10.8 | A participant onboarded | Krónan at Dalvegur — several bearer orgs on one meter |
| 10.9 | A second host — an **MDU** | the dweller-pays shape Dalvegur never exercises |
| 10.10 | The isolation matrix | both boundaries: tenant, and access within a tenant |

**Acceptance:** the three criteria in §2.

---

## WS-11 · Switch off and archive

| # | Task |
|---|---|
| 11.1 | The old application off **whole**, on a date — not converted |
| 11.2 | The legacy database read-only as the archive; nothing reads it in normal operation |
| 11.3 | Strike FOCUS rule 1's Prisma exception — Prisma is not converted, it is not mounted |
| 11.4 | Close the seven finished worktrees and collapse the competing driver-app branches |

---

## 3. Sequence

```
WS-1  decisions          ██
WS-2  shell                ████
WS-3  schema + database    ████
WS-4  harvest inward           ██████
WS-5  structural fixes             ████
WS-6  access model             ██████
WS-7  endpoints to budget          ██████
WS-8  screens                  ████████████
WS-9  gateway re-point                   ███
WS-10 the rehearsal                         ████
WS-11 switch off                                ██
```

- **WS-1 gates everything.** 1.1 and 1.2 block the first line of code.
- **WS-2 and WS-3 run in parallel.**
- **WS-8 starts with WS-4**, not after WS-7.
- **WS-6 precedes WS-7's access endpoints** — the ADR before the code, CLAUDE.md
  rule 5.
- **WS-9 is a live cutover.** It is the first irreversible step and it needs a
  window.

---

## 4. Out of scope

Real invoicing and collection · card processing and dunning · the driver
**helper** module · public charging, AFIR, roaming and OCPI export · load
management, which stays with Zaptec · alerting, which is a separate AMS module
that consumes what the CPMS emits · OCPP 2.0.1, BLE, NFC, MFA · the full
cost-centre model.

### Deliberate omissions — market standard, and consciously not built

Recorded so they are decisions rather than oversights, each with the trigger
that would un-park it.

| Omitted | Un-park when |
|---|---|
| **Accounting export** to a bookkeeping package | the accountant answers; a bookkeeper wants a file, not a PDF |
| **`ChangeAvailability`** — take a charger out of service | a host asks to close a bay. Nothing can do it today |
| **`TriggerMessage`** — ask a charger for a fresh status | the connector-assertion machinery proves insufficient; this is the cheaper fix |
| **Driver token self-management** — register or replace an RFID card | drivers hold physical cards. Today tokens are created for them |
| **Offboarding a host** — final invoice, data export, chargers detached, account closed | the first host leaves. Onboarding is the whole plan and there is no exit |
| **Remote start from the driver app** | someone asks. In MDU and workplace, people plug in |

## 5. Ownership and authority

| Lane | Tool | Owns |
|---|---|---|
| `claude-a`, `claude-b`, `claude-c` | Claude Code in Visual Studio | all code work |
| `codex-work` | ChatGPT | **the visual aspect of the UI only** |
| coordinator | Claude Desktop | prompts, ledger, lane cut, this document. Writes no product code |

**Operator-only, never an agent:** secret values · any migration applied to any
database · the gateway cutover · Cloudflare and Neon mutations · any third-party
contact.
