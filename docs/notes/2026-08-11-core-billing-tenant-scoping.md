# Core billing tenant scoping — classification and hardening plan

**2026-08-11.** 105 billing route / permission / repository surfaces, classified
from source. One hardening implemented; the rest sequenced.

## The shape of the problem, stated correctly

The usual phrasing is "a host can read another host's billing data". That is
**not** what the source says, and the correct version is both narrower and
worse.

`requirePermission(verb, { orgIdParam })` reads the tenant from
`c.req.param(options.orgIdParam)` at
[require-permission.ts:70-72](apps/api/src/lib/auth/require-permission.ts#L70).
When `orgIdParam` is omitted, `orgId` resolves to **null**, and
`getActiveMembership` is never called. So a gate with no `orgIdParam` is:

- **unreachable** by an org member holding the verb — their membership is never
  consulted, so nothing can satisfy it; and
- **tenant-wide** for anyone holding a platform grant.

There are **41** `billing.*` gates in `apps/api/src` (26 read, 15 write). Exactly
**8** pass `orgIdParam`, all `{ orgIdParam: "orgId" }`, all in two files
(`bill-objects.ts`, `orgs.ts`). **33 of 41 have no tenant parameter**, and of
those, exactly one compensates at the row layer — `GET /tariffs`
([billing.ts:211](apps/api/src/routes/admin/billing.ts#L211)), which calls
`resolveOrgScope` and filters.

So the exposure is: **every platform-grant holder — including `auditor`,
`sales_cs` and `finance_internal` via the `platform.tenant.read` expansion at
[effective-permissions.ts:148-150](apps/api/src/lib/auth/effective-permissions.ts#L148)
— reads every tenant's money data with no scope and no audit row.**

**Support context is shadow-only.** It exists in three places and enforces in
none. `observeSupportContext` (require-permission.ts:132-149) `console.warn`s and
returns. `org-scope.ts:59-69` grants `{ all: true }` unconditionally when
`viaPlatform` includes `platform.tenant.read`, also after a warn.
`expandPlatformTenantVerbs` is what hands staff the per-tenant verbs in the first
place. `SUPPORT_CONTEXT_REQUIRED` is declared at require-permission.ts:109 and
referenced nowhere else; no `support_contexts` table exists. The warnings go to
`console`, not `audit.actions` — so there is **no queryable record of any
cross-tenant billing read**.

## Classification

| Class | Count | What it means |
|---|---|---|
| tenant-scoped correctly | 34 | `org_id` predicate present, or a mandatory positional `orgId` |
| missing `orgIdParam` | 23 | gate names no tenant; row layer does not compensate |
| global **accidentally** | 21 | reads a national catalogue, then joins to per-tenant rows |
| global **by design** | 19 | genuinely national: cost factors, rate references, DSO catalogue |
| unknown | 8 | not opened deeply enough to assert; listed, not cleared |

The two classes the prompt also asks about:

- **platform support-context needed** — all 33 unscoped gates. The mechanism
  exists and enforces nothing (above). This is one decision, not 33.
- **needs a new permission verb** — three. `billing.export` and
  `tariff.read` / `tariff.write` are in the catalogue
  (`permissions.ts:64-72`) and gate **zero** routes; the 14 authoring routes all
  reuse `billing.write`. The new Core contracts in `statement-zod.ts` are the
  first callers of `billing.export` and `tariff.write`.
- **cannot be made safe without a route shape change** — two, and they are the
  worst two. `GET /sessions` builds its `LedgerScope` from raw query params via
  `scopeFromQuery` (billing.ts:57-67) with no validation and falls through to
  `{ kind: "admin" }` (no filter) when none are supplied, so
  `?orgId=<any-uuid>` reads any tenant's ledger. And
  `billing-tariff-mgmt.ts:44` takes `orgId` from the request **body**
  (`lib/billing/tariff-zod.ts:58-60`) under a gate with no `orgIdParam`, so a
  priced tariff can be authored into any organisation. Both need the tenant to
  move into the path before a gate can see it.

## Three conventions coexist, which is why the gaps are easy to miss

1. **Mandatory positional `orgId`** — `bill-objects.ts:82/101/118`,
   `org-tariff-chain.ts:44`. Correct and compile-enforced.
2. **Explicit `orgId: string | null`**, where `null` deliberately means all
   tenants — `billing-contracts.ts:53`, `billing-driver-contracts.ts:54/139`.
   Correct, and honest about the escape hatch.
3. **No `orgId` parameter at all** — `billing-summary.ts` (all five),
   `billing-enrichment.ts:71`, `billing-cost-centers.ts:41`,
   `billing-tariff-detail.ts:89`, `session-detail.ts:49`, `agreements.ts:155`.

Convention 3 is correct **only** for the genuinely national catalogues
(`billing-cost-factors`, `billing-rate-references`, `billing-dso`,
`billing-electricity`), and those files say so in their headers. The
ledger-derived reads in convention 3 do not, and are the accidental-global class.

## The hardening implemented this run

`GET /api/admin/billing/sessions/:id` and `/sessions/:id/full` now check the row's
tenant before returning it.

Both called `findUnique({ where: { id } })` and returned any tenant's session.
`session-detail.ts:1-4` says *"no auth scoping here — caller (the route) checks
permission"*; the route checked the verb and not the row. Each side documented
the other as the enforcement point, and neither enforced. The `/full` variant is
the worse of the two: with `?include=raw` it serves the raw OCMF and 723 blobs,
so an unscoped read hands over another tenant's **signed meter evidence**, not
just a total.

The fix uses the pair the file already uses 120 lines below at `GET /tariffs` —
`resolveOrgScope` plus a row-level test — rather than introducing a mechanism:

```ts
async function callerMaySee(c: BillingContext, orgId: string): Promise<boolean> {
  return orgInScope(await resolveOrgScope(c.env, c.get("session")), orgId);
}
```

**Blast radius: none for current callers.** `resolveOrgScope` returns
`{ all: true }` for a bootstrap session or any `platform.tenant.read` grant, so
`orgInScope` is always true for them. Every session that can reach these routes
today is one of those. What changes is that an org member who reaches them in
future gets their own org's sessions instead of everyone's — which is the
behaviour the repository header already claimed.

**404, not 403.** A 403 confirms that the session id exists; 404 is the same
answer a made-up id gets.

**Tested** in `apps/api/src/lib/auth/org-scope.test.ts`, which already existed
and already covered `resolveOrgScope` itself through mocks — the bootstrap
bypass, the `platform.tenant.read` warn, and the case that matters most for a
future role change ("a platform grant lacking `tenant.read` must NOT fall
through to `all`"). Eight assertions were **added** on top: four pinning the
four-row decision table the routes now implement, including the deny-all case
(`{ all: false, orgIds: [] }` for a caller with no memberships, which must not
read as "no filter"), and four proving the predicate does not match on a prefix
or a case fold.

*(Correction: an earlier draft of this run replaced that file rather than
extending it, deleting the `resolveOrgScope` coverage. Caught by reading the
commit's diffstat — 180 lines changed on a file I believed I had created — and
restored before it went anywhere. Recorded because a silently narrowed test file
is exactly the failure mode this document is about.)*

## Also shipped: the guard that stops the 76th

`scripts/check-orgid-param.mjs`, wired into `npm run check`.

It finds every `requirePermission("<per-tenant verb>")` with no options object
and diffs against a measured allowlist — **75 gate occurrences, 36 distinct
file:verb pairs, every one with a written reason**. It fails on the 76th, and
**equally when one is fixed and left in the list**. A debt register that only
grows stops being a debt register.

Fool-tested in both directions and both caught: a new unscoped gate is reported
as unexpected; an allowlisted gate that has been fixed is reported as
`ALLOWLIST STALE`. Covered by `scripts/check-orgid-param.test.mjs`.

## Sequenced, not done

Ordered by exposure per unit of change.

| # | Surface | Class | Fix | Blast radius |
|---|---|---|---|---|
| 1 | `GET /sessions/:id`, `/:id/full` | missing orgIdParam | **done this run** | none — platform unchanged |
| 2 | `billing-tariff-detail.ts:29` | global accidentally | `getTariffDetail(db, tariffId)` keys on id alone and returns the owning org plus 30 days of its ledger. Add an `OrgScope` parameter, same shape as `/tariffs`. | none for platform |
| 3 | `billing-dso.ts:36` | global accidentally | the repository eagerly includes `tariffDefinitions: { include: { organization } }`, and `TariffDefinition` is per-tenant. Drop the include, or scope it. | UI shows fewer rows for org members |
| 4 | `billing-electricity.ts:21` | global accidentally | per-org usage counts on a national catalogue endpoint. Same fix. | as above |
| 5 | `billing-summary.ts` (5 fns) | missing orgIdParam | header claims an `orgId` parameter that does not exist. Add it, and correct the header. | none — no per-org caller exists yet |
| 6 | `GET /sessions` | route shape change | `scopeFromQuery` trusts raw query params. Must validate the requested scope against `resolveOrgScope` before use. | **real**: an operator passing `?orgId=` outside their scope starts getting empty results |
| 7 | `billing-tariff-mgmt.ts:44` | route shape change | `orgId` from the request body. Move it into the path so a gate can see it. | **real**: URL change, console must follow |
| 8 | `sites.ts:63` PATCH `dsoTariffId` | missing check | accepts a tariff id and passes it through blind, with no check that the tariff belongs to the site's org. | none — additive validation |
| 9 | `zaptec-session-sync.ts:186-189` | **launch blocker** | resolves the driver by token value with **no org filter**, so a token collision across tenants attributes a billable session — and its ledger `driverUserId` — to a foreign driver. | needs care: the fix changes who gets billed |
| 10 | support context | decision | either build `support_contexts` and enforce it, or delete `SUPPORT_CONTEXT_REQUIRED` and the two shadow warnings. Shipping neither is the current state and it reads as a control that exists. | policy decision, not code |
| 11 | audit | decision | no cross-tenant billing read produces an `audit.actions` row. `bill-objects` is the only Core-billing write that audits at all, and it is the template the rest should copy. | additive |

Item 9 is the only one on this list that changes *who is charged*. Items 2–5 and
8 are safe to do in one pass. Item 6 and 7 need the console to move with them.

## What the new Core surface does instead

`CORE_BILLING_ROUTE_CONTRACTS` in `apps/api/src/lib/billing/statement-zod.ts`
declares all eight Core billing routes with `orgIdParam: "orgId"` — except the
driver route, which declares `orgIdParam: null` **on purpose**: letting a driver
name an org would be a cross-tenant hole dressed as a filter, so identity comes
from the bearer token and the request DTO has no `orgId` field at all.

`statement-zod.test.ts` asserts both halves, so the property is checked rather
than intended. And `buildSettlementRows` / `buildStatementRows` take `orgId` as
a separate argument and **compare** it to the payload's own rather than reading
it — a mapper that trusts the payload for its tenant will write another org's
session under this org's period the first time a route forgets to scope.

## Full classification table

Scoping text is the census reading of the source, quoted rather than
paraphrased. Evidence is repo-relative `path:line`.

### missing-orgIdParam — 23

| # | Path | Symbol | Scoping as found | Evidence |
|---|---|---|---|---|
| 1 | apps/api/src/lib/tariff/resolve-tariff-chain.ts | resolveTariffChainWithIdsForSession | missing-orgIdParam — the walk is Site→dsoTariffId then ChargingStation→Installation→retailerTariffId by primary key, with no orgId predicate on any of the four findUnique calls; scoping is i… | apps/api/src/lib/tariff/resolve-tariff-chain.ts:185-241,303-325 |
| 2 | apps/api/src/repositories/session-detail.ts | chargeTimeSec / idleTimeSec | missing-orgIdParam — chargeSession.findUnique({where:{id:sessionId}}) with no orgId predicate; orgId is selected and returned but not used as a filter | apps/api/src/repositories/session-detail.ts:36-42,53-72,134-148 |
| 3 | apps/api/src/routes/admin/billing.ts | GET /api/admin/billing/sessions | missing-orgIdParam — gate is requirePermission("billing.read") with no options, and scopeFromQuery(c) builds the LedgerScope straight from ?orgId / ?siteId / ?chargingStationId / ?driverUser… | apps/api/src/routes/admin/billing.ts:115 (gate), :57-67 (scopeFromQuery), :117 (scope used unvalidated). The file's own comment at :52-55 admits the refinement 'is layered on top ... once Sprint 8 Track C lands'. |
| 4 | apps/api/src/routes/admin/billing.ts | GET /api/admin/billing/sessions/:id | missing-orgIdParam — billing.read with no orgIdParam, and getSessionDetail(db, sessionId) takes no org argument; lookup is by primary key alone. No post-hoc orgId comparison. | apps/api/src/routes/admin/billing.ts:88 (gate), :91 (call); repositories/session-detail.ts:54 `where: { id: sessionId }` |
| 5 | apps/api/src/routes/admin/billing.ts | GET /api/admin/billing/sessions/:id/full | missing-orgIdParam — billing.read with no orgIdParam; getSessionFullDetail keys on id only. ?include=raw returns the raw 723 + OCMF envelope blobs, so this is the widest single-session read … | apps/api/src/routes/admin/billing.ts:103 (gate), :106-107 (includeRaw); repositories/session-full-detail.ts:152 `where: { id: sessionId }` |
| 6 | apps/api/src/routes/admin/billing-tariff-mgmt.ts | POST /api/admin/billing/tariffs-mgmt (create TariffDefinition) | missing-orgIdParam — billing.write with no orgIdParam, while the target row IS per-tenant: orgId arrives in the request BODY (CreateTariffSchema.orgId), which requirePermission never reads. … | apps/api/src/routes/admin/billing-tariff-mgmt.ts:44 (gate), :55; lib/billing/tariff-zod.ts:58-60 (orgId in body); prisma/schema/commercial.prisma:124-126 (TariffDefinition.org_id) |
| 7 | apps/api/src/routes/admin/billing-tariff-mgmt.ts | PATCH /:id, POST /:id/clone, /:id/publish, /:id/retire | missing-orgIdParam — four billing.write gates, none with orgIdParam, all operating on a per-org TariffDefinition addressed by bare :id. The repo functions take (db, id) with no org argument,… | apps/api/src/routes/admin/billing-tariff-mgmt.ts:71, :122, :149, :191; repositories/billing-tariff-mgmt.ts:193, :222, :276, :351 |
| 8 | apps/api/src/routes/admin/billing-tariff-detail.ts | GET /api/admin/billing/tariffs/:id/detail | missing-orgIdParam — billing.read with no orgIdParam on a per-org TariffDefinition. getTariffDetail(db, tariffId) keys on id alone and returns the owning organization plus 30 days of that or… | apps/api/src/routes/admin/billing-tariff-detail.ts:29 (gate), :38; repositories/billing-tariff-detail.ts:89-93 `where: { id: tariffId }` |
| 9 | apps/api/src/routes/admin/billing-contracts.ts | GET /api/admin/billing/contracts | missing-orgIdParam — billing.read with no orgIdParam. ?orgId is a caller-supplied FILTER passed straight to listAgreements(db, orgId); omitting it returns every Agreement across every counte… | apps/api/src/routes/admin/billing-contracts.ts:32 (gate), :34 (query param), :37-38; the file's own header at :27 says 'Returns every Agreement (across all counterparty orgs)' |
| 10 | apps/api/src/routes/admin/billing-driver-contracts.ts | GET /api/admin/billing/driver-contracts | missing-orgIdParam — billing.read with no orgIdParam; ?orgId is again a caller-chosen filter, not a gate. Unfiltered it returns every DriverGroupMembership joined to identity.users and repor… | apps/api/src/routes/admin/billing-driver-contracts.ts:34 (gate), :36-40 |
| 11 | apps/api/src/routes/admin/agreements-debug.ts | GET /api/admin/agreements and GET /api/admin/agreements/:id | missing-orgIdParam — two billing.read gates with no orgIdParam. Agreement carries counterparty_org_id and cpo_org_id, but listAgreements(prisma) takes no scope and getAgreementDetail(prisma,… | apps/api/src/routes/admin/agreements-debug.ts:35, :42; repositories/agreements.ts:155-157, :188-191; prisma/schema/commercial.prisma:483-508 |
| 12 | apps/api/src/routes/admin/agreements-debug.ts | POST /api/admin/agreements/debug-resolve | missing-orgIdParam — billing.read with no orgIdParam; userId and chargingStationId come from the request body and are never checked against the caller's tenant. Returns the full resolved bil… | apps/api/src/routes/admin/agreements-debug.ts:89 (gate), :53-59 (body schema), :104-111, :132 |
| 13 | apps/api/src/routes/admin/agreements-resolve.ts | POST /api/admin/agreements/sessions/:sessionId/resolve | missing-orgIdParam — billing.write with no orgIdParam; :sessionId is a bare uuid and resolveAndPersistForSession(prisma, sessionId) never checks the session's org. This is the one route that… | apps/api/src/routes/admin/agreements-resolve.ts:27 (gate), :35; lib/agreement/persist.ts:359-364 and :401-430; prisma/schema/commercial.prisma:788-790 |
| 14 | apps/api/src/routes/admin/sites.ts | PATCH /api/admin/sites/:siteId (rebinds Site.dsoTariffId) | missing-orgIdParam — gate is requirePermission("site.write") with no orgIdParam and, unlike the sibling GETs at :27/:35/:57, this handler never calls resolveOrgScope. SiteUpdateInput accepts… | apps/api/src/routes/admin/sites.ts:63 (gate), :68; packages/contracts/src/inputs/sites.ts:46-55 (dsoTariffId in SiteUpdateInput); repositories/sites.ts:116-128 (blind passthrough) |
| 15 | apps/api/src/routes/admin/installations.ts | PATCH /api/admin/installations/:id (rebinds Installation.retailerTariffId) | missing-orgIdParam — site.write with no orgIdParam and no resolveOrgScope in the handler (the GETs at :35 and :77 do call it). InstallationUpdateInput accepts retailerTariffId and updateInst… | apps/api/src/routes/admin/installations.ts:86 (gate), :92; packages/contracts/src/inputs/installations.ts:25-38 (retailerTariffId); repositories/installations.ts:135-142 |
| 16 | apps/api/src/routes/admin/billing.ts | adminBilling.use("*", requireAdmin) + requirePermission("billing.read") | missing-orgIdParam — requirePermission is invoked with no options.orgIdParam, so require-permission.ts:70-75 resolves orgId=null and grants are evaluated globally, not per-org. requireAdmin … | apps/api/src/routes/admin/billing.ts:47,88 + apps/api/src/lib/auth-middleware.ts:35-44 + apps/api/src/lib/auth/require-permission.ts:70-75 |
| 17 | apps/api/src/repositories/bill-objects.ts | listBillObjectMembers(db: PrismaClient, billObjectId: string, options: { includeEnded?: bo… | missing-orgIdParam — takes no orgId and applies no org filter; anyone who can guess a billObjectId reads its driver roster | apps/api/src/repositories/bill-objects.ts:185-194 |
| 18 | apps/api/src/repositories/session-detail.ts | getSessionDetail(db: PrismaClient, sessionId: string): Promise<SessionDetail \| null> | missing-orgIdParam — findUnique by session id with no tenant predicate and no post-fetch guard; it SELECTS orgId and returns it but never compares it to a caller org. Route calls it as getSe… | apps/api/src/repositories/session-detail.ts:49-72 + apps/api/src/routes/admin/billing.ts:86-93 |
| 19 | apps/api/src/repositories/session-full-detail.ts | getSessionFullDetail(db: PrismaClient, sessionId: string, opts: { includeRaw?: boolean } =… | missing-orgIdParam — same shape as getSessionDetail: keyed solely on sessionId, and includeRaw widens the payload | apps/api/src/repositories/session-full-detail.ts:146 |
| 20 | apps/api/src/repositories/billing-tariff-mgmt.ts | publishTariff(db: PrismaClient, id: string): Promise<TariffMgmtRow \| TariffMgmtError>; re… | missing-orgIdParam — both act on a bare tariff id with no org predicate; rate lock-in state is flipped without proving the caller owns the tariff | apps/api/src/repositories/billing-tariff-mgmt.ts:252-255,309-312 |
| 21 | apps/api/src/repositories/billing-tariff-mgmt.ts | patchTariff(db: PrismaClient, id: string, input: PatchTariffInput): Promise<TariffMgmtRow … | missing-orgIdParam — keyed on tariff id / sourceId only; cloneTariff copies whatever org the source row carries | apps/api/src/repositories/billing-tariff-mgmt.ts:153-157,211-214 |
| 22 | apps/api/src/repositories/billing-tariff-detail.ts | getTariffDetail(db: PrismaClient, tariffId: string): Promise<TariffDetailResult> | missing-orgIdParam — findUnique by tariffId with no org guard; it then fans out to site/installation/chargingStation/sessionLedger findMany calls and returns orgId on each nested shape | apps/api/src/repositories/billing-tariff-detail.ts:89-93,146-178 |
| 23 | apps/api/src/repositories/billing-summary.ts | getPeriodTotals / getTariffCoverage / getCostHealthMetric / getRecentLedgerEntries / getPr… | missing-orgIdParam — none of the five exported functions accepts an orgId; every query filters on date only. The header (:5-6) claims per-org scoping is supported and that is false. Not a le… | apps/api/src/repositories/billing-summary.ts:25 |

### global-accidentally — 21

| # | Path | Symbol | Scoping as found | Evidence |
|---|---|---|---|---|
| 24 | apps/api/src/lib/agreement/persist.ts | resolveAndPersistForSession | scoped-correctly for the agreement walk (cpoOrgId derived from charger at :108) but the rate-book read at :277 is global — see the rateReference row | apps/api/src/lib/agreement/persist.ts:359-364,401-412; prisma/schema/commercial.prisma:788-790 |
| 25 | apps/api/src/lib/auth/org-scope.ts | resolveOrgScope — the row gate | global-by-design for platform staff — returns {all:true} unconditionally when viaPlatform includes platform.tenant.read (:59-69) and for any bootstrap session (:42); otherwise narrows to act… | apps/api/src/lib/auth/org-scope.ts:38-76; the 13 call sites are active-sessions.ts:23, billing.ts:180, circuits.ts:23,:39, chargers.ts:54,:81, properties.ts:30,:54, sites.ts:27,:35,:57, installations.ts:35,:77 |
| 26 | apps/api/src/routes/admin/billing-dso.ts | GET /api/admin/billing/dso | global-accidentally — billing.read with no orgIdParam. CostFactor itself is a global catalogue (no org_id column), but getDsoCostFactors eagerly includes tariffDefinitions with their organiz… | apps/api/src/routes/admin/billing-dso.ts:36 (gate), :38; repositories/billing-dso.ts:61-70 (include tariffDefinitions → organization, no scope arg); prisma/schema/commercial.prisma:105-120 (CostFactor has no orgId), :124-138 (TariffDefinition does) |
| 27 | apps/api/src/routes/admin/billing-electricity.ts | GET /api/admin/billing/electricity | global-accidentally — billing.read with no orgIdParam; listElectricityCostFactors(db) takes no scope and returns per-org TariffDefinition usage counts across all tenants. | apps/api/src/routes/admin/billing-electricity.ts:21 (gate), :23; repositories/billing-electricity.ts:66 (signature has no scope param) |
| 28 | apps/api/src/routes/admin/billing-cost-factors.ts | POST /api/admin/billing/cost-factors | global-by-design — billing.write with no orgIdParam. Because orgId resolves to null the membership lookup is skipped entirely, so only a platform grant can satisfy the verb; a tenant `financ… | apps/api/src/routes/admin/billing-cost-factors.ts:50 (gate), :75-87 (conflict check), :89; repositories/billing-cost-factors.ts:169 |
| 29 | apps/api/src/routes/admin/billing-summary.ts | GET /api/admin/billing/summary | global-accidentally — billing.read with no orgIdParam and no resolveOrgScope. getProjectedOrgRevenue(db, y, m, 10) returns the top-10 orgs by current-month revenue and getRecentLedgerEntries… | apps/api/src/routes/admin/billing-summary.ts:38 (gate), :58-63; repositories/billing-summary.ts:147, :208 (no scope params) |
| 30 | apps/api/src/routes/admin/billing-cost-centers.ts | GET /api/admin/billing/cost-centers | global-accidentally — billing.read with no orgIdParam. CostCenter has org_id, payer_org_id and beneficiary_org_id, yet listCostCenters(db, year, month) does a findMany with no org predicate.… | apps/api/src/routes/admin/billing-cost-centers.ts:34 (gate), :23 (comment), :44; repositories/billing-cost-centers.ts:41-50; prisma/schema/commercial.prisma:157-175 |
| 31 | apps/api/src/routes/admin/billing-enrichment.ts | GET /api/admin/billing/enrichment | global-accidentally — billing.read with no orgIdParam; listEnrichmentSessions(db, {status, days, limit}) has no org argument. Returns per-session OCPP vs CDR energy deltas and OCMF-blob pres… | apps/api/src/routes/admin/billing-enrichment.ts:51 (gate), :58-62; repositories/billing-enrichment.ts:71-74 |
| 32 | apps/api/src/routes/admin/agreements-debug.ts | GET /api/admin/agreements/debug-options | global-accidentally — billing.read with no orgIdParam; the handler does prisma.user.findMany({where:{audience:'driver'}}) take 500 and prisma.chargingStation.findMany() take 500 with no org … | apps/api/src/routes/admin/agreements-debug.ts:173 (gate), :177-195 |
| 33 | apps/api/src/routes/admin/contracts.ts | GET / , GET /:id , GET /:id/tariffs , PATCH /:id , DELETE /:id | global-by-design — all five gate on platform.tenant.read/write/delete with no orgIdParam, which is the deliberate platform-staff surface. But the reads are also row-unscoped: listAllContract… | apps/api/src/routes/admin/contracts.ts:35, :45, :61, :83, :110; repositories/contracts.ts:134, :147 |
| 34 | apps/api/src/routes/admin/billing.ts | scopeFromQuery(c: BillingContext): LedgerScope | global-accidentally — scope is built ENTIRELY from client query params (driverUserId/chargingStationId/siteId/orgId) with no entitlement check; omitting all params yields {kind:'admin'} = al… | apps/api/src/routes/admin/billing.ts:49-67 |
| 35 | apps/api/src/repositories/zaptec-session-sync.ts | importOne(tx: Prisma.TransactionClient, z: ZaptecChargeHistoryEntry): Promise<ImportOutcom… | global-accidentally — driver attribution does `tx.idToken.findFirst({ where: { value: { in: candidates }, status: 'active' } })` with NO orgId filter, so an idToken value belonging to anothe… | apps/api/src/repositories/zaptec-session-sync.ts:135-191 |
| 36 | apps/api/src/repositories/billing-summary.ts | getPeriodTotals(db: PrismaClient, year: number, month: number): Promise<PeriodTotals> | global-accidentally — aggregates the ENTIRE session_ledger with only a startedAt month window and no org filter. The file header at lines 5-6 claims 'All functions take orgId = undefined for… | apps/api/src/repositories/billing-summary.ts:5-6,25-43 |
| 37 | apps/api/src/repositories/billing-summary.ts | getRecentLedgerEntries(db: PrismaClient, limit = 10): Promise<RecentLedgerRow[]> | global-accidentally — findMany over session_ledger with no org filter; it selects orgId and then batch-resolves org display names, i.e. it is built to render cross-tenant rows | apps/api/src/repositories/billing-summary.ts:147-175 |
| 38 | apps/api/src/repositories/billing-summary.ts | getProjectedOrgRevenue(db: PrismaClient, year: number, month: number, topN = 10): Promise<… | global-by-design — a cross-tenant leaderboard is the feature; but it is reachable through the same unverified scope path as everything else on adminBilling | apps/api/src/repositories/billing-summary.ts:208-213 |
| 39 | apps/api/src/repositories/billing-summary.ts | getTariffCoverage(db: PrismaClient): Promise<TariffCoverage>; getCostHealthMetric(db: Pris… | global-accidentally — both take only `db`; getTariffCoverage findMany's every TariffDefinition (which DOES carry org_id) with no filter, and getCostHealthMetric aggregates session_ledger twi… | apps/api/src/repositories/billing-summary.ts:53-55,110-118 |
| 40 | apps/api/src/repositories/billing-enrichment.ts | listEnrichmentSessions(db: PrismaClient, filters: EnrichmentFilters = {}): Promise<{ summa… | global-accidentally — EnrichmentFilters is only { status?, days?, limit? }; there is no orgId field, so both the groupBy summary and the findMany list span every tenant's ledger | apps/api/src/repositories/billing-enrichment.ts:28-34,71-100 |
| 41 | apps/api/src/repositories/billing-cost-centers.ts | listCostCenters(db: PrismaClient, year: number, month: number): Promise<CostCenterRow[]> | global-accidentally — no orgId param; findMany over all cost_centers, then groupBy billingLine / sessionLedger / membership keyed by the orgIds it just discovered. CostCenter itself is prope… | apps/api/src/repositories/billing-cost-centers.ts:41-102 |
| 42 | apps/api/src/repositories/billing-tariff-mgmt.ts | createTariff(db: PrismaClient, input: CreateTariffInput): Promise<TariffMgmtRow> | global-accidentally — orgId arrives INSIDE the request body (`orgId: input.orgId`) rather than as a positional param, so the tenant a tariff is created for is entirely caller-supplied | apps/api/src/repositories/billing-tariff-mgmt.ts:119-142 + apps/api/prisma/schema/commercial.prisma:134-143 |
| 43 | apps/api/src/repositories/billing-contracts.ts | getContractsTiles(db: PrismaClient): Promise<ContractsTileData> | global-accidentally — the sibling listAgreements in the same file takes orgId\|null but this tile aggregate takes none, so the counts above a filtered list can describe a different populatio… | apps/api/src/repositories/billing-contracts.ts:116-118 |
| 44 | apps/api/src/repositories/contracts.ts | listContractsByOrg(db, orgId: string); listAllContracts(db); getContractById(db, contractI… | mixed-by-design — listContractsByOrg is org-scoped, listAllContracts is explicitly global by name; but getContractById / updateContract / deleteContract take only a contractId with no org gu… | apps/api/src/repositories/contracts.ts:42,62,73,117,143 |

### global-by-design — 19

| # | Path | Symbol | Scoping as found | Evidence |
|---|---|---|---|---|
| 45 | apps/api/src/lib/agreement/persist.ts | rateReference.findMany (rate-book load) | global-by-design — commercial.RateReference has NO org column at all (code, costFactorId, supplierOrgId=supplier not tenant), so a where-clause on code alone is the intended read, not a miss… | apps/api/src/lib/agreement/persist.ts:265-290; prisma/schema/commercial.prisma:452-469 |
| 46 | apps/api/src/routes/admin/billing-cost-factors.ts | GET /api/admin/billing/cost-factors | global-by-design — billing.read, no orgIdParam. billing.cost_factors is a genuinely global catalogue keyed by unique `code` with no org_id column. | apps/api/src/routes/admin/billing-cost-factors.ts:40; prisma/schema/commercial.prisma:105-120 (no org_id) |
| 47 | apps/api/src/routes/admin/billing-cost-factors.ts | PATCH /:id, POST /:id/deactivate, POST /:id/reactivate | global-by-design — three billing.write gates, none with orgIdParam; global catalogue. `code` and `anchorTier` are rejected as immutable at the route layer (:109-130). | apps/api/src/routes/admin/billing-cost-factors.ts:97, :165, :190; repositories/billing-cost-factors.ts:207, :264, :300 |
| 48 | apps/api/src/routes/admin/billing-rate-references.ts | GET / , GET /:id , GET /cost-factors | global-by-design — three billing.read gates, no orgIdParam. agreements.rate_references is a global versioned rate book (no org_id; supplier_org_id is a nullable supplier FK, not a tenant key… | apps/api/src/routes/admin/billing-rate-references.ts:45, :66, :80; prisma/schema/commercial.prisma:450-471 (RateReference), :429-445 (AgreementCostFactor) |
| 49 | apps/api/src/routes/admin/billing-rate-references.ts | POST /api/admin/billing/rate-references (stage new rate version) | global-by-design — billing.write, no orgIdParam; platform-grant-only in practice. This is the ONLY working effective-dated rate-authoring write in the API. | apps/api/src/routes/admin/billing-rate-references.ts:99 (gate), :119; repositories/billing-rate-references.ts:227-280; prisma/schema/commercial.prisma:467-468 (indexes only, no @@unique) |
| 50 | apps/api/src/routes/admin/billing-rate-references.ts | PATCH /:id and POST /:id/retire | global-by-design — two billing.write gates, no orgIdParam; global rate book. | apps/api/src/routes/admin/billing-rate-references.ts:154, :208; repositories/billing-rate-references.ts:324, :367 |
| 51 | apps/api/src/routes/internal/ocpp-events.ts | POST /api/ocpp/events (session.stopped → session_ledger) | global-by-design — machine-to-machine, gated by the OCPP_INGEST_SECRET shared-secret header (verifyIngest), not by requirePermission. orgId is derived server-side from the charger's OCPP ide… | apps/api/src/routes/internal/ocpp-events.ts:35-37 (secret gate), :53-54; lib/ocpp/projections.ts:424-458 (upsert), :378-400 (resolve then compute) |
| 52 | apps/api/src/repositories/zaptec-session-sync.ts | syncZaptecSessions(db: PrismaClient, options: ZaptecSyncOptions): Promise<ZaptecSyncReport… | global-by-design — no orgId param; orgId is derived per-CDR from the matched OcppIdentity (line 151). Nothing verifies the identity's org matches the org that owns the Zaptec credential whos… | apps/api/src/repositories/zaptec-session-sync.ts:74-129 |
| 53 | apps/api/src/repositories/billing-cost-factors.ts | listCostFactors(db: PrismaClient): Promise<CostFactorCatalogueSummary> | global-by-design — billing.cost_factors is a platform catalogue with no org_id column; the file says so at lines 5-6 and the model confirms it | apps/api/src/repositories/billing-cost-factors.ts:56-68 + apps/api/prisma/schema/commercial.prisma:115-132 |
| 54 | apps/api/src/repositories/billing-cost-factors.ts | createCostFactor(db: PrismaClient, input: CreateCostFactorInput): Promise<CostFactorRow> | global-by-design — platform catalogue, admin-gated only | apps/api/src/repositories/billing-cost-factors.ts:165-169 + apps/api/prisma/schema/commercial.prisma:117 |
| 55 | apps/api/src/repositories/billing-cost-factors.ts | updateCostFactor(db: PrismaClient, id: string, input: UpdateCostFactorInput): Promise<Cost… | global-by-design — platform catalogue | apps/api/src/repositories/billing-cost-factors.ts:199-207 |
| 56 | apps/api/src/repositories/billing-cost-factors.ts | deactivateCostFactor(db: PrismaClient, id: string): Promise<StatusChangeResult \| null> | global-by-design — platform catalogue | apps/api/src/repositories/billing-cost-factors.ts:252-264 |
| 57 | apps/api/src/repositories/billing-rate-references.ts | createRateReference(db: PrismaClient, input: CreateRateReferenceInput): Promise<RateRefere… | global-by-design — agreements.rate_references is a national rate catalogue; supplierOrgId is a nullable supplier pointer, not a tenant key | apps/api/src/repositories/billing-rate-references.ts:209-283 + apps/api/prisma/schema/commercial.prisma:460-480 |
| 58 | apps/api/src/repositories/billing-rate-references.ts | listRateReferences(db: PrismaClient): Promise<RateReferenceCatalogueSummary> | global-by-design — national rate catalogue, no org filter needed | apps/api/src/repositories/billing-rate-references.ts:104-109 |
| 59 | apps/api/src/repositories/billing-rate-references.ts | patchRateReference(db: PrismaClient, id: string, input: PatchRateReferenceInput): Promise<… | global-by-design — national rate catalogue | apps/api/src/repositories/billing-rate-references.ts:295-324 |
| 60 | apps/api/src/repositories/billing-rate-references.ts | retireRateReference(db: PrismaClient, id: string): Promise<RateReferenceRow \| RetireError… | global-by-design — national rate catalogue | apps/api/src/repositories/billing-rate-references.ts:353-367 |
| 61 | apps/api/src/repositories/billing-dso.ts | getDsoCostFactors(db: PrismaClient): Promise<DsoCatalogueSummary> | global-by-design — DSO rates are national; the function deliberately groups tariff definitions BY org to show catalogue coverage across tenants | apps/api/src/repositories/billing-dso.ts:61-106 |
| 62 | apps/api/src/repositories/billing-electricity.ts | listElectricityCostFactors(db: Db): Promise<ElectricityCatalogueSummary> | global-by-design — retailer rate catalogue; aggregates per (factorId, orgId) to report which orgs are covered. Drizzle-based, not Prisma. | apps/api/src/repositories/billing-electricity.ts:66-129 |
| 63 | apps/api/src/repositories/driver-invoices.ts | listDriverActualSessions — the only shipped "invoice" data source | global-by-design — filters on sessions.userId only (:53), no orgId; a driver charging at several hosts gets one cross-tenant list, which is the intent | apps/api/src/repositories/driver-invoices.ts:30 |

### tenant-scoped-correctly — 34

| # | Path | Symbol | Scoping as found | Evidence |
|---|---|---|---|---|
| 64 | apps/api/src/lib/ocpp/projections.ts | session.stopped ledger write (tariffDefinitionId) | scoped-correctly — org-scoped UUIDs pulled from the event envelope per the file header | apps/api/src/lib/ocpp/projections.ts:437-449 |
| 65 | apps/api/src/lib/billing/statement-zod.ts | CORE_BILLING_ROUTE_CONTRACTS + 8 request/response schemas | scoped-correctly by construction — orgId is required on every admin DTO, and the driver read deliberately omits orgId so a driver cannot name a tenant. 7 of 8 declared routes carry orgIdPara… | apps/api/src/lib/billing/statement-zod.ts:9-15,364-373 |
| 66 | apps/api/src/lib/auth/permissions.ts | billing.export | scoped-correctly — granted per org role alongside billing.read/billing.write | apps/api/src/lib/auth/permissions.ts:66,166,173 — declared and role-granted, but the only reference outside the catalog is the unimplemented contract row at statement-zod.ts:370 |
| 67 | apps/api/src/routes/admin/billing.ts | GET /api/admin/billing/tariffs | scoped-correctly — the ONLY billing route that row-filters. billing.read gate has no orgIdParam, but the handler calls resolveOrgScope and applies `where: orgScope.all === false ? { orgId: {… | apps/api/src/routes/admin/billing.ts:178 (gate), :180 (resolveOrgScope), :186 (row filter) |
| 68 | apps/api/src/routes/admin/bill-objects.ts | POST /api/admin/orgs/:orgId/bill-objects | scoped-correctly — billing.write WITH orgIdParam:"orgId", and the handler additionally verifies the supplied installationId belongs to :orgId before writing (403 otherwise). This file is the… | apps/api/src/routes/admin/bill-objects.ts:70 (gate), :82-96 (installation tenant guard), :98-115 |
| 69 | apps/api/src/routes/admin/bill-objects.ts | GET /:orgId/bill-objects , GET /:orgId/bill-objects/:id , GET /:orgId/bill-objects/:id/mem… | scoped-correctly — three billing.read gates all with orgIdParam:"orgId", and every repo call takes orgId as a first-class argument (listBillObjectsForOrg(db, orgId, …), getBillObject(db, org… | apps/api/src/routes/admin/bill-objects.ts:124, :137, :203; guard re-check at :209-210 |
| 70 | apps/api/src/routes/admin/bill-objects.ts | POST /:orgId/bill-objects/:id/members (attach driver to billing home) | scoped-correctly — billing.write with orgIdParam:"orgId"; the bill object is re-fetched through getBillObject(db, orgId, billObjectId) so a cross-tenant :id 404s, and the target user must be… | apps/api/src/routes/admin/bill-objects.ts:153 (gate), :166-167 (tenant guard), :182-196 |
| 71 | apps/api/src/routes/admin/orgs.ts | GET /api/admin/orgs/:orgId/agreements and /:orgId/sessions | scoped-correctly — billing.read WITH orgIdParam:"orgId", and both repo calls take the same :orgId param (listOrgAgreements(db, orgId), getOrgSessionSummary(db, orgId, now)). These are the ho… | apps/api/src/routes/admin/orgs.ts:286 and :298 (gates), :289, :301 |
| 72 | apps/api/src/routes/admin/orgs.ts | GET /api/admin/orgs/:orgId/sessions/:sessionId | scoped-correctly — billing.read with orgIdParam:"orgId"; because getSessionFullDetail is org-blind the handler adds an explicit post-hoc check `detail.orgId !== c.req.param("orgId") → 404`, … | apps/api/src/routes/admin/orgs.ts:314 (gate), :317-320 |
| 73 | apps/api/src/routes/admin/orgs.ts | GET /:orgId/contracts , /:orgId/tariff-chain , /:orgId/family-groups | scoped-correctly — three contract.read gates all with orgIdParam:"orgId" and repo calls that take that same orgId. Note the verb split: host_admin has billing.read but NOT contract.read, so … | apps/api/src/routes/admin/orgs.ts:327, :341, :353; bundle at lib/auth/permissions.ts:186-192 (HOST_ADMIN_BUNDLE has no contract.read) |
| 74 | apps/api/src/routes/admin/driver-group-memberships.ts | POST and GET /api/admin/orgs/:orgId/driver-group-memberships | scoped-correctly — member.write WITH orgIdParam:"orgId" on both, plus an explicit second guard that DriverGroup.ownerOrgId === :orgId (403 on mismatch) and a driver/active check on the user.… | apps/api/src/routes/admin/driver-group-memberships.ts:48 and :156 (gates), :75-86 (cross-tenant guard), :120-142 |
| 75 | apps/api/src/routes/admin/active-sessions.ts | GET /api/admin/active-sessions | scoped-correctly — charger.read gate with no orgIdParam, but the handler calls resolveOrgScope and applies `inArray(liveSessions.orgId, orgScope.orgIds)` when scope.all is false. Occupancy/p… | apps/api/src/routes/admin/active-sessions.ts:21 (gate), :23 (resolveOrgScope), :48 (row filter) |
| 76 | apps/api/src/routes/public/driver.ts | GET /api/driver/invoices | scoped-correctly — no requirePermission (bearer-token driver auth via requireDriver at :100-112); userId comes from the verified token and listDriverActualSessions filters `eq(sessions.userI… | apps/api/src/routes/public/driver.ts:740-747; repositories/driver-invoices.ts:30-34 and :53 (`where(eq(sessions.userId, userId))`) |
| 77 | apps/api/src/routes/public/driver.ts | GET /api/driver/sessions/history and GET /api/driver/sessions/:id | scoped-correctly — bearer-token driver auth, no requirePermission. History filters `where: { driverUserId: userId }` in the repo; the single-session read reuses the org-blind getSessionFullD… | apps/api/src/routes/public/driver.ts:713-731 and :759-771; repositories/driver-sessions.ts:203-212 |
| 78 | apps/api/src/routes/public/driver.ts | GET /api/driver/installations and /api/driver/chargers/:id/pricing | scoped-correctly — bearer-token driver auth; both repo calls take userId as an argument and resolve access through DriverGroupMembership → DriverGroup → Agreement, returning 404 for both 'ab… | apps/api/src/routes/public/driver.ts:816-821 and :829-843; repositories/driver-pricing.ts:441-446 |
| 79 | apps/api/src/lib/billing/statement-zod.ts | CORE_BILLING_ROUTE_CONTRACTS — 8 declared, 0 implemented | scoped-correctly AS DECLARED (7 of 8 carry orgIdParam:"orgId"; the driver one correctly declares orgIdParam:null so a driver cannot name a tenant) — but none of these paths exist. Grepping r… | apps/api/src/lib/billing/statement-zod.ts:364-373; the comment at :357-362 says it is 'Exported as data so a test can assert…' yet CORE_BILLING_ROUTE_CONTRACTS has zero references repo-wide and no statement-zod.test.ts exists in apps/api/src/lib/billing/ |
| 80 | apps/api/src/repositories/session-ledger.ts | listSessionLedger(db: PrismaClient, scope: LedgerScope, filters: LedgerFilters = {}): Prom… | scoped-correctly-but-caller-trusted — no orgId param; tagged union LedgerScope where {kind:'admin'} sets NO filter (line 86-87). File header lines 16-18 state 'Scope authorisation is the CAL… | apps/api/src/repositories/session-ledger.ts:73-108 |
| 81 | apps/api/src/repositories/session-ledger.ts | totalSessionLedger(db: PrismaClient, scope: LedgerScope, filters: LedgerFilters = {}): Pro… | scoped-correctly-but-caller-trusted — same tagged union; 'admin' branch is a bare `break` with no where clause, aggregating every tenant's ledger | apps/api/src/repositories/session-ledger.ts:210-234 |
| 82 | apps/api/src/repositories/bill-objects.ts | createBillObject(db: PrismaClient, orgId: string, input: CreateBillObjectInput): Promise<B… | scoped-correctly — orgId is a positional param stamped onto the row, not read from the input body | apps/api/src/repositories/bill-objects.ts:82-99 + apps/api/prisma/schema/commercial.prisma:602 |
| 83 | apps/api/src/repositories/bill-objects.ts | listBillObjectsForOrg(db: PrismaClient, orgId: string, options: { installationId?: string … | scoped-correctly — orgId is a mandatory positional param used directly in the where clause | apps/api/src/repositories/bill-objects.ts:101-116 |
| 84 | apps/api/src/repositories/bill-objects.ts | getBillObject(db: PrismaClient, orgId: string, id: string): Promise<BillObjectSummary \| n… | scoped-correctly — findUnique by id then an explicit post-fetch guard `if (!row \|\| row.orgId !== orgId) return null`, the strongest tenant check in this area | apps/api/src/repositories/bill-objects.ts:118-129 |
| 85 | apps/api/src/repositories/bill-objects.ts | assignDriverToBillObject(db: PrismaClient, orgId: string, billObjectId: string, userId: st… | scoped-correctly — the active-membership lookup is org-filtered via relation filter `billObject: { orgId }`; note billObjectId itself is NOT re-verified against orgId (header defers that to … | apps/api/src/repositories/bill-objects.ts:145-183 + apps/api/prisma/schema/commercial.prisma:631-648 |
| 86 | apps/api/src/repositories/driver-invoices.ts | listDriverActualSessions(db: Db, userId: string, limit = 500): Promise<DriverInvoiceSessio… | scoped-correctly-by-subject — keyed on userId (the driver is the tenant boundary for driver billing material), not orgId. Uses Drizzle, not Prisma — a second ORM on the billing read path. | apps/api/src/repositories/driver-invoices.ts:1-50 |
| 87 | apps/api/src/repositories/driver-sessions.ts | listDriverSessionHistory(db: PrismaClient, userId: string, opts: { skip?: number; limit?: … | scoped-correctly-by-subject — userId is a mandatory positional param; driver self-service surface | apps/api/src/repositories/driver-sessions.ts:203-207 |
| 88 | apps/api/src/repositories/driver-sessions.ts | getDriverActiveSessions(db: PrismaClient, userId: string): Promise<DriverActiveSession[]>;… | scoped-correctly-by-subject — both key on userId; resolveStoppableSession pairs userId with sessionId so a driver cannot stop another driver's session | apps/api/src/repositories/driver-sessions.ts:109-112,149-153 |
| 89 | apps/api/src/repositories/driver-sessions.ts | updateDriverProfile(db: PrismaClient, userId: string, patch: DriverProfilePatch): Promise<… | scoped-correctly-by-subject — updates only the row whose id === userId; patch is whitelisted to displayName + locale | apps/api/src/repositories/driver-sessions.ts:311-330 |
| 90 | apps/api/src/repositories/billing-contracts.ts | listAgreements(db: PrismaClient, orgId: string \| null): Promise<AgreementRow[]> | scoped-correctly-with-explicit-opt-out — orgId is a required param; passing null yields `where = {}` (all tenants), so cross-tenant reads are a deliberate, visible choice at the call site ra… | apps/api/src/repositories/billing-contracts.ts:53-70 |
| 91 | apps/api/src/repositories/billing-driver-contracts.ts | listDriverMemberships(db: PrismaClient, orgId: string \| null): Promise<DriverMembershipRo… | scoped-correctly-with-explicit-opt-out — same null-means-all-tenants convention as billing-contracts; this is the better pattern in this area | apps/api/src/repositories/billing-driver-contracts.ts:54-57,139-142 |
| 92 | apps/api/src/repositories/org-tariff-chain.ts | getOrgTariffChainSummary(db: PrismaClient, orgId: string): Promise<OrgTariffChainSummary> | scoped-correctly — orgId is a mandatory positional param applied to site, installation, chargingStation groupBy AND tariffDefinition lookups; the cleanest tenant-scoped read in the billing s… | apps/api/src/repositories/org-tariff-chain.ts:42-91 |
| 93 | apps/api/src/repositories/driver-pricing.ts | listDriverInstallations(db: PrismaClient, userId: string, at?: Date): Promise<Installation… | scoped-correctly-by-subject — userId is mandatory and gates which installations/chargers resolve; `at` supports effective-dated rate lookup for the price the driver would pay now | apps/api/src/repositories/driver-pricing.ts:256,441 |
| 94 | apps/api/src/lib/auth/org-scope.test.ts | resolveOrgScope, orgInScope (9 cases) | scoped-correctly — this IS the row gate; the header is explicit that requirePermission decides which verb, resolveOrgScope decides whose rows, and that the module is a no-op today because on… | apps/api/src/lib/auth/org-scope.test.ts:1-11 (header), :15-40 (hoisted state + both mocks) |
| 95 | apps/api/src/repositories/driver-invoices.ts | listDriverActualSessions | scoped-correctly — filtered on userId | apps/api/src/repositories/driver-invoices.ts:1-6 (header), :30-50 (the query); no matching *.test.ts in any glob |
| 96 | apps/api/src/lib/billing/statement-zod.ts | Core billing period/settlement/statement request+response contracts | scoped-correctly by contract — "orgId is REQUIRED on every request DTO" (:24-27); billingPeriodSchema carries orgId (:45) | apps/api/src/lib/billing/statement-zod.ts:11 |
| 97 | apps/api/src/lib/ocpp/projections.ts | session.stopped projection — tx.sessionLedger.upsert | scoped-correctly — writes updated.orgId (:428) | apps/api/src/lib/ocpp/projections.ts:424 |

### unknown — 8

| # | Path | Symbol | Scoping as found | Evidence |
|---|---|---|---|---|
| 98 | apps/api/src/repositories/zaptec-session-sync.ts | CDR overlay onto charging.sessions | unknown — did not open the org predicate on the update path | apps/api/src/repositories/zaptec-session-sync.ts:306-323,339-362,446 |
| 99 | apps/api/src/repositories/agreements.ts | listAgreements(prisma: PrismaClient): Promise<AgreementListRow[]>; getAgreementDetail(pris… | mixed — listAgreements takes NO orgId (note: a second, different listAgreements from billing-contracts.ts DOES take orgId\|null, so the same name means different scoping in two files); getAg… | apps/api/src/repositories/agreements.ts:110,155,188 |
| 100 | apps/api/src/repositories/driver-group-memberships.ts | createMembership — documented "idempotent upsert, returns { membership, created }" | unknown — not opened beyond the header/comment scan; membership is keyed on (driverGroupId, userId) per index.ts:153 | apps/api/src/repositories/driver-group-memberships.ts:4,56,112-116 |
| 101 | apps/api/src/routes/admin/billing-rate-references.ts | rateReferencesRouter (mounted at /api/admin/billing/rate-references) | unknown — not opened line-by-line for this census | apps/api/src/routes/admin/billing.ts:40 (import), :282 (mount); absent from the recordAuditAction grep across apps/api/src |
| 102 | apps/api/src/routes/admin/billing-tariff-mgmt.ts | tariffMgmtRouter (publish/retire tariff versions) | unknown | apps/api/src/routes/admin/billing.ts:32 (import), :285 (mount); no recordAuditAction hit in the file |
| 103 | apps/api/src/routes/admin/billing-cost-factors.ts | costFactorsRouter | unknown | apps/api/src/routes/admin/billing.ts:36 (import), :274 (mount); no recordAuditAction hit |
| 104 | apps/api/src/routes/admin/billing-enrichment.ts | enrichmentRouter — GET, requirePermission("billing.read") | unknown — requirePermission("billing.read") is present at :51 but the orgIdParam argument was not read | apps/api/src/routes/admin/billing-enrichment.ts:15 (import requirePermission), :49-51 (GET + requirePermission("billing.read")) |
| 105 | apps/api/src/repositories/zaptec-session-sync.ts | syncZaptecSessions — the CDR reconciliation writer | unknown | apps/api/src/repositories/zaptec-session-sync.ts:317-323 and :457-463 (comments); absent from the recordAuditAction call-site set |
