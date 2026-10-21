# Session handover — 2026-08-29

Written by the Cowork coordinator at close. **Read this first next time.**

Companion reading, in order: `SOW-market-phase.md` **v4** ·
`docs/notes/2026-08-28-the-new-build-manifest.md` · **ADR 0056** (the new
build) · **ADR 0055** (the clean slate) · **ADR 0054** (assets) ·
`docs/agent-prompts/latest.md`.

The previous handover is `docs/notes/2026-08-20-session-handover.md`. It is
accurate on rounds 1–3 and **superseded on framing** — it predates the
dress-rehearsal target and the new-build decision.

---

## 1. The one-line state

**Round 4 is complete on both lanes. The target changed from "a first invoice"
to "a dress rehearsal of the whole product", and the build changed from
modified to new. All seven gating decisions are answered. WS-2 and WS-3 are
ready to dispatch and nothing blocks them.**

---

## 2. What happened this session

### Round 4 closed, both lanes

| | Claude A | Claude B |
|---|---|---|
| Result | **29/31 gates**, 1 stated exception, 1 partial | **33/33 gates** |
| Wall clock | 2h08m41s | 43m46s |
| Tests | 1,689 → **1,882** / 105 files · 16 checks · 19 fool tests | 1,076 lane · **1,877 assembled** · 17 checks |
| Beyond the gates | **entire fallback queue + 5 of 6 backlog items** — a first | queue not started, context spent |
| Tip | `eed6503` | `d9a8b18` · assembly `71101e3` |

**Nothing pushed. No migration applied to any database.**

Produced: five migrations (`0004`–`0008`) generated and unapplied · the
agreement write surface · the clean shell in one tree for the first time on
`dev/clean-shell-assembly` · **billing counts placement overlap, taking
Dalvegur from 30 connectors to 20** · the ADR's double-invoice case as a named
test *and* a property test over eight seeds.

Two live defects found and fixed: a CDR with no energy was priced at zero
**and** marked complete (`zaptec-session-sync.ts:235`); the cross-tenant
enrichment view was unconfined on both halves.

**Still open from round 4:** the two dry runs **do not hand off** — no shared
org, period or sequence, both allocating `SV-2026-000001`. One function closes
it and it remains the highest-value item.

### Three ADRs and a rewritten SOW

- **ADR 0055 — the clean slate.** Old chargers, CDRs, orgs, drivers: archived,
  never migrated. **No invoice was ever served; the data is test data**, so
  there is no retention obligation.
- **ADR 0056 — the new build.** The harvest produced clean *libraries* mounted
  inside the old application; **there was never a clean application.** The
  product becomes a new app that starts empty and mounts only what is
  deliberately harvested.
- **`SOW-market-phase.md` v4** — eleven workstreams, ten milestones, tasks with
  acceptance per task. Supersedes v1, v2 and v3 in full.
- **`docs/notes/2026-08-28-the-new-build-manifest.md`** — the boundary:
  **22 resources, 44 operations**, each naming the rehearsal step it serves,
  against 187 endpoints today.

---

## 3. Decisions made this session

| Decision | Answer |
|---|---|
| The target | **A dress rehearsal of the whole product**, through screens, with no invoice served. Acceptance: no row created by hand; a second host invisible to the first; two installations inside one CPO with disjoint drivers |
| The build | **New application.** Old code is reference, not inheritance. The old app is switched off whole, not converted |
| The data | **Archived, never migrated.** Preferred shape: **stand up a new database and retire the old one in place** rather than applying migrations then wiping — no destructive step is ever executed |
| Auth | **Email as username, password created by admin, forced change on first sign-in.** PBKDF2 via WebCrypto — Workers has no native bcrypt or argon2 |
| The build's name | **`RoadToMarket`** — folder, branch, docs. **Kept out of Worker and environment names** |
| The temporal constraint | **`EXCLUDE USING GIST` with `btree_gist`** — works on every version, confirmed available on Neon. No lookup needed |
| Reference data | Initial cost-factor catalogue **seeded with the schema**; an admin screen for anything added later |
| Production | **A protected branch and environment nobody touches directly.** The `-staging` hostname mess dies with the old app |
| The rehearsal's money lines | **Both.** Dalvegur is a workplace (org pays); the MDU second host gives dweller-pays; **one Dalvegur driver is set to self-pay** to prove person-pays first |
| Mid-month move | **Full fee to both hosts.** The agreement must state that the sum across hosts exceeds one fee that month |
| Language | **English for now**, translate later. Revisit before a dweller receives a document |
| Money precision | **Whole krónur.** The króna has no subunit — a 2002 regulation requires invoices and claims in whole krónur, and the eyrir ceased to exist in 2007. Rates keep sub-króna precision; line amounts round half-up to whole krónur; the total is the sum of rounded lines. **The current invoice renders `7.564,00 kr` and should not** |
| Provenance | **Temporal by default, not a parallel audit system.** Anything deciding money or access is dated and closed; transaction time alongside valid time; **read-only human credentials**; trigger audit for the mutable remainder only. Criterion 1 is **enforced, not verified** |
| Visibility | Straumvakt Admin sees all · a CPO sees their own, one installation or many · **not every driver of a CPO reaches every charger** · a driver sees only what they are granted and themselves |
| Access model | **Group to group** — driver group ↔ charger group, both dated, union resolution, **ambiguous bearer refused**. Charger group scoped to one installation. Flattens to OCPI's `location_id` + `evse_uids` |
| Cost model | **One factor, one owner.** Ownership per driver, defaulting from the group, overridable, dated, sealed at session start. Catalogue v2 logged, not implemented |
| The participant | A company whose drivers charge at an installation it does not own **gets a login**, manages its own roster, sees only its own slice. Delegated admin falls out of group-to-group |

---

## 4. Waiting on Andri

1. **Commit the specifications.** ADR 0054, 0055, 0056 and several notes exist
   on **no branch** — untracked in canonical. A found this in its Phase 0 and
   correctly refused to duplicate the ADR into a lane branch. **One
   `git clean -fd` destroys the specification for the next three rounds.**
   Attempted from the bridge and blocked by a live index lock; it must be run
   natively, which is also line-ending-safe.
2. **Rotate `ADMIN_PASSWORD`** on exactly three Workers — `hlada`,
   `hlada-staging`, `hlada-api-staging`.
3. **Session retention** for per-driver rows — still undecided.
4. **The data processing agreement**, terms and privacy policy. Parked with a
   trigger: **before the first host signs anything.** No engineering content
   and a lead time you do not control.

## 5. Proposed and not yet accepted

- **A "do not recreate" list** — the 66 baseline tables named as deliberately
  absent, so their absence is a decision rather than an oversight.
- **An archive record at freeze** — row counts per table, the estate list, the
  date it went read-only. The archive is also the **verification reference for
  the re-onboard**: the only way to know it produced the right estate.
- **Make the endpoint budget executable** — a CI check comparing the registered
  route table to the manifest, failing the build on an undeclared route. This,
  not discipline, is what stops 187 recurring.
- **A harvest gate in WS-4** — each module *read* before it is mounted, unused
  exports dropped, queries checked for tenancy scope. The one cheap moment.
- **Verify the endpoint budget** against the screens, step by step. It was
  derived by the coordinator and audited by the coordinator; nobody else has
  checked it.

---

## 6. What is next

**Round 5 = WS-2 and WS-3**, with the UI lane starting WS-8's first two
screens. Suggested cut:

| Lane | Work |
|---|---|
| **A** | WS-3 — re-base the migration line into one fresh initial migration, its own database. Then WS-5's structural fixes: seal the owner, org statements to any org, `issueInvoiceFromStatement` |
| **B** | WS-2 — the shell: auth, tenancy middleware, refusal conventions, read-only credentials, observability |
| **GPT** | WS-8.2 and 8.3 — **the grants matrix** and **the held period**, the two screens that decide whether the product reads as trustworthy |
| **C** | conditional — the mobile reconciliation and the money unit, if a window is free |

---

## 7. Findings not to re-derive

- **The wipe forces new OCPP credentials.** Passwords are hashed and
  unrecoverable, so each charger needs a new credential entered at the vendor.
  **Check first whether it is per-installation or per-charger, and whether the
  vendor API can set it** — the estimate swings 20× on that.
- **A charger never onboarded still consumes on the host's meter** and produces
  no session anywhere. Only the meter, or the vendor's inventory, finds it.
  Five chargers are unaccounted: 30 in our database, 35 in the portal.
- **In OCPP Cloud mode the socket originates at the vendor**, not the charger,
  so client certificates would authenticate the vendor, not a charger. Your
  control is credential hygiene plus 0 A offline current — **verified per
  charger, not assumed**.
- **`ocpp-auth` returns 200 for an identity whose stored hash is null** —
  identity string alone. The no-auth path the fleet was onboarded on. After the
  wipe that branch must refuse.
- **Auth is not missing; it is in shadow mode.** A verdict is computed and
  logged for every Authorize, and the gate fails closed when armed. Nobody has
  read the shadow log — that is a free finding available now.
- **The gateway's `default: {}`** answers unknown OCPP actions with an empty
  success, including `DataTransfer`, whose response requires a status field.
  Zaptec uses DataTransfer.
- **`StartTransaction` returns a random transaction id** — the reconciliation
  key, with no link to our own record.
- **31 unconfined `orgIdParam` gates remain, all in `apps/api`** — **none in
  `packages/**`**, so the defect does not ride along with the harvest.
- **OCPP has no standard key for "require a credential"** in 1.6 — it is a
  vendor setting. 2.0.1 standardises it as `AuthCtrlr.Enabled`.

---

## 8. A note on how this session went

Both agents corrected a coordinator file:line claim and both were right — the
third round running. The mitigation that works is telling the agent to verify
the premise rather than trusting it.

Andri twice pulled the coordinator back from manufacturing objections and from
doing lane work. **The rule that came out of it: find the blocker, name it,
hand it to a lane. Do not solve it.** Ledger notes 30–33.
